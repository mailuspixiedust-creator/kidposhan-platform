// Ingredient normalization: quantity + unit + canonical key.
// Used only for nutrition/scoring and for linking to commerce. The raw line is always kept.

const FRACTIONS = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125 };
const UNITS = [
  ['cup', /^(cups?|c)\b/i], ['tbsp', /^(tablespoons?|tbsps?|tbs|tbl|tblsps?|tblspn|tbspn)\b/i], ['tsp', /^(teaspoons?|tsps?|tspn)\b/i],
  ['kg', /^(kgs?|kilograms?)\b/i], ['g', /^(grams?|gms?|g)\b/i], ['l', /^(litres?|liters?|ltrs?|l)\b/i],
  ['ml', /^(ml|millilitres?|milliliters?)\b/i], ['pinch', /^(pinch(es)?)\b/i], ['inch', /^(inch(es)?|")\b/i],
  ['sprig', /^(sprigs?)\b/i], ['handful', /^(handfuls?|fistful)\b/i], ['clove', /^(cloves?|pods?)\b/i],
  ['piece', /^(pieces?|pcs?|nos?\.?|numbers?)\b/i], ['bowl', /^(bowls?)\b/i], ['glass', /^(glass(es)?)\b/i],
  ['slice', /^(slices?)\b/i],
];

// canonical key -> synonyms (English, Hindi, Bengali, Tamil, Telugu, Gujarati, Marathi transliterations)
const SYNONYMS = {
  carrot: ['carrot', 'carrots', 'gajar'], potato: ['potato', 'potatoes', 'aloo', 'alu', 'batata', 'urulaikizhangu'],
  onion: ['onion', 'onions', 'pyaz', 'pyaaz', 'kanda', 'vengayam'], tomato: ['tomato', 'tomatoes', 'tamatar', 'thakkali'],
  garlic: ['garlic', 'lahsun', 'lasun', 'poondu', 'rasun'], ginger: ['ginger', 'adrak', 'inji', 'ada'],
  green_chilli: ['green chilli', 'green chillies', 'green chili', 'hari mirch', 'green chilies'],
  spinach: ['spinach', 'palak', 'palong'], fenugreek_leaves: ['methi leaves', 'fenugreek leaves', 'methi'],
  green_peas: ['green peas', 'peas', 'matar', 'mattar', 'motorshuti'], cauliflower: ['cauliflower', 'gobi', 'phulkopi'],
  capsicum: ['capsicum', 'bell pepper', 'shimla mirch'], beetroot: ['beetroot', 'beet', 'chukandar'],
  sweet_potato: ['sweet potato', 'shakarkand', 'ranga alu'], bottle_gourd: ['bottle gourd', 'lauki', 'dudhi', 'lau'],
  pumpkin: ['pumpkin', 'kaddu', 'kumro', 'parangikai'], beans: ['french beans', 'beans', 'green beans'],
  cabbage: ['cabbage', 'patta gobi', 'bandhakopi'], corn: ['sweet corn', 'corn', 'bhutta', 'makai'],
  cucumber: ['cucumber', 'kheera', 'kakdi'], coriander_leaves: ['coriander leaves', 'cilantro', 'dhania', 'dhaniya', 'kothamalli'],
  mint: ['mint', 'pudina'], curry_leaves: ['curry leaves', 'kadi patta', 'karuveppilai'], lemon: ['lemon', 'lime', 'nimbu'],
  banana: ['banana', 'bananas', 'kela'], apple: ['apple', 'apples', 'seb'], mango: ['mango', 'aam'], dates: ['dates', 'khajur'],
  rice: ['rice', 'chawal', 'basmati', 'sona masoori'], poha: ['poha', 'flattened rice', 'aval', 'chira', 'chura'],
  rava: ['rava', 'sooji', 'suji', 'semolina'], wheat_flour: ['whole wheat flour', 'wheat flour', 'atta'],
  maida: ['maida', 'all purpose flour', 'all-purpose flour', 'refined flour'], besan: ['besan', 'gram flour', 'chickpea flour'],
  ragi: ['ragi', 'finger millet', 'nachni'], oats: ['oats', 'rolled oats'], dalia: ['dalia', 'broken wheat', 'daliya'],
  bread: ['bread'], vermicelli: ['vermicelli', 'semiya', 'seviyan'],
  moong_dal: ['moong dal', 'mung dal', 'yellow moong', 'pasi paruppu', 'split moong'], toor_dal: ['toor dal', 'arhar dal', 'tuvar dal', 'thuvaram paruppu'],
  masoor_dal: ['masoor dal', 'red lentils'], urad_dal: ['urad dal', 'ulundu'], chana_dal: ['chana dal', 'bengal gram'],
  chickpeas: ['chickpeas', 'kabuli chana', 'chole'], rajma: ['rajma', 'kidney beans'], sprouts: ['sprouts', 'sprouted moong'],
  paneer: ['paneer', 'cottage cheese', 'chhena'], milk: ['milk', 'doodh'], curd: ['curd', 'yogurt', 'yoghurt', 'dahi', 'thayir'],
  butter: ['butter'], cheese: ['cheese'], egg: ['egg', 'eggs', 'anda', 'dim'], chicken: ['chicken', 'murgi'],
  fish: ['fish', 'machh', 'rohu', 'katla', 'pomfret', 'bhetki'], prawn: ['prawn', 'prawns', 'shrimp', 'chingri'], mutton: ['mutton', 'lamb', 'goat meat'],
  peanuts: ['peanuts', 'groundnuts', 'moongphali', 'verkadalai'], cashew: ['cashew', 'cashews', 'kaju'], almonds: ['almonds', 'badam'],
  jaggery: ['jaggery', 'gur', 'gud', 'vellam', 'nolen gur'], honey: ['honey', 'shahad'], sugar: ['sugar', 'cheeni'],
  sesame: ['sesame', 'til', 'ellu'], makhana: ['makhana', 'fox nuts', 'lotus seeds'], coconut: ['coconut', 'nariyal', 'thengai'],
  mushroom: ['mushroom', 'mushrooms'], radish: ['radish', 'mooli'],
  // pantry
  salt: ['salt', 'namak', 'rock salt', 'sendha namak'], water: ['water'], oil: ['oil', 'refined oil', 'mustard oil', 'sunflower oil', 'groundnut oil', 'coconut oil'],
  ghee: ['ghee'], turmeric: ['turmeric', 'haldi', 'manjal'], cumin: ['cumin', 'jeera', 'jeeragam'], mustard_seeds: ['mustard seeds', 'rai', 'sarson', 'kadugu'],
  hing: ['hing', 'asafoetida', 'perungayam'], red_chilli_powder: ['red chilli powder', 'chilli powder', 'lal mirch'],
  garam_masala: ['garam masala'], coriander_powder: ['coriander powder', 'dhania powder'], black_pepper: ['black pepper', 'pepper', 'kali mirch', 'milagu'],
  baking_soda: ['baking soda', 'soda bicarbonate', 'eno', 'fruit salt'],
  // added later: common spices/staples that were going unrecognised
  dry_red_chilli: ['dry red chilli', 'dried red chilli', 'dry red chillies', 'red chilli', 'red chillies'], cardamom: ['cardamom', 'elaichi'],
  cinnamon: ['cinnamon', 'dalchini'], cloves: ['cloves', 'laung'], bay_leaf: ['bay leaf', 'bay leaves', 'tej patta'],
  fennel_seeds: ['fennel seeds', 'saunf'], oregano: ['oregano', 'dried oregano'], tamarind: ['tamarind', 'imli'],
  vanilla: ['vanilla extract', 'vanilla essence', 'vanilla'], baking_powder: ['baking powder'], vinegar: ['vinegar'],
  soy_sauce: ['soy sauce', 'soya sauce'], cornstarch: ['cornstarch', 'corn starch', 'cornflour', 'corn flour'], cocoa: ['cocoa powder', 'cocoa'],
  soya_chunks: ['soya chunks', 'soy chunks', 'meal maker', 'nutrela'], plantain: ['plantain', 'nendrapazham', 'raw banana', 'vazhakkai'],
  zucchini: ['zucchini', 'courgette'], raisins: ['raisins', 'kishmish'],
  brinjal: ['brinjal', 'eggplant', 'aubergine', 'baingan', 'vankaya'], okra: ['ladysfinger', 'lady finger', 'ladies finger', 'okra', 'bhindi', 'vendakkai'],
  broccoli: ['broccoli'], cream: ['fresh cream', 'cream', 'malai'],
};
export const PANTRY = new Set(['salt', 'water', 'oil', 'ghee', 'turmeric', 'cumin', 'mustard_seeds', 'hing', 'red_chilli_powder', 'garam_masala', 'coriander_powder', 'black_pepper', 'sugar', 'baking_soda', 'dry_red_chilli', 'cardamom', 'cinnamon', 'cloves', 'bay_leaf', 'fennel_seeds', 'oregano', 'vanilla', 'baking_powder', 'vinegar', 'soy_sauce', 'cornstarch', 'cocoa', 'tamarind']);

// ---- added for European and Southeast Asian recipes: ounces and pounds, and the common foods those recipes use ----
UNITS.push(['oz', /^(ounces?|oz)\b/i], ['lb', /^(pounds?|lbs?)\b/i], ['stalk', /^(stalks?)\b/i]);
Object.assign(SYNONYMS, {
  pasta: ['pasta', 'spaghetti', 'penne', 'macaroni', 'fusilli', 'tagliatelle', 'linguine', 'lasagne', 'lasagna', 'farfalle', 'rigatoni', 'orzo'],
  noodles: ['noodles', 'egg noodles', 'wheat noodles', 'ramen', 'udon', 'soba', 'instant noodles'],
  rice_noodles: ['rice noodles', 'rice vermicelli', 'glass noodles', 'vermicelli noodles', 'rice stick noodles', 'pad thai noodles', 'bun'],
  tofu: ['tofu', 'bean curd'], tempeh: ['tempeh'],
  coconut_milk: ['coconut milk', 'coconut cream'], fish_sauce: ['fish sauce'],
  lemongrass: ['lemongrass', 'lemon grass'], spring_onion: ['spring onion', 'spring onions', 'scallion', 'scallions', 'green onion', 'green onions'],
  bok_choy: ['bok choy', 'pak choi', 'pak choy', 'choy sum', 'chinese cabbage'], kale: ['kale'], leek: ['leek', 'leeks'], celery: ['celery'],
  lettuce: ['lettuce', 'salad leaves', 'romaine', 'rocket', 'arugula'], asparagus: ['asparagus'],
  root_veg: ['parsnip', 'parsnips', 'turnip', 'turnips', 'swede', 'celeriac'],
  tomato_paste: ['tomato paste', 'tomato puree', 'tomato purée'], mayonnaise: ['mayonnaise', 'mayo'], peanut_butter: ['peanut butter'],
  pork: ['pork', 'pork mince', 'pork belly'], beef: ['beef', 'beef mince', 'minced beef', 'steak'], ham: ['ham', 'gammon'], bacon: ['bacon', 'pancetta'],
  turkey: ['turkey', 'turkey mince'], stock: ['chicken stock', 'vegetable stock', 'beef stock', 'fish stock', 'stock', 'broth', 'stock cube', 'bouillon'],
  quinoa: ['quinoa'], couscous: ['couscous'], barley: ['barley', 'pearl barley'],
  beans_cooked: ['black beans', 'cannellini beans', 'white beans', 'haricot beans', 'butter beans', 'baked beans', 'borlotti beans', 'refried beans'],
  flatbread: ['tortilla', 'tortillas', 'wrap', 'wraps', 'pita', 'pitta', 'flatbread'],
  berries: ['strawberries', 'blueberries', 'raspberries', 'blackberries', 'berries', 'strawberry', 'blueberry', 'raspberry'],
  avocado: ['avocado', 'avocados'], pear: ['pear', 'pears'], orange: ['orange', 'oranges', 'orange juice'],
  herbs: ['basil', 'parsley', 'thyme', 'rosemary', 'dill', 'sage', 'chives', 'mixed herbs', 'italian seasoning', 'coriander stalks', 'thai basil'],
});
const ALSO = {
  cheese: ['cheddar', 'mozzarella', 'parmesan', 'gouda', 'feta', 'halloumi', 'ricotta', 'mascarpone', 'emmental', 'gruyere', 'grated cheese'],
  fish: ['salmon', 'tuna', 'cod', 'haddock', 'sardines', 'mackerel', 'anchovies', 'white fish', 'sea bass', 'tilapia', 'trout', 'basa'],
  oil: ['olive oil', 'vegetable oil', 'sesame oil', 'canola oil', 'rapeseed oil', 'cooking oil', 'peanut oil'],
  sugar: ['caster sugar', 'brown sugar', 'palm sugar', 'icing sugar', 'powdered sugar', 'granulated sugar', 'coconut sugar'],
  maida: ['plain flour', 'self-raising flour', 'self raising flour', 'bread flour', 'strong flour', 'cake flour'],
  rice: ['jasmine rice', 'sticky rice', 'glutinous rice', 'arborio rice', 'risotto rice', 'brown rice', 'basmati rice'],
  vinegar: ['rice vinegar', 'balsamic vinegar', 'white wine vinegar', 'apple cider vinegar', 'cider vinegar'],
  soy_sauce: ['oyster sauce', 'hoisin sauce', 'tamari', 'kecap manis', 'dark soy sauce', 'light soy sauce'],
  masoor_dal: ['lentils', 'brown lentils', 'green lentils', 'puy lentils'],
  pumpkin: ['butternut squash', 'squash'], capsicum: ['red pepper', 'green pepper', 'yellow pepper', 'peppers'],
  red_chilli_powder: ['chilli flakes', 'chili flakes', 'red pepper flakes', 'paprika', 'cayenne', 'cayenne pepper'],
  ginger: ['galangal'], onion: ['shallot', 'shallots', 'red onion', 'red onions'],
  green_chilli: ['birds eye chilli', "bird's eye chilli", 'thai chilli', 'fresh chilli', 'jalapeno', 'jalapeño', 'red chillies fresh'],
  tomato: ['chopped tomatoes', 'tinned tomatoes', 'canned tomatoes', 'passata', 'cherry tomatoes', 'plum tomatoes'],
  corn: ['sweetcorn'], cream: ['sour cream', 'double cream', 'single cream', 'heavy cream', 'whipping cream', 'cream cheese'],
  salt: ['sea salt', 'kosher salt'], curd: ['greek yogurt', 'greek yoghurt', 'natural yogurt', 'plain yogurt'],
};
for (const [k, w] of Object.entries(ALSO)) SYNONYMS[k].push(...w);
PANTRY.add('herbs');

// Build a longest-first matcher so "green chilli" wins over "chilli", "sweet potato" over "potato".
const MATCHERS = Object.entries(SYNONYMS)
  .flatMap(([key, words]) => words.map((w) => [key, w]))
  .sort((a, b) => b[1].length - a[1].length)
  .map(([key, w]) => [key, new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(s|es)?($|[^a-z])`, 'i')]);

export function ingredientKey(text) {
  const t = String(text).toLowerCase();
  for (const [key, re] of MATCHERS) if (re.test(t)) return key;
  return null;
}

function parseNumber(s) {
  s = s.trim();
  for (const [f, v] of Object.entries(FRACTIONS)) {
    if (s.includes(f)) { const whole = parseFloat(s.replace(f, '')) || 0; return whole + v; }
  }
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return +mixed[1] + mixed[2] / mixed[3];
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac) return frac[1] / frac[2];
  const range = s.match(/^(\d+(?:\.\d+)?)\s*(?:-|to|–)\s*(\d+(?:\.\d+)?)$/);
  if (range) return (+range[1] + +range[2]) / 2;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

// "Oil - 2 tblsp", "Moong Dal / Pasi Paruppu - 1/2 cup", "Salt a pinch": the quantity comes AFTER the name.
const TRAILING = /^(.+?)\s*(?:[-–:]|\ba\b)\s*((?:\d+\s+)?\d+\/\d+|\d+(?:\.\d+)?|[½¼¾⅓⅔⅛]|pinch)\s*(.*)$/i;

export function parseIngredientLine(raw) {
  let rest = raw.replace(/^[•\-*▢☐□\s]+/, '').trim();
  let quantity = null, unit = null, trailingName = null;
  const num = rest.match(/^((?:\d+\s+)?\d+\/\d+|\d+(?:\.\d+)?\s*(?:-|to|–)\s*\d+(?:\.\d+)?|\d*\s*[½¼¾⅓⅔⅛]|\d+(?:\.\d+)?)\s*/);
  if (num) { quantity = parseNumber(num[1]); rest = rest.slice(num[0].length); }
  if (quantity == null) {
    const h = rest.match(/^(.*?)\s*\b(?:a|1)\s+(?:small\s+|big\s+)?(handful|sprig|pinch)\b/i);
    if (h && h[1].length <= 60) { quantity = 1; unit = h[2].toLowerCase(); trailingName = h[1] || rest; }
  }
  if (quantity == null) {
    const t = rest.match(TRAILING);
    if (t && t[1].length <= 80) {
      const isPinch = /^pinch$/i.test(t[2]);
      const q = isPinch ? 1 : parseNumber(t[2]);
      if (q != null) { quantity = q; trailingName = t[1]; unit = isPinch ? 'pinch' : null; rest = isPinch ? t[1] : t[3]; }
    }
  }
  if (!unit) for (const [u, re] of UNITS) {
    const m = rest.match(re);
    if (m) { unit = u; rest = rest.slice(m[0].length).replace(/^\s*(of\s+)?/i, ''); break; }
  }
  if (trailingName) rest = trailingName;
  // "Salt to taste", "Oil as needed" -> no quantity
  const name = rest.split(/,|\bto taste\b|\bas (needed|required)\b|\bfor\b/i)[0].replace(/\s+/g, ' ').trim();
  const key = ingredientKey(rest) || ingredientKey(raw);
  return {
    raw_text: raw,
    quantity, unit,
    name: name || raw,
    ingredient_key: key,
    is_pantry: key ? PANTRY.has(key) : /to taste/i.test(raw),
  };
}

export function displayName(key, fallback) {
  if (!key) return fallback;
  return SYNONYMS[key]?.[0] || key.replace(/_/g, ' ');
}
