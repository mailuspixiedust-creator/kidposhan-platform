// The ranking pages ("best ... for kids"), the health-drink brand pages and their index pages in Hindi, Bengali and Gujarati.
// Same packs, same scores, same order as the English pages; only the words around them change (see i18n-best.cjs).
const { TEXT, LANGS } = require('./i18n.cjs');
const { REC } = require('./i18n-recipe.cjs');
const { BEST, KIND, CAT, CHECK_BY_NAME } = require('./i18n-best.cjs');
const { alternates, switcher } = require('./build-i18n.cjs');

const CODES = Object.keys(LANGS);
const AGES = ['1-3y', '4-6y', '7-9y', '10-12y', '13-15y', '16-18y', 'adult'];
const AGE_SHORT = { '1-3y': '1–3', '4-6y': '4–6', '7-9y': '7–9', '10-12y': '10–12', '13-15y': '13–15', '16-18y': '16–18' };
const tierOf = (n) => (n >= 80 ? 'Good' : n >= 50 ? 'OK' : 'Do not use');

function localize({ groups, brands, ctx }) {
  const { esc, withMeta, SITE, RECIPE_CSS, TIER_COLOR } = ctx;
  const css = RECIPE_CSS + `
.rank{width:100%;border-collapse:collapse;font-size:15px}.rank td{padding:10px 6px;border-bottom:1px solid var(--line);vertical-align:middle}
.rank .n{width:30px;color:var(--dim);text-align:center}.rank img{width:52px;height:52px;object-fit:contain;background:#fff;border-radius:10px;border:1px solid var(--line);display:block}
.rank .nm a{color:var(--ink);font-weight:600;text-decoration:none}.rank .nm small{display:block;color:var(--dim);font-weight:400}
.rank .sc{width:70px;text-align:center}.rank .sc b{display:inline-block;min-width:44px;color:#fff;border-radius:999px;padding:3px 10px;font-size:15px}
.rank .fl{color:var(--dim);font-size:13px}
.tiers{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.tiers span{border-radius:999px;padding:4px 12px;font-size:13.5px;color:#fff}
.faq h3{font-size:17px;margin:18px 0 4px}.faq p{margin:0 0 8px}
.cats{columns:2;column-gap:28px}.cats a{color:var(--ink);font-weight:600;text-decoration:none}.cats li{break-inside:avoid;margin:0 0 6px}.cats ul{list-style:none;padding:0;margin:0 0 14px}
.tbl{width:100%;border-collapse:collapse;font-size:15px}.tbl th,.tbl td{padding:9px 6px;border-bottom:1px solid var(--line);text-align:center}.tbl th{font-size:13px;color:var(--dim);font-weight:600}
.tbl td:first-child,.tbl th:first-child{text-align:left}.tbl td:first-child a{color:var(--ink);font-weight:600;text-decoration:none}.tbl small{display:block;color:var(--dim);font-weight:400}
.pill{display:inline-block;min-width:38px;color:#fff;border-radius:999px;padding:2px 9px;font-size:14px;font-weight:700}.scroll{overflow-x:auto;margin:0 -18px;padding:0 18px}
.langs{margin:0 0 8px}body{line-height:1.7}
@media(max-width:520px){.rank .fl{display:none}.cats{columns:1}}`;
  const out = {};
  for (const code of CODES) {
    const B = BEST[code], L = TEXT[code], R = REC[code];
    const kindName = (g) => KIND[code][g.slug] || g.label;
    const files = [], urls = [];
    const nav = `<nav><a class="brand" href="/">Poshan Score <small>by KidPoshan</small></a><a href="/${code}/best">${esc(B.crumbBest)}</a><a href="/${code}/brands">${esc(B.crumbBrands)}</a><a href="/products">Products</a></nav>`;
    const page = (rel, title, desc, ld, body, type) => {
      const url = `${SITE}/${code}/${rel}`;
      let html = `<!doctype html>
<html lang="${L.html}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${(ld || []).map((o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`).join('')}
${alternates(SITE, rel)}
<style>${css}</style></head><body>
${nav}
<main>
${switcher(rel, code)}
${body}
</main><script src="/kp-visits.js" defer></script></body></html>`;
      html = withMeta(html, { url, title, desc });
      return { html, url };
    };
    const faqLd = (faq) => ({ '@context': 'https://schema.org', '@type': 'FAQPage', inLanguage: code, mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) });
    const failNames = (names) => names.filter((n) => n !== 'HFSS status').map((n) => R.chk[CHECK_BY_NAME[n]] || n);

    // --- one ranking page per food type ---
    for (const g of groups) {
      const label = kindName(g), n = g.rows.length, top = g.rows[0];
      const cnt = { Good: 0, OK: 0, 'Do not use': 0 };
      for (const r of g.rows) cnt[tierOf(r.score)]++;
      const failCount = {};
      for (const r of g.rows) for (const f of failNames(r.fails)) failCount[f] = (failCount[f] || 0) + 1;
      const common = Object.entries(failCount).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([k]) => k).join(', ');
      const topName = top.name + (top.brand && !top.name.toLowerCase().includes(top.brand.toLowerCase()) ? ' (' + top.brand + ')' : '');
      const faq = [[B.q1(label), B.a1({ n, top: topName, sc: top.score, tier: L.tier[top.capped ? 'OK' : tierOf(top.score)] })], [B.q2(label), B.a2({ n, good: cnt.Good, ok: cnt.OK, bad: cnt['Do not use'], common })], [R.q3, R.a3]];
      const rows = g.rows.map((r, i) => `<tr><td class="n">${i + 1}</td><td style="width:60px">${r.image ? `<img src="${esc(r.image)}" alt="${esc(r.name)}" loading="lazy" referrerpolicy="no-referrer">` : ''}</td>
<td class="nm"><a href="/products/${r.slug}" lang="en">${esc(r.name)}</a><small lang="en">${esc([r.brand, r.pack].filter(Boolean).join(' · '))}</small><span class="fl">${failNames(r.fails).length ? esc(B.fails) + ': ' + esc(failNames(r.fails).join(', ')) : esc(B.passAll)}</span></td>
<td class="sc"><b style="background:${TIER_COLOR[r.capped ? 'OK' : tierOf(r.score)] || TIER_COLOR.Good}">${r.score}</b></td></tr>`).join('');
      const related = groups.filter((x) => x.category === g.category && x.slug !== g.slug).slice(0, 6);
      const brandBlock = g.kind === 'health_drink' && brands.length ? `<h2>${esc(B.brandGuides)}</h2><p>${brands.map((b) => `<a href="/${code}/brands/${b.slug}">${esc(B.bH1(b.name))}</a>`).join(' · ')} · <a href="/${code}/brands">${esc(B.allBrands)}</a></p>` : '';
      const body = `<p class="crumb"><a href="/">${esc(L.home)}</a> › <a href="/${code}/best">${esc(B.crumbBest)}</a> › ${esc(label)}</p>
<h1>${esc(B.h1(label))}</h1>
<p>${esc(B.intro(n, label))}</p>
<div class="tiers"><span style="background:${TIER_COLOR.Good}">${cnt.Good} ${esc(L.tier.Good)} (80+)</span><span style="background:${TIER_COLOR.OK}">${cnt.OK} ${esc(L.tier.OK)} (50–79)</span><span style="background:${TIER_COLOR['Do not use']}">${cnt['Do not use']} ${esc(L.tier['Do not use'])} (&lt;50)</span></div>
<table class="rank">${rows}</table>
<div class="faq"><h2>${esc(R.h.faq)}</h2>${faq.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join('')}</div>
${brandBlock}
${related.length ? `<h2>${esc(B.related)}</h2><p>${related.map((x) => `<a href="/${code}/best/${x.slug}">${esc(kindName(x))}</a>`).join(' · ')}</p>` : ''}
<p style="margin-top:22px"><a class="cta" href="/products">${esc(B.cta1)}</a><a class="cta alt" href="/scan">${esc(B.cta2)}</a></p>
<p class="fine">${esc(B.fine)}</p>`;
      const ld = [{ '@context': 'https://schema.org', '@type': 'ItemList', name: B.h1(label), inLanguage: code, numberOfItems: n, itemListElement: g.rows.slice(0, 10).map((r, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE}/products/${r.slug}`, name: r.name })) }, faqLd(faq)];
      const p = page(`best/${g.slug}`, B.title(label), B.desc(n, label, top.name, top.score), ld, body);
      files.push({ path: `${code}/best/${g.slug}.html`, html: p.html }); urls.push({ loc: p.url, pr: '0.6' });
    }
    // --- the index of rankings ---
    const cats = {};
    for (const g of groups) (cats[g.category] = cats[g.category] || []).push(g);
    const catHtml = Object.keys(cats).sort().map((c) => `<li><h2>${esc(CAT[code][c] || c)}</h2><ul>${cats[c].map((g) => `<li><a href="/${code}/best/${g.slug}">${esc(kindName(g))}</a> <span class="fine">· ${esc(B.packs(g.rows.length))} · ${esc(B.top)} <span lang="en">${esc(g.rows[0].name.slice(0, 40))}</span> (${g.rows[0].score})</span></li>`).join('')}</ul></li>`).join('');
    const hub = page('best', B.hubTitle, B.hubDesc(groups.length), null, `<p class="crumb"><a href="/">${esc(L.home)}</a> › ${esc(B.crumbBest)}</p>
<h1>${esc(B.hubH1)}</h1>
<p>${esc(B.hubIntro)}</p>
<ul class="cats" style="list-style:none;padding:0">${catHtml}</ul>
<p><a class="cta" href="/products">${esc(B.cta1)}</a><a class="cta alt" href="/${code}/ideas">${esc(L.ideas)}</a></p>`);
    files.push({ path: `${code}/best.html`, html: hub.html }); urls.push({ loc: hub.url, pr: '0.6' });

    // --- the brand pages ---
    const avg = (rows) => Math.round(rows.reduce((s, r) => s + r.score, 0) / rows.length);
    const pill = (v, capped) => (v == null ? '–' : `<span class="pill" style="background:${TIER_COLOR[capped ? 'OK' : tierOf(v)] || TIER_COLOR.OK}">${v}</span>`);
    for (const b of brands) {
      const rows = b.rows, n = rows.length, top = rows[0], low = rows[n - 1];
      const range = top.score === low.score ? `${top.score}` : `${low.score}–${top.score}`;
      const cnt = { Good: 0, OK: 0, 'Do not use': 0 };
      for (const r of rows) cnt[tierOf(r.score)]++;
      const failCount = {};
      for (const r of rows) for (const m of r.metrics) if (m.score === 0 && m.name !== 'HFSS status') failCount[m.id] = (failCount[m.id] || 0) + 1;
      const commonIds = Object.entries(failCount).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).slice(0, 3).map(([k]) => k);
      const common = commonIds.map((id) => R.chk[id] || id).join(', ');
      const sugarM = top.metrics.find((m) => m.name === 'Added sugar');
      const rd = sugarM && sugarM.reading ? String(sugarM.reading).match(/^(.+?)\s=\s(\d+)% of the day's ([\d.,]+ ?m?g)/) : null;
      const sugar = rd ? B.read(rd[1], rd[2], rd[3]) : null;
      const others = brands.filter((x) => x.slug !== b.slug);
      const verdict = cnt.Good === n ? B.bVerdictAll(n, L.tier.Good) : cnt['Do not use'] === n ? B.bVerdictAll(n, L.tier['Do not use']) : B.bVerdict(cnt.Good, cnt.OK, cnt['Do not use']);
      const faq = [[B.bq1(b.name), B.ba1({ n, b: b.name, verdict, range, common })], ...(sugar ? [[B.bq2(b.name), B.ba2({ name: top.name, sugar })]] : []),
        ...(others.length ? [[B.bq3(b.name), B.ba3({ b: b.name, avg: avg(rows), others: others.map((o) => B.avgOf(o.name, avg(o.rows))).join(', ') })]] : []), [R.q3, R.a3]];
      const head = `<tr><th>${esc(B.bPack)}</th>${AGES.map((a) => `<th>${a === 'adult' ? esc(B.bAdult) : AGE_SHORT[a]}</th>`).join('')}</tr>`;
      const bodyRows = rows.map((r) => `<tr><td><a href="/products/${r.slug}" lang="en">${esc(r.name)}</a>${r.pack ? `<small lang="en">${esc(r.pack)}</small>` : ''}</td>${AGES.map((a) => `<td>${pill(r.byAge[a] == null ? null : Math.round(r.byAge[a]), a === '4-6y' && r.capped)}</td>`).join('')}</tr>`).join('');
      const body = `<p class="crumb"><a href="/">${esc(L.home)}</a> › <a href="/${code}/brands">${esc(B.crumbBrands)}</a> › ${esc(b.name)}</p>
<h1>${esc(B.bH1(b.name))}</h1>
<p>${esc(B.bIntro(n, b.name, range))}</p>
<div class="tiers"><span style="background:${TIER_COLOR.Good}">${cnt.Good} ${esc(L.tier.Good)} (80+)</span><span style="background:${TIER_COLOR.OK}">${cnt.OK} ${esc(L.tier.OK)} (50–79)</span><span style="background:${TIER_COLOR['Do not use']}">${cnt['Do not use']} ${esc(L.tier['Do not use'])} (&lt;50)</span></div>
<h2>${esc(B.bByAge)}</h2>
<div class="scroll"><table class="tbl">${head}${bodyRows}</table></div>
<p class="fine">${esc(B.bNote)}</p>
${common ? `<h2>${esc(B.bHolds(b.name))}</h2><p>${esc(B.bHoldsText(common, sugar, top.name))}</p>` : ''}
<div class="faq"><h2>${esc(R.h.faq)}</h2>${faq.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join('')}</div>
<h2>${esc(B.bMore)}</h2><p><a href="/${code}/best/health-drink">${esc(B.allRank)}</a>${others.map((o) => ` · <a href="/${code}/brands/${o.slug}">${esc(o.name)}</a>`).join('')}</p>
<p style="margin-top:22px"><a class="cta" href="/products">${esc(B.cta1)}</a><a class="cta alt" href="/scan">${esc(B.cta2)}</a></p>
<p class="fine">${esc(B.bFine(b.name))}</p>`;
      const ld = [{ '@context': 'https://schema.org', '@type': 'ItemList', name: B.bH1(b.name), inLanguage: code, numberOfItems: n, itemListElement: rows.map((r, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE}/products/${r.slug}`, name: r.name })) }, faqLd(faq)];
      const p = page(`brands/${b.slug}`, B.bTitle(b.name), B.bDesc(n, b.name, range), ld, body);
      files.push({ path: `${code}/brands/${b.slug}.html`, html: p.html }); urls.push({ loc: p.url, pr: '0.6' });
    }
    if (brands.length) {
      const list = brands.map((b) => { const lo = b.rows[b.rows.length - 1].score, hi2 = b.rows[0].score; return `<li><a href="/${code}/brands/${b.slug}"><b>${esc(B.bH1(b.name))}</b></a> <span class="fine">· ${esc(B.bhLine(b.rows.length, lo === hi2 ? lo : lo + '–' + hi2))}</span></li>`; }).join('');
      const bh = page('brands', B.bhTitle, B.bhDesc(brands.map((b) => b.name).join(', ')), null, `<p class="crumb"><a href="/">${esc(L.home)}</a> › ${esc(B.crumbBrands)}</p>
<h1>${esc(B.bhH1)}</h1>
<p>${esc(B.bhIntro)}</p>
<ul>${list}</ul>
<p><a href="/${code}/best/health-drink">${esc(B.allRank)}</a></p>
<p style="margin-top:22px"><a class="cta" href="/products">${esc(B.cta1)}</a><a class="cta alt" href="/scan">${esc(B.cta2)}</a></p>
<p class="fine">${esc(B.bhFine)}</p>`);
      files.push({ path: `${code}/brands.html`, html: bh.html }); urls.push({ loc: bh.url, pr: '0.6' });
    }
    out[code] = { files, urls };
  }
  return out;
}

module.exports = { localize };
