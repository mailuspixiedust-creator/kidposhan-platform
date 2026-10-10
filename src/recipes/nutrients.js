// Approximate food-composition data used ONLY to estimate recipe-level Poshan Score inputs.
// Values are per 100 g of the ingredient as normally listed in recipes (dry for grains/dals/flours).
// They are rounded reference values (IFCT/USDA ballpark), not lab data: estimated scores are therefore
// labelled "estimated" and stay hidden from parents until the owner approves them.
//
// key: [protein g, fibre g, saturated fat g, sodium mg, grams per cup, grams per piece]
// tbsp = cup/16, tsp = cup/48. Added sugar is handled separately (SWEETENERS).
export const FOOD = {
  carrot: [0.9, 2.8, 0.04, 69, 128, 60], potato: [2, 2.2, 0.03, 6, 150, 150], onion: [1.1, 1.7, 0.04, 4, 160, 110],
  tomato: [0.9, 1.2, 0.05, 5, 180, 100], garlic: [6.4, 2.1, 0.09, 17, 136, 4], ginger: [1.8, 2, 0.2, 13, 96, 10],
  green_chilli: [2, 1.5, 0.1, 9, 100, 5], spinach: [2.9, 2.2, 0.06, 79, 30, 30], fenugreek_leaves: [4.4, 1.1, 0.1, 76, 30, 30],
  green_peas: [5.4, 5.1, 0.07, 5, 145, 145], cauliflower: [1.9, 2, 0.13, 30, 100, 400], capsicum: [1, 1.7, 0.03, 4, 120, 120],
  beetroot: [1.6, 2.8, 0.03, 78, 136, 120], sweet_potato: [1.6, 3, 0.02, 55, 133, 130], bottle_gourd: [0.6, 0.5, 0, 2, 116, 300],
  pumpkin: [1, 0.5, 0.1, 1, 116, 300], beans: [1.8, 2.7, 0.03, 6, 110, 6], cabbage: [1.3, 2.5, 0.03, 18, 89, 400],
  corn: [3.3, 2.7, 0.2, 15, 145, 150], cucumber: [0.7, 0.5, 0.03, 2, 104, 200], coriander_leaves: [2.1, 2.8, 0.01, 46, 16, 5],
  mint: [3.8, 8, 0.2, 30, 14, 3], curry_leaves: [6.1, 6.4, 0.5, 5, 10, 1], lemon: [1.1, 2.8, 0.04, 2, 244, 50],
  banana: [1.1, 2.6, 0.1, 1, 150, 120], apple: [0.3, 2.4, 0.03, 1, 125, 180], mango: [0.8, 1.6, 0.1, 1, 165, 200],
  dates: [2.5, 8, 0, 2, 147, 8],
  rice: [7, 1.3, 0.15, 5, 185, 0], poha: [6.6, 1.2, 0.5, 10, 100, 0], rava: [12.7, 3.9, 0.2, 1, 167, 0],
  wheat_flour: [12, 11, 0.3, 2, 120, 0], maida: [10.7, 2.7, 0.2, 2, 125, 0], besan: [22, 10.8, 0.7, 64, 92, 0],
  ragi: [7.3, 11.5, 0.3, 11, 120, 0], oats: [13, 10, 1.2, 6, 80, 0], dalia: [12, 12, 0.3, 17, 150, 0],
  bread: [9, 2.7, 0.5, 490, 40, 30], vermicelli: [11, 3, 0.2, 8, 60, 0],
  moong_dal: [24, 16, 0.3, 15, 200, 0], toor_dal: [22, 15, 0.3, 17, 200, 0], masoor_dal: [25, 11, 0.2, 6, 192, 0],
  urad_dal: [25, 18, 0.3, 38, 200, 0], chana_dal: [21, 15, 0.6, 24, 200, 0], chickpeas: [19, 17, 0.7, 24, 200, 0],
  rajma: [22, 15, 0.4, 24, 190, 0], sprouts: [8, 2, 0.1, 10, 100, 0],
  paneer: [18, 0, 13, 22, 225, 20], milk: [3.3, 0, 1.9, 43, 245, 0], curd: [3.5, 0, 2.1, 46, 245, 0],
  butter: [0.9, 0, 51, 576, 227, 10], cheese: [25, 0, 18, 620, 113, 20], egg: [12.6, 0, 3.3, 124, 0, 50],
  chicken: [21, 0, 1, 70, 140, 150], fish: [20, 0, 1, 60, 0, 100], prawn: [20, 0, 0.3, 150, 145, 12], mutton: [21, 0, 5, 72, 140, 0],
  peanuts: [26, 8.5, 6.3, 18, 146, 0], cashew: [18, 3.3, 7.8, 12, 130, 2], almonds: [21, 12.5, 3.8, 1, 143, 1],
  jaggery: [0.4, 0, 0, 30, 200, 0], honey: [0.3, 0, 0, 4, 340, 0], sugar: [0, 0, 0, 1, 200, 0],
  sesame: [18, 11.8, 7, 11, 144, 0], makhana: [9.7, 14.5, 0.1, 1, 30, 1], coconut: [3.3, 9, 15, 20, 80, 0],
  mushroom: [3.1, 1, 0.05, 5, 70, 20], radish: [0.7, 1.6, 0, 39, 116, 100],
  dry_red_chilli: [12, 28, 3.3, 30, 30, 1], cardamom: [11, 28, 0.7, 18, 96, 0.5], cinnamon: [4, 53, 0.3, 10, 120, 3], cloves: [6, 34, 4, 277, 96, 0.2],
  bay_leaf: [8, 26, 2.3, 23, 20, 0.3], fennel_seeds: [16, 40, 0.5, 88, 96, 0], oregano: [9, 43, 1.6, 25, 50, 0], tamarind: [3, 5, 0.3, 28, 240, 0],
  vanilla: [0, 0, 0, 9, 208, 0], baking_powder: [0, 0, 0, 10600, 220, 0], vinegar: [0, 0, 0, 5, 240, 0], soy_sauce: [8, 0.8, 0, 5500, 255, 0],
  cornstarch: [0.3, 0.9, 0, 9, 128, 0], cocoa: [20, 33, 8, 21, 86, 0], soya_chunks: [52, 13, 0.5, 20, 40, 0], plantain: [1.3, 2.3, 0.1, 4, 148, 180],
  zucchini: [1.2, 1, 0.1, 8, 124, 200], raisins: [3, 4, 0.1, 11, 145, 1],
  brinjal: [1, 3, 0.04, 2, 82, 250], okra: [1.9, 3.2, 0.03, 7, 100, 12], broccoli: [2.8, 2.6, 0.04, 33, 91, 300], cream: [2.1, 0, 19, 38, 238, 0],
  salt: [0, 0, 0, 39340, 288, 0], water: [0, 0, 0, 0, 240, 0], oil: [0, 0, 14, 0, 218, 0], ghee: [0, 0, 62, 0, 205, 0],
  turmeric: [8, 21, 3.1, 38, 144, 0], cumin: [18, 11, 1.5, 168, 96, 0], mustard_seeds: [26, 12, 2, 13, 144, 0],
  hing: [4, 4, 0.5, 100, 144, 0], red_chilli_powder: [12, 28, 3.3, 30, 96, 0], garam_masala: [10, 25, 3, 70, 96, 0],
  coriander_powder: [12, 42, 1, 35, 96, 0], black_pepper: [10, 25, 1.4, 20, 110, 0], baking_soda: [0, 0, 0, 27360, 220, 0],
};

