// The weekly healthy tiffin email: five lunchbox ideas for the child's age, each scoring Good (80 or more) for that age and not deep-fried, the same for
// everyone in an age group and diet in a given week, and not repeating the last four weeks. A parent signs up with an email, the child's age group and a
// food preference, and confirms from a link in a first email (double opt-in); every email has a one-click unsubscribe. Nothing is sent until the owner
// has set up a mail service (the RESEND_API_KEY secret and MAIL_FROM) and switched it on (NEWSLETTER_ON = on).
import { scoreSqlFor, capSqlFor } from './score.js';

export const BANDS = { '1-3': { mid: 24, label: '1 to 3 years' }, '4-6': { mid: 60, label: '4 to 6 years' }, '7-9': { mid: 96, label: '7 to 9 years' }, '10-12': { mid: 132, label: '10 to 12 years' } };
const DIETS = { veg: ['veg', 'jain'], jain: ['jain'], nonveg: ['veg', 'jain', 'nonveg', 'egg'] };
const SITE = 'https://www.kidposhan.in';
const PER_RUN = 40, MIN_GAP_DAYS = 6, KEEP_WEEKS = 4;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const tok = () => [...crypto.getRandomValues(new Uint8Array(18))].map((b) => b.toString(16).padStart(2, '0')).join('');
const EMAIL = /^[^\s@<>"']{1,64}@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

// the page address of a recipe, as the site build makes it
const recName = (n) => String(n || 'Recipe').split('|')[0].replace(/\s+/g, ' ').replace(/\s+recipes?\s*$/i, '').trim();
const slugOf = (id, name) => `${id}-${String(name || 'recipe').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '')}`;

// ISO week of a date, "2026-W45"
export function isoWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t - y0) / 86400000 + 1) / 7)).padStart(2, '0')}`;
}
function rng(seed) { let h = 1779033703 ^ seed.length; for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); } let a = h >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------- the issue ----------
export async function composeIssue(env, { band = '4-6', diet = 'veg', week = isoWeek() } = {}) {
  if (!BANDS[band]) band = '4-6'; if (!DIETS[diet]) diet = 'veg';
  const mid = BANDS[band].mid, diets = DIETS[diet];
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.name, r.image_url, r.total_minutes, r.diet, r.how_often, ${scoreSqlFor(band)} AS score
       FROM kp_recipes r JOIN kp_recipe_sources s ON s.id = r.source_id
      WHERE r.review_status = 'approved' AND r.score_hidden = 0 AND r.poshan_score IS NOT NULL AND r.total_minutes IS NOT NULL AND r.total_minutes <= 60
        AND EXISTS (SELECT 1 FROM kp_recipe_occasions o WHERE o.recipe_id = r.id AND o.occasion = 'lunchbox')
        AND r.diet IN (${diets.map(() => '?').join(',')}) AND r.age_min_months <= ? AND r.age_max_months >= ?
        AND (${scoreSqlFor(band)}) >= 80 AND ${capSqlFor(band)} = 0
        AND r.diet_tags IS NOT NULL AND r.diet_tags NOT LIKE '%,fried,%'
      ORDER BY r.id`).bind(...diets, mid, Math.min(144, mid)).all();
  const used = new Set();
  const prev = await env.DB.prepare('SELECT recipe_ids FROM kp_newsletter_issues WHERE band = ? AND diet = ? AND week < ? ORDER BY week DESC LIMIT ?').bind(band, diet, week, KEEP_WEEKS).all();
  for (const p of prev.results) for (const id of String(p.recipe_ids).split(',')) used.add(+id);
  const fresh = results.filter((r) => !used.has(r.id)), pool = fresh.length >= 5 ? fresh : results;
  const rand = rng(`${week}|${band}|${diet}`);
  const order = pool.map((r) => ({ r, k: rand() })).sort((a, b) => a.k - b.k).map((x) => x.r);
  const picks = [], firstWords = new Set();
  for (const r of order) { const w = recName(r.name).toLowerCase().split(/\s+/)[0]; if (firstWords.has(w)) continue; firstWords.add(w); picks.push(r); if (picks.length === 5) break; }
  if (picks.length < 3) return null;                 // not enough to send a good week
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const items = picks.map((r, i) => ({ day: days[i], id: r.id, name: recName(r.name), score: Math.round(r.score), minutes: r.total_minutes, image: r.image_url, url: `${SITE}/recipes/${slugOf(r.id, recName(r.name))}` }));
  const subject = `This week's healthy tiffin ideas for ${BANDS[band].label}`;
  const text = [`Healthy tiffin ideas for ${BANDS[band].label}`, `Each scores Good (80 or more) on the Poshan Score for this age and is not deep-fried.`, '', ...items.map((x) => `${x.day}: ${x.name} (${x.score}/100, ${x.minutes} min)\n${x.url}`), '', `More ideas: ${SITE}/meal-ideas`].join('\n');
  const html = `<div style="font:16px/1.55 system-ui,Segoe UI,sans-serif;max-width:560px;margin:0 auto;color:#221A12"><h1 style="font-size:24px;margin:0 0 6px">Healthy tiffin ideas</h1><p style="margin:0 0 14px;color:#6B5D4B">For ${esc(BANDS[band].label)}. Each scores Good (80 or more) on the Poshan Score for this age and is not deep-fried.</p>${items.map((x) => `<div style="border:1px solid #E7DFCE;border-radius:12px;padding:12px;margin:0 0 10px;background:#fff">${x.image ? `<img src="${esc(x.image)}" alt="" width="96" style="float:right;margin:0 0 6px 10px;border-radius:8px">` : ''}<div style="font-size:13px;color:#6B5D4B">${x.day}</div><a href="${esc(x.url)}" style="font-weight:700;color:#2F5A2C;text-decoration:none">${esc(x.name)}</a><div style="font-size:14px;color:#6B5D4B">${x.score}/100 · ${x.minutes} min</div><div style="clear:both"></div></div>`).join('')}<p><a href="${SITE}/meal-ideas" style="display:inline-block;background:#221A12;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none">Plan the whole week</a></p>`;
  return { week, band, diet, items, subject, text, html };
}
const footer = (token) => ({
  html: `<p style="font-size:12.5px;color:#6B5D4B;margin-top:22px">Poshan Score is an independent rating, not a certification, and the age guide is general, not medical advice. You get this email because you signed up at kidposhan.in. <a href="${SITE}/newsletter?unsubscribe=${token}">Unsubscribe</a> in one click. Questions: kidposhan@gmail.com</p></div>`,
  text: `\n\n--\nYou get this email because you signed up at kidposhan.in. Unsubscribe in one click: ${SITE}/newsletter?unsubscribe=${token}\nPoshan Score is an independent rating, not a certification; the age guide is general, not medical advice.`,
});

