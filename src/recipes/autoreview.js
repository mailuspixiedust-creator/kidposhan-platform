// Packs that check out go live by themselves, with their score and photo. A pack only comes to the owner when something looks wrong:
//   1. by rules, straight away: no photo, a kind that does not fit the name, numbers that cannot be right, sugar or salt that contradict the ingredients;
//   2. by looking at the label photo: a vision model reads the photo and, if what it reads disagrees with the stored numbers, the pack is pulled back
//      into the owner's queue with "the photo says X, our data says Y". It runs a pack or two at a time, only when the scanner is not waiting.
import { kindByKey, isSpiceProduct } from './ready.js';
import { kindFor } from './openfood.js';
import { readImage, labelFrom } from './label.js';

// kinds that are close enough that a name pointing at one and a record filed under another is not a mistake
const FAMILIES = [
  ['chips', 'namkeen', 'roasted_snacks', 'popcorn_makhana', 'papad'],
  ['kids_biscuits', 'millet_cookies', 'rusk_toast', 'cake_pastry'],
  ['instant_noodles', 'instant_soup'], ['rolled_oats', 'muesli', 'breakfast_cereal', 'baby_cereal'],
  ['chocolate', 'choco_spread', 'candy_toffee', 'sweets_mithai', 'snack_bars'], ['fruit_juice', 'soft_drink', 'flavoured_milk', 'health_drink', 'drink_mix'],
];
const compatible = (a, b) => a === b || FAMILIES.some((f) => f.includes(a) && f.includes(b));
// names that hint at an ingredient (nuts, milk, sugar) say little about the kind of a processed food: a biscuit called Cashew is still a biscuit
const WEAK_HINTS = new Set(['nuts_seeds', 'plain_milk', 'sweeteners']);
const SUGARY = /\b(sugar|sucrose|glucose|syrup|jaggery|honey|dextrose|fructose|maltose)\b/i;
const SALTY = /\b(salt|namak|sea salt|rock salt|sodium chloride)\b/i;

// Reasons a pack should be looked at by a person. [] = it checks out.
export function flagsFor(p) {
  const out = [];
  let n = {}, ing = [];
  try { n = JSON.parse(p.nutrition_json || 'null') || {}; } catch { n = {}; }
  try { ing = JSON.parse(p.ingredients_json || '[]'); } catch { ing = []; }
  if (!p.image_url) out.push('There is no photo of the pack to show.');
  const g = kindFor([], p.name);
  if (g && p.kind && !WEAK_HINTS.has(g) && !compatible(g, p.kind)) out.push(`The name suggests "${kindByKey(g)?.label || g}" but it is filed as "${kindByKey(p.kind)?.label || p.kind}". The kind sets the serving size and the snack line.`);
  const hi = (k, max, what) => { if (n[k] != null && n[k] > max) out.push(`${what} is ${n[k]} per 100 g, which looks too high.`); };
  hi('fibre_g', 35, 'Fibre'); hi('protein_g', 60, 'Protein'); hi('sugars_g', 90, 'Total sugars'); hi('saturated_fat_g', 60, 'Saturated fat'); hi('sodium_mg', 5000, 'Sodium');
  if (n.added_sugars_g != null && n.sugars_g != null && n.added_sugars_g > n.sugars_g + 0.5) out.push(`Added sugars (${n.added_sugars_g} g) are more than total sugars (${n.sugars_g} g).`);
  if (!n.added_sugar_estimated && n.added_sugars_g === 0 && ing.length && SUGARY.test(String(ing[0]))) out.push('Sugar is the first ingredient but added sugars are 0.');
  if (n.sodium_mg === 0 && ing.some((x) => SALTY.test(String(x)))) out.push('Salt is in the ingredient list but sodium is 0.');
  return out;
}

