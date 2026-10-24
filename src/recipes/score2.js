// The Poshan Score, version 4: ten yes/no checks. Each metric is 1 (passes) or 0 (fails); the score is the number passed times 10, so 0 to 100.
// One engine for recipes and packaged products, and the same method the Age & Metrics page shows (it reads methodSpec() below).
//
//   Age:     the score is worked out for the child's age band (1-3, 4-6, 7-9, 10-12 years). Sugar, sodium, saturated fat, fibre and protein
//            are compared with that band's daily reference. Under 12 months there is no published band, so the 1-3 year reference is used.
//   Basis:   every food, packaged or cooked, is measured per realistic serving, and the FULL serving is compared with the age band's FULL daily
//            reference (no division). A pack's label is per 100 g and is scaled to its serving size first.
//   Metrics: 1 added sugar, 2 sodium, 3 saturated fat, 4 trans fat / hydrogenated oils, 5 fibre, 6 protein, 7 preservatives,
//            8 artificial additives, 9 base-ingredient integrity, 10 HFSS (the worst of sugar, sodium and saturated fat).
//   Cap:     a product that fails any one risk metric outright (score 3 or less on sugar, sodium, saturated fat or trans fat) cannot be rated above OK.
//            The total shown is still the real sum of the ten marks, so two capped products can still be told apart; they carry a "capped" badge.

export const SCORE_VERSION = 'kp-score-v4';
export const REFERENCE_BAND = '4-6';        // the band shown when no age is chosen
export const CAP_SCORE = 70;
// A meal may take up to about 30% of the child's day of sugar, sodium or saturated fat before it fails. A snack or a sweet is a smaller part of the day
// (about 10 to 15% of the day's energy), so it gets half the room: its share is doubled before the ladder is read, so it fails at 15%.
export const SNACK_FACTOR = 2;

// Daily references per age band. Sources: energy, protein and fibre ICMR-NIN 2020; sugar WHO free sugars (ideal 5% of energy, upper 10%) on that energy;
// saturated fat WHO (under 10% of energy) on that energy; sodium the ICMR-NIN 2020 adult limit (2,000 mg) scaled by energy, our method (no child figure is published).
export const BANDS = [
  { id: '1-3',   label: '1–3 years',   min_m: 12,  max_m: 47,  ref: { energy: 1110, sugarIdeal: 14, sugarUpper: 28, sodium: 1110, satFat: 12, fibre: 15, protein: 12.5 } },
  { id: '4-6',   label: '4–6 years',   min_m: 48,  max_m: 83,  ref: { energy: 1360, sugarIdeal: 17, sugarUpper: 34, sodium: 1360, satFat: 15, fibre: 20, protein: 16 } },
  { id: '7-9',   label: '7–9 years',   min_m: 84,  max_m: 119, ref: { energy: 1700, sugarIdeal: 21, sugarUpper: 43, sodium: 1700, satFat: 19, fibre: 26, protein: 23 } },
  { id: '10-12', label: '10–12 years', min_m: 120, max_m: 155, ref: { energy: 2140, sugarIdeal: 27, sugarUpper: 54, sodium: 2000, satFat: 24, fibre: 31.5, protein: 32.5 } },
];

