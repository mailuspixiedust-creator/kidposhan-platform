// The Products page: every approved packaged food with an exact Poshan Score (worked out from the label, per 100 g).
// Products come from the same research -> label reading -> approval flow as the ready-to-buy packs, so the page grows by itself
// as new products are found and approved. A product with no readable label has no score and is not listed.
// The score is the version 2 score (score2.js): ten metrics, each 1 to 10, out of 100, worked out for the child's age band.

import { ALL_KINDS, kindByKey, dedupePacks, scorePack, isSpiceProduct } from './ready.js';
import { headlineClaim } from './claims.js';
import { bandForMonths, bandById, REFERENCE_BAND, totalBand } from './score2.js';

// The age buttons. Each maps to a score band (under 12 months uses the 1-3 year reference).
export const AGE_BANDS = [
  { id: '6-12m', label: '6–12 months', band: '1-3', months: 9 }, { id: '1-3y', label: '1–3 years', band: '1-3', months: 24 }, { id: '4-6y', label: '4–6 years', band: '4-6', months: 60 },
  { id: '7-9y', label: '7–9 years', band: '7-9', months: 96 }, { id: '10-12y', label: '10–12 years', band: '10-12', months: 132 },
  { id: '13-15y', label: '13–15 years', band: '13-15', months: 168 }, { id: '16-18y', label: '16–18 years', band: '16-18', months: 204 }, { id: 'adult', label: 'Adults', band: 'adult', months: 300 },
];
// From 10 years the ICMR-NIN table is by sex, and for adults by the kind of work: '13-15y:f' (girls), 'adult:m:mod' (men, moderate work). With no sex the two are averaged.
export function resolveAge(id) {
  const [base, sex, work] = String(id || '').split(':');
  const a = AGE_BANDS.find((x) => x.id === base);
  if (!a) return null;
  if (!['10-12y', '13-15y', '16-18y', 'adult'].includes(a.id) || (sex !== 'm' && sex !== 'f')) return a;
  const w = ['sed', 'mod', 'heavy'].includes(work) ? work : 'sed';
  const band = a.id === 'adult' ? `adult:${sex}:${w}` : `${a.band}:${sex}`;
  return { ...a, id: a.id === 'adult' ? `adult:${sex}:${w}` : `${a.id}:${sex}`, band, label: bandById(band).label };
}
export const isAgeId = (id) => !!resolveAge(id);
export const ageIdForMonths = (m) => (m < 12 ? '6-12m' : m < 48 ? '1-3y' : m < 84 ? '4-6y' : m < 120 ? '7-9y' : m < 156 ? '10-12y' : m < 192 ? '13-15y' : m < 228 ? '16-18y' : 'adult');
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

const ageInfo = (id) => resolveAge(id) || AGE_BANDS.find((a) => a.band === REFERENCE_BAND);

