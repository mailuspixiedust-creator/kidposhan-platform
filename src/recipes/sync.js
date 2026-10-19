// Saved recipes and the weekly plan live on the phone. To use them on another device a parent proves their mobile number with a
// one-time code (OTP). Only then are the saves stored here, under the verified number; nobody can read a list by typing a number.
// The SMS goes through MSG91 when MSG91_AUTH_KEY and MSG91_OTP_TEMPLATE_ID are set; until then syncing says it is not switched on.

import { normaliseMobile, UserError } from './social.js';

const now = () => Math.floor(Date.now() / 1000);
const OTP_MINUTES = 10, MAX_ATTEMPTS = 5, MAX_SENDS_PER_HOUR = 3, SESSION_DAYS = 180, MAX_ITEMS = 300;
const enc = new TextEncoder();
async function sha256(text) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)))].map((b) => b.toString(16).padStart(2, '0')).join(''); }
const hashCode = (env, mobile, code) => sha256(`${env.OTP_PEPPER || 'kp-otp'}:${mobile}:${code}`);
const newCode = () => String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
const rid = () => 'kpy_' + crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '').slice(0, 12);

export const smsReady = (env) => !!(typeof env.__sms === 'function' || (env.MSG91_AUTH_KEY && env.MSG91_OTP_TEMPLATE_ID));
async function sendSms(env, mobile, code) {
  if (typeof env.__sms === 'function') return env.__sms(mobile, code);          // tests
  const u = new URL('https://control.msg91.com/api/v5/otp');
  u.search = new URLSearchParams({ template_id: env.MSG91_OTP_TEMPLATE_ID, mobile: '91' + mobile, authkey: env.MSG91_AUTH_KEY, otp: code, otp_expiry: String(OTP_MINUTES) }).toString();
  const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  if (!r.ok) throw new UserError('We could not send the code just now. Please try again in a minute.', 502);
}

// step 1: send a code to the number
export async function startSync(env, { mobile } = {}) {
  const m = normaliseMobile(mobile);
  if (!smsReady(env)) throw new UserError('Syncing across devices is not switched on yet. Your saved recipes are safe on this phone.', 503);
  const t = now();
  const row = await env.DB.prepare('SELECT sent_count, window_start FROM kp_otp WHERE mobile = ?').bind(m).first();
  let count = 1, windowStart = t;
  if (row && t - row.window_start < 3600) {
    if (row.sent_count >= MAX_SENDS_PER_HOUR) throw new UserError('Too many codes were sent to this number. Please try again in an hour.', 429);
    count = row.sent_count + 1; windowStart = row.window_start;
  }
  const code = newCode();
  await env.DB.prepare('INSERT INTO kp_otp (mobile, code_hash, expires_at, attempts, sent_at, sent_count, window_start) VALUES (?,?,?,?,?,?,?) ON CONFLICT(mobile) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, sent_at = excluded.sent_at, sent_count = excluded.sent_count, window_start = excluded.window_start')
    .bind(m, await hashCode(env, m, code), t + OTP_MINUTES * 60, 0, t, count, windowStart).run();
  await sendSms(env, m, code);
  return { sent: true, minutes: OTP_MINUTES };
}

const parse = (s) => { try { const o = JSON.parse(s || '{}'); return o && typeof o === 'object' ? o : {}; } catch { return {}; } };
// what a device may store: a bounded set of small recipe cards and a plan that points at them
export function tidy(saved, plan) {
  const out = {};
  for (const k of Object.keys(saved || {}).slice(0, MAX_ITEMS)) {
    const c = saved[k] || {}, id = +c.id;
    if (!Number.isFinite(id)) continue;
    out[id] = { id, name: String(c.name || '').slice(0, 140), mins: c.mins ?? null, make_ahead: !!c.make_ahead, score: c.score ?? null, kind: c.kind || null, capped: !!c.capped, diet: c.diet || null, mayo: !!c.mayo, image: c.image ? String(c.image).slice(0, 400) : null, credit: String(c.credit || '').slice(0, 80), occ: Array.isArray(c.occ) ? c.occ.slice(0, 6) : [], match: 'saved' };
  }
  const pl = {};
  for (const [k, v] of Object.entries(plan || {}).slice(0, 7 * 6)) if (out[+v]) pl[String(k).slice(0, 30)] = +v;
  return { saved: out, plan: pl };
}

