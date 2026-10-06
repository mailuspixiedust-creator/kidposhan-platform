// Ready-to-buy packs for a dish: the dish itself in pack form (ragi dosa -> ragi dosa MIX, not ragi flour).
// Flow: research a kind with the existing product research -> candidates wait in the Packs tab -> the owner types the
// label (per 100 g) and approves -> parents see approved packs on matching recipe pages.
// The Poshan Score of a pack is exact-only: it needs a label the owner entered; otherwise "pending".

import { researchProducts } from '../product-intelligence.js';
import { calculatePoshanScore } from '../poshan-score.js';

// order matters: the first kind whose `dish` pattern matches the recipe name wins (specific before general).
export const READY_KINDS = [
  { kind: 'ragi_dosa_mix', label: 'Ragi dosa mix', query: 'ragi dosa mix instant', dish: /ragi.*(dosa|dosai|adai)|(dosa|dosai).*ragi/i, product: /ragi.*(dosa|dosai)|(dosa|dosai).*ragi/i },
  { kind: 'dosa_batter', label: 'Idli / dosa batter', query: 'idli dosa batter ready to use', dish: /idli.*dosa.*batter|dosa.*batter/i, product: /batter/i },
  { kind: 'dosa_mix', label: 'Instant dosa mix', query: 'instant dosa mix', dish: /dosa|dosai|uttapam|uthappam/i, product: /dosa|dosai|uttapam/i },
  { kind: 'idli_mix', label: 'Instant idli mix', query: 'instant idli mix', dish: /idli|idly/i, product: /idli|idly/i },
  { kind: 'upma_mix', label: 'Instant upma mix', query: 'instant upma mix', dish: /upma|uppittu/i, product: /upma/i },
  { kind: 'poha_mix', label: 'Ready poha mix', query: 'ready to cook poha mix', dish: /poha|pohe/i, product: /poha/i },
  { kind: 'khichdi_mix', label: 'Khichdi / pongal mix', query: 'khichdi pongal ready to cook mix', dish: /khichdi|khichuri|pongal/i, product: /khichdi|pongal/i },
  { kind: 'sambar_mix', label: 'Instant sambar mix', query: 'instant sambar mix', dish: /sambar|sambhar/i, product: /sambar|sambhar/i },
  { kind: 'rasam_mix', label: 'Instant rasam mix', query: 'instant rasam mix', dish: /rasam/i, product: /rasam/i },
  { kind: 'dhokla_mix', label: 'Instant dhokla mix', query: 'instant dhokla mix', dish: /dhokla|khaman/i, product: /dhokla|khaman/i },
  { kind: 'chilla_mix', label: 'Chilla mix', query: 'besan oats chilla mix', dish: /chilla|cheela|pudla/i, product: /chilla|cheela|pudla/i },
  { kind: 'pancake_mix', label: 'Pancake mix', query: 'whole wheat millet pancake mix', dish: /pancake/i, product: /pancake/i },
  { kind: 'cake_mix', label: 'Healthy cake mix', query: 'millet whole wheat cake mix no maida', dish: /cupcake|brownie|muffin|\bcake\b/i, product: /cake|brownie|muffin/i },
  { kind: 'millet_pasta', label: 'Millet / whole wheat pasta', query: 'millet whole wheat pasta', dish: /pasta|macaroni/i, product: /pasta|macaroni/i },
  { kind: 'noodles', label: 'Millet noodles', query: 'millet atta noodles', dish: /noodles|hakka/i, product: /noodle/i },
  { kind: 'paratha', label: 'Ready paratha', query: 'whole wheat paratha ready to cook frozen', dish: /paratha|parantha/i, product: /paratha|parantha/i },
  { kind: 'chapati', label: 'Ready chapati / roti', query: 'whole wheat chapati roti ready to cook', dish: /chapati|chapathi|roti|phulka/i, product: /chapati|chapathi|roti|phulka/i },
  { kind: 'khakhra', label: 'Khakhra / thepla', query: 'khakhra thepla whole wheat', dish: /khakhra|thepla/i, product: /khakhra|thepla/i },
  { kind: 'cutlet', label: 'Veg cutlet / tikki', query: 'frozen veg cutlet tikki', dish: /cutlet|tikki|patty|kebab/i, product: /cutlet|tikki|patty|kebab/i },
  { kind: 'pulao_mix', label: 'Ready pulao / biryani', query: 'veg pulao biryani ready to cook mix', dish: /pulao|pulav|biryani|briyani/i, product: /pulao|pulav|biryani|briyani/i },
  { kind: 'kheer_mix', label: 'Instant kheer / payasam mix', query: 'instant kheer payasam mix', dish: /kheer|payasam|payasa/i, product: /kheer|payasam|payasa/i },
  { kind: 'halwa_mix', label: 'Instant halwa mix', query: 'instant halwa mix', dish: /halwa|sheera|kesari/i, product: /halwa|sheera|kesari/i },
  { kind: 'popcorn_makhana', label: 'Roasted makhana / popcorn', query: 'roasted makhana popcorn snack', dish: /popcorn|makhana/i, product: /popcorn|makhana/i },
];

