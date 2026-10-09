// Visitors of the recipe pages: they give a name and a mobile number (no OTP), then can rate, add remarks (shown only after the
// admin approves them) and claim the optional UPI "support the author" payment (confirmed by the admin).
// The number is NOT verified: anyone can type any number. That is acceptable here because remarks are moderated, the public never sees
// numbers, and one number can rate a recipe only once. Visitors live in their own tables (kp_visitors), apart from the main app's accounts.
// The session token travels in an Authorization: Bearer header, because the main site (kidposhan.in) calls this Worker cross-origin.

const SESSION_DAYS = 90;
const now = () => Math.floor(Date.now() / 1000);
const rid = (p) => p + '_' + crypto.randomUUID().replace(/-/g, '').slice(0, 20);

export class UserError extends Error { constructor(m, status = 400) { super(m); this.status = status; } }

// 10-digit Indian mobile starting 6-9; "+91 98765 43210", "09876543210" and "919876543210" are accepted
export function normaliseMobile(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (!/^[6-9]\d{9}$/.test(d)) throw new UserError('Enter a 10-digit Indian mobile number.');
  return d;
}

const cleanName = (s) => String(s || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);

// Name + mobile in, session token out. The same number gets the same visitor back (the newest name is kept).
const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[A-Za-z]{2,}$/;
export function normaliseEmail(raw) {
  const e = String(raw || '').trim().toLowerCase();
  if (!EMAIL.test(e) || e.length > 120) throw new UserError('Enter a valid email address.');
  return e;
}

export async function joinVisitor(env, { name, mobile, email } = {}) {
  const n = cleanName(name);
  if (n.length < 2) throw new UserError('Please enter your name.');
  const m = normaliseMobile(mobile);
  const em = normaliseEmail(email);
  const t = now();
  const hour = await env.DB.prepare('SELECT count(*) n FROM kp_visitor_sessions WHERE created_at > ?').bind(t - 3600).first();
  if (hour.n >= 300) throw new UserError('Too many people are joining right now. Please try again in a little while.', 429);     // abuse guard
  const mine = await env.DB.prepare('SELECT count(*) n FROM kp_visitor_sessions s JOIN kp_visitors v ON v.id = s.visitor_id WHERE v.mobile = ? AND s.created_at > ?').bind(m, t - 3600).first();
  if (mine.n >= 10) throw new UserError('Too many tries for this number. Please try later.', 429);
  let v = await env.DB.prepare('SELECT id FROM kp_visitors WHERE mobile = ?').bind(m).first();
  if (v) await env.DB.prepare('UPDATE kp_visitors SET name = ?, email = ? WHERE id = ?').bind(n, em, v.id).run();
  else { v = { id: rid('vis') }; await env.DB.prepare('INSERT INTO kp_visitors (id, mobile, name, email, created_at) VALUES (?,?,?,?,?)').bind(v.id, m, n, em, t).run(); }
  const token = rid('kps') + crypto.randomUUID().replace(/-/g, '');
  await env.DB.prepare('INSERT INTO kp_visitor_sessions (id, visitor_id, expires_at, created_at) VALUES (?,?,?,?)').bind(token, v.id, t + SESSION_DAYS * 86400, t).run();
  return { token, name: n };
}

// Admin only: everyone who has joined, newest first, with how much they have taken part.
export async function listVisitors(env, { limit = 500 } = {}) {
  const { results } = await env.DB.prepare(
    `SELECT v.name, v.mobile, v.email, v.created_at,
            (SELECT count(*) FROM kp_ratings r WHERE r.user_id = v.id) AS ratings,
            (SELECT count(*) FROM kp_remarks m WHERE m.user_id = v.id) AS remarks
       FROM kp_visitors v ORDER BY v.created_at DESC LIMIT ?`
  ).bind(limit).all();
  const total = await env.DB.prepare('SELECT count(*) n FROM kp_visitors').first();
  return { total: total.n, visitors: results };
}

export async function userFromRequest(request, env) {
  const m = (request.headers.get('authorization') || '').match(/^Bearer\s+(\S+)$/);
  if (!m) return null;
  return env.DB.prepare('SELECT v.id, v.name, v.mobile FROM kp_visitor_sessions s JOIN kp_visitors v ON v.id = s.visitor_id WHERE s.id = ? AND s.expires_at > ?').bind(m[1], now()).first();
}

