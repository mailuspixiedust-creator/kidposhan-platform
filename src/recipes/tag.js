// Deterministic tagging. Every tag carries a reason so a reviewer can see why.
// Anything uncertain sets needsReview; nothing is guessed silently.

const NONVEG = ['chicken', 'fish', 'prawn', 'mutton'];
// Words that make a dish non-vegetarian. They are searched in the recipe name and in EVERY ingredient line, because some sites
// put several ingredients on one line ("1/2 kg chicken, 2 onions, ...") and the per-ingredient key only sees one of them.
const NONVEG_WORDS = /\b(chicken|mutton|lamb|goat meat|beef|pork|bacon|ham|sausages?|salami|pepperoni|turkey|duck|fish|prawns?|shrimps?|crab|lobster|squid|calamari|oysters?|clams?|mussels?|tuna|salmon|sardines?|anchov(?:y|ies)|mackerel|pomfret|rohu|hilsa|katla|bhetki|bombil|gelatin(?:e)?|lard|tallow|fish sauce|oyster sauce|gosht|murgh|maach|machhi|jhinga|chingri|kozhi|meen|murgi|machh)\b/gi;
// Phrases that contain those words but are not non-vegetarian ("eggless", "soya chicken", "chicken flavour masala"...).
const NONVEG_EXEMPT = /\b(?:vegetarian|veg|vegan|mock|soya|soy|eggless|egg[- ]?free|plant[- ]based)\s+(?:chicken|mutton|meat|fish|prawn|egg)s?\b|\b(?:egg[- ]?less|egg[- ]?free|without eggs?|no eggs?)\b|\bchicken[- ]?(?:flavou?r(?:ed)?|style|seasoning)\b|\bfish[- ]?(?:shaped|free)\b/gi;

