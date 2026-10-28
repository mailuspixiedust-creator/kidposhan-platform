// GET /api/kp/recipes?age_months=48&season=monsoon&occasion=lunchbox&pref=veg[&limit=12]
// Every filter takes a comma-separated list: age_months=24,60&occasion=lunch,dinner&season=winter,monsoon&pref=veg,jain.
//   several ages: the recipe must suit ALL of them (safe for the youngest) and is scored for the lowest of their bands;
//   several meals, seasons or food preferences: a recipe matching ANY of them is offered.
// GET /api/kp/recipes/:id
//
// Which recipes: only ones with a Poshan Score of 70 or more (7 checks of 10) that are not held at OK (capped) and have a cooking time. A random selection,
// not the same top of the list every time: recipes the device saw last time are skipped, and `shuffle=1` (with `exclude=` the ids on screen) draws a new set.
// Guarantee: return at least MIN_RESULTS when the catalogue can supply them (lower-scored recipes only fill what is missing).
// Diet preference and age safety are HARD filters and are never relaxed.
// Season and occasion are SOFT: relaxed in tiers, and each result says how it matched.

import { buyLinksFor } from '../commerce/buylinks.js';
import { displayName } from './normalize.js';
import { discoverForQuery, shouldDiscover, queryKey } from './live.js';
import { scoreSqlFor, capSqlFor } from './score.js';
import { creditName, cleanIngredients, singleMethod, toPoints, hasChilli, KID_CHILLI_NOTE, isRealMeal, SWEET_OR_BAKED, savouryOnly, dishKey } from './clean.js';
export { isPrepRecipe } from './clean.js';
import { bandForMonths, bandById, REFERENCE_BAND, ALL_BANDS } from './score2.js';

export const MIN_RESULTS = 20;          // every filter combination should offer at least this many recipes
const MAX_LIMIT = 40, POOL = 160;       // POOL: candidates gathered so a random draw has something to choose from
export const WORLD_SHELF = 6;           // the Asian and European shelves show a handful, not a full list
export const GOOD_MIN = 70;             // a recipe is offered by default only from this score up (and not capped)
const OCCASIONS = ['breakfast', 'lunchbox', 'lunch', 'snack_4pm', 'dinner'];
const SEASONS = ['summer', 'monsoon', 'winter', 'all'];
const RELATED = {
  breakfast: ['snack_4pm', 'dinner'], lunchbox: ['lunch', 'snack_4pm'], lunch: ['lunchbox', 'dinner'],
  snack_4pm: ['breakfast', 'lunchbox'], dinner: ['lunch', 'breakfast'],
};
const DIETS = { veg: ['veg', 'jain'], jain: ['jain'], nonveg: ['nonveg', 'egg'] };
// Where a recipe site's food comes from: the main list is India; Asian and European recipes are separate shelves.
const WORLDS = ['india', 'asia', 'europe'];
// Parents only ever see recipes the owner has published in the review screen.
const VISIBLE = "('approved')";

const json = (data, status = 200, cache = 'public, max-age=300') =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache, 'access-control-allow-origin': '*' },
  });

