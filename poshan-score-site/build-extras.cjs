// Pages that answer what parents search for, built from the packs' real scores:
//   "Best breakfast cereal for 4 to 6 year olds"   (every food type, by age)
//   "Bournvita vs Horlicks vs homemade"            (the best packs of a food type side by side, with homemade alternatives)
// and the share links (WhatsApp, a QR code) that go on them. The text is data, not filler: counts, scores and the checks that differ.
const tierOf = (n) => (n >= 80 ? 'Good' : n >= 50 ? 'OK' : 'Do not use');
const AGES = [
  { key: '1-3y', slug: 'toddlers', phrase: 'toddlers (1 to 3 years)', short: 'toddlers', label: '1–3 years' },
  { key: '4-6y', slug: '4-6-year-olds', phrase: '4 to 6 year olds', short: '4 to 6 year olds', label: '4–6 years', extra: 'This covers a 5 year old.' },
  { key: '7-9y', slug: '7-9-year-olds', phrase: '7 to 9 year olds', short: '7 to 9 year olds', label: '7–9 years' },
  { key: '10-12y', slug: '10-12-year-olds', phrase: '10 to 12 year olds', short: '10 to 12 year olds', label: '10–12 years' },
  { key: '13-15y', slug: 'teens', phrase: 'teenagers (13 to 15 years)', short: 'teenagers', label: '13–15 years' },
];

// "Buy" links: a search on each quick-commerce app for the pack or ingredient. They are plain searches (no affiliate code, no payment to us).
const STORES = [['blinkit', 'Blinkit', 'https://blinkit.com/s/?q='], ['zepto', 'Zepto', 'https://www.zepto.com/search?query='], ['instamart', 'Swiggy Instamart', 'https://www.swiggy.com/instamart/search?custom_back=true&query=']];
const escA = (t) => String(t).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
function buyLinks(q) {
  q = String(q).replace(/\s+/g, ' ').trim().slice(0, 80);
  return STORES.map(([id, name, base]) => `<a data-buy="${id}" data-q="${escA(q)}" href="${base}${encodeURIComponent(q)}" target="_blank" rel="nofollow noopener">${name}</a>`).join('');
}
// a product: "Find it on" + three stores
const BUY_JS = '<script src="/kp-buy.js" defer></script>';
function buyProduct(name) { return `<div class="buy"><b>Find it on</b>${buyLinks(name)}<span class="fine">Searches in the store apps for your country. Tapping copies the name, in case the app opens without the search. We earn nothing from these links, and a store may not stock this pack.</span></div>${BUY_JS}`; }
// a recipe: the ingredient list with a search link beside each, tucked away until opened
function ingName(t) {
  let s = String(t).toLowerCase().replace(/\([^)]*\)/g, ' ').split(/,| - | or /)[0];
  s = s.replace(/\b(to taste|as needed|for (frying|garnish|serving)|and pepper)\b.*$/, '');
  const lead = /^([\s\d\/.½¼¾⅓⅔-]+|(to|cups?|tablespoons?|teaspoons?|tbsp|tsp|g|grams?|kg|ml|l|litres?|liters?|oz|ounces?|lbs?|pounds?|cloves?|inch|pinch(es)?|handful|heaped|level|small|medium|large|big|ripe|fresh|chopped|diced|sliced|minced|grated|finely|of|a|an|the)\b\s*)/;
  for (let i = 0; i < 8 && lead.test(s); i++) s = s.replace(lead, '');
  s = s.replace(/\s+/g, ' ').trim();
  return /^(water|ice|ice water|hot water|warm water)$/.test(s) ? '' : s;
}
function buyRecipe(ings, title, url) {
  const rows = [], seen = new Set();
  for (const i of ings || []) { const n = ingName(i); if (n.length < 3 || n.length > 40 || seen.has(n)) continue; seen.add(n); rows.push(`<li><span>${escA(n)}</span>${buyLinks(n)}</li>`); }
  if (rows.length < 2) return '';
  const lines = (ings || []).map((x) => String(x).replace(/\s+/g, ' ').trim()).filter(Boolean), head = `Shopping list: ${title}`;
  const wa = 'https://wa.me/?text=' + encodeURIComponent(head + '\n' + lines.map((l) => '- ' + l).join('\n') + '\n\n' + url);
  return `<details class="buy buyr"><summary>Get the ingredients delivered</summary><div class="blist"><button type="button" data-buy="list-copy" data-q="${escA(title)}" data-title="${escA(head)}" data-items="${escA(JSON.stringify(lines))}">Copy the whole list</button><a data-buy="list-whatsapp" data-q="${escA(title)}" href="${wa}" target="_blank" rel="noopener">Send the list on WhatsApp</a></div><ul>${rows.join('')}</ul><p class="fine">The apps do not let a website fill a cart, so each link searches one item and copies its name. Or copy the whole list and paste it into the app or a message. We earn nothing from these links.</p></details>${BUY_JS}`;
}
const BUY_CSS = `.buy{margin:14px 0;display:flex;flex-wrap:wrap;gap:8px;align-items:center}.buy a{font-size:14px;font-weight:600;text-decoration:none;border:1.5px solid var(--line);border-radius:999px;padding:7px 14px;color:var(--ink);background:var(--card)}.buy .fine{flex-basis:100%}
.blist{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}.blist button,.blist a{font:600 14px system-ui;border:1.5px solid var(--line);border-radius:999px;padding:8px 14px;background:var(--card);color:var(--ink);text-decoration:none;cursor:pointer}.buyr{display:block}.buyr summary{cursor:pointer;font-weight:700}.buyr ul{list-style:none;padding:0;margin:10px 0}.buyr li{display:flex;flex-wrap:wrap;gap:6px 8px;align-items:center;padding:7px 0;border-bottom:1px solid var(--line)}.buyr li span{flex:1 1 140px;text-transform:capitalize}.buyr li a{padding:4px 10px;font-size:13px}`;

