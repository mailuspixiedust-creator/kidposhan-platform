// GET /api/kp/recipes?age_months=48&season=monsoon&occasion=lunchbox&pref=veg[&limit=12]
// GET /api/kp/recipes/:id
//
// Guarantee: return at least MIN_RESULTS when the catalogue can supply them.
// Diet preference and age safety are HARD filters and are never relaxed.
// Season and occasion are SOFT: relaxed in tiers, and each result says how it matched.

import { buyLinksFor } from '../commerce/buylinks.js';
import { displayName } from './normalize.js';
import { discoverForQuery, shouldDiscover, queryKey } from './live.js';
import { scoreSqlFor } from './score.js';
import { bandForMonths, bandById, REFERENCE_BAND } from './score2.js';

export const MIN_RESULTS = 20;          // every filter combination should offer at least this many recipes
const MAX_LIMIT = 40, POOL = 80;        // POOL: candidates gathered so a repeat search can pick recipes the device has not seen
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

function readParams(url) {
  const p = url.searchParams;
  const age = parseInt(p.get('age_months'), 10);
  const occasion = p.get('occasion');
  const season = p.get('season') || 'all';
  const pref = p.get('pref') || 'veg';
  const limit = Math.min(Math.max(parseInt(p.get('limit'), 10) || MIN_RESULTS, MIN_RESULTS), MAX_LIMIT);
  const vidRaw = p.get('vid') || '';
  const vid = /^[A-Za-z0-9]{16,40}$/.test(vidRaw) ? vidRaw : null;
  const world = p.get('world') || 'india';
  const errors = [];
  if (!Number.isFinite(age) || age < 6 || age > 144) errors.push('age_months must be 6-144');
  if (!OCCASIONS.includes(occasion)) errors.push(`occasion must be one of ${OCCASIONS.join(', ')}`);
  if (!SEASONS.includes(season)) errors.push(`season must be one of ${SEASONS.join(', ')}`);
  if (!DIETS[pref]) errors.push('pref must be veg, jain or nonveg');
  if (!WORLDS.includes(world)) errors.push(`world must be one of ${WORLDS.join(', ')}`);
  return { age, band: bandForMonths(age).id, occasion, season, pref, limit, world, vid, errors };
}

async function queryTier(env, q, tier, excludeIds, take) {
  const args = [];
  const diets = DIETS[q.pref];
  let sql = `
    SELECT r.id, r.name, CASE WHEN s.photos_hidden = 0 THEN r.image_url END AS image_url, r.total_minutes, r.diet, r.mayo_flex, r.age_min_months, r.age_max_months,
           ${scoreSqlFor(q.band)} AS poshan_score, CASE WHEN r.score_hidden = 0 AND r.poshan_score IS NOT NULL THEN r.score_status END AS score_kind, r.completeness, r.source_url, s.name AS source_name, s.region AS source_region,
           (SELECT round(avg(stars), 1) FROM kp_ratings WHERE recipe_id = r.id) AS rating_avg,
           (SELECT count(*) FROM kp_ratings WHERE recipe_id = r.id) AS rating_count,
           (SELECT count(*) FROM kp_ratings WHERE recipe_id = r.id AND stars >= 4) AS liked_count,
           (SELECT group_concat(occasion) FROM kp_recipe_occasions WHERE recipe_id = r.id) AS occasions,
           (SELECT group_concat(season)   FROM kp_recipe_seasons   WHERE recipe_id = r.id) AS seasons
      FROM kp_recipes r JOIN kp_recipe_sources s ON s.id = r.source_id
     WHERE r.review_status IN ${VISIBLE}
       AND (r.diet IN (${diets.map(() => '?').join(',')})${q.pref === 'nonveg' ? ' OR r.mayo_flex = 1' : ''})
       AND r.age_min_months <= ? AND r.age_max_months >= ?
       AND s.world = ?`;
  args.push(...diets, q.age, q.age, q.world || 'india');

  if (tier.season) {
    sql += ` AND EXISTS (SELECT 1 FROM kp_recipe_seasons x WHERE x.recipe_id = r.id AND x.season IN (?, 'all'))`;
    args.push(q.season);
  }
  if (tier.occasions) {
    sql += ` AND EXISTS (SELECT 1 FROM kp_recipe_occasions o WHERE o.recipe_id = r.id AND o.occasion IN (${tier.occasions.map(() => '?').join(',')}))`;
    args.push(...tier.occasions);
  }
  if (excludeIds.length) {
    sql += ` AND r.id NOT IN (${excludeIds.map(() => '?').join(',')})`;
    args.push(...excludeIds);
  }
  // Always Poshan Score descending (unscored last). Only between recipes with the same score does a sharper photo come first.
  // Photo bands: 500px+ sharp, 300px+ ok, the rest (or hidden/unmeasured) last.
  sql += ` ORDER BY (${scoreSqlFor(q.band)}) IS NULL, (${scoreSqlFor(q.band)}) DESC,
           CASE WHEN s.photos_hidden = 0 AND r.image_w >= 500 THEN 0 WHEN s.photos_hidden = 0 AND r.image_w >= 300 THEN 1 ELSE 2 END,
           r.completeness = 'complete' DESC, r.id LIMIT ?`;
  args.push(take);
  const { results } = await env.DB.prepare(sql).bind(...args).all();
  return results;
}

