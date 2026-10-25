// Import of packaged foods from Open Food Facts (https://world.openfoodfacts.org), a free, open database. Data: Open Database Licence (ODbL);
// photos: CC BY-SA. Both are credited on the Products page. One product = one barcode, so nothing is added twice.
//
// What is taken: brand, name, barcode, the label per 100 g (protein, fibre, sugars, saturated fat, sodium), the ingredient list and photos.
// Every packaged food sold in India is taken (the search asks for products sold in India), imported brands included. A pack whose barcode is not an Indian one (India's start 890) is flagged for the owner to check. A product is imported only when it has a brand, a name and all five label values. It then waits in the Packs tab for the owner's approval
// like every other candidate. Where the label has no "added sugars" line, total sugars stand in and the product says so ("estimated").
// Politeness: one request per run, a named User-Agent, and a stop when the site says "slow down".

import { ALL_KINDS, kindByKey, scorePack, isSpiceProduct } from './ready.js';

const OFF = 'https://world.openfoodfacts.org';
const FIELDS = 'serving_quantity,serving_size,code,product_name,product_name_en,brands,quantity,categories_tags,unique_scans_n,nutriments,ingredients_text,ingredients_text_en,image_front_url,image_nutrition_url,lang';
const PAGE_SIZE = 50;

// The best-known brands first (Open Food Facts brand tags). One request each, three pages at most.
export const OFF_BRANDS = ['maggi', 'bournvita', 'horlicks', 'cerelac', 'kurkure', 'parle', 'britannia', 'kellogg-s', 'nestle', 'amul', 'cadbury', 'tata-soulfull', 'saffola',
  'quaker', 'yoga-bar', 'mtr', 'haldiram-s', 'lay-s', 'sunfeast', 'complan', 'boost', 'pediasure', 'kissan', 'bagrry-s', 'patanjali', 'yippee', 'top-ramen', 'knorr',
  'happilo', 'slurrp-farm', 'early-foods', 'ching-s-secret', 'del-monte', 'dr-oetker-funfoods', 'sofit', 'fun-foods', 'mother-dairy', 'epigamia', 'raw-pressery', 'real'];
// After the brands: the categories parents buy for children, most-scanned first, five pages each.
export const OFF_CATEGORIES = ['breakfast-cereals', 'instant-noodles', 'noodles', 'biscuits', 'snacks', 'chips-and-crisps', 'malted-drinks', 'baby-cereals', 'fruit-juices',
  'peanut-butters', 'chocolate-spreads', 'jams', 'tomato-ketchup', 'breads', 'rusks', 'flavoured-milks', 'yogurts', 'cheeses', 'cereal-bars', 'dried-fruits'];
const BRAND_PAGES = 3, CATEGORY_PAGES = 5;