export async function logout(request, env) {
  const m = (request.headers.get('authorization') || '').match(/^Bearer\s+(\S+)$/);
  if (m) await env.DB.prepare('DELETE FROM kp_visitor_sessions WHERE id = ?').bind(m[1]).run();
}

export async function setName(env, user, name) {
  const n = cleanName(name);
  if (n.length < 2) throw new UserError('Please enter your name.');
  await env.DB.prepare('UPDATE kp_visitors SET name = ? WHERE id = ?').bind(n, user.id).run();
  return { name: n };
}

async function liveRecipe(env, id) {
  const r = await env.DB.prepare("SELECT id FROM kp_recipes WHERE id = ? AND review_status = 'approved'").bind(id).first();
  if (!r) throw new UserError('This recipe is not available.', 404);
}

// ---- ratings: one rating per visitor per recipe (changing it replaces it) ----
export async function rateRecipe(env, user, recipeId, stars) {
  const s = Math.round(+stars);
  if (!(s >= 1 && s <= 5)) throw new UserError('Choose 1 to 5 stars.');
  await liveRecipe(env, recipeId);
  await env.DB.prepare('INSERT INTO kp_ratings (recipe_id, user_id, stars, created_at) VALUES (?,?,?,?) ON CONFLICT(recipe_id, user_id) DO UPDATE SET stars = excluded.stars, created_at = excluded.created_at')
    .bind(recipeId, user.id, s, now()).run();
  return ratingFor(env, recipeId, user);
}

// "liked" = people who gave 4 or 5 stars
export async function ratingFor(env, recipeId, user = null) {
  const a = await env.DB.prepare('SELECT count(*) AS count, round(avg(stars), 1) AS avg, sum(stars >= 4) AS liked FROM kp_ratings WHERE recipe_id = ?').bind(recipeId).first();
  const mine = user ? await env.DB.prepare('SELECT stars FROM kp_ratings WHERE recipe_id = ? AND user_id = ?').bind(recipeId, user.id).first() : null;
  return { average: a.count ? a.avg : null, count: a.count, liked: a.liked || 0, mine: mine ? mine.stars : null };
}

// ---- remarks: stored as pending; only approved ones are ever returned to the public ----
export async function addRemark(env, user, recipeId, body) {
  const text = String(body || '').replace(/[<>]/g, '').replace(/[ \t]+/g, ' ').trim();
  if (text.length < 3) throw new UserError('Please write a few words.');
  if (text.length > 600) throw new UserError('Please keep it under 600 characters.');
  await liveRecipe(env, recipeId);
  const waiting = await env.DB.prepare("SELECT count(*) n FROM kp_remarks WHERE user_id = ? AND status = 'pending'").bind(user.id).first();
  if (waiting.n >= 3) throw new UserError('You already have remarks waiting for approval. Thank you for your patience.', 429);
  const recent = await env.DB.prepare('SELECT count(*) n FROM kp_remarks WHERE user_id = ? AND created_at > ?').bind(user.id, now() - 3600).first();
  if (recent.n >= 5) throw new UserError('Too many remarks in an hour. Please try later.', 429);
  await env.DB.prepare('INSERT INTO kp_remarks (recipe_id, user_id, display_name, mobile_tail, body, created_at) VALUES (?,?,?,?,?,?)')
    .bind(recipeId, user.id, cleanName(user.name), String(user.mobile || '').slice(-4), text, now()).run();
  return { received: true, message: 'Thank you. Your remark will appear after our team approves it.' };
}

export async function approvedRemarks(env, recipeId, limit = 30) {
  const { results } = await env.DB.prepare("SELECT display_name AS name, body, created_at FROM kp_remarks WHERE recipe_id = ? AND status = 'approved' ORDER BY created_at DESC LIMIT ?").bind(recipeId, limit).all();
  return results;
}

export async function listRemarks(env, { status = 'pending', limit = 50 } = {}) {
  if (!['pending', 'approved', 'rejected'].includes(status)) throw new UserError('Unknown status');
  const { results } = await env.DB.prepare(
    `SELECT m.id, m.recipe_id, r.name AS recipe_name, m.display_name, m.mobile_tail, m.body, m.status, m.created_at
       FROM kp_remarks m JOIN kp_recipes r ON r.id = m.recipe_id WHERE m.status = ? ORDER BY m.created_at DESC LIMIT ?`
  ).bind(status, limit).all();
  const counts = await env.DB.prepare('SELECT status, count(*) n FROM kp_remarks GROUP BY status').all();
  return { remarks: results, counts: Object.fromEntries(counts.results.map((c) => [c.status, c.n])) };
}

