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
ok(shown.score?.value === stored.score && shown.method === null, 'Score back on; no creator steps shown without rights or KidPoshan steps');
const orig = ['Roast 1 cup rava for 5 minutes.', 'Add water and cook 3 minutes.'];
ok(checkRewrite(orig, ['Dry roast the rava (1 cup) for 5 minutes.', 'Pour in water and cook for 3 minutes.']) === null, 'Faithful rewrite accepted');
ok(/numbers missing/.test(checkRewrite(orig, ['Roast the rava.', 'Add water and cook.'])), 'Rewrite that drops quantities/times is rejected');
const aiEnv = { ...env, AI: { run: async () => ({ response: 'Here you go: ["Dry roast 1 cup rava for 5 minutes.", "Add water, cook for 3 minutes."]' }) } };
const rw = await rewriteSteps(aiEnv, rid);
ok(rw.status === 'approved' && db.prepare('SELECT kp_steps_status s, kp_steps_auto a FROM kp_recipes WHERE id=?').get(rid).a === 1, 'AI steps that keep every number go live automatically (marked auto)');
const liveNow = await (await handleRecipesApi(new Request('https://w/api/kp/recipes/' + rid), env, ctx)).json();
ok(liveNow.method_by === 'kidposhan' && liveNow.method[0].text.startsWith('Dry roast'), 'KidPoshan steps are shown on the recipe page without waiting for the owner');
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
ok((await rewriteSteps(chatEnv, rid)).status === 'approved', 'AI reply in chat-completion shape is read');

// ---- ready-to-buy packs: the dish in pack form, exact label-based score, owner approval ----
import { kindForDish, scorePack, packsForRecipe, listPacks, reviewPack } from '../../src/recipes/ready.js';
ok(kindForDish('Ragi Dosa Recipe | Instant Ragi Dosa').kind === 'ragi_dosa_mix', 'Ragi dosa -> ragi dosa MIX (not ragi flour)');
ok(kindForDish('Rava Dosa').kind === 'dosa_mix' && kindForDish('Idli Dosa Batter').kind === 'dosa_batter' && kindForDish('Soft Idli').kind === 'idli_mix', 'Dosa / batter / idli map to their own kinds');
ok(kindForDish('Potato Poriyal') === null && kindForDish('Carrot Rice') === null, 'Dishes with no ready-made form get no packs');
ok(scorePack({ protein_g: 10 }, ['ragi']).status === 'pending', 'Pack score pending until the whole label is entered');
const label = { protein_g: 9, fibre_g: 8, sugars_g: 1, added_sugars_g: 0, saturated_fat_g: 0.8, sodium_mg: 120 };
const good = scorePack(label, ['Ragi flour (60%)', 'Rice flour', 'Salt'], 'Ragi dosa mix');
const bad = scorePack({ ...label, added_sugars_g: 18, sodium_mg: 900 }, ['Maida', 'Sugar', 'Palm oil', 'Preservative (E211)', 'Artificial flavour'], 'Ragi dosa mix');
ok(good.status === 'exact' && bad.status === 'exact' && bad.score < good.score && good.detail.bands['4-6'].metrics[8].score === 10 && bad.detail.bands['4-6'].metrics[8].score <= 3 && bad.detail.bands['4-6'].metrics[7].score < 10, `Exact pack score reads the ingredient list: the refined-first, additive-laden pack scores lower (good ${good.score}, bad ${bad.score})`);
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
ok(ph1.method === null || ph1.method_by === 'kidposhan', 'Verbatim steps are still not shown without rights');
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
ok(holdReasons({ recipe: { ...okRecipe, kp_steps_status: 'none' }, source: okSource, ingredients: ing4.slice(0, 2), steps: 1, occasions: 0 }).length >= 4, 'Thin recipes (few ingredients, one step, no meal, no KidPoshan steps) are held with every reason listed');
ok(holdReasons({ recipe: okRecipe, source: { status: 'suggested', active: 0 }, ingredients: ing4, steps: 3, occasions: 1 }).length === 1, 'A site that is not in the registry holds its recipes');

