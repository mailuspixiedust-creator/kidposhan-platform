import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { extractFromHtml } from '../../src/recipes/extract.js';
import { parseIngredientLine } from '../../src/recipes/normalize.js';
import { recipeLinksFrom } from '../../src/recipes/discover.js';
import { buildRecipe, processCandidate } from '../../src/recipes/pipeline.js';
import { searchRecipes, recipeDetail, handleRecipesApi } from '../../src/recipes/api.js';
import { reviewRecipe, listForReview, updateSource, listSources } from '../../src/recipes/review.js';
import { discoverForQuery, queryKey } from '../../src/recipes/live.js';
import { parseRobots, robotsAllows } from '../../src/recipes/polite.js';

let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };

const jsonld = `<html><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage"},{"@type":["Recipe"],"name":"Carrot Oats Upma","image":[{"url":"https://x/img.jpg"}],"recipeIngredient":["1/2 cup rolled oats","1 medium carrot, grated","Salt to taste","1 tsp ghee"],"recipeInstructions":[{"@type":"HowToSection","name":"Prep","itemListElement":[{"@type":"HowToStep","text":"Roast the oats &amp; keep aside."}]},{"@type":"HowToStep","text":"Add carrot and cook."}],"prepTime":"PT10M","cookTime":"PT15M","aggregateRating":{"ratingValue":"4.8","ratingCount":"120"},"recipeCategory":"Breakfast"}]}</script></html>`;
const a = extractFromHtml(jsonld, 'https://site.in/carrot-oats-upma/');
ok(a.method === 'jsonld' && a.ingredients.length === 4 && a.instructions[0].section === 'Prep' && a.instructions[0].text === 'Roast the oats & keep aside.' && a.rating === 4.8 && a.prep_minutes === 10, 'JSON-LD @graph + HowToSection + rating');

const wprm = `<h2 class="wprm-recipe-name">Ragi Dosa</h2><ul><li class="wprm-recipe-ingredient"><span>1</span> <span>cup</span> <span>ragi flour</span></li><li class="wprm-recipe-ingredient">½ cup rice flour</li></ul><div class="wprm-recipe-instruction-text">Mix both flours.</div>`;
const b = extractFromHtml(wprm, 'https://s.in/ragi-dosa/');
ok(b.method === 'wprm' && b.name === 'Ragi Dosa' && b.ingredients[0] === '1 cup ragi flour' && b.completeness === 'complete', 'WPRM HTML fallback (no JSON-LD)');

const blog = `<title>Lauki Thepla | My Blog</title><h3>Ingredients</h3><ul><li>1 cup wheat flour</li><li>1/2 cup grated lauki</li><li>Salt to taste</li></ul><h3>Method</h3><ol><li>Knead a dough.</li><li>Roll and roast.</li></ol>`;
const c = extractFromHtml(blog, 'https://b.blogspot.com/lauki-thepla.html');
ok(c.method === 'heuristic' && c.name === 'Lauki Thepla' && c.instructions.length === 2 && c.completeness === 'partial', 'Heading heuristic, kept as partial');
ok(extractFromHtml('<p>Top 10 tiffin ideas</p>', 'x') === null, 'Non-recipe page returns null');

const p1 = parseIngredientLine('1 ½ cups rava (sooji)');
ok(p1.quantity === 1.5 && p1.unit === 'cup' && p1.ingredient_key === 'rava', 'Unicode fraction + unit + key');
const p2 = parseIngredientLine('2 green chillies, slit');
ok(p2.quantity === 2 && p2.ingredient_key === 'green_chilli', 'green chilli beats chilli');
ok(parseIngredientLine('Salt to taste').is_pantry, 'Salt -> pantry');
ok(parseIngredientLine('1 sweet potato').ingredient_key === 'sweet_potato', 'sweet potato beats potato');

const coll = `<a href="/kids-lunch-box-recipes/">self</a><a href="/carrot-rice-recipe/">r1</a><a href="https://site.in/category/kids/">cat</a><a href="/paneer-paratha-for-kids-lunch-box/">r2</a><a href="https://other.com/x-y-z/">ext</a><a href="/about/">about</a>`;
const links = recipeLinksFrom(coll, 'https://site.in/kids-lunch-box-recipes/');
ok(links.length === 2, `Collection links: ${links.join(', ')}`);

const t1 = buildRecipe(a, { url: 'https://site.in/kids-breakfast/', notes: '' }).tags;
ok(t1.occasions.includes('breakfast') && t1.seasons.includes('winter') && t1.diet === 'veg', `Tags upma: ${JSON.stringify(t1)}`);

// D1 shim
const db = new DatabaseSync(':memory:');
db.exec(fs.readFileSync('migrations/0006_recipes.sql', 'utf8'));
db.exec(fs.readFileSync('migrations/0007_review_and_live_discovery.sql', 'utf8'));
db.exec(fs.readFileSync('migrations/0008_polite_crawling.sql', 'utf8'));
db.exec(fs.readFileSync('migrations/0009_site_management.sql', 'utf8'));
db.exec(fs.readFileSync('migrations/0010_recipe_score_and_kp_steps.sql', 'utf8'));
db.exec(fs.readFileSync('migrations/0011_ready_products.sql', 'utf8'));
db.exec(fs.readFileSync('migrations/0012_pack_label_reading.sql', 'utf8'));
db.exec(fs.readFileSync('migrations/0013_photos_hidden.sql', 'utf8'));
db.exec(fs.readFileSync('migrations/0014_publish_by_default.sql', 'utf8'));
db.exec(fs.readFileSync('migrations/0015_mayo_flex.sql', 'utf8'));
db.exec(fs.readFileSync('migrations/0016_recipe_images.sql', 'utf8'));
db.exec(fs.readFileSync('migrations/0017_image_width.sql', 'utf8'));
db.exec("CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE, mobile TEXT UNIQUE, name TEXT NOT NULL, password_hash TEXT, password_salt TEXT, password_iterations INTEGER, role TEXT NOT NULL DEFAULT 'parent', created_at INTEGER NOT NULL); CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL);");
db.exec(fs.readFileSync('migrations/0018_visitors_rate_remarks_pay_outreach.sql', 'utf8'));
db.exec(fs.readFileSync('migrations/0019_tavily_calls.sql', 'utf8'));
db.exec(fs.readFileSync('migrations/0020_visitors_without_otp.sql', 'utf8'));
db.exec(fs.readFileSync('migrations/0021_visitor_email.sql', 'utf8'));
db.exec(fs.readFileSync('migrations/0022_site_visitors.sql', 'utf8'));
db.exec(fs.readFileSync('migrations/0023_world_regions.sql', 'utf8'));
db.exec(fs.readFileSync('migrations/0024_seen_recipes.sql', 'utf8'));
db.exec(fs.readFileSync('migrations/0025_outreach_auto.sql', 'utf8'));
db.exec(fs.readFileSync('migrations/0026_score_by_age.sql', 'utf8'));
db.exec(fs.readFileSync('migrations/0027_pack_gallery.sql', 'utf8'));
db.exec(fs.readFileSync('migrations/0028_cap_flags.sql', 'utf8'));
db.exec(fs.readFileSync('migrations/0029_sync_and_misses.sql', 'utf8'));
db.exec(fs.readFileSync('migrations/0030_pageviews.sql', 'utf8'));
db.exec(fs.readFileSync('migrations/0031_open_food_facts.sql', 'utf8'));
db.exec(fs.readFileSync('migrations/0032_scans.sql', 'utf8'));
db.exec(fs.readFileSync('migrations/0033_reports_contrib.sql', 'utf8'));
db.exec(fs.readFileSync('migrations/0034_auto_review.sql', 'utf8'));
db.exec(fs.readFileSync('migrations/0035_source_indexes.sql', 'utf8'));
db.exec(fs.readFileSync('migrations/0036_kind_check.sql', 'utf8'));
db.exec(fs.readFileSync('migrations/0037_tastes.sql', 'utf8'));
// Like D1, bind() returns a NEW bound statement (so one prepared statement can be bound many times in a batch).
const wrap = (sql, args = []) => ({
  bind: (...x) => wrap(sql, x),
  all: async () => ({ results: db.prepare(sql).all(...args) }),
  first: async () => db.prepare(sql).get(...args) ?? null,
  run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
  _run: () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
});
const env = { CRAWL_MIN_GAP_MS: 0, DB: { prepare: (q) => wrap(q), batch: async (list) => list.map((s) => s._run()) } };
db.prepare(`INSERT INTO kp_recipe_sources (id,name,url,notes,rights_status) VALUES (1,'Test','https://site.in/kids-lunch-box-recipes/','','granted')`).run();

const pages = {};
let tavilyCalls = [];
globalThis.fetch = async (u, init) => {
  if (u === 'https://api.tavily.com/search') {
    const body = JSON.parse(init.body); tavilyCalls.push(body);
    const results = body.include_domains
      ? [{ url: 'https://site.in/new-ragi-porridge-recipe/' }]
      : [{ url: 'https://famouschef.in/recipes/jain-moong-chilla-recipe/' }, { url: 'https://www.pinterest.com/pin/123/' }];
    return { ok: true, json: async () => ({ results }) };
  }
  if (u.endsWith('/robots.txt')) {
    const body = robots[new URL(u).origin];
    return body == null ? { ok: false, status: 404, text: async () => '' } : { ok: true, status: 200, text: async () => body };
  }
  return { ok: true, url: u, headers: new Map([['content-type', 'text/html']]), text: async () => pages[u] };
};
const robots = { 'https://private.in': 'User-agent: *\nDisallow: /recipes/\nAllow: /recipes/public-$' };
const mk = (i, name, cat, ings) => { const u = `https://site.in/r${i}-recipe/`; pages[u] = `<script type="application/ld+json">${JSON.stringify({ '@type': 'Recipe', name, recipeCategory: cat, recipeIngredient: ings, recipeInstructions: ['Step one.'] })}</script>`; return u; };
const urls = [];
for (let i = 0; i < 6; i++) urls.push(mk(i, `Veg Pulao ${i} lunch box`, 'Lunch Box', ['1 cup rice', '1/2 cup peas', 'Salt to taste']));
for (let i = 6; i < 10; i++) urls.push(mk(i, `Paneer Sandwich ${i}`, 'Snack', ['2 slices bread', '50 g paneer', 'Salt to taste']));
for (let i = 10; i < 13; i++) urls.push(mk(i, `Egg Fried Rice ${i}`, 'Lunch', ['1 cup rice', '2 eggs', 'Salt to taste']));
urls.push(mk(13, 'Honey Peanut Chikki', 'Snack', ['1 cup whole roasted peanuts', '2 tbsp honey']));
let id = 1;
for (const u of urls) {
  db.prepare('INSERT INTO kp_recipe_candidates (id, source_id, url, discovered_via) VALUES (?,1,?,?)').run(id, u, 'test');
  const r = await processCandidate(env, { id: id++, url: u }, { id: 1, url: 'https://site.in/', notes: '' });
  if (r.status === 'error') console.log(r);
}
const before = await searchRecipes(env, { age: 48, occasion: 'lunchbox', season: 'monsoon', pref: 'veg', limit: 10 });
ok(before.count === 0, 'Nothing visible to parents before the owner publishes');
const pend = await listForReview(env, { status: 'pending', limit: 50 });
ok(pend.total === 14, `Review queue holds all 14 extracted recipes (${pend.total})`);
for (const it of pend.items) await reviewRecipe(env, it.id, { action: 'publish', steps_link_only: true });
// parents only see recipes that have a cooking time and a score of 58 or more: give the fixtures both
db.prepare("UPDATE kp_recipes SET total_minutes = COALESCE(total_minutes, 25), poshan_score = 70, score_13 = NULL, score_46 = NULL, score_79 = NULL, score_1012 = NULL, cap_13 = 0, cap_46 = 0, cap_79 = 0, cap_1012 = 0, score_status = COALESCE(score_status, 'estimated') WHERE review_status = 'approved'").run();
const res = await searchRecipes(env, { age: 48, occasion: 'lunchbox', season: 'monsoon', pref: 'veg', limit: 10 });
ok(res.count === 10 && res.exact_count === 0 && res.results.filter((r) => r.match === 'any_season').length === 6 && res.results.every((r) => ['veg', 'jain'].includes(r.diet)), `Veg lunchbox 4y monsoon (pea pulao is winter-tagged) -> ${res.count} (${res.exact_count} exact), tiers: ${[...new Set(res.results.map((r) => r.match))]}`);
const res2 = await searchRecipes(env, { age: 30, occasion: 'snack_4pm', season: 'all', pref: 'veg', limit: 10 });
ok(!res2.results.some((r) => /Chikki/.test(r.name)) && res2.coverage_gap, `2.5y snack excludes chikki; gap flagged (${res2.count})`);
const res3 = await searchRecipes(env, { age: 48, occasion: 'lunch', season: 'all', pref: 'nonveg', limit: 10 });
ok(res3.results.some((r) => r.diet === 'egg') && !res.results.some((r) => r.diet === 'egg'), 'Egg only under Non-Veg');
const det = await recipeDetail(env, res.results[0].id);
ok(det.method && det.ingredients.find((i) => i.ingredient_key === 'salt').default_state === 'at_home' && det.ingredients[0].buy.length === 5, 'Detail: method shown (rights granted), pantry pre-ticked, 5 buy links');
console.log('  e.g.', det.ingredients[0].buy.map((x) => x.product_url).join('\n       '));

// owner edits survive a re-crawl
const pulaoId = res.results.find((r) => /Pulao 0/.test(r.name)).id;
await reviewRecipe(env, pulaoId, { action: 'publish', steps_link_only: true, seasons: ['monsoon'], age_min_months: 48 });
db.prepare("UPDATE kp_recipe_candidates SET status='pending' WHERE url LIKE '%r0-recipe%'").run();
const { processPending } = await import('../../src/recipes/pipeline.js');
await processPending(env, { limit: 5 });
const pul = db.prepare('SELECT review_status, age_min_months FROM kp_recipes WHERE id=?').get(pulaoId);
const pulSeason = db.prepare('SELECT group_concat(season) s FROM kp_recipe_seasons WHERE recipe_id=?').get(pulaoId).s;
ok(pul.review_status === 'approved' && pul.age_min_months === 48 && pulSeason === 'monsoon', 'Owner edits + decision survive re-crawl');
ok(await reviewRecipe(env, pulaoId, { action: 'publish', steps_link_only: true, occasions: [] }).then(() => false, (e) => /meal/.test(e.message)), 'Publishing with no meal type is refused');

// search-triggered discovery
env.TAVILY_API_KEY = 'test';
pages['https://site.in/new-ragi-porridge-recipe/'] = `<script type="application/ld+json">${JSON.stringify({ '@type': 'Recipe', name: 'Ragi Porridge for Babies', recipeCategory: 'Breakfast', recipeIngredient: ['2 tbsp ragi flour', '1 cup water'], recipeInstructions: ['Cook.'] })}</script>`;
pages['https://famouschef.in/recipes/jain-moong-chilla-recipe/'] = `<script type="application/ld+json">${JSON.stringify({ '@type': 'Recipe', name: 'Jain Moong Chilla', recipeCategory: 'Breakfast', recipeIngredient: ['1 cup moong dal', 'Salt to taste'], recipeInstructions: ['Blend.', 'Cook.'] })}</script>`;
const q = { age: 9, occasion: 'breakfast', season: 'all', pref: 'jain' };
let waited; const ctx = { waitUntil: (p) => { waited = p; } };
const r1 = await (await handleRecipesApi(new Request('https://w/api/kp/recipes?age_months=9&occasion=breakfast&season=all&pref=jain'), env, ctx)).json();
const disc = await waited;
ok(r1.discovery === 'started' && disc.new_candidates === 2 && disc.extracted === 2, `Search triggers discovery: ${JSON.stringify(disc)}`);
const sugg = await listSources(env, { status: 'suggested' });
ok(sugg.items.length === 1 && sugg.items[0].name === 'famouschef.in' && sugg.items[0].pending === 1, 'Unknown well-known site saved as suggested (pinterest ignored)');
const newPend = (await listForReview(env, { status: 'pending' })).items;
ok(newPend.length === 2 && newPend.every((x) => x.found_for === queryKey(q)) && newPend.find((x) => x.source_name === 'famouschef.in').flags.includes('new_site'), 'New finds wait in review, tagged with the search that found them');
waited = null;
const r2 = await (await handleRecipesApi(new Request('https://w/api/kp/recipes?age_months=9&occasion=breakfast&season=all&pref=jain'), env, ctx)).json();
ok(r2.discovery === 'recent' && waited === null, 'Same search within 24h does not re-run discovery');
await updateSource(env, sugg.items[0].id, { status: 'blocked' });
ok((await listForReview(env, { status: 'pending' })).items.length === 1, 'Blocking a site withdraws its waiting recipes');

// robots.txt rules
const g = parseRobots(`# comment
User-agent: Googlebot
Disallow: /

User-agent: *
Disallow: /wp-admin/
Disallow: /*?replytocom=
Allow: /wp-admin/admin-ajax.php
Crawl-delay: 5

User-agent: KidPoshanBot
Disallow: /members/`);
ok(robotsAllows(g, 'https://a.in/members/x').allowed === false && robotsAllows(g, 'https://a.in/wp-admin/').allowed === true, 'Our own group overrides *');
const g2 = parseRobots('User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\nDisallow: /*?replytocom=\nCrawl-delay: 5');
ok(!robotsAllows(g2, 'https://a.in/wp-admin/x').allowed && robotsAllows(g2, 'https://a.in/wp-admin/admin-ajax.php').allowed, 'Longest match wins (Allow beats shorter Disallow)');
ok(!robotsAllows(g2, 'https://a.in/post/?replytocom=5').allowed && robotsAllows(g2, 'https://a.in/ragi-dosa-recipe/').allowed, 'Wildcards; ordinary recipe pages allowed');
ok(robotsAllows(g2, 'https://a.in/x').delayMs === 5000, 'Crawl-delay read (5s)');
ok(robotsAllows(parseRobots('User-agent: *\nDisallow: /'), 'https://a.in/x').allowed === false, 'Disallow: / blocks everything');
ok(robotsAllows(parseRobots('User-agent: *\nDisallow:'), 'https://a.in/x').allowed === true, 'Empty Disallow allows everything');

db.prepare("INSERT INTO kp_recipe_sources (id,name,url,notes,status) VALUES (50,'Private','https://private.in/','','registered')").run();
db.prepare("INSERT INTO kp_recipe_candidates (id, source_id, url, discovered_via) VALUES (500, 50, 'https://private.in/recipes/secret-dal/', 'test')").run();
const rb = await processCandidate(env, { id: 500, url: 'https://private.in/recipes/secret-dal/' }, { id: 50, url: 'https://private.in/', notes: '' });
ok(rb.status === 'robots_blocked' && db.prepare('SELECT status FROM kp_recipe_candidates WHERE id=500').get().status === 'robots_blocked', 'Page disallowed by robots.txt is never read');

// pacing: with the real 10s gap, a second page on the same site in the same run is deferred, not failed
const slow = { ...env, CRAWL_MIN_GAP_MS: 30000 };
pages['https://pace.in/a-b-c-recipe/'] = pages['https://site.in/r1-recipe/']; pages['https://pace.in/d-e-f-recipe/'] = pages['https://site.in/r2-recipe/'];
db.prepare("INSERT INTO kp_recipe_sources (id,name,url,notes) VALUES (60,'Pace','https://pace.in/','')").run();
db.prepare("INSERT INTO kp_recipe_candidates (id, source_id, url, discovered_via) VALUES (600,60,'https://pace.in/a-b-c-recipe/','t'),(601,60,'https://pace.in/d-e-f-recipe/','t')").run();
const pc1 = await processCandidate(slow, { id: 600, url: 'https://pace.in/a-b-c-recipe/' }, { id: 60, url: 'https://pace.in/', notes: '' });
const pc2 = await processCandidate(slow, { id: 601, url: 'https://pace.in/d-e-f-recipe/' }, { id: 60, url: 'https://pace.in/', notes: '' });
const c601 = db.prepare('SELECT status, attempts, not_before FROM kp_recipe_candidates WHERE id=601').get();
ok(pc1.status === 'extracted' && pc2.status === 'later' && c601.status === 'pending' && c601.attempts === 0 && c601.not_before > Date.now(), 'Same-site page deferred by pacing, no failure counted');

// Sites tab
const all = await listSources(env, { state: 'all' });
ok(all.counts.all === all.items.length && all.counts.blocked === 1 && all.items.find((x) => x.id === 1).published > 0, `Sites list with counts ${JSON.stringify(all.counts)}`);
ok((await listSources(env, { state: 'all', q: 'pace' })).items.length === 1, 'Search sites by name/url');
const up = await updateSource(env, 1, { rights_status: 'granted', owner_notes: 'Agreed by email 12 Oct' });
ok(up.rights_status === 'granted' && up.owner_notes.startsWith('Agreed') && up.rights_updated_at, 'Permission + notes saved with date');
await updateSource(env, 60, { state: 'paused' });
db.prepare("UPDATE kp_recipe_candidates SET not_before = NULL WHERE id = 601").run();
const afterPause = await processPending(env, { limit: 10 });
ok(!afterPause.some((x) => x.id === 601) && (await listSources(env, { state: 'paused' })).items[0].id === 60, 'Paused site is not read; shows under Paused');
await updateSource(env, 60, { state: 'active' });
ok((await processPending(env, { limit: 10 })).some((x) => x.id === 601), 'Resumed site is read again');
ok(await updateSource(env, 1, { state: 'deleted' }).then(() => false, () => true), 'Invalid state refused');

// index/category pages are not recipes
import { isIndexPath } from '../../src/recipes/discover.js';
ok(['/recipe-index/', '/recipes/baby-food-recipes/', '/recipes/recent-recipes/', '/recipes/chutney/', '/kids-lunch-box-recipes/'].every(isIndexPath) && !['/carrot-rice-recipe/', '/baby-corn-pulao-recipe-baby-corn-recipes/', '/2014/04/beetroot-poriyal-recipe.html', '/flourless-pancakes-recipe/'].some(isIndexPath), 'Index/category/roundup paths are skipped, single recipes kept');
const idx = `<h3>Ingredients</h3><ul><li><a href="/c">Chicken Recipes</a></li><li><a href="/e">Egg Recipes</a></li><li><a href="/f">Fish Recipes</a></li></ul>`;
ok(extractFromHtml(idx, 'https://s.in/recipe-index/') === null, 'Link-only category list is not read as ingredients');
const idx2 = `<h3>Ingredients</h3><ul><li>Chicken Recipes</li><li>Egg Recipes</li><li>Paneer</li></ul>`;
ok(extractFromHtml(idx2, 'https://s.in/x/') === null, 'List of "... Recipes" titles is not read as ingredients');

// router: every admin route the pages call must resolve (regression: review/sources POST used the old path)
import { routeRecipes } from '../../src/recipes/routes.js';
for (const [meth, path] of [['GET','/api/kp/admin/review'],['POST','/api/kp/admin/review/1'],['GET','/api/kp/admin/sources'],['POST','/api/kp/admin/sources/1']]) {
  const r = await routeRecipes(new Request('https://w' + path, { method: meth, headers: { 'x-admin-token': 't' }, body: meth === 'POST' ? '{}' : undefined }), { ...env, ADMIN_TOKEN: 't' }, ctx);
  ok(!/Unknown admin route/.test(await r.text()), 'Router resolves ' + meth + ' ' + path);
}

// ---- recipe-level score + KidPoshan steps ----
import { computeRecipeScore, scoreRecipe } from '../../src/recipes/score.js';
import { checkRewrite, rewriteSteps } from '../../src/recipes/rewrite.js';
const ingr = (lines) => lines.map((l) => ({ ...parseIngredientLine(l), }));
const upma = ingr(['1 cup rava', '1 carrot', '1/2 cup green peas', '2 tbsp oil', '1 tsp mustard seeds', 'Salt to taste']);
const sc = computeRecipeScore({ servings: '4' }, upma);
ok(sc.status === 'estimated' && sc.score > 0 && sc.score <= 100 && sc.detail.sources.protein === 'estimated', `Estimated score from ingredients: ${sc.score} (${sc.detail?.engine?.band})`);
const sweet = computeRecipeScore({ servings: '2' }, ingr(['1 cup rava', '1/2 cup sugar', '1 cup milk']));
const plain = computeRecipeScore({ servings: '2' }, ingr(['1 cup rava', '1 cup milk']));
ok(sweet.detail.inputs.addedSugar > 40 && sweet.detail.bands['4-6'].sum < plain.detail.bands['4-6'].sum && sweet.detail.bands['4-6'].metrics[0].score < plain.detail.bands['4-6'].metrics[0].score, 'Added sugar from a listed sweetener lowers the sugar metric and the total');
const exactSc = computeRecipeScore({ servings: '4', nutrition_json: JSON.stringify({ proteinContent: '6 g', fiberContent: '3 g', saturatedFatContent: '1 g', sodiumContent: '200 mg' }) }, upma);
ok(exactSc.status === 'exact' && exactSc.detail.sources.protein === 'recipe_data', 'Nutrition from the page makes the score exact');
const unk = computeRecipeScore({ servings: '4' }, ingr(['1 unicorn tear', '2 dragon scales', '1 cup rava']));
ok(unk.status === 'pending' && unk.score === null, 'Unweighable ingredients -> pending, no invented score');
db.prepare("INSERT INTO kp_recipe_sources (id, name, url, rights_status) VALUES (9060, 'NoRights', 'https://norights.in/', 'not_requested')").run();
const rid = db.prepare("INSERT INTO kp_recipes (source_id, source_url, name, ingredients_raw_json, extraction_method, completeness, diet, age_min_months, age_max_months, servings, review_status, instructions_json) VALUES (9060,'https://site.in/sc-test/','Upma','[]','jsonld','complete','veg',12,72,'4','approved',?) RETURNING id").get(JSON.stringify([{ section: null, text: 'Roast 1 cup rava for 5 minutes.' }, { section: null, text: 'Add water and cook 3 minutes.' }])).id;
upma.forEach((i, n) => db.prepare('INSERT INTO kp_recipe_ingredients (recipe_id, position, raw_text, quantity, unit, name, ingredient_key, is_pantry) VALUES (?,?,?,?,?,?,?,?)').run(rid, n, i.raw_text, i.quantity, i.unit, i.name, i.ingredient_key, i.is_pantry ? 1 : 0));
const stored = await scoreRecipe(env, rid);
ok(stored.status === 'estimated' && db.prepare('SELECT poshan_score FROM kp_recipes WHERE id=?').get(rid).poshan_score === stored.score, 'Score stored on the recipe');
const hidden = await (await handleRecipesApi(new Request('https://w/api/kp/recipes/' + rid), env, ctx)).json();
ok(hidden.score?.kind === 'estimated' && hidden.poshan_score === stored.score, 'Estimated score is shown to parents by default, labelled estimated');
db.prepare('UPDATE kp_recipes SET score_hidden = 1 WHERE id=?').run(rid);
const hiddenByOwner = await (await handleRecipesApi(new Request('https://w/api/kp/recipes/' + rid), env, ctx)).json();
ok(hiddenByOwner.poshan_score === null && hiddenByOwner.score === null, 'Owner can hide one recipe score');
db.prepare('UPDATE kp_recipes SET score_hidden = 0 WHERE id=?').run(rid);
const shown = await (await handleRecipesApi(new Request('https://w/api/kp/recipes/' + rid), env, ctx)).json();
ok(shown.score?.value === stored.score && shown.method_by === 'creator' && shown.method.length > 0, 'Score back on; the author steps are shown whatever the rights');
const orig = ['Roast 1 cup rava for 5 minutes.', 'Add water and cook 3 minutes.'];
ok(checkRewrite(orig, ['Dry roast the rava (1 cup) for 5 minutes.', 'Pour in water and cook for 3 minutes.']) === null, 'Faithful rewrite accepted');
ok(/numbers missing/.test(checkRewrite(orig, ['Roast the rava.', 'Add water and cook.'])), 'Rewrite that drops quantities/times is rejected');
const aiEnv = { ...env, AI: { run: async () => ({ response: 'Here you go: ["Dry roast 1 cup rava for 5 minutes.", "Add water, cook for 3 minutes."]' }) } };
const rw = await rewriteSteps(aiEnv, rid);
ok(/author/.test(rw.skipped || '') && db.prepare('SELECT kp_steps_status s FROM kp_recipes WHERE id=?').get(rid).s === 'none', "An author's steps are never rewritten: nothing is written and the recipe keeps no wording of ours");
const liveNow = await (await handleRecipesApi(new Request('https://w/api/kp/recipes/' + rid), env, ctx)).json();
ok(liveNow.method_by === 'creator' && liveNow.method.length > 0, "The author's steps are shown as points, never rewritten");
// publishing by hand still needs steps (or the link-only choice) when none exist
db.prepare("INSERT INTO kp_recipes (source_id, source_url, name, ingredients_raw_json, extraction_method, completeness, diet, age_min_months, age_max_months, review_status, instructions_json) VALUES (9060,'https://site.in/nosteps/','Needs Steps','[]','jsonld','complete','veg',24,72,'pending',?)").run(JSON.stringify([{ section: null, text: 'Cook it.' }]));
const nsId = db.prepare("SELECT id FROM kp_recipes WHERE source_url='https://site.in/nosteps/'").get().id;
let refused = ''; try { await reviewRecipe(env, nsId, { action: 'publish', occasions: ['breakfast'] }); } catch (e) { refused = e.message; }
ok(/approve or write the KidPoshan steps/.test(refused), 'Manual publish still needs KidPoshan steps (or the link-only choice)');