const comboKey = (q) => [q.world || 'india', queryKey(q)].join('|');
async function seenFor(env, vid, combo) {
  const { results } = await env.DB.prepare('SELECT recipe_id, times FROM kp_seen WHERE vid = ? AND combo = ?').bind(vid, combo).all();
  return new Map(results.map((r) => [r.recipe_id, r.times]));
}
async function recordShown(env, vid, combo, ids) {
  if (!ids.length) return;
  const t = Math.floor(Date.now() / 1000);
  const up = env.DB.prepare('INSERT INTO kp_seen (vid, combo, recipe_id, times, last_at) VALUES (?,?,?,1,?) ON CONFLICT(vid, combo, recipe_id) DO UPDATE SET times = times + 1, last_at = excluded.last_at');
  await env.DB.batch(ids.map((id) => up.bind(vid, combo, id, t)));
}
// Pure. pool is in tier order (best first). Unseen recipes first, then the least-seen ones, up to limit.
export function pickFresh(pool, seen, limit) {
  const unseen = pool.filter((r) => !seen.has(r.id));
  const out = unseen.slice(0, limit);
  if (out.length < limit) {
    const idx = new Map(pool.map((r, i) => [r.id, i]));
    const again = pool.filter((r) => seen.has(r.id)).sort((x, y) => (seen.get(x.id) - seen.get(y.id)) || (idx.get(x.id) - idx.get(y.id)));
    out.push(...again.slice(0, limit - out.length));
  }
  return out;
}

export async function searchRecipes(env, q) {
  q = { ...q, band: q.band || bandForMonths(q.age).id };
  const tiers = [
    { match: 'exact',               season: true,  occasions: [q.occasion] },
    { match: 'any_season',          season: false, occasions: [q.occasion] },
    { match: 'related_occasion',    season: true,  occasions: RELATED[q.occasion] },
    { match: 'related_any_season',  season: false, occasions: RELATED[q.occasion] },
  ];
  // Asian and European shelves only show dishes for this meal (exact season, then any season): no filler from other meals.
  const useTiers = (q.world || 'india') === 'india' ? tiers : tiers.slice(0, 2);
  const pool = [];
  for (const tier of useTiers) {
    if (pool.length >= POOL) break;
    const rows = await queryTier(env, q, tier, pool.map((r) => r.id), POOL - pool.length);
    rows.forEach((r) => pool.push({
      ...r,
      occasions: r.occasions ? r.occasions.split(',') : [],
      seasons: r.seasons ? r.seasons.split(',') : [],
      match: tier.match,
    }));
  }
  let results = pool.slice(0, q.limit);
  if (q.vid) {
    // A device that searches the same combination again is shown recipes it has not seen yet; once everything has been seen,
    // the ones it has seen least come back. Each shelf is still in descending Poshan Score order.
    const combo = comboKey(q);
    const seen = await seenFor(env, q.vid, combo);
    results = pickFresh(pool, seen, q.limit);
    await recordShown(env, q.vid, combo, results.map((r) => r.id));
  }
  const rank = { exact: 0, any_season: 1, related_occasion: 2, related_any_season: 3 };
  const idx = new Map(pool.map((r, i) => [r.id, i]));
  results.sort((x, y) => (rank[x.match] - rank[y.match]) || ((y.poshan_score ?? -1) - (x.poshan_score ?? -1)) || (idx.get(x.id) - idx.get(y.id)));
  return {
    query: { age_months: q.age, score_band: q.band, occasion: q.occasion, season: q.season, pref: q.pref, world: q.world || 'india' },
    count: results.length,
    exact_count: results.filter((r) => r.match === 'exact').length,
    coverage_gap: results.length < MIN_RESULTS, // log these: they tell you which recipes to source next
    results,
  };
}

