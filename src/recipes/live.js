// Search-triggered discovery: every parent search can find NEW recipes in the background.
// Flow:  parent searches -> results returned immediately from published recipes
//        -> (background, at most once per filter combination per DISCOVERY_COOLDOWN_HOURS)
//           Tavily over registered sites, then the open web for well-known creators not yet registered
//        -> candidates extracted -> recipes land as 'pending' in the review screen
//        -> owner ticks Publish -> parents see them from the next search.

import { processPending } from './pipeline.js';
import { tavilySearchRaw } from './tavily.js';

const COOLDOWN_HOURS = 24;
const MAX_EXTRACT_NOW = 6;       // extracted inside the search request's waitUntil; the cron drains the rest
const MAX_NEW_SITE_RESULTS = 6;

// Never suggest these as recipe sources.
const NOT_SOURCES = /(^|\.)(pinterest|instagram|facebook|youtube|youtu|quora|reddit|twitter|x|amazon|flipkart|blinkit|swiggy|zomato|zeptonow|bigbasket|wikipedia|justdial|scribd|archive)\./i;
const RECIPE_PATH = /recipe|how-to-make|\/\d{4}\/\d{2}\/[a-z0-9-]{8,}|-[a-z]+-[a-z]+-[a-z]+/i;

export function ageBand(m) {
  return m < 12 ? 'infant' : m < 36 ? 'toddler' : m < 72 ? 'preschool' : m < 108 ? 'school' : 'preteen';
}
// Regional cuisines the background search rotates through. A recipe-led search ("assamese vegetarian lunch recipe for kids")
// finds the sites that publish that cuisine, so the sites a recipe is cited from are captured too (suggested for your go-ahead).
export const CUISINES = {
  india: ['north east indian', 'assamese', 'manipuri', 'naga', 'mizo', 'khasi meghalaya', 'sikkimese', 'tripura', 'arunachal', 'bengali', 'odia', 'bihari',
    'kashmiri', 'himachali', 'punjabi', 'rajasthani', 'gujarati', 'maharashtrian', 'goan', 'karnataka', 'kerala', 'tamil', 'andhra', 'telangana', 'hyderabadi', 'uttar pradesh'],
  asia: ['thai', 'vietnamese', 'filipino', 'malaysian', 'indonesian', 'singaporean', 'japanese', 'korean', 'chinese home style', 'sri lankan', 'burmese', 'cambodian'],
  europe: ['italian', 'mediterranean', 'french', 'spanish', 'greek', 'german', 'british', 'irish', 'scandinavian', 'polish', 'portuguese', 'dutch'],
};
// The key of one search: the filters, plus the cuisine and world when the search is for those. (Plain Indian searches keep their old key.)
export function queryKey(q) {
  return [q.pref, q.occasion, q.season, ageBand(q.age)].join('|') + (q.cuisine ? `|c:${q.cuisine}` : '') + ((q.world || 'india') !== 'india' ? `|w:${q.world}` : '');
}
export function queryText(q) {
  const pref = { veg: 'vegetarian', jain: 'jain no onion no garlic', nonveg: 'egg chicken fish mutton prawn' }[q.pref];
  const occ = { breakfast: 'breakfast', lunchbox: 'lunch box tiffin', lunch: 'lunch', snack_4pm: 'evening snack', dinner: 'dinner' }[q.occasion];
  const age = { infant: 'baby food 6 to 12 months', toddler: 'toddler', preschool: 'kids', school: 'kids', preteen: 'kids' }[ageBand(q.age)];
  const season = q.season === 'all' ? '' : q.season;
  // a parent's own search keeps the plain "indian"; the background search names the cuisine instead
  const lead = q.cuisine || { india: 'indian', asia: 'southeast asian', europe: 'european' }[q.world || 'india'];
  return `${lead} ${pref} ${occ} recipe for ${age} ${season}`.replace(/\s+/g, ' ').trim();
}

const tavily = (env, body) => tavilySearchRaw(env, body);   // counted against the daily cap

const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } };

