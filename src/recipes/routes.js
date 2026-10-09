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
import { packsForRecipes, packsForRecipe, listPacks, reviewPack, researchKind, researchNextKind } from './ready.js';
import { rewriteSteps, rewritePending } from './rewrite.js';
import { autoPublishPending } from './autopublish.js';
import { galleryPending, sizePending } from './gallery.js';
import { listForReview, reviewRecipe, listSources, updateSource } from './review.js';
import { UserError, joinVisitor, listVisitors, userFromRequest, logout, setName, rateRecipe, ratingFor, addRemark, approvedRemarks, claimPayment, payConfig, listRemarks, reviewRemark, listPayments, reviewPayment } from './social.js';
import { tavilyUsage } from './tavily.js';
import { recordVisit, visitCount } from './visits.js';
import { coverageReport, fillOneGap, pruneSeen } from './coverage.js';
import { setContactEmail, previewMessage, sendOutreach, checkReplies, listOutreach, markOutreach } from './outreach.js';

const json = (d, s = 200) => new Response(JSON.stringify(d, null, 2), { status: s, headers: { 'content-type': 'application/json' } });

function authorised(request, env) {
  return env.ADMIN_TOKEN && request.headers.get('x-admin-token') === env.ADMIN_TOKEN;
}

// The main site (www.kidposhan.in) shows these pages' public data, so its origin may READ the two public endpoints.
// Admin routes are not included: they need the token and stay same-origin.
const ALLOWED_ORIGIN = /^https:\/\/((www\.)?kidposhan\.in|([a-z0-9-]+-)?poshan-score\.mailus-pixiedust\.workers\.dev)$/;
export function withCors(request, res) {
  const o = request.headers.get('origin');
  if (!o || !ALLOWED_ORIGIN.test(o)) return res;
  const h = new Headers(res.headers);
  h.set('access-control-allow-origin', o);
  h.append('vary', 'Origin');
  return new Response(res.body, { status: res.status, headers: h });
}

// Visitor endpoints (login, rate, remark, support). Called from the main site too, so they answer CORS preflights for the allowed origins.
async function routeVisitors(request, env, url, path) {
  const m = path.match(/^\/api\/kp\/recipes\/(\d+)\/(social|rate|remarks|support)$/);
  const isAuth = path.startsWith('/api/kp/auth/'), isPay = path === '/api/kp/pay/config', isVisit = path === '/api/kp/visit';
  if (!m && !isAuth && !isPay && !isVisit) return null;
  const origin = request.headers.get('origin');
  if (request.method === 'OPTIONS') {
    if (!origin || !ALLOWED_ORIGIN.test(origin)) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type, authorization', 'access-control-max-age': '86400', vary: 'Origin' } });
  }
  const reply = (d, s = 200) => withCors(request, json(d, s));
  try {
    const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
    const user = await userFromRequest(request, env);
    const need = () => { if (!user) throw new UserError('Please log in with your mobile number first.', 401); return user; };
    if (path === '/api/kp/auth/join' && request.method === 'POST') return reply(await joinVisitor(env, body));
    if (path === '/api/kp/auth/me' && request.method === 'GET') return user ? reply({ name: user.name, mobile_tail: String(user.mobile || '').slice(-4) }) : reply({ error: 'Not logged in' }, 401);
    if (path === '/api/kp/auth/name' && request.method === 'POST') return reply(await setName(env, need(), body.name));
    if (path === '/api/kp/auth/logout' && request.method === 'POST') { await logout(request, env); return reply({ ok: true }); }
    if (isPay && request.method === 'GET') return reply(payConfig(env, +url.searchParams.get('recipe_id') || null));
    if (isVisit) {
      const count = request.method === 'POST' ? await recordVisit(env, body.vid, request.headers.get('user-agent') || '') : await visitCount(env);
      return reply({ count });
    }
    if (m) {
      const id = +m[1];
      if (m[2] === 'social' && request.method === 'GET') return reply({ rating: await ratingFor(env, id, user), remarks: await approvedRemarks(env, id), me: user ? { name: user.name } : null });
      if (m[2] === 'rate' && request.method === 'POST') return reply({ rating: await rateRecipe(env, need(), id, body.stars) });
      if (m[2] === 'remarks' && request.method === 'POST') return reply(await addRemark(env, need(), id, body.body));
      if (m[2] === 'support' && request.method === 'POST') return reply(await claimPayment(env, user, id, body.note));
    }
    return reply({ error: 'Not found' }, 404);
  } catch (e) {
    if (e instanceof UserError) return reply({ error: e.message }, e.status);
    console.error('visitors', e);
    return reply({ error: 'Something went wrong. Please try again.' }, 500);
  }
}