// ---- parser: quantity after the name, extra units, new keys, roundup slugs ----
const t1p = parseIngredientLine('Oil - 2 tblsp'); ok(t1p.quantity === 2 && t1p.unit === 'tbsp' && t1p.ingredient_key === 'oil', 'Trailing quantity: "Oil - 2 tblsp"');
const t2p = parseIngredientLine('Yellow Moong Dal / Pasi Paruppu - 1/2 cup'); ok(t2p.quantity === 0.5 && t2p.unit === 'cup' && t2p.ingredient_key === 'moong_dal', 'Trailing fraction + cup: moong dal');
const t3p = parseIngredientLine('Cauliflower - 1 medium size cut into florets'); ok(t3p.quantity === 1 && t3p.ingredient_key === 'cauliflower', 'Trailing count: cauliflower');
const t4p = parseIngredientLine('Salt a pinch'); ok(t4p.quantity === 1 && t4p.unit === 'pinch' && t4p.ingredient_key === 'salt', '"Salt a pinch"');
ok(parseIngredientLine('2 tbsp Sugar').quantity === 2 && parseIngredientLine('1 cup rava').quantity === 1, 'Leading-quantity lines unchanged');
ok(parseIngredientLine('2 garlic cloves, minced').ingredient_key === 'garlic' && parseIngredientLine('4 cloves').ingredient_key === 'cloves', 'garlic cloves vs the spice cloves');
const wk = computeRecipeScore({ servings: '4' }, ['Cauliflower - 1 medium size cut into florets', 'Oil - 2 tblsp', 'Turmeric Powder - 1 tsp', 'Salt to taste', 'Water as needed'].map(parseIngredientLine));
ok(wk.status === 'estimated', 'Name-first ingredient lines are now weighed and scored (' + wk.status + ')');
ok(isIndexPath('/lunch-box-recipes-kids-lunchbox/') && isIndexPath('/kids-lunch-box-recipes-indian/') && !isIndexPath('/baby-corn-pulao-recipe-baby-corn-recipes/') && !isIndexPath('/beetroot-poriyal-recipe/'), 'Roundup slugs detected, single dishes kept');

ok(parseIngredientLine('2 large Beetroots (around 2 cups)').ingredient_key === 'beetroot' && parseIngredientLine('2 bell peppers').ingredient_key === 'capsicum', 'Plural ingredient names recognised');
ok(parseIngredientLine('1 no Brinjal (chopped)').ingredient_key === 'brinjal' && parseIngredientLine('2 no Ladysfinger (chopped)').ingredient_key === 'okra', 'Brinjal and okra recognised');
const cl = parseIngredientLine('Curry leaves a sprig'); ok(cl.quantity === 1 && cl.unit === 'sprig' && cl.ingredient_key === 'curry_leaves', '"a sprig" / "a handful" read as a quantity');
ok(parseIngredientLine('1 potato').ingredient_key === 'potato' && parseIngredientLine('2 sweet potatoes').ingredient_key === 'sweet_potato' && parseIngredientLine('green chillies').ingredient_key === 'green_chilli', 'Existing key matching unaffected by plural support');

db.prepare("UPDATE kp_recipes SET kp_steps_status='none', kp_steps_json=NULL WHERE id=?").run(rid);
const chatEnv = { ...env, AI: { run: async () => ({ choices: [{ message: { content: '["Dry roast 1 cup rava for 5 minutes.", "Add water and cook for 3 minutes."]' } }] }) } };
ok(/author/.test((await rewriteSteps(chatEnv, rid)).skipped || ''), 'No AI call is made to rewrite an author\'s steps');

// ---- ready-to-buy packs: the dish in pack form, exact label-based score, owner approval ----
import { kindForDish, scorePack, packsForRecipe, listPacks, reviewPack } from '../../src/recipes/ready.js';
ok(kindForDish('Ragi Dosa Recipe | Instant Ragi Dosa').kind === 'ragi_dosa_mix', 'Ragi dosa -> ragi dosa MIX (not ragi flour)');
ok(kindForDish('Rava Dosa').kind === 'dosa_mix' && kindForDish('Idli Dosa Batter').kind === 'dosa_batter' && kindForDish('Soft Idli').kind === 'idli_mix', 'Dosa / batter / idli map to their own kinds');
ok(kindForDish('Potato Poriyal') === null && kindForDish('Carrot Rice') === null, 'Dishes with no ready-made form get no packs');
ok(scorePack({ protein_g: 10 }, ['ragi']).status === 'pending', 'Pack score pending until the whole label is entered');
const label = { protein_g: 9, fibre_g: 8, sugars_g: 1, added_sugars_g: 0, saturated_fat_g: 0.8, sodium_mg: 120 };
const good = scorePack(label, ['Ragi flour (60%)', 'Rice flour', 'Salt'], 'Ragi dosa mix');
const bad = scorePack({ ...label, added_sugars_g: 18, sodium_mg: 900 }, ['Maida', 'Sugar', 'Palm oil', 'Preservative (E211)', 'Artificial flavour'], 'Ragi dosa mix');
ok(good.status === 'exact' && bad.status === 'exact' && bad.score < good.score && good.detail.bands['4-6'].metrics[8].score === 1 && bad.detail.bands['4-6'].metrics[8].score === 0 && bad.detail.bands['4-6'].metrics[7].score === 0, `Exact pack score reads the ingredient list: the refined-first, additive-laden pack scores lower (good ${good.score}, bad ${bad.score})`);
db.prepare("INSERT INTO kp_recipes (source_id, source_url, name, ingredients_raw_json, extraction_method, completeness, diet, age_min_months, age_max_months, review_status) VALUES (9060,'https://site.in/ragi-dosa/','Ragi Dosa Recipe','[]','jsonld','complete','veg',12,72,'approved')").run();
const ragiId = db.prepare("SELECT id FROM kp_recipes WHERE source_url='https://site.in/ragi-dosa/'").get().id;
db.prepare("INSERT INTO kp_ready_products (kind, name, brand, pack_size, product_url, retailer, ingredients_json) VALUES ('ragi_dosa_mix','Indira Ragi Dosa Mix','Indira','500 g','https://zepto.com/p/1','zepto','[\"Ragi flour\",\"Rice flour\",\"Salt\"]')").run();
db.prepare("INSERT INTO kp_ready_products (kind, name, brand, pack_size, product_url, retailer, ingredients_json) VALUES ('ragi_dosa_mix','Other Ragi Dosa Mix','Other','400 g','https://flipkart.com/p/2','flipkart','[]')").run();
ok((await packsForRecipe(env, ragiId)).packs.length === 0, 'Candidate packs are not shown to parents');
const candId = (await listPacks(env, { status: 'candidate' })).items.find((x) => x.brand === 'Indira').id;
const approved = await reviewPack(env, candId, { action: 'approve', nutrition: label });
ok(approved.status === 'approved' && approved.score_status === 'exact' && approved.kidposhan_score > 0, 'Owner enters the label and approves: exact score stored');
const shownPacks = await packsForRecipe(env, ragiId);
ok(shownPacks.kind === 'ragi_dosa_mix' && shownPacks.packs.length === 1 && shownPacks.packs[0].score.value === approved.kidposhan_score, 'Parents see the approved pack with its exact score');
const otherId = (await listPacks(env, { status: 'candidate' })).items[0].id;
await reviewPack(env, otherId, { action: 'approve' });
const both = (await packsForRecipe(env, ragiId)).packs;
ok(both.length === 2 && both[0].score && both[1].score === null, 'Scored packs first; unscored pack says score pending (null)');
let bad2 = ''; try { await reviewPack(env, otherId, { action: 'approve', nutrition: { protein_g: 'abc' } }); } catch (e) { bad2 = e.message; }
ok(/must be a number/.test(bad2), 'Label values must be numbers');
ok((await packsForRecipe(env, 999999)).packs.length === 0, 'Unknown recipe -> no packs');

// ---- pack label reading: scaling done in code, never trusting a model-invented per-100 g column, two readers must agree ----
import { labelFrom, consensus, packImages } from '../../src/recipes/label.js';
const serving = { nutrition_found: true, serving_size_g: 55, per_serving: { protein_g: 5.42, fibre_g: 5.57, sugars_g: 0.49, added_sugars_g: 0, saturated_fat_g: 0.29, sodium_mg: 9.47 },
  per_100g: { protein_g: 9, fibre_g: 9, sugars_g: 9, added_sugars_g: 9, saturated_fat_g: 9, sodium_mg: 99 }, ingredients: ['Finger Millet (Ragi)', 'Rice'] };
const lf1 = labelFrom(serving);
ok(lf1.ok && lf1.label.protein_g === 9.85 && lf1.label.fibre_g === 10.13 && lf1.label.sodium_mg === 17.22, 'Per-serving label scaled to 100 g in code (a made-up per-100 g column is ignored)');
ok(labelFrom({ nutrition_found: true, per_serving: { protein_g: 5, fibre_g: 2, sugars_g: 1 } }).ok === false, 'Per-serving label without a printed serving size is not guessed');
ok(labelFrom({ nutrition_found: true, serving_size_g: null, per_100g: { protein_g: 10, fibre_g: 5, saturated_fat_g: 1, sodium_mg: 300 } }).ok === true, 'A genuine per-100 g column is used when there is no per-serving data');
ok(labelFrom({ nutrition_found: false }).ok === false && labelFrom({ nutrition_found: true, serving_size_g: 50, per_serving: { protein_g: 900, fibre_g: 1, sugars_g: 1 } }).ok === false, 'No table, or implausible numbers, are rejected');
const la = labelFrom(serving);
const lbOk = labelFrom({ ...serving, per_serving: { ...serving.per_serving, fibre_g: 5.52 } });
const lbBad = labelFrom({ ...serving, per_serving: { ...serving.per_serving, sodium_mg: 947 } });
ok(consensus(la, la).label.sodium_mg === 17.22 && /agreed/.test(consensus(la, la).notes[0]), 'Two readers agreeing: values kept');
ok(consensus(la, lbOk).label.fibre_g === 10.13 || consensus(la, lbOk).label.fibre_g === null, 'Tiny reader differences handled');
const cb = consensus(la, lbBad);
ok(cb.label.sodium_mg === null && cb.label.protein_g === 9.85 && /disagreed on sodium_mg/.test(cb.notes[0]), 'A value the readers disagree on is left empty for the owner');
ok(/only one reader/.test(consensus(la, null).notes[0]), 'Single reader flagged for careful checking');
const html = '<script type="application/ld+json">{"@type":"Product","name":"x","image":["https://rukmini1.flixcart.com/image/1500/1500/a/b/c/p1.jpeg?q=70","https://rukmini1.flixcart.com/image/1500/1500/a/b/c/p2.jpeg?q=70","https://rukmini1.flixcart.com/image/1500/1500/a/b/c/p1.jpeg?q=70"]}</script>';
const pi = packImages(html);
ok(pi.length === 2 && pi[0].includes('/image/1600/1700/'), 'Pack gallery images found, de-duplicated, requested at high resolution');

import { neededKinds } from '../../src/recipes/ready.js';
const need = await neededKinds(env);
ok(need.has('ragi_dosa_mix') && !need.has('khichdi_mix'), 'Pack research is prioritised for kinds matching published recipes: ' + [...need].join(','));

import { packsForRecipes } from '../../src/recipes/ready.js';
db.prepare("INSERT INTO kp_recipes (source_id, source_url, name, ingredients_raw_json, extraction_method, completeness, diet, age_min_months, age_max_months, review_status) VALUES (9060,'https://site.in/rds/','Ragi Dosai | Instant Ragi Dosa Recipe','[]','jsonld','complete','veg',12,72,'approved')").run();
db.prepare("INSERT INTO kp_recipes (source_id, source_url, name, ingredients_raw_json, extraction_method, completeness, diet, age_min_months, age_max_months, review_status) VALUES (9060,'https://site.in/poriyal2/','Beans Poriyal','[]','jsonld','complete','veg',12,72,'approved')").run();
const rds = db.prepare("SELECT id FROM kp_recipes WHERE source_url='https://site.in/rds/'").get().id;
const por = db.prepare("SELECT id FROM kp_recipes WHERE source_url='https://site.in/poriyal2/'").get().id;
const multi = await packsForRecipes(env, [ragiId, rds, por, 'x', -1]);
ok(multi.items.length === 2 && multi.items.every((i) => i.for.length === 2 && i.kind === 'ragi_dosa_mix'), 'Menu page: packs for several dishes in one list, a pack lists every dish it fits');
ok(multi.items[0].score && multi.items[1].score === null, 'Menu page packs: scored first');
ok(multi.items.every((i) => !/recipe/i.test(i.for.map((f) => f.name).join(' '))), 'Dish names on pack cards are cleaned of "Recipe" and alternate titles');
ok((await packsForRecipes(env, [por])).items.length === 0 && (await packsForRecipes(env, [])).items.length === 0, 'Dishes with no ready-made form give no menu packs');

// ---- photos: shown for every readable recipe (credited), unless the owner hides a site's photos ----
db.prepare("UPDATE kp_recipes SET image_url='https://site.in/ragi.jpg' WHERE id=?").run(ragiId);
const ph1 = await (await handleRecipesApi(new Request('https://w/api/kp/recipes/' + ragiId), env, ctx)).json();
ok(ph1.image_url === 'https://site.in/ragi.jpg' && ph1.source.name === 'NoRights' && ph1.source.rights_status === 'not_requested', 'Dish photo shown without granted rights, with the source named for the credit');
ok(ph1.method_by === 'creator' || ph1.method === null, 'Steps shown from the author whatever the rights');
await updateSource(env, 9060, { photos_hidden: true });
const ph2 = await (await handleRecipesApi(new Request('https://w/api/kp/recipes/' + ragiId), env, ctx)).json();
ok(ph2.image_url === null, "Owner can switch a site's photos off");
const srch = await (await handleRecipesApi(new Request('https://w/api/kp/recipes?age_months=24&occasion=breakfast&season=all&pref=veg&limit=50'), env, ctx)).json();
ok(srch.results.filter((r) => r.id === ragiId).every((r) => r.image_url == null), 'Hidden photos also stay out of menu results');
await updateSource(env, 9060, { photos_hidden: false });
const ph3 = await (await handleRecipesApi(new Request('https://w/api/kp/recipes/' + ragiId), env, ctx)).json();
ok(ph3.image_url === 'https://site.in/ragi.jpg', 'Photos come back when switched on again');

import { dedupePacks, packFamilyKey } from '../../src/recipes/ready.js';
const wa = { id: 1, kind: 'pulao_mix', brand: 'Waah Organic', name: 'Waah Organic Nawabi Biryani (Veg Pulao), Ready to Eat, 250g x 2', kidposhan_score: null, score_status: 'pending' };
const wb = { ...wa, id: 2, name: 'Waah Organic Nawabi Biryani (Veg Pulao), Ready to Eat, 250g x 3' };
const wc = { ...wa, id: 3, name: 'Waah Organic Nawabi Biryani (Veg Pulao), Ready to Eat (Pack of 2)', kidposhan_score: 88, score_status: 'exact' };
const other = { id: 4, kind: 'pulao_mix', brand: 'Other', name: 'Other Veg Pulao 250 g', kidposhan_score: null, score_status: 'pending' };
ok(dedupePacks([wa, wb, other]).length === 2 && dedupePacks([wa, wb, other]).find((x) => x.brand === 'Waah Organic').id === 1, 'Same product as 2-pack and 3-pack shows once (earliest kept)');
ok(dedupePacks([wa, wb, wc]).length === 1 && dedupePacks([wa, wb, wc])[0].id === 3, 'When one multipack has a score, that one is kept');
ok(packFamilyKey(wa) !== packFamilyKey(other), 'Different products are not merged');

import { withCors } from '../../src/recipes/routes.js';
const corsOf = (o) => withCors(new Request('https://x/api/kp/ready', o ? { headers: { origin: o } } : {}), new Response('{}')).headers.get('access-control-allow-origin');
ok(corsOf('https://www.kidposhan.in') === 'https://www.kidposhan.in' && corsOf('https://kidposhan.in') === 'https://kidposhan.in' && corsOf('https://x1-poshan-score.mailus-pixiedust.workers.dev') !== null, 'Your own domains may read the public recipe and pack data');
ok(corsOf('https://evil.example') === null && corsOf('https://kidposhan.in.evil.com') === null && corsOf('https://xkidposhan.in') === null && corsOf(null) === null, 'Other origins and lookalike domains get no access');
const adminRes = await routeRecipes(new Request('https://x/api/kp/admin/review', { headers: { origin: 'https://www.kidposhan.in' } }), { ...env, ADMIN_TOKEN: 't' }, ctx);
ok(adminRes.status === 401 && adminRes.headers.get('access-control-allow-origin') === null, 'Admin routes stay token-protected with no cross-origin access');

// ---- publish by default, review afterwards ----
import { holdReasons, maybeAutoPublish, autoPublishPending } from '../../src/recipes/autopublish.js';
const okRecipe = { completeness: 'complete', extraction_method: 'jsonld', kp_steps_status: 'approved', age_min_months: 24, age_max_months: 72 };
const okSource = { status: 'registered', active: 1 };
const ing4 = [{ ingredient_key: 'rice' }, { ingredient_key: 'carrot' }, { ingredient_key: 'oil' }, { ingredient_key: 'salt' }];
ok(holdReasons({ recipe: okRecipe, source: okSource, ingredients: ing4, steps: 3, occasions: 1 }).length === 0, 'A complete, tagged recipe with KidPoshan steps passes every check');
ok(holdReasons({ recipe: { ...okRecipe, age_min_months: 9 }, source: okSource, ingredients: ing4, steps: 3, occasions: 1 }).some((w) => /under 12 months/.test(w)), 'Recipes for under 12 months are always held for a person');
ok(holdReasons({ recipe: okRecipe, source: okSource, flags: ['check_jain', 'partial'], ingredients: ing4, steps: 3, occasions: 1 }).length === 2, 'Jain-check and partial-read flags hold a recipe back');
ok(holdReasons({ recipe: { ...okRecipe, age_min_months: 12 }, source: okSource, ingredients: [...ing4, { ingredient_key: 'honey' }], steps: 3, occasions: 1 }).some((w) => /honey/.test(w)), 'Honey in a recipe for under 2 years is held');
ok(holdReasons({ recipe: { ...okRecipe, kp_steps_status: 'none' }, source: okSource, ingredients: ing4.slice(0, 2), steps: 1, occasions: 0 }).length >= 3, 'Thin recipes (few ingredients, one step, no meal) are held with every reason listed');
ok(holdReasons({ recipe: okRecipe, source: { status: 'suggested', active: 0 }, ingredients: ing4, steps: 3, occasions: 1 }).length === 1, 'A site that is not in the registry holds its recipes');

let autoDishN = 0;
const mkRecipe = (url, extra = {}) => {
  const f = { name: 'Auto Dish ' + (++autoDishN), method: 'jsonld', complete: 'complete', agemin: 24, agemax: 72, status: 'pending', kp: 'approved', ...extra };
  const id = db.prepare("INSERT INTO kp_recipes (source_id, source_url, name, ingredients_raw_json, extraction_method, completeness, diet, age_min_months, age_max_months, review_status, instructions_json, kp_steps_status, kp_steps_json) VALUES (1,?,?,'[]',?,?,'veg',?,?,?,?,?,?) RETURNING id")
    .get(url, f.name, f.method, f.complete, f.agemin, f.agemax, f.status, JSON.stringify([{ section: null, text: 'Cook 1 cup rice for 10 minutes.' }, { section: null, text: 'Serve warm.' }]), f.kp, f.kp === 'approved' ? JSON.stringify(['Cook the rice for 10 minutes.', 'Serve warm.']) : null).id;
  ['1 cup rice', '1 carrot', '2 tbsp oil', 'Salt to taste'].forEach((l, n) => { const q = parseIngredientLine(l); db.prepare('INSERT INTO kp_recipe_ingredients (recipe_id, position, raw_text, quantity, unit, name, ingredient_key, is_pantry) VALUES (?,?,?,?,?,?,?,?)').run(id, n, q.raw_text, q.quantity, q.unit, q.name, q.ingredient_key, q.is_pantry ? 1 : 0); });
  db.prepare("INSERT INTO kp_recipe_occasions (recipe_id, occasion) VALUES (?, 'lunch')").run(id);
  db.prepare("INSERT INTO kp_recipe_seasons (recipe_id, season) VALUES (?, 'all')").run(id);
  db.prepare('UPDATE kp_recipes SET total_minutes = ? WHERE id = ?').run(extra.minutes ?? 30, id);
  if (f.status === 'approved') db.prepare("UPDATE kp_recipes SET poshan_score = COALESCE(poshan_score, ?), score_status = COALESCE(score_status, 'estimated') WHERE id = ?").run(extra.score ?? 70, id);   // only recipes with a score are offered
  return id;
};
const goodId = mkRecipe('https://site.in/auto-good/');
const goodRes = await maybeAutoPublish(env, goodId);
const goodRow = db.prepare('SELECT review_status, publish_origin, owner_reviewed_at FROM kp_recipes WHERE id=?').get(goodId);
ok(goodRes.published && goodRow.review_status === 'approved' && goodRow.publish_origin === 'auto' && goodRow.owner_reviewed_at === null, 'A recipe that passes the checks goes live on its own, marked auto and not yet reviewed');
const infantId = mkRecipe('https://site.in/auto-infant/', { agemin: 6 });
const infRes = await maybeAutoPublish(env, infantId);
ok(infRes.held && db.prepare('SELECT review_status, hold_reasons_json h FROM kp_recipes WHERE id=?').get(infantId).h.includes('under 12 months'), 'An infant recipe stays held and records why');
const nokpId = mkRecipe('https://site.in/auto-nokp/', { kp: 'none' });
const sweep0 = await autoPublishPending(env, { limit: 100 });
ok(db.prepare('SELECT review_status FROM kp_recipes WHERE id=?').get(nokpId).review_status === 'approved', "A recipe whose author gave steps does not wait for wording of ours: it goes live on its own");
const rwEnv = { ...env, AI: { run: async () => ({ response: '["Cook 1 cup rice for 10 minutes.", "Serve it warm."]' }) } };
const rwRes = await rewriteSteps(rwEnv, nokpId);
ok(/author/.test(rwRes.skipped || ''), 'Asking to rewrite an author\'s steps does nothing');
const decidedId = mkRecipe('https://site.in/auto-decided/');
db.prepare("UPDATE kp_recipes SET reviewed_at = datetime('now') WHERE id=?").run(decidedId);
ok((await maybeAutoPublish(env, decidedId)).skipped && db.prepare('SELECT review_status FROM kp_recipes WHERE id=?').get(decidedId).review_status === 'pending', 'A recipe the owner already decided on is never touched by the automation');

// owner controls after going live
const live1 = await listForReview(env, { status: 'approved', reviewed: 'no' });
ok(live1.items.some((i) => i.id === goodId) && live1.unreviewed >= 1, 'Live tab can show only the recipes not yet reviewed, with a count');
await reviewRecipe(env, goodId, { action: 'mark', reviewed: true, note: 'checked steps, fine' });
const marked = db.prepare('SELECT owner_reviewed_at o, review_note n, review_status st FROM kp_recipes WHERE id=?').get(goodId);
ok(marked.o && marked.n === 'checked steps, fine' && marked.st === 'approved', 'Bookmark: reviewed + note saved without changing whether it is live');
ok((await listForReview(env, { status: 'approved', reviewed: 'yes' })).items.some((i) => i.id === goodId) && !(await listForReview(env, { status: 'approved', reviewed: 'no' })).items.some((i) => i.id === goodId), 'The reviewed filter splits live recipes correctly');
await reviewRecipe(env, goodId, { action: 'mark', reviewed: false });
ok(db.prepare('SELECT owner_reviewed_at o FROM kp_recipes WHERE id=?').get(goodId).o === null, 'Reviewed can be unticked again');
await reviewRecipe(env, goodId, { action: 'publish', keep_review_mark: true, kp_steps: ['Boil 1 cup rice for 10 minutes.', 'Serve hot.'], ingredients: ['2 cups basmati rice', '1 carrot, grated', 'Salt to taste'] });
const edited = db.prepare('SELECT owner_reviewed_at o, ingredients_edited e, kp_steps_auto a, kp_steps_json k FROM kp_recipes WHERE id=?').get(goodId);
ok(edited.e === 1 && edited.a === 0 && edited.o === null && edited.k.includes('Boil'), 'Owner edits steps and ingredients on a live recipe: saved, no longer marked auto, bookmark untouched');
const ingNow = db.prepare('SELECT raw_text, quantity, unit, ingredient_key FROM kp_recipe_ingredients WHERE recipe_id=? ORDER BY position').all(goodId);
ok(ingNow.length === 3 && ingNow[0].quantity === 2 && ingNow[0].unit === 'cup', 'Edited ingredient lines are re-parsed (quantity and unit) and the score recomputed');
db.prepare("UPDATE kp_recipes SET instructions_json = '[]' WHERE id = ?").run(goodId);      // an author who gave no steps: our own are used
const pubIng = await (await handleRecipesApi(new Request('https://w/api/kp/recipes/' + goodId), env, ctx)).json();
ok(pubIng.ingredients[0].raw_text === '2 cups basmati rice' && pubIng.method[0].text.startsWith('Boil'), 'Parents see the edited ingredients and steps');
await reviewRecipe(env, goodId, { action: 'pending' });
const pulled = db.prepare('SELECT review_status s, hold_reasons_json h FROM kp_recipes WHERE id=?').get(goodId);
await autoPublishPending(env, { limit: 100 }); await maybeAutoPublish(env, goodId);
ok(pulled.s === 'pending' && pulled.h.includes('pulled back') && db.prepare('SELECT review_status s FROM kp_recipes WHERE id=?').get(goodId).s === 'pending', 'Pulled back recipes come off the parents pages and are never republished automatically');
const gone = await handleRecipesApi(new Request('https://w/api/kp/recipes/' + goodId), env, ctx);
ok(gone.status === 404, 'A pulled-back recipe is no longer served to parents');

// owner-edited ingredient lines survive a re-crawl of the page
const crawlUrl = 'https://site.in/edit-test/';
pages[crawlUrl] = jsonld;
db.prepare("INSERT INTO kp_recipe_candidates (id, source_id, url, discovered_via) VALUES (801, 1, ?, 'test')").run(crawlUrl);
await processCandidate(env, { id: 801, url: crawlUrl }, { id: 1, url: 'https://site.in/', notes: '' });
const crawled = db.prepare('SELECT id FROM kp_recipes WHERE source_url=?').get(crawlUrl);
ok(!!crawled, 'Test page was read into a recipe');
await reviewRecipe(env, crawled.id, { action: 'pending', ingredients: ['1 handful of special mix'] });
db.prepare("UPDATE kp_recipe_candidates SET status='pending' WHERE id=801").run();
await processCandidate(env, { id: 801, url: crawlUrl }, { id: 1, url: 'https://site.in/', notes: '' });
const afterCrawl = db.prepare('SELECT raw_text FROM kp_recipe_ingredients WHERE recipe_id=?').all(crawled.id);
ok(afterCrawl.length === 1 && afterCrawl[0].raw_text === '1 handful of special mix', 'Ingredient lines the owner edited survive the site being read again');

