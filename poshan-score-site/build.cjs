// Builds poshan-score-site/public from live-backup/ (the exact pages www.kidposhan.in served on 2026-10-07).
// Safe to re-run: it always starts from the untouched backup. Changes made:
//   1. strip the bot-challenge snippet Cloudflare injects at serve time
//   2. add "Meal Ideas" to every page's nav and mobile menu (after "Cereal Aisle")
//   3. home page: a third action card linking to Meal Ideas
//   4. add meal-ideas.html (built from the platform's meal page, relative links, API pointed at the platform Worker)
const fs = require('fs'), path = require('path');
const root = __dirname, out = path.join(root, 'public');
fs.mkdirSync(out, { recursive: true });
const PLATFORM = 'https://kidposhan-platform.mailus-pixiedust.workers.dev';

const strip = (html) => html.replace(/<script>\(function\(\)\{function c\(\)\{[\s\S]*?cdn-cgi\/challenge-platform[\s\S]*?<\/script>/, '');
const MEAL_LINK = '<a href="meal-ideas.html">Meal Ideas</a>';

for (const name of fs.readdirSync(path.join(root, 'live-backup'))) {
  if (name === 'browse.html' || name === 'cereals.html') continue;   // retired: both now redirect to /products
  let h = strip(fs.readFileSync(path.join(root, 'live-backup', name), 'utf8'));
  // The original pages each listed a slightly different set of pages (only the home page had "Methodology"). Every page now lists the same six (Browse and Cereal Aisle were retired: the Products page replaces them).
  const PAGES = [['index.html', 'Home'], ['age-metrics.html#ten-metrics', 'Methodology'], ['age-metrics.html', 'Age &amp; Metrics'], ['meal-ideas.html', 'Meal Ideas'], ['recipes.html', 'Recipes'], ['best.html', 'Rankings'], ['products.html', 'Products'], ['scan.html', 'Scan a pack'], ['why-we-do-this.html', 'Why We Do This']];
  const menu = PAGES.map(([href, label]) => `<a href="${href}"${href === name ? ' aria-current="page"' : ''}>${label}</a>`).join('\n    ');
  let swapped = 0;
  h = h.replace(/(<div class="nav-links">)[\s\S]*?(<\/div>)/, (m, o, c) => { swapped++; return o + '\n    ' + menu + '\n  ' + c; });
  h = h.replace(/(<div class="mobile-menu"[^>]*>)[\s\S]*?(<\/div>)/, (m, o, c) => { swapped++; return o + '\n    ' + menu + '\n  ' + c; });
  if (swapped !== 2) throw new Error(`${name}: expected to rebuild the desktop and the mobile menu, rebuilt ${swapped}`);


  if (name === 'index.html') {
    const a = h.indexOf('class="action-card a2"');
    const end = h.indexOf('</a>', a) + 4;
    if (a < 0 || end < 4) throw new Error('home action card anchor');
    const card = `
    <a class="action-card a3" href="meal-ideas.html">
      <div class="action-dot"></div>
      <div>
        <h3>Meal ideas for today</h3>
        <p>Recipes for your child's age, meal and season, each with its own Poshan Score, plus ready-made packs and the ingredients to buy.</p>
      </div>
      <div class="action-arrow">→</div>
    </a>`;
    h = h.slice(0, end) + card + h.slice(end);
    const k = h.indexOf('@keyframes actionRise');
    if (k < 0) throw new Error('css anchor');
    h = h.slice(0, k) + '.actions-grid .action-card.a3{ animation-delay:.3s; grid-column:1 / -1; } .action-card.a3 .action-dot{ background:var(--red); }\n  ' + h.slice(k);
  }
  // Seven links (with Meal Ideas) need more room than the original five: until the screen is wide enough, use the menu button.
  h = h.replace('</style>', '@media(min-width:780px) and (max-width:1179px){.nav-links{display:none!important}.hamburger{display:flex!important}.mobile-menu.open{display:flex}}\n  @media(min-width:1180px){.nav-links{gap:22px}}\n  .nav-links a[aria-current="page"],.mobile-menu a[aria-current="page"]{color:var(--gold);font-weight:600}\n  @media(max-width:560px){.age-tab-bar{width:100%;max-width:100%;box-sizing:border-box;margin-left:0;margin-right:0}.age-tab{flex:1 1 0;min-width:0;padding:10px 4px;font-size:12px;text-align:center}}\n</style>');
  fs.writeFileSync(path.join(out, name), h);
}

// meal-ideas.html from the platform's page
const src = path.join(root, '..', 'public', 'meal-ideas-kp.html');
let m = fs.readFileSync(src, 'utf8');
const swap = (a, b) => { if (!m.includes(a)) throw new Error('meal page anchor missing: ' + a.slice(0, 60)); m = m.split(a).join(b); };
swap('href="https://www.kidposhan.in/#metrics"', 'href="age-metrics.html#ten-metrics"');
swap('href="https://www.kidposhan.in/age-metrics.html"', 'href="age-metrics.html"');
swap('href="https://www.kidposhan.in/why-we-do-this.html"', 'href="why-we-do-this.html"');
swap('href="https://www.kidposhan.in/"', 'href="index.html"');
swap('href="https://www.kidposhan.in/products.html"', 'href="products.html"');
swap('<a href="#/" class="on">Meal Ideas</a>', '<a href="meal-ideas.html" class="on">Meal Ideas</a>');
swap('<a href="#/">Meal Ideas</a>', '<a href="meal-ideas.html">Meal Ideas</a>');
swap("const API=QS.get('api')||'';", `const API=QS.get('api')||'${PLATFORM}'; // recipes, packs and scores come from the KidPoshan platform Worker`);
swap('<title>KidPoshan | Meal ideas</title>', '<title>Meal Ideas — Poshan Score by Kidposhan</title>');
m = m.split('href="https://www.kidposhan.in/scan.html"').join('href="scan.html"');
fs.writeFileSync(path.join(out, 'meal-ideas.html'), m);
// products.html from the platform's page (same look and menu as the Meal Ideas page; the products come from the platform Worker)
let pr = fs.readFileSync(path.join(root, '..', 'public', 'products.html'), 'utf8');
const swapP = (a, b) => { if (!pr.includes(a)) throw new Error('products page anchor missing: ' + a.slice(0, 60)); pr = pr.split(a).join(b); };
swapP('href="https://www.kidposhan.in/#metrics"', 'href="age-metrics.html#ten-metrics"');
swapP('href="https://www.kidposhan.in/age-metrics.html"', 'href="age-metrics.html"');
swapP('href="https://www.kidposhan.in/why-we-do-this.html"', 'href="why-we-do-this.html"');
swapP('href="https://www.kidposhan.in/meal-ideas.html"', 'href="meal-ideas.html"');
swapP('href="https://www.kidposhan.in/products.html"', 'href="products.html"');
swapP('href="https://www.kidposhan.in/"', 'href="index.html"');
swapP("const API=QS.get('api')||'';", `const API=QS.get('api')||'${PLATFORM}'; // products and scores come from the KidPoshan platform Worker`);
pr = pr.split('href="https://www.kidposhan.in/scan.html"').join('href="scan.html"');
fs.writeFileSync(path.join(out, 'products.html'), pr);
// scan.html: the barcode scanner (built from the platform's page the same way as Products; scans go to the platform Worker)
let sc = fs.readFileSync(path.join(root, '..', 'public', 'scan.html'), 'utf8');
const swapS = (a, b) => { if (!sc.includes(a)) throw new Error('scan page anchor missing: ' + a.slice(0, 60)); sc = sc.split(a).join(b); };
swapS('href="https://www.kidposhan.in/#metrics"', 'href="age-metrics.html#ten-metrics"');
swapS('href="https://www.kidposhan.in/age-metrics.html"', 'href="age-metrics.html"');
swapS('href="https://www.kidposhan.in/why-we-do-this.html"', 'href="why-we-do-this.html"');
swapS('href="https://www.kidposhan.in/meal-ideas.html"', 'href="meal-ideas.html"');
swapS('href="https://www.kidposhan.in/products.html"', 'href="products.html"');
swapS('href="https://www.kidposhan.in/scan.html"', 'href="scan.html"');
swapS('href="https://www.kidposhan.in/privacy.html"', 'href="privacy.html"');
swapS('href="https://www.kidposhan.in/"', 'href="index.html"');
swapS("const API=QS.get('api')||'';", "const API=QS.get('api')||'" + PLATFORM + "';");
fs.writeFileSync(path.join(out, 'scan.html'), sc);
// /bot: the page KidPoshanBot's user-agent points at (https://kidposhan.in/bot)
fs.copyFileSync(path.join(root, '..', 'public', 'bot.html'), path.join(out, 'bot.html'));
// old links to the Browse page go to Products
fs.rmSync(path.join(out, 'browse.html'), { force: true });
fs.rmSync(path.join(out, 'cereals.html'), { force: true });
fs.writeFileSync(path.join(out, '_redirects'), '/browse.html /products 301\n/browse /products 301\n/cereals.html /products?category=Breakfast%20and%20cereals 301\n/cereals /products?category=Breakfast%20and%20cereals 301\n');
// /privacy: the privacy policy (also the address Google asks for)
fs.copyFileSync(path.join(root, '..', 'public', 'privacy.html'), path.join(out, 'privacy.html'));
fs.copyFileSync(path.join(root, '..', 'public', 'built-with-parents.html'), path.join(out, 'built-with-parents.html'));
// the quiet visit count (not shown on the page) and the one search box in every page's header
fs.copyFileSync(path.join(root, '..', 'public', 'kp-visits.js'), path.join(out, 'kp-visits.js'));
fs.copyFileSync(path.join(root, '..', 'public', 'kp-meter.js'), path.join(out, 'kp-meter.js'));
fs.copyFileSync(path.join(root, '..', 'public', 'kp-search.js'), path.join(out, 'kp-search.js'));
for (const f of fs.readdirSync(out).filter((n) => n.endsWith('.html'))) {
  let h = fs.readFileSync(path.join(out, f), 'utf8');
  if (!h.includes('</body>')) throw new Error(f + ': no </body> to add the scripts before');
  for (const src of ['kp-meter.js', 'kp-visits.js', 'kp-search.js']) if (!h.includes(src)) h = h.replace('</body>', `<script src="/${src}" defer></script>\n</body>`);
  fs.writeFileSync(path.join(out, f), h);
}

fs.writeFileSync(path.join(root, 'wrangler.toml'), `# Same Worker that serves www.kidposhan.in: static pages only (no script, no bindings).
name = "poshan-score"
compatibility_date = "2026-09-03"

[assets]
directory = "./public"
`);
console.log('built:', fs.readdirSync(out).join(', '));
// descriptions, share card, sitemap, robots.txt and a page for every scored product (reads the platform's data)
require('./build-seo.cjs').run(out).catch((e) => { console.error(e); process.exitCode = 1; });
