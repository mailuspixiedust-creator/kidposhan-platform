// Read a pack's nutrition label (and ingredient list) from its product-page images with a vision model, per 100 g.
// The values are PROPOSED: they pre-fill the Packs form next to the image they were read from, and parents only see a
// pack after the owner approves it. Nothing is invented: a value that is not printed stays empty.

import { scorePack } from './ready.js';

export const LABEL_MODELS = ['@cf/mistralai/mistral-small-3.1-24b-instruct', '@cf/meta/llama-4-scout-17b-16e-instruct']; // two independent readers; override with LABEL_MODEL_A / LABEL_MODEL_B vars
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const MAX_IMAGES = 8;

export function packImages(html) {
  const urls = [];
  for (const [, raw] of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data; try { data = JSON.parse(raw.trim()); } catch { continue; }
    const stack = [data];
    while (stack.length) {
      const n = stack.pop();
      if (Array.isArray(n)) { stack.push(...n); continue; }
      if (!n || typeof n !== 'object') continue;
      if (n['@graph']) stack.push(n['@graph']);
      if (String(n['@type'] || '').toLowerCase().includes('product') && n.image) {
        for (const i of [].concat(n.image)) { const u = typeof i === 'string' ? i : i?.url || i?.contentUrl; if (u) urls.push(u); }
      }
    }
  }
  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (og) urls.push(og[1]);
  const seen = new Set(), out = [];
  for (const u of urls) {
    const full = u.replace(/\/image\/\d+\/\d+\//, '/image/1600/1700/').replace(/q=\d+/, 'q=80'); // marketplace CDNs resize via the path; small label digits are misread below ~1600 px
    const key = full.replace(/\?.*$/, '');
    if (!/^https?:/.test(full) || seen.has(key)) continue;
    seen.add(key); out.push(full);
  }
  return out.slice(0, MAX_IMAGES);
}

const toBase64 = (buf) => { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
const num = (v) => { const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : null; };

export const PROMPT = [
  'This is a product photo from a packaged food listing.',
  'If it shows a "Nutrition Facts" / "Nutrition Information" table, copy the numbers EXACTLY as printed, digit by digit. Do no arithmetic.',
  'Reply with ONLY a JSON object:',
  '{"nutrition_found":true|false,"serving_size_g":number|null,"serving_size_text":string|null,',
  '"per_serving":{"protein_g":number|null,"fibre_g":number|null,"sugars_g":number|null,"added_sugars_g":number|null,"saturated_fat_g":number|null,"sodium_mg":number|null,"salt_g":number|null}|null,',
  '"per_100g":{"protein_g":number|null,"fibre_g":number|null,"sugars_g":number|null,"added_sugars_g":number|null,"saturated_fat_g":number|null,"sodium_mg":number|null,"salt_g":number|null}|null,',
  '"ingredients":[strings]|null}.',
  'per_100g is the column headed per 100 g / 100 ml, or null if the table has no such column. per_serving is the column per serving / per portion, or null.',
  'serving_size_g is the serving weight in grams as printed (for "2/3 cup (55g)" it is 55). Use null for anything not printed; never estimate. Numbers only, no units.',
].join(' ');

function parseJson(text) {
  const t = String(text || ''); const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}

export async function readImage(env, imageUrl, model) {
  const res = await fetch(imageUrl, { headers: { 'user-agent': UA, accept: 'image/*' } });
  if (!res.ok) return { error: `image HTTP ${res.status}` };
  const type = (res.headers.get('content-type') || 'image/jpeg').split(';')[0];
  const buf = await res.arrayBuffer();
  if (buf.byteLength > 6_000_000) return { error: 'image too large' };
  const out = await env.AI.run(model, {
    messages: [{ role: 'user', content: [{ type: 'text', text: PROMPT }, { type: 'image_url', image_url: { url: `data:${type};base64,${toBase64(buf)}` } }] }],
    max_tokens: 700, temperature: 0,
  });
  const raw = out?.response ?? out?.result?.response ?? out?.choices?.[0]?.message?.content;
  return { data: raw && typeof raw === 'object' ? raw : parseJson(String(raw)) }; // some models return the parsed object directly
}

// Turn what the model copied into per-100 g label values (scaling done here, not by the model), or explain why not.
export function labelFrom(d) {
  if (!d || !d.nutrition_found) return { ok: false, why: 'no nutrition table in this image' };
  const has = (o) => o && Object.values(o).some((v) => num(v) != null);
  let src, k = 1, how;
  const g = num(d.serving_size_g);
  // Models sometimes invent a per-100 g column by doing the arithmetic themselves, so scaling per-serving values here is preferred.
  if (has(d.per_serving) && g && g > 0) { src = d.per_serving; k = 100 / g; how = `per-serving values scaled by 100/${g} g`; }
  else if (has(d.per_100g)) { src = d.per_100g; how = 'per 100 g column'; }
  else if (has(d.per_serving)) return { ok: false, why: 'label is per serving and the serving size in grams is not printed' };
  else return { ok: false, why: 'nutrition table values not readable' };
  const scale = (v) => { const x = num(v); return x == null ? null : Math.round(x * k * 100) / 100; };
  const label = {
    protein_g: scale(src.protein_g), fibre_g: scale(src.fibre_g), sugars_g: scale(src.sugars_g), added_sugars_g: scale(src.added_sugars_g),
    saturated_fat_g: scale(src.saturated_fat_g), sodium_mg: scale(src.sodium_mg),
  };
  if (label.sodium_mg == null && num(src.salt_g) != null) label.sodium_mg = Math.round(num(src.salt_g) * k * 393); // sodium = 39.3% of salt
  const bad = Object.entries(label).filter(([key, v]) => v != null && (v < 0 || (key !== 'sodium_mg' && v > 100)));
  if (bad.length) return { ok: false, why: `implausible values: ${bad.map(([key]) => key).join(', ')}` };
  if (Object.values(label).filter((v) => v != null).length < 3) return { ok: false, why: 'too few values readable' };
  return { ok: true, how, label, ingredients: Array.isArray(d.ingredients) ? d.ingredients.map((x) => String(x).trim()).filter(Boolean).slice(0, 60) : null };
}

const SWEET = /\b(sugar|jaggery|gur|syrup|honey|dextrose|glucose|fructose|maltose|molasses|invert|sucrose)\b/i;

const agree = (x, y) => Math.abs(x - y) <= Math.max(0.05 * Math.max(Math.abs(x), Math.abs(y)), 0.02);
export function consensus(la, lb) {
  if (!lb || !lb.ok) return { label: la.label, ingredients: la.ingredients, notes: ['only one reader could read this label: check every value against the photo'] };
  const label = {}, differ = [];
  for (const k of Object.keys(la.label)) {
    const x = la.label[k], y = lb.label[k];
    if (x == null && y == null) label[k] = null;
    else if (x != null && y != null && agree(x, y)) label[k] = x;
    else { label[k] = null; differ.push(k); }
  }
  return { label, ingredients: la.ingredients?.length ? la.ingredients : lb.ingredients, notes: differ.length ? [`two readers disagreed on ${differ.join(', ')}: enter ${differ.length > 1 ? 'those' : 'it'} by hand`] : ['two readers agreed on every value'] };
}

// Reads one stored pack. Saves the proposed label + the image it came from; computes the exact score when complete.
export async function readPackLabel(env, id) {
  const p = await env.DB.prepare('SELECT id, product_url, ingredients_json, nutrition_json, label_source FROM kp_ready_products WHERE id = ?').bind(id).first();
  if (!p) return { id, error: 'not found' };
  if (p.label_source === 'owner') return { id, skipped: 'owner already entered the label' };
  const done = (note, extra = '') => env.DB.prepare(`UPDATE kp_ready_products SET label_tried_at = datetime('now'), label_note = ?${extra} WHERE id = ?`);
  let page;
  try {
    const r = await fetch(p.product_url, { headers: { 'user-agent': UA, accept: 'text/html' }, redirect: 'follow' });
    if (!r.ok) { await done().bind(`product page not readable (HTTP ${r.status}); enter the label by hand`, p.id).run(); return { id, note: `page HTTP ${r.status}` }; }
    page = await r.text();
  } catch (e) { await done().bind('product page not readable; enter the label by hand', p.id).run(); return { id, note: 'page fetch failed' }; }
  const images = packImages(page);
  if (!images.length) { await done().bind('no pack images found on the page; enter the label by hand', p.id).run(); return { id, note: 'no images' }; }

  const [modelA, modelB] = [env.LABEL_MODEL_A || LABEL_MODELS[0], env.LABEL_MODEL_B || LABEL_MODELS[1]];
  let found = null, why = 'no nutrition table found in the pack images';
  for (const img of images) {
    let r;
    try { r = await readImage(env, img, modelA); } catch (e) { why = `vision call failed: ${e.message}`; continue; }
    if (r.error) { why = r.error; continue; }
    const la = labelFrom(r.data);
    if (!la.ok) { if (la.why !== 'no nutrition table in this image') why = la.why; continue; }
    // second, independent reading of the same image; a value is kept only where both readers agree
    let lb = null;
    try { const r2 = await readImage(env, img, modelB); lb = r2.error ? null : labelFrom(r2.data); } catch { lb = null; }
    found = { ...consensus(la, lb), img };
    break;
  }
  if (!found) { await done().bind(`${why}; enter the label by hand`, p.id).run(); return { id, note: why }; }

  let ingredients = []; try { ingredients = JSON.parse(p.ingredients_json || '[]'); } catch { /* ignore */ }
  if (!ingredients.length && found.ingredients?.length) ingredients = found.ingredients;
  const label = { ...found.label }; const notes = ['values read from the pack image: check them against the photo', ...(found.notes || [])];
  // "Added sugars" is often not printed. Zero is inferred only when the ingredient list is known and names no sweetener.
  if (label.added_sugars_g == null && ingredients.length) {
    if (!SWEET.test(ingredients.join(', '))) { label.added_sugars_g = 0; notes.push('added sugars set to 0: the ingredient list names no sugar, jaggery, syrup or honey'); }
    else notes.push('added sugars not printed and the ingredients include a sweetener: enter added sugars by hand');
  } else if (label.added_sugars_g == null) notes.push('added sugars not printed and no ingredient list: enter it by hand');
  const sc = scorePack(label, ingredients);
  await env.DB.prepare(
    `UPDATE kp_ready_products SET nutrition_json = ?, ingredients_json = ?, kidposhan_score = ?, score_status = ?, score_breakdown_json = ?,
       label_image_url = ?, label_source = 'pack_image', label_tried_at = datetime('now'), label_note = ? WHERE id = ?`
  ).bind(JSON.stringify(label), JSON.stringify(ingredients), sc.score, sc.status, sc.detail ? JSON.stringify(sc.detail) : null, found.img, notes.join('; '), p.id).run();
  return { id, label, score: sc.score, status: sc.status, image: found.img, notes };
}

// Cron / admin: next packs that have never had a label attempt.
export async function readLabelsPending(env, { limit = 2 } = {}) {
  const { results } = await env.DB.prepare(
    `SELECT id FROM kp_ready_products WHERE label_tried_at IS NULL AND label_source IS NULL AND status IN ('candidate','approved')
      ORDER BY status = 'approved' DESC, id LIMIT ?`
  ).bind(limit).all();
  const out = [];
  for (const r of results) out.push(await readPackLabel(env, r.id));
  return out;
}