const list = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);
const uniq = (arr) => [...new Set(arr)];
function readParams(url) {
  const p = url.searchParams;
  const ages = uniq(list(p.get('age_months')).map((x) => parseInt(x, 10))).slice(0, 5);
  const occasions = uniq(list(p.get('occasion'))).slice(0, 5);
  const seasons = uniq(list(p.get('season') || 'all')).slice(0, 4);
  const prefs = uniq(list(p.get('pref') || 'veg')).slice(0, 3);
  const isIndia = (p.get('world') || 'india') === 'india';
  const limit = Math.min(Math.max(parseInt(p.get('limit'), 10) || (isIndia ? MIN_RESULTS : WORLD_SHELF), isIndia ? MIN_RESULTS : 4), MAX_LIMIT);
  const vidRaw = p.get('vid') || '';
  const vid = /^[A-Za-z0-9]{16,40}$/.test(vidRaw) ? vidRaw : null;
  const world = p.get('world') || 'india';
  const shuffle = p.get('shuffle') === '1';
  const exclude = (p.get('exclude') || '').split(',').map((x) => parseInt(x, 10)).filter((x) => Number.isFinite(x)).slice(0, 80);
  const errors = [];
  const bandP = p.get('band') || '', bandId = ALL_BANDS.some((b) => b.id === bandP) ? bandP : null;     // a named ICMR-NIN group, e.g. 13-15:f or adult:m:mod
  if (!ages.length || ages.some((a) => !Number.isFinite(a) || a < 6 || a > 1200)) errors.push('age_months must be 6-1200');
  if (!occasions.length || occasions.some((o) => !OCCASIONS.includes(o))) errors.push(`occasion must be one of ${OCCASIONS.join(', ')}`);
  if (seasons.some((x) => !SEASONS.includes(x))) errors.push(`season must be one of ${SEASONS.join(', ')}`);
  if (prefs.some((x) => !DIETS[x])) errors.push('pref must be veg, jain or nonveg');
  if (!WORLDS.includes(world)) errors.push(`world must be one of ${WORLDS.join(', ')}`);
  const age = Math.min(...ages);                      // the youngest: the single-value fields keep meaning the primary choice
  return { age, ages, bandId, band: bandId || bandForMonths(age).id, occasion: occasions[0], occasions, season: seasons[0], seasons, pref: prefs[0], prefs, limit, world, vid, shuffle, exclude, errors };
}

// the search's own view of its filters: lists, whether it was called with lists or with single values
export function normalizeQuery(q) {
  const ages = q.ages?.length ? q.ages : [q.age];
  const age = Math.min(...ages);
  const bands = q.bandId ? [q.bandId] : uniq(ages.map((a) => bandForMonths(a).id));
  return { ...q, ages, age, bands, band: q.bandId || bandForMonths(age).id,
    occasions: q.occasions?.length ? q.occasions : [q.occasion], seasons: q.seasons?.length ? q.seasons : [q.season || 'all'], prefs: q.prefs?.length ? q.prefs : [q.pref || 'veg'] };
}
// SQL for the score parents see: for several ages, the lowest of the bands' scores (a recipe has to suit every child) and any band's cap
const scoreExpr = (q) => (q.bands.length === 1 ? scoreSqlFor(q.bands[0]) : `MIN(${q.bands.map(scoreSqlFor).join(', ')})`);
const capExpr = (q) => (q.bands.length === 1 ? capSqlFor(q.bands[0]) : `MAX(${q.bands.map(capSqlFor).join(', ')})`);

async function queryTier(env, q, tier, excludeIds, take) {
  if (tier.occasions && !tier.occasions.length) return [];     // nothing related to look at
  const args = [];
  const diets = uniq(q.prefs.flatMap((x) => DIETS[x]));
  let sql = `
    SELECT r.id, r.name, CASE WHEN s.photos_hidden = 0 THEN r.image_url END AS image_url, r.total_minutes, r.diet, r.mayo_flex, r.age_min_months, r.age_max_months,
           ${scoreExpr(q)} AS poshan_score, ${capExpr(q)} AS capped, CASE WHEN r.score_hidden = 0 AND r.poshan_score IS NOT NULL THEN r.score_status END AS score_kind, r.completeness, r.source_url, s.name AS source_name, s.region AS source_region,
           (SELECT round(avg(stars), 1) FROM kp_ratings WHERE recipe_id = r.id) AS rating_avg,
           (SELECT count(*) FROM kp_ratings WHERE recipe_id = r.id) AS rating_count,
           (SELECT count(*) FROM kp_ratings WHERE recipe_id = r.id AND stars >= 4) AS liked_count,
           (SELECT group_concat(occasion) FROM kp_recipe_occasions WHERE recipe_id = r.id) AS occasions,
           (SELECT group_concat(season)   FROM kp_recipe_seasons   WHERE recipe_id = r.id) AS seasons
      FROM kp_recipes r JOIN kp_recipe_sources s ON s.id = r.source_id
     WHERE r.review_status IN ${VISIBLE}
       AND (r.diet IN (${diets.map(() => '?').join(',')})${q.prefs.includes('nonveg') ? ' OR r.mayo_flex = 1' : ''})
       AND r.age_min_months <= ? AND r.age_max_months >= ?
       AND s.world = ?
       AND r.total_minutes IS NOT NULL AND (${scoreExpr(q)}) IS NOT NULL`;     // no score or no time: not shown until it has both
  args.push(...diets, Math.min(...q.ages), Math.min(144, Math.max(...q.ages)), q.world || 'india');   // suits every chosen age
  if (tier.good) sql += ` AND (${scoreExpr(q)}) >= ${GOOD_MIN} AND ${capExpr(q)} = 0`;

  if (tier.season) {
    sql += ` AND EXISTS (SELECT 1 FROM kp_recipe_seasons x WHERE x.recipe_id = r.id AND x.season IN (${q.seasons.map(() => '?').join(',')}, 'all'))`;
    args.push(...q.seasons);
  }
  if (tier.occasions) {
    sql += ` AND EXISTS (SELECT 1 FROM kp_recipe_occasions o WHERE o.recipe_id = r.id AND o.occasion IN (${tier.occasions.map(() => '?').join(',')}))`;
    args.push(...tier.occasions);
  }
  if (excludeIds.length) {
    sql += ` AND r.id NOT IN (${excludeIds.map(() => '?').join(',')})`;
    args.push(...excludeIds);
  }
  sql += ` ORDER BY r.id LIMIT ?`;
  args.push(take);
  const { results } = await env.DB.prepare(sql).bind(...args).all();
  return results;
}