// Foods common in European and Southeast Asian recipes (same layout and the same rounded USDA-style reference values).
Object.assign(FOOD, {
  pasta: [13, 3.2, 0.3, 6, 100, 0], noodles: [12, 3.3, 0.5, 20, 90, 0], rice_noodles: [6, 1.6, 0.1, 20, 100, 0],
  tofu: [8, 1.9, 1.3, 7, 252, 0], tempeh: [19, 0, 2.5, 9, 166, 0], coconut_milk: [2.3, 0, 21, 13, 240, 0], fish_sauce: [5, 0, 0, 7851, 288, 0],
  lemongrass: [1.8, 0, 0, 6, 67, 30], spring_onion: [1.8, 2.6, 0.03, 16, 100, 15], bok_choy: [1.5, 1, 0, 65, 70, 100], kale: [4.3, 3.6, 0.1, 38, 67, 0],
  leek: [1.5, 1.8, 0.04, 20, 89, 90], celery: [0.7, 1.6, 0.04, 80, 101, 40], lettuce: [1.4, 1.3, 0, 28, 47, 0], asparagus: [2.2, 2.1, 0, 2, 134, 20],
  root_veg: [1.2, 3.5, 0, 10, 130, 100], tomato_paste: [4.3, 4.1, 0.1, 100, 262, 0], mayonnaise: [1.1, 0, 11, 635, 220, 0], peanut_butter: [25, 6, 10, 200, 258, 0],
  pork: [20, 0, 3.5, 60, 140, 0], beef: [20, 0, 5, 66, 140, 0], ham: [18, 0, 3.3, 1200, 140, 0], bacon: [37, 0, 14, 1717, 0, 10], turkey: [22, 0, 1, 70, 140, 0],
  stock: [1, 0, 0.1, 360, 240, 0], quinoa: [14, 7, 0.7, 5, 170, 0], couscous: [13, 5, 0.1, 10, 173, 0], barley: [10, 17, 0.3, 9, 200, 0],
  beans_cooked: [8, 6, 0.1, 5, 180, 0], flatbread: [9, 2.5, 1, 570, 0, 60], berries: [0.8, 2.5, 0, 1, 150, 0], avocado: [2, 6.7, 2.1, 7, 150, 200],
  pear: [0.4, 3.1, 0, 1, 140, 180], orange: [0.9, 2.4, 0, 0, 180, 130], herbs: [3.5, 3.5, 0.2, 40, 20, 0],
});