export async function reviewRemark(env, id, { action, body } = {}) {
  if (action === 'edit') {                                       // the admin may tidy the wording before approving
    const text = String(body || '').replace(/[<>]/g, '').trim().slice(0, 600);
    if (text.length < 3) throw new UserError('Remark text is empty.');
    await env.DB.prepare('UPDATE kp_remarks SET body = ? WHERE id = ?').bind(text, id).run();
    return { id, edited: true };
  }
  const status = { approve: 'approved', reject: 'rejected', unpublish: 'pending' }[action];
  if (!status) throw new UserError('action must be approve, reject, unpublish or edit');
  const r = await env.DB.prepare('UPDATE kp_remarks SET status = ?, reviewed_at = ? WHERE id = ?').bind(status, now(), id).run();
  if (!r.meta.changes) throw new UserError('Remark not found', 404);
  return { id, status };
}

// ---- UPI "support the author": the visitor pays in their UPI app, then tells us; the admin confirms ----
export const SUPPORT_PAISE = 500;
export function payConfig(env, recipeId = null) {
  const vpa = String(env.UPI_ID || '').trim();
  if (!/^[\w.\-]{2,}@[a-z][a-z0-9]{1,}$/i.test(vpa)) return { ready: false, amount_rupees: SUPPORT_PAISE / 100 };
  const q = new URLSearchParams({ pa: vpa, pn: env.UPI_PAYEE_NAME || 'KidPoshan', am: (SUPPORT_PAISE / 100).toFixed(2), cu: 'INR', tn: recipeId ? `KidPoshan recipe ${recipeId}` : 'KidPoshan support' });
  return { ready: true, amount_rupees: SUPPORT_PAISE / 100, payee: env.UPI_PAYEE_NAME || 'KidPoshan', upi_id: vpa, link: 'upi://pay?' + q.toString().replace(/\+/g, '%20') };
}

export async function claimPayment(env, user, recipeId, note) {
  if (recipeId) await liveRecipe(env, recipeId);
  const n = String(note || '').replace(/[<>]/g, '').trim().slice(0, 60);
  const recent = await env.DB.prepare('SELECT count(*) n FROM kp_support_payments WHERE user_id IS ? AND created_at > ?').bind(user?.id || null, now() - 3600).first();
  if (recent.n >= 5) throw new UserError('Too many submissions. Please try later.', 429);
  const r = await env.DB.prepare('INSERT INTO kp_support_payments (recipe_id, user_id, amount_paise, payer_note, created_at) VALUES (?,?,?,?,?)')
    .bind(recipeId || null, user?.id || null, SUPPORT_PAISE, n || null, now()).run();
  return { received: true, id: r.meta.last_row_id, message: 'Thank you for supporting the author. We will confirm your payment shortly.' };
}

export async function listPayments(env, { status = 'claimed', limit = 100 } = {}) {
  if (!['claimed', 'confirmed', 'rejected'].includes(status)) throw new UserError('Unknown status');
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.recipe_id, r.name AS recipe_name, p.amount_paise, p.payer_note, p.status, p.created_at, u.name AS payer, substr(u.mobile, -4) AS mobile_tail
       FROM kp_support_payments p LEFT JOIN kp_recipes r ON r.id = p.recipe_id LEFT JOIN kp_visitors u ON u.id = p.user_id WHERE p.status = ? ORDER BY p.created_at DESC LIMIT ?`
  ).bind(status, limit).all();
  const t = await env.DB.prepare("SELECT status, count(*) n, sum(amount_paise) paise FROM kp_support_payments GROUP BY status").all();
  return { payments: results, totals: Object.fromEntries(t.results.map((x) => [x.status, { count: x.n, rupees: (x.paise || 0) / 100 }])) };
}

export async function reviewPayment(env, id, { action } = {}) {
  const status = { confirm: 'confirmed', reject: 'rejected' }[action];
  if (!status) throw new UserError('action must be confirm or reject');
  const r = await env.DB.prepare('UPDATE kp_support_payments SET status = ?, reviewed_at = ? WHERE id = ?').bind(status, now(), id).run();
  if (!r.meta.changes) throw new UserError('Payment not found', 404);
  return { id, status };
}
