// Collection pages for the searches only this site can answer: "tangy lunchbox ideas for kids", "healthy dinner for a 4 year old",
// "mild recipes for toddlers". Each is a ranked list of real recipes (by Poshan Score for that age), with text built from the data (counts, the
// best recipe, the daily limits for that age) and links to every recipe on it. A page with fewer than MIN_RECIPES recipes is thin and is not made.
// Called from build-seo.cjs: build({ recipes: [{ it, d, slug }], refs, ctx }).
const MIN_RECIPES = 6, MAX_ON_PAGE = 30;

const AGES = [
  { id: 'toddlers', key: '1-3y', band: '1-3', mid: 24, phrase: 'toddlers', short: 'toddlers (1 to 3 years)', who: 'a toddler' },
  { id: '4-6-year-olds', key: '4-6y', band: '4-6', mid: 60, phrase: '4 to 6 year olds', short: '4 to 6 year olds', who: 'a child aged 4 to 6' },
  { id: '7-9-year-olds', key: '7-9y', band: '7-9', mid: 96, phrase: '7 to 9 year olds', short: '7 to 9 year olds', who: 'a child aged 7 to 9' },
  { id: '10-12-year-olds', key: '10-12y', band: '10-12', mid: 132, phrase: '10 to 12 year olds', short: '10 to 12 year olds', who: 'a child aged 10 to 12' },
  { id: 'teens', key: '13-15y', band: '13-15', mid: 168, phrase: 'teenagers', short: 'teenagers (13 to 18)', who: 'a teenager' },
];
const KIDS = { id: 'kids', key: '4-6y', band: '4-6', mid: 60, phrase: 'kids', short: 'kids', who: 'a child aged 4 to 6', generic: true };
const MEALS = [
  { id: 'breakfast', label: 'breakfast', occ: ['breakfast'] }, { id: 'lunchbox', label: 'lunchbox', occ: ['lunchbox'] },
  { id: 'lunch', label: 'lunch', occ: ['lunch', 'lunchbox'] }, { id: 'dinner', label: 'dinner', occ: ['dinner'] }, { id: 'snack', label: 'snack', occ: ['snack_4pm'] },
];
const TASTES = {
  tangy: { word: 'Tangy', means: 'lemon, lime, tamarind, raw mango, amchur, pickle, chaat masala or tomato' },
  spicy: { word: 'Spicy', means: 'chilli, schezwan, peri peri, tikka or tandoori seasoning' },
  sweet: { word: 'Sweet', means: 'jaggery, honey, dates, chocolate or sugar, in cakes, cookies, kheer and ladoos' },
  creamy: { word: 'Creamy', means: 'cream, cheese, malai, white sauce, korma or coconut milk' },
  crunchy: { word: 'Crunchy', means: 'crisp coatings and frying, as in fritters, cutlets, tikkis, pakoras and papad' },
};
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function build({ recipes, refs, ctx }) {
  const { esc, withMeta, SITE, TIER_COLOR, RECIPE_CSS, NAV, recName, timeWord } = ctx;
  const tierOf = (n) => (n >= 80 ? 'Good' : n >= 50 ? 'OK' : 'Do not use');
  const num = (n) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 1 });
  const score = (r, age) => { const v = r.d && r.d.scores_by_age ? r.d.scores_by_age[age.key] : null; return v == null ? null : Number(v); };
  const suits = (r, age) => {
    const lo = r.it.age_min == null ? 0 : r.it.age_min, hi = r.it.age_max == null ? 9999 : r.it.age_max;
    return lo <= age.mid && (age.mid >= 144 || hi >= age.mid);
  };
  const inMeal = (r, meal) => (r.it.occasions || []).some((o) => meal.occ.includes(o));

  // every page we could make: { slug, title, h1, kind, age, meal, taste, test(r) }
  const specs = [];
  const agePages = [...AGES, KIDS];
  for (const a of agePages) {
    if (!a.generic) specs.push({ slug: `healthy-recipes-for-${a.id}`, kind: 'age', age: a, test: () => true, h1: `Healthy recipes for ${a.phrase}`, lead: `recipes` });
    for (const m of MEALS) specs.push({ slug: `${m.id}-ideas-for-${a.id === 'kids' ? 'kids' : a.id}`, kind: 'meal', age: a, meal: m, test: (r) => inMeal(r, m), h1: a.generic ? `Healthy ${m.label} ideas for kids` : `Healthy ${m.label} ideas for ${a.phrase}`, lead: `${m.label} ideas` });
    for (const [t, def] of Object.entries(TASTES)) {
      if (t === 'spicy' && a.mid < 90) continue;                       // no spicy pages for under 7s
      specs.push({ slug: `${t}-recipes-for-${a.id}`, kind: 'taste', age: a, taste: t, test: (r) => (r.it.tastes || {})[t] > 0, h1: `${def.word} recipes for ${a.phrase}`, lead: `${t} recipes` });
      if (a.generic) for (const m of MEALS) specs.push({ slug: `${t}-${m.id}-ideas-for-kids`, kind: 'taste-meal', age: a, taste: t, meal: m, test: (r) => (r.it.tastes || {})[t] > 0 && inMeal(r, m), h1: `${def.word} ${m.label} ideas for kids`, lead: `${t} ${m.label} ideas` });
    }
  }
  // work out each page's recipes: they must suit the age and score at least 50 for it, best first
  const pages = [];
  for (const sp of specs) {
    // for toddlers, 4 to 6 year olds and kids in general, a recipe tagged spicy is left off every page
    const mild = (r) => sp.age.mid > 72 || !(r.it.tastes || {}).spicy;
    const list = recipes.filter((r) => suits(r, sp.age) && mild(r) && sp.test(r) && (score(r, sp.age) || 0) >= 50)
      .map((r) => ({ r, sc: score(r, sp.age) })).sort((x, y) => y.sc - x.sc || (y.r.it.tastes?.[sp.taste] || 0) - (x.r.it.tastes?.[sp.taste] || 0) || x.r.it.id - y.r.it.id);
    if (list.length >= MIN_RECIPES) pages.push({ ...sp, list });
  }
  const bySlug = new Map(pages.map((p) => [p.slug, p]));
  const css = RECIPE_CSS + `
.rl{list-style:none;padding:0;margin:14px 0}.rl li{display:flex;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line)}
.rl .n{width:26px;color:var(--dim);text-align:center;flex:none}.rl .th{width:76px;height:56px;border-radius:10px;background:#F2EDE0 center/cover no-repeat;flex:none}
.rl .nm{flex:1;min-width:0}.rl .nm a{color:var(--ink);font-weight:600;text-decoration:none}.rl .nm small{display:block;color:var(--dim)}
.rl .sc{flex:none;min-width:44px;text-align:center;color:#fff;border-radius:999px;padding:3px 10px;font-weight:700}
.faq h3{font-size:17px;margin:18px 0 4px}.faq p{margin:0 0 8px}.links a{display:inline-block;margin:0 10px 6px 0}
.cats{columns:2;column-gap:28px}.cats li{break-inside:avoid;margin:0 0 6px}.cats ul{list-style:none;padding:0;margin:0 0 14px}
@media(max-width:520px){.rl .th{width:56px;height:44px}.cats{columns:1}}`;

  const files = [], urls = [], membership = new Map();       // recipe id -> collection pages it is on (for its own page)
  for (const p of pages) {
    const a = p.age, n = p.list.length, top = p.list[0];
    const cnt = { Good: 0, OK: 0, 'Do not use': 0 };
    for (const x of p.list) cnt[tierOf(x.sc)]++;
    const ref = refs && refs[a.band];
    const shown = p.list.slice(0, MAX_ON_PAGE);
    const title = `${p.h1}: ${n} ranked by Poshan Score`;
    const nm = (x) => recName(x.r.d ? x.r.d.name : x.r.it.name);
    const desc = `${n} ${p.lead} for ${a.phrase}, ranked by Poshan Score. Top pick: ${nm(top)} (${top.sc}/100). Each recipe is credited to its creator and scored for ${a.phrase}.`;
    const tasteNote = p.taste ? ` We tag a recipe ${p.taste} when its name or ingredients point to ${TASTES[p.taste].means}.` : '';
    const refNote = ref ? ` For ${a.who}, the day's limits behind the score are about ${num(ref.sugarIdeal)} g of added sugar, ${num(ref.sodium)} mg of sodium and ${num(ref.satFat)} g of saturated fat, and one serving should stay under 30% of each.` : '';
    const intro = `We have scored ${n} ${p.lead} for ${a.phrase}. ${cap(nm(top))} comes first with ${top.sc} out of 100; ${cnt.Good} of the ${n} score Good (80 or more) and ${cnt.OK} OK (50 to 79).${tasteNote}${refNote}`;
    const faq = [
      [`What are the best ${p.lead} for ${a.phrase}?`, `By Poshan Score for ${a.phrase}, the top three are ${p.list.slice(0, 3).map((x) => `${nm(x)} (${x.sc})`).join(', ')}.`],
      [`Are these healthy for ${a.phrase}?`, `They are the recipes that score 50 or more for ${a.phrase}: ${cnt.Good} Good and ${cnt.OK} OK. A recipe loses points when one serving takes too much of the day's sugar, salt or saturated fat for that age, or lacks fibre and protein.`],
      [p.taste ? `How do you decide a recipe is ${p.taste}?` : 'How are the recipes chosen?', p.taste ? `A recipe is tagged ${p.taste} from its name and ingredients (${TASTES[p.taste].means}). Only recipes that suit the age and score at least 50 for it are listed.` : 'Only recipes that suit the age and score at least 50 for it are listed, best score first. Each is credited to its creator and links back to the original.'],
    ];
    const sib = pages.filter((x) => x.slug !== p.slug && ((x.age.id === a.id && x.kind !== 'age') || (x.kind === p.kind && x.age.id !== a.id && (x.meal && x.meal.id) === (p.meal && p.meal.id) && x.taste === p.taste) || (x.age.id === a.id && x.kind === 'age'))).slice(0, 10);
    const url = `${SITE}/ideas/${p.slug}`;
    const ld = [
      { '@context': 'https://schema.org', '@type': 'ItemList', name: p.h1, numberOfItems: n, itemListElement: p.list.slice(0, 10).map((x, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE}/recipes/${x.r.slug}`, name: nm(x) })) },
      { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map(([q, an]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: an } })) },
      { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ name: 'Home', url: SITE + '/' }, { name: 'Recipe ideas', url: SITE + '/ideas' }, { name: p.h1, url }].map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: c.url })) },
    ];
    const rows = shown.map((x, i) => `<li><span class="n">${i + 1}</span><span class="th"${x.r.d && x.r.d.image_url ? ` style="background-image:url('${esc(x.r.d.image_url)}')"` : ''}></span><span class="nm"><a href="/recipes/${x.r.slug}">${esc(nm(x))}</a><small>${esc([x.r.it.by, x.r.it.minutes ? timeWord(x.r.it.minutes) : ''].filter(Boolean).join(' · '))}</small></span><span class="sc" style="background:${TIER_COLOR[tierOf(x.sc)]}">${x.sc}</span></li>`).join('');
    let html = `<!doctype html>
<html lang="en-IN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${ld.map((o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`).join('')}
<style>${css}</style></head><body>
${NAV}
<main>
<p class="crumb"><a href="/">Home</a> › <a href="/ideas">Recipe ideas</a> › ${esc(p.h1)}</p>
<h1>${esc(p.h1)}</h1>
<p>${esc(intro)}</p>
<ol class="rl" style="padding:0">${rows}</ol>
${n > MAX_ON_PAGE ? `<p class="fine">Showing the top ${MAX_ON_PAGE} of ${n}. <a href="/recipes">See every recipe</a>.</p>` : ''}
<div class="faq"><h2>Common questions</h2>${faq.map(([q, an]) => `<h3>${esc(q)}</h3><p>${esc(an)}</p>`).join('')}</div>
${sib.length ? `<h2>More ideas</h2><p class="links">${sib.map((x) => `<a href="/ideas/${x.slug}">${esc(x.h1)}</a>`).join('')}</p>` : ''}
<p style="margin-top:22px"><a class="cta" href="/meal-ideas">Plan the week for your child's age</a><a class="cta alt" href="/recipes">All recipes</a></p>
<p class="fine">Poshan Score is an independent rating, not a certification, and the age guide is general, not medical advice. Recipe text and photos belong to their creators and link back to the original.</p>
</main><script src="/kp-visits.js" defer></script></body></html>`;
    html = withMeta(html, { url, title, desc });
    files.push({ path: `ideas/${p.slug}.html`, html });
    const lm = shown.map((x) => x.r.it.updated).filter(Boolean).sort().pop() || null;
    urls.push({ loc: url, pr: '0.8', lm });
    p.url = url;
    for (const x of p.list) { const id = x.r.it.id; if (!membership.has(id)) membership.set(id, []); membership.get(id).push(p); }
  }
  // the index of all of them
  const groups = [['By age', (p) => p.kind === 'age'], ['By meal', (p) => p.kind === 'meal'], ['By taste', (p) => p.kind === 'taste' || p.kind === 'taste-meal']];
  const hubTitle = 'Healthy recipe ideas for kids, by taste, meal and age';
  const hubDesc = `${pages.length} ranked lists of kids' recipes: tangy, spicy, sweet, creamy and crunchy ideas for breakfast, lunchbox, lunch, snacks and dinner, for toddlers to teenagers. Each recipe has a Poshan Score for the age.`;
  const hubBody = groups.map(([g, f]) => { const ps = pages.filter(f); return ps.length ? `<li><h2>${g}</h2><ul>${ps.map((p) => `<li><a href="/ideas/${p.slug}">${esc(p.h1)}</a> <span class="fine">· ${p.list.length} recipes</span></li>`).join('')}</ul></li>` : ''; }).join('');
  let hub = `<!doctype html>
<html lang="en-IN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(hubTitle)}</title><style>${css}</style></head><body>
${NAV}
<main>
<p class="crumb"><a href="/">Home</a> › Recipe ideas</p>
<h1>Healthy recipe ideas for kids, by taste, meal and age</h1>
<p>Pick what your child likes (tangy, spicy, sweet, creamy or crunchy), the meal, and their age. Every list is ranked by the Poshan Score for that age, and every recipe is credited to its creator.</p>
<ul class="cats" style="list-style:none;padding:0">${hubBody}</ul>
<p><a class="cta" href="/recipes">All recipes</a><a class="cta alt" href="/meal-ideas">Plan the week</a></p>
</main><script src="/kp-visits.js" defer></script></body></html>`;
  hub = withMeta(hub, { url: `${SITE}/ideas`, title: hubTitle, desc: hubDesc });
  files.push({ path: 'ideas.html', html: hub });
  urls.push({ loc: `${SITE}/ideas`, pr: '0.8', lm: null });
  return { files, urls, count: pages.length, membership, bySlug, skipped: specs.length - pages.length };
}

module.exports = { build, MIN_RECIPES, AGES, MEALS, TASTES };