const bandOf = (v) => (v >= 80 ? 'Excellent' : v >= 58 ? 'Good' : v >= 40 ? 'Fair' : 'Occasional');

// Mayonnaise can be made either way. For a Veg / Jain meal it reads "Eggless mayonnaise"; for Non-veg it stays "Mayonnaise".
export function mayoFor(text) {
  return String(text ?? '').replace(/((?:eggless|egg[- ]free|vegan|veg(?:etarian)?)\s+)?\bmayonnaise\b/gi, (m, pre, offset, whole) => (pre ? m : offset === 0 || /[.!?]\s*$/.test(whole.slice(0, offset)) ? 'Eggless mayonnaise' : 'eggless mayonnaise'));
}

export async function recipeDetail(env, id, { pref = '', age = null } = {}) {
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
  for (const i of ings) {
    const label = displayName(i.ingredient_key, fix(i.name));
    ingredients.push({
      ...i,
      raw_text: fix(i.raw_text),
      name: fix(i.name),
      is_pantry: !!i.is_pantry,
      default_state: i.is_pantry ? 'at_home' : null, // UI: pantry staples pre-ticked "At home"
      // the store links are Indian apps: recipes from other parts of the world get none
      buy: i.ingredient_key === 'water' || r.world !== 'india' ? [] : await buyLinksFor(env, { key: i.ingredient_key, name: label }),
    });
  }
  const methodAllowed = r.rights_status === 'granted';
  const kpSteps = r.kp_steps_status === 'approved' ? JSON.parse(r.kp_steps_json || '[]') : [];
  let detail = {}; try { detail = JSON.parse(r.score_breakdown_json || '{}'); } catch { /* ignore */ }
  // the score for the child's age band (the reference band, 4-6 years, when no age is given)
  const bandId = age != null ? bandForMonths(age).id : REFERENCE_BAND;
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
    diet: r.diet,
    age_min_months: r.age_min_months,
    age_max_months: r.age_max_months,
    // Score parents may see: exact always; estimated only after the owner approved it.
    poshan_score: scoreVisible ? scoreValue : null,
    score: scoreVisible ? { value: scoreValue, kind: r.score_status, band: bandOf(scoreValue), age_band: bandId, age_band_label: bandById(bandId).label, metrics: forBand?.metrics || null, capped: !!forBand?.capped, basis: detail.per_serving_basis ? `per serving (${detail.per_serving_basis} servings), against a third of the day` : null, inputs: detail.inputs || null, sources: detail.sources || null } : null,
    source: { name: r.source_name, url: r.source_url, rights_status: r.rights_status },
    // Verbatim method only when the source has granted rights; otherwise the UI links out.
    // KidPoshan's own approved steps always come first; the creator's verbatim steps only with granted rights.
    method: kpSteps.length ? kpSteps.map((text) => ({ section: null, text: fix(text) })) : methodAllowed ? JSON.parse(r.instructions_json || '[]').map((st) => ({ ...st, text: fix(st.text) })) : null,
    mayo_note: r.mayo_flex !== 1 ? null : flex ? 'This recipe uses mayonnaise. It is shown with eggless mayonnaise, so it suits a vegetarian meal.' : pref === 'nonveg' ? 'This recipe uses regular mayonnaise.' : 'This recipe uses mayonnaise. Choose eggless mayonnaise for a vegetarian meal.',
    method_by: kpSteps.length ? 'kidposhan' : methodAllowed ? 'creator' : null,
    method_url: r.source_url,
    ingredients,
    tag_reasons: JSON.parse(r.tag_reasons_json || '{}'),
  };
}

export async function handleRecipesApi(request, env, ctx) {
  const url = new URL(request.url);
  const m = url.pathname.match(/^\/api\/kp\/recipes\/(\d+)$/);
  if (m) {
    const pref = url.searchParams.get('pref') || '';
    const ageQ = parseInt(url.searchParams.get('age_months'), 10);
    const d = await recipeDetail(env, +m[1], { pref: ['veg', 'jain', 'nonveg'].includes(pref) ? pref : '', age: Number.isFinite(ageQ) ? ageQ : null });
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
  return json(out, 200, q.vid ? 'private, no-store' : 'public, max-age=300');
}
