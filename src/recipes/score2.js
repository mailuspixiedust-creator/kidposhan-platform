// The Poshan Score, version 2: ten metrics, each scored 1 to 10 (10 = best), added up to a score out of 100.
// One engine for recipes and packaged products, and the same method the Age & Metrics page shows (it reads methodSpec() below).
//
//   Age:     the score is worked out for the child's age band (1-3, 4-6, 7-9, 10-12 years). Sugar, sodium, saturated fat, fibre and protein
//            are compared with that band's daily reference. Under 12 months there is no published band, so the 1-3 year reference is used.
//   Basis:   packaged food is measured per 100 g (as the label prints it) against the day's reference;
//            a cooked dish is measured per serving, counted as one of about three meals a day (the amount is divided by three) against the day's reference.
//   Metrics: 1 added sugar, 2 sodium, 3 saturated fat, 4 trans fat / hydrogenated oils, 5 fibre, 6 protein, 7 preservatives,
//            8 artificial additives, 9 base-ingredient integrity, 10 HFSS (the worst of sugar, sodium and saturated fat).
//   Cap:     a product that fails any one risk metric outright (score 3 or less on sugar, sodium, saturated fat or trans fat) cannot score above 57.

export const SCORE_VERSION = 'kp-score-v2';
export const REFERENCE_BAND = '4-6';        // the band shown when no age is chosen
export const CAP_SCORE = 57;

// Daily references per age band. Sources: energy and protein ICMR-NIN 2020; sugar WHO free sugars (ideal 5% of energy, upper 10%);
// saturated fat WHO (under 10% of energy); sodium and fibre NASEM/IOM DRI used as proxies (ICMR publishes no age-wise table).
export const BANDS = [
  { id: '1-3',   label: '1–3 years',   min_m: 12,  max_m: 47,  ref: { energy: 1060, sugarIdeal: 13, sugarUpper: 26, sodium: 1200, satFat: 12, fibre: 19, protein: 12.5 } },
  { id: '4-6',   label: '4–6 years',   min_m: 48,  max_m: 83,  ref: { energy: 1350, sugarIdeal: 17, sugarUpper: 34, sodium: 1500, satFat: 15, fibre: 25, protein: 16 } },
  { id: '7-9',   label: '7–9 years',   min_m: 84,  max_m: 119, ref: { energy: 1690, sugarIdeal: 21, sugarUpper: 42, sodium: 1800, satFat: 19, fibre: 26, protein: 23 } },
  { id: '10-12', label: '10–12 years', min_m: 120, max_m: 155, ref: { energy: 2150, sugarIdeal: 27, sugarUpper: 54, sodium: 2000, satFat: 24, fibre: 31, protein: 32.5 } },
];
export const bandById = (id) => BANDS.find((b) => b.id === id) || BANDS.find((b) => b.id === REFERENCE_BAND);
// Any age in months -> its band. Under 12 months uses the 1-3 year reference (and says so); over 155 months uses 10-12.
export function bandForMonths(m) {
  const n = Number(m);
  if (!Number.isFinite(n) || n < 12) return BANDS[0];
  return BANDS.find((b) => n >= b.min_m && n <= b.max_m) || BANDS[BANDS.length - 1];
}
export const SCORE_COLUMN = { '1-3': 'score_13', '4-6': 'score_46', '7-9': 'score_79', '10-12': 'score_1012' };

export const totalBand = (v) => (v >= 80 ? 'Excellent' : v >= 58 ? 'Good' : v >= 40 ? 'Fair' : 'Occasional');

