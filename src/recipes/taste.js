// Search by taste: "tangy meal for 9 year", "mild dinner for toddler", "sweet snack for 5 year old".
//   parseQuery reads the age, the meal, the diet and the taste words out of what a parent typed; what is left are ordinary words (a dish or a brand).
//   tagRecipe works out, from a recipe's name and ingredients, how tangy, spicy, sweet, creamy or crunchy it is. The tags are worked out once for every
//   recipe in the background (tastesBackfill) and kept in kp_recipe_tastes, so a search is a cheap lookup and not a scan of every ingredient line.

// How each taste shows up in a recipe. A word in the NAME counts 3, an ingredient counts 1 (a weak hint counts less); a recipe has the taste when it reaches the threshold.
const TASTES = {
  tangy: { threshold: 2, strong: /\b(tangy|tanginess|lemon|lemony|lime|nimbu|tamarind|imli|raw mango|kairi|amchur|aamchur|amchoor|kokum|vinegar|pickle|achar|chaat|chat masala|chatpata|khatta|khatti|sour|tart|anardana|sumac|sauerkraut)\b/i, weak: /\b(tomato|tomatoes|tamatar|curd|dahi|yogh?urt|buttermilk|chaas|orange|pineapple|green apple)\b/i },
  spicy: { threshold: 3, strong: /\b(spicy|chilli|chilies|chili|chillies|mirchi|schezwan|szechuan|peri peri|jalapeno|jalape|tikka|tandoori|fiery|sriracha|chipotle|arrabbiata|hot sauce|red chilli powder|cayenne)\b/i, weak: /\b(ginger|adrak|garam masala|masala|pepper|kali mirch|hot)\b/i },
  sweet: { threshold: 3, strong: /\b(sweet|kheer|payasam|payesh|halwa|halva|ladoo|laddu|barfi|burfi|cake|cookies?|brownie|pudding|dessert|candy|chocolate|cocoa|jaggery|gur|honey|dates?|sugar|syrup|raisins?|condensed milk|custard|sheera|shrikhand|phirni|rabri|jalebi|pancakes?)\b/i, weak: /\b(banana|mango|apple|coconut|figs?|anjeer|strawberr(?:y|ies)|berry|berries)\b/i },
  creamy: { threshold: 3, strong: /\b(creamy|cream|cheese|cheesy|malai|korma|makhani|alfredo|white sauce|bechamel|mayo|mayonnaise|coconut milk|mac and cheese|butter chicken|custard|mousse)\b/i, weak: /\b(butter|paneer|milk|curd|yogh?urt|ghee)\b/i },
  crunchy: { threshold: 3, strong: /\b(crunchy|crispy|crisp|deep fried|fritters?|pakora|pakoda|bhajiya|bhaji|cutlets?|tikki|nuggets?|chips|papad|nachos|sev|murukku|khakhra|bhel|samosa|kachori|vada|wada|puri|poori|golgappa|pani puri|fingers?|crackers?|popcorn|makhana|crunch)\b/i, weak: /\b(nuts?|peanuts?|almonds?|cashews?|breadcrumbs?|panko|sesame|rava|semolina|corn flakes|toast|roasted)\b/i },
};
export const TASTE_NAMES = Object.keys(TASTES);
export const nameHasTaste = (name, taste) => !!TASTES[taste] && TASTES[taste].strong.test(String(name || ''));

// What a parent might type for each taste
const TASTE_WORDS = {
  tangy: ['tangy', 'sour', 'khatta', 'khatti', 'tart', 'lemony', 'zesty', 'tanginess', 'chatpata', 'chatpati'],
  spicy: ['spicy', 'hot', 'teekha', 'tikha', 'masaledar', 'fiery', 'chatpata', 'chatpati'],
  sweet: ['sweet', 'meetha', 'sweets', 'sugary', 'dessert'],
  creamy: ['creamy', 'cheesy', 'rich', 'malai'],
  crunchy: ['crunchy', 'crispy', 'crisp', 'kurkura', 'kurkure'],
};
const MILD = ['mild', 'bland', 'gentle', 'soft', 'plain'];