// a "Share on WhatsApp" link and a QR code button for any page (the QR code is drawn in the browser by /kp-qr.js)
function shareHtml(SITE, rel, text, { qr = true, label = 'Share on WhatsApp', qrLabel = 'QR code' } = {}) {
  const url = `${SITE}/${rel}`.replace(/\/$/, '') || SITE;
  const wa = `https://wa.me/?text=${encodeURIComponent(text + ' ' + url)}`;
  return `<p class="share" translate="no"><a class="wa" href="${wa}" target="_blank" rel="noopener">${label}</a>${qr ? ` <button type="button" class="qrb" data-qr-url="${url}">${qrLabel}</button>` : ''}</p>${qr ? '<div class="qrbox" hidden></div>' : ''}`;
}
const SHARE_CSS = `.share{margin:10px 0}.share .wa{display:inline-block;background:#25D366;color:#073B1A;font-weight:700;text-decoration:none;border-radius:999px;padding:8px 16px;font-size:14px}.qrb{font:600 14px system-ui;border:1.5px solid var(--ink);background:none;color:var(--ink);border-radius:999px;padding:7px 14px;cursor:pointer;margin-left:6px}.qrbox{margin:8px 0 14px;text-align:center}.qrbox svg{width:200px;height:200px;background:#fff;border-radius:10px;padding:6px}.qrbox a{display:block;font-size:13px;margin-top:4px}`;
const QR_SCRIPT = '<script src="/qrcode.js" defer></script><script src="/kp-qr.js" defer></script>';

