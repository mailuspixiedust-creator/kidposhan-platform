// Discovery: turn each registered source (mostly collection/category pages) into individual recipe URLs.
// Replaces the single hard-coded Tavily query. Two independent paths feed kp_recipe_candidates:
//   1. crawl the source's own collection page (+ up to N pagination pages)
//   2. Tavily, restricted to the source's domain, with queries generated per occasion/age/diet
// The source URL itself is also enqueued, because several registry entries are single recipe pages.

import { fetchHtml, UA } from './extract.js';

const SKIP = /\/(tag|tags|category|categories|label|author|page\/\d+|search|feed|wp-content|wp-json|wp-admin|about|contact|privacy|disclaimer|terms|shop|cart|account|login|subscribe|amp)(\/|$)|\.(jpe?g|png|webp|gif|svg|pdf|xml|css|js)$|[?&](share|replytocom|utm_)/i;
const RECIPE_HINT = /recipe|how-to-make|-rice|dosa|idli|paratha|upma|poha|khichdi|curry|dal|sabzi|ladoo|cutlet|tikki|sandwich|soup|halwa|pulao|chilla|cheela|thepla|bhaat|kootu|roll|muffin|pancake|porridge|kheer|puree|bites/i;

// Index / category / roundup pages list recipes; they are not recipes themselves.
export function isIndexPath(path) {
  const p = path.replace(/\/+$/, '').toLowerCase();
  if (/\/(recipe-index|recipes-index|recipe-archive|all-recipes|recent-recipes|archive|archives|sitemap)$/.test(p)) return true;
  if (/^\/recipes\/[^/]+$/.test(p)) return true;          // /recipes/<category>
  const slug = p.split('/').pop() || '';
  return /-recipes$/.test(slug) && !/-recipe-/.test(slug);  // plural slug = roundup, e.g. baby-food-recipes (but baby-corn-pulao-recipe-baby-corn-recipes is one dish)
}

export function isManual(source) {
  return source.crawl_mode === 'manual' || /instagram\.com|youtube\.com|youtu\.be/i.test(source.url);
}

function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } }

export function recipeLinksFrom(html, baseUrl) {
  const base = new URL(baseUrl);
  const host = base.hostname.replace(/^www\./, '');
  const links = new Set();
  for (const [, href] of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["']/gi)) {
    let u;
    try { u = new URL(href, base); } catch { continue; }
    if (!/^https?:$/.test(u.protocol)) continue;
    if (u.hostname.replace(/^www\./, '') !== host) continue;
    u.hash = ''; u.search = '';
    const path = u.pathname;
    if (path === '/' || path === base.pathname || SKIP.test(path) || isIndexPath(path)) continue;
    const slug = path.split('/').filter(Boolean).pop() || '';
    // individual posts usually have a long hyphenated slug or a recipe keyword
    if ((slug.match(/-/g) || []).length >= 2 || RECIPE_HINT.test(path)) links.add(u.toString());
  }
  return [...links];
}

function nextPage(html, baseUrl) {
  const rel = html.match(/<link[^>]+rel=["']next["'][^>]+href=["']([^"']+)["']/i) ||
              html.match(/<a[^>]+(?:class=["'][^"']*next[^"']*["']|rel=["']next["'])[^>]*href=["']([^"']+)["']/i) ||
              html.match(/<a[^>]+href=["']([^"']+)["'][^>]*(?:class=["'][^"']*next[^"']*["']|rel=["']next["'])/i);
  if (!rel) return null;
  try { return new URL(rel[1], baseUrl).toString(); } catch { return null; }
}

export async function crawlCollection(env, source, { maxPages = 3 } = {}) {
  const found = new Set();
  let url = source.url;
  for (let i = 0; i < maxPages && url; i++) {
    const { html, finalUrl } = await fetchHtml(url, env);
    recipeLinksFrom(html, finalUrl).forEach((l) => found.add(l));
    url = nextPage(html, finalUrl);
  }
  return [...found];
}

// Query generation: one per occasion, plus age- and diet-specific gap fillers.
export function tavilyQueries({ occasions = ['breakfast', 'lunchbox', 'snack', 'dinner'], extra = [] } = {}) {
  const words = {
    breakfast: 'kids breakfast recipe', lunchbox: 'kids lunch box tiffin recipe', lunch: 'kids lunch recipe',
    snack: 'healthy evening snack recipe for kids', snack_4pm: 'healthy evening snack recipe for kids', dinner: 'kids dinner recipe',
  };
  return [...new Set(occasions.map((o) => words[o] || `${o} recipe for kids`).concat(extra))];
}

export async function tavilySearch(env, source, queries, { maxResults = 10 } = {}) {
  if (!env.TAVILY_API_KEY) return [];
  const host = hostOf(source.url);
  const urls = new Set();
  for (const query of queries) {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.TAVILY_API_KEY}` },
      body: JSON.stringify({ api_key: env.TAVILY_API_KEY, query, include_domains: [host], max_results: maxResults, search_depth: 'basic' }),
    });
    if (!res.ok) continue;
    const data = await res.json();
    for (const r of data.results || []) {
      try {
        const u = new URL(r.url);
        if (!SKIP.test(u.pathname) && !isIndexPath(u.pathname)) { u.hash = ''; urls.add(u.toString()); }
      } catch { /* ignore */ }
    }
  }
  return [...urls];
}

export async function discoverSource(env, source, opts = {}) {
  if (isManual(source)) return { source_id: source.id, mode: 'manual', added: 0 };
  const urls = new Map(); // url -> via
  urls.set(source.url, 'self');
  const errors = [];
  try { for (const u of await crawlCollection(env, source, opts)) if (!urls.has(u)) urls.set(u, 'collection'); }
  catch (e) { errors.push(`crawl: ${e.message}`); }
  if (opts.useTavily !== false) {
    try { for (const u of await tavilySearch(env, source, tavilyQueries(opts))) if (!urls.has(u)) urls.set(u, 'tavily'); }
    catch (e) { errors.push(`tavily: ${e.message}`); }
  }
  const stmt = env.DB.prepare('INSERT OR IGNORE INTO kp_recipe_candidates (source_id, url, discovered_via) VALUES (?, ?, ?)');
  const batch = [...urls].map(([u, via]) => stmt.bind(source.id, u, via));
  let added = 0;
  for (let i = 0; i < batch.length; i += 50) {
    const res = await env.DB.batch(batch.slice(i, i + 50));
    added += res.reduce((n, r) => n + (r.meta?.changes || 0), 0);
  }
  return { source_id: source.id, mode: 'auto', found: urls.size, added, errors };
}

export { UA };
