// The Products page: every approved packaged food with an exact Poshan Score (worked out from the label, per 100 g).
// Products come from the same research -> label reading -> approval flow as the ready-to-buy packs, so the page grows by itself
// as new products are found and approved. A product with no readable label has no score and is not listed.
// The score is the version 2 score (score2.js): ten metrics, each 1 to 10, out of 100, worked out for the child's age band.

import { ALL_KINDS, kindByKey, dedupePacks, scorePack } from './ready.js';
import { bandForMonths, bandById, REFERENCE_BAND, totalBand } from './score2.js';

// The age buttons. Each maps to a score band (under 12 months uses the 1-3 year reference).
export const AGE_BANDS = [
  { id: '6-12m', label: '6–12 months', band: '1-3', months: 9 }, { id: '1-3y', label: '1–3 years', band: '1-3', months: 24 }, { id: '4-6y', label: '4–6 years', band: '4-6', months: 60 },
  { id: '7-9y', label: '7–9 years', band: '7-9', months: 96 }, { id: '10-12y', label: '10–12 years', band: '10-12', months: 132 },
];
const band = totalBand;
const num = (v) => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : null; };

// Under 12 months only plain foods meant for babies are offered (nearly no added sugar, little salt, no honey, no added salt).
// From 12 months every scored product is listed: the score itself already weighs sugar, salt and fat against the child's age.
export function offeredFor(kind, nutrition, ingredients, ageId) {
  if (ageId !== '6-12m') return true;
  const k = kindByKey(kind), n = nutrition || {};
  const sugar = num(n.added_sugars_g), sodium = num(n.sodium_mg);
  const text = (Array.isArray(ingredients) ? ingredients.join(', ') : String(ingredients || '')).toLowerCase();
  return !!(k?.infantOk && sugar != null && sodium != null && sugar <= 2 && sodium <= 120 && !/\bhoney\b|\bsalt\b/.test(text));
}
// the age buttons a product is offered under (for the age guide in the detail panel)
export const agesFor = (kind, nutrition, ingredients) => AGE_BANDS.filter((a) => offeredFor(kind, nutrition, ingredients, a.id)).map((a) => a.id);

const ageInfo = (id) => AGE_BANDS.find((a) => a.id === id) || AGE_BANDS.find((a) => a.band === REFERENCE_BAND);

const sameImage = (a, b) => !!a && !!b && String(a).replace(/\?.*$/, '').replace(/\/image\/\d+\/\d+\//, '') === String(b).replace(/\?.*$/, '').replace(/\/image\/\d+\/\d+\//, '');
// Front of the pack and the back (the shot the label was read from). The front is never the same picture as the back.
export function packShots(p) {
  let gallery = []; try { gallery = JSON.parse(p.gallery_json || '[]'); } catch { gallery = []; }
  const back = p.label_image_url || null;
  const front = [p.image_url, ...gallery].find((u) => u && !sameImage(u, back)) || p.image_url || null;
  return { image_url: front, back_image_url: back && !sameImage(front, back) ? back : null };
}

export async function listProducts(env, { age = '', category = '', min = 0, sort = 'score', limit = 60 } = {}) {
  const { results } = await env.DB.prepare(
    `SELECT id, kind, name, brand, pack_size, image_url, label_image_url, gallery_json, retailer, product_url, kidposhan_score, score_status, nutrition_json, ingredients_json
       FROM kp_ready_products WHERE status = 'approved' AND score_status = 'exact' AND kidposhan_score IS NOT NULL`
  ).all();
  const a = age ? ageInfo(age) : ageInfo('4-6y');                       // no age chosen: the reference band (4-6 years)
  const all = [];
  for (const p of dedupePacks(results)) {
    const nutrition = JSON.parse(p.nutrition_json || 'null') || {}, ingredients = JSON.parse(p.ingredients_json || '[]'), k = kindByKey(p.kind);
    if (age && !offeredFor(p.kind, nutrition, ingredients, age)) continue;
    const sc = scorePack(nutrition, ingredients, p.name);
    if (sc.status !== 'exact') continue;
    const b = sc.detail.bands[a.band];
    all.push({ id: p.id, kind: p.kind, category: k?.category || 'Other', kind_label: k?.label || p.kind, name: p.name, brand: p.brand, pack_size: p.pack_size,
      ...packShots(p), retailer: p.retailer, url: p.product_url, score: b.total, band: b.tier, age: a.id, capped: b.capped });
  }
  const categories = {};
  for (const p of all) categories[p.category] = (categories[p.category] || 0) + 1;
  let items = all.filter((p) => (!category || p.category === category) && p.score >= min);
  items.sort(sort === 'name' ? (x, y) => (x.name || '').localeCompare(y.name || '') : (x, y) => (y.score - x.score) || (x.name || '').localeCompare(y.name || ''));
  return {
    total: items.length, in_catalogue: all.length, age: a.id, age_label: a.label,
    categories: Object.entries(categories).sort((x, y) => x[0].localeCompare(y[0])).map(([name, n]) => ({ name, n })),
    items: items.slice(0, Math.min(Math.max(+limit || 60, 1), 200)),
  };
}

// One product with how its score was worked out: the label, then the ten metrics for the chosen age (each 1 to 10).
export async function productDetail(env, id, { age = '' } = {}) {
  const p = await env.DB.prepare(
    `SELECT * FROM kp_ready_products WHERE id = ? AND status = 'approved' AND score_status = 'exact' AND kidposhan_score IS NOT NULL`
  ).bind(id).first();
  if (!p) return null;
  const nutrition = JSON.parse(p.nutrition_json || 'null') || {}, ingredients = JSON.parse(p.ingredients_json || '[]'), k = kindByKey(p.kind);
  const a = age ? ageInfo(age) : ageInfo('4-6y');
  const sc = scorePack(nutrition, ingredients, p.name);
  if (sc.status !== 'exact') return null;
  const b = sc.detail.bands[a.band];
  return {
    id: p.id, name: p.name, brand: p.brand, pack_size: p.pack_size, retailer: p.retailer, url: p.product_url, ...packShots(p),
    category: k?.category || 'Other', kind_label: k?.label || p.kind, score: b.total, band: b.tier, capped: b.capped, age: a.id, age_label: a.label, score_band: a.band,
    scores_by_age: Object.fromEntries(AGE_BANDS.map((x) => [x.id, sc.detail.bands[x.band].total])),
    offered_for: agesFor(p.kind, nutrition, ingredients), nutrition_per_100g: nutrition, ingredients, basis: 'per 100 g, from the pack label',
    metrics: b.metrics, label_source: p.label_source || null,
  };
}

// Owner: approve every waiting product whose label has been read and scored, in one go.
export async function approveScored(env) {
  const r = await env.DB.prepare("UPDATE kp_ready_products SET status = 'approved', reviewed_at = datetime('now') WHERE status = 'candidate' AND score_status = 'exact' AND kidposhan_score IS NOT NULL").run();
  return { approved: r.meta.changes };
}

export const KIND_CATEGORIES = [...new Set(ALL_KINDS.map((k) => k.category))].sort();
