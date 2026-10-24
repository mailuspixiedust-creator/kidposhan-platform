// The scanner: a parent scans a pack's barcode (or types it). We look it up in our own products, then in Open Food Facts.
// A pack we cannot score is saved with a front and a back photo: the back photo is read for the label (nutrition and ingredients), and
// the pack is scored exactly like every other product. A scanned pack is shown to the parent at once but joins the Products page only
// after the owner approves it. Nothing personal is kept: the scan log holds a one-day hash of the connection, used to limit how many
// a phone can send in an hour.

import { ALL_KINDS, kindByKey, scorePack } from './ready.js';
import { detailFromRow, isAgeId } from './products.js';
import { mapProduct, store, lookupOff } from './openfood.js';
import { readPhotoLabel } from './label.js';
import { cleanEmail, recordContributor } from './beta.js';

export class ScanError extends Error { constructor(m, status = 400) { super(m); this.status = status; } }

const LOOKUPS_PER_HOUR = 60, SUBMITS_PER_HOUR = 8, SUBMITS_PER_DAY = 30;
const MAX_PHOTO_CHARS = 1_700_000;                                  // about 1 MB of image once the phone has shrunk it
const retryAfter = '3 hours';

const cleanText = (s, n) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

// 8, 12, 13 or 14 digits; stored the way Open Food Facts keeps them (13 digits for a 12-digit UPC or a 14-digit GTIN that starts with 0)
export function normalizeCode(raw) {
  let c = String(raw || '').replace(/\D/g, '');
  if (c.length === 12) c = '0' + c;
  else if (c.length === 14 && c.startsWith('0')) c = c.slice(1);
  return [8, 13, 14].includes(c.length) ? c : null;
}