// Every group the ICMR-NIN 2020 table uses (RDA summary, ICMR-NIN 2020): boys and girls from 10 to 12, 13 to 15 and 16 to 18; men and women at sedentary, moderate and heavy work.
// [energy kcal (the EAR, which NIN says is the energy requirement), protein g RDA, fibre g RDA]. Each group with no sex chosen is the average of the two.
const NIN = {
  '10-12': { m: [2220, 32, 33], f: [2060, 33, 30] }, '13-15': { m: [2860, 45, 43], f: [2400, 43, 36] }, '16-18': { m: [3320, 55, 50], f: [2500, 46, 38] },
  adult: { m: { sed: [2110, 54, 30], mod: [2710, 54, 40], heavy: [3470, 54, 50] }, f: { sed: [1660, 46, 25], mod: [2130, 46, 30], heavy: [2720, 46, 40] } },
};
// Sugar, saturated fat and sodium follow from the energy: sugar 5% of energy ideal (10% upper) at 4 kcal/g, saturated fat 10% at 9 kcal/g (WHO), sodium the ICMR-NIN 2020 adult
// limit of 2,000 mg a day, scaled down by energy for children (about 1 mg per kcal).
const refFrom = (e, p, f, adult) => ({ energy: e, sugarIdeal: Math.round(e / 80), sugarUpper: Math.round(e / 40), sodium: adult ? 2000 : Math.min(2000, e), satFat: Math.round(e / 90), fibre: f, protein: p });
const mean = (a, b) => a.map((v, i) => (v + b[i]) / 2);
const SEXWORD = { m: ['Boys', 'Men'], f: ['Girls', 'Women'] }, WORK = { sed: 'sedentary work', mod: 'moderate work', heavy: 'heavy work' };
const RANGE = { '10-12': [120, 155, '10–12'], '13-15': [156, 191, '13–15'], '16-18': [192, 227, '16–18'] };
export const ALL_BANDS = [...BANDS];
for (const g of ['10-12', '13-15', '16-18']) {
  const [lo, hi, txt] = RANGE[g], t = NIN[g];
  if (g !== '10-12') ALL_BANDS.push({ id: g, label: txt + ' years', min_m: lo, max_m: hi, ref: refFrom(...mean(t.m, t.f)) });
  for (const x of ['m', 'f']) ALL_BANDS.push({ id: g + ':' + x, label: SEXWORD[x][0] + ' ' + txt + ' years', min_m: lo, max_m: hi, ref: refFrom(...t[x]) });
}
ALL_BANDS.push({ id: 'adult', label: 'Adults', min_m: 228, max_m: 1200, ref: refFrom(...mean(NIN.adult.m.sed, NIN.adult.f.sed), true) });
for (const x of ['m', 'f']) for (const w of ['sed', 'mod', 'heavy']) ALL_BANDS.push({ id: 'adult:' + x + ':' + w, label: SEXWORD[x][1] + ', ' + WORK[w], min_m: 228, max_m: 1200, ref: refFrom(...NIN.adult[x][w], true) });
export const bandById = (id) => ALL_BANDS.find((b) => b.id === id) || BANDS.find((b) => b.id === REFERENCE_BAND);
// Any age in months -> its band. Under 12 months uses the 1-3 year reference (and says so); over 155 months uses 10-12.
export function bandForMonths(m) {
  const n = Number(m);
  if (!Number.isFinite(n) || n < 12) return BANDS[0];
  return ALL_BANDS.filter((b) => !b.id.includes(':')).find((b) => n >= b.min_m && n <= b.max_m) || ALL_BANDS.find((b) => b.id === 'adult');
}
export const SCORE_COLUMN = { '1-3': 'score_13', '4-6': 'score_46', '7-9': 'score_79', '10-12': 'score_1012' };

// ten yes/no checks: the Poshan Score is the number passed times 10, so a product that passes everything is exactly 100 and one that passes nothing is 0
export const stretch = (passed) => passed * 10;
// 8-10 checks passed = Good, 5-7 = OK, 0-4 = Do not use
export const totalBand = (v) => (v >= 80 ? 'Good' : v >= 50 ? 'OK' : 'Do not use');

// share of the day's reference -> 1 (pass) or 0 (fail).
// A risk metric (less is better) passes when one serving is under the line: 30% of the day for a meal, 15% for a snack or sweet (the snack's share is doubled first).
// A credit metric (more is better) passes when one serving gives at least 15% of the day's need.
export const RISK_LINE = 30;
export const CREDIT_LINE = 15;
export const riskScore = (pct) => (pct < RISK_LINE ? 1 : 0);
export const creditScore = (pct) => (pct >= CREDIT_LINE ? 1 : 0);
export const INTEGRITY_PASS = 6;      // the integrity reading (sugar first 1, refined first 3, whole food 6, the named food 10) passes at 6 or more