export const kindByKey = (k) => READY_KINDS.find((x) => x.kind === k) || null;
export const kindForDish = (name) => READY_KINDS.find((k) => k.dish.test(String(name || '').split('|')[0])) || null;

const num = (v) => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : null; };

// Label values per 100 g -> engine inputs. Additives / palm oil / maida / whole grain come from the ingredient list.
export function scorePack(nutrition, ingredients) {
  const n = nutrition || {};
  const need = { protein_g: n.protein_g, fibre_g: n.fibre_g, added_sugars_g: n.added_sugars_g, saturated_fat_g: n.saturated_fat_g, sodium_mg: n.sodium_mg };
  const missing = Object.entries(need).filter(([, v]) => num(v) == null).map(([k]) => k);
  if (missing.length) return { status: 'pending', score: null, missing };
  const text = (Array.isArray(ingredients) ? ingredients.join(', ') : String(ingredients || '')).toLowerCase();
  const first = (Array.isArray(ingredients) ? String(ingredients[0] || '') : text.split(',')[0]).toLowerCase();
  const additiveTokens = new Set((text.match(/\be\d{3}[a-z]?\b|\bins\s?\d{3}\b|preservative|emulsifier|stabili[sz]er|artificial|colou?r|flavou?r|antioxidant|acidity regulator|raising agent|thickener|maltodextrin|sweetener/g) || []));
  const inputs = {
    protein: num(need.protein_g), fibre: num(need.fibre_g), addedSugar: num(need.added_sugars_g), satFat: num(need.saturated_fat_g), sodium: num(need.sodium_mg),
    additives: additiveTokens.size, palmOil: /palm/.test(text), maida: /\bmaida\b|refined (wheat )?flour|all[- ]purpose flour/.test(text),
    wholeGrain: /\b(ragi|finger millet|jowar|bajra|millet|oats|whole wheat|atta|brown rice|multigrain)\b/.test(first), category: '',
  };
  const out = calculatePoshanScore(inputs, 'packaged');
  return { status: 'exact', score: out.finalScore, band: out.band, detail: { profile: 'packaged', basis: 'per 100 g, from the pack label entered by the owner', inputs, additives_found: [...additiveTokens], engine: out.breakdown } };
}

const retailerOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, '').split('.')[0]; } catch { return null; } };