export async function whoHash(request) {
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
  const day = new Date().toISOString().slice(0, 10);
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${ip}|${day}|kp-scan`));
  return [...new Uint8Array(d)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function limit(env, who, kind, perHour, perDay) {
  const h = await env.DB.prepare(`SELECT COUNT(*) n FROM kp_scans WHERE who = ? AND kind = ? AND ts > datetime('now','-1 hour')`).bind(who, kind).first();
  if ((h?.n || 0) >= perHour) throw new ScanError('That is a lot of scans for one hour. Please try again a little later.', 429);
  if (perDay) {
    const d = await env.DB.prepare(`SELECT COUNT(*) n FROM kp_scans WHERE who = ? AND kind = ? AND ts > datetime('now','-1 day')`).bind(who, kind).first();
    if ((d?.n || 0) >= perDay) throw new ScanError('That is the most we can take in one day from one phone. Please come back tomorrow.', 429);
  }
}
const logScan = (env, who, kind, barcode) => env.DB.prepare('INSERT INTO kp_scans (who, kind, barcode) VALUES (?,?,?)').bind(who, kind, barcode).run();

const NOT_SCORED = /(^|[:\s-])(spices?|herbs?|seasonings?|oils?|ghee|teas?|coffees?|meats?|fish|seafood|alcoholic|beers?|wines?|spirits|supplements?|vitamins?|tobacco|pet-foods?)($|[\s-])/;
const FIBRE_FREE = new Set(['flavoured_milk', 'yoghurt', 'cheese', 'paneer', 'fruit_juice', 'mayonnaise', 'ketchup', 'jam']);
const NEEDED = [['protein_g', 'protein'], ['fibre_g', 'fibre'], ['added_sugars_g', 'added sugar'], ['saturated_fat_g', 'saturated fat'], ['sodium_mg', 'sodium']];
// what people call each existing kind, so the search finds it
const KIND_WORDS = {
  instant_noodles: 'maggi ramen yippee top ramen chowmein noodles', kids_biscuits: 'biscuit cookie cracker cream biscuit marie wafer parle bourbon', rusk_toast: 'rusk toast', breakfast_cereal: 'cornflakes corn flakes chocos cereal flakes loops',
  rolled_oats: 'oats oatmeal', muesli: 'muesli granola', chips: 'chips crisps kurkure lays nachos puffs', namkeen: 'namkeen bhujia mixture sev chivda farsan', roasted_snacks: 'roasted chana makhana peanuts trail mix',
  snack_bars: 'bar protein bar energy bar granola bar ladoo', health_drink: 'horlicks bournvita boost complan protein powder malt', fruit_juice: 'juice nectar mango frooti', flavoured_milk: 'milkshake lassi buttermilk chaas flavoured milk',
  yoghurt: 'curd dahi yogurt raita', cheese: 'cheese slice spread cube', paneer: 'paneer cottage cheese', jam: 'jam marmalade fruit spread', ketchup: 'ketchup sauce tomato sauce chilli sauce soya sauce', mayonnaise: 'mayo mayonnaise',
  peanut_butter: 'peanut butter', choco_spread: 'nutella chocolate spread hazelnut', whole_wheat_bread: 'bread bun pav loaf', dried_fruit: 'dates raisins anjeer dry fruits apricot', baby_cereal: 'cerelac baby food infant',
  whole_wheat_atta: 'atta wheat flour chakki', ragi_flour: 'ragi nachni finger millet flour', instant_soup: 'soup knorr maggi soup',
};
const kindList = () => ALL_KINDS.map((k) => ({ kind: k.kind, label: k.label, category: k.category, words: k.words || KIND_WORDS[k.kind] || '' })).sort((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label));

const ageId = (a) => (isAgeId(a) ? a : '');

function found(row, age, extra = {}) {
  const d = detailFromRow(row, ageId(age));
  return d ? { status: 'found', listed: row.status === 'approved', product: d, ...extra } : null;
}

// What to show for a barcode: { status: 'found' | 'waiting' | 'need_photos' | 'not_scored' | 'bad_code' | 'rejected', ... }
export async function scanLookup(env, rawCode, { age = '', who = null, fetchFn = fetch, kind = '', fix = false } = {}) {
  const code = normalizeCode(rawCode);
  if (!code) return { status: 'bad_code', message: 'That does not look like a barcode. Barcodes on packs have 8 or 13 digits.' };
  if (who) { await limit(env, who, 'lookup', LOOKUPS_PER_HOUR, 0); await logScan(env, who, 'lookup', code); }

  const row = await env.DB.prepare('SELECT * FROM kp_ready_products WHERE barcode = ?').bind(code).first();
  if (row) {
    if (row.status === 'rejected') return { status: 'not_scored', barcode: code, message: 'We are not listing this pack.' };
    // the parent says the name on their pack is not the one we hold: they photograph their own pack and it is scored from that
    if (fix && row.status === 'candidate' && ['openfoodfacts', 'scan'].includes(row.data_source)) {
      return { status: 'need_photos', barcode: code, fix: true, prefill: { brand: row.brand || '', name: row.name || '' }, kinds: kindList(), message: `We hold this barcode as "${row.name}", but your pack says something different. Photograph the front and the back of your pack and we will score it from your photos.` };
    }
    const hit = found(row, age);
    if (hit) return hit;
    // sent by a parent, and the label could not be read from the photo (not just the reader being busy): ask for a better back photo
    if (row.data_source === 'scan' && !/busy/i.test(row.label_note || '')) return { status: 'retake', barcode: code, name: row.name, brand: row.brand, message: `We have ${row.name}, but its nutrition table could not be read from the back photo. Please take the back photo again, close enough that the nutrition table fills the picture.` };
    return { status: 'waiting', barcode: code, name: row.name, brand: row.brand, message: 'We have this pack and are reading its label. The score will appear here soon.' };
  }

  const got = await lookupOff(env, code, fetchFn);
  let prefill = {};
  if (got.product) {
    const m = mapProduct(got.product, kindByKey(kind) ? kind : null);
    if (!m.skip) {
      await store(env, m);
      const saved = await env.DB.prepare('SELECT * FROM kp_ready_products WHERE barcode = ?').bind(code).first();
      const hit = saved && found(saved, age);
      if (hit) return { ...hit, source: 'openfoodfacts' };
    } else if (m.skip === 'not a kind of food we score') {
      if (NOT_SCORED.test((got.product.categories_tags || []).join(' ').toLowerCase())) return { status: 'not_scored', barcode: code, message: 'This looks like a food we do not score (for example spices, oils, tea, coffee, meat or supplements).' };
      // the label is complete but we cannot tell which kind of food it is: the parent chooses the closest kind
      return { status: 'choose_kind', barcode: code, kinds: kindList(), prefill: { brand: cleanText(String(got.product.brands || '').split(',')[0], 60), name: cleanText(got.product.product_name_en || got.product.product_name, 120) },
        message: 'We could not tell what kind of food this is. Choose the closest kind and we will score it.' };
    }
    prefill = { brand: cleanText(String(got.product.brands || '').split(',')[0], 60), name: cleanText(got.product.product_name_en || got.product.product_name, 120) };
  }
  return {
    status: 'need_photos', barcode: code, prefill, kinds: kindList(),
    message: got.slowdown ? 'The open food database is busy right now, so please photograph the pack.' : got.product ? 'The open food database has this pack but not its full label, so please photograph the pack.' : 'We have not seen this pack before. Photograph the front and the back and we will score it.',
  };
}

const PHOTO_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;
function photoOf(v, what) {
  const s = String(v || '');
  const m = s.match(PHOTO_RE);
  if (!m) throw new ScanError(`The ${what} photo could not be read. Please take it again.`);
  if (s.length > MAX_PHOTO_CHARS) throw new ScanError(`The ${what} photo is too large. Please take it again.`);
  return { mime: m[1], data: m[2], dataUrl: s };
}

const photoUrl = (origin, id, side) => `${origin}/api/kp/scan/photo/${id}/${side}`;

// Apply a label read from the back photo to a stored pack and score it. Returns the new row.
async function applyLabel(env, id, read) {
  const row = await env.DB.prepare('SELECT * FROM kp_ready_products WHERE id = ?').bind(id).first();
  const label = { ...read.label };
  const notes = [...read.notes];
  if (read.serving_g) { label.serving_g = read.serving_g; notes.push(`serving size ${read.serving_g} g as printed on the pack`); }
  if (label.added_sugars_g == null && label.sugars_g != null) { label.added_sugars_g = label.sugars_g; label.added_sugar_estimated = true; notes.push('added sugar is not printed: total sugars used (estimate)'); }
  // fibre is left off the label of foods that have none (milk, curd, cheese, sauces, juice): taken as 0, and the note says so
  if (label.fibre_g == null && (FIBRE_FREE.has(row.kind) || label.protein_g != null)) { label.fibre_g = 0; notes.push('fibre is not printed: taken as 0 (the stricter reading)'); }
  // saturated fat cannot exceed total fat: a label with almost no total fat and no saturated fat line has none
  if (label.saturated_fat_g == null && read.check && read.check.fat != null && read.check.fat <= 0.5) { label.saturated_fat_g = 0; notes.push('saturated fat is not printed and total fat is under 0.5 g: taken as 0'); }
  const sc = scorePack(label, read.ingredients || [], row.name, row.kind);
  await env.DB.prepare(
    `UPDATE kp_ready_products SET nutrition_json = ?, ingredients_json = ?, kidposhan_score = ?, score_status = ?, score_breakdown_json = ?, label_tried_at = datetime('now'), label_note = ? WHERE id = ?`
  ).bind(JSON.stringify(label), JSON.stringify(read.ingredients || []), sc.score, sc.status, sc.detail ? JSON.stringify(sc.detail) : null, notes.join('; '), id).run();
  return env.DB.prepare('SELECT * FROM kp_ready_products WHERE id = ?').bind(id).first();
}

const missingOf = (row) => { let n = {}; try { n = JSON.parse(row.nutrition_json || '{}'); } catch { /* ignore */ } const m = NEEDED.filter(([k]) => n[k] == null).map(([, l]) => l); return m.length ? m.join(', ') : ''; };

// A parent sends the barcode, the kind of food, the brand and name, and the two photos.
export async function scanSubmit(env, body, { who, origin, age = '' }) {
  const code = normalizeCode(body.barcode);
  if (!code) throw new ScanError('Please scan or type the barcode first.');
  const kind = kindByKey(String(body.kind || ''));
  if (!kind) throw new ScanError('Please choose what kind of food this is.');
  const brand = cleanText(body.brand, 60), name = cleanText(body.name, 120);
  if (brand.length < 2) throw new ScanError('Please type the brand.');
  if (name.length < 3) throw new ScanError('Please type the name of the product.');
  const front = photoOf(body.front, 'front'), back = photoOf(body.back, 'back'), ingr = body.ingredients ? photoOf(body.ingredients, 'ingredients') : null;
  if (body.consent !== true) throw new ScanError('Please tick the box to say these photos are yours to share.');
  const email = cleanEmail(body.email);
  if (who) { await limit(env, who, 'submit', SUBMITS_PER_HOUR, SUBMITS_PER_DAY); await logScan(env, who, 'submit', code); }

  // somebody got here first: show what is stored
  const existing = await env.DB.prepare('SELECT * FROM kp_ready_products WHERE barcode = ?').bind(code).first();
  // a parent whose pack does not match the entry we hold (still unchecked) replaces it with what their photos show
  const fix = !!(body.correct && existing && existing.status === 'candidate' && ['openfoodfacts', 'scan'].includes(existing.data_source));
  if (existing && !fix) return scanLookup(env, code, { age });

  const fullName = name.toLowerCase().startsWith(brand.toLowerCase()) ? name : `${brand} ${name}`;
  let id;
  if (fix) {
    await env.DB.prepare(
      `UPDATE kp_ready_products SET kind = ?, name = ?, brand = ?, product_url = ?, retailer = 'scan', data_source = 'scan', label_source = 'scan_photo', nutrition_json = NULL, ingredients_json = '[]',
         kidposhan_score = NULL, score_status = 'pending', score_breakdown_json = NULL, label_tried_at = NULL, popularity = NULL, pack_size = NULL, label_note = ? WHERE id = ?`
    ).bind(kind.kind, fullName, brand, `https://www.kidposhan.in/scan?code=${code}`, `a parent's photos replaced the earlier entry "${existing.name}": the name on the pack was different; label not read yet`, existing.id).run();
    id = existing.id;
  } else {
    const ins = await env.DB.prepare(
      `INSERT OR IGNORE INTO kp_ready_products (kind, name, brand, product_url, retailer, ingredients_json, nutrition_json, score_status, status, label_source, label_note, barcode, data_source)
       VALUES (?,?,?,?,'scan','[]',NULL,'pending','candidate','scan_photo','sent by a parent with photos; label not read yet',?,'scan')`
    ).bind(kind.kind, fullName, brand, `https://www.kidposhan.in/scan?code=${code}`, code).run();
    if (!ins.meta?.changes) return scanLookup(env, code, { age });
    id = ins.meta.last_row_id;
  }
  await env.DB.prepare('INSERT OR REPLACE INTO kp_scan_photos (product_id, side, mime, data) VALUES (?,?,?,?), (?,?,?,?)')
    .bind(id, 'front', front.mime, front.data, id, 'back', back.mime, back.data).run();
  await recordContributor(env, id, email);
  if (ingr) await env.DB.prepare('INSERT OR REPLACE INTO kp_scan_photos (product_id, side, mime, data) VALUES (?,?,?,?)').bind(id, 'ingredients', ingr.mime, ingr.data).run();
  await env.DB.prepare('UPDATE kp_ready_products SET image_url = ?, label_image_url = ?, label_note = ? WHERE id = ?')
    .bind(photoUrl(origin, id, 'front'), photoUrl(origin, id, 'back'), `sent by a parent with photos; label not read yet${ingr ? `; ingredients photo: ${photoUrl(origin, id, 'ingredients')}` : ''}`, id).run();

  const read = await readPhotoLabel(env, back.dataUrl, ingr ? ingr.dataUrl : null);
  if (!read.ok) {
    const why = read.retry ? 'the label reader was busy; it will be tried again' : read.why;
    await env.DB.prepare(`UPDATE kp_ready_products SET label_tried_at = datetime('now'), label_note = ? WHERE id = ?`).bind(`photos received; ${why}`, id).run();
    return { status: 'saved', barcode: code, retry: !!read.retry, message: read.retry
      ? 'Thank you. Your photos are saved. The label reader is busy today, so the score will be ready within a day. Scan the same barcode again to see it.'
      : `Thank you. Your photos are saved, but the label could not be read from the back photo (${read.why}). Our team will look at it.` };
  }
  const row = await applyLabel(env, id, read);
  const hit = found(row, age);
  return hit ? { ...hit, saved: true } : { status: 'saved', barcode: code, message: `Thank you. Your photos are saved, but ${missingOf(row) || 'some values'} could not be read from the label, so our team will finish the score.` };
}

