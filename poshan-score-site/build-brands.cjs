// Brand pages: "Is Bournvita healthy for kids?", one per well-known health-drink brand that has at least two scored packs, and a page that lists them.
// Everything on a page is worked out from the packs' real scores and label readings, so the text is data, not filler.
// Called from build-seo.cjs with the packs it has already fetched: [{ item, detail }].
const i18n = require('./build-i18n.cjs');
const { shareHtml, SHARE_CSS, QR_SCRIPT } = require('./build-extras.cjs');
const MIN_PACKS = 2;
// brand names are people's own trademarks: the pages say so, and say that nobody here is affiliated with them
const BRANDS = [
  { slug: 'bournvita', name: 'Bournvita', re: /bournvita/i },
  { slug: 'horlicks', name: 'Horlicks', re: /horlicks/i },
  { slug: 'boost', name: 'Boost', re: /\bboost\b/i },
  { slug: 'complan', name: 'Complan', re: /complan/i },
  { slug: 'pediasure', name: 'PediaSure', re: /pediasure/i },
  { slug: 'protinex', name: 'Protinex', re: /protinex/i },
];
const KIND = 'health_drink';
const AGES = ['1-3y', '4-6y', '7-9y', '10-12y', '13-15y', '16-18y', 'adult'];
const AGE_SHORT = { '1-3y': '1–3', '4-6y': '4–6', '7-9y': '7–9', '10-12y': '10–12', '13-15y': '13–15', '16-18y': '16–18', adult: 'Adult' };