export async function researchKind(env, kindKey) {
  const k = kindByKey(kindKey);
  if (!k) throw new Error('unknown kind');
  const r = await researchProducts(env, { query: k.query });
  let added = 0, kept = 0;
  for (const p of r.products || []) {
    if (!k.product.test(p.name || '')) continue;      // the pack must be the dish itself, not an ingredient or a lookalike
    const url = p.product_url || p.source_urls?.[0];
    if (!url) continue;
    const nutri = p.nutrition || {};
    const label = { protein_g: nutri.protein_g, fibre_g: nutri.fibre_g, sugars_g: nutri.sugars_g, added_sugars_g: nutri.added_sugars_g, saturated_fat_g: nutri.saturated_fat_g, sodium_mg: nutri.sodium_mg };
    const has = Object.values(label).some((v) => num(v) != null);
    const sc = has ? scorePack(label, p.ingredients) : { status: 'pending', score: null };
    const res = await env.DB.prepare(
      `INSERT OR IGNORE INTO kp_ready_products (kind, name, brand, sku, pack_size, product_url, image_url, retailer, ingredients_json, nutrition_json, kidposhan_score, score_status, score_breakdown_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(k.kind, p.name, p.brand || null, p.sku || null, p.pack_size || null, url, p.image_url || null, retailerOf(url),
      JSON.stringify(p.ingredients || []), has ? JSON.stringify(label) : null, sc.score, sc.status, sc.detail ? JSON.stringify(sc.detail) : null).run();
    if (res.meta?.changes) added++; else kept++;
  }
  await env.DB.prepare(
    `INSERT INTO kp_ready_research (kind, last_run_at, found) VALUES (?, datetime('now'), ?)
     ON CONFLICT(kind) DO UPDATE SET last_run_at = datetime('now'), found = excluded.found, runs = runs + 1`
  ).bind(k.kind, added).run();
  return { kind: k.kind, query: k.query, candidates_seen: (r.products || []).length, added, already_known: kept };
}

// Cron: research the kind that has gone longest without a run (never-run kinds first).
// Kinds that match a PUBLISHED recipe come first (a parent can see those pages now); the rest rotate after them.
export async function neededKinds(env) {
  const { results } = await env.DB.prepare("SELECT name FROM kp_recipes WHERE review_status = 'approved'").all();
  return new Set(results.map((r) => kindForDish(r.name)?.kind).filter(Boolean));
}

export async function researchNextKind(env, { onlyNeeded = false } = {}) {
  const { results } = await env.DB.prepare('SELECT kind, last_run_at FROM kp_ready_research').all();
  const last = new Map(results.map((r) => [r.kind, r.last_run_at]));
  const needed = await neededKinds(env);
  const pool = onlyNeeded ? READY_KINDS.filter((k) => needed.has(k.kind) && !last.has(k.kind)) : READY_KINDS;
  if (!pool.length) return { skipped: 'every pack type for your published recipes has already been searched' };
  const next = [...pool].sort((a, b) =>
    (needed.has(b.kind) - needed.has(a.kind)) || String(last.get(a.kind) || '').localeCompare(String(last.get(b.kind) || '')))[0];
  return researchKind(env, next.kind);
}

// ---- parents ----
export async function packsForRecipe(env, recipeId) {
  const r = await env.DB.prepare('SELECT name FROM kp_recipes WHERE id = ?').bind(recipeId).first();
  const k = r && kindForDish(r.name);
  if (!k) return { kind: null, packs: [] };
  const { results } = await env.DB.prepare(
    `SELECT id, name, brand, pack_size, image_url, retailer, product_url, kidposhan_score, score_status
       FROM kp_ready_products WHERE kind = ? AND status = 'approved'
      ORDER BY kidposhan_score IS NULL, kidposhan_score DESC, id LIMIT 8`
  ).bind(k.kind).all();
  const band = (v) => (v >= 80 ? 'Excellent' : v >= 58 ? 'Good' : v >= 40 ? 'Fair' : 'Occasional');
  return {
    kind: k.kind, label: k.label,
    packs: results.map((p) => ({ id: p.id, name: p.name, brand: p.brand, pack_size: p.pack_size, image_url: p.image_url, retailer: p.retailer, url: p.product_url,
      score: p.score_status === 'exact' && p.kidposhan_score != null ? { value: p.kidposhan_score, band: band(p.kidposhan_score) } : null })),
  };
}

// Menu page: approved packs for every dish being shown, one list. A pack that fits several dishes appears once with all of them.
export async function packsForRecipes(env, ids, { limit = 16 } = {}) {
  ids = [...new Set(ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 24);
  if (!ids.length) return { items: [] };
  const { results: recipes } = await env.DB.prepare(`SELECT id, name FROM kp_recipes WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all();
  const dishesByKind = new Map();
  for (const r of recipes) {
    const k = kindForDish(r.name); if (!k) continue;
    if (!dishesByKind.has(k.kind)) dishesByKind.set(k.kind, { label: k.label, dishes: [] });
    dishesByKind.get(k.kind).dishes.push({ id: r.id, name: String(r.name).split('|')[0].replace(/\brecipe\b/ig, '').replace(/\s+/g, ' ').trim() });
  }
  if (!dishesByKind.size) return { items: [] };
  const kinds = [...dishesByKind.keys()];
  const { results: packs } = await env.DB.prepare(
    `SELECT id, kind, name, brand, pack_size, image_url, retailer, product_url, kidposhan_score, score_status FROM kp_ready_products
      WHERE status = 'approved' AND kind IN (${kinds.map(() => '?').join(',')})`
  ).bind(...kinds).all();
  const band = (v) => (v >= 80 ? 'Excellent' : v >= 58 ? 'Good' : v >= 40 ? 'Fair' : 'Occasional');
  const items = packs.map((p) => ({ id: p.id, kind: p.kind, label: dishesByKind.get(p.kind).label, name: p.name, brand: p.brand, pack_size: p.pack_size, image_url: p.image_url,
    retailer: p.retailer, url: p.product_url, for: dishesByKind.get(p.kind).dishes,
    score: p.score_status === 'exact' && p.kidposhan_score != null ? { value: p.kidposhan_score, band: band(p.kidposhan_score) } : null }));
  // best scored first; within a dish type keep the packs together so the carousel reads kind by kind
  items.sort((a, b) => (b.score?.value ?? -1) - (a.score?.value ?? -1) || a.id - b.id);
  return { items: items.slice(0, limit), total: items.length };
}

// ---- owner ----
export async function listPacks(env, { status = 'candidate', limit = 30, offset = 0 } = {}) {
  if (!['candidate', 'approved', 'rejected'].includes(status)) throw new Error('bad status');
  const { results } = await env.DB.prepare(
    'SELECT * FROM kp_ready_products WHERE status = ? ORDER BY found_at DESC, id DESC LIMIT ? OFFSET ?'
  ).bind(status, Math.min(limit, 50), offset).all();
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM kp_ready_products WHERE status = ?').bind(status).first();
  const { results: counts } = await env.DB.prepare('SELECT status, COUNT(*) AS n FROM kp_ready_products GROUP BY status').all();
  return {
    status, total: n, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])), kinds: READY_KINDS.map((k) => ({ kind: k.kind, label: k.label })),
    items: results.map((p) => ({ ...p, kind_label: kindByKey(p.kind)?.label || p.kind,
      ingredients: JSON.parse(p.ingredients_json || '[]'), nutrition: JSON.parse(p.nutrition_json || 'null') || {}, score_detail: JSON.parse(p.score_breakdown_json || 'null'),
      ingredients_json: undefined, nutrition_json: undefined, score_breakdown_json: undefined })),
  };
}