// A new back photo for a pack we hold but could not read. Only a pack sent by a parent that has no score can be changed.
export async function scanRetake(env, body, { who, origin, age = '' }) {
  const code = normalizeCode(body.barcode);
  if (!code) throw new ScanError('Please scan the barcode first.');
  const back = photoOf(body.back, 'back');
  if (body.consent !== true) throw new ScanError('Please tick the box to say this photo is yours to share.');
  const email = cleanEmail(body.email);
  if (who) { await limit(env, who, 'submit', SUBMITS_PER_HOUR, SUBMITS_PER_DAY); await logScan(env, who, 'submit', code); }
  const row = await env.DB.prepare("SELECT * FROM kp_ready_products WHERE barcode = ? AND data_source = 'scan' AND score_status != 'exact' AND status = 'candidate'").bind(code).first();
  if (!row) return scanLookup(env, code, { age });
  await env.DB.prepare('INSERT OR REPLACE INTO kp_scan_photos (product_id, side, mime, data) VALUES (?,?,?,?)').bind(row.id, 'back', back.mime, back.data).run();
  await recordContributor(env, row.id, email);
  const ig = await env.DB.prepare('SELECT mime, data FROM kp_scan_photos WHERE product_id = ? AND side = ?').bind(row.id, 'ingredients').first();
  const read = await readPhotoLabel(env, back.dataUrl, ig ? `data:${ig.mime};base64,${ig.data}` : null);
  if (!read.ok) {
    const why = read.retry ? 'the label reader was busy; it will be tried again' : read.why;
    await env.DB.prepare(`UPDATE kp_ready_products SET label_tried_at = datetime('now'), label_note = ? WHERE id = ?`).bind(read.retry ? `photos received; ${why}` : `photos received; ${why}; retaken once`, row.id).run();
    return read.retry
      ? { status: 'saved', barcode: code, retry: true, message: 'Thank you. The new photo is saved. The label reader is busy, so the score will be ready within a day. Scan the same barcode again to see it.' }
      : { status: 'retake', barcode: code, name: row.name, brand: row.brand, message: `The nutrition table still could not be read (${read.why}). Please try once more: hold the phone steady, close to the table, in good light.` };
  }
  const updated = await applyLabel(env, row.id, read);
  const hit = found(updated, age);
  return hit ? { ...hit, saved: true } : { status: 'saved', barcode: code, message: `Thank you. The new photo is saved, but ${missingOf(updated) || 'some values'} could not be read from the label, so our team will finish the score.` };
}