// { tangy: 4, sweet: 3 }: the tastes a recipe has, from its name and the text of its ingredient lines
export function tagRecipe(name, ingredientTexts) {
  const n = String(name || ''), ings = (ingredientTexts || []).map((t) => String(t || ''));
  const out = {};
  for (const [taste, def] of Object.entries(TASTES)) {
    let score = 0;
    if (def.strong.test(n)) score += 3;
    else if (def.weak.test(n)) score += 1;
    const strongIngs = new Set(), weakIngs = new Set();
    for (const t of ings) { const m = t.match(def.strong); if (m) strongIngs.add(m[0].toLowerCase()); else { const w = t.match(def.weak); if (w) weakIngs.add(w[0].toLowerCase()); } }
    score += strongIngs.size + Math.min(1, weakIngs.size) * 0.5;              // each different strong ingredient counts 1; weak ones together count half at most
    score = Math.round(score * 10) / 10;
    if (score >= def.threshold) out[taste] = Math.min(9, Math.round(score));
  }
  return out;
}

const FILLER = new Set(['for', 'a', 'an', 'the', 'my', 'me', 'year', 'years', 'old', 'yr', 'yrs', 'yo', 'kid', 'kids', 'child', 'children', 'boy', 'girl', 'something', 'recipe', 'recipes', 'idea', 'ideas', 'food', 'foods', 'dish', 'dishes', 'good', 'best', 'easy', 'quick', 'with', 'and', 'or', 'to', 'of', 'in', 'on', 'that', 'is', 'are', 'some', 'any', 'i', 'want', 'need', 'looking', 'show', 'give', 'make', 'cook', 'tasty', 'yummy', 'delicious', 'healthy', 'ideas']);
const MEALS = [
  [/^(breakfast|brunch)$/, ['breakfast']], [/^(tiffin|lunchbox|lunch-box)$/, ['lunchbox']], [/^(lunch)$/, ['lunch', 'lunchbox']], [/^(dinner|supper)$/, ['dinner']],
  [/^(snack|snacks|snacking|munch|munchies|evening|4pm)$/, ['snack_4pm']], [/^(meal|meals)$/, ['breakfast', 'lunch', 'lunchbox', 'dinner']],
];
export const MEAL_LABEL = { breakfast: 'breakfast', lunch: 'lunch', lunchbox: 'lunchbox', dinner: 'dinner', snack_4pm: 'snack' };

// "9 year old", "for 9", "9yo", "9-year-old", "18 months", "toddler", "teen", "adult"
function ageFrom(q) {
  const s = String(q).toLowerCase();
  let m = s.match(/\b(\d{1,2})\s*[- ]?\s*(?:months?|mos?|mths?)\b/);
  if (m && +m[1] >= 6 && +m[1] <= 36) return { months: +m[1], hit: m[0] };
  m = s.match(/\b(\d{1,2})\s*[- ]?\s*(?:years?|yrs?|yr|yo|y\.?o\.?|y)\b(?:\s*[- ]?\s*old)?/);
  if (m && +m[1] >= 1 && +m[1] <= 60) return { months: +m[1] * 12, hit: m[0] };
  m = s.match(/\bfor\s+(?:a\s+|an\s+|my\s+)?(\d{1,2})\b(?!\s*(?:g|gm|kg|ml|min|minutes?|%))/);
  if (m && +m[1] >= 1 && +m[1] <= 60) return { months: +m[1] * 12, hit: m[0] };
  m = s.match(/\b(toddlers?|babies|baby|infant|preschoolers?|teens?|teenagers?|adults?|grown-?ups?)\b/);
  if (m) { const w = m[1]; return { months: /toddler/.test(w) ? 24 : /baby|babies|infant/.test(w) ? 9 : /preschool/.test(w) ? 54 : /teen/.test(w) ? 168 : 300, hit: m[0] }; }
  return null;
}