const num = (v) => { const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
const round2 = (v) => Math.round(v * 100) / 100;
const cleanText = (s, n = 160) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

// Which of our kinds of food a product is, from its categories and name. null = not a kids' food we score (spices, oil, tea, meat...).
export function kindFor(categories = [], name = '') {
  const c = categories.map((x) => String(x).replace(/^[a-z]{2}:/, '')).join(' ').toLowerCase();
  const n = String(name).toLowerCase();
  const both = c + ' ' + n;
  const rules = [
    ['instant_soup', /\bsoups?\b/],
    ['custard_powder', /custard/],
    ['condensed_milk', /condensed/],
    ['ice_cream', /ice-?cream|kulfi|frozen-?dessert/],
    ['dessert_mix', /\bjelly\b|pudding|blancmange|dessert-?mix/],
    ['baby_cereal', /baby|infant|cerelac|toddler.*(cereal|porridge)/],
    ['rusk_toast', /rusk|toast/],
    ['millet_cookies', /millet.*(cookie|biscuit)|ragi.*(cookie|biscuit)/],
    ['kids_biscuits', /biscuit|cookie|cracker/],
    ['health_drink', /malted|malt-?(drink|beverage)|health-? ?drink|bournvita|horlicks|complan|\bboost\b|chocolate-?powder|protein-?powder|pediasure|sofit/],
    ['instant_noodles', /noodle|vermicelli|ramen|pasta/],
    ['muesli', /muesli|granola/],
    ['rolled_oats', /\boats?\b|oatmeal|porridge-?oats/],
    ['breakfast_cereal', /breakfast-?cereal|corn-?flakes|cereal|chocos|flakes|puffs/],
    ['namkeen', /namkeen|bhujia|mixture|sev\b|chivda/],
    ['snack_bars', /cereal-?bar|protein-?bar|energy-?bar|granola-?bar|snack-? ?bars?\b|\bbars?\b(?!-?b-?q)/],
    ['chips', /chips|crisps|kurkure|puffed|nachos|snack/],
    ['choco_spread', /chocolate-?spread|hazelnut-?spread|nutella/],
    ['peanut_butter', /peanut-?butter/],
    ['nut_butter', /(almond|nut|seed)-?butter/],
    ['jam', /\bjams?\b|fruit-?spread|marmalade/],
    ['mayonnaise', /mayonnaise|mayo\b/],
    ['ketchup', /ketchup|tomato-?sauce|sauces?\b/],
    ['whole_wheat_bread', /\bbread|bun\b|pav\b/],
    ['fruit_juice', /juice|nectar/],
    ['flavoured_milk', /flavou?red-?milk|milk-?shake|lassi|milkshake/],
    ['yoghurt', /yogh?urt|curd|dahi/],
    ['cheese', /cheese/],
    ['paneer', /paneer/],
    ['dried_fruit', /dried-?fruit|raisin|dates\b|figs?\b|apricot/],
    ['roasted_snacks', /roasted|makhana|trail-?mix|nuts-?and-?seeds/],
    ['corn_flour', /corn-?flour|cornstarch|corn-?starch|arrowroot/],
    ['milk_powder', /milk-?powder|creamer|whitener/],
    ['sweets_mithai', /mithai|ladoo|laddu|barfi|gulab-?jamun|halwa|jalebi|rasgulla|soan-?papdi|\bpeda\b/],
    ['papad', /papad|fryums?/],
    ['pickle_chutney', /pickle|\bachar\b|chutney/],
    ['dips_dressings', /\bdips?\b|dressing|hummus/],
    ['tomato_puree', /tomato-?(puree|paste)|passata|pasta-?sauce/],
    ['coconut_milk', /coconut-?(milk|cream)/],
    ['soft_drink', /soft-?drink|\bsoda\b|\bcola\b|carbonated|aerated|sparkling/],
    ['drink_mix', /squash|syrup|glucose|electrolyte|\bors\b|drink-?mix|rasna/],
    ['plant_milk', /soy-?milk|almond-?milk|oat-?milk|plant-?based-?milk/],
    ['tofu_soya', /tofu|soya|soy-?chunks|meal-?maker/],
    ['frozen_snacks', /frozen|nuggets|french-?fries|\btikki\b|samosa|spring-?roll/],
    ['ready_meals', /ready-?(to-?eat|meal)|heat-?and-?eat|biryani/],
    ['baby_puree', /baby.*puree|puree.*baby/],
    ['cake_pastry', /\bcakes?\b|muffin|brownie|pastry|cupcake|swiss-?roll/],
    ['semolina', /semolina|\brava\b|\bsuji\b|sooji/],
    ['besan', /besan|gram-?flour|sattu/],
    ['poha_flakes', /poha|rice-?flakes|puffed-?rice|murmura/],
    ['dal_pulses', /\bdal\b|lentil|pulses|chickpea|rajma|\bchana\b|\bmoong\b|\btoor\b|masoor|legume/],
    ['chocolate', /chocolate|cocoa-?bar/],
    ['candy_toffee', /candy|toffee|lollipop|chewing|bubble-?gum|\bmints?\b/],
    ['nuts_seeds', /\bnuts?\b|almond|cashew|walnut|pistachio|peanuts?\b|\bseeds?\b/],
    ['butter', /\bbutter\b/],
    ['plain_milk', /\bmilk\b/],
    ['white_rice', /\brice\b/],
    ['sweeteners', /\bsugar\b|jaggery|\bhoney\b/],
  ];
  // what the pack is called counts first ("Multi Grain Bread" is bread, whatever the database files it under), then its categories
  const WEAK = new Set(['plain_milk', 'white_rice', 'sweeteners', 'butter', 'nuts_seeds', 'candy_toffee', 'chocolate']);   // single words that mean little on their own
  for (const [kind, re] of rules) if (!WEAK.has(kind) && re.test(n) && kindByKey(kind)) return kind;
  for (const [kind, re] of rules) if (re.test(both) && kindByKey(kind)) return kind;
  return null;
}

// "Water, Sugar, Salt (Iodised), Spices [Chilli, Cumin]" -> ["Water", "Sugar", "Salt (Iodised)", "Spices [Chilli, Cumin]"] (commas inside brackets do not split)
export function splitIngredients(text) {
  const t = String(text || '').replace(/_/g, '').replace(/\s+/g, ' ').trim();
  if (!t) return [];
  const out = []; let depth = 0, cur = '';
  for (const ch of t) {
    if ('([{'.includes(ch)) depth++; else if (')]}'.includes(ch)) depth = Math.max(0, depth - 1);
    if ((ch === ',' || ch === ';') && depth === 0) { if (cur.trim()) out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim().replace(/\.$/, ''));
  return out.slice(0, 60);
}

// the serving printed on the pack, in grams or millilitres (5 to 400), if the database has it
const servingG = (p) => { const q = num(p.serving_quantity); return q != null && q >= 5 && q <= 400 ? Math.round(q * 10) / 10 : null; };

// One Open Food Facts product -> what we store, or { skip: 'reason' }.
export function mapProduct(p, forceKind = null) {
  const code = String(p.code || '').replace(/\D/g, '');
  if (code.length < 8) return { skip: 'no barcode' };
  const brand = cleanText(String(p.brands || '').split(',')[0], 60);
  const name = cleanText(p.product_name_en || p.product_name, 140);
  if (!brand || name.length < 3) return { skip: 'no brand or name' };
  const n = p.nutriments || {};
  const protein = num(n.proteins_100g), fibre = num(n.fiber_100g), sugars = num(n.sugars_100g), added = num(n['added-sugars_100g']), sat = num(n['saturated-fat_100g']);
  let sodium = num(n.sodium_100g) != null ? num(n.sodium_100g) * 1000 : (num(n.salt_100g) != null ? num(n.salt_100g) * 400 : null);     // sodium in g -> mg; salt g x 400 = sodium mg
  if ([protein, fibre, sat, sodium].some((v) => v == null) || (added == null && sugars == null)) return { skip: 'label incomplete' };
  if ([protein, fibre, sugars ?? 0, added ?? 0, sat].some((v) => v < 0 || v > 100) || sodium < 0 || sodium > 40000) return { skip: 'values out of range' };
  const kind = isSpiceProduct(name) ? null : forceKind && kindByKey(forceKind) ? forceKind : kindFor(p.categories_tags || [], name);
  if (!kind) return { skip: 'not a kind of food we score' };
  const estimated = added == null;
  const ingredients = splitIngredients(p.ingredients_text_en || p.ingredients_text);
  return {
    code, foreign_barcode: !code.startsWith('890'), kind, brand, name: name.toLowerCase().startsWith(brand.toLowerCase()) ? name : `${brand} ${name}`, pack_size: cleanText(p.quantity, 40) || null,
    image_url: p.image_front_url || null, label_image_url: p.image_nutrition_url || null, popularity: num(p.unique_scans_n) || 0, estimated, ingredients,
    nutrition: { ...(servingG(p) ? { serving_g: servingG(p) } : {}), protein_g: round2(protein), fibre_g: round2(fibre), sugars_g: sugars == null ? undefined : round2(sugars), added_sugars_g: round2(added ?? sugars), saturated_fat_g: round2(sat), sodium_mg: round2(sodium), ...(estimated ? { added_sugar_estimated: true } : {}) },
  };
}

async function fetchPage(env, params, fetchFn = fetch) {
  const u = new URL(OFF + '/api/v2/search');
  u.search = new URLSearchParams({ countries_tags_en: 'india', fields: FIELDS, page_size: String(PAGE_SIZE), sort_by: 'unique_scans_n', ...params }).toString();
  const res = await fetchFn(u, { headers: { 'user-agent': `KidPoshan/1.0 (${env.OFF_CONTACT || 'kidposhan@gmail.com'})`, accept: 'application/json' } });
  if (res.status === 429 || res.status === 503 || res.status === 502) return { slowdown: true };
  if (!res.ok) return { error: `Open Food Facts answered ${res.status}` };
  const text = await res.text();
  try { return { json: JSON.parse(text) }; } catch { return { slowdown: true }; }             // an HTML "temporarily unavailable" page
}

export async function store(env, m) {
  const url = `${OFF}/product/${m.code}`;
  const label = m.nutrition;
  const sc = scorePack(label, m.ingredients, m.name, m.kind);
  const note = (m.foreign_barcode ? 'the barcode is not an Indian one (890): check this is the pack sold in India; ' : '') + (m.estimated ? 'added sugar is not printed in the database: total sugars used (estimate); ' : '') + 'label data from Open Food Facts: check against the pack';
  const r = await env.DB.prepare(
    `INSERT OR IGNORE INTO kp_ready_products (kind, name, brand, pack_size, product_url, image_url, label_image_url, retailer, ingredients_json, nutrition_json, kidposhan_score, score_status,
       score_breakdown_json, status, label_source, label_note, barcode, data_source, popularity)
     VALUES (?,?,?,?,?,?,?,'openfoodfacts',?,?,?,?,?, 'candidate', 'openfoodfacts', ?, ?, 'openfoodfacts', ?)`
  ).bind(m.kind, m.name, m.brand, m.pack_size, url, m.image_url, m.label_image_url, JSON.stringify(m.ingredients), JSON.stringify(label), sc.score, sc.status,
    sc.detail ? JSON.stringify(sc.detail) : null, note, m.code, m.popularity).run();
  return !!r.meta?.changes;
}

// One page of one search. job = { key, params, pages }; the page number is how many times it has run.
export async function importOffJob(env, job, fetchFn = fetch) {
  const row = await env.DB.prepare('SELECT runs FROM kp_ready_research WHERE kind = ?').bind(job.key).first();
  const page = (row?.runs || 0) + 1;
  const got = await fetchPage(env, { ...job.params, page: String(page) }, fetchFn);
  if (got.slowdown) return { key: job.key, slowdown: true };
  if (got.error) return { key: job.key, error: got.error };
  const products = got.json?.products || [];
  const tally = { key: job.key, page, seen: products.length, added: 0, known: 0, skipped: {} };
  for (const p of products) {
    const m = mapProduct(p);
    if (m.skip) { tally.skipped[m.skip] = (tally.skipped[m.skip] || 0) + 1; continue; }
    if (job.match && !job.match.test(`${m.brand} ${m.name}`)) { tally.skipped['another brand'] = (tally.skipped['another brand'] || 0) + 1; continue; }
    if (await store(env, m)) tally.added++; else tally.known++;
  }
  // done with this search when the page was short or the page limit was reached: park it at the limit so it is not picked again
  const finished = products.length < PAGE_SIZE || page >= job.pages;
  await env.DB.prepare(
    `INSERT INTO kp_ready_research (kind, last_run_at, found, runs) VALUES (?, datetime('now'), ?, ?)
     ON CONFLICT(kind) DO UPDATE SET last_run_at = datetime('now'), found = found + excluded.found, runs = ?`
  ).bind(job.key, tally.added, finished ? 999 : page, finished ? 999 : page).run();
  return tally;
}

const brandJob = (b) => ({ key: `off:brand:${b}`, params: { brands_tags: b }, pages: BRAND_PAGES, match: null });
const categoryJob = (c) => ({ key: `off:cat:${c}`, params: { categories_tags_en: c }, pages: CATEGORY_PAGES, match: null });

// Cron: the next search that has not finished (brands first, then categories); one request per run.
export async function importOffNext(env, fetchFn = fetch) {
  const { results } = await env.DB.prepare("SELECT kind, runs FROM kp_ready_research WHERE kind LIKE 'off:%'").all();
  const runs = new Map(results.map((r) => [r.kind, r.runs]));
  const jobs = [...OFF_BRANDS.map(brandJob), ...OFF_CATEGORIES.map(categoryJob)].filter((j) => (runs.get(j.key) || 0) < 999);
  if (!jobs.length) return { skipped: 'every brand and category has been imported' };
  return importOffJob(env, jobs[0], fetchFn);
}

export const offBrandJob = (b) => (OFF_BRANDS.includes(b) ? brandJob(b) : null);

// One product by its barcode (the scanner). Returns { product } | { notfound: true } | { slowdown: true } | { error }.
export async function lookupOff(env, code, fetchFn = fetch) {
  const u = `${OFF}/api/v2/product/${encodeURIComponent(code)}.json?fields=${FIELDS}`;
  let res;
  try { res = await fetchFn(u, { headers: { 'user-agent': `KidPoshan/1.0 (${env.OFF_CONTACT || 'kidposhan@gmail.com'})`, accept: 'application/json' } }); } catch { return { slowdown: true }; }
  if (res.status === 404) return { notfound: true };
  if (res.status === 429 || res.status === 503 || res.status === 502) return { slowdown: true };
  if (!res.ok) return { error: `Open Food Facts answered ${res.status}` };
  let j; try { j = JSON.parse(await res.text()); } catch { return { slowdown: true }; }
  return j?.product && j.status !== 0 ? { product: { ...j.product, code: j.product.code || code } } : { notfound: true };
}