function build(packs, ctx) {
  const { esc, withMeta, SITE, TIER_COLOR, RECIPE_CSS, NAV, slugOf } = ctx;
  const tierOf = (n) => (n >= 80 ? 'Good' : n >= 50 ? 'OK' : 'Do not use');
  const nameOf = (it) => String(it.name || '').split('|')[0].replace(/\s+/g, ' ').trim();
  const brands = [];
  for (const b of BRANDS) {
    const rows = packs.filter(({ item }) => item.kind === KIND && item.kind_checked && b.re.test(`${item.name} ${item.brand}`))
      .map(({ item, detail }) => ({
        id: item.id, name: nameOf(item), pack: item.pack_size || '', score: Math.round(item.score), band: item.band, capped: !!item.capped, image: item.image_url || '',
        slug: slugOf({ id: item.id, name: item.name }), byAge: (detail && detail.scores_by_age) || {}, metrics: (detail && detail.metrics) || [],
      })).sort((a, c) => c.score - a.score || a.name.localeCompare(c.name));
    if (rows.length >= MIN_PACKS) brands.push({ ...b, rows });
  }
  const files = [], urls = [];
  if (!brands.length) return { files, urls, count: 0, links: [] };

  const css = RECIPE_CSS + SHARE_CSS + `
.tbl{width:100%;border-collapse:collapse;font-size:15px}.tbl th,.tbl td{padding:9px 6px;border-bottom:1px solid var(--line);text-align:center}.tbl th{font-size:13px;color:var(--dim);font-weight:600}
.tbl td:first-child,.tbl th:first-child{text-align:left}.tbl td:first-child a{color:var(--ink);font-weight:600;text-decoration:none}.tbl small{display:block;color:var(--dim);font-weight:400}
.pill{display:inline-block;min-width:38px;color:#fff;border-radius:999px;padding:2px 9px;font-size:14px;font-weight:700}
.scroll{overflow-x:auto;margin:0 -18px;padding:0 18px}
.faq h3{font-size:17px;margin:18px 0 4px}.faq p{margin:0 0 8px}
.tiers{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.tiers span{border-radius:999px;padding:4px 12px;font-size:13.5px;color:#fff}`;
  const pill = (n, capped) => (n == null ? '<span class="fine">–</span>' : `<span class="pill" style="background:${TIER_COLOR[capped ? 'OK' : tierOf(n)] || TIER_COLOR.OK}">${n}</span>`);
  const reading = (row, name) => { const m = row.metrics.find((x) => x.name === name); return m && m.reading ? String(m.reading).replace(/\s=\s(.+)$/, ' ($1)') : null; };
  const packLabel = (r) => (r.pack && !r.name.toLowerCase().replace(/\s/g, '').includes(String(r.pack).toLowerCase().replace(/\s/g, '')) ? ' (' + r.pack + ')' : '');
  const avg = (rows) => Math.round(rows.reduce((s, r) => s + r.score, 0) / rows.length);

  for (const b of brands) {
    const rows = b.rows, n = rows.length, top = rows[0], low = rows[n - 1];
    const range = top.score === low.score ? `${top.score}` : `${low.score} to ${top.score}`;
    const cnt = { Good: 0, OK: 0, 'Do not use': 0 };
    for (const r of rows) cnt[tierOf(r.score)]++;
    const failCount = {};
    for (const r of rows) for (const m of r.metrics) if (m.score === 0 && m.name !== 'HFSS status') failCount[m.name] = (failCount[m.name] || 0) + 1;
    const common = Object.entries(failCount).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).slice(0, 3).map(([k]) => k.toLowerCase());
    const others = brands.filter((x) => x.slug !== b.slug);
    const sugar = reading(top, 'Added sugar');
    const verdict = cnt.Good === n ? `All ${n} are Good.` : cnt['Do not use'] === n ? `All ${n} are Do not use.` : `${cnt.Good} Good, ${cnt.OK} OK and ${cnt['Do not use']} Do not use.`;
    const url = `${SITE}/brands/${b.slug}`;
    const title = `Is ${b.name} healthy for kids? Poshan Score of every ${b.name} pack`;
    const desc = `We scored ${n} ${b.name} packs for children. For a child aged 4 to 6 they score ${range} out of 100. See sugar, salt, protein and the score for every age from toddlers to adults.`;
    const faq = [
      [`Is ${b.name} healthy for kids?`, `Of the ${n} ${b.name} packs we have scored, ${verdict} For a child aged 4 to 6 the scores range from ${range} out of 100.${common.length ? ` The checks they most often fail are ${common.join(', ')}.` : ' They pass every check.'} The score is one serving of the pack as the label gives it, so a heaped scoop or a second glass counts for more.`],
      ...(sugar ? [[`How much sugar is in ${b.name}?`, `For ${top.name}${packLabel(top)}, one serving has ${sugar}. A pack fails the sugar check when one serving takes 30% of a child's day, or more.`]] : []),
      ...(others.length ? [[`How does ${b.name} compare with other health drinks?`, `On our scores for a child aged 4 to 6, ${b.name} packs average ${avg(rows)} out of 100. ${others.map((o) => `${o.name} averages ${avg(o.rows)}`).join(', ')}. Open the full ranking of health drinks to see every pack side by side.`]] : []),
      ['How is the Poshan Score worked out?', 'Ten yes-or-no checks on one realistic serving: added sugar, sodium, saturated fat, trans fat, fibre, protein, preservatives, artificial additives, the first ingredient, and whether the pack is high in fat, sugar or salt. Each passed check is worth 10 points. The limits come from ICMR-NIN 2020, WHO and FSSAI and change with the age.'],
    ];
    const ld = [
      { '@context': 'https://schema.org', '@type': 'ItemList', name: title, numberOfItems: n, itemListElement: rows.map((r, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE}/products/${r.slug}`, name: r.name })) },
      { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
    ];
    const head = `<tr><th>Pack</th>${AGES.map((a) => `<th>${AGE_SHORT[a]}</th>`).join('')}</tr>`;
    const body = rows.map((r) => `<tr><td><a href="/products/${r.slug}">${esc(r.name)}</a>${r.pack && !packLabel(r) ? '' : r.pack ? `<small>${esc(r.pack)}</small>` : ''}</td>${AGES.map((a) => `<td>${pill(r.byAge[a] == null ? null : Math.round(r.byAge[a]), a === '4-6y' && r.capped)}</td>`).join('')}</tr>`).join('');
    let html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<script type="application/ld+json">${JSON.stringify(ld[0])}</script><script type="application/ld+json">${JSON.stringify(ld[1])}</script>
<style>${css}</style></head><body>
${NAV}
<main>
<p class="crumb"><a href="/">Home</a> › <a href="/brands">Health drink brands</a> › ${esc(b.name)}</p>
<h1>Is ${esc(b.name)} healthy for kids?</h1>
<p>We scored <b>${n}</b> ${esc(b.name)} ${n === 1 ? 'pack' : 'packs'} from what is printed on the label. For a child aged 4 to 6 they score <b>${esc(range)} out of 100</b>.</p>
<div class="tiers"><span style="background:${TIER_COLOR.Good}">${cnt.Good} Good (80+)</span><span style="background:${TIER_COLOR.OK}">${cnt.OK} OK (50–79)</span><span style="background:${TIER_COLOR['Do not use']}">${cnt['Do not use']} Do not use (under 50)</span></div>
${shareHtml(SITE, `brands/${b.slug}`, `Is ${b.name} healthy for kids? Poshan Score: ${range} out of 100 for a child aged 4 to 6.`)}
<h2>Score of each pack, by age</h2>
<div class="scroll"><table class="tbl">${head}${body}</table></div>
<p class="fine">Scores are out of 100 for one serving as the label gives it. The same drink scores differently as a child grows, because the daily limits for sugar and salt grow with them.</p>
${common.length ? `<h2>What holds ${esc(b.name)} back</h2><p>Across these packs the checks most often failed are <b>${esc(common.join(', '))}</b>.${sugar ? ` For ${esc(top.name)}, one serving has ${esc(sugar)}.` : ''}</p>` : ''}
<div class="faq"><h2>Common questions</h2>${faq.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join('')}</div>
<h2>More</h2><p><a href="/best/health-drink">All health drinks ranked</a>${others.map((o) => ` · <a href="/brands/${o.slug}">${esc(o.name)}</a>`).join('')}</p>
<p style="margin-top:22px"><a class="cta" href="/products">Check a pack for your child's age</a><a class="cta alt" href="/scan">Scan a pack</a></p>
<p class="fine">Poshan Score is an independent rating, not a certification, and no brand pays to be here. ${esc(b.name)} is the trademark of its owner; KidPoshan is not connected with it. Label values come from the pack's own page or Open Food Facts and are checked before a product is listed. The age guide is general, not medical advice.</p>
</main>${QR_SCRIPT}<script src="/kp-visits.js" defer></script><script src="/kp-search.js" defer></script></body></html>`;
    html = i18n.decorateEn(withMeta(html, { url, title, desc }), SITE, `brands/${b.slug}`);
    files.push({ path: `brands/${b.slug}.html`, html });
    urls.push({ loc: url, pr: '0.8' });
  }

  // the page that lists them
  const hubTitle = 'Health drinks for kids in India: Bournvita, Horlicks and more, scored';
  const hubDesc = `Poshan Score of ${brands.map((b) => b.name).join(', ')} and other health drinks for children in India: sugar, salt, protein and a score for every age.`;
  const list = brands.map((b) => `<li><a href="/brands/${b.slug}"><b>Is ${esc(b.name)} healthy for kids?</b></a> <span class="fine">· ${b.rows.length} packs · ${b.rows[b.rows.length - 1].score === b.rows[0].score ? b.rows[0].score : b.rows[b.rows.length - 1].score + ' to ' + b.rows[0].score}/100 at 4 to 6 years</span></li>`).join('');
  let hub = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(hubTitle)}</title><style>${css}</style></head><body>
${NAV}
<main>
<p class="crumb"><a href="/">Home</a> › Health drink brands</p>
<h1>Health drinks for kids, scored brand by brand</h1>
<p>Parents ask about these more than almost any other pack. Each page scores every pack we have for the brand, for each age from toddlers to adults, and shows what holds the score back.</p>
<ul>${list}</ul>
<p><a href="/best/health-drink">All health drinks ranked</a></p>
<p style="margin-top:22px"><a class="cta" href="/products">See all products</a><a class="cta alt" href="/scan">Scan a pack</a></p>
<p class="fine">Poshan Score is an independent rating, not a certification, and no brand pays to be here. Brand names belong to their owners; KidPoshan is not connected with them.</p>
</main><script src="/kp-visits.js" defer></script><script src="/kp-search.js" defer></script></body></html>`;
  hub = i18n.decorateEn(withMeta(hub, { url: `${SITE}/brands`, title: hubTitle, desc: hubDesc }), SITE, 'brands');
  files.push({ path: 'brands.html', html: hub });
  urls.push({ loc: `${SITE}/brands`, pr: '0.8' });
  return { files, urls, brands, count: brands.length, links: brands.map((b) => ({ slug: b.slug, name: b.name })) };
}

module.exports = { build, BRANDS, MIN_PACKS };
