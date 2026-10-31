// One search for the whole site: recipes and products by what a parent types ("Saffola", "ragi dosa").
// Every word must appear in the name (a product's brand and kind of food count too). Recipes need a score and a cooking time, like the menus.

import { listProducts, AGE_BANDS, ageIdForMonths, resolveAge } from './products.js';
import { bandForMonths } from './score2.js';
import { bandScoreSql, capSqlFor } from './score.js';
import { isPrepRecipe } from './api.js';
import { creditName, isRealMeal } from './clean.js';
import { parseQuery, nameHasTaste, MEAL_LABEL } from './taste.js';

export const tokens = (q) => String(q || '').toLowerCase().replace(/[^a-z0-9ऀ-ॿ\s'&-]/g, ' ').split(/\s+/).map((t) => t.replace(/^['-]+|['-]+$/g, '')).filter((t) => t.length >= 2).slice(0, 5);
const like = (t) => '%' + t.replace(/[%_\\]/g, (c) => '\\' + c) + '%';


// A search that finds nothing is remembered: the best-known foods parents ask for are the ones to score first.
export async function recordMiss(env, term) {
  const t = String(term || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 60);
  if (t.length < 3) return;
  await env.DB.prepare('INSERT INTO kp_search_misses (term, n, last_at) VALUES (?, 1, ?) ON CONFLICT(term) DO UPDATE SET n = n + 1, last_at = excluded.last_at').bind(t, Math.floor(Date.now() / 1000)).run();
}

const DIETS_OF = { veg: ['veg', 'jain'], jain: ['jain'], nonveg: ['nonveg', 'egg'], egg: ['egg'] };
const yearsWord = (m) => (m >= 24 && m % 12 === 0 ? `${m / 12} year${m / 12 === 1 ? '' : 's'}` : m < 24 ? `${m} months` : `${(m / 12).toFixed(1)} years`);

// A search in plain words, "tangy meal for 9 year": the taste, the meal, the diet and the age are read out of it and the recipes are found by taste,
// best score for that age first. Whatever is left over ("rice", "dosa") must appear in the recipe's name.
async function smartSearch(env, q, pq, ageMonths, limit) {
  const band = bandForMonths(ageMonths), ageInfo = resolveAge(ageIdForMonths(ageMonths));
  const ageLabel = ageMonths >= 156 || ageMonths < 12 ? ageInfo.label : band.label;
  const scoreE = bandScoreSql(band.id), capE = capSqlFor(band.id);
  const args = [], where = [];
  where.push(`r.age_min_months <= ?`, `r.age_max_months >= ?`); args.push(ageMonths, Math.min(144, ageMonths));
  if (pq.diet) { const d = DIETS_OF[pq.diet] || []; where.push(`r.diet IN (${d.map(() => '?').join(',')})`); args.push(...d); }
  if (pq.meals.length) { where.push(`EXISTS (SELECT 1 FROM kp_recipe_occasions o WHERE o.recipe_id = r.id AND o.occasion IN (${pq.meals.map(() => '?').join(',')}))`); args.push(...pq.meals); }
  let tasteSum = '0';
  if (pq.tastes.length) {
    const ph = pq.tastes.map(() => '?').join(',');
    where.push(`EXISTS (SELECT 1 FROM kp_recipe_tastes t WHERE t.recipe_id = r.id AND t.taste IN (${ph}))`); args.push(...pq.tastes);
    tasteSum = `(SELECT COALESCE(SUM(t.n), 0) FROM kp_recipe_tastes t WHERE t.recipe_id = r.id AND t.taste IN (${ph}))`;
  }
  if (pq.mild) where.push(`NOT EXISTS (SELECT 1 FROM kp_recipe_tastes t WHERE t.recipe_id = r.id AND t.taste = 'spicy')`);
  for (const w of pq.words) { where.push("LOWER(r.name) LIKE ? ESCAPE '\\'"); args.push(like(w)); }
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.name, CASE WHEN s.photos_hidden = 0 THEN r.image_url END AS image_url, r.total_minutes, r.diet, ${scoreE} AS score, ${capE} AS capped, ${tasteSum} AS taste
       FROM kp_recipes r JOIN kp_recipe_sources s ON s.id = r.source_id
      WHERE r.review_status = 'approved' AND r.score_hidden = 0 AND r.poshan_score IS NOT NULL AND r.total_minutes IS NOT NULL AND ${scoreE} >= 50 AND ${where.join(' AND ')}
      ORDER BY taste DESC, ${scoreE} DESC, r.id LIMIT 60`
  ).bind(...bindOrder(pq, args, tasteSum !== '0')).all();
  const wantsMeal = pq.meals.some((m) => m !== 'snack_4pm');
  const recipes = results.filter((r) => !isPrepRecipe(r.name) && (!wantsMeal || isRealMeal(r.name))).slice(0, Math.max(limit, 10)).map((r) => ({ ...r, capped: !!r.capped }));
  // products only for a snack, or for a brand or dish typed alongside ("tangy chips"); a tangy meal has no packs to offer
  let products = [];
  const snacky = pq.meals.includes('snack_4pm') || pq.words.length;
  if (snacky) {
    const all = (await listProducts(env, { age: ageInfo.id, limit: 3000, unchecked: false })).items;
    products = all.filter((p) => {
      const hay = [p.name, p.brand, p.kind_label, p.category].join(' ').toLowerCase();
      if (pq.words.length && !pq.words.every((w) => hay.includes(w))) return false;
      return !pq.tastes.length || pq.tastes.some((t) => nameHasTaste(p.name, t));
    }).slice(0, limit).map((p) => ({ id: p.id, name: p.name, brand: p.brand, image_url: p.image_url, score: p.score, band: p.band, capped: p.capped, category: p.category, unchecked: !!p.unchecked, source: p.source }));
  }
  const bits = [...pq.tastes, ...(pq.mild ? ['mild, not spicy'] : []), pq.meals.length ? (pq.mealWord === 'meal' || pq.meals.length > 2 ? 'meal' : MEAL_LABEL[pq.meals[0]] || pq.mealWord) : 'recipes', ...(pq.diet ? [pq.diet === 'nonveg' ? 'non-veg' : pq.diet] : [])];
  const understood = { tastes: pq.tastes, mild: pq.mild, meals: pq.meals, diet: pq.diet, age_months: ageMonths, age_label: ageLabel, text: `${bits.join(' · ')} for ${yearsWord(ageMonths)} (${ageLabel})`, left_over: pq.words };
  if (!recipes.length && !products.length) await recordMiss(env, String(q || '').toLowerCase());
  return { q: String(q || ''), age_label: ageLabel, understood, recipes, products };
}

// the bind values in the order the query uses them: the taste sum (in the select), then the where clause
function bindOrder(pq, args, hasTaste) { return hasTaste ? [...pq.tastes, ...args] : args; }

// age: the child's age in months (when the visitor has chosen one): scores are for that age, and the answer says which
export async function searchAll(env, q, { limit = 6, age = null } = {}) {
  const pq = parseQuery(q);
  if (pq.smart) {
    const am = pq.ageMonths != null ? pq.ageMonths : Number.isFinite(age) ? age : 60;      // "for 9 year" beats the age chosen on the page
    if (pq.tastes.length || pq.mild || pq.meals.length || pq.diet || pq.ageMonths != null) {
      const out = await smartSearch(env, q, pq, am, limit);
      // an age on its own ("oats for 9 year") with nothing found: fall through to the ordinary name search
      if (out.recipes.length || out.products.length || pq.tastes.length || pq.mild || pq.meals.length) return out;
    }
  }
  const words = tokens(q);
  const band = bandForMonths(Number.isFinite(age) ? age : 60);
  const ageInfo = resolveAge(Number.isFinite(age) ? ageIdForMonths(age) : '4-6y');
  const ageLabel = Number.isFinite(age) && (age < 12 || age >= 156) ? ageInfo.label : band.label;
  if (!words.length) return { q: String(q || ''), age_label: ageLabel, recipes: [], products: [] };
  const scoreE = bandScoreSql(band.id), capE = capSqlFor(band.id);
  const where = words.map(() => "LOWER(r.name) LIKE ? ESCAPE '\\'").join(' AND ');
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.name, CASE WHEN s.photos_hidden = 0 THEN r.image_url END AS image_url, r.total_minutes, r.diet, ${scoreE} AS score, ${capE} AS capped
       FROM kp_recipes r JOIN kp_recipe_sources s ON s.id = r.source_id
      WHERE r.review_status = 'approved' AND r.score_hidden = 0 AND r.poshan_score IS NOT NULL AND r.total_minutes IS NOT NULL AND ${where}
      ORDER BY ${scoreE} DESC, r.id LIMIT 30`
  ).bind(...words.map(like)).all();
  const recipes = results.filter((r) => !isPrepRecipe(r.name)).slice(0, limit).map((r) => ({ ...r, capped: !!r.capped }));
  const all = (await listProducts(env, { age: ageInfo.id, limit: 3000, unchecked: true })).items.sort((x, y) => (x.unchecked === y.unchecked ? 0 : x.unchecked ? 1 : -1));   // checked packs first
  const products = all.filter((p) => { const hay = [p.name, p.brand, p.kind_label, p.category].join(' ').toLowerCase(); return words.every((w) => hay.includes(w)); })
    .slice(0, limit).map((p) => ({ id: p.id, name: p.name, brand: p.brand, image_url: p.image_url, score: p.score, band: p.band, capped: p.capped, category: p.category, unchecked: !!p.unchecked, source: p.source }));
  if (!recipes.length && !products.length) await recordMiss(env, words.join(' '));
  return { q: String(q || ''), age_label: ageLabel, recipes, products };
}

// How much is scored, for the landing page. "Brands paying to be here" is a promise, not a count: it is always 0.
export async function siteStats(env) {
  const p = await env.DB.prepare("SELECT COUNT(*) n FROM kp_ready_products WHERE status = 'approved' AND score_status = 'exact' AND kidposhan_score IS NOT NULL").first();
  const r = await env.DB.prepare("SELECT COUNT(*) n FROM kp_recipes WHERE review_status = 'approved' AND score_hidden = 0 AND poshan_score IS NOT NULL AND total_minutes IS NOT NULL").first();
  return { products: p?.n || 0, recipes: r?.n || 0, brands_paying: 0 };
}

// "From various cooks and cookbooks": one good recipe from each of several different creators, so the home page shows the range of
// people the recipes come from. Only real meals that score 70 or more for the age (and are not capped); a random cook and dish each time.
export async function cooksShelf(env, { limit = 8, age = null, occasion = null, prefs = [], rng = Math.random } = {}) {
  const band = bandForMonths(Number.isFinite(age) ? age : 60);
  const scoreE = bandScoreSql(band.id), capE = capSqlFor(band.id);
  const DIETS_OF = { veg: ['veg', 'jain'], jain: ['jain'], nonveg: ['nonveg', 'egg'] };
  const diets = [...new Set(prefs.flatMap((p) => DIETS_OF[p] || []))];
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.name, CASE WHEN s.photos_hidden = 0 THEN r.image_url END AS image_url, r.total_minutes, ${scoreE} AS score, ${capE} AS capped, s.name AS source_name
       FROM kp_recipes r JOIN kp_recipe_sources s ON s.id = r.source_id
      WHERE r.review_status = 'approved' AND r.score_hidden = 0 AND s.world = 'india' AND r.total_minutes IS NOT NULL AND r.image_url IS NOT NULL AND s.photos_hidden = 0
        AND ${scoreE} >= 70 AND ${capE} = 0 AND r.age_min_months <= ? AND r.age_max_months >= ?${occasion ? " AND EXISTS (SELECT 1 FROM kp_recipe_occasions o WHERE o.recipe_id = r.id AND o.occasion = ?)" : ''}${diets.length ? ` AND r.diet IN (${diets.map(() => '?').join(',')})` : ''}
      ORDER BY ${scoreE} DESC LIMIT 600`
  ).bind(Number.isFinite(age) ? age : 60, Math.min(144, Number.isFinite(age) ? age : 60), ...(occasion ? [occasion] : []), ...diets).all();
  const byCook = new Map();
  for (const r of results) {
    if (!isRealMeal(r.name)) continue;
    const cook = creditName(r.source_name);
    if (!byCook.has(cook)) byCook.set(cook, []);
    byCook.get(cook).push(r);
  }
  const cooks = [...byCook.keys()].sort(() => rng() - 0.5).slice(0, limit);
  return {
    cooks: cooks.map((cook) => {
      const best = byCook.get(cook).slice(0, 3), r = best[Math.floor(rng() * best.length)];
      return { cook, id: r.id, name: r.name, image_url: r.image_url, total_minutes: r.total_minutes, score: r.score, capped: !!r.capped };
    }),
    count_cooks: byCook.size,
  };
}