// A cold dish is not a winter dinner, a hot stew is not a summer lunch box. Tags say "all seasons" far too often, so the name decides too.
const COLD_DISH = /\b(cold|chilled|iced|gazpacho|smoothie|ice[- ]cream|popsicle|sorbet|lassi|milkshake|salad|cheesecake|no[- ]bake)\b/i;
const HOT_DISH = /\b(stew|hot chocolate|kadha|hot soup|hotpot)\b/i;
export function seasonMismatch(name, season) {
  if (season === 'winter') return COLD_DISH.test(name || '');
  if (season === 'summer') return HOT_DISH.test(name || '');
  return false;
}
// Over four hours is mostly soaking, fermenting or chilling, not cooking: the card says so instead of "930 min".
export const WAITING_MINUTES = 240;

const comboKey = (q) => [q.world || 'india', [...q.prefs].sort().join('+'), [...q.occasions].sort().join('+'), [...q.seasons].sort().join('+'), [...q.ages].sort((x, y) => x - y).map((a) => bandForMonths(a).id).join('+'), q.bandId || ''].join('|');
// the recipes this device was last shown for this combination (the newest batch)
async function lastShown(env, vid, combo) {
  const { results } = await env.DB.prepare('SELECT recipe_id FROM kp_seen WHERE vid = ? AND combo = ? AND last_at = (SELECT max(last_at) FROM kp_seen WHERE vid = ? AND combo = ?)').bind(vid, combo, vid, combo).all();
  return new Set(results.map((r) => r.recipe_id));
}
async function recordShown(env, vid, combo, ids) {
  if (!ids.length) return;
  const t = Math.floor(Date.now() / 1000);
  const up = env.DB.prepare('INSERT INTO kp_seen (vid, combo, recipe_id, times, last_at) VALUES (?,?,?,1,?) ON CONFLICT(vid, combo, recipe_id) DO UPDATE SET times = times + 1, last_at = excluded.last_at');
  await env.DB.batch(ids.map((id) => up.bind(vid, combo, id, t)));
}
const shuffled = (arr, rng) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
// Pure. A random draw of `limit` from the pool: recipes in `avoid` are used only if too few others exist. Best match tier wins first
// (so a winter search is not filled with off-season recipes while enough in-season ones exist).
export function pickRandom(pool, avoid, limit, rng = Math.random) {
  const out = [];
  for (const m of [...new Set(pool.map((r) => r.match))]) {
    if (out.length >= limit) break;
    const inTier = pool.filter((r) => r.match === m);
    const fresh = shuffled(inTier.filter((r) => !avoid.has(r.id)), rng), again = shuffled(inTier.filter((r) => avoid.has(r.id)), rng);
    out.push(...[...fresh, ...again].slice(0, limit - out.length));
  }
  return out;
}

