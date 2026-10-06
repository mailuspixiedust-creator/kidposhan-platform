// Mount into the existing working src/index.js without rewriting it:
//
//   import { routeRecipes, scheduledRecipes } from './recipes/routes.js';
//   export default {
//     async fetch(request, env, ctx) {
//       const recipeRes = await routeRecipes(request, env, ctx);   // ctx is needed for background discovery
//       if (recipeRes) return recipeRes;
//       ...existing routing, unchanged...
//     },
//     async scheduled(event, env, ctx) { ctx.waitUntil(scheduledRecipes(env)); },
//   };

import { handleRecipesApi } from './api.js';
import { discoverSource } from './discover.js';
import { processPending } from './pipeline.js';
import { scoreRecipe, reparseIngredients } from './score.js';
import { readPackLabel, readLabelsPending } from './label.js';
import { packsForRecipe, listPacks, reviewPack, researchKind, researchNextKind } from './ready.js';
import { rewriteSteps, rewritePending } from './rewrite.js';
import { listForReview, reviewRecipe, listSources, updateSource } from './review.js';

const json = (d, s = 200) => new Response(JSON.stringify(d, null, 2), { status: s, headers: { 'content-type': 'application/json' } });

function authorised(request, env) {
  return env.ADMIN_TOKEN && request.headers.get('x-admin-token') === env.ADMIN_TOKEN;
}

export async function routeRecipes(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === 'GET' && (path === '/api/kp/recipes' || /^\/api\/kp\/recipes\/\d+$/.test(path))) {
    return handleRecipesApi(request, env, ctx);
  }

  // GET /api/kp/ready?recipe_id=12  -> approved ready-to-buy packs for that dish (ragi dosa -> ragi dosa mix)
  if (request.method === 'GET' && path === '/api/kp/ready') {
    const rid = +url.searchParams.get('recipe_id');
    return rid ? json(await packsForRecipe(env, rid)) : json({ error: 'recipe_id required' }, 400);
  }

  if (!path.startsWith('/api/kp/admin/')) return null;
  if (!authorised(request, env)) return json({ error: 'Missing or wrong x-admin-token' }, 401);

  try {
    // ---- ready-to-buy packs ----
    if (path === '/api/kp/admin/products' && request.method === 'GET') {
      return json(await listPacks(env, { status: url.searchParams.get('status') || 'candidate', limit: +url.searchParams.get('limit') || 30, offset: +url.searchParams.get('offset') || 0 }));
    }
    // POST /api/kp/admin/products/research?kind=ragi_dosa_mix   (no kind = the one that has waited longest)
    if (path === '/api/kp/admin/products/research' && request.method === 'POST') {
      const kind = url.searchParams.get('kind');
      return json(kind ? await researchKind(env, kind) : await researchNextKind(env));
    }
    // POST /api/kp/admin/products/read-labels?id=5  (one pack, retries)  or  ?limit=2 (next packs never tried)
    if (path === '/api/kp/admin/products/read-labels' && request.method === 'POST') {
      const id = +url.searchParams.get('id');
      if (id) { await env.DB.prepare('UPDATE kp_ready_products SET label_tried_at = NULL WHERE id = ? AND label_source IS NOT \'owner\'').bind(id).run(); return json({ read: [await readPackLabel(env, id)] }); }
      return json({ read: await readLabelsPending(env, { limit: Math.min(+url.searchParams.get('limit') || 2, 4) }) });
    }
    const pm = path.match(/^\/api\/kp\/admin\/products\/(\d+)$/);
    if (pm && request.method === 'POST') return json(await reviewPack(env, +pm[1], await request.json()));
    // ---- owner review ----
    if (path === '/api/kp/admin/review' && request.method === 'GET') {
      return json(await listForReview(env, {
        status: url.searchParams.get('status') || 'pending',
        limit: +url.searchParams.get('limit') || 20,
        offset: +url.searchParams.get('offset') || 0,
      }));
    }
    let m = path.match(/^\/api\/kp\/admin\/review\/(\d+)$/);
    if (m && request.method === 'POST') return json(await reviewRecipe(env, +m[1], await request.json()));
    if (path === '/api/kp/admin/sources' && request.method === 'GET') {
      return json(await listSources(env, { state: url.searchParams.get('state') || 'all', q: url.searchParams.get('q') || '', status: url.searchParams.get('status') }));
    }
    m = path.match(/^\/api\/kp\/admin\/sources\/(\d+)$/);
    if (m && request.method === 'POST') return json(await updateSource(env, +m[1], await request.json()));
  } catch (e) {
    return json({ error: e.message }, 400);
  }

  // POST /api/kp/admin/recipes/discover?source_id=12   (or &all=1&offset=0&count=5)
  if (path.endsWith('/discover') && request.method === 'POST') {
    const sid = url.searchParams.get('source_id');
    const offset = +url.searchParams.get('offset') || 0;
    const count = Math.min(+url.searchParams.get('count') || 3, 10);
    const tavily = url.searchParams.get('tavily') !== '0';
    const stmt = sid
      ? env.DB.prepare('SELECT * FROM kp_recipe_sources WHERE id = ? AND active = 1').bind(sid)
      : env.DB.prepare('SELECT * FROM kp_recipe_sources WHERE active = 1 ORDER BY id LIMIT ? OFFSET ?').bind(count, offset);
    const { results: sources } = await stmt.all();
    const report = [];
    for (const s of sources) report.push(await discoverSource(env, s, { useTavily: tavily }));
    return json({ sources: report, next_offset: sid ? null : offset + sources.length });
  }

  // POST /api/kp/admin/recipes/extract?limit=10
  if (path.endsWith('/extract') && request.method === 'POST') {
    const limit = Math.min(+url.searchParams.get('limit') || 10, 25);
    return json({ processed: await processPending(env, { limit }) });
  }

  // POST /api/kp/admin/recipes/rescore?limit=50   recompute recipe-level scores (after changing the score data)
  if (path.endsWith('/rescore') && request.method === 'POST') {
    const limit = Math.min(+url.searchParams.get('limit') || 50, 200);
    const { results } = await env.DB.prepare('SELECT id FROM kp_recipes ORDER BY id LIMIT ?').bind(limit).all();
    const out = [];
    for (const r of results) { await reparseIngredients(env, r.id); out.push(await scoreRecipe(env, r.id)); }
    return json({ rescored: out });
  }

  // POST /api/kp/admin/recipes/rewrite?id=12 (one recipe, retries failed ones)  or  ?limit=3 (next ones without KidPoshan steps)
  if (path.endsWith('/rewrite') && request.method === 'POST') {
    const id = +url.searchParams.get('id');
    if (id) {
      await env.DB.prepare("UPDATE kp_recipes SET kp_steps_status = 'none' WHERE id = ? AND kp_steps_status = 'failed'").bind(id).run();
      return json({ rewritten: [await rewriteSteps(env, id)] });
    }
    return json({ rewritten: await rewritePending(env, { limit: Math.min(+url.searchParams.get('limit') || 3, 5) }) });
  }

  // GET /api/kp/admin/recipes/coverage  -> which filter cells are thin
  if (path.endsWith('/coverage')) {
    const { results } = await env.DB.prepare(
      `SELECT o.occasion, s.season, r.diet,  -- published recipes only
              SUM(r.age_min_months <= 11) AS infant, SUM(r.age_min_months <= 35) AS toddler,
              SUM(r.age_min_months <= 71) AS preschool, COUNT(*) AS total
         FROM kp_recipes r
         JOIN kp_recipe_occasions o ON o.recipe_id = r.id
         JOIN kp_recipe_seasons s   ON s.recipe_id = r.id
        WHERE r.review_status = 'approved'
        GROUP BY o.occasion, s.season, r.diet ORDER BY total`
    ).all();
    const { results: status } = await env.DB.prepare(
      'SELECT status, COUNT(*) AS n FROM kp_recipe_candidates GROUP BY status'
    ).all();
    const { results: searches } = await env.DB.prepare(
      'SELECT query_key, runs, last_found, last_published, last_run_at FROM kp_search_discovery_log ORDER BY last_published, runs DESC LIMIT 50'
    ).all();
    return json({ candidates: status, cells: results, thin_searches: searches });
  }

  return json({ error: 'Unknown admin route' }, 404);
}

