// Hindi, Bengali and Gujarati versions of the collection pages ("tangy lunchbox ideas for kids") and their index, plus the links between the languages.
// The pages are the same pages, in the same order, with the same recipes and scores: only the words around them change (see i18n.cjs).
const { LANGS, TEXT } = require('./i18n.cjs');

const CODES = Object.keys(LANGS);

// <link rel="alternate" hreflang> for a page that exists in English and in every language: rel is the path without the language, e.g. "ideas/tangy-recipes-for-toddlers" or "ideas"
function alternates(SITE, rel) {
  const en = `${SITE}/${rel}`;
  return [`<link rel="alternate" hreflang="en" href="${en}">`, ...CODES.map((c) => `<link rel="alternate" hreflang="${c}" href="${SITE}/${c}/${rel}">`), `<link rel="alternate" hreflang="x-default" href="${en}">`].join('\n');
}
// the little "English · हिन्दी · বাংলা · ગુજરાતી" line at the top of a page (the language you are on is plain text, not a link)
function switcher(rel, current, label) {
  const bits = [['en', 'English', `/${rel}`], ...CODES.map((c) => [c, LANGS[c].name, `/${c}/${rel}`])];
  return `<p class="fine langs" lang="en">${label ? esc0(label) + ': ' : ''}${bits.map(([c, n, href]) => (c === current ? `<b>${n}</b>` : `<a href="${href}" hreflang="${c}">${n}</a>`)).join(' · ')}</p>`;
}
const esc0 = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function decorateEn(html, SITE, rel) {
  return html.replace(/<\/head>/i, (m) => alternates(SITE, rel) + '\n' + m).replace(/<main>/i, (m) => m + '\n' + switcher(rel, 'en', 'Language'));
}