export async function searchRecipes(env, q) {
  q = normalizeQuery(q);
  const related = uniq(q.occasions.flatMap((o) => RELATED[o])).filter((o) => !q.occasions.includes(o));
  const rng = q.rng || Math.random;
  const tiers = [
    { match: 'exact',               season: true,  occasions: q.occasions, good: true },
    { match: 'any_season',          season: false, occasions: q.occasions, good: true },
    { match: 'related_occasion',    season: true,  occasions: related, good: true },
    { match: 'related_any_season',  season: false, occasions: related, good: true },
    // only when the combination still has too few recipes at 70 or more: the best of the rest fills the gap
    { match: 'lower_score',         season: false, occasions: q.occasions, good: false },
    { match: 'lower_score_related', season: false, occasions: related, good: false },
  ];
  // Asian and European shelves only show dishes for this meal (exact season, then any season): no filler from other meals.
  const useTiers = (q.world || 'india') === 'india' ? tiers : [tiers[0], tiers[1], tiers[4]];
  const pool = [];
  for (const tier of useTiers) {
    if (pool.length >= q.limit + 6) break;           // enough to draw from: do not relax the season or the meal further
    const rows = await queryTier(env, q, tier, pool.map((r) => r.id), POOL);
    rows.filter((r) => isRealMeal(r.name, q.world || 'india') && !(savouryOnly(q.occasions) && SWEET_OR_BAKED.test(r.name)) && !q.seasons.every((x) => seasonMismatch(r.name, x))).forEach((r) => pool.push({
      ...r,
      source_name: creditName(r.source_name),
      capped: !!r.capped,
      make_ahead: r.total_minutes >= WAITING_MINUTES,
      occasions: r.occasions ? r.occasions.split(',') : [],
      seasons: r.seasons ? r.seasons.split(',') : [],
      match: tier.match,
    }));
  }
  // the same dish from two sites ("Dhal Curry") is offered once: the better match, then the higher score
  const rankOf = { exact: 0, any_season: 1, related_occasion: 2, related_any_season: 3, lower_score: 4, lower_score_related: 5 };
  const keep = new Map();
  for (const r of pool) { const k = dishKey(r.name), cur = keep.get(k); if (!cur || rankOf[r.match] < rankOf[cur.match] || (rankOf[r.match] === rankOf[cur.match] && (r.poshan_score ?? 0) > (cur.poshan_score ?? 0))) keep.set(k, r); }
  for (let i = pool.length - 1; i >= 0; i--) if (keep.get(dishKey(pool[i].name)) !== pool[i]) pool.splice(i, 1);
  // what to skip: the recipes on screen (a Shuffle) and the ones this device was shown last time
  const avoid = new Set(q.exclude || []);
  const combo = comboKey(q);
  if (q.vid) for (const id of await lastShown(env, q.vid, combo)) avoid.add(id);
  const results = pickRandom(pool, avoid, q.limit, rng);
  if (q.vid) await recordShown(env, q.vid, combo, results.map((r) => r.id));
  // each shelf is shown in descending Poshan Score order
  const rank = { exact: 0, any_season: 1, related_occasion: 2, related_any_season: 3, lower_score: 4, lower_score_related: 5 };
  results.sort((x, y) => (rank[x.match] - rank[y.match]) || ((y.poshan_score ?? -1) - (x.poshan_score ?? -1)) || (x.id - y.id));
  return {
    query: { age_months: q.age, age_months_all: q.ages, score_band: q.band, score_bands: q.bands, occasion: q.occasion, occasions: q.occasions, season: q.season, seasons: q.seasons, pref: q.pref, prefs: q.prefs, world: q.world || 'india' },
    count: results.length,
    exact_count: results.filter((r) => r.match === 'exact').length,
    pool_size: pool.length,
    coverage_gap: results.length < MIN_RESULTS, // log these: they tell you which recipes to source next
    results,
  };
}

const bandOf = (v) => (v >= 80 ? 'Good' : v >= 50 ? 'OK' : 'Do not use');

// Mayonnaise can be made either way. For a Veg / Jain meal it reads "Eggless mayonnaise"; for Non-veg it stays "Mayonnaise".
export function mayoFor(text) {
  return String(text ?? '').replace(/((?:eggless|egg[- ]free|vegan|veg(?:etarian)?)\s+)?\bmayonnaise\b/gi, (m, pre, offset, whole) => (pre ? m : offset === 0 || /[.!?]\s*$/.test(whole.slice(0, offset)) ? 'Eggless mayonnaise' : 'eggless mayonnaise'));
}

