// Ranking pages: "Best [food type] for kids in India, ranked by Poshan Score", one per kind of food that has enough scored packs,
// and an index page that lists them all. Everything on a page is worked out from the packs' real scores (ages 4-6), so the text is data, not filler.
// Called from build-seo.cjs with the packs it has already fetched: [{ item, detail }].
const MIN_PACKS = 3;                 // a page with one or two packs is thin and does not rank: those kinds are left out
// a kind whose stored name says less than it holds (the noodles kind also holds pasta, spaghetti and vermicelli)
const LABEL_OVERRIDE = { instant_noodles: 'Noodles and pasta' };
const slugKind = (k) => String(k).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// what each check means for a parent reading the label, with the 4-6 year limits the score uses
const CHECK_HELP = {
  'Added sugar': 'Look at added sugar per serving. For a child of 4 to 6 the daily ideal is 17 g, and a pack fails this check when one serving takes 30% of that (15% for snacks and sweets).',
  'Sodium': 'Look at sodium per serving. For a child of 4 to 6 the daily limit is about 1,360 mg, and a pack fails when one serving takes 30% of it (15% for snacks).',
  'Saturated fat': 'Look at saturated fat per serving. For a child of 4 to 6 the daily limit is about 15 g, and a pack fails when one serving takes 30% of it (15% for snacks).',
  'Trans fat / hydrogenated oils': 'Check the ingredient list for hydrogenated oil, vanaspati, margarine or shortening. Any of them fails this check.',
  'Fibre': 'Look for fibre. A pack passes when one serving gives at least 15% of a 4 to 6 year old\'s day, about 3 g.',
  'Protein': 'Look for protein. A pack passes when one serving gives at least 15% of a 4 to 6 year old\'s day, about 2.4 g.',
  'Preservatives': 'Check the ingredient list for preservatives such as benzoates, sorbates, propionates, sulphites or INS 200 to 228.',
  'Artificial additives': 'Check the ingredient list for artificial colours, flavour enhancers (INS 627, 631, 635), artificial sweeteners and flavours.',
  'Base-ingredient integrity': 'Check what comes first in the ingredient list. A pack fails when sugar, or a refined flour, starch or fat, is the first ingredient.',
  'HFSS status': 'HFSS means high in fat, sugar or salt. This check fails when the sugar, sodium or saturated-fat check fails.',
};