// Next packs that have never been looked at by the rules. Clean ones go live; spices are turned away; the rest wait with their reasons.
export async function autoReviewPacks(env, { limit = 300 } = {}) {
  const { results } = await env.DB.prepare(
    `SELECT id, kind, name, image_url, nutrition_json, ingredients_json FROM kp_ready_products
      WHERE status = 'candidate' AND score_status = 'exact' AND kidposhan_score IS NOT NULL AND auto_checked_at IS NULL AND reviewed_at IS NULL AND kind_checked_at IS NOT NULL ORDER BY id LIMIT ?`
  ).bind(limit).all();
  const stats = { looked: results.length, approved: 0, flagged: 0, spice: 0 };
  const up = [];
  for (const p of results) {
    if (isSpiceProduct(p.name)) { up.push(env.DB.prepare(`UPDATE kp_ready_products SET status = 'rejected', auto_checked_at = datetime('now'), reviewed_at = datetime('now') WHERE id = ?`).bind(p.id)); stats.spice++; continue; }
    const flags = flagsFor(p);
    if (flags.length) { up.push(env.DB.prepare(`UPDATE kp_ready_products SET review_flags = ?, auto_checked_at = datetime('now') WHERE id = ?`).bind(JSON.stringify(flags), p.id)); stats.flagged++; }
    else { up.push(env.DB.prepare(`UPDATE kp_ready_products SET status = 'approved', auto_approved = 1, review_flags = NULL, auto_checked_at = datetime('now'), reviewed_at = datetime('now') WHERE id = ?`).bind(p.id)); stats.approved++; }
  }
  for (let i = 0; i < up.length; i += 50) await env.DB.batch(up.slice(i, i + 50));
  return stats;
}

const near = (key, x, y) => Math.abs(x - y) <= Math.max(0.15 * Math.max(Math.abs(x), Math.abs(y)), key === 'sodium_mg' ? 30 : 0.6);
const SHOWN = { protein_g: 'protein', fibre_g: 'fibre', sugars_g: 'total sugars', saturated_fat_g: 'saturated fat', sodium_mg: 'sodium' };

// What the label photo says against what we hold. null = the photo could not be read (nothing to compare).
export function comparePhoto(stored, read) {
  const out = [];
  for (const [k, word] of Object.entries(SHOWN)) {
    const x = stored[k], y = read[k];
    if (x == null || y == null) continue;
    if (!near(k, x, y)) out.push(`The photo says ${word} ${y}${k === 'sodium_mg' ? ' mg' : ' g'} per 100 g, our data says ${x}.`);
  }
  return out;
}

// Looks at one auto-approved pack's label photo. A disagreement pulls it back into the owner's queue, highlighted.
export async function photoCheckPack(env, p) {
  let n = {}; try { n = JSON.parse(p.nutrition_json || 'null') || {}; } catch { n = {}; }
  const r = await readImage(env, p.label_image_url, env.LABEL_MODEL_A || '@cf/mistralai/mistral-small-3.1-24b-instruct');
  if (r.error) { await env.DB.prepare(`UPDATE kp_ready_products SET photo_checked_at = datetime('now') WHERE id = ?`).bind(p.id).run(); return { id: p.id, note: r.error }; }
  const la = labelFrom(r.data);
  if (!la.ok) { await env.DB.prepare(`UPDATE kp_ready_products SET photo_checked_at = datetime('now') WHERE id = ?`).bind(p.id).run(); return { id: p.id, note: la.why }; }
  const diffs = comparePhoto(n, la.label);
  if (diffs.length) {
    await env.DB.prepare(`UPDATE kp_ready_products SET status = 'candidate', auto_approved = 0, reviewed_at = NULL, review_flags = ?, photo_checked_at = datetime('now') WHERE id = ?`).bind(JSON.stringify(diffs), p.id).run();
    return { id: p.id, flagged: diffs };
  }
  await env.DB.prepare(`UPDATE kp_ready_products SET photo_checked_at = datetime('now') WHERE id = ?`).bind(p.id).run();
  return { id: p.id, agreed: true };
}

// Cron: a few packs a run, and none while a scanned pack is waiting for the label reader (the scanner has first call on the AI allowance).
export async function photoCheckPending(env, { limit = 1 } = {}) {
  const waiting = await env.DB.prepare(`SELECT COUNT(*) AS n FROM kp_ready_products WHERE data_source = 'scan' AND score_status != 'exact' AND found_at > datetime('now','-3 days')`).first();
  if (waiting?.n) return { skipped: 'scanner is waiting' };
  const { results } = await env.DB.prepare(
    `SELECT id, nutrition_json, label_image_url FROM kp_ready_products
      WHERE status = 'approved' AND auto_approved = 1 AND photo_checked_at IS NULL AND label_image_url IS NOT NULL ORDER BY id LIMIT ?`
  ).bind(limit).all();
  const out = [];
  for (const p of results) {
    try { out.push(await photoCheckPack(env, p)); } catch (e) { out.push({ id: p.id, stopped: String(e.message || e).slice(0, 80) }); break; }   // out of AI allowance: try again later
  }
  return out;
}