function build(packsData, groups, recipes, ctx) {
  const { esc, withMeta, SITE, TIER_COLOR, RECIPE_CSS, NAV, slugOf, recName } = ctx;
  const css = RECIPE_CSS + SHARE_CSS + `
.rank{width:100%;border-collapse:collapse;font-size:15px}.rank td{padding:10px 6px;border-bottom:1px solid var(--line);vertical-align:middle}.rank .n{width:30px;color:var(--dim);text-align:center}
.rank img{width:52px;height:52px;object-fit:contain;background:#fff;border-radius:10px;border:1px solid var(--line);display:block}.rank .nm a{color:var(--ink);font-weight:600;text-decoration:none}.rank .nm small{display:block;color:var(--dim);font-weight:400}
.rank .sc{width:70px;text-align:center}.rank .sc b,.pill{display:inline-block;min-width:44px;color:#fff;border-radius:999px;padding:3px 10px;font-size:15px;font-weight:700}
.tiers{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.tiers span{border-radius:999px;padding:4px 12px;font-size:13.5px;color:#fff}.faq h3{font-size:17px;margin:18px 0 4px}.faq p{margin:0 0 8px}
.cmp{width:100%;border-collapse:collapse;font-size:14.5px}.cmp th,.cmp td{padding:9px 6px;border-bottom:1px solid var(--line);text-align:center;vertical-align:top}.cmp th{font-size:13px;color:var(--dim);font-weight:600}
.cmp td:first-child,.cmp th:first-child{text-align:left;width:34%}.cmp td.y b{color:#3F6B3C}.cmp td.n b{color:#A6402A}.cmp small{display:block;color:var(--dim);font-size:12px;font-weight:400}.scroll{overflow-x:auto;margin:0 -18px;padding:0 18px}
.heads{display:grid;gap:12px;margin:14px 0}.hd{text-align:center;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 8px}.hd img{width:70px;height:70px;object-fit:contain;background:#fff;border-radius:10px}.hd .big{width:60px;height:60px;border-radius:50%;display:grid;place-items:center;color:#fff;font-size:24px;font-weight:700;margin:6px auto 2px}
.hd a{color:var(--ink);font-weight:700;text-decoration:none;display:block}
@media(max-width:520px){.rank .fl{display:none}.cmp small{display:none}}`;
  const byId = new Map(packsData.map((p) => [p.item.id, p]));
  const files = [], urls = [], ageLinks = {};
  const pill = (n, capped) => (n == null ? '–' : `<span class="pill" style="background:${TIER_COLOR[capped ? 'OK' : tierOf(n)] || TIER_COLOR.OK}">${n}</span>`);

  // ---------- 1. best [food type] for [age] ----------
  for (const g of groups) {
    const label = g.label, low = label.toLowerCase();
    for (const a of AGES) {
      const rows = g.rows.map((r) => { const d = byId.get(r.id); const sc = d && d.detail && d.detail.scores_by_age ? d.detail.scores_by_age[a.key] : null; return { ...r, sc: sc == null ? null : Math.round(sc) }; })
        .filter((r) => r.sc != null).sort((x, y) => y.sc - x.sc || x.name.localeCompare(y.name));
      if (rows.length < 3) continue;
      const n = rows.length, top = rows[0];
      const cnt = { Good: 0, OK: 0, 'Do not use': 0 }; for (const r of rows) cnt[tierOf(r.sc)]++;
      const slug = `${g.slug}-for-${a.slug}`, rel = `best/${slug}`, url = `${SITE}/${rel}`;
      const title = `Best ${low} for ${a.phrase} in India, ranked by Poshan Score`;
      const desc = `${n} ${low} ranked for ${a.phrase} by Poshan Score. Top pick: ${top.name} (${top.sc}/100). ${cnt.Good} Good, ${cnt.OK} OK, ${cnt['Do not use']} Do not use.`;
      const failCount = {}; if (a.key === '4-6y') for (const r of rows) for (const f of r.fails || []) if (f !== 'HFSS status') failCount[f] = (failCount[f] || 0) + 1;
      const common = Object.entries(failCount).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k]) => k.toLowerCase());
      const faq = [
        [`What is the best ${low.replace(/s$/, '')} for ${a.short}?`, `Of the ${n} ${low} we have scored for ${a.short}, ${top.name}${top.brand && !top.name.toLowerCase().includes(top.brand.toLowerCase()) ? ' by ' + top.brand : ''} scores highest: ${top.sc} out of 100 (${tierOf(top.sc)}).${a.extra ? ' ' + a.extra : ''}`],
        [`Is ${low} healthy for ${a.short}?`, `It depends on the pack. For ${a.short}, ${cnt.Good} of the ${n} are Good (80 or more), ${cnt.OK} OK (50 to 79) and ${cnt['Do not use']} Do not use (under 50).${common.length ? ` The checks they most often fail are ${common.join(', ')}.` : ''} The score is for one serving as the label gives it, and the limits for sugar, salt and saturated fat are smaller for younger children.`],
        ['How is the Poshan Score worked out?', 'Ten yes-or-no checks on one serving: added sugar, sodium, saturated fat, trans fat, fibre, protein, preservatives, artificial additives, the first ingredient, and whether it is high in fat, sugar or salt. Each passed check is worth 10 points. The limits come from ICMR-NIN 2020, WHO and FSSAI and change with the age.'],
      ];
      const others = AGES.filter((x) => x.slug !== a.slug && g.rows.some(() => true)).map((x) => ({ x, slug: `${g.slug}-for-${x.slug}` }));
      const rowsHtml = rows.map((r, i) => `<tr><td class="n">${i + 1}</td><td style="width:60px">${r.image ? `<img src="${esc(r.image)}" alt="${esc(r.name)}" loading="lazy" referrerpolicy="no-referrer">` : ''}</td><td class="nm"><a href="/products/${r.slug}">${esc(r.name)}</a><small>${esc([r.brand, r.pack].filter(Boolean).join(' · '))}</small>${a.key === '4-6y' ? `<span class="fl">${(r.fails || []).filter((f) => f !== 'HFSS status').length ? 'Fails: ' + esc((r.fails || []).filter((f) => f !== 'HFSS status').join(', ')) : 'Passes every check'}</span>` : ''}</td><td class="sc"><b style="background:${TIER_COLOR[tierOf(r.sc)]}">${r.sc}</b></td></tr>`).join('');
      const ld = [
        { '@context': 'https://schema.org', '@type': 'ItemList', name: title, numberOfItems: n, itemListElement: rows.slice(0, 10).map((r, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE}/products/${r.slug}`, name: r.name })) },
        { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map(([q, an]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: an } })) },
      ];
      let html = `<!doctype html>
<html lang="en-IN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${ld.map((o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`).join('')}
<style>${css}</style></head><body>
${NAV}
<main>
<p class="crumb"><a href="/">Home</a> › <a href="/best">Best by food type</a> › <a href="/best/${g.slug}">${esc(label)}</a> › ${esc(a.short)}</p>
<h1>Best ${esc(low)} for ${esc(a.phrase)}</h1>
<p>We have scored <b>${n}</b> ${esc(low)} for ${esc(a.phrase)}, worked out from the label for one serving. ${esc(a.extra || '')} ${esc(top.name)} comes first with ${top.sc} out of 100.</p>
<div class="tiers"><span style="background:${TIER_COLOR.Good}">${cnt.Good} Good (80+)</span><span style="background:${TIER_COLOR.OK}">${cnt.OK} OK (50–79)</span><span style="background:${TIER_COLOR['Do not use']}">${cnt['Do not use']} Do not use (under 50)</span></div>
${shareHtml(SITE, rel, `Best ${low} for ${a.short}, ranked by Poshan Score: top pick ${top.name} (${top.sc}/100).`)}
<table class="rank">${rowsHtml}</table>
<div class="faq"><h2>Common questions</h2>${faq.map(([q, an]) => `<h3>${esc(q)}</h3><p>${esc(an)}</p>`).join('')}</div>
<h2>Other ages</h2><p>${others.map((o) => `<a href="/best/${o.slug}">${esc(o.x.short)}</a>`).join(' · ')} · <a href="/best/${g.slug}">${esc(label)} (all ages)</a></p>
<p style="margin-top:22px"><a class="cta" href="/products">Check a pack for your child's age</a><a class="cta alt" href="/compare">Compare two packs</a></p>
<p class="fine">Poshan Score is an independent rating, not a certification, and no brand pays to be here. The age guide is general, not medical advice.</p>
</main>${QR_SCRIPT}<script src="/kp-visits.js" defer></script></body></html>`;
      html = withMeta(html, { url, title, desc });
      files.push({ path: `${rel}.html`, html }); urls.push({ loc: url, pr: '0.7' });
      (ageLinks[g.slug] = ageLinks[g.slug] || []).push({ href: `/best/${slug}`, text: a.short });
    }
  }

  // ---------- 2. A vs B comparison pages ----------
  const HOMEMADE = {
    health_drink: { re: /ragi.*(malt|porridge|ambali)|\bmalt\b|badam milk|banana (shake|milkshake)|date.*shake|milkshake|smoothie|sattu|kheer/i, title: 'Homemade alternatives' },
    breakfast_cereal: { re: /poha|upma|porridge|idli|dosa|chilla|cheela|oats/i, title: 'Homemade alternatives' },
    rolled_oats: { re: /oats/i, title: 'Homemade ideas' },
    kids_biscuits: { re: /cookie|biscuit|ladoo|laddu|energy bite|date/i, title: 'Homemade alternatives' },
    chips: { re: /makhana|roasted|baked|tikki|cutlet|popcorn|chivda|bhel/i, title: 'Homemade alternatives' },
    instant_noodles: { re: /noodle|pasta|chowmein|vermicelli|semiya/i, title: 'Homemade alternatives' },
    jam: { re: /jam|fruit spread|chutney/i, title: 'Homemade ideas' },
    peanut_butter: { re: /peanut|chikki|laddu/i, title: 'Homemade ideas' },
  };
  const cmpFiles = [];
  const nameOf = (r) => String(r.name).split('|')[0].replace(/\s+/g, ' ').trim();
  const pairLinks = {};
  for (const g of groups) {
    const low = g.label.toLowerCase();
    const rows = g.rows.slice(0, 12), picks = [], seenBrand = new Set();
    for (const r of rows) { const b = String(r.brand || r.name).toLowerCase(); if (seenBrand.has(b)) continue; seenBrand.add(b); picks.push(r); if (picks.length === 4) break; }
    if (picks.length < 3) continue;
    const pairs = [];
    for (let i = 0; i < picks.length; i++) for (let j = i + 1; j < picks.length; j++) pairs.push([picks[i], picks[j]]);
    for (const [ra, rb] of pairs) {
      const A = byId.get(ra.id), B = byId.get(rb.id); if (!A || !B) continue;
      const da = A.detail, db = B.detail, sa = Math.round(A.item.score), sb = Math.round(B.item.score);
      const slug = `${A.slug}-vs-${B.slug}`.slice(0, 110), rel = `compare/${slug}`, url = `${SITE}/${rel}`;
      const na = nameOf(ra), nb = nameOf(rb);
      const title = `${na} vs ${nb}: which is healthier for kids?`;
      const hi = sa >= sb ? [ra, rb, da, db, sa, sb] : [rb, ra, db, da, sb, sa];
      const mA = da.metrics || [], mB = db.metrics || [];
      const diff = []; for (let i = 0; i < Math.max(mA.length, mB.length); i++) if (mA[i] && mB[i] && mA[i].score !== mB[i].score && mA[i].id !== 'hfss') diff.push({ name: mA[i].name.toLowerCase(), aYes: !!mA[i].score });
      const winnerBetter = (hi[2].metrics || []).filter((m, k) => m.score && hi[3].metrics && hi[3].metrics[k] && !hi[3].metrics[k].score && m.id !== 'hfss').map((m) => m.name.toLowerCase());
      const verdict = sa === sb ? `${na} and ${nb} both score ${sa} out of 100 for a child aged 4 to 6.` : `${nameOf(hi[0])} scores higher for a child aged 4 to 6: ${hi[4]} against ${hi[5]} out of 100${winnerBetter.length ? `. It passes ${winnerBetter.slice(0, 4).join(', ')}, which ${nameOf(hi[1])} does not` : ''}.`;
      const checkRows = mA.map((m, i) => { const o = mB[i]; const cell = (x) => (x ? `<td class="${x.score ? 'y' : 'n'}"><b>${x.score ? 'Yes' : 'No'}</b><small>${esc(x.reading || '')}</small></td>` : '<td>–</td>'); return `<tr><td>${m.n}. ${esc(m.name)}</td>${cell(m)}${cell(o)}</tr>`; }).join('');
      const ageRows = AGES.map((x) => `<tr><td>${esc(x.label)}</td><td>${pill(da.scores_by_age && da.scores_by_age[x.key] != null ? Math.round(da.scores_by_age[x.key]) : null)}</td><td>${pill(db.scores_by_age && db.scores_by_age[x.key] != null ? Math.round(db.scores_by_age[x.key]) : null)}</td></tr>`).join('');
      // homemade alternatives: the best-scoring recipes of the same kind of food
      const hm = HOMEMADE[g.kind]; let homemade = [];
      if (hm && recipes) homemade = recipes.filter((r) => hm.re.test(recName(r.d.name)) && (r.d.scores_by_age || {})['4-6y'] >= 80 && (r.it.diet === 'veg' || r.it.diet === 'jain')).sort((x, y) => (y.d.scores_by_age['4-6y'] - x.d.scores_by_age['4-6y']) || (x.it.id - y.it.id)).slice(0, 4);
      const faq = [
        [`Which is healthier for kids, ${na} or ${nb}?`, verdict + ' The score is for one serving as the label gives it; the limits for sugar, salt and saturated fat are smaller for younger children.'],
        [`How do ${na} and ${nb} compare for older children?`, `At 7 to 9 years they score ${da.scores_by_age ? Math.round(da.scores_by_age['7-9y']) : '–'} and ${db.scores_by_age ? Math.round(db.scores_by_age['7-9y']) : '–'}; at 10 to 12 years ${da.scores_by_age ? Math.round(da.scores_by_age['10-12y']) : '–'} and ${db.scores_by_age ? Math.round(db.scores_by_age['10-12y']) : '–'}. The full table by age is above.`],
        ['How is the Poshan Score worked out?', 'Ten yes-or-no checks on one serving: added sugar, sodium, saturated fat, trans fat, fibre, protein, preservatives, artificial additives, the first ingredient, and whether it is high in fat, sugar or salt. Each passed check is worth 10 points. The limits come from ICMR-NIN 2020, WHO and FSSAI and change with the age.'],
      ];
      const head = (r, sc, capped) => `<div class="hd">${r.image ? `<img src="${esc(r.image)}" alt="" referrerpolicy="no-referrer">` : ''}<a href="/products/${r.slug}">${esc(nameOf(r))}</a><small>${esc(r.brand || '')}</small><div class="big" style="background:${TIER_COLOR[capped ? 'OK' : tierOf(sc)]}">${sc}</div></div>`;
      const ld = [{ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map(([q, an]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: an } })) }];
      let html = `<!doctype html>
<html lang="en-IN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${ld.map((o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`).join('')}
<style>${css}</style></head><body>
${NAV}
<main>
<p class="crumb"><a href="/">Home</a> › <a href="/compare">Compare</a> › ${esc(na)} vs ${esc(nb)}</p>
<h1>${esc(na)} vs ${esc(nb)}: which is healthier for kids?</h1>
<p>${esc(verdict)}</p>
<div class="heads" style="grid-template-columns:1fr 1fr">${head(ra, sa, A.item.capped)}${head(rb, sb, B.item.capped)}</div>
${shareHtml(SITE, rel, `${na} vs ${nb} for kids: ${sa} vs ${sb} out of 100 on Poshan Score.`)}
<h2>The ten checks, side by side</h2>
<div class="scroll"><table class="cmp"><tr><th></th><th>${esc(na.slice(0, 32))}</th><th>${esc(nb.slice(0, 32))}</th></tr>${checkRows}</table></div>
<h2>Score at every age</h2>
<div class="scroll"><table class="cmp"><tr><th></th><th>${esc(na.slice(0, 32))}</th><th>${esc(nb.slice(0, 32))}</th></tr>${ageRows}</table></div>
${homemade.length ? `<h2>${esc(hm.title)}</h2><p>Made at home, these score well for a child aged 4 to 6:</p><ul class="ing">${homemade.map((r) => `<li><a href="/recipes/${r.slug}">${esc(recName(r.d.name))}</a> <span class="fine">· ${Math.round(r.d.scores_by_age['4-6y'])}/100 · ${esc(r.it.by || '')}</span></li>`).join('')}</ul>` : ''}
<div class="faq"><h2>Common questions</h2>${faq.map(([q, an]) => `<h3>${esc(q)}</h3><p>${esc(an)}</p>`).join('')}</div>
<p style="margin-top:22px"><a class="cta" href="/compare?a=${A.item.id}&b=${B.item.id}">Change the age or the packs</a><a class="cta alt" href="/best/${g.slug}">All ${esc(low)} ranked</a></p>
<p class="fine">Poshan Score is an independent rating, not a certification, and no brand pays to be here. Brand names belong to their owners; KidPoshan is not connected with them. The age guide is general, not medical advice.</p>
</main>${QR_SCRIPT}<script src="/kp-visits.js" defer></script></body></html>`;
      html = withMeta(html, { url, title, desc: `${na} vs ${nb}: ${verdict} See all ten checks and the score at every age.` });
      cmpFiles.push({ path: `${rel}.html`, html }); urls.push({ loc: url, pr: '0.6' });
      (pairLinks[g.slug] = pairLinks[g.slug] || []).push({ href: `/${rel}`, text: `${na} vs ${nb}` });
    }
  }
  files.push(...cmpFiles);
  return { files, urls, ageLinks, pairLinks, count: { age: files.length - cmpFiles.length, cmp: cmpFiles.length } };
}

module.exports = { build, buyProduct, buyRecipe, shareHtml, SHARE_CSS: SHARE_CSS + BUY_CSS, QR_SCRIPT, AGES };
