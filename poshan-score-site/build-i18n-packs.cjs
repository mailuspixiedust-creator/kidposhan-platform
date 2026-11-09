// The pack pages in Hindi, Bengali and Gujarati: the same page as the English one, with the words around the pack translated.
// The pack's name, brand and ingredient list stay as printed on the pack (marked lang="en").
const { TEXT } = require('./i18n.cjs');
const { REC } = require('./i18n-recipe.cjs');
const { PK } = require('./i18n-pack.cjs');
const { KIND, CAT, BEST } = require('./i18n-best.cjs');
const { alternates, switcher } = require('./build-i18n.cjs');

const slugKind = (k) => String(k).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

function packPageLocal(p, slug, swaps, code, ctx) {
  const { esc, withMeta, SITE, TIER_COLOR, RECIPE_CSS, AGE_LABEL } = ctx;
  const P = PK[code], R = REC[code], L = TEXT[code];
  const rel = `products/${slug}`, url = `${SITE}/${code}/${rel}`;
  const nm = String(p.name || '').split('|')[0].replace(/\s+/g, ' ').trim();
  const score = Math.round(p.score);
  const tier = p.capped ? 'OK' : p.band;
  const band = p.capped ? P.capped : (L.tier[p.band] || p.band);
  const lblToKey = Object.fromEntries(Object.entries(AGE_LABEL).map(([k, v]) => [v, k]));
  const ageName = (k) => R.age[k] || k;
  const age = lblToKey[p.age_label] ? ageName(lblToKey[p.age_label]) : ageName('4-6y');
  const kindLabel = (kind, fallback) => KIND[code][slugKind(kind)] || fallback || '';
  const reading = (m) => {
    const r = String(m.reading || '');
    if (['sugar', 'sodium', 'satfat', 'fibre', 'protein'].includes(m.id)) { const x = r.match(/^(.+?)\s=\s(\d+)% of the day's ([\d.,]+ ?m?g)/); return x ? P.rd(x[1], x[2], x[3]) : r; }
    if (m.id === 'trans') return /^no /i.test(r) ? P.noTrans : P.trans;
    if (m.id === 'preservatives' || m.id === 'additives') { if (/^none/i.test(r)) return P.none; const x = r.match(/^(\d+) found(?::\s*(.*))?$/); return x ? P.found(x[1]) + (x[2] ? ': ' + x[2] : '') : r; }
    if (m.id === 'hfss') return /^high/i.test(r) ? P.hfssBad : /^(not|no)\b/i.test(r) ? P.hfssOk : r;
    return r;
  };
  const metrics = (p.metrics || []).map((m) => `<tr><td>${m.n}. ${esc(R.chk[m.id] || m.name)}</td><td class="r">${esc(reading(m))}</td><td class="m"><b>${m.score ? esc(P.yes) : esc(P.no)}</b></td></tr>`).join('');
  const byAge = Object.entries(p.scores_by_age || {}).map(([a, v]) => `<tr><td>${esc(ageName(a))}</td><td class="m">${v == null ? '–' : '<b>' + v + '</b>/100'}</td></tr>`).join('');
  const n = p.nutrition_per_100g || {}, fmt = (v, u) => (v === '' || v == null ? P.notPrinted : `${v} ${u}`);
  const label = `<tr><td>${esc(P.nut.protein)}</td><td class="m">${fmt(n.protein_g, 'g')}</td></tr><tr><td>${esc(P.nut.fibre)}</td><td class="m">${fmt(n.fibre_g, 'g')}</td></tr><tr><td>${esc(P.nut.sugars)}</td><td class="m">${fmt(n.sugars_g, 'g')}</td></tr><tr><td>${esc(P.nut.added)}</td><td class="m">${fmt(n.added_sugars_g, 'g')}</td></tr><tr><td>${esc(P.nut.satfat)}</td><td class="m">${fmt(n.saturated_fat_g, 'g')}</td></tr><tr><td>${esc(P.nut.sodium)}</td><td class="m">${fmt(n.sodium_mg, 'mg')}</td></tr>`;
  const o = { nm, score, band, age };
  const title = P.title(o), desc = P.desc(o);
  const catName = CAT[code][p.category] || p.category;
  const swapHtml = swaps && swaps.length ? `<h2>${esc(P.swapsH(kindLabel(p.kind, p.kind_label)))}</h2><p>${esc(P.swapsP(nm, score, age))}</p><ul class="swaps">${swaps.map((x) => `<li><a href="/${code}/products/${x.slug}" lang="en">${esc(String(x.item.name).split('|')[0].replace(/\s+/g, ' ').trim())}</a> <span class="fine" lang="en">${esc(x.item.brand || '')}</span> <b style="background:${TIER_COLOR[x.item.capped ? 'OK' : x.item.band] || TIER_COLOR.Good}">${Math.round(x.item.score)}</b></li>`).join('')}</ul>` : '';
  const ld = { '@context': 'https://schema.org', '@type': 'Product', name: nm, inLanguage: code, brand: p.brand ? { '@type': 'Brand', name: p.brand } : undefined, image: p.image_url || undefined, category: p.category, description: desc, url };
  const css = RECIPE_CSS + `.bigscore{display:flex;align-items:center;gap:14px;margin:16px 0 6px}.bigscore b{width:84px;height:84px;border-radius:50%;display:grid;place-items:center;font-size:32px;color:#fff;background:${TIER_COLOR[tier] || TIER_COLOR.OK}}.bigscore span{font-weight:600}
.phero{display:grid;grid-template-columns:140px 1fr;gap:18px;align-items:center;margin:14px 0}.phero img{width:140px;height:140px;object-fit:contain;background:#fff;border-radius:14px;border:1px solid var(--line)}
td.r{color:var(--dim)}ul.swaps{list-style:none;padding:0;margin:0}ul.swaps li{display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line)}ul.swaps li a{font-weight:600}ul.swaps li b{margin-left:auto;min-width:40px;text-align:center;color:#fff;border-radius:999px;padding:3px 10px}
.langs{margin:0 0 8px}body{line-height:1.7}@media(max-width:520px){.phero{grid-template-columns:96px 1fr}.phero img{width:96px;height:96px}td.r{display:none}}`;
  const nav = `<nav><a class="brand" href="/">Poshan Score <small>by KidPoshan</small></a><a href="/${code}/best">${esc(BEST[code].crumbBest)}</a><a href="/${code}/ideas">${esc(L.ideas)}</a><a href="/products">${esc(P.products)}</a></nav>`;
  const meta = [p.brand, kindLabel(p.kind, p.kind_label), p.pack_size].filter(Boolean).join(' · ');
  let html = `<!doctype html>
<html lang="${L.html}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<script type="application/ld+json">${JSON.stringify(ld)}</script>
${alternates(SITE, rel)}
<style>${css}</style></head><body>
${nav}
<main>
${switcher(rel, code)}
<p class="crumb"><a href="/">${esc(L.home)}</a> › <a href="/products">${esc(P.products)}</a> › ${esc(catName)}</p>
<h1>${esc(P.h1(nm))}</h1>
<div class="phero">${p.image_url ? `<img src="${esc(p.image_url)}" alt="${esc(nm)}" loading="eager" referrerpolicy="no-referrer">` : '<div></div>'}
<div class="bigscore"><b>${score}</b><div><div><strong>${esc(band)}</strong></div><span class="fine">${esc(P.scoreFor(age, !!p.capped))}</span></div></div></div>
<p lang="en" class="fine">${esc(meta)}</p>
<p>${esc(P.intro)}</p>
${swapHtml}
<p class="fine"><a href="/compare?a=${p.id}">${esc(P.compare(nm))}</a></p>
<h2>${esc(P.every)}</h2><table>${byAge}</table>
<h2>${esc(P.ten)}</h2><table>${metrics}</table>
<p class="fine">${esc(P.tenNote)}</p>
<h2>${esc(P.label)}</h2><table>${label}</table>
${p.ingredients && p.ingredients.length ? `<h2>${esc(P.ing)}</h2><p lang="en">${esc(p.ingredients.join(', '))}</p>` : ''}
<p class="fine"><a href="/${rel}">${esc(P.report)}</a></p>
<p style="margin-top:22px"><a class="cta" href="/products?open=${p.id}">${esc(P.change)}</a><a class="cta alt" href="/scan">${esc(P.scan)}</a></p>
${p.data_source === 'openfoodfacts' ? `<p class="fine">${esc(P.off)}</p>` : ''}
<p class="fine">${esc(P.fine)}</p>
</main><script src="/kp-visits.js" defer></script></body></html>`;
  html = withMeta(html, { url, title, desc, type: 'article' });
  return { html, url, path: `${code}/${rel}.html` };
}

module.exports = { packPageLocal };