// What the search should do: { tastes, mild, meals, mealWord, diet, ageMonths, words (what is left), smart (true when anything was understood) }
export function parseQuery(q) {
  const text = String(q || '').toLowerCase().replace(/[^a-z0-9\s'&-]/g, ' ').replace(/\s+/g, ' ').trim();
  const out = { tastes: [], mild: false, meals: [], mealWord: '', diet: null, ageMonths: null, words: [], smart: false };
  const age = ageFrom(text);
  let rest = text;
  if (age) { out.ageMonths = age.months; rest = rest.replace(age.hit, ' '); }
  const toks = rest.split(/\s+/).filter(Boolean);
  const left = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i], next = toks[i + 1];
    if (/^(non|non-veg|nonveg)$/.test(t) && (t !== 'non' || /^veg/.test(next || ''))) { out.diet = 'nonveg'; if (t === 'non') i++; continue; }
    if (/^(not|no|without)$/.test(t) && /^(spicy|hot|chilli|chili)$/.test(next || '')) { out.mild = true; i++; continue; }
    if (/^(veg|vegetarian)$/.test(t)) { out.diet = 'veg'; continue; }
    if (t === 'jain') { out.diet = 'jain'; continue; }
    if (/^(egg|eggs|eggetarian)$/.test(t)) { out.diet = 'egg'; continue; }
    if (MILD.includes(t)) { out.mild = true; continue; }
    const taste = TASTE_NAMES.filter((k) => TASTE_WORDS[k].includes(t));
    if (taste.length) { for (const k of taste) if (!out.tastes.includes(k)) out.tastes.push(k); continue; }
    const meal = MEALS.find(([re]) => re.test(t));
    if (meal) { out.meals = [...new Set([...out.meals, ...meal[1]])]; out.mealWord = out.mealWord || t; continue; }
    if (FILLER.has(t)) continue;
    left.push(t);
  }
  out.words = left.slice(0, 5).filter((w) => w.length >= 2);
  out.smart = !!(out.tastes.length || out.mild || out.meals.length || out.diet || out.ageMonths != null);
  return out;
}

const MAX_IDS_PER_QUERY = 50;
// One recipe's tags, kept for search. Runs a few recipes per cron run until every recipe has been looked at; a new recipe is picked up by itself.
export async function tastesBackfill(env, { limit = 80 } = {}) {
  const { results } = await env.DB.prepare(`SELECT id, name FROM kp_recipes WHERE taste_checked_at IS NULL AND review_status = 'approved' ORDER BY id LIMIT ?`).bind(Math.min(limit, 300)).all();
  if (!results.length) return { looked: 0 };
  const ids = results.map((r) => r.id);
  // the live database allows only 100 values in one query, so the ingredient lines are fetched 50 recipes at a time
  const byRecipe = new Map();
  for (let i = 0; i < ids.length; i += MAX_IDS_PER_QUERY) {
    const part = ids.slice(i, i + MAX_IDS_PER_QUERY);
    const { results: ings } = await env.DB.prepare(`SELECT recipe_id, name, raw_text FROM kp_recipe_ingredients WHERE recipe_id IN (${part.map(() => '?').join(',')})`).bind(...part).all();
    for (const x of ings) { if (!byRecipe.has(x.recipe_id)) byRecipe.set(x.recipe_id, []); byRecipe.get(x.recipe_id).push(`${x.name || ''} ${x.raw_text || ''}`); }
  }
  const stmts = []; let tagged = 0;
  for (const r of results) {
    const tags = tagRecipe(r.name, byRecipe.get(r.id) || []);
    stmts.push(env.DB.prepare('DELETE FROM kp_recipe_tastes WHERE recipe_id = ?').bind(r.id));
    for (const [taste, n] of Object.entries(tags)) { stmts.push(env.DB.prepare('INSERT INTO kp_recipe_tastes (recipe_id, taste, n) VALUES (?, ?, ?)').bind(r.id, taste, n)); tagged++; }
    stmts.push(env.DB.prepare(`UPDATE kp_recipes SET taste_checked_at = datetime('now') WHERE id = ?`).bind(r.id));
  }
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  return { looked: results.length, tags: tagged };
}