// step 2: the code, plus what is on this device; returns a token and the merged lists
export async function verifySync(env, { mobile, code, saved, plan } = {}) {
  const m = normaliseMobile(mobile), t = now();
  const row = await env.DB.prepare('SELECT code_hash, expires_at, attempts FROM kp_otp WHERE mobile = ?').bind(m).first();
  if (!row || row.expires_at < t) throw new UserError('That code has expired. Ask for a new one.', 400);
  if (row.attempts >= MAX_ATTEMPTS) throw new UserError('Too many wrong codes. Ask for a new one.', 429);
  const ok = (await hashCode(env, m, String(code || '').trim())) === row.code_hash;
  await env.DB.prepare('UPDATE kp_otp SET attempts = attempts + 1 WHERE mobile = ?').bind(m).run();
  if (!ok) throw new UserError('That code is not right. Please check and try again.', 400);
  await env.DB.prepare('DELETE FROM kp_otp WHERE mobile = ?').bind(m).run();             // a code works once
  const mine = await env.DB.prepare('SELECT saved_json, plan_json FROM kp_sync WHERE mobile = ?').bind(m).first();
  const merged = tidy({ ...parse(mine?.saved_json), ...(saved || {}) }, { ...parse(mine?.plan_json), ...(plan || {}) });
  await env.DB.prepare('INSERT INTO kp_sync (mobile, saved_json, plan_json, updated_at) VALUES (?,?,?,?) ON CONFLICT(mobile) DO UPDATE SET saved_json = excluded.saved_json, plan_json = excluded.plan_json, updated_at = excluded.updated_at')
    .bind(m, JSON.stringify(merged.saved), JSON.stringify(merged.plan), t).run();
  const token = rid();
  await env.DB.prepare('INSERT INTO kp_sync_sessions (id, mobile, expires_at, created_at) VALUES (?,?,?,?)').bind(token, m, t + SESSION_DAYS * 86400, t).run();
  return { token, mobile_hint: '••••••' + m.slice(-4), updated_at: t, ...merged };
}

export async function syncUser(request, env) {
  const m = (request.headers.get('authorization') || '').match(/^Bearer\s+(kpy_\S+)$/);
  if (!m) return null;
  return env.DB.prepare('SELECT mobile FROM kp_sync_sessions WHERE id = ? AND expires_at > ?').bind(m[1], now()).first();
}
export async function readSync(env, user) {
  const r = await env.DB.prepare('SELECT saved_json, plan_json, updated_at FROM kp_sync WHERE mobile = ?').bind(user.mobile).first();
  return { saved: parse(r?.saved_json), plan: parse(r?.plan_json), updated_at: r?.updated_at || 0, mobile_hint: '••••••' + user.mobile.slice(-4) };
}
export async function writeSync(env, user, { saved, plan } = {}) {
  const v = tidy(saved, plan), t = now();
  await env.DB.prepare('INSERT INTO kp_sync (mobile, saved_json, plan_json, updated_at) VALUES (?,?,?,?) ON CONFLICT(mobile) DO UPDATE SET saved_json = excluded.saved_json, plan_json = excluded.plan_json, updated_at = excluded.updated_at')
    .bind(user.mobile, JSON.stringify(v.saved), JSON.stringify(v.plan), t).run();
  return { ...v, updated_at: t };
}
export async function endSync(request, env) {
  const m = (request.headers.get('authorization') || '').match(/^Bearer\s+(kpy_\S+)$/);
  if (m) await env.DB.prepare('DELETE FROM kp_sync_sessions WHERE id = ?').bind(m[1]).run();
}