export async function reviewPack(env, id, body) {
  const status = { approve: 'approved', reject: 'rejected', candidate: 'candidate' }[body.action];
  if (!status) throw new Error('action must be approve, reject or candidate');
  const row = await env.DB.prepare('SELECT ingredients_json, nutrition_json FROM kp_ready_products WHERE id = ?').bind(id).first();
  if (!row) throw new Error('pack not found');
  const sets = ["status = ?", "reviewed_at = datetime('now')"], args = [status];
  if (body.kind != null) { if (!kindByKey(body.kind)) throw new Error('unknown kind'); sets.push('kind = ?'); args.push(body.kind); }
  if (body.nutrition && typeof body.nutrition === 'object') {
    const f = ['protein_g', 'fibre_g', 'sugars_g', 'added_sugars_g', 'saturated_fat_g', 'sodium_mg'];
    const label = {};
    for (const key of f) { const v = body.nutrition[key]; if (v === '' || v == null) { label[key] = ''; continue; } const x = num(v); if (x == null || x < 0 || x > 100000) throw new Error(`${key} must be a number`); label[key] = x; }
    const sc = scorePack(label, JSON.parse(row.ingredients_json || '[]'));
    sets.push('nutrition_json = ?', 'kidposhan_score = ?', 'score_status = ?', 'score_breakdown_json = ?', "label_source = 'owner'");
    args.push(JSON.stringify(label), sc.score, sc.status, sc.detail ? JSON.stringify(sc.detail) : null);
  }
  await env.DB.prepare(`UPDATE kp_ready_products SET ${sets.join(', ')} WHERE id = ?`).bind(...args, id).run();
  const out = await env.DB.prepare('SELECT id, status, kidposhan_score, score_status FROM kp_ready_products WHERE id = ?').bind(id).first();
  return out;
}