const sameImage = (a, b) => !!a && !!b && String(a).replace(/\?.*$/, '').replace(/\/image\/\d+\/\d+\//, '') === String(b).replace(/\?.*$/, '').replace(/\/image\/\d+\/\d+\//, '');
// Front of the pack and the back (the shot the label was read from). The front is never the same picture as the back.
export function packShots(p) {
  let gallery = []; try { gallery = JSON.parse(p.gallery_json || '[]'); } catch { gallery = []; }
  const back = p.label_image_url || null;
  const front = [p.image_url, ...gallery].find((u) => u && !sameImage(u, back)) || p.image_url || null;
  return { image_url: front, back_image_url: back && !sameImage(front, back) ? back : null };
}

export async function listProducts(env, { age = '', category = '', min = 0, sort = 'score', limit = 60, unchecked = false } = {}) {
  const { results } = await env.DB.prepare(
    `SELECT id, kind, name, brand, pack_size, image_url, label_image_url, gallery_json, retailer, product_url, kidposhan_score, score_status, nutrition_json, ingredients_json, status, data_source
       FROM kp_ready_products WHERE (status = 'approved' OR (? = 1 AND status = 'candidate' AND data_source IN ('openfoodfacts', 'scan'))) AND score_status = 'exact' AND kidposhan_score IS NOT NULL`
  ).bind(unchecked ? 1 : 0).all();
  const a = age ? ageInfo(age) : ageInfo('4-6y');                       // no age chosen: the reference band (4-6 years)
  const all = [];
  for (const p of dedupePacks(results)) {
    const nutrition = JSON.parse(p.nutrition_json || 'null') || {}, ingredients = JSON.parse(p.ingredients_json || '[]'), k = kindByKey(p.kind);
    if (isSpiceProduct(p.name)) continue;                               // spices and masalas are ingredients, not food we score
    if (age && !offeredFor(p.kind, nutrition, ingredients, age)) continue;
    const sc = scorePack(nutrition, ingredients, p.name, p.kind);
    if (sc.status !== 'exact') continue;
    const b = sc.detail.bands[a.band];
    all.push({ id: p.id, kind: p.kind, category: k?.category || 'Other', kind_label: k?.label || p.kind, name: p.name, brand: p.brand, pack_size: p.pack_size,
      ...packShots(p), retailer: p.retailer, url: p.product_url, score: b.total, band: b.tier, age: a.id, capped: b.capped, unchecked: p.status !== 'approved', source: p.data_source || null });
  }
  const categories = {};
  for (const p of all) categories[p.category] = (categories[p.category] || 0) + 1;
  let items = all.filter((p) => (!category || p.category === category) && p.score >= min);
  items.sort(sort === 'name' ? (x, y) => (x.name || '').localeCompare(y.name || '') : (x, y) => (y.score - x.score) || (x.name || '').localeCompare(y.name || ''));
  return {
    total: items.length, in_catalogue: all.length, age: a.id, age_label: a.label,
    categories: Object.entries(categories).sort((x, y) => x[0].localeCompare(y[0])).map(([name, n]) => ({ name, n })),
    items: items.slice(0, Math.min(Math.max(+limit || 60, 1), unchecked ? 3000 : 1000)),
  };
}

// One product with how its score was worked out: the label, then the ten metrics for the chosen age (each 1 to 10).
export async function productDetail(env, id, { age = '' } = {}) {
  const p = await env.DB.prepare(
    `SELECT * FROM kp_ready_products WHERE id = ? AND (status = 'approved' OR (status = 'candidate' AND data_source IN ('openfoodfacts', 'scan'))) AND score_status = 'exact' AND kidposhan_score IS NOT NULL`
  ).bind(id).first();
  return p ? detailFromRow(p, age) : null;
}
export function detailFromRow(p, age = '') {
  if (!p || p.score_status !== 'exact' || p.kidposhan_score == null || isSpiceProduct(p.name)) return null;
  const nutrition = JSON.parse(p.nutrition_json || 'null') || {}, ingredients = JSON.parse(p.ingredients_json || '[]'), k = kindByKey(p.kind);
  const a = age ? ageInfo(age) : ageInfo('4-6y');
  const sc = scorePack(nutrition, ingredients, p.name, p.kind);
  if (sc.status !== 'exact') return null;
  const b = sc.detail.bands[a.band];
  return {
    id: p.id, name: p.name, brand: p.brand, pack_size: p.pack_size, retailer: p.retailer, url: p.product_url, ...packShots(p),
    category: k?.category || 'Other', kind_label: k?.label || p.kind, score: b.total, band: b.tier, capped: b.capped, age: a.id, age_label: a.label, score_band: a.band,
    // under 12 months a product that is not a plain baby-suitable food gets no number: it is simply not for under 1
    scores_by_age: Object.fromEntries(AGE_BANDS.map((x) => [x.id, offeredFor(p.kind, nutrition, ingredients, x.id) ? sc.detail.bands[x.band].total : null])),
    offered_for: agesFor(p.kind, nutrition, ingredients), nutrition_per_100g: nutrition, ingredients, basis: sc.detail.basis,
    metrics: b.metrics, label_source: p.label_source || null, data_source: p.data_source || null, source_url: p.data_source === 'openfoodfacts' ? p.product_url : null, added_sugar_estimated: !!nutrition.added_sugar_estimated, barcode: p.barcode || null, claim: headlineClaim(p.name, ingredients), listed: p.status === 'approved', label_note: p.label_note || null,
  };
}

// Owner: approve every waiting product whose label has been read and scored, in one go.
export async function approveScored(env) {
  const r = await env.DB.prepare("UPDATE kp_ready_products SET status = 'approved', reviewed_at = datetime('now') WHERE status = 'candidate' AND score_status = 'exact' AND kidposhan_score IS NOT NULL").run();
  return { approved: r.meta.changes };
}

export const KIND_CATEGORIES = [...new Set(ALL_KINDS.map((k) => k.category))].sort();
