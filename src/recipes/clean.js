// Small, pure helpers that tidy what parents read: ingredient lines, the method, credits, and which recipes count as a real meal.

// ---- credits: show the creator's name, not our internal label ("Swasthi's Recipes - Baby food" -> "Swasthi's Recipes") ----
export function creditName(name) {
  return String(name || '').split(/\s+[-–—]\s+/)[0].replace(/\s*\/\s*(instagram|youtube|facebook)\s*$/i, '').trim();
}

// ---- ingredient lines ----
const NUM = '(?:\\d+\\s+\\d+\\/\\d+|\\d+(?:[./]\\d+)?|[½¼¾⅓⅔⅛])';
const UNIT = '(?:cups?|tablespoons?|tbsps?|tbsp|teaspoons?|tsps?|tsp|grams?|gms?|g|kgs?|kilograms?|ml|millilit(?:er|re)s?|l|lit(?:er|re)s?|oz|ounces?|lbs?|pounds?|pinch(?:es)?|handfuls?|sprigs?|inch(?:es)?|cloves?|slices?|pieces?|stalks?|cans?|packets?|bunch(?:es)?)';
const QTY_RE = new RegExp(`^(?:about\\s+|approx\\.?\\s+)?${NUM}(?:\\s*(?:-|–|to)\\s*${NUM})?(?:\\s*${UNIT}\\b\\.?)?\\s*(?:of\\s+)?`, 'i');

// "salt (", "large onion (finely chopped", "oil ((or ghee))": make the brackets sensible
export function fixParens(input) {
  let s = String(input || '').replace(/\s+/g, ' ').trim();
  // one level of nesting becomes a single bracket: "(finely chopped, (about 1 cup))" -> "(finely chopped, about 1 cup)"
  for (let k = 0; k < 3; k++) {
    const next = s.replace(/\(([^()]*)\(([^()]*)\)([^()]*)\)/g, (m, a, b, c) => '(' + [a, b, c].map((x) => x.replace(/^[,\s]+|[,\s]+$/g, '')).filter(Boolean).join(', ') + ')');
    if (next === s) break; s = next;
  }
  s = s.replace(/\(\s*\)/g, '').replace(/\s+/g, ' ');
  const opens = (s.match(/\(/g) || []).length, closes = (s.match(/\)/g) || []).length;
  if (opens > closes) {
    const at = s.lastIndexOf('(');
    const inside = s.slice(at + 1).trim();
    s = inside.length >= 2 ? s.replace(/[,\s]+$/, '') + ')' : s.slice(0, at);
  } else if (closes > opens) { while ((s.match(/\)/g) || []).length > (s.match(/\(/g) || []).length) s = s.replace(/\)([^)]*)$/, '$1'); }
  return s.replace(/[,;:\s]+$/, '').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim();
}

// One ingredient row -> clean display parts: { qty_text, name, raw_text }
export function cleanIngredient(row) {
  let s = String(row.raw_text || row.name || '').replace(/^[\s•\-–—*]+/, '').replace(/\s+/g, ' ').trim();
  const m = s.match(QTY_RE);
  const qty = m ? m[0].replace(/\s+of\s*$/i, '').trim() : '';
  const name = fixParens(m ? s.slice(m[0].length) : s);
  return { qty_text: qty, name: name || String(row.name || '').trim(), raw_text: [qty, name].filter(Boolean).join(' ') };
}
const coreName = (n) => String(n || '').toLowerCase().replace(/\([^)]*\)/g, '').replace(/[^a-zऀ-ॿ ]/g, ' ').replace(/\s+/g, ' ').trim();
// the same ingredient listed twice with no quantity ("salt (optional)" and "salt (to taste)") is shown once
export function cleanIngredients(rows) {
  const out = [], seen = new Map();
  for (const r of rows) {
    const c = { ...r, ...cleanIngredient(r) };
    const key = coreName(c.name) + '|' + (c.qty_text || '').toLowerCase();
    if (seen.has(key)) {
      const at = seen.get(key);
      if (!/taste/i.test(out[at].name) && /taste/i.test(c.name)) out[at] = c;     // keep the "to taste" wording
      continue;
    }
    seen.set(key, out.length); out.push(c);
  }
  return out;
}

