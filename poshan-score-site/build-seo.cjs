// Everything that lets Google (and WhatsApp, Facebook, X) find and describe the site. Runs at the end of build.cjs:
//   - a meta description, canonical address and share card on every page
//   - og-image.png (the picture shown when a link is shared), drawn here with no tools needed
//   - robots.txt and sitemap.xml
//   - one page of its own for every scored product (/products/<name>), written from the platform's data at build time,
//     so "is Chocos healthy for kids" has a page to land on
const fs = require('fs'), path = require('path'), zlib = require('zlib');

const SITE = 'https://www.kidposhan.in';
const PLATFORM = 'https://kidposhan-platform.mailus-pixiedust.workers.dev';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const PAGE_META = {
  'index.html': { path: '/', title: null, desc: "Poshan Score rates kids' food and recipes out of 100 for your child's age, from sugar, salt, saturated fat, fibre, protein and the ingredient list. Independent: no brand pays to be here." },
  'age-metrics.html': { path: '/age-metrics', desc: "How the Poshan Score works: ten yes-or-no checks, worked out for every ICMR-NIN age group, from 6 months to adults, from ICMR-NIN, WHO and FSSAI references. Every threshold and source is listed." },
  'meal-ideas.html': { path: '/meal-ideas', desc: "Recipe ideas for children by age, meal, season and food preference (veg, Jain, non-veg), each with a Poshan Score out of 100. Save the ones you like and plan the week." },
  'products.html': { path: '/products', desc: "Packaged foods for kids scored out of 100 for your child's age: cereals, noodles, biscuits, ready mixes and more. See the sugar, salt and fibre behind each score." },
  'scan.html': { path: '/scan', desc: "Scan the barcode on any packaged food and see its Poshan Score for your child's age. If we do not know the pack yet, photograph the front and back and we will score it." },
  'why-we-do-this.html': { path: '/why-we-do-this', desc: "Why we built the Poshan Score: a plain, independent way to read what is really on the back of a pack, scored for each age group from 6 months to adults." },
  'built-with-parents.html': { path: '/built-with-parents', desc: 'Poshan Score is a beta built with parents: where the numbers come from, what not yet checked means, and how to add a pack or report a mistake.' },
  'privacy.html': { path: '/privacy', desc: 'How KidPoshan handles your name and mobile number: what we keep, why, and how to have it removed.' },
};