const mkRecipe = (url, extra = {}) => {
  const f = { name: 'Auto Dish', method: 'jsonld', complete: 'complete', agemin: 24, agemax: 72, status: 'pending', kp: 'approved', ...extra };
  const id = db.prepare("INSERT INTO kp_recipes (source_id, source_url, name, ingredients_raw_json, extraction_method, completeness, diet, age_min_months, age_max_months, review_status, instructions_json, kp_steps_status, kp_steps_json) VALUES (1,?,?,'[]',?,?,'veg',?,?,?,?,?,?) RETURNING id")
    .get(url, f.name, f.method, f.complete, f.agemin, f.agemax, f.status, JSON.stringify([{ section: null, text: 'Cook 1 cup rice for 10 minutes.' }, { section: null, text: 'Serve warm.' }]), f.kp, f.kp === 'approved' ? JSON.stringify(['Cook the rice for 10 minutes.', 'Serve warm.']) : null).id;
  ['1 cup rice', '1 carrot', '2 tbsp oil', 'Salt to taste'].forEach((l, n) => { const q = parseIngredientLine(l); db.prepare('INSERT INTO kp_recipe_ingredients (recipe_id, position, raw_text, quantity, unit, name, ingredient_key, is_pantry) VALUES (?,?,?,?,?,?,?,?)').run(id, n, q.raw_text, q.quantity, q.unit, q.name, q.ingredient_key, q.is_pantry ? 1 : 0); });
  db.prepare("INSERT INTO kp_recipe_occasions (recipe_id, occasion) VALUES (?, 'lunch')").run(id);
  db.prepare("INSERT INTO kp_recipe_seasons (recipe_id, season) VALUES (?, 'all')").run(id);
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
ok(db.prepare('SELECT review_status FROM kp_recipes WHERE id=?').get(nokpId).review_status === 'pending', 'No KidPoshan steps yet: not live (and not even evaluated by the sweep)');
const rwEnv = { ...env, AI: { run: async () => ({ response: '["Cook 1 cup rice for 10 minutes.", "Serve it warm."]' }) } };
const rwRes = await rewriteSteps(rwEnv, nokpId);
ok(rwRes.published === true && db.prepare('SELECT review_status FROM kp_recipes WHERE id=?').get(nokpId).review_status === 'approved', 'When the steps are written and pass the number check, the recipe goes live');
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
ok(/valid email/i.test(await throwsMsg(() => joinVisitor(env, { name: 'Asha', mobile: '9811111111', email: 'nope' }))) && /valid email/i.test(await throwsMsg(() => joinVisitor(env, { name: 'Asha', mobile: '9811111111' }))), 'A missing or malformed email is refused');
const ravi = db.prepare("SELECT name, mobile, email FROM kp_visitors WHERE mobile = '9811111111'").get();
ok(ravi && ravi.email === 'ravi@example.com' && ravi.name === 'Ravi', 'The email is stored tidied (lower case)');
const people = await listVisitors(env);
ok(people.total === 2 && people.visitors.some((v) => v.email === 'ravi@example.com' && v.ratings >= 0 && v.remarks >= 0), 'The admin list shows who joined, with email and how much they took part');
ok((await routeRecipes(new Request('https://w/api/kp/admin/visitors'), { ...env, ADMIN_TOKEN: 't' }, ctx)).status === 401 && (await (await routeRecipes(new Request('https://w/api/kp/admin/visitors', { headers: { 'x-admin-token': 't' } }), { ...env, ADMIN_TOKEN: 't' }, ctx)).json()).total === 2, 'The visitor list needs the admin token');

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
import { pickFresh, MIN_RESULTS } from '../../src/recipes/api.js';
import { coverageReport, fillOneGap, pruneSeen } from '../../src/recipes/coverage.js';
ok(MIN_RESULTS === 20, 'The target is 20 recipes per filter combination');
const pickA = pickFresh(Array.from({ length: 8 }, (_, i) => ({ id: i + 1 })), new Map([[1, 1], [2, 1], [3, 2]]), 5);
ok(pickA.map((r) => r.id).join() === '4,5,6,7,8', 'pickFresh: unseen recipes first, in order');
const pickB = pickFresh(Array.from({ length: 6 }, (_, i) => ({ id: i + 1 })), new Map([[1, 3], [2, 1], [3, 1], [4, 2]]), 6);
ok(pickB.map((r) => r.id).join() === '5,6,2,3,4,1', 'pickFresh: when too few are unseen, the least-seen come back first: ' + pickB.map((r) => r.id));
for (let i = 0; i < 30; i++) { const id = mkRecipe('https://fresh.example/' + i, { status: 'approved', name: 'Fresh Dish ' + i }); db.prepare('UPDATE kp_recipes SET poshan_score = ?, score_status = ? WHERE id = ?').run(30 + i, 'estimated', id); }
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
ok(otherDev.results.map((x) => x.id).join() === r1j.results.map((x) => x.id).join(), 'A different device gets the same first list as the first search');
const hitsRowF = db.prepare("SELECT sum(times) m FROM kp_seen WHERE vid = ?").get(devId);
ok(hitsRowF.m >= 40, "Every recipe shown to a device is counted (two searches of 20 = 40 hits)");
const rnRes = await fq('&vid=' + devId); await rnRes.json();
ok(rnRes.headers.get('cache-control') === 'private, no-store' && (await fq()).headers.get('cache-control').startsWith('public'), 'Answers for a device are never cached for others; the plain search still is');
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
import { ALL_KINDS as pkKinds, CATALOGUE_KINDS as pkCat, READY_KINDS as pkReady, scorePack as pkScore } from '../../src/recipes/ready.js';
ok(new Set(pkKinds.map((k) => k.kind)).size === pkKinds.length && pkKinds.every((k) => k.category && k.label && k.query && k.product instanceof RegExp), 'Every pack and product type has a unique key, a category, a search and a name check');
ok(pkKinds.length === pkReady.length + pkCat.length && pkCat.length >= 30 && ['Breakfast and cereals', 'Snacks', 'Drinks', 'Dairy', 'Baby foods', 'Ready mixes'].every((c) => pkKinds.some((k) => k.category === c)), 'The catalogue covers breakfast, flours, snacks, drinks, dairy, baby foods and ready mixes');
ok(pkCat.every((k) => !k.dish) && PR.KIND_CATEGORIES.length >= 8, 'Catalogue products are never matched to a recipe; they only appear on the Products page');
const prodAges = PR.agesFor;
ok(prodAges('ragi_flour', { added_sugars_g: 0, sodium_mg: 5 }, ['ragi']).join() === '6-12m,1-3y,4-6y,7-9y,10-12y', 'A plain baby-suitable food with no sugar or salt is offered from 6 months');
ok(prodAges('ragi_flour', { added_sugars_g: 0, sodium_mg: 5 }, ['ragi', 'salt']).join() === '1-3y,4-6y,7-9y,10-12y' && prodAges('baby_cereal', { added_sugars_g: 6, sodium_mg: 40 }, []).join() === '1-3y,4-6y,7-9y,10-12y', 'Salt in the ingredients, or sugar above 2 g, takes it out of the 6-12 month age');
ok(prodAges('kids_biscuits', { added_sugars_g: 22, sodium_mg: 300 }, []).join() === '1-3y,4-6y,7-9y,10-12y' && prodAges('rolled_oats', {}, []).join() === '1-3y,4-6y,7-9y,10-12y', 'A biscuit is never offered under 12 months; a product with no label values is not offered under 12 months either (from 12 months the score itself weighs sugar and salt for the age)');
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
ok((await PR.listProducts(env, { min: 80 })).items.every((x) => x.score >= 80) && (await PR.listProducts(env, { min: 80 })).total === 2 && (await PR.listProducts(env, { min: 58 })).total === 2, 'The minimum score filter works (Excellent 80, Good 58)');
ok((await PR.listProducts(env, { category: 'Snacks' })).total === 0 && (await PR.listProducts(env, { category: 'Biscuits and bakery' })).total === 1, 'The category filter works');
const prodInfants = await PR.listProducts(env, { age: '6-12m' });
ok(prodInfants.items.map((x) => x.name).sort().join() === 'Organic Ragi Flour,Rolled Oats 1kg' && prodInfants.categories.length === 2, 'For 6-12 months only the plain, low-sugar, low-salt baby-suitable products are listed (the biscuit is not), and the category list follows the age: ' + prodInfants.items.map((x) => x.name));
const bisc1 = (await PR.listProducts(env, { age: '1-3y' })).items.find((x) => x.name === 'Choco Kids Biscuit'), bisc10 = (await PR.listProducts(env, { age: '10-12y' })).items.find((x) => x.name === 'Choco Kids Biscuit');
ok((await PR.listProducts(env, { age: '4-6y' })).total === 3 && bisc1 && bisc10 && bisc10.score >= bisc1.score, 'From 12 months every scored product is listed, and the same biscuit scores no better for a 1-3 year old than for a 10-12 year old');
const prodDet = await PR.productDetail(env, pRagi);
ok(prodDet && prodDet.name === 'Organic Ragi Flour' && prodDet.offered_for[0] === '6-12m' && prodDet.nutrition_per_100g.fibre_g === 11 && prodDet.metrics.length === 10 && prodDet.metrics.every((m) => m.score >= 1 && m.score <= 10) && prodDet.score === prodDet.metrics.reduce((a, m) => a + m.score, 0) && Object.keys(prodDet.scores_by_age).length === 5, 'The product detail carries the label, the age guide and the ten metrics (each 1 to 10, adding up to the score)');
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
ok(S2.BANDS.length === 4 && S2.bandForMonths(9).id === '1-3' && S2.bandForMonths(12).id === '1-3' && S2.bandForMonths(47).id === '1-3' && S2.bandForMonths(48).id === '4-6' && S2.bandForMonths(84).id === '7-9' && S2.bandForMonths(120).id === '10-12' && S2.bandForMonths(300).id === '10-12', 'An age in months maps to the 1-3, 4-6, 7-9 or 10-12 year band (under 12 months uses the 1-3 reference)');
ok(S2.riskScore(0) === 10 && S2.riskScore(1.9) === 10 && S2.riskScore(2) === 9 && S2.riskScore(9.9) === 8 && S2.riskScore(10) === 7 && S2.riskScore(29.9) === 4 && S2.riskScore(30) === 3 && S2.riskScore(49.9) === 2 && S2.riskScore(50) === 1 && S2.riskScore(500) === 1, 'A risk metric scores 10 down to 1 by its share of the daily reference (pass under 10% = 8-10, partial under 30% = 4-7, fail 30%+ = 1-3)');
ok(S2.creditScore(30) === 10 && S2.creditScore(15) === 8 && S2.creditScore(14.9) === 7 && S2.creditScore(5) === 4 && S2.creditScore(4.9) === 3 && S2.creditScore(1.4) === 1, 'A credit metric (fibre, protein) scores 10 down to 1 (pass 15%+ = 8-10, partial 5-15% = 4-7, fail under 5% = 1-3)');
const s2Clean = S2.scoreAllBands({ basis: 'pack', protein: 12, fibre: 10, addedSugar: 0, satFat: 1, sodium: 10, name: 'Rolled Oats', ingredients: ['Rolled oats'] });
ok(s2Clean.version === 'kp-score-v2' && Object.keys(s2Clean.bands).join() === '1-3,4-6,7-9,10-12' && s2Clean.reference === s2Clean.bands['4-6'].total && s2Clean.bands['4-6'].metrics.length === 10, 'Every score is worked out for all four age bands, with ten metrics each');
ok(s2Clean.bands['4-6'].metrics.every((m, i) => m.n === i + 1 && m.score >= 1 && m.score <= 10 && Number.isInteger(m.score)) && s2Clean.bands['4-6'].total === s2Clean.bands['4-6'].metrics.reduce((a, m) => a + m.score, 0) && s2Clean.bands['4-6'].total >= 90, 'The ten metrics are whole numbers from 1 to 10 and add up to the score out of 100: ' + s2Clean.bands['4-6'].total);
const s2Junk = S2.scoreAllBands({ basis: 'pack', protein: 3, fibre: 1, addedSugar: 30, satFat: 14, sodium: 700, name: 'Choco Wafer', ingredients: ['Sugar', 'Palm oil', 'Refined wheat flour', 'Hydrogenated vegetable fat', 'Preservative (INS 211)', 'Artificial flavour', 'Colour (INS 110)'] });
const jm = s2Junk.bands['4-6'].metrics;
ok(jm[0].score === 1 && jm[2].score === 1 && jm[3].score === 2 && jm[6].score < 10 && jm[7].score < 10 && jm[8].score === 1 && jm[9].score === jm[0].score, 'Sugar first, hydrogenated fat, a preservative and artificial additives each cost points; HFSS is the worst of sugar, sodium and saturated fat');
ok(s2Junk.bands['4-6'].total <= 57 && s2Junk.bands['4-6'].tier !== 'Excellent' && s2Junk.bands['4-6'].tier !== 'Good', 'A product that fails a risk metric outright is capped at 57 (Fair) at most: ' + s2Junk.bands['4-6'].total);
const salty = (b) => S2.scoreForBand({ basis: 'pack', protein: 8, fibre: 6, addedSugar: 1, satFat: 2, sodium: 600, name: 'Savoury Mix', ingredients: ['Chickpea flour'] }, b).metrics[1].score;
ok(salty('1-3') <= salty('4-6') && salty('4-6') <= salty('7-9') && salty('7-9') <= salty('10-12') && salty('1-3') < salty('10-12'), 'The same salty food scores worse on sodium for a younger child than for an older one');
const sameMeal = { protein: 9, fibre: 5, addedSugar: 1, satFat: 2.5, sodium: 380, name: 'Veg pulao', ingredients: '', topKey: 'rice' };
ok(S2.scoreForBand({ ...sameMeal, basis: 'meal' }, '4-6').metrics[1].share < S2.scoreForBand({ ...sameMeal, basis: 'pack' }, '4-6').metrics[1].share, 'A cooked dish counts as one of three meals (a third of the serving counts toward the day), so the same numbers weigh less than they would per 100 g of a pack');
ok(S2.scoreForBand({ ...sameMeal, basis: 'meal', topKey: 'sugar' }, '4-6').metrics[8].score === 4 && S2.scoreForBand({ ...sameMeal, basis: 'meal', topKey: 'rice' }, '4-6').metrics[8].score === 10, 'For a dish, base-ingredient integrity looks at what dominates by weight');
const spec = s2Spec();
ok(spec.metrics.length === 10 && spec.scale.max === 10 && spec.scale.total === 100 && spec.bands.length === 4 && spec.metrics.every((m) => Array.isArray(m.steps) && m.steps.length >= 1) && spec.metrics[0].steps.length === 10 && spec.metrics[4].steps.length === 10, 'The method page data lists ten metrics, four age bands, and a demarcated 1-10 table for the number-based metrics');
ok(spec.metrics[0].steps[0].score === 10 && spec.metrics[0].steps[9].score === 1 && /under 2%/.test(spec.metrics[0].steps[0].rule) && /50% or more/.test(spec.metrics[0].steps[9].rule), 'The printed thresholds are generated from the same table the scoring uses');
const specRes = await routeRecipes(new Request('https://w/api/kp/score-method', { headers: { origin: 'https://www.kidposhan.in' } }), env, ctx);
ok(specRes.status === 200 && (await specRes.json()).metrics.length === 10 && specRes.headers.get('access-control-allow-origin') === 'https://www.kidposhan.in', 'The scoring method is served to the Age & Metrics page (and answers CORS for kidposhan.in)');

// recipes carry a score per age band, and search/detail follow the child's age
const s2Id = mkRecipe('https://s2.example/dish/', { status: 'approved', name: 'Salty Dal Dish', agemin: 6, agemax: 144 });
db.prepare('UPDATE kp_recipes SET score_13 = 40, score_46 = 60, score_79 = 70, score_1012 = 80, poshan_score = 60 WHERE id = ?').run(s2Id);
const s2Q = async (age) => (await (await handleRecipesApi(new Request('https://w/api/kp/recipes?age_months=' + age + '&occasion=lunch&pref=veg&limit=50'), env, ctx)).json());
const s2a = (await s2Q(24)).results.find((x) => x.id === s2Id), s2b = (await s2Q(132)).results.find((x) => x.id === s2Id);
ok(s2a && s2b && s2a.poshan_score === 40 && s2b.poshan_score === 80 && (await s2Q(60)).results.find((x) => x.id === s2Id).poshan_score === 60, 'A recipe\'s listed score follows the child\'s age band (40 at 1-3 years, 60 at 4-6, 80 at 10-12 in this example)');
ok((await s2Q(24)).query.score_band === '1-3' && (await s2Q(132)).query.score_band === '10-12', 'The search says which age band the scores are for');

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');

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
  ok(m(clean)[6].score === 10 && m(clean)[7].score === 10 && m(clean)[8].score === 10 && m(clean)[3].score === 10, 'Checked-reading flags: no preservatives, additives or hydrogenated fat, whole-food first, scores 10 on each check');
  ok(m(dirty)[6].score === 6 && m(dirty)[7].score === 1 && m(dirty)[3].score === 2 && m(dirty)[8].score === 3 && dirty.score < clean.score, 'Checked-reading flags carry a preservative, three additives, a hydrogenated fat and a refined first ingredient into the marks');
  ok(RP.kindByKey('mayonnaise')?.category === 'Spreads and sauces', 'Mayonnaise is a product kind');
}