// The two photos, for the owner's Packs tab and for the Products page once approved
export async function scanPhoto(env, id, side) {
  if (!['front', 'back', 'ingredients'].includes(side)) return null;
  const r = await env.DB.prepare('SELECT mime, data FROM kp_scan_photos WHERE product_id = ? AND side = ?').bind(id, side).first();
  if (!r) return null;
  const bin = atob(r.data), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Response(bytes, { headers: { 'content-type': r.mime, 'cache-control': 'public, max-age=86400', 'access-control-allow-origin': '*' } });
}

// Cron: a scanned pack whose label could not be read (the reader was busy) is tried again, one a run, for three days.
export async function readScansPending(env, { limit: n = 1 } = {}) {
  const { results } = await env.DB.prepare(
    `SELECT id FROM kp_ready_products WHERE data_source = 'scan' AND score_status != 'exact' AND found_at > datetime('now','-3 days')
        AND (label_tried_at IS NULL OR label_tried_at < datetime('now', ?)) AND (label_note LIKE '%busy%' OR ((label_note LIKE '%disagreed%' OR label_note LIKE 'photos received%') AND label_note NOT LIKE '%second look%')) ORDER BY id LIMIT ?`
  ).bind(`-${retryAfter}`, n).all();
  const out = [];
  for (const { id } of results) {
    const b = await env.DB.prepare('SELECT mime, data FROM kp_scan_photos WHERE product_id = ? AND side = ?').bind(id, 'back').first();
    if (!b) continue;
    const ig = await env.DB.prepare('SELECT mime, data FROM kp_scan_photos WHERE product_id = ? AND side = ?').bind(id, 'ingredients').first();
    const read = await readPhotoLabel(env, `data:${b.mime};base64,${b.data}`, ig ? `data:${ig.mime};base64,${ig.data}` : null);
    if (!read.ok) { await env.DB.prepare(`UPDATE kp_ready_products SET label_tried_at = datetime('now'), label_note = ? WHERE id = ?`).bind(read.retry ? 'photos received; the label reader was busy; it will be tried again' : `photos received; ${read.why}; second look done`, id).run(); out.push({ id, ok: false, why: read.why }); continue; }
    const row = await applyLabel(env, id, read);
    out.push({ id, ok: true, score: row.kidposhan_score, status: row.score_status });
  }
  return out;
}

// housekeeping: the one-day-hash log is not needed after two days
export const pruneScans = (env) => env.DB.prepare(`DELETE FROM kp_scans WHERE ts < datetime('now','-2 days')`).run();