function withMeta(html, { url, title, desc, type = 'website' }) {
  if (/<meta[^>]+name=["']description["']/i.test(html)) return html;
  const t = title || (html.match(/<title>([^<]*)<\/title>/i) || [, 'Poshan Score'])[1];
  const tags = [
    `<meta name="description" content="${esc(desc)}">`,
    `<link rel="canonical" href="${esc(url)}">`,
    `<meta property="og:type" content="${type}">`,
    `<meta property="og:site_name" content="Poshan Score by KidPoshan">`,
    `<meta property="og:title" content="${esc(t)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    `<meta property="og:image" content="${SITE}/og-image.png">`,
    `<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(t)}">`,
    `<meta name="twitter:description" content="${esc(desc)}">`,
    `<meta name="twitter:image" content="${SITE}/og-image.png">`,
  ].join('\n');
  return html.replace(/<\/title>/i, (m) => m + '\n' + tags);
}

// ---- a 1200x630 share picture, drawn pixel by pixel (5x7 letters, no fonts or libraries) ----
const FONT = {
  A: '01110,10001,10001,11111,10001,10001,10001', B: '11110,10001,10001,11110,10001,10001,11110', C: '01110,10001,10000,10000,10000,10001,01110', D: '11110,10001,10001,10001,10001,10001,11110',
  E: '11111,10000,10000,11110,10000,10000,11111', F: '11111,10000,10000,11110,10000,10000,10000', G: '01110,10001,10000,10111,10001,10001,01111', H: '10001,10001,10001,11111,10001,10001,10001',
  I: '01110,00100,00100,00100,00100,00100,01110', J: '00111,00010,00010,00010,00010,10010,01100', K: '10001,10010,10100,11000,10100,10010,10001', L: '10000,10000,10000,10000,10000,10000,11111',
  M: '10001,11011,10101,10101,10001,10001,10001', N: '10001,11001,10101,10011,10001,10001,10001', O: '01110,10001,10001,10001,10001,10001,01110', P: '11110,10001,10001,11110,10000,10000,10000',
  Q: '01110,10001,10001,10001,10101,10010,01101', R: '11110,10001,10001,11110,10100,10010,10001', S: '01111,10000,10000,01110,00001,00001,11110', T: '11111,00100,00100,00100,00100,00100,00100',
  U: '10001,10001,10001,10001,10001,10001,01110', V: '10001,10001,10001,10001,10001,01010,00100', W: '10001,10001,10001,10101,10101,10101,01010', X: '10001,10001,01010,00100,01010,10001,10001',
  Y: '10001,10001,01010,00100,00100,00100,00100', Z: '11111,00001,00010,00100,01000,10000,11111',
  0: '01110,10001,10011,10101,11001,10001,01110', 1: '00100,01100,00100,00100,00100,00100,01110', 2: '01110,10001,00001,00010,00100,01000,11111', 3: '11110,00001,00001,01110,00001,00001,11110',
  4: '00010,00110,01010,10010,11111,00010,00010', 5: '11111,10000,11110,00001,00001,10001,01110', 6: '00110,01000,10000,11110,10001,10001,01110', 7: '11111,00001,00010,00100,01000,01000,01000',
  8: '01110,10001,10001,01110,10001,10001,01110', 9: '01110,10001,10001,01111,00001,00010,01100',
  '?': '01110,10001,00001,00010,00100,00000,00100', '.': '00000,00000,00000,00000,00000,01100,01100', ',': '00000,00000,00000,00000,01100,00100,01000', "'": '00100,00100,01000,00000,00000,00000,00000',
  '-': '00000,00000,00000,11111,00000,00000,00000', '/': '00001,00001,00010,00100,01000,10000,10000', ' ': '00000,00000,00000,00000,00000,00000,00000',
};
function crc32(buf) { let c, crc = ~0; for (let i = 0; i < buf.length; i++) { c = (crc ^ buf[i]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; }
function png(w, h, px) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; px.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function ogImage() {
  const W = 1200, H = 630, px = Buffer.alloc(W * H * 3);
  const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  const rect = (x, y, w, h, c) => { const [r, g, b] = hex(c); for (let j = Math.max(0, y); j < Math.min(H, y + h); j++) for (let i = Math.max(0, x); i < Math.min(W, x + w); i++) { const o = (j * W + i) * 3; px[o] = r; px[o + 1] = g; px[o + 2] = b; } };
  const disc = (cx, cy, rad, c) => { const [r, g, b] = hex(c); for (let j = cy - rad; j <= cy + rad; j++) for (let i = cx - rad; i <= cx + rad; i++) if ((i - cx) ** 2 + (j - cy) ** 2 <= rad * rad && i >= 0 && i < W && j >= 0 && j < H) { const o = (j * W + i) * 3; px[o] = r; px[o + 1] = g; px[o + 2] = b; } };
  const text = (str, x, y, s, c) => { let cx = x; for (const ch of str.toUpperCase()) { const g = (FONT[ch] || FONT[' ']).split(','); for (let r = 0; r < 7; r++) for (let k = 0; k < 5; k++) if (g[r][k] === '1') rect(cx + k * s, y + r * s, s, s, c); cx += 6 * s; } };
  const width = (str, s) => str.length * 6 * s - s;
  rect(0, 0, W, H, '#FDFBF6'); rect(0, 0, W, 22, '#3F6B3C'); rect(0, H - 22, W, 22, '#B5790A');
  [['#3F6B3C', 0], ['#B5790A', 1], ['#A6402A', 2], ['#4A3423', 3]].forEach(([c, i]) => rect(80, 80 + i * 34, 120 - i * 14, 26, c));
  text('POSHAN SCORE', 80, 250, 11, '#221A12');
  text('BY KIDPOSHAN', 84, 360, 6, '#6B5D4B');
  text("IS IT HEALTHY FOR YOUR CHILD?", 80, 440, 6, '#3F6B3C');
  text('SCORED OUT OF 100 FOR EVERY AGE', 80, 510, 5, '#6B5D4B');
  disc(1010, 190, 120, '#3F6B3C'); disc(1010, 190, 98, '#FDFBF6'); disc(1010, 190, 91, '#3F6B3C');
  text('100', 1010 - Math.round(width('100', 9) / 2), 190 - 31, 9, '#FDFBF6');
  return png(W, H, px);
}

const AGE_LABEL = { '6-12m': '6–12 months', '1-3y': '1–3 years', '4-6y': '4–6 years', '7-9y': '7–9 years', '10-12y': '10–12 years', '13-15y': '13–15 years', '16-18y': '16–18 years', adult: 'Adults' };
const slugOf = (p) => `${p.id}-${String(p.name || 'product').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '')}`;
const TIER_COLOR = { Good: '#3F6B3C', OK: '#B5790A', 'Do not use': '#A6402A' };

function productPage(p, slug) {
  const url = `${SITE}/products/${slug}`;
  const score = Math.round(p.score), nm = p.name.split('|')[0].replace(/\s+/g, ' ').trim();
  const title = `Is ${nm} healthy for kids? Poshan Score ${score}/100`;
  const sodium = p.nutrition_per_100g?.sodium_mg, sugar = p.nutrition_per_100g?.added_sugars_g;
  const desc = `${nm} scores ${score} out of 100 (${p.capped ? 'held at OK' : p.band}) on the Poshan Score for ${p.age_label}. See the ten-check breakdown, the sugar, salt, fibre and protein per serving, and the score for every age group from 6 months to adults.`;
  const metrics = (p.metrics || []).map((m) => `<tr><td>${m.n}. ${esc(m.name)}</td><td class="r">${esc(m.reading)}</td><td class="m"><b>${m.score ? 'Yes' : 'No'}</b></td></tr>`).join('');
  const byAge = Object.entries(p.scores_by_age || {}).map(([a, v]) => `<tr><td>${esc(AGE_LABEL[a] || a)}</td><td class="m">${v == null ? 'Not for under 1' : '<b>' + v + '</b>/100'}</td></tr>`).join('');
  const n = p.nutrition_per_100g || {}, fmt = (v, u) => (v === '' || v == null ? 'not printed' : `${v} ${u}`);
  const ld = { '@context': 'https://schema.org', '@type': 'Product', name: nm, brand: p.brand ? { '@type': 'Brand', name: p.brand } : undefined, image: p.image_url || undefined, category: p.category, description: desc, url };
  let html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<script type="application/ld+json">${JSON.stringify(ld)}</script>
<style>
:root{--bg:#FDFBF6;--ink:#221A12;--dim:#6B5D4B;--line:#E7DFCE;--green:#3F6B3C;--card:#fff}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#17130E;--ink:#F3ECDD;--dim:#B7A98F;--line:#3A3226;--card:#221C14}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}
nav{display:flex;align-items:center;gap:14px;padding:12px 18px;border-bottom:1px solid var(--line);flex-wrap:wrap}
nav a{color:var(--ink);text-decoration:none;font-size:14px}nav .brand{font-weight:700;margin-right:auto;white-space:nowrap}
main{max-width:760px;margin:0 auto;padding:22px 18px 60px}
h1{font-size:clamp(26px,6vw,36px);line-height:1.15;margin:6px 0 8px}h2{font-size:20px;margin:30px 0 8px}
.crumb{font-size:13px;color:var(--dim)}.crumb a{color:var(--dim)}
.hero{display:grid;grid-template-columns:140px 1fr;gap:18px;align-items:center;margin:14px 0}
.hero img{width:140px;height:140px;object-fit:contain;background:#fff;border-radius:14px;border:1px solid var(--line)}
.score{display:flex;align-items:center;gap:14px}.score b{width:84px;height:84px;border-radius:50%;display:grid;place-items:center;font-size:32px;color:#fff;background:${TIER_COLOR[p.capped ? 'OK' : p.band] || TIER_COLOR.Good}}
.score span{color:var(--dim);font-size:14px}
table{width:100%;border-collapse:collapse;font-size:14.5px}td{padding:8px 6px;border-bottom:1px solid var(--line);vertical-align:top}td.m{text-align:right;white-space:nowrap}td.r{color:var(--dim)}
.cta{display:inline-block;background:var(--ink);color:var(--bg);padding:11px 20px;border-radius:999px;text-decoration:none;font-weight:600;margin:6px 8px 6px 0}
.cta.alt{background:none;color:var(--ink);border:1.5px solid var(--ink)}
.fine{font-size:13px;color:var(--dim)}
.more{margin:14px 0}.more>summary{list-style:none;cursor:pointer;text-align:center;border:1.5px solid var(--green);color:var(--green);background:var(--card);font-weight:700;border-radius:12px;padding:13px 16px;font-size:16px}.more>summary::-webkit-details-marker{display:none}.more[open]>summary{background:#E3EEDF;color:#2d4f2b}
@media(max-width:520px){.hero{grid-template-columns:96px 1fr}.hero img{width:96px;height:96px}td.r{display:none}}
</style></head><body>
<nav><a class="brand" href="/">Poshan Score <small>by KidPoshan</small></a><a href="/products">Products</a><a href="/meal-ideas">Meal Ideas</a><a href="/age-metrics">Age &amp; Metrics</a></nav>
<main>
<p class="crumb"><a href="/">Home</a> › <a href="/products">Products</a> › ${esc(p.category)}</p>
<h1>Is ${esc(nm)} healthy for kids?</h1>
<div class="hero">${p.image_url ? `<img src="${esc(p.image_url)}" alt="${esc(nm)}" loading="eager" referrerpolicy="no-referrer">` : '<div></div>'}
<div class="score" id="kpscore"><b>${score}</b><div><div><strong>${esc(p.capped ? 'OK (capped)' : p.band)}</strong></div><span>Poshan Score for ${esc(p.age_label)}, out of 100${p.capped ? '. Held at OK because one risk check failed.' : ''}</span></div></div></div>
<div id="kpm"></div><div id="kpclaim"></div>
<p>${esc(p.brand ? p.brand + ' · ' : '')}${esc(p.kind_label || '')}${p.pack_size ? ' · ' + esc(p.pack_size) : ''}. Scored ${esc(p.basis || 'per serving')}. The same product scores differently for different ages, because a younger child's daily limit for sugar, salt and saturated fat is smaller.</p>
<details class="more"><summary>See how this score is worked out</summary>
<h2>The score at every age</h2><table>${byAge}</table>
<h2>How the score is worked out: ten checks, each a yes or no</h2><table>${metrics}</table>
<p class="fine">The ten marks add up to a number from 10 to 100, which is stretched to a score from 0 to 100. <a href="/age-metrics">Every threshold and source is on the Age &amp; Metrics page.</a></p>
<h2>On the label (per 100 g)</h2><table>
<tr><td>Protein</td><td class="m">${fmt(n.protein_g, 'g')}</td></tr><tr><td>Fibre</td><td class="m">${fmt(n.fibre_g, 'g')}</td></tr><tr><td>Total sugars</td><td class="m">${fmt(n.sugars_g, 'g')}</td></tr>
<tr><td>Added sugar</td><td class="m">${fmt(n.added_sugars_g, 'g')}</td></tr><tr><td>Saturated fat</td><td class="m">${fmt(n.saturated_fat_g, 'g')}</td></tr><tr><td>Sodium</td><td class="m">${fmt(n.sodium_mg, 'mg')}</td></tr></table>
${p.ingredients && p.ingredients.length ? `<h2>Ingredients</h2><p>${esc(p.ingredients.join(', '))}</p>` : ''}
</details>
<p class="fine"><a href="#" id="kpreport">Report a mistake with this pack</a></p>
<p style="margin-top:22px"><a class="cta" href="/products?open=${p.id}">Change the age and see all workings</a>${p.url && p.data_source !== 'scan' ? (p.data_source === 'openfoodfacts' ? `<a class="cta alt" href="${esc(p.url)}" target="_blank" rel="noopener">Label on Open Food Facts</a>` : `<a class="cta alt" href="${esc(p.url)}" target="_blank" rel="sponsored nofollow noopener">See price on ${esc((p.retailer || 'the seller').replace(/^./, (c) => c.toUpperCase()))}</a>`) : ''}</p>
${p.data_source === 'openfoodfacts' ? `<p class="fine">Label data: <a href="https://world.openfoodfacts.org" rel="noopener">Open Food Facts</a> contributors, under the Open Database Licence${p.added_sugar_estimated ? '. Added sugar is not printed in the database, so total sugars are used, which can make the score a little stricter than the pack deserves' : ''}.</p>` : ''}
<p class="fine">Label values come from the pack's own product page (or Open Food Facts) and are checked before a product is listed. Poshan Score is an independent rating, not a certification, and the age guide is general, not medical advice.</p>
</main><script src="/kp-meter.js"></script><script>(function(){var m=window.kpMeter;if(!m)return;var d=${JSON.stringify({ score, band: p.band, capped: !!p.capped, why: (p.metrics || []).filter((x) => ['sugar', 'sodium', 'satfat', 'trans'].includes(x.id) && x.score <= 3).map((x) => ({ sugar: 'added sugar', sodium: 'sodium', satfat: 'saturated fat', trans: 'trans fat' })[x.id]) })};
document.getElementById('kpm').innerHTML=m({score:d.score,band:d.band,capped:d.capped,why:d.why,legend:true});m.animate(document);var s=document.getElementById('kpscore');if(s)s.style.display='none';var rp=document.getElementById('kpreport');if(rp)rp.onclick=function(e){e.preventDefault();if(window.kpReport)kpReport({product_id:${p.id},barcode:${JSON.stringify(p.barcode || '')},name:${JSON.stringify(nm)}})};
fetch('${PLATFORM}/api/kp/products/${p.id}').then(function(r){return r.json()}).then(function(j){if(j&&j.claim&&window.kpClaimCard)document.getElementById('kpclaim').innerHTML=kpClaimCard(j.claim)}).catch(function(){});})();</script><script src="/kp-visits.js" defer></script><script src="/kp-search.js" defer></script></body></html>`;
  html = withMeta(html, { url, title, desc, type: 'article' });
  return { html, url, title };
}

// ---- recipes: a page for every recipe, and an index page that links to all of them ----
const MEAL_LABEL = { breakfast: 'Breakfast', lunchbox: 'School lunchbox', lunch: 'Lunch', snack_4pm: '4 PM snack', dinner: 'Dinner' };
const DIET_WORD = { veg: 'Vegetarian', jain: 'Jain', egg: 'Egg', nonveg: 'Non-vegetarian' };
const recName = (n) => String(n || 'Recipe').split('|')[0].replace(/\s+/g, ' ').replace(/\s+recipes?\s*$/i, '').trim();
const isoTime = (m) => (m >= 60 ? `PT${Math.floor(m / 60)}H${m % 60 ? (m % 60) + 'M' : ''}` : `PT${m}M`);
const timeWord = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}` : `${m} min`);
const RECIPE_CSS = `:root{--bg:#FDFBF6;--ink:#221A12;--dim:#6B5D4B;--line:#E7DFCE;--green:#3F6B3C;--card:#fff;--link:#2F5A2C}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#17130E;--ink:#F3ECDD;--dim:#B7A98F;--line:#3A3226;--card:#221C14;--link:#9CC98F}}
a{color:var(--link)}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}
nav{display:flex;align-items:center;gap:14px;padding:12px 18px;border-bottom:1px solid var(--line);flex-wrap:wrap}
nav a{color:var(--ink);text-decoration:none;font-size:14px}nav .brand{font-weight:700;margin-right:auto;white-space:nowrap}
main{max-width:760px;margin:0 auto;padding:22px 18px 60px}
h1{font-size:clamp(26px,6vw,36px);line-height:1.15;margin:6px 0 8px}h2{font-size:20px;margin:28px 0 8px}
.crumb{font-size:13px;color:var(--dim)}.crumb a{color:var(--dim)}
.hero{display:grid;grid-template-columns:minmax(0,1fr);gap:14px;margin:14px 0}
.hero img{width:100%;max-height:340px;object-fit:cover;border-radius:16px;border:1px solid var(--line)}
.facts{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 0}.facts span{border:1px solid var(--line);border-radius:999px;padding:4px 12px;font-size:13.5px;color:var(--dim)}
table{width:100%;border-collapse:collapse;font-size:14.5px}td{padding:8px 6px;border-bottom:1px solid var(--line);vertical-align:top}td.m{text-align:right;white-space:nowrap}
ul.ing{padding-left:20px}ul.ing li{margin:4px 0}ol.steps{padding-left:22px}ol.steps li{margin:8px 0}
.cta{display:inline-block;background:var(--ink);color:var(--bg);padding:11px 20px;border-radius:999px;text-decoration:none;font-weight:600;margin:6px 8px 6px 0}
.cta.alt{background:none;color:var(--ink);border:1.5px solid var(--ink)}
.fine{font-size:13px;color:var(--dim)}.note{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 14px;font-size:14.5px}
.grp h2{margin-top:26px}.grp ul{list-style:none;padding:0;margin:0}.grp li{padding:7px 0;border-bottom:1px solid var(--line);display:flex;gap:10px;align-items:baseline}
.grp li a{color:var(--ink);font-weight:600;text-decoration:none}.grp li small{color:var(--dim);margin-left:auto;text-align:right}.grp li b{display:inline-block;min-width:34px;text-align:center;color:#fff;border-radius:999px;padding:1px 8px;font-size:13px}
@media(max-width:520px){.grp li{flex-wrap:wrap}.grp li small{margin-left:0;width:100%;text-align:left}}`;
const NAV = '<nav><a class="brand" href="/">Poshan Score <small>by KidPoshan</small></a><a href="/recipes">Recipes</a><a href="/products">Products</a><a href="/meal-ideas">Meal Ideas</a><a href="/age-metrics">Age &amp; Metrics</a></nav>';
const bandColor = (band, capped) => TIER_COLOR[capped ? 'OK' : band] || TIER_COLOR.Good;

function recipePage(d, slug) {
  const url = `${SITE}/recipes/${slug}`, nm = recName(d.name), sc = d.score || {}, score = Math.round(sc.value ?? d.poshan_score);
  const credit = d.source?.name || 'the recipe creator';
  const diet = DIET_WORD[d.diet] || '', meals = (d.meals || []).map((o) => MEAL_LABEL[o]).filter(Boolean);
  // search results show about 60 characters: a long name is cut at a word, and a dish that several creators share is told apart by its creator
  let shortNm = nm;
  if (nm.length > 50) { shortNm = nm.slice(0, 50).replace(/\s+\S*$/, ''); if (shortNm.lastIndexOf('(') > shortNm.lastIndexOf(')')) shortNm = shortNm.slice(0, shortNm.lastIndexOf('(')).trim(); }
  const title = `${shortNm}${/recipe/i.test(shortNm) ? '' : ' recipe'} for kids: Poshan Score ${score}/100${d.sharedName ? ` (${credit})` : ''}`;
  const desc = `${nm}${diet ? ', a ' + diet.toLowerCase() + ' recipe' : ''} by ${credit}. It scores ${score} out of 100 (${sc.capped ? 'held at OK' : sc.band}) on the Poshan Score for ${sc.age_band_label || 'ages 4–6'}. See the ingredients, the time it takes and the score for every age group, from toddlers to adults.`;
  const byAge = Object.entries(d.scores_by_age || {}).map(([a, v]) => `<tr><td>${esc(AGE_LABEL[a] || a)}</td><td class="m"><b>${v}</b>/100</td></tr>`).join('');
  const ings = (d.ingredients || []).map((i) => i.raw_text).filter((t) => t && !/^(null|undefined|\s)+$/i.test(String(t)));
  const steps = Array.isArray(d.method) ? d.method : [];
  const stepsHtml = (() => {
    if (!steps.length) return '';
    let out = '', open = false, cur = null;
    for (const st of steps) {
      if (st.section !== cur) { if (open) out += '</ol>'; cur = st.section; if (cur) out += `<h3>${esc(cur)}</h3>`; out += '<ol class="steps">'; open = true; }
      out += `<li>${esc(st.text)}</li>`;
    }
    return (open ? out + '</ol>' : out);
  })();
  const ld = { '@context': 'https://schema.org', '@type': 'Recipe', name: nm, image: d.image_url ? [d.image_url] : undefined, author: { '@type': 'Person', name: credit }, description: desc, url,
    totalTime: d.total_minutes ? isoTime(d.total_minutes) : undefined, recipeYield: d.servings ? String(d.servings) : undefined, recipeCategory: meals[0] || undefined, recipeIngredient: ings.length ? ings : undefined,
    recipeInstructions: steps.length ? steps.map((st) => ({ '@type': 'HowToStep', text: st.text })) : undefined, isBasedOn: d.source?.url || undefined, keywords: ['kids recipe', 'Poshan Score', diet].filter(Boolean).join(', ') };
  const facts = [d.total_minutes ? '⏱ ' + timeWord(d.total_minutes) : '', d.servings ? 'Serves ' + d.servings : '', diet, ...meals, d.age_min_months ? 'From ' + (d.age_min_months < 12 ? d.age_min_months + ' months' : Math.floor(d.age_min_months / 12) + ' years') : ''].filter(Boolean).map((f) => `<span>${esc(f)}</span>`).join('');
  let html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<script type="application/ld+json">${JSON.stringify(ld)}</script>
<style>${RECIPE_CSS}</style></head><body>
${NAV}
<main>
<p class="crumb"><a href="/">Home</a> › <a href="/recipes">Recipes</a> › ${esc(nm)}</p>
<h1>${esc(nm)}</h1>
<p class="fine">Recipe by ${d.source?.url ? `<a href="${esc(d.source.url)}" target="_blank" rel="noopener">${esc(credit)}</a>` : esc(credit)}</p>
${d.image_url ? `<div class="hero"><img src="${esc(d.image_url)}" alt="${esc(nm)}" loading="eager" referrerpolicy="no-referrer"><span class="fine">Photo: ${esc(credit)}</span></div>` : ''}
<div class="facts">${facts}</div>
<div id="kpm" style="margin:18px 0 6px"></div>
<p>${esc(nm)} scores <b>${score}</b> out of 100 (${esc(sc.capped ? 'OK, held by a risk check' : sc.band)}) for ${esc(sc.age_band_label || 'ages 4–6')}, worked out for one serving. The same dish scores differently for different ages, because a younger child's daily limit for sugar, salt and saturated fat is smaller.</p>
${d.kid_note ? `<p class="note">${esc(d.kid_note)}</p>` : ''}
<h2>The score at every age</h2><table>${byAge || '<tr><td>Open the recipe to see the score for your child\'s age.</td></tr>'}</table>
${ings.length ? `<h2>Ingredients</h2><ul class="ing">${ings.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
${stepsHtml ? `<h2>Method</h2>${stepsHtml}<p class="fine">Method by ${esc(credit)}${d.source?.url ? `. <a href="${esc(d.source.url)}" target="_blank" rel="noopener">See the original recipe</a>` : ''}.</p>` : (d.source?.url ? `<p><a class="cta alt" href="${esc(d.source.url)}" target="_blank" rel="noopener">See the method on ${esc(credit)}</a></p>` : '')}
<p style="margin-top:22px"><a class="cta" href="/meal-ideas#/r/${d.id}">Save it, check it for your child's age and plan your week</a><a class="cta alt" href="/recipes">More recipes</a></p>
<p class="fine">Poshan Score is an independent rating, not a certification, and the age guide is general, not medical advice. Recipe text and photos belong to their creators and link back to the original.</p>
</main><script src="/kp-meter.js"></script><script>(function(){var m=window.kpMeter;if(!m)return;document.getElementById('kpm').innerHTML=m({score:${score},band:${JSON.stringify(sc.band)},capped:${!!sc.capped},why:[],legend:true});m.animate(document)})();</script><script src="/kp-visits.js" defer></script></body></html>`;
  html = withMeta(html, { url, title, desc, type: 'article' });
  return { html, url, title };
}

function recipesIndexPage(items) {
  const url = `${SITE}/recipes`, title = 'Recipes for kids, each scored out of 100 for your child\'s age';
  const desc = `${items.length} kids' recipes from cooks and cookbooks, each with a Poshan Score for every age from toddlers to adults. Breakfast, lunchbox, lunch, snacks and dinner, vegetarian, Jain and non-vegetarian.`;
  const groups = {};
  for (const r of items) { const g = (r.occasions || []).find((o) => MEAL_LABEL[o]) || 'other'; (groups[g] = groups[g] || []).push(r); }
  const order = [...Object.keys(MEAL_LABEL), 'other'].filter((g) => groups[g]);
  const sections = order.map((g) => `<section class="grp"><h2>${g === 'other' ? 'More recipes' : MEAL_LABEL[g]} <small class="fine">(${groups[g].length})</small></h2><ul>${groups[g].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).map((r) => {
    const tier = r.score >= 80 ? 'Good' : r.score >= 50 ? 'OK' : 'Do not use';
    return `<li><b style="background:${TIER_COLOR[tier]}">${Math.round(r.score)}</b><a href="/recipes/${slugOf({ id: r.id, name: recName(r.name) })}">${esc(recName(r.name))}</a><small>${esc(r.minutes ? timeWord(r.minutes) : '')} · ${esc(r.by || '')}</small></li>`; }).join('')}</ul></section>`).join('');
  let html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>${RECIPE_CSS}</style></head><body>
${NAV}
<main>
<p class="crumb"><a href="/">Home</a> › Recipes</p>
<h1>Recipes for kids, scored for your child's age</h1>
<p>${items.length} recipes from various cooks and cookbooks, each credited to the person who wrote it. Every recipe has a Poshan Score out of 100, worked out for one serving and for every age group from toddlers to adults. Open one to see the ingredients and the score for your child's age, save it, and plan your week.</p>
<p><a class="cta" href="/meal-ideas">Find recipes for my child's age, meal and season</a></p>
${sections}
<p class="fine">Poshan Score is an independent rating, not a certification, and the age guide is general, not medical advice.</p>
</main><script src="/kp-visits.js" defer></script></body></html>`;
  html = withMeta(html, { url, title, desc });
  return { html, url, title };
}

async function getJson(u) { const r = await fetch(u); if (!r.ok) throw new Error(u + ' -> ' + r.status); return r.json(); }

async function run(out) {
  // 1. description, canonical and share card on every page
  for (const f of fs.readdirSync(out).filter((n) => n.endsWith('.html') && PAGE_META[n])) {
    const m = PAGE_META[f];
    fs.writeFileSync(path.join(out, f), withMeta(fs.readFileSync(path.join(out, f), 'utf8'), { url: SITE + (m.path === '/' ? '/' : m.path), title: m.title, desc: m.desc }));
  }
  // 2. the share picture and robots.txt
  fs.writeFileSync(path.join(out, 'og-image.png'), ogImage());
  fs.writeFileSync(path.join(out, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /bot\n\nSitemap: ${SITE}/sitemap.xml\n`);
  // 3. a page for every scored product
  const urls = Object.values(PAGE_META).map((m) => ({ loc: SITE + (m.path === '/' ? '/' : m.path), pr: m.path === '/' ? '1.0' : '0.8' }));
  const map = {};
  try {
    const list = await getJson(`${PLATFORM}/api/kp/products?age=4-6y&limit=1000`);
    const dir = path.join(out, 'products');
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.html')) fs.unlinkSync(path.join(dir, f));       // pages of packs that are no longer listed must not linger
    const one = async (it) => {
      try {
        const d = await getJson(`${PLATFORM}/api/kp/products/${it.id}?age=4-6y`);
        const slug = slugOf({ id: it.id, name: it.name });
        const pg = productPage(d, slug);
        fs.writeFileSync(path.join(dir, slug + '.html'), pg.html);
        map[it.id] = slug; urls.push({ loc: pg.url, pr: '0.7' });
      } catch (e) { console.warn('product page skipped', it.id, e.message); }
    };
    for (let i = 0; i < list.items.length; i += 8) await Promise.all(list.items.slice(i, i + 8).map(one));       // eight at a time
  } catch (e) { console.warn('no product pages this build:', e.message); }
  // the Products page links each card to its own page (a card for a product added since this build still opens the pop-up)
  for (const name of ['products.html', 'index.html']) {
    const pf = path.join(out, name);
    if (fs.existsSync(pf)) { let h = fs.readFileSync(pf, 'utf8'); h = h.replace('window.KP_PRODUCT_PAGES=window.KP_PRODUCT_PAGES||{};', 'window.KP_PRODUCT_PAGES=' + JSON.stringify(map) + ';'); fs.writeFileSync(pf, h); }
  }
  // 4. a page for every recipe, and the Recipes index that links to them all
  let nRecipes = 0;
  try {
    const idx = await getJson(`${PLATFORM}/api/kp/recipes-index`);
    const rdir = path.join(out, 'recipes');
    fs.mkdirSync(rdir, { recursive: true });
    for (const f of fs.readdirSync(rdir)) if (f.endsWith('.html')) fs.unlinkSync(path.join(rdir, f));
    const done = [];
    const nameCount = {};
    for (const it of idx.items) { const k = recName(it.name).toLowerCase(); nameCount[k] = (nameCount[k] || 0) + 1; }
    const oneRecipe = async (it) => {
      try {
        const d = await getJson(`${PLATFORM}/api/kp/recipes/${it.id}?lite=1`);
        if (!d || !d.score) return;
        d.meals = it.occasions || [];
        d.sharedName = nameCount[recName(d.name).toLowerCase()] > 1;
        const slug = slugOf({ id: it.id, name: recName(d.name) });
        const pg = recipePage(d, slug);
        fs.writeFileSync(path.join(rdir, slug + '.html'), pg.html);
        urls.push({ loc: pg.url, pr: '0.6' }); done.push(it); nRecipes++;
      } catch (e) { console.warn('recipe page skipped', it.id, e.message); }
    };
    for (let i = 0; i < idx.items.length; i += 8) await Promise.all(idx.items.slice(i, i + 8).map(oneRecipe));
    const hub = recipesIndexPage(done);
    fs.writeFileSync(path.join(out, 'recipes.html'), hub.html);
    urls.push({ loc: hub.url, pr: '0.8' });
  } catch (e) { console.warn('no recipe pages this build:', e.message); }
  const today = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(u.loc)}</loc><lastmod>${today}</lastmod><priority>${u.pr}</priority></url>`).join('\n')}\n</urlset>\n`);
  console.log(`seo: ${Object.keys(map).length} product pages, ${nRecipes} recipe pages, sitemap with ${urls.length} addresses`);
}

module.exports = { run, withMeta, slugOf, productPage, recipePage, recipesIndexPage };