// ---- the method: when a page gives two methods one after the other (stovetop, then Instant Pot), keep the first ----
const stepText = (s) => (typeof s === 'string' ? s : s?.text || '');
const stepKey = (s) => stepText(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 4).join(' ');
export function singleMethod(steps) {
  if (!Array.isArray(steps) || steps.length < 6) return steps;
  // sections named after a method: prefer the stovetop / pan one
  const secs = [...new Set(steps.map((s) => s?.section).filter(Boolean))];
  if (secs.length > 1) {
    const pick = secs.find((x) => /stove|pan|kadai|tawa|traditional|regular/i.test(x)) || secs[0];
    return steps.filter((s) => !s.section || s.section === pick);
  }
  // the opening step comes back later: the second method starts there
  const first = stepKey(steps[0]);
  if (first.split(' ').length >= 2) for (let i = 3; i < steps.length; i++) if (stepKey(steps[i]) === first) return steps.slice(0, i);
  return steps;
}

// ---- a note for the youngest children ----
const CHILLI_KEYS = new Set(['green_chilli', 'red_chilli_powder', 'dry_red_chilli']);
export const hasChilli = (rows) => rows.some((r) => CHILLI_KEYS.has(r.ingredient_key) || /\b(chil+i|chill?y|chile|mirchi)\b/i.test(r.name || r.raw_text || ''));
export const KID_CHILLI_NOTE = 'Go easy on the chilli for under-5s: use less, or leave it out.';

// ---- is it a real meal? ----
// A base, a spice mix or a side is not a dinner; a bake or a waffle is not a lunch box. Some dishes are simply not what an Indian family cooks.
const PREP_END = /\b(batter|powder|paste|stock|marinade|dough|premix|podi|seasoning|spice mix|spice blend|masala mix|garam masala|rub|mirepoix|sofrito|soffritto|bechamel|roux|dressing|vinaigrette|chutney|raita|dip|salsa|pickle|achar|sauce)\s*$/i;
export function isPrepRecipe(name) {
  const core = String(name || '').split('|')[0].replace(/\([^)]*\)/g, ' ').replace(/\b(recipe|homemade|home made|how to make|easy|quick)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  if (/\b(with|using|in)\b/i.test(core)) return false;      // a soup made WITH a paste is still a meal
  return PREP_END.test(core) || /^(how to make|homemade)\s+(batter|dough|stock|paste|powder)/i.test(core);
}
const NOT_INDIAN = /\b(casserole|lasagn[ae]|pizza|burgers?|hot dogs?|mac(?:aroni)?\s*(?:and|&|n)\s*cheese|garlic bread|quiche|pot pie|tacos?|burritos?|enchiladas?|quesadillas?|nachos?|halloumi|pesto|minestrone|alfredo|meatloaf|pot roast|shepherd'?s pie|fish and chips|spaghetti (?:bolognese|carbonara)|carbonara|bolognese|risotto|gnocchi|ravioli|tiramisu|brownies?|cheesecake)\b/i;
export const isFamiliar = (name) => !NOT_INDIAN.test(String(name || ''));
// sweet or baked things that are not lunch or dinner
export const SWEET_OR_BAKED = /\b(waffles?|pancakes?|muffins?|cupcakes?|cakes?|cookies?|brownies?|donuts?|doughnuts?|ladoo|laddu|halwa|kheer|payasam|pudding|ice[- ]cream|smoothie|milkshake|popsicle|jam|custard)\b/i;
// The same rule on every shelf (Indian, Asian, European): a base is not a meal, and dishes like casserole, garlic bread or halloumi pasta are not everyday meals.
export function isRealMeal(name) {
  return !isPrepRecipe(name) && isFamiliar(name);
}
export const savouryOnly = (occasions) => occasions.length > 0 && occasions.every((o) => ['lunch', 'dinner', 'lunchbox'].includes(o));

// ---- the same dish twice ("Dhal Curry" from two sites) ----
export const dishKey = (name) => String(name || '').split('|')[0].toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/\b(recipe|easy|quick|simple|best|authentic|homemade|how to make|for kids|kids)\b/g, ' ').replace(/\bdhal\b/g, 'dal').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
