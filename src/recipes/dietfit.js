// How a recipe fits a diet, separate from its Poshan Score. The score says how one serving does against a child's daily limits; it does not look at how the
// food is cooked or how often it should be eaten (a puri can score 100). This adds two things, both worked out from the recipe by plain rules:
//   tags      what the recipe is: fried, whole_grain, refined, sweet, high_fibre, high_protein, low_salt
//   how_often everyday | often | sometimes | occasionally, with the reasons in words
// The rules are written down here so they can be read, argued with and changed.
import { isDeepFried } from './nutrients.js';

export const HOW_OFTEN = ['everyday', 'often', 'sometimes', 'occasionally'];
export const HOW_OFTEN_LABEL = { everyday: 'Everyday', often: 'Often', sometimes: 'Sometimes', occasionally: 'Occasionally' };
export const HOW_OFTEN_HELP = { everyday: 'Fine most days, with variety', often: 'A few times a week', sometimes: 'About once a week', occasionally: 'A treat, once in a while' };

const REFINED_KEYS = new Set(['maida', 'rava', 'vermicelli', 'pasta', 'bread', 'flatbread', 'rice_noodles']);
const WHOLE_KEYS = new Set(['wheat_flour', 'ragi', 'oats', 'dalia']);
const WHOLE_TEXT = /\b(whole[- ]?wheat|wholemeal|atta|millets?|ragi|jowar|bajra|bajri|nachni|oats?|brown rice|multi-?grain|dalia|quinoa|barley)\b/i;
const SWEET_NAME = /\b(cakes?|cupcakes?|muffins?|brownies?|cookies?|halwa|kheer|payasam|payasa|ladoo|laddu|barfi|burfi|peda|gulab jamun|rasgulla|jalebi|pudding|ice cream|kulfi|dessert|candy|chocolate|truffle|pastry|donuts?|doughnuts?|sheera|shrikhand|mithai|fudge|milkshake|smoothie)\b/i;

// share limits for the tags that come from the numbers (the reference group, 4 to 6 years)
const LOW_SALT_SHARE = 20;           // sodium of one serving is at most this % of the day's reference
const HIGH_FIBRE_SHARE = 30;         // fibre of one serving is at least this % of the day's need (the score's own fibre check passes at 15%, so too many recipes pass it to be a useful filter)
const HIGH_PROTEIN_SHARE = 60;       // protein of one serving is at least this % of the day's RDA (the score's check passes at 15%)

const metric = (bands, id) => {
  const b = bands && (bands['4-6'] || Object.values(bands)[0]);
  return b && Array.isArray(b.metrics) ? b.metrics.find((m) => m.id === id) : null;
};

// name: the recipe's name; ingredients: kp_recipe_ingredients rows; result: what computeRecipeScore returned (needs score, bands, detail.inputs.topKey)
export function dietFit({ name, ingredients = [], result }) {
  if (!result || result.score == null) return { tags: null, how_often: null, why: null };
  const plainName = String(name || '').split('|')[0].replace(/sweet\s+(potato|corn)/gi, ' ');
  const real = ingredients.filter((i) => i && !i.is_pantry);
  const topKey = result.detail && result.detail.inputs ? result.detail.inputs.topKey : null;
  const lineOf = (key) => real.filter((i) => i.ingredient_key === key).map((i) => i.raw_text || '').join(' ');

  // "Potato Sagu (for Poori)" is a curry served with a fried bread, not a fried dish: only the words before "for" or "with" count
  const fried = isDeepFried(String(name || '').split(/\s+(?:for|with)\s+/i)[0], ingredients);
  const wholeGrain = real.some((i) => WHOLE_KEYS.has(i.ingredient_key) || WHOLE_TEXT.test(String(i.raw_text || '')));
  // refined: the main ingredient is a refined flour, white bread or pasta, unless its line says whole wheat, multigrain and the like
  const refined = !!topKey && REFINED_KEYS.has(topKey) && !WHOLE_TEXT.test(lineOf(topKey)) && !WHOLE_TEXT.test(plainName);
  const sugar = metric(result.bands, 'sugar');
  const sweet = SWEET_NAME.test(plainName) || (sugar && Number(sugar.value) >= 10);
  const fibre = metric(result.bands, 'fibre'), protein = metric(result.bands, 'protein'), sodium = metric(result.bands, 'sodium'), satfat = metric(result.bands, 'satfat');
  const highFibre = !!(fibre && Number(fibre.share) >= HIGH_FIBRE_SHARE), highProtein = !!(protein && Number(protein.share) >= HIGH_PROTEIN_SHARE);
  const lowSalt = !!(sodium && sodium.share != null && Number(sodium.share) <= LOW_SALT_SHARE);
  const highSat = !!(satfat && satfat.score === 0);

  const tags = [fried && 'fried', wholeGrain && 'whole_grain', refined && 'refined', sweet && 'sweet', highFibre && 'high_fibre', highProtein && 'high_protein', lowSalt && 'low_salt'].filter(Boolean);

  // where the score puts it, then one step down for each thing that makes it less of an everyday food (frying counts for two)
  const s = Number(result.score);
  let level = s >= 80 ? 0 : s >= 60 ? 1 : s >= 50 ? 2 : 3;
  if (fried) level += 2;
  if (refined) level += 1;
  if (sweet) level += 1;
  if (highSat) level += 1;
  level = Math.min(3, level);

  const bad = [fried && 'deep-fried', refined && 'mostly refined flour', sweet && 'a sweet treat', highSat && 'high in saturated fat'].filter(Boolean);
  const good = [wholeGrain && 'whole grain', highFibre && 'high in fibre', highProtein && 'high in protein'].filter(Boolean);
  const why = (bad.length ? bad : good.slice(0, 2)).join(', ') || null;
  return { tags: ',' + tags.join(',') + (tags.length ? ',' : ''), how_often: HOW_OFTEN[level], why };
}

// the filters a parent can switch on in Meal Ideas, and the SQL each one adds (every one needs the recipe to have been classified)
export const FIT_FILTERS = {
  nofry: { label: 'No deep-fried', sql: "r.diet_tags IS NOT NULL AND r.diet_tags NOT LIKE '%,fried,%'" },
  whole_grain: { label: 'Whole grain or millet', sql: "r.diet_tags LIKE '%,whole_grain,%'" },
  high_fibre: { label: 'High fibre', sql: "r.diet_tags LIKE '%,high_fibre,%'" },
  high_protein: { label: 'High protein', sql: "r.diet_tags LIKE '%,high_protein,%'" },
  low_salt: { label: 'Low salt', sql: "r.diet_tags LIKE '%,low_salt,%'" },
};