// ---- diet: Non-veg search shows only egg / non-veg dishes; tagging reads the whole ingredient text ----
import { tagRecipe, detectDiet } from '../../src/recipes/tag.js';
const dietOf = (name, lines) => tagRecipe({ name, ingredients: lines.map(parseIngredientLine) }).diet;
ok(dietOf('Tasty Dahi Chicken Recipe', ['1/2 kgboneless chicken (cut as per your choice),2 onions', '1 cup curd']) === 'nonveg', 'Chicken hidden on a crammed ingredient line is still found (was tagged Jain)');
ok(dietOf('Khada Masala Gosht', ['500 g gosht', '2 onions']) === 'nonveg' && dietOf('Chicken Biryani', ['500 g murgi', '1 cup rice']) === 'nonveg' && dietOf('Fish Curry', ['500 g rohu', '1 onion']) === 'nonveg', 'Regional names (gosht, murgi, rohu) count as non-veg');
ok(['Pork Sausage Rolls|4 pork sausages', 'Prawn Curry|250 g shrimp', 'Lamb Keema|300 g lamb mince', 'Crab Cakes|200 g crab meat', 'Tuna Sandwich|1 can tuna', 'Beef Stew|500 g beef'].every((x) => { const [n, l] = x.split('|'); return dietOf(n, [l]) === 'nonveg'; }), 'Pork, shrimp, lamb, crab, tuna and beef are non-veg');
ok(dietOf('Egg Biryani', ['4 eggs', '1 cup rice']) === 'egg' && dietOf('Egg Roll', ['2 eggs', 'maida']) === 'egg', 'Egg dishes are tagged egg');
ok(dietOf('Eggless Chocolate Cake', ['1 cup maida', '1 cup eggless mayonnaise']) !== 'egg' && dietOf('Egg-free Pancakes', ['1 cup flour', '1 cup milk']) !== 'egg' && dietOf('Baingan Bharta', ['2 eggplant', '1 onion']) !== 'egg', 'Eggless, egg-free and eggplant are not egg');
ok(['nonveg', 'egg'].every((d) => dietOf('Soya Chunks Biryani', ['1 cup soya chunks', '1 cup rice', 'vegetarian chicken masala']) !== d) && dietOf('Flavour Noodles', ['1 tsp chicken flavour masala', 'noodles']) !== 'nonveg', 'Soya / vegetarian "chicken" and chicken flavouring are not non-veg');
const mayoTags = (name, lines) => tagRecipe({ name, ingredients: lines.map(parseIngredientLine) });
ok(mayoTags('Focaccia Sandwich', ['1/2 cup Mayonnaise', '2 slices bread']).mayoFlex === true && mayoTags('Focaccia Sandwich', ['1/2 cup Mayonnaise', '2 slices bread']).diet !== 'egg', 'Mayonnaise keeps the recipe vegetarian and flags it as flexible (no longer forced to egg)');
ok(mayoTags('Avocado Sandwich', ['2 tablespoons cream cheese (or mayonnaise)', 'bread']).mayoFlex === false && mayoTags('Eggless Cake', ['1 cup eggless mayonnaise', 'maida']).mayoFlex === false && mayoTags('Egg Sandwich', ['2 eggs', '1 tbsp mayonnaise']).diet === 'egg', 'An "or mayonnaise" alternative or eggless mayonnaise is not flexible; real egg still makes it an egg dish');
ok(buildRecipe({ name: 'Mayo Wrap', ingredients: ['1/2 cup mayonnaise', 'wrap'], instructions: [], completeness: 'complete', method: 'jsonld', source_url: 'https://x.in/mayo/' }, { url: 'https://x.in/', notes: '', status: 'registered' }).tags.mayoFlex === true, 'The recipe build carries the mayonnaise flag through to storage');

const mkDiet = (url, diet) => { const id = mkRecipe(url, { status: 'approved' }); db.prepare('UPDATE kp_recipes SET diet=? WHERE id=?').run(diet, id); return id; };
const dVeg = mkDiet('https://site.in/d-veg/', 'veg'), dJain = mkDiet('https://site.in/d-jain/', 'jain'), dEgg = mkDiet('https://site.in/d-egg/', 'egg'), dNon = mkDiet('https://site.in/d-non/', 'nonveg');
const ids = async (pref) => (await (await handleRecipesApi(new Request('https://w/api/kp/recipes?age_months=48&occasion=lunch&season=all&pref=' + pref + '&limit=50'), env, ctx)).json()).results.map((r) => r.id);
const nv = await ids('nonveg'), vg = await ids('veg'), jn = await ids('jain');
ok(nv.includes(dEgg) && nv.includes(dNon) && !nv.includes(dVeg) && !nv.includes(dJain), 'Non-veg search returns egg and non-veg dishes only, never vegetarian or Jain ones');
ok(vg.includes(dVeg) && vg.includes(dJain) && !vg.includes(dEgg) && !vg.includes(dNon), 'Veg search still returns veg and Jain dishes and nothing with egg or meat');
ok(jn.includes(dJain) && !jn.includes(dVeg) && !jn.includes(dEgg) && !jn.includes(dNon), 'Jain search returns Jain dishes only');

// ---- mayonnaise: appears in both searches, labelled for the preference chosen ----
import { mayoFor } from '../../src/recipes/api.js';
const mayoId = mkRecipe('https://site.in/mayo-sandwich/', { status: 'approved' });
db.prepare("UPDATE kp_recipes SET instructions_json = '[]' WHERE id = ?").run(mayoId);
db.prepare("UPDATE kp_recipes SET mayo_flex = 1, diet = 'veg', kp_steps_json = ? WHERE id = ?").run(JSON.stringify(['Spread the Mayonnaise on the bread.', 'Serve.']), mayoId);
db.prepare("INSERT INTO kp_recipe_ingredients (recipe_id, position, raw_text, quantity, unit, name, ingredient_key, is_pantry) VALUES (?, 9, '1/2 cup Mayonnaise', 0.5, 'cup', 'Mayonnaise', NULL, 0)").run(mayoId);
const nvIds = await ids('nonveg'), vgIds = await ids('veg'), jnIds = await ids('jain');
ok(nvIds.includes(mayoId) && vgIds.includes(mayoId) && !jnIds.includes(mayoId), 'A mayonnaise recipe shows in both the Veg and the Non-veg search (not Jain unless tagged Jain)');
const mayoRows = (await (await handleRecipesApi(new Request('https://w/api/kp/recipes?age_months=48&occasion=lunch&season=all&pref=nonveg&limit=50'), env, ctx)).json()).results;
ok(mayoRows.find((x) => x.id === mayoId)?.mayo_flex === 1 && mayoRows.filter((x) => x.mayo_flex !== 1).every((x) => x.diet !== 'veg' && x.diet !== 'jain'), 'Non-veg results mark the mayonnaise recipe (so the page can label it "With mayonnaise") and contain no other veg or Jain dish');
const detail = async (q) => (await (await handleRecipesApi(new Request('https://w/api/kp/recipes/' + mayoId + q), env, ctx)).json());
const dVegView = await detail('?pref=veg'), dNonView = await detail('?pref=nonveg'), dPlain = await detail('');
const mayoLine = (d) => d.ingredients.find((i) => /mayonnaise/i.test(i.raw_text)).raw_text;
ok(mayoLine(dVegView) === '1/2 cup eggless mayonnaise' && dVegView.method[0].text === 'Spread the eggless mayonnaise on the bread.', 'Veg view: the mayonnaise reads "eggless mayonnaise" in the ingredients and the steps');
ok(mayoLine(dNonView) === '1/2 cup Mayonnaise' && dNonView.method[0].text.includes('Mayonnaise') && /regular mayonnaise/.test(dNonView.mayo_note), 'Non-veg view: it stays "Mayonnaise"');
ok(mayoLine(dPlain) === '1/2 cup Mayonnaise' && /eggless mayonnaise for a vegetarian meal/.test(dPlain.mayo_note), 'Opened without a preference: unchanged, with a note about choosing eggless for a vegetarian meal');
ok(mayoFor('Spread the Mayonnaise') === 'Spread the eggless mayonnaise' && mayoFor('Mayonnaise') === 'Eggless mayonnaise' && mayoFor('Vegan Mayonnaise') === 'Vegan Mayonnaise', 'The wording swap capitalises only at a sentence start and leaves eggless / vegan mayonnaise alone');
const plainId = mkDiet('https://site.in/d-plain-veg/', 'veg');
ok(!(await ids('nonveg')).includes(plainId), 'A plain vegetarian recipe (no mayonnaise) still stays out of the Non-veg search');

// ---- photos of the whole dish: this dish's finished + step photos only, never other recipes' thumbnails ----
import { collectImages } from '../../src/recipes/images.js';
const U = 'https://blog.in/wp-content/uploads/2017/03/';
const pageHtml = `<html><head><meta property="og:image" content="${U}hero.jpg"></head><body>
<header><img src="https://blog.in/wp-content/uploads/2021/10/logo-mobile.png"></header>
<div class="entry-content">
  <img src="data:image/svg+xml,%3Csvg%3E" data-lazy-src="${U}hero.jpg" width="640">
  <img src="${U}step-1.jpg" width="500"><img src="${U}step-2.jpg" width="500">
  <img data-src="${U}step-3.jpg" srcset="${U}step-3-300x200.jpg 300w, ${U}step-3.jpg 800w" width="500">
  <img src="${U}step-1.jpg" width="500">
  <img src="https://i.ytimg.com/vi/abc/hqdefault.jpg" width="480">
  <img src="${U}tiny-icon.jpg" width="70">
  <img src="${U}step-4-360x480.jpg" width="360">
  <div class="jp-relatedposts"><img src="https://blog.in/wp-content/uploads/2015/08/other-dish-360x480.jpg" width="360"></div>
</div>
<div class="sidebar"><img src="${U}sidebar-thing.jpg" width="500"></div></body></html>`;
// a "related recipes" list in the MIDDLE of the article must not hide the step photos that come after it
const midRelated = pageHtml.replace(`<img src="${U}step-2.jpg" width="500">`, `<ul class="wp-block-yoast-seo-related-links"><li><a href="/other/">Other</a></li></ul><img src="${U}step-2.jpg" width="500">`);
if (midRelated === pageHtml) throw new Error('test fixture did not change');
const found = collectImages(pageHtml, 'https://blog.in/spicy-dish/', [U + 'hero-500x427.jpg', U + 'hero.jpg', U + 'hero-480x270.jpg']);
ok(found[0] === U + 'hero.jpg', 'The hero is the uncropped photo, not a size-cropped copy');
ok(found.join('|') === [U + 'hero.jpg', U + 'step-1.jpg', U + 'step-2.jpg', U + 'step-3.jpg'].join('|'), 'Step photos of the same dish are collected once each, in page order: ' + found.map((x) => x.split('/').pop()).join(', '));
ok(!found.some((u) => /logo|hqdefault|tiny-icon|360x480|other-dish|sidebar/.test(u)), 'Logos, video thumbnails, tiny icons, cropped thumbnails, other dishes and sidebar images are left out');
ok(collectImages(midRelated, 'https://blog.in/spicy-dish/', [U + 'hero.jpg']).includes(U + 'step-3.jpg'), 'Step photos after a mid-article related-recipes block are still collected');
ok(collectImages('<html><body>no body markers <img src="https://x.in/a.jpg"></body></html>', 'https://x.in/p/', ['https://x.in/hero.jpg']).join() === 'https://x.in/hero.jpg', 'A page with no clear post body gives just the hero');
ok(collectImages('<html></html>', 'https://x.in/', []).length === 0, 'No photo at all gives an empty list');

const gId = mkRecipe('https://site.in/gallery-dish/', { status: 'approved' });
db.prepare('UPDATE kp_recipes SET image_url = ?, images_json = ? WHERE id = ?').run(U + 'hero.jpg', JSON.stringify(found), gId);
const gDetail = await (await handleRecipesApi(new Request('https://w/api/kp/recipes/' + gId), env, ctx)).json();
ok(gDetail.images.length === 4 && gDetail.images[0] === gDetail.image_url, 'The recipe API returns every photo of the dish, hero first');
await updateSource(env, 1, { photos_hidden: true });
const gHidden = await (await handleRecipesApi(new Request('https://w/api/kp/recipes/' + gId), env, ctx)).json();
await updateSource(env, 1, { photos_hidden: false });
ok(gHidden.images.length === 0 && gHidden.image_url === null, "Hiding a site's photos hides the whole gallery too");

// ---- sharpest photo first: width read from file headers, hero = sharpest, sharp-photo recipes lead the menu ----
import { sizeOf, rankImages } from '../../src/recipes/imgsize.js';
const png = new Uint8Array(32); png.set([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10], 0); png.set([0, 0, 0x03, 0x20], 16); png.set([0, 0, 0x02, 0x58], 20);
ok(sizeOf(png)?.w === 800 && sizeOf(png)?.h === 600, 'PNG width/height are read from the header');
const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 1, 0x2c, 2, 0x80, 3, 0, 0]);   // 640 x 300
ok(sizeOf(jpg)?.w === 640 && sizeOf(jpg)?.h === 300, 'JPEG width/height are read past other segments');
ok(sizeOf(new Uint8Array([1, 2, 3, 4, 5])) === null, 'Unknown bytes give no size');
const widths = { 'a.jpg': 109, 'b.jpg': 640, 'c.jpg': 700, 'd.jpg': 1400 };
const fakeProbe = async (u) => widths[u.split('/').pop()] || 0;
const rk1 = await rankImages(['https://x/a.jpg', 'https://x/b.jpg', 'https://x/c.jpg'], { probe: fakeProbe });
ok(rk1.images[0].endsWith('b.jpg') && rk1.width === 640, 'A thumbnail hero is replaced by the sharper photo (700 vs 640 is not 1.25x, so 640 stays)');
const rk2 = await rankImages(['https://x/b.jpg', 'https://x/d.jpg'], { probe: fakeProbe });
ok(rk2.images[0].endsWith('d.jpg') && rk2.width === 1400 && rk2.images.length === 2, 'A clearly sharper photo (1400 vs 640) becomes the hero and nothing is dropped');
const rk3 = await rankImages(['https://x/b.jpg', 'https://x/c.jpg'], { probe: fakeProbe });
ok(rk3.images[0].endsWith('b.jpg'), 'A slightly sharper step photo does not displace the finished-dish photo');
const rk4 = await rankImages(['https://x/zz.jpg'], { probe: fakeProbe });
ok(rk4.width === 0 && rk4.images.length === 1, 'An unmeasurable photo is kept, with width 0');

const sharpId = mkRecipe('https://site.in/sharp-dish/', { status: 'approved' });
const blurId = mkRecipe('https://site.in/blur-dish/', { status: 'approved' });
db.prepare('UPDATE kp_recipes SET image_w = 800, poshan_score = 40, score_status = ? WHERE id = ?').run('estimated', sharpId);
db.prepare('UPDATE kp_recipes SET image_w = 109, poshan_score = 95, score_status = ? WHERE id = ?').run('estimated', blurId);
const sharpRes = await (await handleRecipesApi(new Request('https://w/api/kp/recipes?age_months=60&occasion=lunch&pref=veg&limit=50'), env, ctx)).json();
const sharpIds = sharpRes.results.map((x) => x.id);
ok(sharpIds.includes(sharpId) && sharpIds.includes(blurId) && sharpIds.indexOf(blurId) < sharpIds.indexOf(sharpId), 'Menus are always in descending Poshan Score order: the higher score comes first even when its photo is tiny');
db.prepare('UPDATE kp_recipes SET poshan_score = 70 WHERE id IN (?, ?)').run(sharpId, blurId);
const tieIds = (await (await handleRecipesApi(new Request('https://w/api/kp/recipes?age_months=60&occasion=lunch&pref=veg&limit=50'), env, ctx)).json()).results.map((x) => x.id);
ok(tieIds.indexOf(sharpId) < tieIds.indexOf(blurId), 'With the same score, the recipe with the sharper photo comes first');

// ---- visitors: mobile + OTP login, ratings, remarks, support payment, author outreach ----
import { normaliseMobile, joinVisitor, listVisitors, userFromRequest, rateRecipe, ratingFor, addRemark, approvedRemarks, listRemarks, reviewRemark, payConfig, claimPayment, listPayments, reviewPayment, setName, UserError } from '../../src/recipes/social.js';
import { buildMessage, rawEmail, classifyReply, setContactEmail, sendOutreach, checkReplies, listOutreach, markOutreach, previewMessage } from '../../src/recipes/outreach.js';
const throwsMsg = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };

ok(normaliseMobile('+91 98765 43210') === '9876543210' && normaliseMobile('09876543210') === '9876543210' && normaliseMobile('919876543210') === '9876543210', 'Mobile numbers are accepted with +91, 0 or 91 in front');
ok(!!(await throwsMsg(() => normaliseMobile('12345'))) && !!(await throwsMsg(() => normaliseMobile('5876543210'))), 'Short numbers and numbers not starting 6-9 are refused');

ok(/name/i.test(await throwsMsg(() => joinVisitor(env, { name: ' ', mobile: '9876543210', email: 'a@b.in' }))), 'A name is required');
ok(/10-digit/.test(await throwsMsg(() => joinVisitor(env, { name: 'Asha', mobile: '123', email: 'a@b.in' }))), 'A bad mobile number is refused');
const v_sess = await joinVisitor(env, { name: ' Asha  K ', mobile: '+91 98765 43210', email: 'a@b.in' });
ok(v_sess.token && v_sess.name === 'Asha K', 'Name and mobile give a session token, with the name tidied');
const visitor = await userFromRequest(new Request('https://w/', { headers: { authorization: 'Bearer ' + v_sess.token } }), env);
ok(visitor && visitor.mobile === '9876543210' && visitor.name === 'Asha K', 'The session token identifies the visitor by name and number');
ok(await userFromRequest(new Request('https://w/', { headers: { authorization: 'Bearer nope' } }), env) === null && await userFromRequest(new Request('https://w/'), env) === null, 'No or a wrong token means not logged in');
const again = await joinVisitor(env, { name: 'Asha', mobile: '9876543210', email: 'a@b.in' });
ok(db.prepare('SELECT count(*) n FROM kp_visitors').get().n === 1 && again.token !== v_sess.token, 'The same number gives the same visitor back, with a new session');
ok(db.prepare('SELECT count(*) n FROM users').get().n === 0, "Visitors never touch the main app's accounts");
for (let i = 0; i < 8; i++) await joinVisitor(env, { name: 'Asha', mobile: '9876543210', email: 'a@b.in' });
ok(/Too many tries/.test(await throwsMsg(() => joinVisitor(env, { name: 'Asha', mobile: '9876543210', email: 'a@b.in' }))), 'One number cannot create more than 10 sessions an hour');
const joinHttp = await routeRecipes(new Request('https://w/api/kp/auth/join', { method: 'POST', headers: { origin: 'https://www.kidposhan.in' }, body: JSON.stringify({ name: 'Ravi', mobile: '9811111111', email: 'Ravi@Example.com' }) }), env, ctx);
const joinBody = await joinHttp.json();
ok(joinHttp.status === 200 && joinBody.token && joinHttp.headers.get('access-control-allow-origin') === 'https://www.kidposhan.in', 'Joining over HTTP works and answers CORS for kidposhan.in');
const meHttp = await routeRecipes(new Request('https://w/api/kp/auth/me', { headers: { authorization: 'Bearer ' + joinBody.token } }), env, ctx);
ok((await meHttp.json()).name === 'Ravi', 'The me endpoint returns the visitor name');
ok((await routeRecipes(new Request('https://w/api/kp/auth/otp', { method: 'POST', body: '{}' }), env, ctx)).status === 404, 'The old OTP endpoint is gone');

const rrId = mkRecipe('https://site.in/v_rated-dish/', { status: 'approved' });
const hiddenId = mkRecipe('https://site.in/not-live/', { status: 'pending' });
ok(/Choose 1 to 5/.test(await throwsMsg(() => rateRecipe(env, visitor, rrId, 9))), 'Stars outside 1-5 are refused');
ok(/not available/.test(await throwsMsg(() => rateRecipe(env, visitor, hiddenId, 5))), 'A recipe that is not live cannot be rated');
await rateRecipe(env, visitor, rrId, 5);
const v2 = await userFromRequest(new Request('https://w/', { headers: { authorization: 'Bearer ' + joinBody.token } }), env);
const after2 = await rateRecipe(env, v2, rrId, 3);
ok(after2.count === 2 && after2.average === 4 && after2.liked === 1 && after2.mine === 3, 'Two ratings give average 4.0, 2 raters, 1 who liked it (4-5 stars)');
const v_changed = await rateRecipe(env, v2, rrId, 4);
ok(v_changed.count === 2 && v_changed.average === 4.5 && v_changed.liked === 2, 'Rating again replaces the earlier rating instead of adding one');
const v_list = await (await handleRecipesApi(new Request('https://w/api/kp/recipes?age_months=60&occasion=lunch&pref=veg&limit=50'), env, ctx)).json();
const v_rated = v_list.results.find((x) => x.id === rrId);
ok(v_rated && v_rated.rating_avg === 4.5 && v_rated.rating_count === 2 && v_rated.liked_count === 2, 'Search results carry the average stars, number of raters and number who liked it');

await setName(env, visitor, 'Asha');
const asha = { ...visitor, name: 'Asha' };
const rm = await addRemark(env, asha, rrId, 'My toddler <b>loved</b> this');
ok(rm.received && (await approvedRemarks(env, rrId)).length === 0, 'A new remark is received but NOT public');
const v_pend = await listRemarks(env, { status: 'pending' });
ok(v_pend.remarks.length === 1 && v_pend.remarks[0].mobile_tail === '3210' && !/[<>]/.test(v_pend.remarks[0].body), 'The admin sees it pending, with the last 4 digits only, and markup stripped');
const socialPending = await (await routeRecipes(new Request('https://w/api/kp/recipes/' + rrId + '/social'), env, ctx)).json();
ok(socialPending.remarks.length === 0 && socialPending.rating.count === 2, 'The public endpoint hides pending remarks and shows the rating');
await reviewRemark(env, v_pend.remarks[0].id, { action: 'edit', body: 'My toddler loved this' });
await reviewRemark(env, v_pend.remarks[0].id, { action: 'approve' });
const v_pub = await approvedRemarks(env, rrId);
ok(v_pub.length === 1 && v_pub[0].name === 'Asha' && v_pub[0].body === 'My toddler loved this' && v_pub[0].mobile === undefined && v_pub[0].mobile_tail === undefined, 'After approval the edited remark is public with the name only');
await addRemark(env, asha, rrId, 'second one'); await reviewRemark(env, (await listRemarks(env)).remarks[0].id, { action: 'reject' });
ok((await approvedRemarks(env, rrId)).length === 1, 'A rejected remark never appears');

const noAuth = await routeRecipes(new Request('https://w/api/kp/recipes/' + rrId + '/rate', { method: 'POST', body: '{"stars":5}' }), env, ctx);
ok(noAuth.status === 401, 'Rating without logging in answers 401');
const viaHttp = await routeRecipes(new Request('https://w/api/kp/recipes/' + rrId + '/rate', { method: 'POST', headers: { authorization: 'Bearer ' + v_sess.token, origin: 'https://www.kidposhan.in' }, body: '{"stars":2}' }), env, ctx);
ok(viaHttp.status === 200 && viaHttp.headers.get('access-control-allow-origin') === 'https://www.kidposhan.in', 'A logged-in rating over HTTP works and answers CORS for kidposhan.in');
const pre = await routeRecipes(new Request('https://w/api/kp/recipes/' + rrId + '/rate', { method: 'OPTIONS', headers: { origin: 'https://www.kidposhan.in' } }), env, ctx);
ok(pre.status === 204 && /authorization/i.test(pre.headers.get('access-control-allow-headers')), 'The CORS preflight allows the Authorization header for kidposhan.in');
const preBad = await routeRecipes(new Request('https://w/api/kp/recipes/' + rrId + '/rate', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }), env, ctx);
ok(preBad.status === 403, 'A preflight from another site is refused');
const adminNoTok = await routeRecipes(new Request('https://w/api/kp/admin/remarks'), { ...env, ADMIN_TOKEN: 't' }, ctx);
ok(adminNoTok.status === 401, 'Remark moderation needs the admin token');

ok(payConfig({}).ready === false && payConfig({ UPI_ID: 'bad id' }).ready === false, 'Support payment is off until a valid UPI id is set');
const v_pc = payConfig({ UPI_ID: 'kidposhan@okhdfcbank', UPI_PAYEE_NAME: 'KidPoshan' }, 7);
ok(v_pc.ready && v_pc.amount_rupees === 5 && /^upi:\/\/pay\?/.test(v_pc.link) && /am=5\.00/.test(v_pc.link) && /pa=kidposhan%40okhdfcbank/.test(v_pc.link) && /cu=INR/.test(v_pc.link), 'The UPI link asks for exactly Rs 5.00 to the configured id');
const v_cl = await claimPayment(env, asha, rrId, 'UTR 123456789012');
ok(v_cl.received && (await listPayments(env)).payments.length === 1, 'A claimed payment is recorded for the admin');
await reviewPayment(env, v_cl.id, { action: 'confirm' });
const v_tot = await listPayments(env, { status: 'confirmed' });
ok(v_tot.payments.length === 1 && v_tot.totals.confirmed.rupees === 5, 'The admin confirms it and the total shows Rs 5');

// ---- outreach ----
const sid = db.prepare("INSERT INTO kp_recipe_sources (name, url, area, active) VALUES ('Spice Blog','https://spice.in','India',1) RETURNING id").get().id;
const sid2 = db.prepare("INSERT INTO kp_recipe_sources (name, url, area, active) VALUES ('Spice Twin','https://twin.in','India',1) RETURNING id").get().id;
const orId = mkRecipe('https://spice.in/dal/', { status: 'approved', name: 'Dal Tadka | Spice Blog' });
db.prepare('UPDATE kp_recipes SET source_id = ? WHERE id = ?').run(sid, orId);
ok(!!(await throwsMsg(() => setContactEmail(env, sid, 'not-an-email'))), 'A bad email address is refused');
await setContactEmail(env, sid, ' Owner@Spice.IN '); await setContactEmail(env, sid2, 'owner@spice.in');
const v_msg = buildMessage({}, { name: 'Spice Blog' }, ['Dal Tadka']);
ok(/with your permission/.test(v_msg.text) && /not a selling site/.test(v_msg.text) && /share a portion/.test(v_msg.text) && /YES/.test(v_msg.text) && /NO/.test(v_msg.text) && /Dal Tadka/.test(v_msg.text), 'The email asks permission, says it is not a selling site, promises a share, and asks for YES or NO');
ok(/Spice Blog/.test((await previewMessage(env, sid)).subject), 'The preview shows the subject for that site');
const mime = rawEmail('me@gmail.com', 'owner@spice.in', 'Permission – Spice', 'Hello दाल');
ok(/^From: me@gmail.com/m.test(mime) && /^To: owner@spice.in/m.test(mime) && /Subject: =\?UTF-8\?B\?/.test(mime) && /Content-Transfer-Encoding: base64/.test(mime), 'The raw email has the right headers and encodes the subject and body safely');
const sends = []; const fakeSend = async (e, to, sub, text) => { sends.push(to); return { threadId: 'T-' + to }; };
const sr = await sendOutreach(env, [sid, sid2], { send: fakeSend });
ok(sends.length === 1 && sr[0].sent && sr[1].skipped === 'already emailed', 'One email goes out per address; a second source with the same address is skipped');
const sr2 = await sendOutreach(env, [sid], { send: fakeSend });
ok(sends.length === 1 && sr2[0].skipped === 'already emailed', 'A site is never emailed twice');
const noMail = db.prepare("INSERT INTO kp_recipe_sources (name, url, area, active) VALUES ('NoMail','https://nomail.in','India',1) RETURNING id").get().id;
ok((await sendOutreach(env, [noMail], { send: fakeSend }))[0].skipped === 'no email address', 'A site with no email address is skipped');
ok(/not connected/.test(await throwsMsg(() => checkReplies(env, { fetchFn: async () => ({}) }))), 'Reply checking says Gmail is not connected when the secrets are missing');
const gEnv = { ...env, GMAIL_CLIENT_ID: 'c', GMAIL_CLIENT_SECRET: 's', GMAIL_REFRESH_TOKEN: 'r', GMAIL_SENDER: 'me@gmail.com' };
const fakeFetch = async (u) => String(u).includes('oauth2') ? { ok: true, json: async () => ({ access_token: 'tok' }) }
  : { ok: true, json: async () => ({ messages: [{ internalDate: '1000000', snippet: 'Hello', payload: { headers: [{ name: 'From', value: 'Me <me@gmail.com>' }] } }, { internalDate: '2000000', snippet: 'Yes, you can use my recipes. Happy to help!', payload: { headers: [{ name: 'From', value: 'Owner <owner@spice.in>' }] } }] }) };