// share of the reference -> 1..10. A risk metric (less is better): the score is the first row whose cutoff the share is BELOW.
// A credit metric (more is better): the first row whose cutoff the share REACHES.
export const RISK_STEPS = [[10, 2], [9, 6], [8, 10], [7, 15], [6, 20], [5, 25], [4, 30], [3, 40], [2, 50]];      // [score, share below which it applies, in %]
export const CREDIT_STEPS = [[10, 30], [9, 22], [8, 15], [7, 12], [6, 9], [5, 7], [4, 5], [3, 3], [2, 1.5]];     // [score, share at or above which it applies, in %]
export const riskScore = (pct) => { for (const [s, c] of RISK_STEPS) if (pct < c) return s; return 1; };
export const creditScore = (pct) => { for (const [s, c] of CREDIT_STEPS) if (pct >= c) return s; return 1; };
export const PRESERVATIVE_STEPS = [10, 6, 3, 1];      // by how many are found: 0, 1, 2, 3 or more
export const ADDITIVE_STEPS = [10, 7, 4, 1];

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
  const band = bandById(bandId), ref = band.ref, meal = input.basis === 'meal';
  const meals = meal ? 3 : 1;             // a dish is one of about three meals a day, so only a third of a serving counts toward the day
  const share = (v, r) => (r > 0 ? (Number(v || 0) / meals / r) * 100 : 0);
  const text = asText(input.ingredients);
  const shareWord = meal ? '(a serving counts as one of three meals) = ' : '= ';

  const sugarPct = share(input.addedSugar, ref.sugarIdeal), sodiumPct = share(input.sodium, ref.sodium), satPct = share(input.satFat, ref.satFat);
  const fibrePct = share(input.fibre, ref.fibre), proteinPct = share(input.protein, ref.protein);
  const pres = distinct(text, PRESERVATIVES), add = distinct(text, ADDITIVES), trans = TRANS.test(text);
  const integ = integrityFor(input.name, Array.isArray(input.ingredients) ? input.ingredients : [], Array.isArray(input.ingredients) && input.ingredients.length ? null : input.topKey);

  const m = [
    { n: 1, id: 'sugar', name: 'Added sugar', type: 'risk', value: round1(Number(input.addedSugar || 0)), unit: 'g', share: round1(sugarPct), score: riskScore(sugarPct),
      reading: `${round1(Number(input.addedSugar || 0))} g ${shareWord}${Math.round(sugarPct)}% of the day's ${ref.sugarIdeal} g ideal limit` },
    { n: 2, id: 'sodium', name: 'Sodium', type: 'risk', value: round1(Number(input.sodium || 0)), unit: 'mg', share: round1(sodiumPct), score: riskScore(sodiumPct),
      reading: `${round1(Number(input.sodium || 0))} mg ${shareWord}${Math.round(sodiumPct)}% of the day's ${ref.sodium} mg reference` },
    { n: 3, id: 'satfat', name: 'Saturated fat', type: 'risk', value: round1(Number(input.satFat || 0)), unit: 'g', share: round1(satPct), score: riskScore(satPct),
      reading: `${round1(Number(input.satFat || 0))} g ${shareWord}${Math.round(satPct)}% of the day's ${ref.satFat} g limit` },
    { n: 4, id: 'trans', name: 'Trans fat / hydrogenated oils', type: 'risk', value: trans ? 1 : 0, unit: trans ? 'found' : 'none', share: null, score: trans ? 2 : 10,
      reading: trans ? 'a hydrogenated oil, vanaspati or margarine is listed' : 'no hydrogenated oil, vanaspati or margarine listed' },
    { n: 5, id: 'fibre', name: 'Fibre', type: 'credit', value: round1(Number(input.fibre || 0)), unit: 'g', share: round1(fibrePct), score: creditScore(fibrePct),
      reading: `${round1(Number(input.fibre || 0))} g ${shareWord}${Math.round(fibrePct)}% of the day's ${ref.fibre} g need` },
    { n: 6, id: 'protein', name: 'Protein', type: 'credit', value: round1(Number(input.protein || 0)), unit: 'g', share: round1(proteinPct), score: creditScore(proteinPct),
      reading: `${round1(Number(input.protein || 0))} g ${shareWord}${Math.round(proteinPct)}% of the day's ${ref.protein} g RDA` },
    { n: 7, id: 'preservatives', name: 'Preservatives', type: 'check', value: pres.size, unit: 'found', share: null, score: PRESERVATIVE_STEPS[Math.min(pres.size, 3)],
      reading: pres.size ? `${pres.size} found: ${[...pres].slice(0, 3).join(', ')}` : 'none found' },
    { n: 8, id: 'additives', name: 'Artificial additives', type: 'check', value: add.size, unit: 'found', share: null, score: ADDITIVE_STEPS[Math.min(add.size, 3)],
      reading: add.size ? `${add.size} found: ${[...add].slice(0, 3).join(', ')}` : 'none found' },
    { n: 9, id: 'integrity', name: 'Base-ingredient integrity', type: 'check', value: null, unit: '', share: null, score: integ.score, reading: integ.note },
  ];
  const worst = Math.min(m[0].score, m[1].score, m[2].score);
  m.push({ n: 10, id: 'hfss', name: 'HFSS status', type: 'composite', value: worst, unit: '', share: null, score: worst,
    reading: worst <= 3 ? 'high in sugar, sodium or saturated fat' : 'the worst of sugar, sodium and saturated fat' });

  const sum = m.reduce((a, x) => a + x.score, 0);
  const capped = [m[0], m[1], m[2], m[3]].some((x) => x.score <= 3) && sum > CAP_SCORE;
  const total = capped ? CAP_SCORE : sum;
  return { band: band.id, band_label: band.label, total, tier: totalBand(total), sum, capped, metrics: m };
}

export function scoreAllBands(input) {
  const bands = {};
  for (const b of BANDS) bands[b.id] = scoreForBand(input, b.id);
  return { version: SCORE_VERSION, basis: input.basis, reference: bands[REFERENCE_BAND].total, bands };
}

