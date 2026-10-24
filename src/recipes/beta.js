// The beta: parents report mistakes, and the people who send a pack's photos can be thanked by email (optional, never required).
// Nothing here is shown publicly except counts. Emails are used only to say thank you or to say what was done about a report.

import { gmailSend } from './outreach.js';

const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[A-Za-z]{2,}$/;
const REASONS = ['name', 'numbers', 'photo', 'other'];
export class BetaError extends Error { constructor(m, status = 400) { super(m); this.status = status; } }

export function cleanEmail(v) {
  const e = String(v || '').trim().toLowerCase().slice(0, 120);
  if (!e) return null;
  if (!EMAIL.test(e)) throw new BetaError('That does not look like an email address. You can leave it empty.');
  return e;
}

// "Report a mistake" on a pack
export async function submitReport(env, body, { who = null } = {}) {
  const reason = REASONS.includes(body.reason) ? body.reason : null;
  if (!reason) throw new BetaError('Please choose what is wrong.');
  const note = String(body.note || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600);
  if (reason === 'other' && note.length < 5) throw new BetaError('Please say a little about what is wrong.');
  const email = cleanEmail(body.email);
  const pid = Number.isInteger(+body.product_id) && +body.product_id > 0 ? +body.product_id : null;
  const code = String(body.barcode || '').replace(/\D/g, '').slice(0, 14) || null;
  if (!pid && !code) throw new BetaError('Which pack is this about?');
  if (who) {
    const h = await env.DB.prepare("SELECT COUNT(*) n FROM kp_scans WHERE who = ? AND kind = 'report' AND ts > datetime('now','-1 hour')").bind(who).first();
    if ((h?.n || 0) >= 5) throw new BetaError('Thank you. That is a lot of reports for one hour. Please try again a little later.', 429);
    await env.DB.prepare("INSERT INTO kp_scans (who, kind, barcode) VALUES (?, 'report', ?)").bind(who, code).run();
  }
  await env.DB.prepare('INSERT INTO kp_reports (product_id, barcode, reason, note, email, who) VALUES (?,?,?,?,?,?)').bind(pid, code, reason, note || null, email, who).run();
  return { ok: true, message: 'Thank you. We will look at it.' };
}

export async function listReports(env, { status = 'open' } = {}) {
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.ts, r.product_id, r.barcode, r.reason, r.note, r.email, r.status, p.name AS product_name, p.status AS product_status
       FROM kp_reports r LEFT JOIN kp_ready_products p ON p.id = r.product_id WHERE r.status = ? ORDER BY r.id DESC LIMIT 200`
  ).bind(status === 'done' ? 'done' : 'open').all();
  return { reports: results };
}
export async function resolveReport(env, id, status = 'done') {
  await env.DB.prepare('UPDATE kp_reports SET status = ? WHERE id = ?').bind(status === 'open' ? 'open' : 'done', id).run();
  return { ok: true };
}

// the person who sent a pack's photos (an email only if they chose to leave one)
export async function recordContributor(env, productId, email) {
  await env.DB.prepare('INSERT INTO kp_contrib (product_id, email) VALUES (?, ?)').bind(productId, email || null).run();
}

const gmailConnected = (env) => !!(env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN && env.GMAIL_SENDER);

// Cron: a thank-you to each contributor whose pack the owner has checked and approved. Nothing is sent until Gmail is connected.
export async function thankPending(env, { limit = 5, send = gmailSend } = {}) {
  if (!gmailConnected(env) && send === gmailSend) return { skipped: 'Gmail is not connected yet' };
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.email, p.name FROM kp_contrib c JOIN kp_ready_products p ON p.id = c.product_id
      WHERE c.email IS NOT NULL AND c.thanked_at IS NULL AND p.status = 'approved' ORDER BY c.id LIMIT ?`
  ).bind(limit).all();
  let sent = 0;
  for (const c of results) {
    try {
      await send(env, c.email, 'Thank you: your pack is now on Poshan Score',
        `Hello,\n\nThank you for sending the photos of ${c.name}. Our team has checked it and it is now on Poshan Score for every parent to see.\n\nPoshan Score is a beta that parents are building together, so every pack you add or correct helps the next parent. You can scan another pack any time at https://www.kidposhan.in/scan\n\nWith thanks,\n${env.OUTREACH_SIGNOFF || 'The KidPoshan team'}\n\n(You are getting this once because you left your email when you sent the photos. We use it for nothing else.)`);
      await env.DB.prepare("UPDATE kp_contrib SET thanked_at = datetime('now') WHERE id = ?").bind(c.id).run();
      sent++;
    } catch (e) { console.error('thank', e); }
  }
  return { sent, waiting: results.length - sent };
}

// counts for the "Built with parents" page
export async function betaStats(env) {
  const q = async (sql) => (await env.DB.prepare(sql).first())?.n || 0;
  return {
    checked: await q("SELECT COUNT(*) n FROM kp_ready_products WHERE status = 'approved' AND score_status = 'exact'"),
    unchecked: await q("SELECT COUNT(*) n FROM kp_ready_products WHERE status = 'candidate' AND score_status = 'exact' AND data_source IN ('openfoodfacts','scan')"),
    from_parents: await q("SELECT COUNT(*) n FROM kp_ready_products WHERE data_source = 'scan' AND score_status = 'exact'"),
    contributors: await q('SELECT COUNT(DISTINCT product_id) n FROM kp_contrib'),
    reports_done: await q("SELECT COUNT(*) n FROM kp_reports WHERE status = 'done'"),
  };
}