const AGE_GROUP_BAND = { '1-3y': '1-3', '4-6y': '4-6', '7-9y': '7-9', '10-12y': '10-12', '13-15y': '13-15', '16-18y': '16-18', adult: 'adult' };

// Every recipe a parent can see, in brief: the site build makes a page for each one and the Recipes index page lists them.
export async function recipesIndex(env) {
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.name, s.world AS world, r.diet, r.total_minutes, r.poshan_score, s.name AS source_name,
            (SELECT group_concat(occasion) FROM kp_recipe_occasions WHERE recipe_id = r.id) AS occasions
       FROM kp_recipes r JOIN kp_recipe_sources s ON s.id = r.source_id
      WHERE r.review_status IN ${VISIBLE} AND r.score_hidden = 0 AND r.poshan_score IS NOT NULL AND r.total_minutes IS NOT NULL ORDER BY r.id`
  ).all();
  return { total: results.length, items: results.map((r) => ({ id: r.id, name: r.name, world: r.world, diet: r.diet, minutes: r.total_minutes, score: r.poshan_score, by: creditName(r.source_name), occasions: r.occasions ? r.occasions.split(',') : [] })) };
}

export async function recipeDetail(env, id, { pref = '', age = null, band = '', lite = false } = {}) {
  const r = await env.DB.prepare(
    `SELECT r.*, s.name AS source_name, s.rights_status, s.photos_hidden, s.world
       FROM kp_recipes r JOIN kp_recipe_sources s ON s.id = r.source_id
      WHERE r.id = ? AND r.review_status IN ${VISIBLE}`
  ).bind(id).first();
  if (!r) return null;
  const { results: ings } = await env.DB.prepare(
    'SELECT position, raw_text, quantity, unit, name, ingredient_key, is_pantry FROM kp_recipe_ingredients WHERE recipe_id = ? ORDER BY position'
  ).bind(id).all();

  const flex = r.mayo_flex === 1 && (pref === 'veg' || pref === 'jain');
  const fix = (t) => (flex ? mayoFor(t) : t);
  const ingredients = [];
  const cleaned = cleanIngredients(ings);
  for (const i of cleaned) {
    const label = displayName(i.ingredient_key, fix(i.name));
    ingredients.push({
      ...i,
      raw_text: fix(i.raw_text),
      name: fix(i.name),
      is_pantry: !!i.is_pantry,
      default_state: i.is_pantry ? 'at_home' : null, // UI: pantry staples pre-ticked "At home"
      // the store links are Indian apps: recipes from other parts of the world get none
      buy: lite || i.ingredient_key === 'water' || r.world !== 'india' ? [] : await buyLinksFor(env, { key: i.ingredient_key, name: label }),
    });
  }
  // The author's own steps are always the ones shown, set out as points (a long paragraph becomes one point per sentence), credited and
  // linked to the original. Our own wording is used only for a recipe whose author gave no steps at all.
  const authorSteps = (() => { try { return JSON.parse(r.instructions_json || '[]'); } catch { return []; } })();
  const kpSteps = !authorSteps.length && r.kp_steps_status === 'approved' ? JSON.parse(r.kp_steps_json || '[]') : [];
  let detail = {}; try { detail = JSON.parse(r.score_breakdown_json || '{}'); } catch { /* ignore */ }
  // the score for the child's age band (the reference band, 4-6 years, when no age is given)
  const bandId = ALL_BANDS.some((b) => b.id === band) ? band : age != null ? bandForMonths(age).id : REFERENCE_BAND;
  const forBand = detail.bands?.[bandId] || null;
  const scoreValue = forBand ? forBand.total : r.poshan_score;
  const scoreVisible = scoreValue != null && !r.score_hidden;
  return {
    id: r.id,
    name: r.name,
    // Photo of the dish: shown, credited to the source (see `source`), unless the owner switched this site's photos off.
    // (Verbatim steps still need rights_status = granted.)
    image_url: r.photos_hidden ? null : r.image_url,
    // every photo of the dish for the carousel (hero first); switched off together with the hero when the site's photos are hidden
    images: r.photos_hidden ? [] : (() => { try { return JSON.parse(r.images_json || '[]'); } catch { return []; } })(),
    world: r.world,
    description: r.description,
    servings: r.servings,
    total_minutes: r.total_minutes,
    make_ahead: r.total_minutes != null && r.total_minutes >= WAITING_MINUTES,
    diet: r.diet,
    age_min_months: r.age_min_months,
    age_max_months: r.age_max_months,
    // Score parents may see: exact always; estimated only after the owner approved it.
    poshan_score: scoreVisible ? scoreValue : null,
    // the score for every age group (the pages' "at every age" table); a group not yet worked out for this recipe is left out
    scores_by_age: scoreVisible ? Object.fromEntries(Object.entries(AGE_GROUP_BAND).filter(([, b]) => detail.bands?.[b]).map(([k, b]) => [k, detail.bands[b].total])) : null,
    score: scoreVisible ? { value: scoreValue, kind: r.score_status, band: forBand?.tier || bandOf(scoreValue), age_band: bandId, age_band_label: bandById(bandId).label, metrics: forBand?.metrics || null, capped: !!forBand?.capped, basis: detail.per_serving_basis ? `per serving (${detail.per_serving_basis} servings), against the day's reference` : null, inputs: detail.inputs || null, sources: detail.sources || null } : null,
    source: { name: creditName(r.source_name), url: r.source_url, rights_status: r.rights_status },
    kid_note: hasChilli(cleaned) && (age == null || age <= 72) ? KID_CHILLI_NOTE : null,
    // Verbatim method only when the source has granted rights; otherwise the UI links out.
    // KidPoshan's own approved steps always come first; the creator's verbatim steps only with granted rights.
    // one method: when a page gives stovetop and Instant Pot one after the other, the first (stovetop) is kept
    method: authorSteps.length ? toPoints(singleMethod(authorSteps)).map((st) => ({ ...st, text: fix(st.text) })) : kpSteps.length ? singleMethod(kpSteps).map((text) => ({ section: null, text: fix(text) })) : null,
    mayo_note: r.mayo_flex !== 1 ? null : flex ? 'This recipe uses mayonnaise. It is shown with eggless mayonnaise, so it suits a vegetarian meal.' : pref === 'nonveg' ? 'This recipe uses regular mayonnaise.' : 'This recipe uses mayonnaise. Choose eggless mayonnaise for a vegetarian meal.',
    method_by: authorSteps.length ? 'creator' : kpSteps.length ? 'kidposhan' : null,
    method_url: r.source_url,
    ingredients,
    tag_reasons: JSON.parse(r.tag_reasons_json || '{}'),
  };
}