function build(packs, ctx) {
  const { esc, withMeta, SITE, TIER_COLOR, RECIPE_CSS, NAV, slugOf } = ctx;
  const tierOf = (n) => (n >= 80 ? 'Good' : n >= 50 ? 'OK' : 'Do not use');
  // group by kind
  const byKind = new Map();
  for (const { item, detail } of packs) {
    if (!item.kind || !item.kind_label || !item.kind_checked) continue;                  // a pack whose kind has not been checked may be in the wrong ranking
    if (!byKind.has(item.kind)) byKind.set(item.kind, { kind: item.kind, label: LABEL_OVERRIDE[item.kind] || item.kind_label, category: item.category || 'Other', rows: [] });
    const fails = (detail?.metrics || []).filter((m) => m.score === 0).map((m) => m.name);
    byKind.get(item.kind).rows.push({
      id: item.id, name: String(item.name || '').split('|')[0].replace(/\s+/g, ' ').trim(), brand: item.brand || '', pack: item.pack_size || '', score: Math.round(item.score),
      band: item.band, capped: !!item.capped, image: item.image_url || '', fails, slug: slugOf({ id: item.id, name: item.name }),
    });
  }
  const groups = [...byKind.values()].filter((g) => g.rows.length >= MIN_PACKS);
  for (const g of groups) { g.rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)); g.slug = slugKind(g.kind); }
  groups.sort((a, b) => a.label.localeCompare(b.label));

  const files = [], urls = [];
  const css = RECIPE_CSS + `
.rank{width:100%;border-collapse:collapse;font-size:15px}.rank td{padding:10px 6px;border-bottom:1px solid var(--line);vertical-align:middle}
.rank .n{width:30px;color:var(--dim);text-align:center}.rank img{width:52px;height:52px;object-fit:contain;background:#fff;border-radius:10px;border:1px solid var(--line);display:block}
.rank .nm a{color:var(--ink);font-weight:600;text-decoration:none}.rank .nm small{display:block;color:var(--dim);font-weight:400}
.rank .sc{width:70px;text-align:center}.rank .sc b{display:inline-block;min-width:44px;color:#fff;border-radius:999px;padding:3px 10px;font-size:15px}
.rank .fl{color:var(--dim);font-size:13px}
.tiers{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.tiers span{border-radius:999px;padding:4px 12px;font-size:13.5px;color:#fff}
.faq h3{font-size:17px;margin:18px 0 4px}.faq p{margin:0 0 8px}
.cats{columns:2;column-gap:28px}.cats a{color:var(--ink);font-weight:600;text-decoration:none}.cats li{break-inside:avoid;margin:0 0 6px}.cats ul{list-style:none;padding:0;margin:0 0 14px}
@media(max-width:520px){.rank .fl{display:none}.cats{columns:1}}`;

  for (const g of groups) {
    const n = g.rows.length, lab = g.label, low = lab.toLowerCase();
    const top = g.rows[0], bottom = g.rows[n - 1];
    const cnt = { Good: 0, OK: 0, 'Do not use': 0 };
    for (const r of g.rows) cnt[tierOf(r.score)]++;
    const failCount = {};
    for (const r of g.rows) for (const f of r.fails) failCount[f] = (failCount[f] || 0) + 1;
    delete failCount['HFSS status'];                       // it only repeats the sugar, sodium and saturated-fat checks
    const common = Object.entries(failCount).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3);
    const url = `${SITE}/best/${g.slug}`;
    const title = `Best ${low} for kids in India, ranked by Poshan Score`;
    const desc = `${n} ${low} ranked by Poshan Score for children aged 4 to 6. Top pick: ${top.name} (${top.score}/100). See which pass the sugar, salt, saturated fat, fibre, protein and ingredient checks.`;
    const related = groups.filter((x) => x.category === g.category && x.kind !== g.kind).slice(0, 6);
    const faq = [
      [`What are the best ${low} for kids?`, `Of the ${n} ${low} we have scored, ${top.name}${top.brand && !top.name.toLowerCase().includes(top.brand.toLowerCase()) ? ' by ' + top.brand : ''} scores highest: ${top.score} out of 100 for a child aged 4 to 6 (${tierOf(top.score)}). The lowest is ${bottom.name}, at ${bottom.score}.`],
      [`Are ${low} healthy for kids?`, `It depends on the pack. Of the ${n} we have scored, ${cnt.Good} ${cnt.Good === 1 ? 'is' : 'are'} Good (80 or more), ${cnt.OK} OK (50 to 79) and ${cnt['Do not use']} Do not use (under 50).${common.length ? ` The most common reason a pack loses points is the ${common[0][0].toLowerCase()} check (${common[0][1]} of ${n}).` : ''}`],
      ['How is the Poshan Score worked out?', 'Ten yes-or-no checks on one realistic serving: added sugar, sodium, saturated fat, trans fat, fibre, protein, preservatives, artificial additives, the first ingredient, and whether the pack is high in fat, sugar or salt. Each check passed is worth 10 points. The limits come from ICMR-NIN 2020, WHO and FSSAI, and they change with the child\'s age, so the same pack can score differently for a toddler and a teenager.'],
    ];
    const ld = [
      { '@context': 'https://schema.org', '@type': 'ItemList', name: title, itemListOrder: 'https://schema.org/ItemListOrderDescending', numberOfItems: n,
        itemListElement: g.rows.slice(0, 10).map((r, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE}/products/${r.slug}`, name: r.name })) },
      { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
    ];
    const rowsHtml = g.rows.map((r, i) => `<tr><td class="n">${i + 1}</td><td style="width:60px">${r.image ? `<img src="${esc(r.image)}" alt="${esc(r.name)}" loading="lazy" referrerpolicy="no-referrer">` : ''}</td>
<td class="nm"><a href="/products/${r.slug}">${esc(r.name)}</a><small>${esc([r.brand, r.pack].filter(Boolean).join(' · '))}</small><span class="fl">${r.fails.length ? 'Fails: ' + esc(r.fails.join(', ')) : 'Passes every check'}</span></td>
<td class="sc"><b style="background:${TIER_COLOR[r.capped ? 'OK' : tierOf(r.score)] || TIER_COLOR.Good}">${r.score}</b></td></tr>`).join('');
    const help = common.map(([c]) => CHECK_HELP[c] ? `<li><b>${esc(c)}.</b> ${esc(CHECK_HELP[c])}</li>` : '').join('');
    let html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<script type="application/ld+json">${JSON.stringify(ld[0])}</script><script type="application/ld+json">${JSON.stringify(ld[1])}</script>
<style>${css}</style></head><body>
${NAV}
<main>
<p class="crumb"><a href="/">Home</a> › <a href="/best">Best by food type</a> › ${esc(lab)}</p>
<h1>Best ${esc(low)} for kids in India, ranked</h1>
<p>We have scored <b>${n}</b> ${esc(low)}. Each gets a Poshan Score out of 100 for a child aged 4 to 6, worked out from the label for one serving. Open any pack to see the score for every age, from toddlers to adults.</p>
<div class="tiers"><span style="background:${TIER_COLOR.Good}">${cnt.Good} Good (80+)</span><span style="background:${TIER_COLOR.OK}">${cnt.OK} OK (50–79)</span><span style="background:${TIER_COLOR['Do not use']}">${cnt['Do not use']} Do not use (under 50)</span></div>
<table class="rank">${rowsHtml}</table>
${help ? `<h2>What to check on the label</h2><p>The checks ${esc(low)} most often fail:</p><ul>${help}</ul>` : ''}
<div class="faq"><h2>Common questions</h2>${faq.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join('')}</div>
${related.length ? `<h2>Related rankings</h2><p>${related.map((x) => `<a href="/best/${x.slug}">${esc(x.label)}</a>`).join(' · ')}</p>` : ''}
<p style="margin-top:22px"><a class="cta" href="/products">Check a pack for your child's age</a><a class="cta alt" href="/scan">Scan a pack</a></p>
<p class="fine">Poshan Score is an independent rating, not a certification, and no brand pays to be here. Label values come from the pack's own page or Open Food Facts and are checked before a product is listed. The age guide is general, not medical advice.</p>
</main><script src="/kp-visits.js" defer></script></body></html>`;
    html = withMeta(html, { url, title, desc });
    files.push({ path: `best/${g.slug}.html`, html });
    urls.push({ loc: url, pr: '0.8' });
  }

  // the index: every ranking, by category
  const cats = {};
  for (const g of groups) (cats[g.category] = cats[g.category] || []).push(g);
  const indexTitle = 'Best packaged food for kids in India, ranked by Poshan Score';
  const indexDesc = `Rankings of ${groups.length} kinds of packaged food for kids in India, from noodles and biscuits to cereals and sauces, each pack scored out of 100 for your child's age.`;
  const catHtml = Object.keys(cats).sort().map((c) => `<li><h2>${esc(c)}</h2><ul>${cats[c].map((g) => `<li><a href="/best/${g.slug}">${esc(g.label)}</a> <span class="fine">· ${g.rows.length} packs · top pick ${esc(g.rows[0].name.slice(0, 40))} (${g.rows[0].score})</span></li>`).join('')}</ul></li>`).join('');
  let hub = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(indexTitle)}</title><style>${css}</style></head><body>
${NAV}
<main>
<p class="crumb"><a href="/">Home</a> › Best by food type</p>
<h1>Best packaged food for kids, ranked by food type</h1>
<p>Pick a kind of food to see every pack we have scored, best first. Scores are out of 100 for a child aged 4 to 6; open a pack to see it for any age from toddlers to adults. No brand pays to be here.</p>
<ul class="cats" style="list-style:none;padding:0">${catHtml}</ul>
<p><a class="cta" href="/products">See all products</a><a class="cta alt" href="/recipes">Recipes</a></p>
</main><script src="/kp-visits.js" defer></script></body></html>`;
  hub = withMeta(hub, { url: `${SITE}/best`, title: indexTitle, desc: indexDesc });
  files.push({ path: 'best.html', html: hub });
  urls.push({ loc: `${SITE}/best`, pr: '0.8' });
  return { files, urls, count: groups.length, skipped: [...byKind.values()].filter((g) => g.rows.length < MIN_PACKS).length };
}

module.exports = { build, MIN_PACKS, slugKind };