// Share of the ingredient's weight that counts as ADDED sugar.
export const SWEETENERS = { sugar: 1, jaggery: 0.95, honey: 0.82 };
const WHOLE_GRAIN = new Set(['wheat_flour', 'ragi', 'oats', 'dalia']);
const NO_QTY_GRAMS = { salt: 1.5, oil: 8, ghee: 8 }; // "to taste" / "as needed" assumptions, per recipe
const SPICE_NO_QTY = 1;
const LIQUID_ML = { milk: 1.03, curd: 1.03, oil: 0.92, ghee: 0.91, honey: 1.4, water: 1, lemon: 1, coconut_milk: 1, stock: 1, fish_sauce: 1.2, cream: 1 };

export function gramsFor(ing) {
  const key = ing.ingredient_key, f = key && FOOD[key];
  if (!f) return { g: null, why: 'unknown ingredient' };
  const [, , , , cup, piece] = f;
  const q = ing.quantity, u = ing.unit;
  if (q == null) {
    if (key in NO_QTY_GRAMS) return { g: NO_QTY_GRAMS[key], assumed: `${key} with no quantity assumed ${NO_QTY_GRAMS[key]} g per recipe` };
    if (ing.is_pantry) return { g: SPICE_NO_QTY, assumed: `${key} with no quantity assumed ${SPICE_NO_QTY} g per recipe` };
    return { g: null, why: 'no quantity' };
  }
  switch (u) {
    case 'g': return { g: q };
    case 'kg': return { g: q * 1000 };
    case 'oz': return { g: q * 28.35 };
    case 'lb': return { g: q * 453.6 };
    case 'ml': return { g: q * (LIQUID_ML[key] || 1) };
    case 'l': return { g: q * 1000 * (LIQUID_ML[key] || 1) };
    case 'cup': case 'bowl': case 'glass': return cup ? { g: q * cup } : { g: null, why: 'no cup weight' };
    case 'tbsp': return cup ? { g: (q * cup) / 16 } : { g: null, why: 'no tbsp weight' };
    case 'tsp': return cup ? { g: (q * cup) / 48 } : { g: null, why: 'no tsp weight' };
    case 'pinch': return { g: 0.3 * q };
    case 'handful': return { g: 30 * q };
    case 'sprig': return { g: 2 * q };
    case 'inch': return { g: (key === 'ginger' ? 10 : 5) * q };
    case 'piece': case 'slice': case 'clove': case 'stalk': case null: case undefined:
      return piece ? { g: q * piece } : { g: null, why: 'no piece weight' };
    default: return { g: null, why: `unit ${u}` };
  }
}

export function servingsFrom(text) {
  const m = String(text || '').match(/(\d+(?:\.\d+)?)/);
  const n = m ? +m[1] : null;
  return n && n > 0 && n <= 50 ? n : null;
}

// ingredients: rows of kp_recipe_ingredients. Returns totals per serving + audit trail.
export function estimateNutrition(ingredients, servings) {
  const assumptions = [], unweighed = [];
  let weighable = 0, considered = 0;
  const t = { protein: 0, fibre: 0, satFat: 0, sodium: 0, addedSugar: 0 };
  const keys = new Set();
  let topKey = null, topG = 0;
  for (const ing of ingredients) {
    keys.add(ing.ingredient_key);
    const w = gramsFor(ing);
    if (!ing.is_pantry) considered++;
    if (w.g == null) { if (!ing.is_pantry) unweighed.push({ line: ing.raw_text, why: w.why }); continue; }
    if (!ing.is_pantry) weighable++;
    if (w.assumed) assumptions.push(w.assumed);
    const [p, fi, sf, na] = FOOD[ing.ingredient_key], k = w.g / 100;
    t.protein += p * k; t.fibre += fi * k; t.satFat += sf * k; t.sodium += na * k;
    if (SWEETENERS[ing.ingredient_key]) t.addedSugar += w.g * SWEETENERS[ing.ingredient_key];
    if (!ing.is_pantry && ing.ingredient_key !== 'water' && w.g > topG) { topG = w.g; topKey = ing.ingredient_key; }
  }
  const coverage = considered ? weighable / considered : 0;
  const s = servings || 4;
  if (!servings) assumptions.push('servings not stated; assumed 4');
  const per = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Math.round((v / s) * 10) / 10]));
  return {
    per_serving: per, servings: s, top_key: topKey, coverage: Math.round(coverage * 100) / 100, unweighed, assumptions,
    flags: {
      maida: keys.has('maida'),
      wholeGrain: [...keys].some((k) => WHOLE_GRAIN.has(k)),
    },
  };
}