export async function handleRecipesApi(request, env, ctx) {
  const url = new URL(request.url);
  if (url.pathname === '/api/kp/recipes-index') {
    const out = await recipesIndex(env);
    return new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=600', 'access-control-allow-origin': '*' } });
  }
  const m = url.pathname.match(/^\/api\/kp\/recipes\/(\d+)$/);
  if (m) {
    const pref = url.searchParams.get('pref') || '';
    const ageQ = parseInt(url.searchParams.get('age_months'), 10);
    const d = await recipeDetail(env, +m[1], { pref: ['veg', 'jain', 'nonveg'].includes(pref) ? pref : '', age: Number.isFinite(ageQ) ? ageQ : null, band: url.searchParams.get('band') || '', lite: url.searchParams.get('lite') === '1' });
    return d ? json(d) : json({ error: 'Recipe not found' }, 404);
  }
  const q = readParams(url);
  if (q.errors.length) return json({ error: q.errors.join('; ') }, 400);
  const out = await searchRecipes(env, q);
  // Keep the catalogue growing: every filter combination looks for new recipes at most once a day.
  // Runs after the response is sent, so parents never wait for it.
  out.discovery = 'recent';
  if (q.world === 'india' && ctx?.waitUntil && (await shouldDiscover(env, queryKey(q)))) {
    out.discovery = 'started';
    ctx.waitUntil(discoverForQuery(env, q, { publishedCount: out.count }).catch((e) => console.error('discovery', e)));
  }
  return json(out, 200, 'private, no-store');
}
