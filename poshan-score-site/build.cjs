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
  let h = strip(fs.readFileSync(path.join(root, 'live-backup', name), 'utf8'));
  const cereal = '<a href="cereals.html">Cereal Aisle</a>';
  const n = h.split(cereal).length - 1;
  if (n !== 2) throw new Error(`${name}: expected the Cereal Aisle link twice (nav + mobile menu), found ${n}`);
  h = h.split(cereal).join(cereal + '\n    ' + MEAL_LINK);

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
  h = h.replace('</style>', '@media(min-width:780px) and (max-width:1179px){.nav-links{display:none!important}.hamburger{display:flex!important}.mobile-menu.open{display:flex}}\n  @media(min-width:1180px){.nav-links{gap:22px}}\n</style>');
  fs.writeFileSync(path.join(out, name), h);
}

// meal-ideas.html from the platform's page
const src = path.join(root, '..', 'public', 'meal-ideas-kp.html');
let m = fs.readFileSync(src, 'utf8');
const swap = (a, b) => { if (!m.includes(a)) throw new Error('meal page anchor missing: ' + a.slice(0, 60)); m = m.split(a).join(b); };
swap('href="https://www.kidposhan.in/#metrics"', 'href="index.html#metrics"');
swap('href="https://www.kidposhan.in/age-metrics.html"', 'href="age-metrics.html"');
swap('href="https://www.kidposhan.in/browse.html"', 'href="browse.html"');
swap('href="https://www.kidposhan.in/cereals.html"', 'href="cereals.html"');
swap('href="https://www.kidposhan.in/why-we-do-this.html"', 'href="why-we-do-this.html"');
swap('href="https://www.kidposhan.in/"', 'href="index.html"');
swap('<a href="#/" class="on">Meal Ideas</a>', '<a href="meal-ideas.html" class="on">Meal Ideas</a>');
swap('<a href="#/">Meal Ideas</a>', '<a href="meal-ideas.html">Meal Ideas</a>');
swap("const API=QS.get('api')||'';", `const API=QS.get('api')||'${PLATFORM}'; // recipes, packs and scores come from the KidPoshan platform Worker`);
swap('<title>KidPoshan | Meal ideas</title>', '<title>Meal Ideas — Poshan Score by Kidposhan</title>');
fs.writeFileSync(path.join(out, 'meal-ideas.html'), m);
// /bot: the page KidPoshanBot's user-agent points at (https://kidposhan.in/bot)
fs.copyFileSync(path.join(root, '..', 'public', 'bot.html'), path.join(out, 'bot.html'));

fs.writeFileSync(path.join(root, 'wrangler.toml'), `# Same Worker that serves www.kidposhan.in: static pages only (no script, no bindings).
name = "poshan-score"
compatibility_date = "2026-09-03"

[assets]
directory = "./public"
`);
console.log('built:', fs.readdirSync(out).join(', '));
