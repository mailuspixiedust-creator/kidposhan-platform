// Recipe-level Poshan Score (version 2, see score2.js): ten metrics, each 1 to 10, out of 100, worked out for each age band.
// Inputs per serving: protein, fibre, saturated fat, sodium from the recipe page's nutrition block when it has them,
// otherwise estimated from ingredient quantities (nutrients.js). Added sugar always comes from the listed sweeteners.
// Preservatives, additives and hydrogenated fats are read from the ingredient lines. A cooked dish is measured against one meal's share of the day.
//   exact     = all four from the page (+ sweeteners weighed)
//   estimated = any input estimated; shown to parents labelled "estimated" unless the owner hides it (score_hidden)
//   pending   = too many ingredients could not be weighed to score honestly
// poshan_score holds the score for the reference band (4-6 years); score_13 / score_46 / score_79 / score_1012 hold each band's score.
// The source site's own star rating never feeds the score.

import { scoreAllBands, REFERENCE_BAND, SCORE_COLUMN, SCORE_VERSION } from './score2.js';
import { estimateNutrition, servingsFrom } from './nutrients.js';
import { parseIngredientLine } from './normalize.js';

export { SCORE_VERSION };
const MIN_COVERAGE = 0.75; // share of non-pantry ingredient lines that must be weighable

const num = (v) => {
  if (v == null || v === '') return null;
  const m = String(v).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? +m[0] : null;
};
const mgIfGrams = (v) => (/\bmg\b/i.test(String(v)) ? num(v) : num(v) != null ? num(v) * 1000 : null); // sodiumContent: "300 mg" (or grams)

export function pageNutrition(n) {
  if (!n || typeof n !== 'object') return {};
  return {
    protein: num(n.proteinContent), fibre: num(n.fiberContent ?? n.fibreContent),
    satFat: num(n.saturatedFatContent), sodium: n.sodiumContent != null ? mgIfGrams(n.sodiumContent) : null,
  };
}

// Pure: row = { servings, nutrition_json }, ingredients = kp_recipe_ingredients rows.
export function computeRecipeScore(row, ingredients) {
  const servings = servingsFrom(row.servings);
  const est = estimateNutrition(ingredients, servings);
  let page = {};
  try { page = pageNutrition(row.nutrition_json ? JSON.parse(row.nutrition_json) : null); } catch { /* ignore */ }

  if (est.coverage < MIN_COVERAGE) {
    return { status: 'pending', score: null, reason: `only ${Math.round(est.coverage * 100)}% of ingredients could be weighed`, estimate: est };
  }
  const sources = {};
  const pick = (k) => { if (page[k] != null) { sources[k] = 'recipe_data'; return page[k]; } sources[k] = 'estimated'; return est.per_serving[k]; };
  const inputs = {
    basis: 'meal', protein: pick('protein'), fibre: pick('fibre'), satFat: pick('satFat'), sodium: pick('sodium'), addedSugar: est.per_serving.addedSugar,
    ingredients: ingredients.map((i) => i.raw_text).join(', '), topKey: est.top_key,
  };
  sources.addedSugar = 'from_listed_sweeteners';
  const out = scoreAllBands(inputs);
  const exact = ['protein', 'fibre', 'satFat', 'sodium'].every((k) => sources[k] === 'recipe_data');
  return {
    status: exact ? 'exact' : 'estimated', score: out.reference, band: out.bands[REFERENCE_BAND].tier, bands: out.bands,
    detail: { version: SCORE_VERSION, basis: 'meal', reference_band: REFERENCE_BAND, inputs, sources, per_serving_basis: est.servings, coverage: est.coverage,
      assumptions: est.assumptions, unweighed: est.unweighed, bands: out.bands },
  };
}

// Re-parse stored ingredient lines with the current parser (after parser improvements). Raw text is never changed.
export async function reparseIngredients(env, id) {
  const { results } = await env.DB.prepare('SELECT id, raw_text FROM kp_recipe_ingredients WHERE recipe_id = ?').bind(id).all();
  const upd = env.DB.prepare('UPDATE kp_recipe_ingredients SET quantity=?, unit=?, name=?, ingredient_key=?, is_pantry=? WHERE id=?');
  const stmts = results.map((r) => { const p = parseIngredientLine(r.raw_text); return upd.bind(p.quantity, p.unit, p.name, p.ingredient_key, p.is_pantry ? 1 : 0, r.id); });
  if (stmts.length) await env.DB.batch(stmts);
  return stmts.length;
}

// Reads the recipe, scores it, stores the result. An owner's score approval is cleared when the number changes.
export async function scoreRecipe(env, id) {
  const row = await env.DB.prepare('SELECT id, servings, nutrition_json, poshan_score, score_status FROM kp_recipes WHERE id = ?').bind(id).first();
  if (!row) return null;
  const { results: ings } = await env.DB.prepare(
    'SELECT raw_text, quantity, unit, name, ingredient_key, is_pantry FROM kp_recipe_ingredients WHERE recipe_id = ? ORDER BY position'
  ).bind(id).all();
  const r = computeRecipeScore(row, ings);
  const detail = r.status === 'pending' ? { version: SCORE_VERSION, reason: r.reason, unweighed: r.estimate.unweighed, assumptions: r.estimate.assumptions } : r.detail;
  const changed = r.score !== row.poshan_score || r.status !== row.score_status;
  await env.DB.prepare(
    `UPDATE kp_recipes SET poshan_score = ?, score_status = ?, score_breakdown_json = ?, score_13 = ?, score_46 = ?, score_79 = ?, score_1012 = ?${changed ? ', score_approved = 0' : ''} WHERE id = ?`
  ).bind(r.score, r.status, JSON.stringify(detail), ...['1-3', '4-6', '7-9', '10-12'].map((k) => r.bands?.[k]?.total ?? null), id).run();
  return { id, status: r.status, score: r.score };
}

// SQL fragment: the score parents are allowed to see.
export const VISIBLE_SCORE_SQL = "CASE WHEN r.score_hidden = 0 THEN r.poshan_score END";

// SQL fragment for one age band: the score parents are allowed to see for that band (falls back to the reference score).
export const scoreSqlFor = (bandId) => `CASE WHEN r.score_hidden = 0 THEN COALESCE(r.${SCORE_COLUMN[bandId] || 'poshan_score'}, r.poshan_score) END`;