// What the Age & Metrics page shows: written from the same tables the engine uses, so the page cannot disagree with the scores.
export function methodSpec() {
  const riskRules = RISK_STEPS.map(([s, c], i) => ({ score: s, rule: i === 0 ? `under ${c}%` : `${RISK_STEPS[i - 1][1]}% to under ${c}%` })).concat([{ score: 1, rule: `${RISK_STEPS[RISK_STEPS.length - 1][1]}% or more` }]);
  const creditRules = CREDIT_STEPS.map(([s, c], i) => ({ score: s, rule: i === 0 ? `${c}% or more` : `${c}% to under ${CREDIT_STEPS[i - 1][1]}%` })).concat([{ score: 1, rule: `under ${CREDIT_STEPS[CREDIT_STEPS.length - 1][1]}%` }]);
  const countRules = (steps, what) => steps.map((s, i) => ({ score: s, rule: i === 0 ? `no ${what} found` : i === 3 ? `3 or more ${what} found` : `${i} ${what} found` }));
  return {
    version: SCORE_VERSION, scale: { min: 1, max: 10, total: 100 }, reference_band: REFERENCE_BAND, cap: { score: CAP_SCORE, because: 'a score of 3 or less on sugar, sodium, saturated fat or trans fat' },
    tiers: [{ name: 'Excellent', min: 80, max: 100 }, { name: 'Good', min: 58, max: 79 }, { name: 'Fair', min: 40, max: 57 }, { name: 'Occasional', min: 10, max: 39 }],
    bands: BANDS.map((b) => ({ id: b.id, label: b.label, reference: b.ref })),
    bases: { pack: 'Packaged food: measured per 100 g, as the label prints it, against the day\'s reference.', meal: 'A cooked dish: measured per serving, counted as one of about three meals a day (a third of the amount counts toward the day), against the day\'s reference.' },
    sodium_example: { mg: 793.8, what: 'one 38 g serving of a masala oats sachet', by_age: BANDS.map((b) => { const pct = (793.8 / b.ref.sodium) * 100; return { id: b.id, label: b.label, share: Math.round(pct), score: riskScore(pct) }; }) },
    under_12_months: 'Under 12 months there is no published reference band, so the 1–3 year reference is used.',
    metrics: [
      { n: 1, id: 'sugar', name: 'Added sugar', type: 'risk', measure: 'Share of the age band\'s ideal daily added-sugar limit', steps: riskRules, source: 'WHO free-sugars guideline (ideal 5% of energy)' },
      { n: 2, id: 'sodium', name: 'Sodium', type: 'risk', measure: 'Share of the age band\'s daily sodium reference', steps: riskRules, source: 'NASEM/IOM DRI, used as a proxy (ICMR has no paediatric table)' },
      { n: 3, id: 'satfat', name: 'Saturated fat', type: 'risk', measure: 'Share of the age band\'s daily saturated-fat limit (10% of energy)', steps: riskRules, source: 'WHO saturated-fat guidance' },
      { n: 4, id: 'trans', name: 'Trans fat / hydrogenated oils', type: 'risk', measure: 'Whether the ingredient list names a hydrogenated oil, vanaspati, margarine or shortening', steps: [{ score: 10, rule: 'none listed' }, { score: 2, rule: 'one is listed' }], source: 'FSSAI: trans fat at most 2% of total fat' },
      { n: 5, id: 'fibre', name: 'Fibre', type: 'credit', measure: 'Share of the age band\'s daily fibre need', steps: creditRules, source: 'NASEM/IOM adequate intake, used as a proxy' },
      { n: 6, id: 'protein', name: 'Protein', type: 'credit', measure: 'Share of the age band\'s daily protein RDA', steps: creditRules, source: 'ICMR-NIN 2020' },
      { n: 7, id: 'preservatives', name: 'Preservatives', type: 'check', measure: 'FSSAI Class II preservatives named in the ingredients (INS 200–203, 211, 220–228, benzoates, sorbates, propionates, sulphites, nitrites)', steps: countRules(PRESERVATIVE_STEPS, 'preservatives'), source: 'FSSAI Food Products Standards and Food Additives Regulations, 2011' },
      { n: 8, id: 'additives', name: 'Artificial additives', type: 'check', measure: 'Flavour enhancers, synthetic colours and artificial sweeteners or flavours named in the ingredients', steps: countRules(ADDITIVE_STEPS, 'additives'), source: 'FSSAI Food Products Standards and Food Additives Regulations, 2011' },
      { n: 9, id: 'integrity', name: 'Base-ingredient integrity', type: 'check', measure: 'Whether the first ingredient is the food the product is named after (a cooked dish: whether whole foods dominate)', steps: [{ score: 10, rule: 'the first ingredient is the named food' }, { score: 6, rule: 'a whole food first, but not the named one, or the list was not read' }, { score: 3, rule: 'a refined flour, starch, palm or vegetable fat first' }, { score: 1, rule: 'sugar first' }], source: 'Our own consistent reading of ingredient order' },
      { n: 10, id: 'hfss', name: 'HFSS status', type: 'composite', measure: 'The worst of the sugar, sodium and saturated-fat scores (high in fat, sugar or salt)', steps: [{ score: '1–10', rule: 'the lowest of metrics 1, 2 and 3' }], source: 'FSSAI proposed front-of-pack warning (Phase II)' },
    ],
  };
}