// ---------- sending ----------
export const mailReady = (env) => !!(env.RESEND_API_KEY && env.MAIL_FROM);
export async function sendMail(env, { to, subject, html, text, unsubscribe }) {
  if (!mailReady(env)) return { ok: false, why: 'no mail service set up' };
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, html, text, headers: unsubscribe ? { 'List-Unsubscribe': `<${unsubscribe}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : undefined }),
  });
  return res.ok ? { ok: true } : { ok: false, why: `mail service ${res.status}` };
}

// ---------- signing up ----------
export async function subscribe(env, { email, band, diet, consent }, { who = null } = {}) {
  const e = String(email || '').trim().toLowerCase();
  if (!EMAIL.test(e) || e.length > 120) return { ok: false, message: 'That does not look like an email address.' };
  if (!consent) return { ok: false, message: 'Please tick the box to say you want the weekly email.' };
  if (who) {
    const n = (await env.DB.prepare("SELECT COUNT(*) n FROM kp_scans WHERE who = ? AND kind = 'newsletter' AND ts > datetime('now','-1 hour')").bind(who).first()).n;
    if (n >= 5) return { ok: false, message: 'Too many tries. Please try again in an hour.' };
    await env.DB.prepare("INSERT INTO kp_scans (who, kind, barcode) VALUES (?, 'newsletter', ?)").bind(who, 'signup').run();
  }
  const b = BANDS[band] ? band : '4-6', d = DIETS[diet] ? diet : 'veg';
  const row = await env.DB.prepare('SELECT id, status, token FROM kp_subscribers WHERE email = ?').bind(e).first();
  let token = row ? row.token : tok();
  if (!row) await env.DB.prepare("INSERT INTO kp_subscribers (email, band, diet, status, token, created_at, consent_at) VALUES (?,?,?, 'pending', ?, datetime('now'), datetime('now'))").bind(e, b, d, token).run();
  else if (row.status !== 'active') await env.DB.prepare("UPDATE kp_subscribers SET band = ?, diet = ?, status = 'pending', consent_at = datetime('now') WHERE id = ?").bind(b, d, row.id).run();
  // the same answer for a new address and a known one, so nobody can find out who is on the list
  if (!row || row.status !== 'active') {
    const link = `${SITE}/newsletter?confirm=${token}`;
    await sendMail(env, { to: e, subject: 'Confirm your weekly tiffin email', text: `Please confirm that you want a healthy tiffin email every week from KidPoshan: ${link}\n\nIf you did not ask for this, ignore this email and nothing will be sent.`, html: `<p>Please confirm that you want a healthy tiffin email every week from KidPoshan.</p><p><a href="${link}" style="display:inline-block;background:#3F6B3C;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none">Yes, send me the weekly email</a></p><p style="font-size:13px;color:#6B5D4B">If you did not ask for this, ignore this email and nothing will be sent.</p>` });
  }
  return { ok: true, message: 'Almost done: we sent an email to confirm. Open it and tap the green button.', mail_ready: mailReady(env) };
}
export async function confirm(env, token) {
  const r = await env.DB.prepare("UPDATE kp_subscribers SET status = 'active', confirmed_at = datetime('now') WHERE token = ? AND status IN ('pending','active')").bind(String(token || '')).run();
  return { ok: (r.meta && r.meta.changes) > 0 };
}
export async function unsubscribe(env, token) {
  const r = await env.DB.prepare("UPDATE kp_subscribers SET status = 'unsubscribed', unsubscribed_at = datetime('now') WHERE token = ? AND status != 'unsubscribed'").bind(String(token || '')).run();
  return { ok: (r.meta && r.meta.changes) > 0 };
}

// ---------- the weekly send (from the cron; only when the owner has switched it on) ----------
export async function sendWeekly(env, { limit = PER_RUN, week = isoWeek() } = {}) {
  if (String(env.NEWSLETTER_ON || '').toLowerCase() !== 'on') return { skipped: 'newsletter is not switched on' };
  if (!mailReady(env)) return { skipped: 'no mail service set up' };
  const { results } = await env.DB.prepare("SELECT id, email, band, diet, token FROM kp_subscribers WHERE status = 'active' AND (last_sent_week IS NULL OR last_sent_week != ?) ORDER BY id LIMIT ?").bind(week, limit).all();
  const cache = new Map(); let sent = 0, failed = 0;
  for (const s of results) {
    const key = `${s.band}|${s.diet}`;
    if (!cache.has(key)) {
      const issue = await composeIssue(env, { band: s.band, diet: s.diet, week });
      cache.set(key, issue);
      if (issue) await env.DB.prepare('INSERT OR IGNORE INTO kp_newsletter_issues (week, band, diet, recipe_ids) VALUES (?,?,?,?)').bind(week, s.band, s.diet, issue.items.map((x) => x.id).join(',')).run();
    }
    const issue = cache.get(key); if (!issue) continue;
    const f = footer(s.token);
    const r = await sendMail(env, { to: s.email, subject: issue.subject, html: issue.html + f.html, text: issue.text + f.text, unsubscribe: `${SITE}/newsletter?unsubscribe=${s.token}` });
    if (r.ok) { sent++; await env.DB.prepare('UPDATE kp_subscribers SET last_sent_week = ?, sends = sends + 1 WHERE id = ?').bind(week, s.id).run(); } else failed++;
  }
  return { sent, failed, left: Math.max(0, results.length - sent - failed) };
}
export async function subscriberCounts(env) {
  const { results } = await env.DB.prepare('SELECT status, COUNT(*) n FROM kp_subscribers GROUP BY status').all();
  return Object.fromEntries(results.map((r) => [r.status, r.n]));
}
export const issueFooter = footer;
