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
import { packsForRecipes, packsForRecipe, listPacks, reviewPack, researchKind, researchNextKind, PRIORITY_BRANDS } from './ready.js';
import { rewriteSteps, rewritePending } from './rewrite.js';
import { autoPublishPending } from './autopublish.js';
import { galleryPending, sizePending } from './gallery.js';
import { listForReview, reviewRecipe, listSources, updateSource } from './review.js';
import { UserError, joinVisitor, listVisitors, userFromRequest, logout, setName, rateRecipe, ratingFor, addRemark, approvedRemarks, claimPayment, payConfig, listRemarks, reviewRemark, listPayments, reviewPayment } from './social.js';
import { tavilyUsage } from './tavily.js';
import { recordVisit, visitCount } from './visits.js';
import { coverageReport, fillOneGap, pruneSeen } from './coverage.js';
import { listProducts, productDetail, approveScored, isAgeId } from './products.js';
import { searchAll, siteStats, cooksShelf } from './search.js';
import { importOffNext, importOffJob, offBrandJob } from './openfood.js';
import { startSync, verifySync, syncUser, readSync, writeSync, endSync } from './sync.js';
import { recordPageview, recordSeconds, trafficReport, pruneViews } from './traffic.js';
import { submitReport, listReports, resolveReport, thankPending, betaStats, BetaError } from './beta.js';
import { autoReviewPacks, photoCheckPending } from './autoreview.js';
import { scanLookup, scanSubmit, scanRetake, scanPhoto, readScansPending, pruneScans, whoHash, ScanError } from './scan.js';
import { methodSpec } from './score2.js';
import { rescoreAllPacks } from './ready.js';
import { setPhone, outreachSettings, updateOutreachSettings, autoOutreach, findContactEmails, sendTest, setContactEmail, previewMessage, sendOutreach, checkReplies, listOutreach, markOutreach } from './outreach.js';

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
  const isAuth = path.startsWith('/api/kp/auth/'), isPay = path === '/api/kp/pay/config', isVisit = path === '/api/kp/visit', isSync = path.startsWith('/api/kp/sync/'), isPv = path === '/api/kp/pv' || path === '/api/kp/pv/time', isScan = path === '/api/kp/scan/lookup' || path === '/api/kp/scan/submit', isReport = path === '/api/kp/report';
  if (!m && !isAuth && !isPay && !isVisit && !isSync && !isPv && !isScan && !isReport) return null;
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
    // Saved recipes on another device: a one-time code to the mobile number first (verified), nothing is stored under an unverified number
    // A page view: the page, the country and city Cloudflare saw (no IP kept), and later how long the page was on screen
    if (isPv && request.method === 'POST') {
      if (path === '/api/kp/pv/time') return reply(await recordSeconds(env, body));
      const cf = request.cf || {};
      return reply(await recordPageview(env, body, { ua: request.headers.get('user-agent') || '', country: cf.country || request.headers.get('cf-ipcountry'), region: cf.region, city: cf.city, cf }));
    }
    // The scanner: look a barcode up, or send a pack's photos to be read and scored
    if (isReport && request.method === 'POST') return reply(await submitReport(env, body, { who: await whoHash(request) }));
    if (isScan) {
      const who = await whoHash(request), age = url.searchParams.get('age') || body.age || '';
      if (path === '/api/kp/scan/lookup' && request.method === 'GET') return reply(await scanLookup(env, url.searchParams.get('code'), { age, who, kind: url.searchParams.get('kind') || '', fix: url.searchParams.get('fix') === '1' }));
      if (path === '/api/kp/scan/submit' && request.method === 'POST') return reply(body.retake ? await scanRetake(env, body, { who, origin: url.origin, age }) : await scanSubmit(env, body, { who, origin: url.origin, age }));
    }
    if (isSync && request.method === 'POST') {
      if (path === '/api/kp/sync/start') return reply(await startSync(env, body));
      if (path === '/api/kp/sync/verify') return reply(await verifySync(env, body));
      const su = await syncUser(request, env);
      if (!su) return reply({ error: 'Please verify your mobile number again.' }, 401);
      if (path === '/api/kp/sync/load') return reply(await readSync(env, su));
      if (path === '/api/kp/sync/save') return reply(await writeSync(env, su, body));
      if (path === '/api/kp/sync/logout') { await endSync(request, env); return reply({ ok: true }); }
    }
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
    if (e instanceof UserError || e instanceof ScanError || e instanceof BetaError) return reply({ error: e.message }, e.status);
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

  // The Products page: GET /api/kp/products?age=3-5y&category=Snacks&min=58&sort=score|name, and one product with its score workings
  if (request.method === 'GET' && path === '/api/kp/products') {
    const sp = url.searchParams;
    const res = await listProducts(env, { age: isAgeId(sp.get('age')) ? sp.get('age') : '', category: sp.get('category') || '', min: +sp.get('min') || 0, sort: sp.get('sort') === 'name' ? 'name' : 'score', limit: +sp.get('limit') || 60 });
    return withCors(request, new Response(JSON.stringify(res), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' } }));
  }
  // The landing page's "from various cooks and cookbooks": one good recipe from each of several creators
  if (request.method === 'GET' && path === '/api/kp/cooks') {
    const ageQ = parseInt(url.searchParams.get('age_months'), 10);
    const occ = url.searchParams.get('occasion'), prefs = (url.searchParams.get('pref') || '').split(',').filter((p) => ['veg', 'jain', 'nonveg'].includes(p));
    const out = await cooksShelf(env, { age: Number.isFinite(ageQ) && ageQ >= 12 && ageQ <= 144 ? ageQ : null, limit: Math.min(Math.max(parseInt(url.searchParams.get('limit'), 10) || 8, 1), 12), occasion: ['breakfast', 'lunchbox', 'lunch', 'snack_4pm', 'dinner'].includes(occ) ? occ : null, prefs });
    return withCors(request, new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' } }));
  }
  // The landing page's numbers
  if (request.method === 'GET' && path === '/api/kp/stats') {
    return withCors(request, new Response(JSON.stringify({ ...(await siteStats(env)), beta: await betaStats(env) }), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=600' } }));
  }
  // One search box for the whole site: GET /api/kp/search?q=saffola
  if (request.method === 'GET' && path === '/api/kp/search') {
    const ageQ = parseInt(url.searchParams.get('age_months'), 10);
    const out = await searchAll(env, (url.searchParams.get('q') || '').slice(0, 80), { age: Number.isFinite(ageQ) && ageQ >= 6 && ageQ <= 1200 ? ageQ : null });
    return withCors(request, new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' } }));
  }
  // The scoring method itself, written from the same tables the engine uses: the Age & Metrics page shows exactly this
  if (request.method === 'GET' && path === '/api/kp/score-method') {
    return withCors(request, new Response(JSON.stringify(methodSpec()), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' } }));
  }
  const photoM = path.match(/^\/api\/kp\/scan\/photo\/(\d+)\/(front|back|ingredients)$/);
  if (request.method === 'GET' && photoM) return (await scanPhoto(env, +photoM[1], photoM[2])) || json({ error: 'No photo' }, 404);
  const prodM = path.match(/^\/api\/kp\/products\/(\d+)$/);
  if (request.method === 'GET' && prodM) {
    const d = await productDetail(env, +prodM[1], { age: isAgeId(url.searchParams.get('age')) ? url.searchParams.get('age') : '' });
    return withCors(request, d ? new Response(JSON.stringify(d), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' } }) : json({ error: 'Product not found' }, 404));
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
    // POST /api/kp/admin/products/auto-review?limit=300   let the rules approve the packs that check out (the cron does this too)
    if (path === '/api/kp/admin/products/auto-review' && request.method === 'POST') return json(await autoReviewPacks(env, { limit: Math.min(+url.searchParams.get('limit') || 300, 1000) }));
    // POST /api/kp/admin/products/photo-check?limit=2   compare auto-approved packs' label photos with their stored numbers
    if (path === '/api/kp/admin/products/photo-check' && request.method === 'POST') return json(await photoCheckPending(env, { limit: Math.min(+url.searchParams.get('limit') || 1, 5) }));
    // POST /api/kp/admin/products/import-off[?brand=maggi]   the next page of popular products from Open Food Facts
    if (path === '/api/kp/admin/products/import-off' && request.method === 'POST') {
      const bj = offBrandJob(url.searchParams.get('brand') || '');
      return json(bj ? await importOffJob(env, bj) : await importOffNext(env));
    }
    // POST /api/kp/admin/products/research?kind=ragi_dosa_mix   (no kind = the one that has waited longest)
    if (path === '/api/kp/admin/products/research' && request.method === 'POST') {
      const kind = url.searchParams.get('kind'), brandKey = url.searchParams.get('brand');
      const pb = brandKey && PRIORITY_BRANDS.find((b) => b.key === brandKey);
      if (pb) return json(await researchKind(env, pb.kind, { key: pb.key, query: pb.query, match: pb.match }));
      return json(kind ? await researchKind(env, kind) : await researchNextKind(env, { onlyNeeded: url.searchParams.get('scope') === 'published' }));
    }
    // POST /api/kp/admin/products/read-labels?id=5  (one pack, retries)  or  ?limit=2 (next packs never tried)
    if (path === '/api/kp/admin/products/read-labels' && request.method === 'POST') {
      const id = +url.searchParams.get('id');
      if (id) { await env.DB.prepare('UPDATE kp_ready_products SET label_tried_at = NULL WHERE id = ? AND label_source IS NOT \'owner\'').bind(id).run(); return json({ read: [await readPackLabel(env, id)] }); }
      return json({ read: await readLabelsPending(env, { limit: Math.min(+url.searchParams.get('limit') || 2, 4) }) });
    }
    // POST /api/kp/admin/products/approve-scored   approve every waiting product whose label was read and scored
    if (path === '/api/kp/admin/products/approve-scored' && request.method === 'POST') return json(await approveScored(env));
    if (path === '/api/kp/admin/products/rescore' && request.method === 'POST') return json(await rescoreAllPacks(env));      // after the scoring method changed
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
    // GET /api/kp/admin/traffic?days=30&path=/products : visitors per page, where from, and the average time on the page
    if (path === '/api/kp/admin/reports' && request.method === 'GET') return json(await listReports(env, { status: url.searchParams.get('status') || 'open' }));
    const repM = path.match(/^\/api\/kp\/admin\/reports\/(\d+)$/);
    if (repM && request.method === 'POST') return json(await resolveReport(env, +repM[1], (await request.json().catch(() => ({}))).status));
    if (path === '/api/kp/admin/traffic' && request.method === 'GET') return json(await trafficReport(env, { days: url.searchParams.get('days'), path: url.searchParams.get('path') || null }));
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
    if (path === '/api/kp/admin/outreach/settings') return json(request.method === 'POST' ? await updateOutreachSettings(env, await request.json()) : await outreachSettings(env));
    if (path === '/api/kp/admin/outreach/test' && request.method === 'POST') return json(await sendTest(env, +(await request.json()).source_id));
    if (path === '/api/kp/admin/outreach/check' && request.method === 'POST') return json({ replies: await checkReplies(env) });
    m = path.match(/^\/api\/kp\/admin\/outreach\/(\d+)$/);
    if (m && request.method === 'POST') {
      const b = await request.json();
      return json(b.email !== undefined ? await setContactEmail(env, +m[1], b.email) : b.phone !== undefined ? await setPhone(env, +m[1], b.phone) : await markOutreach(env, +m[1], b));
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
  try { console.log('open-food-facts', JSON.stringify(await importOffNext(env))); } catch (e) { console.error('open-food-facts', e); }       // popular products, one page a run
  // KidPoshan steps first: it is quick, and the paced crawl below can run for minutes.
  try { console.log('rewrite', JSON.stringify(await rewritePending(env, { limit: 6 }))); } catch (e) { console.error('rewrite', e); }
  try { console.log('gallery', JSON.stringify(await galleryPending(env, { limit: 4 }))); } catch (e) { console.error('gallery', e); }
  try { console.log('contact-emails', JSON.stringify(await findContactEmails(env, { limit: 2 }))); } catch (e) { console.error('contact-emails', e); }
  if (env.GMAIL_REFRESH_TOKEN) {
    try { console.log('auto-outreach', JSON.stringify(await autoOutreach(env))); } catch (e) { console.error('auto-outreach', e); }
    try { console.log('replies', JSON.stringify(await checkReplies(env))); } catch (e) { console.error('replies', e); }
  }
  try { console.log('gap', JSON.stringify(await fillOneGap(env))); } catch (e) { console.error('gap', e); }          // look for recipes where a combination has fewer than 20
  try { console.log('seen', JSON.stringify(await pruneSeen(env))); } catch (e) { console.error('seen', e); }
  try { console.log('views', JSON.stringify(await pruneViews(env))); } catch (e) { console.error('views', e); }
  // once: the score became ten yes/no checks on ICMR-NIN limits with a snack line, so every stored score is worked out again (packs at once, recipes a batch at a time)
  try { const done = await env.DB.prepare("SELECT 1 x FROM kp_ready_research WHERE kind = 'rescore:binary-v1'").first(); if (!done) { console.log('rescore', JSON.stringify(await rescoreAllPacks(env))); await env.DB.prepare("INSERT INTO kp_ready_research (kind, last_run_at, found, runs) VALUES ('rescore:binary-v1', datetime('now'), 0, 999)").run(); } } catch (e) { console.error('rescore', e); }
  try {
    const mark = await env.DB.prepare("SELECT found, runs FROM kp_ready_research WHERE kind = 'rescore:nin-bands-v1-recipes'").first();
    if (!mark || mark.runs < 999) {
      const last = mark ? mark.found : 0;
      const { results } = await env.DB.prepare('SELECT id FROM kp_recipes WHERE id > ? ORDER BY id LIMIT 40').bind(last).all();
      for (const r of results) await scoreRecipe(env, r.id, { keepApproval: true });
      const upto = results.length ? results[results.length - 1].id : last, finished = results.length < 40;
      if (mark) await env.DB.prepare("UPDATE kp_ready_research SET found = ?, runs = ?, last_run_at = datetime('now') WHERE kind = 'rescore:nin-bands-v1-recipes'").bind(upto, finished ? 999 : 1).run();
      else await env.DB.prepare("INSERT INTO kp_ready_research (kind, last_run_at, found, runs) VALUES ('rescore:nin-bands-v1-recipes', datetime('now'), ?, ?)").bind(upto, finished ? 999 : 1).run();
      console.log('rescore-recipes', upto, finished);
    }
  } catch (e) { console.error('rescore-recipes', e); }
  try { console.log('thanks', JSON.stringify(await thankPending(env))); } catch (e) { console.error('thanks', e); }
  try { await pruneScans(env); console.log('scan-labels', JSON.stringify(await readScansPending(env, { limit: 2 }))); } catch (e) { console.error('scan-labels', e); }
  try { console.log('auto-review', JSON.stringify(await autoReviewPacks(env, { limit: 300 }))); } catch (e) { console.error('auto-review', e); }
  try { console.log('photo-check', JSON.stringify(await photoCheckPending(env, { limit: 1 }))); } catch (e) { console.error('photo-check', e); }
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