// Diet signals found anywhere in the text. Pure, so it can be reused to re-check recipes that are already stored.
export function detectDiet(name, ingredients) {
  const clean = (t) => String(t || '').replace(NONVEG_EXEMPT, ' ');
  const texts = [clean(name), ...ingredients.map((i) => clean(i.raw_text))];
  const meat = new Set();
  for (const t of texts) for (const m of t.matchAll(NONVEG_WORDS)) meat.add(m[1].toLowerCase());
  const egg = texts.some((t) => /\beggs?\b|\banda\b/i.test(t));
  // Mayonnaise is normally made with egg. Only counted when it is an ingredient in its own right, not an "(or mayonnaise)" alternative.
  const mayo = ingredients.some((i) => { const t = clean(i.raw_text); const raw = String(i.raw_text || ''); if (/egg[- ]?less|egg[- ]?free|vegan|veg(?:etarian)?\s+mayo/i.test(raw)) return false; const m = /\bmayonnaise\b/i.exec(t); return !!m && !/\bor\b|\(/.test(t.slice(0, m.index)); });
  return { meat: [...meat], egg, mayo };
}

const JAIN_EXCLUDED = ['onion', 'garlic', 'potato', 'carrot', 'beetroot', 'radish', 'ginger', 'sweet_potato', 'mushroom'];

const OCCASION_WORDS = {
  breakfast: /\b(breakfast|dosa|idli|idly|upma|poha|paratha|parotta|thepla|cheela|chilla|pancake|uttapam|appam|porridge|kanji|dalia|daliya|oats|pongal|pesarattu|luchi|toast|smoothie)\b/i,
  lunchbox: /\b(lunch ?box|tiffin|dabba|school lunch|packed lunch|without reheating)\b/i,
  lunch: /\b(lunch|rice|pulao|pulav|biryani|khichdi|khichuri|sambar|rasam|dal|curry|sabzi|sabji|kootu|thoran|bhaat|bath|rajma|chole|kadhi)\b/i,
  snack_4pm: /\b(snack|evening|tikki|cutlet|chaat|sandwich|ladoo|laddu|muffin|cookies?|makhana|sundal|vada|bonda|pakora|pakoda|roll|frankie|wrap|nuggets?|fingers|balls|bites|energy bar|chikki|mathri|dhokla|kebab)\b/i,
  dinner: /\b(dinner|soup|khichdi|khichuri|curry|dal|roti|phulka|chapati|stew|pasta|noodles)\b/i,
};
const CATEGORY_MAP = [
  [/breakfast/i, 'breakfast'], [/lunch ?box|tiffin/i, 'lunchbox'], [/lunch|main course|rice/i, 'lunch'],
  [/snack|starter|appetizer/i, 'snack_4pm'], [/dinner|soup|main course/i, 'dinner'],
];

const SEASON_INGREDIENTS = {
  summer: ['mango', 'cucumber', 'bottle_gourd', 'mint', 'curd'],
  winter: ['carrot', 'green_peas', 'cauliflower', 'fenugreek_leaves', 'spinach', 'beetroot', 'radish', 'sweet_potato', 'jaggery', 'sesame'],
  monsoon: ['corn'],
};
const SEASON_WORDS = {
  summer: /\b(chilled|cold|raita|lassi|chaas|buttermilk|aam panna|sharbat|kulfi|popsicle|smoothie)\b/i,
  winter: /\b(halwa|soup|sarson|til|gajar|undhiyu|bajra)\b/i,
  monsoon: /\b(pakora|pakoda|bhutta|bhajji|bhaji|soup|khichuri|corn)\b/i,
};

export function tagRecipe({ name = '', description = '', category = [], keywords = '', ingredients = [], sourceUrl = '', collectionHint = '' }) {
  const keys = new Set(ingredients.map((i) => i.ingredient_key).filter(Boolean));
  const allText = [name, description, category.join(' '), keywords, ingredients.map((i) => i.raw_text).join(' ')].join(' ');
  const titleText = [name, category.join(' '), keywords].join(' ');
  const reasons = {};
  let needsReview = false;

  // ---- diet ----
  let diet;
  const found = detectDiet(name, ingredients);
  const meat = found.meat;
  if (meat.length) { diet = 'nonveg'; reasons.diet = `contains ${meat.join(', ')}`; }
  else if (found.egg) { diet = 'egg'; reasons.diet = 'contains egg'; }
  else if (found.mayo) { diet = 'egg'; reasons.diet = 'contains mayonnaise, normally made with egg: check whether it is eggless'; needsReview = true; }
  else {
    const blockers = JAIN_EXCLUDED.filter((k) => keys.has(k));
    const unknown = ingredients.filter((i) => !i.ingredient_key).length;
    if (!blockers.length && unknown === 0) { diet = 'jain'; reasons.diet = 'no onion/garlic/root vegetables found'; }
    else if (!blockers.length) { diet = 'veg'; reasons.diet = `possibly Jain; ${unknown} unrecognised ingredient(s) - review`; }
    else { diet = 'veg'; reasons.diet = `not Jain: ${blockers.join(', ')}`; }
  }

  // ---- age (months) ----
  let ageMin = 12, ageMax = 144;
  const ageNotes = [];
  if (/\b(baby|babies|infant|toddler|first food|6 ?months?|puree|weaning|stage [1-4])\b/i.test(allText)) {
    ageMin = /\btoddler\b/i.test(titleText) && !/\bbaby|babies|infant\b/i.test(titleText) ? 12 : 6;
    ageNotes.push(`marked for babies/toddlers -> ${ageMin}m+`);
    if (ageMin === 6 && (keys.has('salt') || keys.has('sugar'))) { ageMin = 12; ageNotes.push('has added salt/sugar -> 12m+'); }
  } else {
    ageNotes.push('general recipe -> 12m+ (salt/sugar)');
  }
  if (keys.has('honey')) { ageMin = Math.max(ageMin, 12); ageNotes.push('honey -> 12m+'); }
  if (/\b(whole|roasted|fried)\s+(peanuts|cashews?|almonds|nuts|chana)\b|\bpopcorn\b|\bchikki\b/i.test(allText)) {
    ageMin = Math.max(ageMin, 60); ageNotes.push('whole nuts/hard pieces (choking) -> 5y+');
  }
  if (keys.has('green_chilli') || keys.has('red_chilli_powder')) { ageMin = Math.max(ageMin, 24); ageNotes.push('chilli -> 2y+ (adjust spice)'); }
  if (/\blunch ?box|tiffin\b/i.test(titleText + ' ' + collectionHint)) { ageMin = Math.max(ageMin, 36); ageNotes.push('school lunchbox -> 3y+'); }
  reasons.age = ageNotes.join('; ');

  // ---- occasions ----
  const occ = new Set();
  for (const [o, re] of Object.entries(OCCASION_WORDS)) if (re.test(titleText)) occ.add(o);
  for (const c of category) for (const [re, o] of CATEGORY_MAP) if (re.test(c)) occ.add(o);
  if (/lunch ?box|tiffin/i.test(collectionHint)) occ.add('lunchbox');
  if (occ.has('lunchbox')) occ.add('lunch');
  if (!occ.size) { needsReview = true; reasons.occasion = 'no occasion signal - review'; }
  else reasons.occasion = [...occ].join(', ');

  // ---- seasons ----
  const seasons = new Set();
  for (const [s, list] of Object.entries(SEASON_INGREDIENTS)) if (list.some((k) => keys.has(k))) seasons.add(s);
  for (const [s, re] of Object.entries(SEASON_WORDS)) if (re.test(titleText)) seasons.add(s);
  if (!seasons.size || seasons.size === 3) { seasons.clear(); seasons.add('all'); }
  reasons.season = [...seasons].join(', ');

  return {
    diet, age_min_months: ageMin, age_max_months: ageMax,
    occasions: [...occ], seasons: [...seasons], reasons, needsReview,
  };
}
