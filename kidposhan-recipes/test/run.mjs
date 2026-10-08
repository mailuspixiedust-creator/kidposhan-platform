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
ok(sweet.detail.inputs.addedSugar > 40 && sweet.score < plain.score, 'Added sugar from listed sweetener lowers the score');
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
const good = scorePack(label, ['Ragi flour (60%)', 'Rice flour', 'Salt']);
const bad = scorePack({ ...label, added_sugars_g: 18, sodium_mg: 900 }, ['Maida', 'Sugar', 'Palm oil', 'Preservative (E211)', 'Artificial flavour']);
ok(good.status === 'exact' && good.detail.inputs.wholeGrain === true && bad.status === 'exact' && bad.score < good.score && bad.detail.inputs.additives >= 2 && bad.detail.inputs.palmOil && bad.detail.inputs.maida, `Exact pack score uses the packaged profile and the ingredient list (good ${good.score}, bad ${bad.score})`);
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
ok(sharpIds.includes(sharpId) && sharpIds.includes(blurId) && sharpIds.indexOf(sharpId) < sharpIds.indexOf(blurId), 'A recipe with a sharp photo is listed before one with a tiny photo, even when the tiny-photo recipe scores higher');

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

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
