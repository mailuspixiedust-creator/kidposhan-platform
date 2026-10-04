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

  if (!path.startsWith('/api/kp/admin/')) return null;
  if (!authorised(request, env)) return json({ error: 'Missing or wrong x-admin-token' }, 401);

  try {
    // ---- owner review ----
    if (path === '/api/kp/admin/review' && request.method === 'GET') {
      return json(await listForReview(env, {
        status: url.searchParams.get('status') || 'pending',
        limit: +url.searchParams.get('limit') || 20,
        offset: +url.searchParams.get('offset') || 0,
      }));
    }
    let m = path.match(/^\/api\/admin\/review\/(\d+)$/);
    if (m && request.method === 'POST') return json(await reviewRecipe(env, +m[1], await request.json()));
    if (path === '/api/kp/admin/sources' && request.method === 'GET') {
      return json(await listSources(env, { state: url.searchParams.get('state') || 'all', q: url.searchParams.get('q') || '', status: url.searchParams.get('status') }));
    }
    m = path.match(/^\/api\/admin\/sources\/(\d+)$/);
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
export async function scheduledRecipes(env) {
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