const PRESERVATIVES = /\b(?:ins|e)\s?(?:20[0-3]|211|22[0-8])\b|\bsodium benzoate\b|\bpotassium sorbate\b|\bcalcium propionate\b|\bsorbic acid\b|\bbenzoic acid\b|\bsulph?ites?\b|\bnitrites?\b|\bpropionate\b|\bpreservatives?\b/gi;
const ADDITIVES = /\b(?:ins|e)\s?(?:627|631|635|621|150d|319|320|102|110|122|124|129|133|143|160b)\b|\bartificial (?:colou?rs?|flavou?rs?|sweeteners?)\b|\bflavou?r enhancers?\b|\bmonosodium glutamate\b|\bmsg\b|\bajinomoto\b|\baspartame\b|\bacesulfame\b|\bsucralose\b|\bnature[- ]identical\b|\bcolou?rs?\s*\(\s*(?:ins|e)?\s?1\d\d/gi;
const TRANS = /\b(?:hydrogenated|vanaspati|dalda|margarine|shortening|interesterified)\b/i;

const distinct = (text, re) => new Set((String(text).toLowerCase().match(re) || []).map((s) => s.replace(/\s+/g, ' ').trim()));
const round1 = (v) => Math.round(v * 10) / 10;
const asText = (ing) => (Array.isArray(ing) ? ing.join(', ') : String(ing || '')).toLowerCase();

const STOP = new Set(['instant', 'organic', 'healthy', 'ready', 'pack', 'mix', 'powder', 'natural', 'premium', 'fresh', 'with', 'high', 'protein', 'fibre', 'fiber', 'gluten', 'free', 'kids', 'whole', 'easy', 'make', 'cook', 'foods', 'food', 'brand', 'flour']);
function integrityFor(name, ingredients, topKey) {
  const list = Array.isArray(ingredients) ? ingredients : [];
  if (topKey != null && !list.length) {                                          // a cooked dish: look at what dominates by weight
    if (topKey === 'sugar' || topKey === 'maida') return { score: 4, note: 'refined flour or sugar is the largest ingredient' };
    if (topKey === 'oil' || topKey === 'butter' || topKey === 'ghee') return { score: 7, note: 'fat is the largest ingredient' };
    return { score: 10, note: 'made from whole foods' };
  }
  const first = String(list[0] || '').toLowerCase();
  if (!first) return { score: 6, note: 'ingredient list not read' };
  if (/\b(sugar|sucrose|glucose|syrup|jaggery syrup)\b/.test(first)) return { score: 1, note: 'sugar is the first ingredient' };
  if (/\b(maida|refined (wheat )?flour|all[- ]purpose flour|starch|maltodextrin|palm|vegetable (oil|fat)|hydrogenated)\b/.test(first)) return { score: 3, note: 'a refined ingredient comes first' };
  const tokens = String(name || '').toLowerCase().split(/[^a-z]+/).filter((t) => t.length >= 4 && !STOP.has(t));
  if (tokens.some((t) => first.includes(t) || first.includes(t.replace(/s$/, '')))) return { score: 10, note: 'the first ingredient is the food the product is named after' };
  return { score: 6, note: 'the first ingredient is a whole food, but not the one in the name' };
}

// input: { basis: 'pack' | 'meal', addedSugar, sodium, satFat, fibre, protein, ingredients (array or text), name, topKey }
// (grams, except sodium in mg). Returns the score for one band.
export function scoreForBand(input, bandId) {
  const band = bandById(bandId), ref = band.ref;
  const share = (v, r) => (r > 0 ? (Number(v || 0) / r) * 100 : 0);      // the full serving against the full day's reference
  const text = asText(input.ingredients);
  const shareWord = '= ';

  const sugarPct = share(input.addedSugar, ref.sugarIdeal), sodiumPct = share(input.sodium, ref.sodium), satPct = share(input.satFat, ref.satFat);
  const lineF = input.snack ? SNACK_FACTOR : 1;                       // the share the mark is read from (the share shown stays the real one)
  const fibrePct = share(input.fibre, ref.fibre), proteinPct = share(input.protein, ref.protein);
  const fl = input.flags || null;          // a pack whose ingredient list we only have as our own checked reading: counts and the integrity mark are given directly
  const pres = fl && fl.preservatives != null ? { size: fl.preservatives, forced: true } : distinct(text, PRESERVATIVES);
  const add = fl && fl.additives != null ? { size: fl.additives, forced: true } : distinct(text, ADDITIVES);
  const trans = fl && fl.trans != null ? !!fl.trans : TRANS.test(text);
  const integ = fl && fl.integrity != null ? { score: fl.integrity, note: fl.integrity_note || 'our checked reading of the ingredient list' } : integrityFor(input.name, Array.isArray(input.ingredients) ? input.ingredients : [], Array.isArray(input.ingredients) && input.ingredients.length ? null : input.topKey);

  const m = [
    { n: 1, id: 'sugar', name: 'Added sugar', type: 'risk', value: round1(Number(input.addedSugar || 0)), unit: 'g', share: round1(sugarPct), score: riskScore(sugarPct * lineF),
      reading: `${round1(Number(input.addedSugar || 0))} g ${shareWord}${Math.round(sugarPct)}% of the day's ${ref.sugarIdeal} g ideal limit` },
    { n: 2, id: 'sodium', name: 'Sodium', type: 'risk', value: round1(Number(input.sodium || 0)), unit: 'mg', share: round1(sodiumPct), score: riskScore(sodiumPct * lineF),
      reading: `${round1(Number(input.sodium || 0))} mg ${shareWord}${Math.round(sodiumPct)}% of the day's ${ref.sodium} mg reference` },
    { n: 3, id: 'satfat', name: 'Saturated fat', type: 'risk', value: round1(Number(input.satFat || 0)), unit: 'g', share: round1(satPct), score: riskScore(satPct * lineF),
      reading: `${round1(Number(input.satFat || 0))} g ${shareWord}${Math.round(satPct)}% of the day's ${ref.satFat} g limit` },
    { n: 4, id: 'trans', name: 'Trans fat / hydrogenated oils', type: 'risk', value: trans ? 1 : 0, unit: trans ? 'found' : 'none', share: null, score: trans ? 0 : 1,
      reading: trans ? 'a hydrogenated oil, vanaspati or margarine is listed' : 'no hydrogenated oil, vanaspati or margarine listed' },
    { n: 5, id: 'fibre', name: 'Fibre', type: 'credit', value: round1(Number(input.fibre || 0)), unit: 'g', share: round1(fibrePct), score: creditScore(fibrePct),
      reading: `${round1(Number(input.fibre || 0))} g ${shareWord}${Math.round(fibrePct)}% of the day's ${ref.fibre} g need` },
    { n: 6, id: 'protein', name: 'Protein', type: 'credit', value: round1(Number(input.protein || 0)), unit: 'g', share: round1(proteinPct), score: creditScore(proteinPct),
      reading: `${round1(Number(input.protein || 0))} g ${shareWord}${Math.round(proteinPct)}% of the day's ${ref.protein} g RDA` },
    { n: 7, id: 'preservatives', name: 'Preservatives', type: 'check', value: pres.size, unit: 'found', share: null, score: pres.size ? 0 : 1,
      reading: pres.size ? `${pres.size} found${pres.forced ? '' : ': ' + [...pres].slice(0, 3).join(', ')}` : 'none found' },
    { n: 8, id: 'additives', name: 'Artificial additives', type: 'check', value: add.size, unit: 'found', share: null, score: add.size ? 0 : 1,
      reading: add.size ? `${add.size} found${add.forced ? '' : ': ' + [...add].slice(0, 3).join(', ')}` : 'none found' },
    { n: 9, id: 'integrity', name: 'Base-ingredient integrity', type: 'check', value: null, unit: '', share: null, score: integ.score >= INTEGRITY_PASS ? 1 : 0, reading: integ.note },
  ];
  const worst = Math.min(m[0].score, m[1].score, m[2].score);
  m.push({ n: 10, id: 'hfss', name: 'HFSS status', type: 'composite', value: worst, unit: '', share: null, score: worst,
    reading: worst === 0 ? 'high in sugar, sodium or saturated fat' : 'not high in sugar, sodium or saturated fat' });
  for (const x of m) x.pass = x.score === 1;

  const sum = m.reduce((a, x) => a + x.score, 0);                    // how many of the ten checks pass, 0 to 10
  const total = stretch(sum);                                          // the Poshan Score: that times 10
  // The total is the real count. A failed risk check (sugar, sodium, saturated fat or trans fat) holds the TIER at OK (never Good) and the result is marked capped.
  const capped = [m[0], m[1], m[2], m[3]].some((x) => x.score === 0) && total > CAP_SCORE;
  return { band: band.id, band_label: band.label, total, tier: totalBand(capped ? CAP_SCORE : total), sum, capped, metrics: m };
}

export function scoreAllBands(input) {
  const bands = {};
  for (const b of ALL_BANDS) bands[b.id] = scoreForBand(input, b.id);
  return { version: SCORE_VERSION, basis: input.basis, reference: bands[REFERENCE_BAND].total, bands };
}

// What the Age & Metrics page shows: written from the same tables the engine uses, so the page cannot disagree with the scores.
export function methodSpec() {
  const yn = (yes, no) => [{ score: 1, rule: yes }, { score: 0, rule: no }];
  return {
    version: SCORE_VERSION, scale: { min: 0, max: 1, total: 100, sum_range: [0, 10], formula: 'Poshan Score = the number of the ten checks a product passes, times 10. Each check is a plain yes (1) or no (0).' }, reference_band: REFERENCE_BAND, cap: { score: CAP_SCORE, because: 'failing the sugar, sodium, saturated-fat or trans-fat check', effect: 'holds the rating at OK; the score shown stays the real count and the item carries a capped badge' },
    tiers: [{ name: 'Good', min: 80, max: 100 }, { name: 'OK', min: 50, max: 79 }, { name: 'Do not use', min: 0, max: 49 }],
    bands: BANDS.map((b) => ({ id: b.id, label: b.label, reference: b.ref })),
    nin_bands: ALL_BANDS.map((b) => ({ id: b.id, label: b.label, reference: b.ref })),
    bases: { snack: "A meal passes the sugar, sodium and saturated-fat checks when one serving takes under " + RISK_LINE + "% of the child's day. A snack, sweet or sweet drink is a smaller part of the day, so it passes only under " + RISK_LINE / SNACK_FACTOR + "%.", serving: "Every food, packaged or cooked, is measured per realistic serving, and the full serving is compared with the age band's full daily reference. A pack's label is per 100 g, so it is scaled to the serving size first." },
    sodium_example: { mg: 793.8, what: 'one 38 g serving of a masala oats sachet', by_age: BANDS.map((b) => { const pct = (793.8 / b.ref.sodium) * 100; return { id: b.id, label: b.label, share: Math.round(pct), score: riskScore(pct) }; }) },
    under_12_months: 'Under 12 months there is no published reference band, so the 1–3 year reference is used.',
    metrics: [
      { n: 1, id: 'sugar', name: 'Added sugar', type: 'risk', measure: "Share of the age band's ideal daily added-sugar limit in one serving", steps: yn('under ' + RISK_LINE + '% of the day (snacks and sweets: under ' + RISK_LINE / SNACK_FACTOR + '%)', 'at or over that line'), source: 'WHO free-sugars guideline (ideal 5% of energy) on ICMR-NIN 2020 energy' },
      { n: 2, id: 'sodium', name: 'Sodium', type: 'risk', measure: "Share of the age band's daily sodium limit in one serving", steps: yn('under ' + RISK_LINE + '% of the day (snacks and sweets: under ' + RISK_LINE / SNACK_FACTOR + '%)', 'at or over that line'), source: 'ICMR-NIN 2020 adult limit (2,000 mg), scaled to the age band by energy (our method; no child figure is published)' },
      { n: 3, id: 'satfat', name: 'Saturated fat', type: 'risk', measure: "Share of the age band's daily saturated-fat limit (10% of energy) in one serving", steps: yn('under ' + RISK_LINE + '% of the day (snacks and sweets: under ' + RISK_LINE / SNACK_FACTOR + '%)', 'at or over that line'), source: 'WHO saturated-fat guidance on ICMR-NIN 2020 energy' },
      { n: 4, id: 'trans', name: 'Trans fat / hydrogenated oils', type: 'risk', measure: 'Whether the ingredient list names a hydrogenated oil, vanaspati, margarine or shortening', steps: yn('none listed', 'one is listed'), source: 'FSSAI: industrial trans fat at most 2% of total oils and fats' },
      { n: 5, id: 'fibre', name: 'Fibre', type: 'credit', measure: "Share of the age band's daily fibre need in one serving", steps: yn(CREDIT_LINE + '% of the day or more', 'under ' + CREDIT_LINE + '%'), source: 'ICMR-NIN 2020' },
      { n: 6, id: 'protein', name: 'Protein', type: 'credit', measure: "Share of the age band's daily protein RDA in one serving", steps: yn(CREDIT_LINE + '% of the day or more', 'under ' + CREDIT_LINE + '%'), source: 'ICMR-NIN 2020' },
      { n: 7, id: 'preservatives', name: 'Preservatives', type: 'check', measure: 'FSSAI Class II preservatives named in the ingredients (INS 200–203, 211, 220–228, benzoates, sorbates, propionates, sulphites, nitrites)', steps: yn('none found', 'one or more found'), source: 'FSSAI Food Products Standards and Food Additives Regulations, 2011' },
      { n: 8, id: 'additives', name: 'Artificial additives', type: 'check', measure: 'Flavour enhancers, synthetic colours and artificial sweeteners or flavours named in the ingredients', steps: yn('none found', 'one or more found'), source: 'FSSAI Food Products Standards and Food Additives Regulations, 2011' },
      { n: 9, id: 'integrity', name: 'Base-ingredient integrity', type: 'check', measure: 'Whether the first ingredient is a real food (a cooked dish: whether whole foods dominate)', steps: yn('a whole food comes first', 'sugar, or a refined flour, starch, palm or vegetable fat, comes first'), source: 'Our own consistent reading of ingredient order' },
      { n: 10, id: 'hfss', name: 'HFSS status', type: 'composite', measure: 'High in fat, sugar or salt: fails if any of checks 1, 2 and 3 fails', steps: yn('checks 1, 2 and 3 all pass', 'any of them fails'), source: 'FSSAI school-food (HFSS) and front-of-pack proposals; the check itself is ours' },
    ],
  };
}