const v_rep = await checkReplies(gEnv, { fetchFn: fakeFetch });
ok(v_rep.length === 1 && v_rep[0].status === 'replied_yes', 'A reply saying yes is tracked as replied_yes');
const v_lst = await listOutreach(env);
const v_row = v_lst.sources.find((x) => x.id === sid);
ok(v_row.status === 'replied_yes' && /Happy to help/.test(v_row.reply_snippet) && v_row.replied_at === 2000, 'The listing shows who replied, how, and what they said');
ok(v_lst.sources.find((x) => x.id === noMail) === undefined || ['no_email','not_sent'].includes(v_lst.sources.find((x) => x.id === noMail).status), 'Sites never emailed show as not v_sent / no email');
ok(classifyReply('No, please remove my recipes') === 'replied_no' && classifyReply('Sure, go ahead') === 'replied_yes' && classifyReply('Who are you?') === 'replied_other' && classifyReply('Yes but do not use my photos') === 'replied_other', 'Reply wording is classified as yes / no / other, and mixed answers are left for the owner');
const v_decline = await markOutreach(env, sid, { status: 'replied_no', note: 'asked to remove', remove: true });
ok(v_decline.removed === 1 && db.prepare('SELECT review_status FROM kp_recipes WHERE id = ?').get(orId).review_status === 'rejected' && db.prepare('SELECT photos_hidden FROM kp_recipe_sources WHERE id = ?').get(sid).photos_hidden === 1, 'When the owner confirms a NO with remove, that site\'s live recipes come down and its photos are hidden');
const v_keep = await markOutreach(env, sid, { status: 'replied_yes' });
ok(v_keep.removed === 0, 'Marking yes removes nothing');

// ---- Tavily: every search is counted and a daily cap protects the free quota ----
import { spendTavily, tavilySearchRaw, tavilyUsage, dailyCap, DEFAULT_DAILY_CAP } from '../../src/recipes/tavily.js';
ok(dailyCap({}) === DEFAULT_DAILY_CAP && dailyCap({ TAVILY_DAILY_CAP: '8' }) === 8 && dailyCap({ TAVILY_DAILY_CAP: 'abc' }) === DEFAULT_DAILY_CAP, 'The daily cap defaults to 25 and can be set with TAVILY_DAILY_CAP');
db.prepare('DELETE FROM kp_tavily_calls').run();   // earlier tests also spent searches today
const tEnv = { ...env, TAVILY_API_KEY: 'k', TAVILY_DAILY_CAP: '3' };
let tCalls = 0; const tFetch = async (u, o) => { tCalls++; return { ok: true, json: async () => ({ results: [{ url: 'https://a.in/x' }] }) }; };
const tr1 = await tavilySearchRaw(tEnv, { query: 'a' }, tFetch); await tavilySearchRaw(tEnv, { query: 'b' }, tFetch); await tavilySearchRaw(tEnv, { query: 'c' }, tFetch);
ok(tr1.length === 1 && tCalls === 3, 'Searches under the cap go through and return results');
let tCap = null; try { await tavilySearchRaw(tEnv, { query: 'd' }, tFetch); } catch (e) { tCap = e; }
ok(tCap && tCap.code === 'tavily_cap' && tCalls === 3, 'The 4th search of the day is refused before Tavily is called, so it costs no credit');
const tUse = await tavilyUsage(tEnv, async () => ({ ok: true, json: async () => ({ account: { current_plan: 'Researcher', plan_usage: 88, plan_limit: 1000 } }) }));
ok(tUse.used_today === 3 && tUse.cap_per_day === 3 && tUse.account.used === 88 && tUse.account.limit === 1000 && tUse.account.plan === 'Researcher', 'Usage shows our count for today and the account usage from Tavily');
const tUse2 = await tavilyUsage(tEnv, async () => ({ ok: false, status: 401 }));
ok(tUse2.account === null && /401/.test(tUse2.account_error), 'If Tavily will not give account usage, our own count still shows');
ok((await tavilyUsage({ DB: env.DB })).configured === false, 'Without a key, usage says Tavily is not connected');
db.prepare("UPDATE kp_tavily_calls SET day = date('now','-1 day')").run();
await tavilySearchRaw(tEnv, { query: 'e' }, tFetch);
ok(tCalls === 4, 'The count starts again the next day');
const tAdmin = await routeRecipes(new Request('https://w/api/kp/admin/tavily', { headers: { 'x-admin-token': 't' } }), { ...tEnv, ADMIN_TOKEN: 't' }, ctx);
const tBody = await tAdmin.json();
ok(tAdmin.status === 200 && tBody.used_today === 1 && tBody.cap_per_day === 3, 'The admin endpoint reports the usage');
ok((await routeRecipes(new Request('https://w/api/kp/admin/tavily'), { ...tEnv, ADMIN_TOKEN: 't' }, ctx)).status === 401, 'The admin endpoint needs the admin token');

// ---- email on the join form, the admin list of people, and the visitor count ----
import { recordVisit, visitCount } from '../../src/recipes/visits.js';
ok(!!(await joinVisitor(env, { name: 'Asha', mobile: '9822222222', email: 'nope' })).token && !!(await joinVisitor(env, { name: 'Asha', mobile: '9822222222' })).token, 'No email is needed: a missing or malformed one is ignored, not refused');
const ravi = db.prepare("SELECT name, mobile, email FROM kp_visitors WHERE mobile = '9811111111'").get();
ok(ravi && ravi.email === 'ravi@example.com' && ravi.name === 'Ravi', 'The email is stored tidied (lower case)');
const people = await listVisitors(env);
ok(people.total === 3 && people.visitors.some((v) => v.email === 'ravi@example.com' && v.ratings >= 0 && v.remarks >= 0), 'The admin list shows who joined, with email and how much they took part');
ok((await routeRecipes(new Request('https://w/api/kp/admin/visitors'), { ...env, ADMIN_TOKEN: 't' }, ctx)).status === 401 && (await (await routeRecipes(new Request('https://w/api/kp/admin/visitors', { headers: { 'x-admin-token': 't' } }), { ...env, ADMIN_TOKEN: 't' }, ctx)).json()).total === 3, 'The visitor list needs the admin token');

const vc0 = await visitCount(env);
const vc1 = await recordVisit(env, 'abcdef0123456789abcd', 'Mozilla/5.0 (iPhone)');
const vc2 = await recordVisit(env, 'abcdef0123456789abcd', 'Mozilla/5.0 (iPhone)');
ok(vc1 === vc0 + 1 && vc2 === vc1, 'A browser is counted once, however many pages it opens');
ok(await recordVisit(env, 'zzzzzzzzzzzzzzzzzzzz1', 'Mozilla/5.0') === vc1 + 1, 'A different browser adds one');
const vcBefore = await visitCount(env);
await recordVisit(env, 'botbotbotbotbotbotbot', 'Mozilla/5.0 (compatible; Googlebot/2.1)'); await recordVisit(env, 'bad id!', 'Mozilla/5.0'); await recordVisit(env, '', 'Mozilla/5.0');
ok(await visitCount(env) === vcBefore, 'Crawlers and malformed ids are not counted');
const vHttp = await routeRecipes(new Request('https://w/api/kp/visit', { method: 'POST', headers: { origin: 'https://www.kidposhan.in', 'user-agent': 'Mozilla/5.0' }, body: JSON.stringify({ vid: 'httpvisitor0123456789' }) }), env, ctx);
const vBody = await vHttp.json();
ok(vHttp.status === 200 && vBody.count === vcBefore + 1 && vHttp.headers.get('access-control-allow-origin') === 'https://www.kidposhan.in', 'The visit endpoint counts over HTTP and answers CORS for kidposhan.in');
const vGet = await (await routeRecipes(new Request('https://w/api/kp/visit'), env, ctx)).json();
ok(vGet.count === vcBefore + 1, 'A plain GET returns the count without adding anyone');
const vPre = await routeRecipes(new Request('https://w/api/kp/visit', { method: 'OPTIONS', headers: { origin: 'https://www.kidposhan.in' } }), env, ctx);
ok(vPre.status === 204, 'The visit endpoint answers the CORS preflight');

// ---- More Asian recipes / European recipes: separate shelves, same Poshan Score ordering ----
const asiaSrc = db.prepare("INSERT INTO kp_recipe_sources (name, url, area, active, world) VALUES ('Asia Site','https://asia.example','Thailand',1,'asia') RETURNING id").get().id;
const euSrc = db.prepare("INSERT INTO kp_recipe_sources (name, url, area, active, world) VALUES ('Europe Site','https://eu.example','UK',1,'europe') RETURNING id").get().id;
const mkWorld = (src, name, score, occ = 'lunch') => {
  const id = mkRecipe('https://w.example/' + name.replace(/\W/g, '') + Math.random(), { status: 'approved', name });
  db.prepare('UPDATE kp_recipes SET source_id = ?, poshan_score = ?, score_status = ? WHERE id = ?').run(src, score, 'estimated', id);
  if (occ !== 'lunch') { db.prepare('DELETE FROM kp_recipe_occasions WHERE recipe_id = ?').run(id); db.prepare('INSERT INTO kp_recipe_occasions (recipe_id, occasion) VALUES (?, ?)').run(id, occ); }
  return id;
};
const aLow = mkWorld(asiaSrc, 'Tofu Stir Fry', 55), aHigh = mkWorld(asiaSrc, 'Veg Pho', 82), aDinner = mkWorld(asiaSrc, 'Dinner Only Curry', 90, 'dinner');
const eLow = mkWorld(euSrc, 'Cheese Pasta', 48), eHigh = mkWorld(euSrc, 'Lentil Soup', 77);
const wq = (w) => handleRecipesApi(new Request('https://w/api/kp/recipes?age_months=60&occasion=lunch&pref=veg&limit=50&world=' + w), env, ctx).then((r) => r.json());
const asiaRes = await wq('asia'), euRes = await wq('europe'), inRes = await wq('india');
ok(asiaRes.results.map((x) => x.id).join() === [aHigh, aLow].join(), 'The Asian shelf lists only Asian recipes for this meal, highest Poshan Score first (no dinner-only filler): ' + asiaRes.results.map((x) => x.name));
ok(euRes.results.map((x) => x.id).join() === [eHigh, eLow].join(), 'The European shelf lists only European recipes, highest Poshan Score first');
ok(![aHigh, aLow, eHigh, eLow].some((id) => inRes.results.some((x) => x.id === id)), 'The main (Indian) list never contains Asian or European recipes');
ok(asiaRes.query.world === 'asia' && (await (await handleRecipesApi(new Request('https://w/api/kp/recipes?age_months=60&occasion=lunch&world=mars'), env, ctx)).json()).error.includes('world must be'), 'The world is reported back, and an unknown world is refused');
for (let i = 1; i < inRes.results.length; i++) if (inRes.results[i].match === inRes.results[i - 1].match && inRes.results[i].poshan_score != null && inRes.results[i - 1].poshan_score != null) { if (inRes.results[i].poshan_score > inRes.results[i - 1].poshan_score) { ok(false, 'Indian list not in descending score order within a shelf'); break; } }
const wd = await (await handleRecipesApi(new Request('https://w/api/kp/recipes/' + aHigh), env, ctx)).json();
ok(wd.world === 'asia' && wd.ingredients.every((i) => i.buy.length === 0), 'An Asian recipe reports its world and carries no Indian store links');

// ---- ingredients common in European and Southeast Asian recipes are understood and weighed ----
import { parseIngredientLine as pil } from '../../src/recipes/normalize.js';
import { gramsFor as gf } from '../../src/recipes/nutrients.js';
const key = (t) => pil(t).ingredient_key;
ok(key('200 g spaghetti') === 'pasta' && key('1 can coconut milk') === 'coconut_milk' && key('2 tbsp fish sauce') === 'fish_sauce' && key('1 block firm tofu') === 'tofu' && key('2 stalks lemongrass') === 'lemongrass', 'Pasta, coconut milk, fish sauce, tofu and lemongrass are recognised (and coconut milk is not plain milk or coconut)');
ok(key('250 g salmon fillet') === 'fish' && key('100 g cheddar cheese') === 'cheese' && key('2 tbsp olive oil') === 'oil' && key('1 cup brown rice') === 'rice' && key('200 g plain flour') === 'maida' && key('2 spring onions') === 'spring_onion' && key('1 tbsp peanut butter') === 'peanut_butter', 'Salmon, cheddar, olive oil, brown rice, plain flour, spring onions and peanut butter map to the right foods');
ok(key('1 cup rice flour') === 'rice' && key('1/2 cup ragi flour') === 'ragi' && key('1 cup wheat flour') === 'wheat_flour' && key('1 cup milk') === 'milk', 'Indian foods still map as before (rice flour, ragi flour, wheat flour, milk)');
ok(Math.round(gf(pil('8 oz pasta')).g) === 227 && Math.round(gf(pil('1 lb potatoes')).g) === 454, 'Ounces and pounds are converted to grams');
ok(pil('2 tbsp chopped parsley').is_pantry === true && pil('1 tbsp fish sauce').is_pantry === false, 'Herbs count as pantry; fish sauce does not');

// ---- at least 20 recipes per combination; a repeat search from the same device shows fresh recipes first ----
import { pickRandom, isPrepRecipe, seasonMismatch, MIN_RESULTS } from '../../src/recipes/api.js';
import { coverageReport, fillOneGap, pruneSeen } from '../../src/recipes/coverage.js';
ok(MIN_RESULTS === 20, 'The target is 20 recipes per filter combination');
const seq = (n) => { let x = 7; return () => { x = (x * 48271) % 2147483647; return x / 2147483647; }; };
const poolA = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, match: 'exact' }));
const pickA = pickRandom(poolA, new Set([1, 2, 3]), 5, seq());
ok(pickA.length === 5 && pickA.every((r) => ![1, 2, 3].includes(r.id)), 'pickRandom: recipes shown last time are skipped when enough others exist');
const pickB = pickRandom(poolA.slice(0, 6), new Set([1, 2, 3, 4]), 6, seq());
ok(pickB.length === 6 && new Set(pickB.map((r) => r.id)).size === 6 && pickB.slice(0, 2).every((r) => [5, 6].includes(r.id)), 'pickRandom: when too few are new, the seen ones come back last: ' + pickB.map((r) => r.id));
ok(pickRandom(poolA, new Set(), 5, seq()).map((r) => r.id).join() !== pickRandom(poolA, new Set(), 5, () => 0.99).map((r) => r.id).join(), 'pickRandom: a different random source gives a different set');
const pickT = pickRandom([...poolA.slice(0, 3), ...Array.from({ length: 5 }, (_, i) => ({ id: 20 + i, match: 'any_season' }))], new Set(), 5, seq());
ok(pickT.slice(0, 3).every((r) => r.match === 'exact'), 'pickRandom: the best-matching tier (in season, right meal) is used before a looser one');
ok(isPrepRecipe('Idli Dosa Batter | Homemade Idli Dosa Batter Recipe') && isPrepRecipe('Vietnamese Curry Powder (Bot Ca Ri Viet)') && !isPrepRecipe('Thai Pumpkin Soup With Red Curry Paste Recipe') && !isPrepRecipe('Masala Dosa Recipe'), 'Batters, spice powders and pastes are ingredients, not meals; a soup made with a paste is still a meal');
ok(seasonMismatch('Cold Sesame Soba', 'winter') && !seasonMismatch('Cold Sesame Soba', 'summer') && seasonMismatch('Beef Stew', 'summer') && !seasonMismatch('Dal Tadka', 'winter'), 'A cold dish is not a winter dish and a hot stew is not a summer dish');
for (let i = 0; i < 30; i++) { const id = mkRecipe('https://fresh.example/' + i, { status: 'approved', name: 'Fresh Dish ' + i }); db.prepare('UPDATE kp_recipes SET poshan_score = ?, score_status = ? WHERE id = ?').run(70 + i, 'estimated', id); }
const fq = (extra = '') => handleRecipesApi(new Request('https://w/api/kp/recipes?age_months=60&occasion=lunch&pref=veg&season=all' + extra), env, ctx);
const fresh0 = await (await fq()).json();
ok(fresh0.count === 20, 'With no limit given, a combination that has enough recipes returns 20: ' + fresh0.count);
const devId = 'device0123456789abcd';
const r1j = await (await fq('&vid=' + devId)).json(), r2j = await (await fq('&vid=' + devId)).json();
const ids1 = new Set(r1j.results.map((x) => x.id)), ids2 = r2j.results.map((x) => x.id);
ok(r1j.count === 20 && r2j.count === 20, 'Both searches return 20');
ok(ids2.filter((i) => !ids1.has(i)).length >= 10, 'The second search from the same device brings mostly recipes it has not seen: ' + ids2.filter((i) => !ids1.has(i)).length + ' new');
const asc = (arr) => arr.every((x, i) => i === 0 || x.match !== arr[i - 1].match || (x.poshan_score ?? -1) <= (arr[i - 1].poshan_score ?? -1));
ok(asc(r1j.results) && asc(r2j.results), 'Each shelf is still in descending Poshan Score order after the repeat');
const otherDev = await (await fq('&vid=otherdevice0123456789')).json();
ok(otherDev.count === 20 && otherDev.results.every((x) => x.poshan_score >= 70 && !x.capped), 'Every recipe offered scores 70 or more and is not capped');
const shuf = await (await fq('&shuffle=1&exclude=' + r1j.results.map((x) => x.id).join(','))).json();
ok(shuf.count === 20 && shuf.results.filter((x) => !ids1.has(x.id)).length >= 8, 'Shuffle draws a new set that avoids the recipes on screen: ' + shuf.results.filter((x) => !ids1.has(x.id)).length + ' new');
const hitsRowF = db.prepare("SELECT sum(times) m FROM kp_seen WHERE vid = ?").get(devId);
ok(hitsRowF.m >= 40, "Every recipe shown to a device is counted (two searches of 20 = 40 hits)");
const rnRes = await fq('&vid=' + devId); await rnRes.json();
ok(rnRes.headers.get('cache-control') === 'private, no-store' && (await fq()).headers.get('cache-control') === 'private, no-store', 'Searches are never cached, because every one is a fresh random draw');
ok((await (await fq('&vid=bad!')).json()).count === 20 && db.prepare("SELECT count(*) n FROM kp_seen WHERE vid = 'bad!'").get().n === 0, 'A malformed device id is ignored');

const covRep = await coverageReport(env, { pref: 'veg' });
ok(covRep.combinations === 100 && covRep.target === 20 && covRep.below_target >= 0 && Array.isArray(covRep.worst) && covRep.worst.every((r) => r.count < 20), 'The coverage report covers 100 combinations per preference and lists those under 20');
const covJson = await (await routeRecipes(new Request('https://w/api/kp/admin/coverage?pref=nonveg', { headers: { 'x-admin-token': 't' } }), { ...env, ADMIN_TOKEN: 't' }, ctx)).json();
ok(covJson.pref === 'nonveg' && covJson.combinations === 100, 'The admin coverage endpoint answers');
ok((await routeRecipes(new Request('https://w/api/kp/admin/coverage'), { ...env, ADMIN_TOKEN: 't' }, ctx)).status === 401, 'The coverage endpoint needs the admin token');
const gapRes = await fillOneGap({ ...env, TAVILY_API_KEY: undefined }, { sample: 40, rnd: () => 0.01 });
ok(gapRes && (gapRes.combo || gapRes.checked), 'The gapRes filler checks combinations and reports what it did');
db.prepare("UPDATE kp_seen SET last_at = 1 WHERE vid = ?").run(devId);
ok((await pruneSeen(env)).pruned > 0 && db.prepare("SELECT count(*) n FROM kp_seen WHERE vid = ?").get(devId).n === 0, 'Old "seen" rows are forgotten after 60 days');

// ---- recipe-led web search: regional cuisines, Asian and European worlds, new sites suggested in the right world ----
import { queryKey as lvKey, queryText as lvText, CUISINES as lvCuisines } from '../../src/recipes/live.js';
import { tavilyLeft as lvLeft } from '../../src/recipes/tavily.js';
const lvq = { age: 48, occasion: 'lunch', season: 'all', pref: 'veg' };
ok(lvText(lvq) === 'indian vegetarian lunch recipe for kids' && lvKey(lvq) === 'veg|lunch|all|preschool', 'A parent\'s own Indian search keeps its wording and its old key');
ok(lvText({ ...lvq, cuisine: 'assamese' }) === 'assamese vegetarian lunch recipe for kids' && !/indian/.test(lvText({ ...lvq, cuisine: 'assamese' })), 'A cuisine-led search names the cuisine and does not force "indian"');
ok(lvText({ ...lvq, cuisine: 'north east indian' }).startsWith('north east indian vegetarian'), 'North East recipes are searched for by name');
ok(lvText({ ...lvq, world: 'asia' }).startsWith('southeast asian') && lvText({ ...lvq, world: 'europe' }).startsWith('european'), 'The Asian and European searches are worded for those parts of the world');
ok(lvKey({ ...lvq, world: 'asia', cuisine: 'thai' }) === 'veg|lunch|all|preschool|c:thai|w:asia' && lvKey({ ...lvq, world: 'asia', cuisine: 'thai' }) !== lvKey({ ...lvq, world: 'asia', cuisine: 'vietnamese' }), 'Each cuisine and world has its own once-a-day search slot');
ok(lvCuisines.india.includes('assamese') && lvCuisines.india.includes('manipuri') && lvCuisines.india.includes('naga') && lvCuisines.asia.includes('thai') && lvCuisines.europe.includes('italian'), 'The rotation includes the North East states, Southeast Asian and European cuisines');

db.prepare('DELETE FROM kp_tavily_calls').run();
const lvOrig = globalThis.fetch, lvCalls = [];
globalThis.fetch = async (u, init) => {
  if (u === 'https://api.tavily.com/search') {
    const body = JSON.parse(init.body); lvCalls.push(body);
    return { ok: true, json: async () => ({ results: body.include_domains ? [] : [{ url: 'https://thaicooks.example/recipes/pad-thai-recipe/' }, { url: 'https://www.pinterest.com/pin/9/' }] }) };
  }
  return lvOrig(u, init);
};
env.TAVILY_API_KEY = 'test';
const lvRes = await discoverForQuery(env, { ...lvq, world: 'asia', cuisine: 'thai' }, { publishedCount: 0 });
globalThis.fetch = lvOrig;
ok(lvCalls.length === 2 && lvCalls[0].query === 'thai vegetarian lunch recipe for kids' && JSON.stringify(lvCalls[0].include_domains) === JSON.stringify(['asia.example']), 'The Asian search first looks only at the registered Asian sites: ' + JSON.stringify(lvCalls[0].include_domains));
const lvNew = db.prepare("SELECT status, active, world, notes FROM kp_recipe_sources WHERE url = 'https://thaicooks.example/'").get();
ok(lvNew && lvNew.status === 'suggested' && lvNew.active === 0 && lvNew.world === 'asia' && /thai vegetarian/.test(lvNew.notes), 'A new website found by the Asian search is only suggested (not crawled), filed under Asian recipes, with the search that found it');
ok(lvRes.found === 1 && !db.prepare("SELECT 1 FROM kp_recipe_sources WHERE url LIKE '%pinterest%'").get(), 'Pinterest is still ignored');
ok((await lvLeft(env)) === 23, 'Both searches were counted against the daily Tavily cap');
const lvGap = await fillOneGap({ ...env, TAVILY_DAILY_CAP: '8' }, { sample: 3, rnd: () => 0.3 });
ok(/Tavily searches/.test(lvGap.skipped || ''), 'The gap filler keeps the last Tavily searches of the day for parents');

// ---- a try-out email goes only to the owner's own Gmail ----
import { sendTest as tmSendTest } from '../../src/recipes/outreach.js';
const tmSid = db.prepare("INSERT INTO kp_recipe_sources (name, url, area, active, contact_email) VALUES ('Test Creator','https://tc.example','India',1,'creator@tc.example') RETURNING id").get().id;
const tmSent = []; const tmFake = async (e, to, sub, text) => { tmSent.push({ to, sub, text }); return { threadId: 'T' }; };
ok(/not connected/.test(await throwsMsg(() => tmSendTest({ ...env }, tmSid, { send: tmFake }))) && tmSent.length === 0, 'A test email needs Gmail to be connected first');
const tmRes = await tmSendTest({ ...env, GMAIL_SENDER: 'owner@gmail.com' }, tmSid, { send: tmFake });
ok(tmSent.length === 1 && tmSent[0].to === 'owner@gmail.com' && tmSent[0].sub.startsWith('[TEST] ') && /NOT been sent to Test Creator/.test(tmSent[0].text) && tmRes.sent_to === 'owner@gmail.com', 'The test goes to the owner\'s own address, marked TEST, and says the creator was not contacted');
ok(!tmSent.some((m) => m.to === 'creator@tc.example') && db.prepare('SELECT count(*) n FROM kp_outreach WHERE source_id = ?').get(tmSid).n === 0, 'A test never goes to the creator and is not recorded as outreach');
ok((await routeRecipes(new Request('https://w/api/kp/admin/outreach/test', { method: 'POST', body: JSON.stringify({ source_id: tmSid }) }), { ...env, ADMIN_TOKEN: 't' }, ctx)).status === 401, 'The test endpoint needs the admin token');