export async function routeRecipes(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;

  const visitors = await routeVisitors(request, env, url, path);
  if (visitors) return visitors;

  if (request.method === 'GET' && (path === '/api/kp/recipes' || /^\/api\/kp\/recipes\/\d+$/.test(path))) {
    return withCors(request, await handleRecipesApi(request, env, ctx));
  }

  // GET /api/kp/ready?recipe_id=12  -> approved ready-to-buy packs for that dish (ragi dosa -> ragi dosa mix)
  if (request.method === 'GET' && path === '/api/kp/ready') {
    if (url.searchParams.get('recipe_ids')) return withCors(request, json(await packsForRecipes(env, url.searchParams.get('recipe_ids').split(','))));
    const rid = +url.searchParams.get('recipe_id');
    return withCors(request, rid ? json(await packsForRecipe(env, rid)) : json({ error: 'recipe_id required' }, 400));
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
      return json(kind ? await researchKind(env, kind) : await researchNextKind(env, { onlyNeeded: url.searchParams.get('scope') === 'published' }));
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
        reviewed: url.searchParams.get('reviewed') || '',
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
    if (path === '/api/kp/admin/tavily' && request.method === 'GET') return json(await tavilyUsage(env));
    if (path === '/api/kp/admin/coverage' && request.method === 'GET') return json(await coverageReport(env, { pref: url.searchParams.get('pref') || 'veg', world: url.searchParams.get('world') || 'india' }));
    if (path === '/api/kp/admin/visitors' && request.method === 'GET') return json(await listVisitors(env));
    // ---- visitors: remarks to approve, support payments to confirm ----
    if (path === '/api/kp/admin/remarks' && request.method === 'GET') return json(await listRemarks(env, { status: url.searchParams.get('status') || 'pending' }));
    m = path.match(/^\/api\/kp\/admin\/remarks\/(\d+)$/);
    if (m && request.method === 'POST') return json(await reviewRemark(env, +m[1], await request.json()));
    if (path === '/api/kp/admin/payments' && request.method === 'GET') return json(await listPayments(env, { status: url.searchParams.get('status') || 'claimed' }));
    m = path.match(/^\/api\/kp\/admin\/payments\/(\d+)$/);
    if (m && request.method === 'POST') return json(await reviewPayment(env, +m[1], await request.json()));
    // ---- author outreach by Gmail ----
    if (path === '/api/kp/admin/outreach' && request.method === 'GET') return json(await listOutreach(env));
    if (path === '/api/kp/admin/outreach/preview' && request.method === 'GET') return json(await previewMessage(env, +url.searchParams.get('source_id')));
    if (path === '/api/kp/admin/outreach/send' && request.method === 'POST') return json({ results: await sendOutreach(env, ((await request.json()).source_ids || []).map(Number).filter(Boolean)) });
    if (path === '/api/kp/admin/outreach/check' && request.method === 'POST') return json({ replies: await checkReplies(env) });
    m = path.match(/^\/api\/kp\/admin\/outreach\/(\d+)$/);
    if (m && request.method === 'POST') {
      const b = await request.json();
      return json(b.email !== undefined ? await setContactEmail(env, +m[1], b.email) : await markOutreach(env, +m[1], b));
    }
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

  // POST /api/kp/admin/recipes/gallery?limit=4   collect the photos of recipes read before photo collection existed
  if (path.endsWith('/gallery') && request.method === 'POST') {
    return json({ gallery: await galleryPending(env, { limit: Math.min(+url.searchParams.get('limit') || 4, 10) }) });
  }

  // POST /api/kp/admin/recipes/photo-size?limit=6   measure stored photos: sharpest becomes the hero, sharper recipes sort first
  if (path.endsWith('/photo-size') && request.method === 'POST') {
    return json({ sized: await sizePending(env, { limit: Math.min(+url.searchParams.get('limit') || 6, 12) }) });
  }

  // POST /api/kp/admin/recipes/autopublish?limit=50[&recheck=1]  publish the waiting recipes that pass every check (recheck=1 also re-evaluates held ones)
  if (path.endsWith('/autopublish') && request.method === 'POST') {
    if (url.searchParams.get('recheck') === '1') await env.DB.prepare("UPDATE kp_recipes SET hold_reasons_json = NULL WHERE review_status = 'pending' AND reviewed_at IS NULL").run();
    return json(await autoPublishPending(env, { limit: Math.min(+url.searchParams.get('limit') || 50, 200) }));
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
  try { console.log('rewrite', JSON.stringify(await rewritePending(env, { limit: 6 }))); } catch (e) { console.error('rewrite', e); }
  try { console.log('gallery', JSON.stringify(await galleryPending(env, { limit: 4 }))); } catch (e) { console.error('gallery', e); }
  if (env.GMAIL_REFRESH_TOKEN) { try { console.log('replies', JSON.stringify(await checkReplies(env))); } catch (e) { console.error('replies', e); } }
  try { console.log('gap', JSON.stringify(await fillOneGap(env))); } catch (e) { console.error('gap', e); }          // look for recipes where a combination has fewer than 20
  try { console.log('seen', JSON.stringify(await pruneSeen(env))); } catch (e) { console.error('seen', e); }
  try { console.log('photo-size', JSON.stringify(await sizePending(env, { limit: 8 }))); } catch (e) { console.error('photo-size', e); }
  try { console.log('autopublish', JSON.stringify(await autoPublishPending(env, { limit: 25 }))); } catch (e) { console.error('autopublish', e); }
  const { results: due } = await env.DB.prepare(
    `SELECT * FROM kp_recipe_sources WHERE status = 'registered' AND active = 1 AND crawl_mode = 'auto'
      ORDER BY last_crawled_at IS NOT NULL, last_crawled_at LIMIT 2`
  ).all();
  for (const s of due) {
    try { await discoverSource(env, s, { useTavily: false, maxPages: 1 }); } catch (e) { console.error('recrawl', s.id, e); }
    await env.DB.prepare("UPDATE kp_recipe_sources SET last_crawled_at = datetime('now') WHERE id = ?").bind(s.id).run();
  }
  await processPending(env, { limit: 5, world: 'india' });
  await processPending(env, { limit: 4, world: 'other' });   // Asian and European sites get their own share of every run
}
