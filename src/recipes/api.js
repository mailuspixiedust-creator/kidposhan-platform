// GET /api/kp/recipes?age_months=48&season=monsoon&occasion=lunchbox&pref=veg[&limit=12]
// GET /api/kp/recipes/:id
//
// Guarantee: return at least MIN_RESULTS when the catalogue can supply them.
// Diet preference and age safety are HARD filters and are never relaxed.
// Season and occasion are SOFT: relaxed in tiers, and each result says how it matched.

import { buyLinksFor } from '../commerce/buylinks.js';
import { displayName } from './normalize.js';
import { discoverForQuery, shouldDiscover, queryKey } from './live.js';
import { VISIBLE_SCORE_SQL } from './score.js';

export const MIN_RESULTS = 10;
const OCCASIONS = ['breakfast', 'lunchbox', 'lunch', 'snack_4pm', 'dinner'];
const SEASONS = ['summer', 'monsoon', 'winter', 'all'];
const RELATED = {
  breakfast: ['snack_4pm', 'dinner'], lunchbox: ['lunch', 'snack_4pm'], lunch: ['lunchbox', 'dinner'],
  snack_4pm: ['breakfast', 'lunchbox'], dinner: ['lunch', 'breakfast'],
};
const DIETS = { veg: ['veg', 'jain'], jain: ['jain'], nonveg: ['nonveg', 'egg'] };
// Parents only ever see recipes the owner has published in the review screen.
const VISIBLE = "('approved')";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300', 'access-control-allow-origin': '*' },
  });

function readParams(url) {
  const p = url.searchParams;
  const age = parseInt(p.get('age_months'), 10);
  const occasion = p.get('occasion');
  const season = p.get('season') || 'all';
  const pref = p.get('pref') || 'veg';
  const limit = Math.min(Math.max(parseInt(p.get('limit'), 10) || 12, MIN_RESULTS), 30);
  const errors = [];
  if (!Number.isFinite(age) || age < 6 || age > 144) errors.push('age_months must be 6-144');
  if (!OCCASIONS.includes(occasion)) errors.push(`occasion must be one of ${OCCASIONS.join(', ')}`);
  if (!SEASONS.includes(season)) errors.push(`season must be one of ${SEASONS.join(', ')}`);
  if (!DIETS[pref]) errors.push('pref must be veg, jain or nonveg');
  return { age, occasion, season, pref, limit, errors };
}

async function queryTier(env, q, tier, excludeIds, take) {
  const args = [];
  const diets = DIETS[q.pref];
  let sql = `
    SELECT r.id, r.name, CASE WHEN s.photos_hidden = 0 THEN r.image_url END AS image_url, r.total_minutes, r.diet, r.age_min_months, r.age_max_months,
           ${VISIBLE_SCORE_SQL} AS poshan_score, CASE WHEN r.score_hidden = 0 AND r.poshan_score IS NOT NULL THEN r.score_status END AS score_kind, r.completeness, r.source_url, s.name AS source_name, s.region AS source_region,
           (SELECT group_concat(occasion) FROM kp_recipe_occasions WHERE recipe_id = r.id) AS occasions,
           (SELECT group_concat(season)   FROM kp_recipe_seasons   WHERE recipe_id = r.id) AS seasons
      FROM kp_recipes r JOIN kp_recipe_sources s ON s.id = r.source_id
     WHERE r.review_status IN ${VISIBLE}
       AND (r.diet IN (${diets.map(() => '?').join(',')})${q.pref === 'nonveg' ? ' OR r.mayo_flex = 1' : ''})
       AND r.age_min_months <= ? AND r.age_max_months >= ?`;
  args.push(...diets, q.age, q.age);

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
  // Registry rule: final order is Poshan Score descending. Unscored recipes go last.
  sql += ` ORDER BY (${VISIBLE_SCORE_SQL}) IS NULL, (${VISIBLE_SCORE_SQL}) DESC, r.completeness = 'complete' DESC, r.id LIMIT ?`;
  args.push(take);
  const { results } = await env.DB.prepare(sql).bind(...args).all();
  return results;
}

export async function searchRecipes(env, q) {
  const tiers = [
    { match: 'exact',               season: true,  occasions: [q.occasion] },
    { match: 'any_season',          season: false, occasions: [q.occasion] },
    { match: 'related_occasion',    season: true,  occasions: RELATED[q.occasion] },
    { match: 'related_any_season',  season: false, occasions: RELATED[q.occasion] },
  ];
  const results = [];
  for (const tier of tiers) {
    if (results.length >= q.limit) break;
    const rows = await queryTier(env, q, tier, results.map((r) => r.id), q.limit - results.length);
    rows.forEach((r) => results.push({
      ...r,
      occasions: r.occasions ? r.occasions.split(',') : [],
      seasons: r.seasons ? r.seasons.split(',') : [],
      match: tier.match,
    }));
  }
  return {
    query: { age_months: q.age, occasion: q.occasion, season: q.season, pref: q.pref },
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

export async function recipeDetail(env, id, { pref = '' } = {}) {
  const r = await env.DB.prepare(
    `SELECT r.*, s.name AS source_name, s.rights_status, s.photos_hidden
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
      buy: i.ingredient_key === 'water' ? [] : await buyLinksFor(env, { key: i.ingredient_key, name: label }),
    });
  }
  const methodAllowed = r.rights_status === 'granted';
  const kpSteps = r.kp_steps_status === 'approved' ? JSON.parse(r.kp_steps_json || '[]') : [];
  const scoreVisible = r.poshan_score != null && !r.score_hidden;
  let detail = {}; try { detail = JSON.parse(r.score_breakdown_json || '{}'); } catch { /* ignore */ }
  return {
    id: r.id,
    name: r.name,
    // Photo of the dish: shown, credited to the source (see `source`), unless the owner switched this site's photos off.
    // (Verbatim steps still need rights_status = granted.)
    image_url: r.photos_hidden ? null : r.image_url,
    // every photo of the dish for the carousel (hero first); switched off together with the hero when the site's photos are hidden
    images: r.photos_hidden ? [] : (() => { try { return JSON.parse(r.images_json || '[]'); } catch { return []; } })(),
    description: r.description,
    servings: r.servings,
    total_minutes: r.total_minutes,
    diet: r.diet,
    age_min_months: r.age_min_months,
    age_max_months: r.age_max_months,
    // Score parents may see: exact always; estimated only after the owner approved it.
    poshan_score: scoreVisible ? r.poshan_score : null,
    score: scoreVisible ? { value: r.poshan_score, kind: r.score_status, band: bandOf(r.poshan_score), basis: detail.per_serving_basis ? `per serving (${detail.per_serving_basis} servings)` : null, inputs: detail.inputs || null, sources: detail.sources || null } : null,
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
    const d = await recipeDetail(env, +m[1], { pref: ['veg', 'jain', 'nonveg'].includes(pref) ? pref : '' });
    return d ? json(d) : json({ error: 'Recipe not found' }, 404);
  }
  const q = readParams(url);
  if (q.errors.length) return json({ error: q.errors.join('; ') }, 400);
  const out = await searchRecipes(env, q);
  // Keep the catalogue growing: every filter combination looks for new recipes at most once a day.
  // Runs after the response is sent, so parents never wait for it.
  out.discovery = 'recent';
  if (ctx?.waitUntil && (await shouldDiscover(env, queryKey(q)))) {
    out.discovery = 'started';
    ctx.waitUntil(discoverForQuery(env, q, { publishedCount: out.count }).catch((e) => console.error('discovery', e)));
  }
  return json(out);
}