// Cron (every 30 min in wrangler.toml):
//  1. re-check the two least-recently-crawled registered sites for NEW posts (whole registry cycles every ~day)
//  2. extract queued pages; results wait in the review screen
export const PACKS_CRON = '0 */3 * * *';
export async function scheduledRecipes(env, cron) {
  // Slow cron: one kind of ready-to-buy pack per run (about 90 s, a few Tavily searches), kept apart from the recipe crawl.
  if (cron === PACKS_CRON) {
    try { console.log('packs', JSON.stringify(await researchNextKind(env))); } catch (e) { console.error('packs', e); }
    return;
  }
  // Pack labels: read the nutrition panel from pack images for packs never tried (2 per run).
  try { console.log('labels', JSON.stringify(await readLabelsPending(env, { limit: 2 }))); } catch (e) { console.error('labels', e); }
  // KidPoshan steps first: it is quick, and the paced crawl below can run for minutes.
  try { console.log('rewrite', JSON.stringify(await rewritePending(env, { limit: 3 }))); } catch (e) { console.error('rewrite', e); }
  const { results: due } = await env.DB.prepare(
    `SELECT * FROM kp_recipe_sources WHERE status = 'registered' AND active = 1 AND crawl_mode = 'auto'
      ORDER BY last_crawled_at IS NOT NULL, last_crawled_at LIMIT 2`
  ).all();
  for (const s of due) {
    try { await discoverSource(env, s, { useTavily: false, maxPages: 1 }); } catch (e) { console.error('recrawl', s.id, e); }
    await env.DB.prepare("UPDATE kp_recipe_sources SET last_crawled_at = datetime('now') WHERE id = ?").bind(s.id).run();
  }
  await processPending(env, { limit: 8 });
}
