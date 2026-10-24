// "The biggest claim": the thing a pack's name brags about (honey, atta, multigrain, real fruit...), checked against its own ingredient list.
// Ingredients are listed from the most to the least by weight, and some packs print a percentage for the named ingredient. We report only
// what the label itself says: the percentage if it is printed, otherwise where the ingredient stands in the list. We never guess an amount.

// word in the name -> how to recognise it in the ingredient list
const CLAIMS = [
  { name: 'Multigrain', say: /multi-?\s?grain|\d+\s?grain/i, find: /\b(wheat|oats?|ragi|jowar|sorghum|bajra|pearl millet|millet|barley|maize|corn|rice|quinoa|amaranth|rye|buckwheat|soy)\b/i, many: true },
  { name: 'Whole wheat', say: /whole ?wheat|wholemeal|\batta\b/i, find: /whole ?wheat|wholemeal|\batta\b/i, not: /maida|refined wheat/i },
  { name: 'Honey', say: /\bhoney\b/i, find: /\bhoney\b/i },
  { name: 'Oats', say: /\boats?\b|oatmeal/i, find: /\boats?\b/i },
  { name: 'Ragi', say: /\bragi\b|nachni|finger millet/i, find: /\bragi\b|nachni|finger millet/i },
  { name: 'Millet', say: /\bmillets?\b|jowar|bajra/i, find: /millet|jowar|sorghum|bajra/i },
  { name: 'Real fruit', say: /\bfruit\b|real fruit/i, find: /fruit|pulp|puree|juice|mango|apple|orange|guava|banana|grape|pineapple|lychee|strawberry|berry|berries/i },
  { name: 'Mango', say: /\bmango\b/i, find: /mango/i },
  { name: 'Orange', say: /\borange\b/i, find: /orange/i },
  { name: 'Apple', say: /\bapple\b/i, find: /apple/i },
  { name: 'Tomato', say: /\btomato\b/i, find: /tomato/i },
  { name: 'Chocolate', say: /\bchoco(late)?\b|\bcocoa\b|\bchocos\b/i, find: /cocoa|chocolate/i },
  { name: 'Cheese', say: /\bcheese\b|\bcheesy\b/i, find: /cheese/i },
  { name: 'Butter', say: /\bbutter\b/i, find: /\bbutter\b|butter oil|milk fat/i },
  { name: 'Ghee', say: /\bghee\b/i, find: /\bghee\b|milk fat/i },
  { name: 'Milk', say: /\bmilk\b/i, find: /\bmilk\b|milk solids/i },
  { name: 'Almond', say: /\balmonds?\b|\bbadam\b/i, find: /almond/i },
  { name: 'Peanut', say: /\bpeanuts?\b/i, find: /peanut|groundnut/i },
  { name: 'Coconut', say: /\bcoconut\b/i, find: /coconut/i },
  { name: 'Paneer', say: /\bpaneer\b/i, find: /paneer|milk/i },
  { name: 'Vegetables', say: /\bvegetables?\b|\bveggies?\b/i, find: /vegetable|carrot|peas?\b|beans?\b|spinach|potato|onion|cabbage|capsicum|beetroot|pumpkin|corn/i },
  { name: 'Sweet corn', say: /sweet ?corn/i, find: /sweet ?corn|\bcorn\b|maize/i },
  { name: 'Rice', say: /\brice\b/i, find: /\brice\b/i },
  { name: 'Sunflower seeds', say: /sunflower/i, find: /sunflower/i },
  { name: 'Dates', say: /\bdates?\b|khajur/i, find: /\bdates?\b|khajur/i },
  { name: 'Jaggery', say: /jaggery|\bgur\b/i, find: /jaggery|\bgur\b/i },
];

// the top-level items of an ingredient list (commas inside brackets do not split)
export function splitList(list) {
  const items = Array.isArray(list) ? list : String(list || '').split(',');
  return items.map((x) => String(x).replace(/\s+/g, ' ').trim()).filter(Boolean);
}
const pct = (s) => { const m = String(s).match(/(\d+(?:\.\d+)?)\s*%/); return m ? Math.round(parseFloat(m[1]) * 100) / 100 : null; };
// the percentage printed for this ingredient: on its own item, or in the bracket that follows its name
function percentFor(item, re) {
  const m = String(item).match(re);
  if (!m) return null;
  const after = String(item).slice(m.index);
  const near = after.match(/^[^%]{0,60}?(\d+(?:\.\d+)?)\s*%/);
  return near ? Math.round(parseFloat(near[1]) * 100) / 100 : pct(item);
}

export function headlineClaim(name, ingredients) {
  const text = String(name || '').replace(/\|.*$/, ' ');
  const items = splitList(ingredients);
  if (!text || !items.length) return null;
  // the earliest claim in the name wins: it is the one the pack leads with
  let best = null;
  for (const c of CLAIMS) { const m = text.match(c.say); if (m && (best == null || m.index < best.at)) best = { c, at: m.index }; }
  if (!best) return null;
  const c = best.c;
  const top = items.slice(0, 3).map((x) => x.replace(/\s*\([^)]*\)/g, '').trim());
  const hits = [];
  items.forEach((it, i) => { if (c.find.test(it) && !(c.not && c.not.test(it))) hits.push({ item: it, position: i + 1, percent: percentFor(it, c.find) }); });
  const base = { claim: c.name, total: items.length, top };
  if (!hits.length) return { ...base, found: false, percent: null, position: null, ingredient: null, verdict: `The name says ${c.name.toLowerCase()}, but no ${c.name.toLowerCase()} appears in the ingredient list.` };
  if (c.many) {
    const grains = [...new Set(hits.map((h) => (h.item.match(c.find) || [''])[0].toLowerCase()))];
    const total = hits.reduce((a, h) => a + (h.percent || 0), 0);
    const printed = hits.some((h) => h.percent != null);
    return { ...base, found: true, percent: printed ? Math.round(total * 100) / 100 : null, position: hits[0].position, ingredient: hits.map((h) => h.item.replace(/\s*\([^)]*\)/g, '')).join(', '), grains,
      verdict: grains.length > 1 ? `${grains.length} grains are listed (${grains.join(', ')}). ${printed ? `Together they are ${Math.round(total * 100) / 100}% of the pack.` : 'The pack does not print how much of each.'}` : `Only one grain is listed (${grains[0]}).` };
  }
  const h = hits[0];
  const only = items.length === 1;
  const verdict = h.percent != null ? `${h.percent}% of the pack is ${h.item.replace(/\s*\(\s*\d[^)]*\)/, '').trim()}.`
    : only ? `It is the only ingredient: ${h.item}.`
    : `The pack does not print how much. It is ingredient ${h.position} of ${items.length}${h.position <= 2 ? ', so it is one of the largest.' : h.position > Math.ceil(items.length / 2) ? ', so there is less of it than of most of what comes before.' : '.'}`;
  return { ...base, found: true, percent: h.percent != null ? h.percent : only ? 100 : null, position: h.position, ingredient: h.item, verdict };
}