export async function shouldDiscover(env, key) {
  const row = await env.DB.prepare('SELECT last_run_at FROM kp_search_discovery_log WHERE query_key = ?').bind(key).first();
  if (!row) return true;
  return Date.now() - Date.parse(row.last_run_at + 'Z') > COOLDOWN_HOURS * 3600e3;
}

export async function discoverForQuery(env, q, { publishedCount = 0 } = {}) {
  if (!env.TAVILY_API_KEY) return { skipped: 'no TAVILY_API_KEY' };
  const key = queryKey(q);
  // claim the slot first so parallel searches don't all fire
  await env.DB.prepare(
    `INSERT INTO kp_search_discovery_log (query_key, last_run_at, runs, last_published) VALUES (?, datetime('now'), 1, ?)
     ON CONFLICT(query_key) DO UPDATE SET last_run_at = datetime('now'), runs = runs + 1, last_published = excluded.last_published`
  ).bind(key, publishedCount).run();

  const text = queryText(q);
  const world = q.world || 'india';
  const { results: sources } = await env.DB.prepare(
    "SELECT id, url, status, world FROM kp_recipe_sources WHERE crawl_mode = 'auto' AND (status = 'suggested' OR (status = 'registered' AND active = 1))"
  ).all();
  const byHost = new Map(sources.map((s) => [host(s.url), s]).filter(([h]) => h));
  const sameWorld = [...byHost.entries()].filter(([, s]) => (s.world || 'india') === world).map(([h]) => h);
  // blocked AND paused sites are excluded from the open-web pass too, so they aren't re-suggested
  const blocked = new Set((await env.DB.prepare("SELECT url FROM kp_recipe_sources WHERE status = 'blocked' OR (status = 'registered' AND active = 0)").all()).results.map((s) => host(s.url)));

  const found = []; // {sourceId, url}
  // 1. Registered (and previously suggested) sites of this part of the world first.
  try {
    if (sameWorld.length) for (const r of await tavily(env, { query: text, include_domains: sameWorld.slice(0, 300) })) {
      const s = byHost.get(host(r.url));
      if (s) found.push({ sourceId: s.id, url: r.url });
    }
  } catch (e) { /* fall through to open web */ }

  // 2. Open web: well-known creators not yet in the registry become 'suggested' sites (in this search's part of the world).
  try {
    const open = await tavily(env, { query: text, exclude_domains: [...byHost.keys(), ...blocked].slice(0, 300) });
    let added = 0;
    for (const r of open) {
      const h = host(r.url);
      if (!h || NOT_SOURCES.test(h) || blocked.has(h) || !RECIPE_PATH.test(new URL(r.url).pathname)) continue;
      if (added >= MAX_NEW_SITE_RESULTS) break;
      let s = byHost.get(h);
      if (!s) {
        const origin = new URL(r.url).origin + '/';
        s = await env.DB.prepare(
          `INSERT INTO kp_recipe_sources (name, platform, region, area, url, notes, active, crawl_mode, status, world)
           VALUES (?, 'Website', 'Unknown', 'Unknown', ?, ?, 0, 'auto', 'suggested', ?) RETURNING id, url, status, world`
        ).bind(h, origin, `Found by search: ${text}`, world).first();
        byHost.set(h, s);
      }
      found.push({ sourceId: s.id, url: r.url });
      added++;
    }
  } catch (e) { /* ignore */ }

  const ins = env.DB.prepare(
    "INSERT OR IGNORE INTO kp_recipe_candidates (source_id, url, discovered_via, query_key) VALUES (?, ?, 'search', ?)"
  );
  let newCandidates = 0;
  if (found.length) {
    const res = await env.DB.batch(found.map((f) => ins.bind(f.sourceId, f.url.split('#')[0], key)));
    newCandidates = res.reduce((n, r) => n + (r.meta?.changes || 0), 0);
  }
  await env.DB.prepare('UPDATE kp_search_discovery_log SET last_found = ? WHERE query_key = ?').bind(newCandidates, key).run();

  const processed = newCandidates ? await processPending(env, { limit: MAX_EXTRACT_NOW, queryKey: key }) : [];
  return { query_key: key, query: text, found: found.length, new_candidates: newCandidates, extracted: processed.length };
}
