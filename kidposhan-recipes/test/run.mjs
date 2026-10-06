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
// Like D1, bind() returns a NEW bound statement (so one prepared statement can be bound many times in a batch).
const wrap = (sql, args = []) => ({
  bind: (...x) => wrap(sql, x),
  all: async () => ({ results: db.prepare(sql).all(...args) }),
  first: async () => db.prepare(sql).get(...args) ?? null,
  run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
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
ok(hidden.poshan_score === null && hidden.score === null, 'Estimated score is hidden from parents until approved');
db.prepare('UPDATE kp_recipes SET score_approved = 1 WHERE id=?').run(rid);
const shown = await (await handleRecipesApi(new Request('https://w/api/kp/recipes/' + rid), env, ctx)).json();
ok(shown.score?.value === stored.score && shown.score.kind === 'estimated', 'Approved estimated score is shown and labelled');
ok(shown.method === null, 'No creator steps shown without rights or KidPoshan steps');
const orig = ['Roast 1 cup rava for 5 minutes.', 'Add water and cook 3 minutes.'];
ok(checkRewrite(orig, ['Dry roast the rava (1 cup) for 5 minutes.', 'Pour in water and cook for 3 minutes.']) === null, 'Faithful rewrite accepted');
ok(/numbers missing/.test(checkRewrite(orig, ['Roast the rava.', 'Add water and cook.'])), 'Rewrite that drops quantities/times is rejected');
const aiEnv = { ...env, AI: { run: async () => ({ response: 'Here you go: ["Dry roast 1 cup rava for 5 minutes.", "Add water, cook for 3 minutes."]' }) } };
const rw = await rewriteSteps(aiEnv, rid);
ok(rw.status === 'draft' && db.prepare('SELECT kp_steps_status s FROM kp_recipes WHERE id=?').get(rid).s === 'draft', 'AI rewrite saved as draft');
const stillHidden = await (await handleRecipesApi(new Request('https://w/api/kp/recipes/' + rid), env, ctx)).json();
ok(stillHidden.method === null, 'Draft KidPoshan steps are not shown to parents');
let refused = ''; try { await reviewRecipe(env, rid, { action: 'publish', occasions: ['breakfast'] }); } catch (e) { refused = e.message; }
ok(/approve or write the KidPoshan steps/.test(refused), 'Publishing needs approved KidPoshan steps');
await reviewRecipe(env, rid, { action: 'publish', occasions: ['breakfast'], approve_steps: true });
const live = await (await handleRecipesApi(new Request('https://w/api/kp/recipes/' + rid), env, ctx)).json();
ok(live.method_by === 'kidposhan' && live.method[0].text.startsWith('Dry roast'), 'Approved KidPoshan steps are shown on the KidPoshan page');

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
ok((await rewriteSteps(chatEnv, rid)).status === 'draft', 'AI reply in chat-completion shape is read');

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

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