// the five ages of a page, as they were written in build-ideas: ages' reference limits come from refs[band]
function localize({ pages, ctx, refs, TASTE_IDS_ORDER }) {
  const { esc, withMeta, SITE, RECIPE_CSS, TIER_COLOR, NAV, recName } = ctx;
  const tierOf = (n) => (n >= 80 ? 'Good' : n >= 50 ? 'OK' : 'Do not use');
  const num = (n) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 1 });
  const MAX_ON_PAGE = 30;
  const css = RECIPE_CSS + `
.rl{list-style:none;padding:0;margin:14px 0}.rl li{display:flex;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line)}
.rl .n{width:26px;color:var(--dim);text-align:center;flex:none}.rl .th{width:76px;height:56px;border-radius:10px;background:#F2EDE0 center/cover no-repeat;flex:none}
.rl .nm{flex:1;min-width:0}.rl .nm a{color:var(--ink);font-weight:600;text-decoration:none}.rl .nm small{display:block;color:var(--dim)}
.rl .sc{flex:none;min-width:44px;text-align:center;color:#fff;border-radius:999px;padding:3px 10px;font-weight:700}
.faq h3{font-size:17px;margin:18px 0 4px}.faq p{margin:0 0 8px}.links a{display:inline-block;margin:0 10px 6px 0}
.cats{columns:2;column-gap:28px}.cats li{break-inside:avoid;margin:0 0 6px}.cats ul{list-style:none;padding:0;margin:0 0 14px}
.langs{margin:0 0 8px}body{line-height:1.7}
@media(max-width:520px){.rl .th{width:56px;height:44px}.cats{columns:1}}`;
  const out = {};
  for (const code of CODES) {
    const L = TEXT[code];
    const nav = `<nav><a class="brand" href="/">Poshan Score <small>by KidPoshan</small></a><a href="/${code}/ideas">${esc(L.ideas)}</a><a href="/meal-ideas">${esc(L.plan)}</a></nav>`;
    const files = [], urls = [];
    const words = (p) => {
      const a = p.age.id, m = p.meal && p.meal.id, t = p.taste;
      const aFor = L.ageFor[a];
      if (p.kind === 'age') return { h1: L.h1.age(aFor), lead: L.unitRecipe };
      if (p.kind === 'meal') return { h1: L.h1.meal(aFor, L.meal[m]), lead: `${L.meal[m]} ${L.unitIdea}` };
      if (p.kind === 'taste') return { h1: L.h1.taste(aFor, L.tasteF[t]), lead: `${L.tasteF[t]} ${L.unitRecipe}` };
      return { h1: L.h1.tasteMeal(aFor, L.tasteM[t], L.meal[m]), lead: `${L.tasteM[t]} ${L.meal[m]} ${L.unitIdea}` };
    };
    for (const p of pages) p['h1_' + code] = words(p).h1;
    for (const p of pages) {
      const a = p.age, aFor = L.ageFor[a.id], n = p.list.length, top = p.list[0], { h1, lead } = words(p);
      const cnt = { Good: 0, OK: 0, 'Do not use': 0 };
      for (const x of p.list) cnt[tierOf(x.sc)]++;
      const nm = (x) => recName(x.r.d ? x.r.d.name : x.r.it.name);
      const shown = p.list.slice(0, MAX_ON_PAGE);
      const ref = refs && refs[a.band];
      const tasteNote = p.taste ? L.tasteNote(L.tasteF[p.taste], L.means[p.taste]) : '';
      const refNote = ref ? L.refNote(L.ageWho[a.id], { sugar: num(ref.sugarIdeal), sodium: num(ref.sodium), satFat: num(ref.satFat) }) : '';
      const intro = L.intro({ a: aFor, n, lead, top: nm(top), sc: top.sc, good: cnt.Good, ok: cnt.OK }) + tasteNote + refNote;
      const faq = [
        [L.faq.bestQ(aFor, lead), L.faq.bestA(aFor, p.list.slice(0, 3).map((x) => `${nm(x)} (${x.sc})`).join(', '))],
        [L.faq.healthyQ(aFor), L.faq.healthyA(aFor, cnt.Good, cnt.OK)],
        p.taste ? [L.faq.tasteQ(L.tasteF[p.taste]), L.faq.tasteA(L.tasteF[p.taste], L.means[p.taste])] : [L.faq.chosenQ, L.faq.chosenA],
      ];
      const title = L.title(h1, n), desc = L.desc(n, lead, aFor, nm(top), top.sc);
      const rel = `ideas/${p.slug}`, url = `${SITE}/${code}/${rel}`;
      const sib = pages.filter((x) => x.slug !== p.slug && ((x.age.id === a.id && x.kind !== 'age') || (x.kind === p.kind && x.age.id !== a.id && (x.meal && x.meal.id) === (p.meal && p.meal.id) && x.taste === p.taste) || (x.age.id === a.id && x.kind === 'age'))).slice(0, 10);
      const ld = [
        { '@context': 'https://schema.org', '@type': 'ItemList', name: h1, numberOfItems: n, inLanguage: code, itemListElement: p.list.slice(0, 10).map((x, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE}/recipes/${x.r.slug}`, name: nm(x) })) },
        { '@context': 'https://schema.org', '@type': 'FAQPage', inLanguage: code, mainEntity: faq.map(([q, an]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: an } })) },
      ];
      const rows = shown.map((x, i) => `<li><span class="n">${i + 1}</span><span class="th"${x.r.d && x.r.d.image_url ? ` style="background-image:url('${esc(x.r.d.image_url)}')"` : ''}></span><span class="nm"><a href="/recipes/${x.r.slug}" lang="en">${esc(nm(x))}</a><small>${esc([x.r.it.by, x.r.it.minutes ? L.time(x.r.it.minutes) : ''].filter(Boolean).join(' · '))}</small></span><span class="sc" style="background:${TIER_COLOR[tierOf(x.sc)]}" title="${esc(L.tier[tierOf(x.sc)])}">${x.sc}</span></li>`).join('');
      let html = `<!doctype html>
<html lang="${L.html}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${ld.map((o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`).join('')}
${alternates(SITE, rel)}
<style>${css}</style></head><body>
${nav}
<main>
${switcher(rel, code)}
<p class="crumb"><a href="/">${esc(L.home)}</a> › <a href="/${code}/ideas">${esc(L.ideas)}</a> › ${esc(h1)}</p>
<h1>${esc(h1)}</h1>
<p>${esc(intro)}</p>
<ol class="rl" style="padding:0">${rows}</ol>
${n > MAX_ON_PAGE ? `<p class="fine">${esc(L.top(MAX_ON_PAGE, n))} <a href="/recipes">${esc(L.seeAll)}</a>.</p>` : ''}
<div class="faq"><h2>${esc(L.faqTitle)}</h2>${faq.map(([q, an]) => `<h3>${esc(q)}</h3><p>${esc(an)}</p>`).join('')}</div>
${sib.length ? `<h2>${esc(L.more)}</h2><p class="links">${sib.map((x) => `<a href="/${code}/ideas/${x.slug}">${esc(x['h1_' + code])}</a>`).join('')}</p>` : ''}
<p style="margin-top:22px"><a class="cta" href="/meal-ideas">${esc(L.cta)}</a><a class="cta alt" href="/recipes">${esc(L.ctaAll)}</a></p>
<p class="fine">${esc(L.fine)}</p>
</main><script src="/kp-visits.js" defer></script></body></html>`;
      html = withMeta(html, { url, title, desc });
      files.push({ path: `${code}/ideas/${p.slug}.html`, html });
      urls.push({ loc: url, pr: '0.7', lm: p.lm || null });
    }
    // the index
    const groups = [[L.groups.age, (p) => p.kind === 'age'], [L.groups.meal, (p) => p.kind === 'meal'], [L.groups.taste, (p) => p.kind === 'taste' || p.kind === 'taste-meal']];
    const hubBody = groups.map(([g, f]) => { const ps = pages.filter(f); return ps.length ? `<li><h2>${esc(g)}</h2><ul>${ps.map((p) => `<li><a href="/${code}/ideas/${p.slug}">${esc(p['h1_' + code])}</a> <span class="fine">· ${esc(L.recipesCount(p.list.length))}</span></li>`).join('')}</ul></li>` : ''; }).join('');
    const hurl = `${SITE}/${code}/ideas`;
    let hub = `<!doctype html>
<html lang="${L.html}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(L.hubTitle)}</title>
${alternates(SITE, 'ideas')}
<style>${css}</style></head><body>
${nav}
<main>
${switcher('ideas', code)}
<p class="crumb"><a href="/">${esc(L.home)}</a> › ${esc(L.ideas)}</p>
<h1>${esc(L.hubH1)}</h1>
<p>${esc(L.hubIntro)}</p>
<ul class="cats" style="list-style:none;padding:0">${hubBody}</ul>
<p><a class="cta" href="/recipes">${esc(L.ctaAll)}</a><a class="cta alt" href="/meal-ideas">${esc(L.plan)}</a></p>
<p class="fine">${esc(L.fine)}</p>
</main><script src="/kp-visits.js" defer></script></body></html>`;
    hub = withMeta(hub, { url: hurl, title: L.hubTitle, desc: L.hubDesc(pages.length) });
    files.push({ path: `${code}/ideas.html`, html: hub });
    urls.push({ loc: hurl, pr: '0.7', lm: null });
    out[code] = { files, urls };
  }
  return out;
}

module.exports = { localize, decorateEn, alternates, switcher, CODES };
