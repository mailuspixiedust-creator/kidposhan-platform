// One search for the whole site: recipes and products by what a parent types ("Saffola", "ragi dosa").
// Every word must appear in the name (a product's brand and kind of food count too). Recipes need a score and a cooking time, like the menus.

import { listProducts, AGE_BANDS } from './products.js';
import { bandForMonths, SCORE_COLUMN } from './score2.js';
import { isPrepRecipe } from './api.js';
import { creditName, isRealMeal } from './clean.js';

export const tokens = (q) => String(q || '').toLowerCase().replace(/[^a-z0-9ऀ-ॿ\s'&-]/g, ' ').split(/\s+/).map((t) => t.replace(/^['-]+|['-]+$/g, '')).filter((t) => t.length >= 2).slice(0, 5);
const like = (t) => '%' + t.replace(/[%_\\]/g, (c) => '\\' + c) + '%';

const CAP_COL = { '1-3': 'cap_13', '4-6': 'cap_46', '7-9': 'cap_79', '10-12': 'cap_1012' };

// A search that finds nothing is remembered: the best-known foods parents ask for are the ones to score first.
export async function recordMiss(env, term) {
  const t = String(term || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 60);
  if (t.length < 3) return;
  await env.DB.prepare('INSERT INTO kp_search_misses (term, n, last_at) VALUES (?, 1, ?) ON CONFLICT(term) DO UPDATE SET n = n + 1, last_at = excluded.last_at').bind(t, Math.floor(Date.now() / 1000)).run();
}

// age: the child's age in months (when the visitor has chosen one): scores are for that age, and the answer says which
export async function searchAll(env, q, { limit = 6, age = null } = {}) {
  const words = tokens(q);
  const band = bandForMonths(Number.isFinite(age) ? age : 60);
  const ageInfo = Number.isFinite(age) ? (age < 12 ? AGE_BANDS.find((a) => a.id === '6-12m') : AGE_BANDS.find((a) => a.band === band.id && a.id !== '6-12m')) : AGE_BANDS.find((a) => a.id === '4-6y');
  const ageLabel = Number.isFinite(age) && age < 12 ? '6–12 months' : band.label;
  if (!words.length) return { q: String(q || ''), age_label: ageLabel, recipes: [], products: [] };
  const scoreCol = SCORE_COLUMN[band.id] || 'poshan_score', capCol = CAP_COL[band.id] || 'cap_46';
  const where = words.map(() => "LOWER(r.name) LIKE ? ESCAPE '\\'").join(' AND ');
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.name, CASE WHEN s.photos_hidden = 0 THEN r.image_url END AS image_url, r.total_minutes, r.diet, COALESCE(r.${scoreCol}, r.poshan_score) AS score, COALESCE(r.${capCol}, 0) AS capped
       FROM kp_recipes r JOIN kp_recipe_sources s ON s.id = r.source_id
      WHERE r.review_status = 'approved' AND r.score_hidden = 0 AND r.poshan_score IS NOT NULL AND r.total_minutes IS NOT NULL AND ${where}
      ORDER BY COALESCE(r.${scoreCol}, r.poshan_score) DESC, r.id LIMIT 30`
  ).bind(...words.map(like)).all();
  const recipes = results.filter((r) => !isPrepRecipe(r.name)).slice(0, limit).map((r) => ({ ...r, capped: !!r.capped }));
  const all = (await listProducts(env, { age: ageInfo.id, limit: 300 })).items;
  const products = all.filter((p) => { const hay = [p.name, p.brand, p.kind_label, p.category].join(' ').toLowerCase(); return words.every((w) => hay.includes(w)); })
    .slice(0, limit).map((p) => ({ id: p.id, name: p.name, brand: p.brand, image_url: p.image_url, score: p.score, band: p.band, capped: p.capped, category: p.category }));
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
// people the recipes come from. Only real meals that score 58 or more for the age (and are not capped); a random cook and dish each time.
export async function cooksShelf(env, { limit = 8, age = null, occasion = null, prefs = [], rng = Math.random } = {}) {
  const band = bandForMonths(Number.isFinite(age) ? age : 60);
  const scoreCol = SCORE_COLUMN[band.id] || 'poshan_score', capCol = CAP_COL[band.id] || 'cap_46';
  const DIETS_OF = { veg: ['veg', 'jain'], jain: ['jain'], nonveg: ['nonveg', 'egg'] };
  const diets = [...new Set(prefs.flatMap((p) => DIETS_OF[p] || []))];
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.name, CASE WHEN s.photos_hidden = 0 THEN r.image_url END AS image_url, r.total_minutes, COALESCE(r.${scoreCol}, r.poshan_score) AS score, COALESCE(r.${capCol}, 0) AS capped, s.name AS source_name
       FROM kp_recipes r JOIN kp_recipe_sources s ON s.id = r.source_id
      WHERE r.review_status = 'approved' AND r.score_hidden = 0 AND s.world = 'india' AND r.total_minutes IS NOT NULL AND r.image_url IS NOT NULL AND s.photos_hidden = 0
        AND COALESCE(r.${scoreCol}, r.poshan_score) >= 58 AND COALESCE(r.${capCol}, 0) = 0 AND r.age_min_months <= ? AND r.age_max_months >= ?${occasion ? " AND EXISTS (SELECT 1 FROM kp_recipe_occasions o WHERE o.recipe_id = r.id AND o.occasion = ?)" : ''}${diets.length ? ` AND r.diet IN (${diets.map(() => '?').join(',')})` : ''}
      ORDER BY COALESCE(r.${scoreCol}, r.poshan_score) DESC LIMIT 600`
  ).bind(Number.isFinite(age) ? age : 60, Number.isFinite(age) ? age : 60, ...(occasion ? [occasion] : []), ...diets).all();
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