// ---- automatic outreach: sending, reading replies into the database (contacted, agreed, phone), finding contact addresses ----
import * as OA from '../../src/recipes/outreach.js';
const b64u = (str) => Buffer.from(str, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
ok(OA.replyText('Yes, go ahead!\nMy number is 98765 43210\n\nOn Fri, 9 Oct 2026 at 10:00, KidPoshan <me@gmail.com> wrote:\n> Please reply YES or NO\n> NO - we will take down') === 'Yes, go ahead!\nMy number is 98765 43210', 'Only what the creator wrote is read; the quoted copy of our own email (with its YES and NO) is cut away');
ok(OA.classifyReply('No problem at all, you may use my recipes') === 'replied_yes' && OA.classifyReply('I don\'t mind, happy to be featured') === 'replied_yes' && OA.classifyReply('No, please remove them') === 'replied_no' && OA.classifyReply('Who are you?') === 'replied_other', '"No problem" and "don\'t mind" count as yes; a real no is a no');
ok(OA.extractPhone('call me on +91 98765 43210 anytime') === '+919876543210' && OA.extractPhone('9876543210') === '+919876543210' && OA.extractPhone('WhatsApp +44 7700 900123') === '+447700900123' && OA.extractPhone('I posted this in 2023, order 12345') === null, 'An Indian mobile or an international number is picked out; years and short numbers are not');
ok(OA.messageText({ mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/html', body: { data: b64u('<p>HTML <b>version</b></p>') } }, { mimeType: 'text/plain', body: { data: b64u('Plain version') } }] }) === 'Plain version' && OA.messageText({ mimeType: 'text/html', body: { data: b64u('<div>Hello<br>there &amp; you</div>') } }) === 'Hello\nthere & you', 'The readable text of a reply is taken from the plain part, or the HTML with tags removed');

// reading replies
const oaSrc = db.prepare("INSERT INTO kp_recipe_sources (name, url, area, active, status, contact_email) VALUES ('Reply Blog','https://reply.example','India',1,'registered','owner@reply.example') RETURNING id").get().id;
const oaSrc2 = db.prepare("INSERT INTO kp_recipe_sources (name, url, area, active, status, contact_email) VALUES ('Auto Blog','https://auto.example','India',1,'registered','hello@auto.example') RETURNING id").get().id;
db.prepare("INSERT INTO kp_outreach (source_id, to_email, status, gmail_thread, sent_at) VALUES (?, 'owner@reply.example', 'sent', 'TH1', ?)").run(oaSrc, Math.floor(Date.now() / 1000) - 3600);
db.prepare("INSERT INTO kp_outreach (source_id, to_email, status, gmail_thread, sent_at) VALUES (?, 'hello@auto.example', 'sent', 'TH2', ?)").run(oaSrc2, Math.floor(Date.now() / 1000) - 3600);
const oaEnv = { ...env, GMAIL_CLIENT_ID: 'c', GMAIL_CLIENT_SECRET: 's', GMAIL_REFRESH_TOKEN: 'r', GMAIL_SENDER: 'me@gmail.com' };
const mkMsg = (from, text, extra = {}) => ({ internalDate: '3000000', snippet: text.slice(0, 60), payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: from }, ...(extra.headers || [])], body: { data: b64u(text) } } });
const oaThreads = {
  TH1: [mkMsg('Me <me@gmail.com>', 'Hello from KidPoshan'), mkMsg('Owner <owner@reply.example>', 'Hi! Yes, you can feature my recipes. My WhatsApp is +91 98765 43210.\n\nOn Mon, KidPoshan <me@gmail.com> wrote:\n> reply YES or NO\n> NO - we will take down')],
  TH2: [mkMsg('Me <me@gmail.com>', 'Hello from KidPoshan'), mkMsg('Auto <hello@auto.example>', 'I am out of office until Monday.', { headers: [{ name: 'Subject', value: 'Automatic reply: Permission' }] })],
};
const oaFetch = async (u) => String(u).includes('oauth2') ? { ok: true, json: async () => ({ access_token: 'tok' }) }
  : { ok: true, json: async () => ({ messages: oaThreads[decodeURIComponent(String(u).match(/threads\/([^?]+)/)[1])] }) };
const oaRep = await OA.checkReplies(oaEnv, { fetchFn: oaFetch });
const oaRow = db.prepare('SELECT status, phone, reply_text FROM kp_outreach WHERE source_id = ?').get(oaSrc);
ok(oaRep.length === 1 && oaRow.status === 'replied_yes' && oaRow.phone === '+919876543210' && /feature my recipes/.test(oaRow.reply_text) && !/take down/.test(oaRow.reply_text), 'A reply is written to the database: contacted (sent), agreed (yes) and the phone number, without the quoted original');
ok(db.prepare('SELECT status FROM kp_outreach WHERE source_id = ?').get(oaSrc2).status === 'sent', 'An out-of-office auto-reply is ignored; the site stays "contacted, waiting"');
await OA.markOutreach(env, oaSrc, { status: 'replied_other' });
oaThreads.TH1.push(mkMsg('Owner <owner@reply.example>', 'Actually yes please go ahead'));
await OA.checkReplies(oaEnv, { fetchFn: oaFetch });
ok(db.prepare('SELECT status FROM kp_outreach WHERE source_id = ?').get(oaSrc).status === 'replied_other', 'Once the owner has decided, the automatic reading never changes the status');
const oaSet = await OA.setPhone(env, oaSrc, '+91 99999 11111');
ok(oaSet.phone === '+91 99999 11111' && !!(await throwsMsg(() => OA.setPhone(env, oaSrc, 'abc'))), 'The owner can correct the phone number');
const oaList = await OA.listOutreach(env);
const oaRowL = oaList.sources.find((x) => x.id === oaSrc);
ok(oaRowL.phone === '+91 99999 11111' && oaRowL.sent_at > 0 && oaRowL.status === 'replied_other' && oaList.tally.with_phone === 1, 'The listing shows contacted date, agreement and phone');

// automatic sending
const aoSent = []; const aoSend = async (e, to) => { aoSent.push(to); return { threadId: 'TA-' + to }; };
for (const [name, host2, st] of [['AO One', 'ao1.example', 'registered'], ['AO Two', 'ao2.example', 'registered'], ['AO Refused', 'ao3.example', 'registered'], ['AO NoRecipes', 'ao4.example', 'registered']]) {
  const sid2 = db.prepare("INSERT INTO kp_recipe_sources (name, url, area, active, status, contact_email, rights_status) VALUES (?,?,?,1,?,?,?) RETURNING id").get(name, 'https://' + host2, 'India', st, 'hi@' + host2, name === 'AO Refused' ? 'refused' : 'not_requested').id;
  if (name !== 'AO NoRecipes') { const rid2 = mkRecipe('https://' + host2 + '/dish/', { status: 'approved', name: name + ' Dish' }); db.prepare('UPDATE kp_recipes SET source_id = ? WHERE id = ?').run(sid2, rid2); }
}
ok((await OA.autoOutreach(oaEnv, { send: aoSend })).skipped === 'automatic sending is off' && aoSent.length === 0, 'Automatic sending does nothing while it is off');
ok(/Connect Gmail/.test(await throwsMsg(() => OA.updateOutreachSettings({ ...env }, { auto: true }))), 'It cannot be switched on before Gmail is connected');
const aoUsed = db.prepare('SELECT count(*) n FROM kp_outreach WHERE sent_at > ?').get(Math.floor(Date.now() / 1000) - 86400).n;   // emails already sent today by earlier checks
const aoCap = aoUsed + 2;
await OA.updateOutreachSettings(oaEnv, { auto: true, daily_cap: aoCap });
const aoRun = await OA.autoOutreach(oaEnv, { send: aoSend });
ok(aoRun.sent === 2 && aoSent.slice().sort().join() === 'hi@ao1.example,hi@ao2.example', 'Automatic sending emails sites with live recipes and an address, but never a site that refused or one with no live recipes: ' + aoSent);
ok((await OA.autoOutreach(oaEnv, { send: aoSend })).skipped?.includes('daily limit') && aoSent.length === 2, 'The daily limit stops it');
ok(!!(await throwsMsg(() => OA.updateOutreachSettings(oaEnv, { daily_cap: 500 }))) && (await OA.outreachSettings(oaEnv)).auto === true, 'The daily limit must be 1 to 50; the settings are reported');
await OA.updateOutreachSettings(oaEnv, { auto: false });
ok((await OA.autoOutreach(oaEnv, { send: aoSend })).skipped === 'automatic sending is off', 'Switching it off stops it at once');

// finding the contact address on the site itself
ok(OA.decodeCfEmail('7c1409091d0a1d1c3c1d0c1d111d0b1d52111513') !== null, 'Cloudflare-protected addresses can be decoded');
const cfHex = (e) => { const k = 0x2a; return k.toString(16).padStart(2, '0') + [...e].map((c) => (c.charCodeAt(0) ^ k).toString(16).padStart(2, '0')).join(''); };
const oaPage = '<a href="mailto:Hello@mycooks.example?subject=Hi">Mail</a> <a class="__cf_email__" data-cfemail="' + cfHex('team@mycooks.example') + '">[email protected]</a> ads@adnetwork.example logo@2x.png noreply@mycooks.example';
const oaFound = OA.emailsFromHtml(oaPage);
ok(oaFound.includes('hello@mycooks.example') && oaFound.includes('team@mycooks.example') && !oaFound.some((e) => /noreply|2x\.png/.test(e)), 'Addresses are found in mailto links, protected addresses and plain text; no-reply and image names are dropped: ' + oaFound);
ok(OA.pickEmail(oaFound, 'https://www.mycooks.example/recipes/') === 'hello@mycooks.example' && OA.pickEmail(['ads@adnetwork.example'], 'https://mycooks.example') === null && OA.pickEmail(['jane.cook@gmail.com', 'ads@x.example'], 'https://janecooks.example') === 'jane.cook@gmail.com', 'An address on the site\'s own domain (or a personal free-mail one) is chosen; an unrelated company address is not');
const cfRes = await OA.findContactEmail(env, { url: 'https://mycooks.example/' }, { fetchPage: async (u) => (u.endsWith('/contact/') ? oaPage : '') });
ok(cfRes.email === 'hello@mycooks.example' && cfRes.page === '/contact/', 'The contact page is tried first');
ok((await OA.findContactEmail(env, { url: 'https://mycooks.example/' }, { fetchPage: async () => { const e = new Error('pacing'); e.code = 'later'; throw e; } })).later === true, 'If the site must be asked later (pacing), it tries again next time');
const fcSid = db.prepare("INSERT INTO kp_recipe_sources (name, url, area, active, status) VALUES ('Find Blog','https://find.example','India',1,'registered') RETURNING id").get().id;
const fcRid = mkRecipe('https://find.example/dish/', { status: 'approved', name: 'Find Dish' }); db.prepare('UPDATE kp_recipes SET source_id = ? WHERE id = ?').run(fcSid, fcRid);
const fcOut = await OA.findContactEmails(env, { limit: 5, find: async () => ({ email: 'hello@find.example' }) });
const fcRow = db.prepare('SELECT contact_email, contact_email_source, contact_checked_at FROM kp_recipe_sources WHERE id = ?').get(fcSid);
ok(fcOut.some((x) => x.id === fcSid) && fcRow.contact_email === 'hello@find.example' && fcRow.contact_email_source === 'auto' && fcRow.contact_checked_at, 'A found address is saved, marked as found automatically, and the site is not checked again');
await OA.setContactEmail(env, fcSid, 'typed@find.example');
ok(db.prepare('SELECT contact_email_source FROM kp_recipe_sources WHERE id = ?').get(fcSid).contact_email_source === 'owner', 'An address typed in by the owner is marked as the owner\'s');
ok(/phone or WhatsApp/.test(OA.buildMessage({}, { name: 'X' }, []).text), 'The email invites the creator to add a phone or WhatsApp number');
const stRes = await routeRecipes(new Request('https://w/api/kp/admin/outreach/settings', { headers: { 'x-admin-token': 't' } }), { ...oaEnv, ADMIN_TOKEN: 't' }, ctx);
ok(stRes.status === 200 && (await stRes.json()).daily_cap === aoCap && (await routeRecipes(new Request('https://w/api/kp/admin/outreach/settings'), { ...oaEnv, ADMIN_TOKEN: 't' }, ctx)).status === 401, 'The settings endpoint reports the limit and needs the admin token');

// ---- the Products page: every approved, scored packaged food, with age guide, filters and score workings ----
import * as PR from '../../src/recipes/products.js';
import { ALL_KINDS as pkKinds, CATALOGUE_KINDS as pkCat, MORE_KINDS as pkMore, READY_KINDS as pkReady, scorePack as pkScore } from '../../src/recipes/ready.js';
ok(new Set(pkKinds.map((k) => k.kind)).size === pkKinds.length && pkKinds.every((k) => k.category && k.label && (k.scanOnly || k.query) && k.product instanceof RegExp), 'Every pack and product type has a unique key, a category, a search and a name check');
ok(pkKinds.length === pkReady.length + pkCat.length + pkMore.length && pkMore.every((k) => k.scanOnly && k.words) && pkCat.length >= 30 && ['Breakfast and cereals', 'Snacks', 'Drinks', 'Dairy', 'Baby foods', 'Ready mixes'].every((c) => pkKinds.some((k) => k.category === c)), 'The catalogue covers breakfast, flours, snacks, drinks, dairy, baby foods and ready mixes');
ok(pkCat.every((k) => !k.dish) && PR.KIND_CATEGORIES.length >= 8, 'Catalogue products are never matched to a recipe; they only appear on the Products page');
const prodAges = PR.agesFor;
ok(prodAges('ragi_flour', { added_sugars_g: 0, sodium_mg: 5 }, ['ragi']).join() === '6-12m,1-3y,4-6y,7-9y,10-12y,13-15y,16-18y,adult', 'A plain baby-suitable food with no sugar or salt is offered from 6 months');
ok(prodAges('ragi_flour', { added_sugars_g: 0, sodium_mg: 5 }, ['ragi', 'salt']).join() === '1-3y,4-6y,7-9y,10-12y,13-15y,16-18y,adult' && prodAges('baby_cereal', { added_sugars_g: 6, sodium_mg: 40 }, []).join() === '1-3y,4-6y,7-9y,10-12y,13-15y,16-18y,adult', 'Salt in the ingredients, or sugar above 2 g, takes it out of the 6-12 month age');
ok(prodAges('kids_biscuits', { added_sugars_g: 22, sodium_mg: 300 }, []).join() === '1-3y,4-6y,7-9y,10-12y,13-15y,16-18y,adult' && prodAges('rolled_oats', {}, []).join() === '1-3y,4-6y,7-9y,10-12y,13-15y,16-18y,adult', 'A biscuit is never offered under 12 months; a product with no label values is not offered under 12 months either (from 12 months the score itself weighs sugar and salt for the age)');
ok(prodAges('kids_biscuits', { added_sugars_g: 2, sodium_mg: 100 }, []).includes('6-12m') === false, 'A kind that is not meant for babies is never offered under 12 months, however clean its label');

const pkAdd = (o) => db.prepare("INSERT INTO kp_ready_products (kind, name, brand, pack_size, product_url, image_url, retailer, ingredients_json, nutrition_json, kidposhan_score, score_status, score_breakdown_json, status, label_source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
  .run(o.kind, o.name, o.brand || 'Brand', o.pack || '500 g', 'https://shop.example/' + Math.random().toString(36).slice(2), o.image || null, 'bigbasket', JSON.stringify(o.ingredients || ['ragi']), o.nutrition ? JSON.stringify(o.nutrition) : null, o.score ?? null, o.st || 'exact', o.detail ? JSON.stringify(o.detail) : null, o.status || 'approved', 'ai').lastInsertRowid;
db.prepare('DELETE FROM kp_ready_products').run();   // start the Products checks from an empty catalogue (earlier checks left packs behind)
const cleanLab = { protein_g: 7, fibre_g: 11, sugars_g: 1, added_sugars_g: 0, saturated_fat_g: 0.3, sodium_mg: 8 };
const sc1 = pkScore(cleanLab, ['ragi flour']);
const pRagi = pkAdd({ kind: 'ragi_flour', name: 'Organic Ragi Flour', brand: 'Earthy', nutrition: cleanLab, score: sc1.score, detail: sc1.detail });
const pOats = pkAdd({ kind: 'rolled_oats', name: 'Rolled Oats 1kg', nutrition: { ...cleanLab, protein_g: 12, fibre_g: 10 }, score: 91 });
const pBisc = pkAdd({ kind: 'kids_biscuits', name: 'Choco Kids Biscuit', nutrition: { protein_g: 5, fibre_g: 1, sugars_g: 28, added_sugars_g: 24, saturated_fat_g: 9, sodium_mg: 380 }, score: 34 });
pkAdd({ kind: 'kids_biscuits', name: 'Unscored Biscuit', nutrition: null, score: null, st: 'pending' });
pkAdd({ kind: 'chips', name: 'Waiting Chips', nutrition: cleanLab, score: 70, status: 'candidate' });
pkAdd({ kind: 'rolled_oats', name: 'Rolled Oats 1kg', pack: '1 kg x 2', nutrition: { ...cleanLab, protein_g: 12 }, score: 80 });   // same product, bigger pack: one product
const prodAll = await PR.listProducts(env, {});
ok(prodAll.items.map((x) => x.name).sort().join() === 'Choco Kids Biscuit,Organic Ragi Flour,Rolled Oats 1kg' && prodAll.in_catalogue === 3, 'Only approved products with an exact score are listed, and the same product in two pack sizes is one product: ' + prodAll.items.map((x) => x.name));
ok(prodAll.items[0].score >= prodAll.items[1].score && prodAll.items[1].score >= prodAll.items[2].score, 'Products are in descending Poshan Score order');
ok((await PR.listProducts(env, { sort: 'name' })).items.map((x) => x.name).join() === 'Choco Kids Biscuit,Organic Ragi Flour,Rolled Oats 1kg', 'They can be sorted by name');
{ const m80 = await PR.listProducts(env, { min: 80 }), m58 = await PR.listProducts(env, { min: 58 }); ok(m80.items.every((x) => x.score >= 80) && m58.items.every((x) => x.score >= 58) && m80.total === prodAll.items.filter((x) => x.score >= 80).length && m58.total === prodAll.items.filter((x) => x.score >= 58).length, 'The minimum score filter works (Excellent 80, Good 58)'); }
ok((await PR.listProducts(env, { category: 'Snacks' })).total === 0 && (await PR.listProducts(env, { category: 'Biscuits and bakery' })).total === 1, 'The category filter works');
const prodInfants = await PR.listProducts(env, { age: '6-12m' });
ok(prodInfants.items.map((x) => x.name).sort().join() === 'Organic Ragi Flour,Rolled Oats 1kg' && prodInfants.categories.length === 2, 'For 6-12 months only the plain, low-sugar, low-salt baby-suitable products are listed (the biscuit is not), and the category list follows the age: ' + prodInfants.items.map((x) => x.name));
const bisc1 = (await PR.listProducts(env, { age: '1-3y' })).items.find((x) => x.name === 'Choco Kids Biscuit'), bisc10 = (await PR.listProducts(env, { age: '10-12y' })).items.find((x) => x.name === 'Choco Kids Biscuit');
ok((await PR.listProducts(env, { age: '4-6y' })).total === 3 && bisc1 && bisc10 && bisc10.score >= bisc1.score - 2, 'From 12 months every scored product is listed, and the same biscuit scores no better for a 1-3 year old than for a 10-12 year old (within 2 points: a small child needs less protein and fibre, so those marks come easier)');
const prodDet = await PR.productDetail(env, pRagi);
ok(prodDet && prodDet.name === 'Organic Ragi Flour' && prodDet.offered_for[0] === '6-12m' && prodDet.nutrition_per_100g.fibre_g === 11 && prodDet.metrics.length === 10 && prodDet.metrics.every((m) => m.score === 0 || m.score === 1) && prodDet.score === prodDet.metrics.reduce((a, m) => a + m.score, 0) * 10 && Object.keys(prodDet.scores_by_age).length === 8, 'The product detail carries the label, the age guide and the ten metrics (each a yes or no, passes times 10 = the score)');
ok(await PR.productDetail(env, 999999) === null && await PR.productDetail(env, db.prepare("SELECT id FROM kp_ready_products WHERE name = 'Waiting Chips'").get().id) === null, 'A product that is not approved and scored has no page');
const prodApi = await routeRecipes(new Request('https://w/api/kp/products?age=nonsense&sort=name', { headers: { origin: 'https://www.kidposhan.in' } }), env, ctx);
const prodApiJ = await prodApi.json();
ok(prodApi.status === 200 && prodApiJ.total === 3 && prodApi.headers.get('access-control-allow-origin') === 'https://www.kidposhan.in', 'The products API answers CORS for kidposhan.in and ignores an unknown age');
ok((await routeRecipes(new Request('https://w/api/kp/products/' + pOats), env, ctx)).status === 200 && (await routeRecipes(new Request('https://w/api/kp/products/999999'), env, ctx)).status === 404, 'A single product is fetched by id; an unknown one is a 404');
const waitingId = pkAdd({ kind: 'chips', name: 'Scored Waiting Chips', nutrition: cleanLab, score: 55, status: 'candidate' });
pkAdd({ kind: 'chips', name: 'Unscored Waiting', nutrition: null, score: null, st: 'pending', status: 'candidate' });
const prodAp = await PR.approveScored(env);
ok(prodAp.approved >= 1 && db.prepare('SELECT status FROM kp_ready_products WHERE id = ?').get(waitingId).status === 'approved' && db.prepare("SELECT status FROM kp_ready_products WHERE name = 'Unscored Waiting'").get().status === 'candidate', 'Approving all scored products approves only those whose label was read and scored');
ok((await routeRecipes(new Request('https://w/api/kp/admin/products/approve-scored', { method: 'POST' }), { ...env, ADMIN_TOKEN: 't' }, ctx)).status === 401, 'Approve-all needs the admin token');

// ---- Poshan Score version 2: ten metrics, each 1 to 10, out of 100, for the child's age band ----
import * as S2 from '../../src/recipes/score2.js';
import { methodSpec as s2Spec } from '../../src/recipes/score2.js';
ok(S2.BANDS.length === 4 && S2.bandForMonths(9).id === '1-3' && S2.bandForMonths(12).id === '1-3' && S2.bandForMonths(47).id === '1-3' && S2.bandForMonths(48).id === '4-6' && S2.bandForMonths(84).id === '7-9' && S2.bandForMonths(120).id === '10-12' && S2.bandForMonths(155).id === '10-12' && S2.bandForMonths(156).id === '13-15' && S2.bandForMonths(200).id === '16-18' && S2.bandForMonths(300).id === 'adult', 'An age in months maps to its ICMR-NIN group: 1-3, 4-6, 7-9, 10-12, 13-15, 16-18 or adult (under 12 months uses the 1-3 reference)');
ok(S2.riskScore(0) === 1 && S2.riskScore(10) === 1 && S2.riskScore(29.9) === 1 && S2.riskScore(30) === 0 && S2.riskScore(500) === 0, 'A risk metric is a yes or no by its share of the daily reference (yes under 30%, no at 30% or more)');
ok(S2.creditScore(30) === 1 && S2.creditScore(15) === 1 && S2.creditScore(14.9) === 0 && S2.creditScore(0) === 0, 'A credit metric (fibre, protein) is a yes or no (yes at 15% of the day or more)');
const s2Clean = S2.scoreAllBands({ basis: 'pack', protein: 12, fibre: 10, addedSugar: 0, satFat: 1, sodium: 10, name: 'Rolled Oats', ingredients: ['Rolled oats'] });
ok(s2Clean.version === 'kp-score-v4' && Object.keys(s2Clean.bands).length === 19 && ['1-3','4-6','7-9','10-12','13-15:f','adult:m:heavy'].every((k) => k in s2Clean.bands) && s2Clean.reference === s2Clean.bands['4-6'].total && s2Clean.bands['4-6'].metrics.length === 10, 'Every score is worked out for every ICMR-NIN age group (children, boys and girls, men and women), with ten metrics each');
ok(s2Clean.bands['4-6'].metrics.every((m, i) => m.n === i + 1 && (m.score === 0 || m.score === 1) && m.pass === (m.score === 1)) && s2Clean.bands['4-6'].total === s2Clean.bands['4-6'].metrics.reduce((a, m) => a + m.score, 0) * 10 && s2Clean.bands['4-6'].total >= 90, 'The ten metrics are each 0 or 1 and the passes times 10 give the score out of 100: ' + s2Clean.bands['4-6'].total);
const s2Junk = S2.scoreAllBands({ basis: 'pack', protein: 3, fibre: 1, addedSugar: 30, satFat: 14, sodium: 700, name: 'Choco Wafer', ingredients: ['Sugar', 'Palm oil', 'Refined wheat flour', 'Hydrogenated vegetable fat', 'Preservative (INS 211)', 'Artificial flavour', 'Colour (INS 110)'] });
const jm = s2Junk.bands['4-6'].metrics;
ok(jm[0].score === 0 && jm[2].score === 0 && jm[3].score === 0 && jm[6].score === 0 && jm[7].score === 0 && jm[8].score === 0 && jm[9].score === 0, 'Sugar first, hydrogenated fat, a preservative and artificial additives each fail their check; HFSS fails if sugar, sodium or saturated fat fails');
ok(s2Junk.bands['4-6'].total <= 57 && s2Junk.bands['4-6'].tier !== 'Excellent' && s2Junk.bands['4-6'].tier !== 'Good', 'A product that fails a risk metric outright is capped at 57 (Fair) at most: ' + s2Junk.bands['4-6'].total);
const salty = (b) => S2.scoreForBand({ basis: 'pack', protein: 8, fibre: 6, addedSugar: 1, satFat: 2, sodium: 400, name: 'Savoury Mix', ingredients: ['Chickpea flour'] }, b).metrics[1].score;
ok(salty('1-3') <= salty('4-6') && salty('4-6') <= salty('7-9') && salty('7-9') <= salty('10-12') && salty('1-3') < salty('10-12'), 'The same salty food can fail sodium for a younger child and pass for an older one');
const sameMeal = { protein: 9, fibre: 5, addedSugar: 1, satFat: 2.5, sodium: 380, name: 'Veg pulao', ingredients: '', topKey: 'rice' };
ok(S2.scoreForBand({ ...sameMeal, basis: 'meal' }, '4-6').metrics[1].share === S2.scoreForBand({ ...sameMeal, basis: 'pack' }, '4-6').metrics[1].share && Math.round(S2.scoreForBand({ ...sameMeal, basis: 'meal' }, '4-6').metrics[1].share) === 28, 'A serving is compared with the FULL daily reference (380 mg of 1,360 mg = 28%), not a third of it');
ok(S2.scoreForBand({ ...sameMeal, basis: 'meal', topKey: 'sugar' }, '4-6').metrics[8].score === 0 && S2.scoreForBand({ ...sameMeal, basis: 'meal', topKey: 'rice' }, '4-6').metrics[8].score === 1, 'For a dish, base-ingredient integrity looks at what dominates by weight');
const spec = s2Spec();
ok(spec.metrics.length === 10 && spec.scale.max === 1 && spec.scale.total === 100 && spec.bands.length === 4 && spec.metrics.every((m) => Array.isArray(m.steps) && m.steps.length >= 1) && spec.metrics[0].steps.length === 2 && spec.metrics[4].steps.length === 2, 'The method page data lists ten metrics, four age bands, and a yes and a no rule for each metric');
ok(spec.metrics[0].steps[0].score === 1 && spec.metrics[0].steps[1].score === 0 && /under 30%/.test(spec.metrics[0].steps[0].rule) && /at or over/.test(spec.metrics[0].steps[1].rule), 'The printed thresholds are generated from the same table the scoring uses');
const specRes = await routeRecipes(new Request('https://w/api/kp/score-method', { headers: { origin: 'https://www.kidposhan.in' } }), env, ctx);
ok(specRes.status === 200 && (await specRes.json()).metrics.length === 10 && specRes.headers.get('access-control-allow-origin') === 'https://www.kidposhan.in', 'The scoring method is served to the Age & Metrics page (and answers CORS for kidposhan.in)');

// recipes carry a score per age band, and search/detail follow the child's age
const s2Q = async (age) => (await (await handleRecipesApi(new Request('https://w/api/kp/recipes?age_months=' + age + '&occasion=lunch&pref=veg&limit=40'), env, ctx)).json());
const s2Id = mkRecipe('https://s2.example/dish/', { status: 'approved', name: 'Salty Dal Dish', agemin: 6, agemax: 144 });
db.prepare('UPDATE kp_recipes SET score_13 = 70, score_46 = 80, score_79 = 80, score_1012 = 90, poshan_score = 80 WHERE id = ?').run(s2Id);
// every search is a random draw, so ask a few times until the recipe is in the draw
const s2Find = async (age) => { for (let i = 0; i < 12; i++) { const r = (await (await handleRecipesApi(new Request('https://w/api/kp/recipes?age_months=' + age + '&occasion=lunch&pref=veg&limit=40&shuffle=1'), env, ctx)).json()).results.find((x) => x.id === s2Id); if (r) return r; } return null; };
const s2a = await s2Find(24), s2b = await s2Find(132), s2c = await s2Find(60);
ok(s2a && s2b && s2c && s2a.poshan_score === 70 && s2b.poshan_score === 90 && s2c.poshan_score === 80, "A recipe's listed score follows the child's age band (70 at 1-3 years, 80 at 4-6, 90 at 10-12 in this example)");
ok((await s2Q(24)).query.score_band === '1-3' && (await s2Q(132)).query.score_band === '10-12', 'The search says which age band the scores are for');


// ---- front and back of the pack ----
{
  const PS = await import('../../src/recipes/products.js');
  const sh = PS.packShots({ image_url: 'https://cdn.x/image/400/400/a.jpg?q=70', label_image_url: 'https://cdn.x/image/1600/1700/a.jpg?q=80', gallery_json: JSON.stringify(['https://cdn.x/image/1600/1700/a.jpg', 'https://cdn.x/image/1600/1700/b.jpg']) });
  ok(sh.image_url.includes('/b.jpg') && sh.back_image_url.includes('/a.jpg'), 'The front of the pack is never the same picture as the back (the nutrition shot)');
  const one = PS.packShots({ image_url: 'https://cdn.x/f.jpg', label_image_url: null, gallery_json: null });
  ok(one.image_url === 'https://cdn.x/f.jpg' && one.back_image_url === null, 'With no back photo the product shows the front only and no spin tab');
}

// ---- packs whose ingredient reading is given as flags ----
{
  const RP = await import('../../src/recipes/ready.js');
  const base = { protein_g: 6, fibre_g: 4, sugars_g: 0, added_sugars_g: 0, saturated_fat_g: 1, sodium_mg: 100 };
  const clean = RP.scorePack({ ...base, flags: { preservatives: 0, additives: 0, trans: false, integrity: 10 } }, [], 'Rolled oats');
  const dirty = RP.scorePack({ ...base, flags: { preservatives: 1, additives: 3, trans: true, integrity: 3 } }, [], 'Rolled oats');
  const m = (r) => r.detail.bands['4-6'].metrics;
  ok(m(clean)[6].score === 1 && m(clean)[7].score === 1 && m(clean)[8].score === 1 && m(clean)[3].score === 1, 'Checked-reading flags: no preservatives, additives or hydrogenated fat, whole-food first, passes each check');
  ok(m(dirty)[6].score === 0 && m(dirty)[7].score === 0 && m(dirty)[3].score === 0 && m(dirty)[8].score === 0 && dirty.score < clean.score, 'Checked-reading flags carry a preservative, three additives, a hydrogenated fat and a refined first ingredient into the checks');
  ok(RP.kindByKey('mayonnaise')?.category === 'Spreads and sauces', 'Mayonnaise is a product kind');
}

// ---- one search for products and recipes ----
{
  const SR = await import('../../src/recipes/search.js');
  const SC = await import('../../src/recipes/score2.js');
  ok(SR.tokens("Saffola  Masala-Oats!").join() === 'saffola,masala-oats' && SR.tokens('a').length === 0, 'The search splits what is typed into words and ignores single letters');
  const rid = mkRecipe('https://srch.example/ragi-dosa/', { status: 'approved', name: 'Crispy Ragi Dosa Recipe', score: 81 });
  const rid2 = mkRecipe('https://srch.example/ragi-batter/', { status: 'approved', name: 'Ragi Dosa Batter', score: 90 });
  const rid3 = mkRecipe('https://srch.example/no-time/', { status: 'approved', name: 'Ragi Mystery Bowl', score: 90, minutes: null });
  db.prepare('UPDATE kp_recipes SET total_minutes = NULL WHERE id = ?').run(rid3);
  const got = await SR.searchAll(env, 'ragi dosa');
  ok(got.recipes.some((r) => r.id === rid) && !got.recipes.some((r) => r.id === rid2) && !got.recipes.some((r) => r.id === rid3), 'Recipe search finds a dish by words in its name, and leaves out a batter and a recipe with no cooking time');
  const gp = await SR.searchAll(env, 'organic ragi');
  ok(gp.products.some((p) => /Ragi Flour/.test(p.name)) && (await SR.searchAll(env, 'zzzz')).products.length === 0, 'Product search finds an approved product by name');
  const sres = await routeRecipes(new Request('https://w/api/kp/search?q=ragi', { headers: { origin: 'https://www.kidposhan.in' } }), env, ctx);
  ok(sres.status === 200 && Array.isArray((await sres.json()).recipes) && sres.headers.get('access-control-allow-origin') === 'https://www.kidposhan.in', 'The search is served to every page of the main site');
}

// ---- real total with a "capped" badge; one serving basis for packs and recipes; waiting time ----
{
  const E = await import('../../src/recipes/score2.js');
  const RP = await import('../../src/recipes/ready.js');
  const salty = E.scoreForBand({ basis: 'meal', protein: 8, fibre: 6, addedSugar: 0, satFat: 1, sodium: 3000, name: 'Dal', ingredients: ['Toor dal', 'Salt'] }, '4-6');
  ok(salty.capped && salty.total === salty.sum * 10 && salty.total > 70 && salty.tier === 'OK', `A capped result keeps the real score (${salty.total}) and is rated OK, not clipped to 70`);
  const flakes = { protein_g: 6.7, fibre_g: 2.5, sugars_g: 9.2, added_sugars_g: 8, saturated_fat_g: 0.6, sodium_mg: 490 };
  const asPack = RP.scorePack(flakes, ['Corn grits', 'Sugar', 'Salt'], 'Corn Flakes', 'breakfast_cereal');
  ok(asPack.detail.inputs.basis === 'meal' && asPack.detail.inputs.serving_g === 40 && Math.abs(asPack.detail.inputs.sodium - 196) < 0.01, 'A pack is scored per serving (40 g of cereal, the FDA reference amount), like a recipe, not per 100 g');
  const big = RP.scorePack({ ...flakes, serving_g: 60 }, ['Corn grits', 'Sugar', 'Salt'], 'Corn Flakes', 'breakfast_cereal');
  ok(big.detail.inputs.sodium > asPack.detail.inputs.sodium && big.score <= asPack.score, 'A bigger serving counts for more');
  const d = await PR.productDetail(env, (await PR.listProducts(env, {})).items[0].id, {});
  ok(d.scores_by_age['6-12m'] === null || typeof d.scores_by_age['6-12m'] === 'number', 'Under 12 months a product gets a number only if it is a plain baby-suitable food; otherwise none (shown as Not for under 1)');
  const long = mkRecipe('https://wait.example/dosa/', { status: 'approved', name: 'Masala Dosa Waiting', minutes: 495, score: 80 });
  const lres = await handleRecipesApi(new Request('https://w/api/kp/recipes/' + long + '?age_months=60'), env, ctx);
  ok((await lres.json()).make_ahead === true, 'A recipe over four hours is flagged "make ahead" (mostly soaking or fermenting)');
}


// ---- several choices in each filter ----
{
  const mq = async (qs) => (await (await handleRecipesApi(new Request('https://w/api/kp/recipes?' + qs + '&limit=40'), env, ctx)).json());
  const mAll = async (qs) => { const seen = new Set(); for (let k = 0; k < 10; k++) (await mq(qs + '&shuffle=1')).results.forEach((r) => seen.add(r.id)); return seen; };
  const lowId = mkRecipe('https://multi.example/toddler/', { status: 'approved', name: 'Toddler Only Mash', agemin: 12, agemax: 40, score: 85 });
  const midId = mkRecipe('https://multi.example/teen/', { status: 'approved', name: 'Big Kid Wrap', agemin: 96, agemax: 144, score: 85 });
  const bothId = mkRecipe('https://multi.example/both/', { status: 'approved', name: 'Family Khichdi', agemin: 12, agemax: 144, score: 85 });
  const two = await mAll('age_months=24,132&occasion=lunch&pref=veg&season=all');
  ok(two.has(bothId) && !two.has(lowId) && !two.has(midId), 'Two ages: only recipes that suit both children are offered');
  const echo = await mq('age_months=24,132&occasion=lunch&pref=veg&season=all');
  ok(echo.query.age_months_all.join() === '24,132' && echo.query.score_bands.join() === '1-3,10-12', 'The answer says which ages and age bands the choices covered');
  const mixed = await mAll('age_months=60&occasion=lunch&pref=veg,nonveg&season=all');
  ok(mixed.has(dVeg) && mixed.has(dEgg) && mixed.has(dNon), 'Veg and Non-veg together offer both kinds of dish');
  const jv = await mAll('age_months=60&occasion=lunch&pref=jain,nonveg&season=all');
  ok(jv.has(dJain) && jv.has(dNon) && !jv.has(dVeg), 'Jain and Non-veg together: Jain, egg and non-veg dishes, not plain veg');
  const dn = db.prepare("INSERT INTO kp_recipe_occasions (recipe_id, occasion) VALUES (?, 'dinner')");
  dn.run(dVeg);
  const meals = await mAll('age_months=60&occasion=snack_4pm,dinner&pref=veg&season=all');
  ok(meals.has(dVeg), 'Two meals together: a recipe that suits either one is offered');
  const bad = await handleRecipesApi(new Request('https://w/api/kp/recipes?age_months=24,1201&occasion=lunch'), env, ctx);
  ok(bad.status === 400, 'An age outside 6 to 1200 months is refused, even in a list');
}


// ---- defaults for "salt to taste" and for deep frying ----
{
  const N = await import('../../src/recipes/nutrients.js');
  const SCm = await import('../../src/recipes/score.js');
  const ing = (raw, key, q = null, u = null, pantry = false) => ({ raw_text: raw, ingredient_key: key, quantity: q, unit: u, name: key, is_pantry: pantry });
  const base = [ing('1 cup moong dal', 'moong_dal', 1, 'cup'), ing('salt to taste', 'salt', null, null, true)];
  const e4 = N.estimateNutrition(base, 4), e2 = N.estimateNutrition(base, 2);
  ok(Math.abs(e4.per_serving.sodium - (15 * 2 + 570 * 4) / 4) < 3 && e4.defaults.includes('salt'), 'Salt "to taste" is assumed 1/4 tsp (570 mg sodium) per serving: ' + e4.per_serving.sodium + ' mg');
  ok(e2.per_serving.sodium > 570 && e2.per_serving.sodium < 640 && Math.abs(e2.per_serving.sodium - e4.per_serving.sodium) < 10, 'The salt default is per serving, so it does not change with the number of servings');
  ok(N.isDeepFried('Moong Dal Vada') && N.isDeepFried('Onion Bhajiya | Kanda Bhaji') && N.isDeepFried('Veg Cutlet', [ing('oil for deep frying', 'oil')]) && !N.isDeepFried('Dal Fry'), 'Vada, bhajiya and pakora are deep-fried; Dal Fry is not');
  const fried = [ing('1 cup moong dal', 'moong_dal', 1, 'cup'), ing('oil for deep frying', 'oil', 2, 'cup'), ing('salt', 'salt', null, null, true)];
  const plainEst = N.estimateNutrition(fried, 4), friedEst = N.estimateNutrition(fried, 4, { fried: true });
  ok(friedEst.per_serving.satFat < plainEst.per_serving.satFat && Math.abs(friedEst.per_serving.satFat - 1.4) < 0.3 && friedEst.defaults.includes('fry oil'), 'A deep-fried serving counts about 10 g of absorbed oil (1.4 g saturated fat), not the whole pan of frying oil: ' + friedEst.per_serving.satFat);
  const row = { name: 'Moong Dal Vada', servings: '4', nutrition_json: null };
  const sc = SCm.computeRecipeScore(row, fried.map((x) => ({ ...x })));
  ok(sc.status === 'estimated' && sc.detail.defaults_used.includes('salt') && sc.detail.defaults_used.includes('fry oil'), 'A score that used a default is labelled estimated and says which defaults');
  const withPage = SCm.computeRecipeScore({ name: 'Dal', servings: '4', nutrition_json: JSON.stringify({ proteinContent: '9 g', fiberContent: '5 g', saturatedFatContent: '1 g', sodiumContent: '300 mg' }) }, base.map((x) => ({ ...x })));
  ok(withPage.status === 'exact', 'When the page gives all four figures the salt default does not matter and the score stays exact');
}


// ---- the score runs from 0 to 100 ----
{
  const E2 = await import('../../src/recipes/score2.js');
  ok(E2.stretch(0) === 0 && E2.stretch(10) === 100 && E2.stretch(5) === 50, 'No checks passed give 0 and all ten give exactly 100 (passes times 10)');
  const best = E2.scoreForBand({ basis: 'pack', protein: 20, fibre: 20, addedSugar: 0, satFat: 0, sodium: 0, name: 'Rolled oats', ingredients: ['Rolled oats'] }, '4-6');
  ok(best.total === 100 && best.tier === 'Good', 'A perfect product scores exactly 100: ' + best.total);
  const worst = E2.scoreForBand({ basis: 'pack', protein: 0, fibre: 0, addedSugar: 100, satFat: 100, sodium: 5000, name: 'Sugar', ingredients: ['Sugar', 'Hydrogenated vegetable fat', 'Preservative (E211)', 'Artificial flavour', 'Colour (E102)'] }, '4-6');
  ok(worst.total <= 10 && worst.tier === 'Do not use', 'The worst possible product scores near 0: ' + worst.total);
  ok(E2.methodSpec().tiers.at(-1).min === 0 && E2.methodSpec().scale.sum_range.join() === '0,10', 'The method page data says the score runs from 0');
}

// ---- saves stay on the phone; another device needs a one-time code ----
{
  const SY = await import('../../src/recipes/sync.js');
  const sent = [];
  const sEnv = { ...env, __sms: async (mobile, code) => { sent.push({ mobile, code }); } };
  const noSms = await throwsMsg(() => SY.startSync(env, { mobile: '9812345678' }));
  ok(/not switched on/.test(noSms), 'Without an SMS provider, syncing says it is not switched on (and nothing is sent)');
  ok(/10-digit/.test(await throwsMsg(() => SY.startSync(sEnv, { mobile: '123' }))), 'A bad number gets no code');
  const st = await SY.startSync(sEnv, { mobile: '+91 98123 45678' });
  ok(st.sent && sent.length === 1 && sent[0].mobile === '9812345678' && /^\d{6}$/.test(sent[0].code) && !JSON.stringify(st).includes(sent[0].code), 'A six-digit code goes to the number by SMS and is never returned to the page');
  const card = (id, name) => ({ id, name, mins: 30, score: 80, diet: 'veg', occ: ['dinner'] });
  ok(/not right/.test(await throwsMsg(() => SY.verifySync(sEnv, { mobile: '9812345678', code: '000000', saved: { 7: card(7, 'Dal') } }))), 'A wrong code is refused');
  const v = await SY.verifySync(sEnv, { mobile: '9812345678', code: sent[0].code, saved: { 7: card(7, 'Dal Fry'), 9: card(9, 'Khichdi') }, plan: { 'Monday-dinner': 7, 'Tuesday-dinner': 999 } });
  ok(/^kpy_/.test(v.token) && Object.keys(v.saved).length === 2 && v.plan['Monday-dinner'] === 7 && !('Tuesday-dinner' in v.plan) && v.mobile_hint === '••••••5678', 'The right code returns a token and the merged lists (a plan entry for an unsaved recipe is dropped), showing only the last four digits');
  ok(/expired|not right/.test(await throwsMsg(() => SY.verifySync(sEnv, { mobile: '9812345678', code: sent[0].code }))), 'A code works once');
  const authed = (path, body) => routeRecipes(new Request('https://w' + path, { method: 'POST', headers: { origin: 'https://www.kidposhan.in', authorization: 'Bearer ' + v.token }, body: JSON.stringify(body || {}) }), sEnv, ctx);
  const loaded = await (await authed('/api/kp/sync/load')).json();
  ok(Object.keys(loaded.saved).length === 2, 'With the token, the saved list comes back on another device');
  const noTok = await routeRecipes(new Request('https://w/api/kp/sync/load', { method: 'POST', headers: { origin: 'https://www.kidposhan.in' }, body: '{}' }), sEnv, ctx);
  const fakeTok = await routeRecipes(new Request('https://w/api/kp/sync/load', { method: 'POST', headers: { origin: 'https://www.kidposhan.in', authorization: 'Bearer kpy_notarealtoken' }, body: '{}' }), sEnv, ctx);
  ok(noTok.status === 401 && fakeTok.status === 401, 'Nobody can read a list by typing a number: no token or a made-up token gets nothing');
  const visitorTok = (await joinVisitor(env, { name: 'Someone', mobile: '9812345678' })).token;
  const asVisitor = await routeRecipes(new Request('https://w/api/kp/sync/load', { method: 'POST', headers: { origin: 'https://www.kidposhan.in', authorization: 'Bearer ' + visitorTok }, body: '{}' }), sEnv, ctx);
  ok(asVisitor.status === 401, 'Joining with the same (unverified) number does not open the saved list');
  await authed('/api/kp/sync/save', { saved: { 7: card(7, 'Dal Fry') }, plan: {} });
  ok(Object.keys((await (await authed('/api/kp/sync/load')).json()).saved).length === 1, 'Changes made on a device are saved under the verified number');
  for (let k = 0; k < 4; k++) await SY.startSync(sEnv, { mobile: '9700000001' }).catch(() => {});
  ok(/Too many codes/.test(await throwsMsg(() => SY.startSync(sEnv, { mobile: '9700000001' }))), 'Only three codes an hour go to one number');
  const nj = await joinVisitor(env, { name: 'No Email', mobile: '9811111111' });
  ok(!!nj.token, 'Joining needs a name and a mobile number only: no email');
}

// ---- tidier recipe pages and menus ----
{
  const C = await import('../../src/recipes/clean.js');
  const got = C.cleanIngredients(['1 large onion (finely chopped, (about 1 cup))', 'water (', 'salt (optional)', 'salt (to taste)', '1/2-1 cup water ((to adjust the dal consistency))', '2 tablespoons oil ((or ghee))'].map((t) => ({ raw_text: t, name: t })));
  ok(got.map((x) => x.name).join('|') === 'large onion (finely chopped, about 1 cup)|water|salt (to taste)|water (to adjust the dal consistency)|oil (or ghee)', 'Broken brackets are repaired and "salt" listed twice is shown once: ' + got.map((x) => x.name).join('|'));
  ok(got.find((x) => /consistency/.test(x.name)).qty_text === '1/2-1 cup', 'A range keeps its unit: 1/2-1 cup');
  const steps = ['Wash the dal 2-3 times.', 'Cook the dal.', 'Mash it.', 'Heat oil.', 'Add cumin.', 'Add tomato.', 'Mix.', 'Wash the dal 2-3 times until clear.', 'Press SAUTE.', 'Pressure cook.'];
  ok(C.singleMethod(steps).length === 7, 'When the stovetop and Instant Pot methods are joined, only the first (stovetop) is kept');
  ok(C.singleMethod([{ section: 'Instant Pot', text: 'a' }, { section: 'Stovetop', text: 'b' }, { section: 'Stovetop', text: 'c' }, { section: 'Instant Pot', text: 'd' }, { section: 'Instant Pot', text: 'e' }, { section: 'Stovetop', text: 'f' }]).every((s) => s.section === 'Stovetop'), 'Named methods: the stovetop one is preferred');
  ok(C.creditName("Swasthi's Recipes - Baby food") === "Swasthi's Recipes" && C.creditName('Vege Home Cooking - Jain') === 'Vege Home Cooking' && C.creditName('Culinary Chaser / Instagram') === 'Culinary Chaser', 'Credits show the creator, not our internal label');
  ok(!C.isRealMeal('Mirepoix') && !C.isRealMeal('Easy Green Bean Casserole Recipe') && !C.isRealMeal('Kids Garlic Bread') && C.isRealMeal('Dal Makhani') && !C.isRealMeal('Easy Halloumi Pasta') && !C.isRealMeal('Kids Garlic Bread'), 'A chopped-vegetable base and dishes that are not everyday meals (casserole, garlic bread, halloumi pasta) are not offered on any shelf, Indian, Asian or European');
  ok(C.dishKey('Dhal Curry') === C.dishKey('Dal Curry Recipe') && C.dishKey('Dal Fry') !== C.dishKey('Dal Makhani'), 'The same dish from two sites counts once');
  const did = mkRecipe('https://tidy.example/dalfry/', { status: 'approved', name: 'Tidy Dal Fry', score: 90 });
  db.prepare('DELETE FROM kp_recipe_ingredients WHERE recipe_id = ?').run(did);
  for (const [n, t, k] of [[1, '1-2 green chili (finely chopped)', 'green_chilli'], [2, 'salt (optional)', 'salt'], [3, 'salt (to taste)', 'salt']]) db.prepare('INSERT INTO kp_recipe_ingredients (recipe_id, position, raw_text, quantity, unit, name, ingredient_key, is_pantry) VALUES (?,?,?,?,?,?,?,0)').run(did, n, t, null, null, t, k);
  db.prepare('UPDATE kp_recipes SET instructions_json = ? WHERE id = ?').run(JSON.stringify(steps.map((t) => ({ section: null, text: t }))), did);
  const dd = await recipeDetail(env, did, { age: 60 });
  ok(dd.ingredients.length === 2 && dd.method.length === 7 && /chilli/i.test(dd.kid_note) && (await recipeDetail(env, did, { age: 132 })).kid_note === null, 'The recipe page shows clean ingredients, one method, and a chilli note for young children only');
  const twin1 = mkRecipe('https://tidy.example/tw1/', { status: 'approved', name: 'Dhal Curry', score: 80 }), twin2 = mkRecipe('https://tidy.example/tw2/', { status: 'approved', name: 'Dal Curry Recipe', score: 85 });
  let both = 0; for (let k = 0; k < 6; k++) { const r = (await (await handleRecipesApi(new Request('https://w/api/kp/recipes?age_months=60&occasion=lunch&pref=veg&season=all&limit=40&shuffle=1'), env, ctx)).json()).results.map((x) => x.id); if (r.includes(twin1) && r.includes(twin2)) both++; }
  ok(both === 0, 'The same dish never appears twice in one list');
}

// ---- the author's steps ----
{ const gId = mkRecipe('https://site.in/author-steps/', { status: 'approved', name: 'Author Steps Dish' }); const g = await (await handleRecipesApi(new Request('https://w/api/kp/recipes/' + gId), env, ctx)).json(); ok(g.method_by === 'creator' && g.method[0].text === 'Cook 1 cup rice for 10 minutes.', "Where the site has granted permission, the author's own steps are shown as they are, even if we hold wording of ours"); }


// ---- from various cooks and cookbooks ----
{
  const SRX = await import('../../src/recipes/search.js');
  for (const [sid, nm] of [[9101, 'Aunty Asha - Baby food'], [9102, 'Chef Ravi / Instagram'], [9103, 'The Millet Table']]) db.prepare("INSERT INTO kp_recipe_sources (id, name, url, notes, rights_status, world, status, active) VALUES (?,?,?,?,?,?,?,?)").run(sid, nm, 'https://cook' + sid + '.example/', '', 'granted', 'india', 'registered', 1);
  const cookRecipe = (sid, n, name) => { const id = mkRecipe('https://cook' + sid + '.example/' + n, { status: 'approved', name, score: 85 }); db.prepare('UPDATE kp_recipes SET source_id = ?, image_url = ?, age_min_months = 12, age_max_months = 144 WHERE id = ?').run(sid, 'https://img.example/' + id + '.jpg', id); return id; };
  for (let n = 0; n < 3; n++) { cookRecipe(9101, 'a' + n, 'Asha Dish ' + n); cookRecipe(9102, 'b' + n, 'Ravi Dish ' + n); cookRecipe(9103, 'c' + n, 'Millet Dish ' + n); }
  const shelf = await SRX.cooksShelf(env, { limit: 8, age: 60 });
  const names = shelf.cooks.map((c) => c.cook);
  ok(['Aunty Asha', 'Chef Ravi', 'The Millet Table'].every((c) => names.includes(c)) && new Set(names).size === names.length, 'The shelf has one recipe from each of several different cooks, credited by the creator\'s name only: ' + names.join(', '));
  const http = await routeRecipes(new Request('https://w/api/kp/cooks?age_months=60', { headers: { origin: 'https://www.kidposhan.in' } }), env, ctx);
  ok(http.status === 200 && Array.isArray((await http.json()).cooks), 'The home page can ask for the cooks shelf');
}


// ---- traffic for the admin page ----
{
  const TR = await import('../../src/recipes/traffic.js');
  ok(TR.normalizePath('/Products/') === '/products' && TR.normalizePath('/index.html') === '/' && TR.normalizePath('/meal-ideas/recipe/12') === '/meal-ideas/recipe/12' && TR.normalizePath('http://evil') === null && TR.normalizePath('/a b') === null, 'Page addresses are tidied, and odd ones are refused');
  ok(TR.isBot('Mozilla/5.0 (compatible; Googlebot/2.1)') && TR.isBot('') && TR.isBot('Lighthouse') && TR.isBot('Mozilla/5.0 HeadlessChrome') && !TR.isBot('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36'), 'Crawlers, headless browsers and empty agents are bots; a phone browser is not');
  const human = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36';
  const hit = (path, vid, extra = {}) => routeRecipes(new Request('https://w/api/kp/pv', { method: 'POST', headers: { origin: 'https://www.kidposhan.in', 'user-agent': extra.ua ?? human, 'cf-ipcountry': extra.country ?? 'IN', 'content-type': 'text/plain' }, body: JSON.stringify({ vid, path }) }), env, ctx);
  const a = await (await hit('/products', 'aaaaaaaaaaaaaaaa01', { country: 'IN' })).json();
  const b = await (await hit('/products', 'bbbbbbbbbbbbbbbb02', { country: 'US' })).json();
  await hit('/products', 'aaaaaaaaaaaaaaaa01', { country: 'IN' });
  await hit('/', 'aaaaaaaaaaaaaaaa01', { country: 'IN' });
  const botHit = await (await hit('/products', 'cccccccccccccccc03', { ua: 'Googlebot/2.1' })).json();
  ok(a.ok && a.id && a.tok && b.id && botHit.bot === true && !botHit.id, 'A visit returns the ids needed to report its time; a bot visit is noted but gets none');
  const timeHit = (id, tok, seconds) => routeRecipes(new Request('https://w/api/kp/pv/time', { method: 'POST', headers: { origin: 'https://www.kidposhan.in', 'content-type': 'text/plain' }, body: JSON.stringify({ id, tok, seconds }) }), env, ctx);
  await timeHit(a.id, a.tok, 60); await timeHit(b.id, b.tok, 30);
  await timeHit(b.id, 'wrongtoken', 9999);
  await timeHit(a.id, a.tok, 99999);
  const rep = await TR.trafficReport(env, { days: 30 });
  const prod = rep.pages.find((p) => p.path === '/products');
  ok(rep.totals.visitors === 2 && rep.totals.views === 4 && rep.totals.bots_excluded === 1 && prod.views === 3 && prod.visitors === 2, 'Real visitors and views are counted per page, and the bot is left out: ' + JSON.stringify(rep.totals));
  ok(prod.avg_seconds === Math.round((1800 + 30) / 2), 'Average time is per page, the time is capped at 30 minutes, and a wrong secret cannot change it: ' + prod.avg_seconds);
  ok(rep.countries.find((c) => c.country === 'IN').visitors === 1 && rep.countries.find((c) => c.country === 'US').visitors === 1, 'Visitors are counted by country');
  const only = await TR.trafficReport(env, { days: 30, path: '/' });
  ok(only.countries.length === 1 && only.countries[0].country === 'IN' && only.cities.length === 1, 'The locations table can be limited to one page');
  const adm = await routeRecipes(new Request('https://w/api/kp/admin/traffic?days=7'), { ...env, ADMIN_TOKEN: 't' }, ctx);
  const adm2 = await routeRecipes(new Request('https://w/api/kp/admin/traffic?days=7', { headers: { 'x-admin-token': 't' } }), { ...env, ADMIN_TOKEN: 't' }, ctx);
  ok(adm.status === 401 && adm2.status === 200 && (await adm2.json()).totals.visitors === 2, 'The traffic report needs the admin token');
  ok(!JSON.stringify(db.prepare('SELECT * FROM kp_pageviews').all()).includes('1.2.3'), 'No IP address is kept');
}


// ---- popular products from Open Food Facts ----
{
  const OF = await import('../../src/recipes/openfood.js');
  ok(OF.kindFor(['en:breakfast-cereals', 'en:cereals-and-potatoes'], 'Kellogg\'s Corn Flakes') === 'breakfast_cereal' && OF.kindFor(['en:instant-noodles'], 'Maggi 2-minute Masala') === 'instant_noodles' && OF.kindFor([], 'Bournvita Health Drink') === 'health_drink' && OF.kindFor(['en:biscuits'], 'Parle-G') === 'kids_biscuits' && OF.kindFor(['en:spices'], 'Garam masala powder') === null, 'A product is matched to one of our kinds of food, and spices and the like are left out');
  ok(OF.splitIngredients('Wheat flour (maida), Sugar, Spices [Chilli, Cumin], Salt.').join('|') === 'Wheat flour (maida)|Sugar|Spices [Chilli, Cumin]|Salt', 'Ingredient lists split at commas outside brackets');
  const base = { code: '8901058000290', product_name: 'Masala Noodles', brands: 'Maggi, Nestle', quantity: '70 g', unique_scans_n: 900, categories_tags: ['en:instant-noodles'], ingredients_text: 'Wheat flour, Palm oil, Salt, Flavour enhancer (INS 627)', image_front_url: 'https://img.off/front.jpg', image_nutrition_url: 'https://img.off/nutri.jpg',
    nutriments: { proteins_100g: 8.2, fiber_100g: 2.1, sugars_100g: 1.9, 'saturated-fat_100g': 6.5, salt_100g: 3.2 } };
  const m1 = OF.mapProduct(base);
  ok(m1.kind === 'instant_noodles' && m1.brand === 'Maggi' && m1.name === 'Maggi Masala Noodles' && Math.abs(m1.nutrition.sodium_mg - 1280) < 1 && m1.estimated === true && m1.nutrition.added_sugars_g === 1.9, 'Salt on the label becomes sodium (3.2 g salt = 1,280 mg), and total sugars stand in for missing added sugar, marked estimated: ' + JSON.stringify(m1.nutrition));
  const m2 = OF.mapProduct({ ...base, nutriments: { ...base.nutriments, 'added-sugars_100g': 0.5, salt_100g: undefined, sodium_100g: 0.4 } });
  ok(m2.estimated === false && m2.nutrition.added_sugars_g === 0.5 && Math.abs(m2.nutrition.sodium_mg - 400) < 0.1, 'A printed added-sugar line is used as it is, and sodium in grams becomes milligrams');
  const imp = OF.mapProduct({ ...base, code: '5000159484695' });
  ok(!imp.skip && imp.foreign_barcode === true && OF.mapProduct(base).foreign_barcode === false, 'An imported brand sold in India is taken, and a barcode that is not an Indian one (890) is flagged for the owner to check');
  ok(OF.mapProduct({ ...base, brands: '' }).skip && OF.mapProduct({ ...base, code: '123' }).skip && OF.mapProduct({ ...base, nutriments: { proteins_100g: 8 } }).skip === 'label incomplete' && OF.mapProduct({ ...base, categories_tags: ['en:spices'], product_name: 'Chilli powder' }).skip, 'A product with no brand, no barcode, an incomplete label or a kind we do not score is skipped');

  const seen = [];
  const page = (products) => async (u, init) => { seen.push({ url: String(u), ua: init?.headers?.['user-agent'] }); return { ok: true, status: 200, text: async () => JSON.stringify({ products }) }; };
  const dupe = { ...base, code: '8901058000291' };                                                            // a second barcode of the same name is a different pack
  const r1 = await OF.importOffNext(env, page([base, { ...base }, dupe, { ...base, code: '8901058000292', nutriments: { proteins_100g: 1 } }]));
  ok(r1.key === 'off:brand:maggi' && r1.added === 2 && r1.known === 1 && r1.skipped['label incomplete'] === 1, 'The first run searches the first brand; each barcode is added once: ' + JSON.stringify(r1));
  ok(/brands_tags=maggi/.test(seen[0].url) && /countries_tags_en=india/.test(seen[0].url) && /KidPoshan/.test(seen[0].ua || ''), 'The request asks for Indian products of that brand and names KidPoshan');
  const row = db.prepare("SELECT status, score_status, label_source, retailer, barcode, data_source, popularity, nutrition_json FROM kp_ready_products WHERE barcode = '8901058000290'").get();
  ok(row.status === 'candidate' && row.score_status === 'exact' && row.retailer === 'openfoodfacts' && row.data_source === 'openfoodfacts' && row.popularity === 900 && JSON.parse(row.nutrition_json).added_sugar_estimated === true, 'An imported product waits for approval as a candidate, with its source and popularity');
  const slow = await OF.importOffNext(env, async () => ({ ok: true, status: 200, text: async () => '<html>Page temporarily unavailable</html>' }));
  ok(slow.slowdown === true, 'When Open Food Facts says it is unavailable, the run stops quietly');
  ok(db.prepare("SELECT runs FROM kp_ready_research WHERE kind = 'off:brand:maggi'").get().runs === 999, 'A short page finishes that search');
  const r2 = await OF.importOffNext(env, page([]));
  ok(r2.key === 'off:brand:bournvita' && r2.page === 1, 'The next run moves on to the next brand (the slow-down run did not use one up)');
  const r3 = await OF.importOffNext(env, page([]));
  ok(r3.key === 'off:brand:horlicks' || r3.key === 'off:brand:cerelac', 'And then the one after: ' + r3.key);
  const noTok = await routeRecipes(new Request('https://w/api/kp/admin/products/import-off', { method: 'POST' }), { ...env, ADMIN_TOKEN: 't' }, ctx);
  ok(noTok.status === 401, 'Importing needs the admin token');
}

{ const { toPoints } = await import('../../src/recipes/clean.js'); const p = toPoints([{ text: 'Step 1: Heat oil in a pan. Add cumin and let it splutter. Add the onions and fry until golden brown, stirring often so they do not catch. Add the tomatoes and cook until soft and the oil separates from the masala.' }, { text: 'Serve hot.' }]); ok(p.length === 5 && p[0].text === 'Heat oil in a pan.' && p[4].text === 'Serve hot.', 'A long paragraph of method becomes one point per sentence; short steps stay as they are'); }

// ---- the scanner ----
{
  const S = await import('../../src/recipes/scan.js');
  ok(S.normalizeCode('8901058000290') === '8901058000290' && S.normalizeCode('890 1058 000290') === '8901058000290' && S.normalizeCode('036000291452') === '0036000291452' && S.normalizeCode('12345') === null && S.normalizeCode('abc') === null, 'Barcodes are cleaned to 8 or 13 digits; anything else is not a barcode');
  const offFetch = (product, status = 200) => async () => ({ ok: status === 200, status, text: async () => JSON.stringify(product === undefined ? { status: 0 } : { status: 1, product }) });
  const bad = await S.scanLookup(env, '123', {});
  ok(bad.status === 'bad_code', 'A short number is not accepted as a barcode');
  const miss = await S.scanLookup(env, '8909990000011', { fetchFn: offFetch(undefined, 404) });
  ok(miss.status === 'need_photos' && miss.kinds.length > 20 && /photograph/i.test(miss.message), 'A pack nobody has recorded asks for the two photos, and offers the kinds of food to choose from');
  const slow = await S.scanLookup(env, '8909990000012', { fetchFn: async () => ({ ok: false, status: 503, text: async () => '' }) });
  ok(slow.status === 'need_photos' && /busy/i.test(slow.message), 'When Open Food Facts is busy the parent is asked for photos, not shown an error');
  const full = { code: '8909990000013', product_name: 'Test Oats', brands: 'Testco', quantity: '400 g', categories_tags: ['en:breakfast-cereals', 'en:oat-flakes'], ingredients_text: 'Rolled oats', nutriments: { proteins_100g: 12, fiber_100g: 10, sugars_100g: 1, 'saturated-fat_100g': 1.2, sodium_100g: 0.01 } };
  const hit = await S.scanLookup(env, '8909990000013', { age: '4-6y', fetchFn: offFetch(full) });
  ok(hit.status === 'found' && hit.listed === false && hit.product.score > 0 && hit.product.metrics.length === 10 && hit.product.barcode === '8909990000013', 'A pack Open Food Facts knows fully is scored at once, and is not listed until approved');
  const again = await S.scanLookup(env, '8909990000013', { age: '1-3y', fetchFn: async () => { throw new Error('should not be asked again'); } });
  ok(again.status === 'found' && again.product.age === '1-3y', 'The second scan comes from our own database, for the age chosen');
  const OFX = await import('../../src/recipes/openfood.js');
  const kinds = (await S.scanLookup(env, '8909990000070', { fetchFn: offFetch(undefined, 404) })).kinds;
  const find = (w) => kinds.filter((k) => (k.label + ' ' + k.words).toLowerCase().includes(w)).map((k) => k.kind);
  ok(kinds.length >= 60 && find('custard').includes('custard_powder') && find('toffee').includes('candy_toffee') && find('maggi').includes('instant_noodles') && find('pickle').includes('pickle_chutney'), 'The list of kinds of food is wide, and each carries the words people use for it: ' + kinds.length);
  ok(OFX.kindFor(['en:custard-powders'], 'Brown & Polson Custard Powder') === 'custard_powder' && OFX.kindFor(['en:ice-creams'], 'Amul Vanilla Ice Cream') === 'ice_cream' && OFX.kindFor(['en:chocolates'], 'Dairy Milk') === 'chocolate' && OFX.kindFor(['en:biscuits'], 'Chocolate Biscuit') === 'kids_biscuits', 'More foods are recognised on their own, without disturbing the old ones');
  ok(OFX.kindFor(['en:soups', 'en:dehydrated-soups'], 'Knorr Sweet Corn Vegetable Soup') === 'instant_soup', 'Soups are a kind we score');
  const odd = { code: '8909990000060', product_name: 'Tamarind Concentrate', brands: 'Testco', categories_tags: ['en:condiments'], ingredients_text: 'Tamarind', nutriments: { proteins_100g: 3, fiber_100g: 5, sugars_100g: 30, 'saturated-fat_100g': 0.1, sodium_100g: 0.2 } };
  const ck = await S.scanLookup(env, '8909990000060', { fetchFn: offFetch(odd) });
  ok(ck.status === 'choose_kind' && ck.kinds.length > 20, 'When the kind cannot be told the parent is asked to choose it, not turned away');
  const ck2 = await S.scanLookup(env, '8909990000060', { kind: 'jam', age: '4-6y', fetchFn: offFetch(odd) });
  ok(ck2.status === 'found' && ck2.product.kind_label.startsWith('Jam'), 'Once a kind is chosen the pack is scored');
  const spice = await S.scanLookup(env, '8909990000014', { fetchFn: offFetch({ code: '8909990000014', product_name: 'Garam Masala', brands: 'Testco', categories_tags: ['en:spices'], nutriments: { proteins_100g: 12, fiber_100g: 10, sugars_100g: 1, 'saturated-fat_100g': 1, sodium_100g: 0.1 } }) });
  ok(spice.status === 'not_scored', 'A food we do not score (spices) says so');

  const labelJson = JSON.stringify({ nutrition_found: true, serving_size_g: null, per_100g: { protein_g: 9, fibre_g: 6, sugars_g: 3, added_sugars_g: 1, saturated_fat_g: 1.5, sodium_mg: 200 }, per_serving: null, ingredients: ['Whole wheat flour', 'Sugar', 'Salt'] });
  const aiOk = { ...env, AI: { run: async () => ({ response: labelJson }) } };
  const aiBusy = { ...env, AI: { run: async () => { throw new Error('4006: you have used up your daily free allocation'); } } };
  const jpg = 'data:image/jpeg;base64,/9j/4AAQ';
  const good = { barcode: '8909990000021', kind: 'kids_biscuits', brand: 'Testco', name: 'Wheat Biscuits', front: jpg, back: jpg, ingredients: jpg, consent: true };
  const noPhoto = await S.scanSubmit(aiOk, { ...good, back: '' }, { who: 'w1', origin: 'https://p' }).catch((e) => e);
  ok(noPhoto instanceof S.ScanError && /back/.test(noPhoto.message), 'The back photo is needed');
  const noIng = await S.scanSubmit(aiOk, { ...good, barcode: '8909990000040', ingredients: '' }, { who: 'w4', origin: 'https://p' });
  ok(noIng.status === 'found' && db.prepare("SELECT COUNT(*) n FROM kp_scan_photos WHERE product_id = (SELECT id FROM kp_ready_products WHERE barcode = '8909990000040')").get().n === 2, 'Two photos are enough: the front and the back, which carries the table and the ingredients');
  const noKind = await S.scanSubmit(aiOk, { ...good, kind: 'nonsense' }, { who: 'w1', origin: 'https://p' }).catch((e) => e);
  ok(noKind instanceof S.ScanError, 'The kind of food must be one of ours');
  const sent = await S.scanSubmit(aiOk, good, { who: 'w1', origin: 'https://p', age: '4-6y' });
  ok(sent.status === 'found' && sent.saved && sent.listed === false && sent.product.score > 0, 'Photos are read, the pack is scored and shown at once, and it waits for approval: ' + JSON.stringify(sent).slice(0, 200));
  const row = db.prepare("SELECT data_source, status, image_url, label_image_url, label_source FROM kp_ready_products WHERE barcode = '8909990000021'").get();
  ok(row.data_source === 'scan' && row.status === 'candidate' && /scan\/photo\/\d+\/front$/.test(row.image_url) && /\/back$/.test(row.label_image_url), 'The scanned pack is saved as a candidate with links to its two photos');
  const pid = db.prepare("SELECT id FROM kp_ready_products WHERE barcode = '8909990000021'").get().id;
  const ph = await routeRecipes(new Request('https://w/api/kp/scan/photo/' + pid + '/front'), env, ctx);
  ok(ph.status === 200 && ph.headers.get('content-type') === 'image/jpeg', 'The saved photo can be shown');
  const dupe = await S.scanSubmit(aiOk, good, { who: 'w1', origin: 'https://p' });
  ok(dupe.status === 'found' && db.prepare("SELECT COUNT(*) n FROM kp_ready_products WHERE barcode = '8909990000021'").get().n === 1, 'The same barcode is never saved twice');
  const busy = await S.scanSubmit(aiBusy, { ...good, barcode: '8909990000022' }, { who: 'w2', origin: 'https://p' });
  ok(busy.status === 'saved' && busy.retry === true, 'When the label reader is busy the photos are kept and the parent is told to come back');
  const pend = await S.readScansPending(aiOk, { limit: 5 });
  ok(pend.length === 0, 'It is not tried again straight away');
  db.prepare("UPDATE kp_ready_products SET label_tried_at = datetime('now','-4 hours') WHERE barcode = '8909990000022'").run();
  const pend2 = await S.readScansPending(aiOk, { limit: 5 });
  ok(pend2.length === 1 && pend2[0].ok && pend2[0].status === 'exact', 'Later the reader is tried again and the pack is scored');
  let limited = null;
  for (let k = 0; k < 10 && !limited; k++) limited = await S.scanSubmit(aiOk, { ...good, barcode: '89099900001' + String(30 + k) }, { who: 'w3', origin: 'https://p' }).then(() => null, (e) => e);
  ok(limited instanceof S.ScanError && limited.status === 429, 'One phone can only send so many packs in an hour');
  // condensed milk: a label that does not print fibre at all
  const milkJson = JSON.stringify({ nutrition_found: true, serving_size_g: null, per_serving: null, per_100g: { energy_kcal: 330, protein_g: 8, carbohydrate_g: 55.5, total_fat_g: 9, fibre_g: null, sugars_g: 55.5, added_sugars_g: 43, saturated_fat_g: 2.6, sodium_mg: 110 }, ingredients: ['Milk', 'Sugar'] });
  const milk = await S.scanSubmit({ ...env, AI: { run: async () => ({ response: milkJson }) } }, { ...good, barcode: '8909990000050', kind: 'flavoured_milk', name: 'Sweetened Condensed Milk', brand: 'Testco' }, { who: 'w5', origin: 'https://p' });
  ok(milk.status === 'found' && milk.product.score > 0 && /fibre is not printed/.test(milk.product.label_note), 'A milk label that prints no fibre is still scored (fibre taken as 0, said in the note)');
  // a pack whose photo could not be read: the parent is asked for the back photo again, and a good one finishes the job
  const noTab = JSON.stringify({ nutrition_found: false });
  const aiNo = { ...env, AI: { run: async () => ({ response: noTab }) } };
  const unread = await S.scanSubmit(aiNo, { ...good, barcode: '8909990000080', name: 'Sauce Pouch', kind: 'ketchup' }, { who: 'w6', origin: 'https://p' });
  ok(unread.status === 'saved' && /could not be read/.test(unread.message), 'A photo with no readable table is saved and said so');
  const ask = await S.scanLookup(env, '8909990000080', {});
  ok(ask.status === 'retake' && /take the back photo again/.test(ask.message), 'Scanning that pack again asks for a better back photo, not that we are reading it');
  const keChk = JSON.stringify({ nutrition_found: true, serving_size_g: 15, per_100g: { energy_kcal: 100, protein_g: 1.2, carbohydrate_g: 24, total_fat_g: 0.1, fibre_g: 0.4, sugars_g: 22, added_sugars_g: 18, saturated_fat_g: 0, sodium_mg: 900 }, ingredients: ['Tomato', 'Sugar', 'Salt'] });
  const redo = await S.scanRetake({ ...env, AI: { run: async () => ({ response: keChk }) } }, { barcode: '8909990000080', back: jpg, consent: true }, { who: 'w6', origin: 'https://p', age: '4-6y' });
  ok(redo.status === 'found' && redo.product.score > 0 && redo.product.nutrition_per_100g.serving_g === 15, 'A new back photo reads, scores the pack, and keeps its printed serving');
  const again2 = await S.scanRetake(aiNo, { barcode: '8909990000080', back: jpg, consent: true }, { who: 'w6', origin: 'https://p' });
  ok(again2.status === 'found', 'A pack that already has a score cannot be overwritten by a new photo');
  // the biggest claim, against the ingredient list
  const CL = await import('../../src/recipes/claims.js');
  const c1 = CL.headlineClaim('Dabur Pure Honey', ['Honey']);
  ok(c1.claim === 'Honey' && c1.percent === 100 && /only ingredient/.test(c1.verdict), 'Pure honey with honey as the only ingredient: 100%');
  const c2 = CL.headlineClaim('Honey Oats Crunch', ['Rolled oats (62%)', 'Sugar', 'Honey (3%)', 'Salt']);
  ok(c2.claim === 'Honey' && c2.percent === 3 && c2.position === 3 && /3% of the pack is Honey/.test(c2.verdict), 'The honey in a honey cereal: 3%, third in the list');
  const c3 = CL.headlineClaim('Maggi Masala Veg Atta Noodles', ['Noodles: Wheat Flour (Atta) (84.2%)', 'Palm oil', 'Iodised salt']);
  ok(c3.claim === 'Whole wheat' && c3.percent === 84.2, 'Atta noodles: the atta is 84.2% of the noodle part');
  const c4 = CL.headlineClaim('Real Mango Fruit Drink', ['Water', 'Sugar', 'Acidity regulator', 'Mango pulp (10%)']);
  ok(c4.claim === 'Mango' && c4.percent === 10, 'A mango drink with 10% mango pulp');
  const c5 = CL.headlineClaim('Mango Delight', ['Water', 'Sugar', 'Colour', 'Flavour']);
  ok(c5.found === false && /no mango appears/.test(c5.verdict), 'A mango name with no mango in the list says so');
  const c6 = CL.headlineClaim('Multigrain Bread', ['Wheat flour', 'Water', 'Oats', 'Ragi flour', 'Yeast', 'Salt']);
  ok(c6.claim === 'Multigrain' && c6.grains.length >= 3 && c6.percent === null && /does not print how much/.test(c6.verdict), 'Multigrain lists the grains and says when the amounts are not printed');
  ok(CL.headlineClaim('Crunchy Munchies', ['Corn', 'Oil']) === null, 'A name with no claim gives no claim card');
  const detail = PR.detailFromRow({ id: 1, name: 'Dabur Pure Honey', kind: 'sweeteners', score_status: 'exact', kidposhan_score: 40, status: 'approved', nutrition_json: JSON.stringify({ protein_g: 0.3, fibre_g: 0, sugars_g: 80, added_sugars_g: 80, saturated_fat_g: 0, sodium_mg: 5 }), ingredients_json: '["Honey"]' }, '');
  ok(detail && detail.claim && detail.claim.percent === 100, 'The product detail carries the claim');
  // unchecked packs are findable (flagged), and a parent whose pack differs replaces the entry with their own photos
  const SE = await import('../../src/recipes/search.js');
  const offRow = { code: '8909990000090', product_name: 'Zorbo Crunchy Oat Biscuit', brands: 'Zorbo', categories_tags: ['en:biscuits'], ingredients_text: 'Oats, Sugar, Salt', nutriments: { proteins_100g: 7, fiber_100g: 5, sugars_100g: 20, 'saturated-fat_100g': 4, sodium_100g: 0.3 } };
  await S.scanLookup(env, '8909990000090', { fetchFn: offFetch(offRow) });
  const found1 = await SE.searchAll(env, 'zorbo', { age: 60 });
  ok(found1.products.length === 1 && found1.products[0].unchecked === true && found1.products[0].source === 'openfoodfacts', 'A scored pack nobody has approved yet is found by search, flagged as not yet checked');
  const pid2 = found1.products[0].id;
  const det = await PR.productDetail(env, pid2, {});
  ok(det && det.listed === false && det.barcode === '8909990000090', 'Its detail opens, and says it is not listed');
  const plain = await PR.listProducts(env, { limit: 200 });
  ok(!plain.items.some((x) => x.id === pid2), 'The Products page itself still shows only approved packs');
  const fixAsk = await S.scanLookup(env, '8909990000090', { fix: true });
  ok(fixAsk.status === 'need_photos' && fixAsk.fix === true && fixAsk.prefill.name === 'Zorbo Crunchy Oat Biscuit', 'A parent who says the name differs is asked to photograph their own pack');
  const fixLabel = JSON.stringify({ nutrition_found: true, serving_size_g: 30, per_100g: { energy_kcal: 480, protein_g: 6, carbohydrate_g: 70, total_fat_g: 19, fibre_g: 3, sugars_g: 22, added_sugars_g: 20, saturated_fat_g: 8, sodium_mg: 400 }, ingredients: ['Wheat flour', 'Sugar', 'Palm oil'] });
  const fixed = await S.scanSubmit({ ...env, AI: { run: async () => ({ response: fixLabel }) } }, { ...good, barcode: '8909990000090', kind: 'kids_biscuits', brand: 'Zorbo', name: 'Zorbo Wheat Biscuit', correct: true }, { who: 'w7', origin: 'https://p', age: '4-6y' });
  ok(fixed.status === 'found' && fixed.product.name === 'Zorbo Wheat Biscuit' && db.prepare("SELECT data_source ds FROM kp_ready_products WHERE barcode = '8909990000090'").get().ds === 'scan', 'The entry is replaced by what the parent photographed, and scored from it');
  db.prepare("UPDATE kp_ready_products SET status = 'approved' WHERE barcode = '8909990000090'").run();
  const noFix2 = await S.scanSubmit(aiOk, { ...good, barcode: '8909990000090', name: 'Hijack Two', correct: true }, { who: 'w7', origin: 'https://p' });
  ok(db.prepare("SELECT name FROM kp_ready_products WHERE barcode = '8909990000090'").get().name === 'Zorbo Wheat Biscuit', 'A pack the owner has approved cannot be replaced this way');
  // the beta: consent, optional thank-you email, mistake reports
  const BE = await import('../../src/recipes/beta.js');
  const noConsent = await S.scanSubmit(aiOk, { ...good, barcode: '8909990000110', consent: undefined }, { who: 'w8', origin: 'https://p' }).catch((x) => x);
  ok(noConsent instanceof S.ScanError && /tick the box/.test(noConsent.message), 'Photos are not taken without the tick that they are the sender\'s to share');
  const badMail = await S.scanSubmit(aiOk, { ...good, barcode: '8909990000111', email: 'not-an-email' }, { who: 'w8', origin: 'https://p' }).catch((x) => x);
  ok(badMail instanceof BE.BetaError, 'A mistyped email is refused, and an empty one is fine');
  const withMail = await S.scanSubmit(aiOk, { ...good, barcode: '8909990000112', email: 'Parent@Example.com' }, { who: 'w8', origin: 'https://p' });
  const cid = db.prepare("SELECT id FROM kp_ready_products WHERE barcode = '8909990000112'").get().id;
  ok(withMail.status === 'found' && db.prepare('SELECT email FROM kp_contrib WHERE product_id = ?').get(cid).email === 'parent@example.com', 'The optional email is kept, lower-cased');
  const sentMail = [];
  const th0 = await BE.thankPending(env, { send: async (_e, to, subj, body) => sentMail.push({ to, subj, body }) });
  ok(th0.sent === 0, 'No thank-you goes out while the pack is still unchecked');
  db.prepare("UPDATE kp_ready_products SET status = 'approved' WHERE id = ?").run(cid);
  const th1 = await BE.thankPending(env, { send: async (_e, to, subj, body) => sentMail.push({ to, subj, body }) });
  const th2 = await BE.thankPending(env, { send: async (_e, to, subj, body) => sentMail.push({ to, subj, body }) });
  ok(th1.sent === 1 && th2.sent === 0 && sentMail.length === 1 && sentMail[0].to === 'parent@example.com' && /Thank you/.test(sentMail[0].subj), 'Once the pack is approved the sender is thanked, once');
  ok((await BE.thankPending(env, {})).skipped, 'Without Gmail connected, nothing is sent and nothing breaks');
  const rep1 = await BE.submitReport(env, { reason: 'name', product_id: cid, note: 'The pack says Zorbo Gold' }, { who: 'w9' });
  const rep2 = await BE.submitReport(env, { reason: 'other', product_id: cid, note: 'x' }, { who: 'w9' }).catch((x) => x);
  const list = await BE.listReports(env, {});
  ok(rep1.ok && rep2 instanceof BE.BetaError && list.reports.length === 1 && list.reports[0].product_name, 'A mistake report is saved against the pack; a vague "other" is refused');
  await BE.resolveReport(env, list.reports[0].id);
  ok((await BE.listReports(env, {})).reports.length === 0 && (await BE.listReports(env, { status: 'done' })).reports.length === 1, 'Resolving a report moves it out of the open list');
  const viaRoute = await routeRecipes(new Request('https://w/api/kp/report', { method: 'POST', headers: { origin: 'https://www.kidposhan.in' }, body: JSON.stringify({ reason: 'photo', barcode: '8909990000112' }) }), env, ctx);
  ok(viaRoute.status === 200 && (await routeRecipes(new Request('https://w/api/kp/admin/reports', { headers: { 'x-admin-token': 't' } }), { ...env, ADMIN_TOKEN: 't' }, ctx)).status === 200, 'The report button reaches the server, and the admin can read the list');
  const bs = await BE.betaStats(env);
  ok(bs.checked >= 1 && bs.from_parents >= 1 && bs.contributors >= 1, 'The counts for the Built with parents page');
  // a snack or sweet has half the room of a meal for sugar, sodium and saturated fat
  const RDY = await import('../../src/recipes/ready.js');
  const sameFood = { protein_g: 6, fibre_g: 3, added_sugars_g: 0, saturated_fat_g: 2, sodium_mg: 600 };
  const asMeal = RDY.scorePack({ ...sameFood, serving_g: 50 }, ['Wheat flour', 'Salt'], 'Test', 'whole_wheat_atta'), asSnack = RDY.scorePack({ ...sameFood, serving_g: 50 }, ['Wheat flour', 'Salt'], 'Test', 'chips');
  const mm = Object.fromEntries(asMeal.detail.bands['4-6'].metrics.map((x) => [x.id, x])), sm = Object.fromEntries(asSnack.detail.bands['4-6'].metrics.map((x) => [x.id, x]));
  ok(RDY.SNACK_KINDS.has('chips') && !RDY.SNACK_KINDS.has('whole_wheat_atta') && mm.sodium.share === sm.sodium.share && sm.sodium.score < mm.sodium.score && mm.sodium.score === 1 && sm.sodium.score === 0, 'The same label fails sodium as a snack (fails at 15% of the day) but passes as a meal (fails at 30%): ' + mm.sodium.score + ' vs ' + sm.sodium.score);
  const viaApi = await routeRecipes(new Request('https://w/api/kp/scan/lookup?code=8909990000013&age=7-9y', { headers: { origin: 'https://www.kidposhan.in' } }), env, ctx);
  const viaJson = await viaApi.json();
  ok(viaApi.status === 200 && viaApi.headers.get('access-control-allow-origin') === 'https://www.kidposhan.in' && viaJson.status === 'found', 'The lookup is reachable from the main site');
}


// ---- reading a label photo: the label's own arithmetic ----
{
  const LB = await import('../../src/recipes/label.js');
  ok(LB.addsUp({ energy: 601.62, protein: 26.54, carb: 19.57, fat: 44.42 }) === true && LB.addsUp({ energy: 600, protein: 8.4, carb: 1.1, fat: 8.0 }) === false && LB.addsUp({ energy: null, protein: 1, carb: 1, fat: 1 }) === null, 'Energy, protein, carbohydrate and fat are checked against each other (4, 4 and 9 kcal a gram)');
  // a table with only an "Amount per 100g" column and a column of percentages: a model puts the percentages in per_serving
  const d = { nutrition_found: true, serving_size_g: 28,
    per_serving: { energy_kcal: 8.4, protein_g: 8.4, carbohydrate_g: 8.02, total_fat_g: 18.56, fibre_g: 8.02, sugars_g: null, added_sugars_g: 0, saturated_fat_g: 10.83, sodium_mg: 8.02 },
    per_100g: { energy_kcal: 601.62, protein_g: 26.54, carbohydrate_g: 19.57, total_fat_g: 44.42, fibre_g: 8.7, sugars_g: 1.1, added_sugars_g: 0, saturated_fat_g: 8.51, sodium_mg: 573.02 }, ingredients: ['Sunflower seeds'] };
  const r = LB.labelFrom(d);
  ok(r.ok && r.how === 'per 100 g column' && r.label.protein_g === 26.54 && r.label.sodium_mg === 573.02, 'A column of percentages mistaken for per-serving amounts is not used: the numbers that add up are: ' + JSON.stringify(r.label));
  const good = { label: { protein_g: 26.54, fibre_g: 8.7, sugars_g: 1.1, added_sugars_g: 0, saturated_fat_g: 8.51, sodium_mg: 573 }, check: { energy: 601.62, protein: 26.54, carb: 19.57, fat: 44.42 }, ingredients: ['Sunflower seeds'] };
  const bad = { label: { protein_g: 9.1, fibre_g: 2.4, sugars_g: 1.1, added_sugars_g: 0, saturated_fat_g: 3.1, sodium_mg: 640 }, check: { energy: 601.62, protein: 9.1, carb: 19.57, fat: 44.42 }, ingredients: null };
  const v = LB.voteReadings([bad, good, { ...good, label: { ...good.label, sodium_mg: 573.4 } }]);
  ok(v.label.protein_g === 26.54 && v.label.sodium_mg === 573 && /agree/.test(v.notes[0]), 'Three readings: two that agree outvote a third that does not');
  const v2 = LB.voteReadings([bad, good]);
  ok(v2.label.protein_g === 26.54 && v2.label.saturated_fat_g === 8.51, 'With two readings that disagree, the one whose numbers add up wins');
  // jelly crystals: a reader copied the 100 g numbers into the per-serving column too (scaled by 100/18 they are absurd): the printed 100 g column is used
  const jelly = LB.labelFrom({ nutrition_found: true, serving_size_g: 18, per_serving: { energy_kcal: 71, protein_g: 0.4, carbohydrate_g: 18, total_fat_g: 0.1, added_sugars_g: 91.8, sodium_mg: 8.7 }, per_100g: { energy_kcal: 396, protein_g: 0.4, carbohydrate_g: 98.5, total_fat_g: 0.1, added_sugars_g: 91.8, sodium_mg: 8.7 } });
  ok(jelly.ok && jelly.how === 'per 100 g column' && jelly.label.added_sugars_g === 91.8, 'A serving column that is really the 100 g numbers does not sink the reading: ' + JSON.stringify(jelly.label));
  // vermicelli: one reader left saturated fat blank and the other read it. That is not a contradiction.
  const lionA = { label: { protein_g: 8, fibre_g: 2, sugars_g: 0, added_sugars_g: 0, saturated_fat_g: null, sodium_mg: null }, check: { energy: 380, protein: 8, carb: 84, fat: 1 }, ingredients: ['Rice'] };
  const lionB = { label: { protein_g: 8, fibre_g: 2, sugars_g: 0, added_sugars_g: 0, saturated_fat_g: 2, sodium_mg: 10 }, check: { energy: 380, protein: 8, carb: 84, fat: 1 }, ingredients: ['Rice'] };
  const lv = LB.voteReadings([lionA, lionB]);
  ok(lv.label.saturated_fat_g === 2 && lv.label.sodium_mg === 10 && /one reader only/.test(lv.notes[0]), 'A value one reader saw and the other left blank is kept, flagged for checking: ' + lv.notes[0]);
  ok(LB.servingOf([{ serving_g: 28 }, { serving_g: 28.5 }, { serving_g: 50 }]) === 28 && LB.servingOf([{ serving_g: null }, { serving_g: 30 }]) === 30 && LB.servingOf([{ serving_g: 28 }, { serving_g: 50 }]) === null, 'The serving size is the one two readers agree on');
  const sv = LB.labelFrom({ nutrition_found: true, serving_size_g: 28, per_100g: { protein_g: 26.5, fibre_g: 8.7, sugars_g: 1.1, added_sugars_g: 0, saturated_fat_g: 8.5, sodium_mg: 573 } });
  ok(sv.ok && sv.serving_g === 28 && LB.labelFrom({ nutrition_found: true, serving_size_g: 900, per_100g: { protein_g: 26.5, fibre_g: 8.7, sugars_g: 1.1, added_sugars_g: 0, saturated_fat_g: 8.5, sodium_mg: 573 } }).serving_g === null, 'The printed serving size is kept, if it is a plausible 5 to 400 g');
  const RD = await import('../../src/recipes/ready.js');
  const nut = { protein_g: 8, fibre_g: 2, added_sugars_g: 10, saturated_fat_g: 3, sodium_mg: 400 };
  const sDef = RD.scorePack(nut, ['Rice'], 'Test', 'kids_biscuits'), sPr = RD.scorePack({ ...nut, serving_g: 60 }, ['Rice'], 'Test', 'kids_biscuits');
  ok(sDef.detail.serving_g === 30 && sDef.detail.serving_source === 'reference' && /typical serving/.test(sDef.detail.basis) && sPr.detail.serving_g === 60 && sPr.detail.serving_source === 'pack' && /printed on the pack/.test(sPr.detail.basis) && sPr.detail.inputs.sodium === 240, 'A pack is scored on its own printed serving; a typical serving is used only when none is printed, and the page says which');
  const v3 = LB.voteReadings([{ ...good, check: null }, { ...bad, check: null }]);
  ok(v3.label.protein_g == null && /disagreed/.test(v3.notes[0]), 'With nothing to settle it the value is left for the owner to enter');
}

// ICMR-NIN groups beyond 12 years: boys and girls, men and women by work, and recipes and packs scored for them
{
  const E = await import('../../src/recipes/score2.js');
  const PRD = await import('../../src/recipes/products.js');
  const lbl = (id) => E.bandById(id).label;
  ok(lbl('13-15:f') === 'Girls 13–15 years' && lbl('adult:m:heavy') === 'Men, heavy work' && lbl('16-18:m') === 'Boys 16–18 years', 'Every ICMR-NIN group has its own label');
  const r = (id) => E.bandById(id).ref;
  ok(r('13-15:m').protein === 45 && r('13-15:f').protein === 43 && r('16-18:m').fibre === 50 && r('adult:m:sed').protein === 54 && r('adult:f:sed').protein === 46 && r('adult:f:heavy').fibre === 40 && r('adult:m:sed').sodium === 2000 && r('adult:f:sed').energy === 1660, 'Reference energy, protein and fibre are the ICMR-NIN 2020 figures for each group');
  const food = { basis: 'pack', protein: 12, fibre: 6, addedSugar: 8, satFat: 3, sodium: 400, name: 'Test Mix', ingredients: ['Oats'] };
  const sc = (id) => E.scoreForBand(food, id);
  ok(sc('adult:m:heavy').metrics[1].share < sc('1-3').metrics[1].share && sc('adult:f:sed').metrics[0].share > sc('adult:m:heavy').metrics[0].share, 'The same serving takes a smaller share of a bigger day: less of a man\'s sodium than of a toddler\'s');
  ok(PRD.resolveAge('13-15y:f').band === '13-15:f' && PRD.resolveAge('adult:m:mod').band === 'adult:m:mod' && PRD.resolveAge('adult:m').band === 'adult:m:sed' && PRD.resolveAge('adult').band === 'adult' && PRD.resolveAge('4-6y:f').band === '4-6' && PRD.resolveAge('nope') === null && PRD.isAgeId('16-18y:m'), 'An age id may carry a sex and, for adults, the kind of work; below 10 years sex makes no difference');
  const idA = mkRecipe('https://nin.example/a', { status: 'approved', name: 'Adult Dish' });
  db.prepare('UPDATE kp_recipes SET poshan_score = 60, score_status = ?, age_min_months = 12, age_max_months = 144, total_minutes = 20, score_breakdown_json = ? WHERE id = ?').run('estimated', JSON.stringify({ bands: { 'adult:m:sed': { total: 100, capped: false }, '13-15:f': { total: 80, capped: false } } }), idA);
  const ad = await (await handleRecipesApi(new Request('https://w/api/kp/recipes?age_months=300&band=adult:m:sed&occasion=lunch&pref=veg&season=all&limit=40'), env, ctx)).json();
  const hit = (ad.results || []).find((x) => x.id === idA);
  ok(hit && hit.poshan_score === 100, 'A recipe list for men at sedentary work reads each recipe\'s score for that group: ' + (hit && hit.poshan_score));
  const tf = await (await handleRecipesApi(new Request('https://w/api/kp/recipes?age_months=168&band=13-15:f&occasion=lunch&pref=veg&season=all&limit=40'), env, ctx)).json();
  ok((tf.results || []).find((x) => x.id === idA)?.poshan_score === 80, 'A recipe list for girls 13-15 reads the score for girls 13-15');
  const dd = await (await handleRecipesApi(new Request(`https://w/api/kp/recipes/${idA}?age_months=300&band=adult:m:sed`), env, ctx)).json();
  ok(dd.score?.age_band === 'adult:m:sed' && dd.score?.age_band_label === 'Men, sedentary work' && dd.poshan_score === 100, 'A recipe\'s page shows the score and group label for the chosen band: ' + dd.score?.age_band_label);
}
// spices and masalas are ingredients, not meals, snacks or ready-to-eat food
{
  const RDY2 = await import('../../src/recipes/ready.js');
  ok(['Everest Garam Masala 100g', 'MDH Chana Masala', 'Chilli Powder 200g', '11 ELEVEN SPICES Veg Biryani Masala', 'Sambar Masala'].every((n) => RDY2.isSpiceProduct(n)), 'Spice and masala blends are recognised by name');
  ok(['Maggi Masala Noodles', 'Saffola Masala Oats', 'Kurkure Masala Munch', 'MTR Instant Sambar Mix', 'Instant Masala Khichdi'].every((n) => !RDY2.isSpiceProduct(n)), 'Masala as a flavour of noodles, oats, chips, or an instant meal mix is not treated as a spice');
}
// packs that check out go live by themselves; the ones that look wrong wait, with the reasons
{
  const AR = await import('../../src/recipes/autoreview.js');
  const good = { name: 'Kellogg Rolled Oats', kind: 'rolled_oats', image_url: 'https://x/y.jpg', nutrition_json: JSON.stringify({ protein_g: 11, fibre_g: 10, sugars_g: 1, added_sugars_g: 0, saturated_fat_g: 1.2, sodium_mg: 5 }), ingredients_json: '["Rolled oats"]' };
  ok(AR.flagsFor(good).length === 0, 'A pack with a photo, believable numbers and a fitting kind has nothing to flag');
  ok(AR.flagsFor({ ...good, image_url: null }).some((f) => /no photo/i.test(f)), 'No photo: flagged');
  ok(AR.flagsFor({ ...good, name: 'MAX PROTEIN Chocolamond Snack Bar', kind: 'chips' }).some((f) => /filed as/.test(f)), 'A snack bar filed as chips: flagged, because the kind sets the serving size');
  ok(AR.flagsFor({ ...good, nutrition_json: JSON.stringify({ protein_g: 20, fibre_g: 54, sugars_g: 1, added_sugars_g: 0, saturated_fat_g: 2, sodium_mg: 268 }) }).some((f) => /Fibre/.test(f)), 'Fibre far too high for a food: flagged');
  ok(AR.flagsFor({ ...good, ingredients_json: '["Sugar","Wheat flour"]' }).some((f) => /first ingredient/.test(f)), 'Sugar first but added sugars 0: flagged');
  ok(AR.flagsFor({ ...good, ingredients_json: '["Oats","Salt"]', nutrition_json: JSON.stringify({ protein_g: 11, fibre_g: 10, sugars_g: 1, added_sugars_g: 0, saturated_fat_g: 1, sodium_mg: 0 }) }).some((f) => /Salt is in the ingredient list/.test(f)), 'Salt listed but sodium 0: flagged');
  const nut = JSON.stringify({ protein_g: 11, fibre_g: 10, sugars_g: 1, added_sugars_g: 0, saturated_fat_g: 1.2, sodium_mg: 5 });
  const ins = db.prepare("INSERT INTO kp_ready_products (kind, name, brand, product_url, retailer, image_url, ingredients_json, nutrition_json, kidposhan_score, score_status, status, data_source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
  const okId = ins.run('rolled_oats', 'Auto Rolled Oats', 'A', 'https://off/1', 'openfoodfacts', 'https://img/1.jpg', '["Rolled oats"]', nut, 90, 'exact', 'candidate', 'openfoodfacts').lastInsertRowid;
  const noPhoto = ins.run('rolled_oats', 'Auto No Photo Oats', 'A', 'https://off/2', 'openfoodfacts', null, '["Rolled oats"]', nut, 90, 'exact', 'candidate', 'openfoodfacts').lastInsertRowid;
  const spice = ins.run('pulao_mix', 'Everest Garam Masala', 'E', 'https://off/3', 'openfoodfacts', 'https://img/3.jpg', '["Spices"]', nut, 60, 'exact', 'candidate', 'openfoodfacts').lastInsertRowid;
  db.prepare("UPDATE kp_ready_products SET kind_checked_at = datetime('now') WHERE id IN (?, ?, ?)").run(okId, noPhoto, spice);
  const stats = await AR.autoReviewPacks(env, { limit: 100 });
  const row = (id) => db.prepare('SELECT status, auto_approved, review_flags FROM kp_ready_products WHERE id = ?').get(id);
  ok(row(okId).status === 'approved' && row(okId).auto_approved === 1, 'A clean pack goes live on its own, with its score and photo');
  ok(row(noPhoto).status === 'candidate' && /no photo/i.test(row(noPhoto).review_flags), 'A pack that needs a person stays waiting, with the reason stored');
  ok(row(spice).status === 'rejected', 'A spice blend is turned away, not queued');
  ok(stats.approved >= 1 && stats.flagged >= 1 && stats.spice >= 1, 'The run reports what it did: ' + JSON.stringify(stats));
  ok(AR.comparePhoto({ protein_g: 20, fibre_g: 27.4, sodium_mg: 268 }, { protein_g: 20.5, fibre_g: 2.7, sodium_mg: 270 }).length === 1 && AR.comparePhoto({ protein_g: 20 }, { protein_g: 20 }).length === 0, 'Photo and data are compared per value; small differences are ignored, a clear mismatch is said in words');
  const waiting = await (await import('../../src/recipes/ready.js')).listPacks(env, { status: 'candidate', limit: 50 });
  ok(waiting.items.length > 0 && waiting.items[0].review_flags != null, 'The waiting list puts flagged packs first');
}
// recipe pages for search engines: a list of every visible recipe, and per-age scores on a recipe
{
  const idA = mkRecipe('https://seo.example/a', { status: 'approved', name: 'Seo Test Pulao Recipe' });
  db.prepare('UPDATE kp_recipes SET poshan_score = 80, score_status = ?, total_minutes = 30, score_hidden = 0, score_breakdown_json = ? WHERE id = ?').run('estimated', JSON.stringify({ bands: { '4-6': { total: 80, tier: 'Good', capped: false, metrics: [] }, 'adult:m:sed': { total: 100, tier: 'Good', capped: false, metrics: [] }, '13-15': { total: 70, tier: 'OK', capped: false, metrics: [] } } }), idA);
  const hidden = mkRecipe('https://seo.example/h', { status: 'approved', name: 'Seo Hidden Score Dish' });
  db.prepare('UPDATE kp_recipes SET poshan_score = 90, total_minutes = 30, score_hidden = 1 WHERE id = ?').run(hidden);
  const ix = await (await handleRecipesApi(new Request('https://w/api/kp/recipes-index'), env, ctx)).json();
  ok(ix.items.some((x) => x.id === idA && x.name === 'Seo Test Pulao Recipe' && x.score === 80) && !ix.items.some((x) => x.id === hidden) && ix.total === ix.items.length, 'The recipe index lists every visible, scored recipe and leaves out one whose score is hidden: ' + ix.total);
  const dl = await (await handleRecipesApi(new Request(`https://w/api/kp/recipes/${idA}?lite=1`), env, ctx)).json();
  ok(dl.scores_by_age && dl.scores_by_age['4-6y'] === 80 && dl.scores_by_age['13-15y'] === 70 && dl.scores_by_age['adult'] === undefined && dl.score?.value === 80, 'A recipe carries its score for each age group that has been worked out: ' + JSON.stringify(dl.scores_by_age));
  ok(dl.ingredients.every((i) => Array.isArray(i.buy) && i.buy.length === 0), 'With lite=1 the ingredients carry no shop links (a static page has no use for them)');
  const viaRouter = await routeRecipes(new Request('https://w/api/kp/recipes-index', { headers: { origin: 'https://www.kidposhan.in' } }), env, ctx);
  ok(viaRouter.status === 200 && (await viaRouter.json()).total >= 1, 'The recipe index is reachable through the real router, not only the handler');
}
// is each pack filed under the right kind of food? two models must agree before anything is changed
{
  const KC = await import('../../src/recipes/kindcheck.js');
  const A = (kind, c = 'high') => ({ kind, confidence: c });
  ok(KC.parseAnswer('{"kind":"whole_wheat_atta","confidence":"high"}')?.kind === 'whole_wheat_atta' && KC.parseAnswer('sure! {"kind":"none","confidence":"low"}')?.kind === 'none' && KC.parseAnswer('{"kind":"made_up_kind","confidence":"high"}') === null && KC.parseAnswer('no json') === null, 'The answer is read from JSON, and an invented kind is refused');
  ok(KC.decide('kids_biscuits', [A('whole_wheat_atta'), A('whole_wheat_atta')]).action === 'change' && KC.decide('kids_biscuits', [A('whole_wheat_atta'), A('whole_wheat_atta')]).kind === 'whole_wheat_atta', 'Both models sure of the same different kind: the pack is moved');
  ok(KC.decide('kids_biscuits', [A('whole_wheat_atta'), A('chips')]).action === 'flag', 'The two models disagree with each other and neither backs the filed kind: put to the owner');
  ok(KC.decide('kids_biscuits', [A('whole_wheat_atta'), A('kids_biscuits')]).action === 'ok', 'One model backs the filed kind: left alone');
  ok(KC.decide('kids_biscuits', [A('whole_wheat_atta'), A('whole_wheat_atta', 'low')]).action === 'flag', 'Both agree but one is unsure: put to the owner, not changed');
  ok(KC.decide('instant_noodles', [A('noodles'), A('vermicelli_pasta')]).action === 'ok' && KC.decide('chips', [A('namkeen'), A('namkeen')]).action === 'ok', 'Close kinds (noodles, pasta, chips, namkeen) are not treated as mistakes');
  ok(KC.decide('chips', [A('none'), A('none')]).action === 'flag' && KC.decide('chips', [null, null]).action === 'skip', 'Not any kind of food: flagged; no readable answer: skipped');
  ok(KC.plainName('Maggi Masala Noodles', 'instant_noodles') && KC.plainName("Kellogg's Chocos", 'breakfast_cereal') && !KC.plainName('Cadbury Dairy Milk', 'plain_milk') && !KC.plainName('Fortune ata 5kg', 'kids_biscuits'), 'A name that plainly says what the pack is is trusted; a milk-sounding chocolate or atta filed as biscuits is not');
  const kins = db.prepare("INSERT INTO kp_ready_products (kind, name, brand, product_url, retailer, image_url, ingredients_json, nutrition_json, kidposhan_score, score_status, status, data_source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
  const nut2 = JSON.stringify({ protein_g: 11, fibre_g: 10, sugars_g: 1, added_sugars_g: 0, saturated_fat_g: 1.2, sodium_mg: 5 });
  const wrong = kins.run('kids_biscuits', 'Zeta Chakki Fresh Atta 5kg', 'Zeta', 'https://off/k1', 'openfoodfacts', 'https://img/k1.jpg', '["Whole wheat"]', nut2, 80, 'exact', 'approved', 'openfoodfacts').lastInsertRowid;
  const plain = kins.run('instant_noodles', 'Zeta Veg Noodles', 'Zeta', 'https://off/k2', 'openfoodfacts', 'https://img/k2.jpg', '["Wheat flour"]', nut2, 80, 'exact', 'approved', 'openfoodfacts').lastInsertRowid;
  const unsure = kins.run('chips', 'Zeta Mystery Crunch', 'Zeta', 'https://off/k3', 'openfoodfacts', 'https://img/k3.jpg', '["Rice"]', nut2, 80, 'exact', 'approved', 'openfoodfacts').lastInsertRowid;
  let calls = 0; const askedNames = [];
  const aiEnv = { ...env, AI: { run: async (model, body) => { calls++; const nm = body.messages[1].content; askedNames.push(nm); const kind = /Atta/.test(nm) ? 'whole_wheat_atta' : calls % 2 ? 'dips_dressings' : 'pickle_chutney'; return { choices: [{ message: { content: JSON.stringify({ kind, confidence: 'high' }) } }] }; } } };
  const st = await KC.kindCheckPending(aiEnv, { limit: 20 });
  const rk = (id) => db.prepare('SELECT kind, status, kind_note, review_flags, kind_checked_at, kidposhan_score FROM kp_ready_products WHERE id = ?').get(id);
  ok(rk(wrong).kind === 'whole_wheat_atta' && /Moved from/.test(rk(wrong).kind_note) && rk(wrong).kind_checked_at && rk(wrong).status === 'approved', 'A pack both models agree is atta is moved out of biscuits, rescored, and the change is noted: ' + rk(wrong).kind);
  ok(rk(plain).kind === 'instant_noodles' && rk(plain).kind_checked_at && st.trusted >= 1, 'A pack whose name plainly says noodles is trusted without asking the models');
  ok(rk(unsure).status === 'candidate' && /may be/.test(rk(unsure).review_flags) && rk(unsure).kind === 'chips', 'Two models that disagree send a live pack back to the owner with the reason, and the kind is not changed');
  ok(st.moved >= 1 && st.flagged >= 1 && st.looked >= 2, 'The run reports what it did: ' + JSON.stringify(st));
  askedNames.length = 0;
  await KC.kindCheckPending(aiEnv, { limit: 50 });
  ok(!askedNames.some((n) => /Zeta Chakki|Zeta Mystery|Zeta Veg Noodles/.test(n)), 'A pack that has been checked is not asked about again');
  const gate = kins.run('rolled_oats', 'Zeta Gate Oats', 'Zeta', 'https://off/k4', 'openfoodfacts', 'https://img/k4.jpg', '["Oats"]', nut2, 80, 'exact', 'candidate', 'openfoodfacts').lastInsertRowid;
  await (await import('../../src/recipes/autoreview.js')).autoReviewPacks(env, { limit: 100 });
  ok(db.prepare('SELECT status FROM kp_ready_products WHERE id = ?').get(gate).status === 'candidate', 'A waiting pack whose kind has not been checked is not approved automatically');
}
// search by taste: "tangy meal for 9 year"
{
  const TS = await import('../../src/recipes/taste.js');
  const SR = await import('../../src/recipes/search.js');
  const pq = TS.parseQuery('tangy meal for 9 year');
  ok(pq.tastes.join() === 'tangy' && pq.ageMonths === 108 && pq.meals.includes('dinner') && pq.meals.includes('lunch') && pq.words.length === 0 && pq.smart, 'The query "tangy meal for 9 year" is read as taste tangy, a meal, age 9: ' + JSON.stringify({ t: pq.tastes, a: pq.ageMonths, m: pq.meals.length }));
  const pq2 = TS.parseQuery('not spicy veg breakfast 18 months'); const pq3 = TS.parseQuery('chatpata tiffin for 10'); const pq4 = TS.parseQuery('Saffola oats');
  ok(pq2.mild && pq2.diet === 'veg' && pq2.meals.join() === 'breakfast' && pq2.ageMonths === 18 && pq3.tastes.includes('tangy') && pq3.tastes.includes('spicy') && pq3.ageMonths === 120 && !pq4.smart && pq4.words.join() === 'saffola,oats', 'Not spicy, veg, a meal and an age in months; chatpata is tangy and spicy; a plain name search is left alone');
  ok(TS.tagRecipe('Lemon Rice', ['2 lemons juice', 'tamarind paste', '1 cup rice']).tangy >= 2 && !TS.tagRecipe('Plain Rice', ['1 cup rice', 'salt']).tangy && TS.tagRecipe('Chocolate Chip Cookies', ['sugar', 'chocolate chips']).sweet >= 3 && !TS.tagRecipe('Daal Khichdi', ['rice', 'moong dal', 'turmeric']).spicy, 'A recipe is tagged from its name and ingredients; a plain one gets no tags');
  const mk = (name, ings, score) => {
    const id = mkRecipe('https://taste.example/' + name.replace(/\W+/g, '-'), { status: 'approved', name, agemin: 12, agemax: 144 });
    db.prepare('UPDATE kp_recipes SET poshan_score = ?, score_status = ?, total_minutes = 25, score_hidden = 0, score_79 = ?, score_46 = ?, score_13 = ?, score_1012 = ?, taste_checked_at = NULL WHERE id = ?').run(score, 'estimated', score, score, score, score, id);
    db.prepare('DELETE FROM kp_recipe_ingredients WHERE recipe_id = ?').run(id);
    ings.forEach((l, n) => db.prepare('INSERT INTO kp_recipe_ingredients (recipe_id, position, raw_text, name) VALUES (?,?,?,?)').run(id, n, l, l));
    return id;
  };
  const tang = mk('Zesty Lemon Rice Bowl', ['2 lemons juice', '1 tsp tamarind paste', '1 cup rice'], 90);
  const tang2 = mk('Tamarind Veg Pulao Meal', ['tamarind', 'lemon juice', 'rice', 'peas'], 70);
  const plainR = mk('Plain Rice Meal', ['1 cup rice', 'salt'], 95);
  const sweetR = mk('Jaggery Kheer Treat', ['jaggery', 'milk', 'rice'], 85);
  const spicyR = mk('Schezwan Fried Rice Meal', ['schezwan sauce', 'red chilli powder', 'rice'], 80);
  const lowT = mk('Very Tangy Lemon Pickle Rice', ['lemon', 'pickle', 'rice'], 30);
  const bf = await TS.tastesBackfill(env, { limit: 300 });
  ok(bf.looked >= 6, 'The backfill works out the tastes of recipes that have none yet: ' + JSON.stringify(bf));
  const r1 = await SR.searchAll(env, 'tangy meal for 9 year');
  const ids = r1.recipes.map((r) => r.id);
  ok(ids.includes(tang) && ids.includes(tang2) && !ids.includes(plainR) && !ids.includes(sweetR) && !ids.includes(lowT), 'Tangy recipes are found for a 9 year old; plain and sweet ones, and one whose score is too low, are not: ' + ids.join());
  ok(ids.indexOf(tang) < ids.indexOf(tang2) || r1.recipes.find((r) => r.id === tang).score >= r1.recipes.find((r) => r.id === tang2).score, 'The higher-scoring tangy recipe comes first when they are equally tangy');
  ok(r1.understood && r1.understood.age_months === 108 && /7–9/.test(r1.understood.age_label) && /tangy/.test(r1.understood.text), 'The answer says what was understood: ' + (r1.understood && r1.understood.text));
  const r2 = await SR.searchAll(env, 'sweet dinner for 9 year'), r3 = await SR.searchAll(env, 'mild meal for 9 year');
  ok(!r2.recipes.some((r) => r.id === tang) && r3.recipes.some((r) => r.id === plainR) && !r3.recipes.some((r) => r.id === spicyR), 'Mild leaves out spicy recipes; the taste asked for decides what is found');
  const r4 = await SR.searchAll(env, 'tangy pulao for 9 year');
  ok(r4.recipes.length >= 1 && r4.recipes.every((r) => /pulao/i.test(r.name)), 'A dish word alongside the taste narrows the results to it');
  const r5 = await SR.searchAll(env, 'tangy meal', { age: 36 });
  ok(r5.understood.age_months === 36 && r5.recipes.length >= 1, 'With no age typed, the age chosen on the page is used');
}
console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
