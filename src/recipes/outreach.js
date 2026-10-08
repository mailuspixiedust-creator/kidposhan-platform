// Author outreach: ask each recipe site's owner for permission, by Gmail, and keep track of who replied and how.
// Nothing is sent automatically: the owner types each contact email, previews the message, and presses Send in the admin page.
// Gmail API needs four Worker secrets: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, GMAIL_SENDER (see OUTREACH.md).

const now = () => Math.floor(Date.now() / 1000);
const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[A-Za-z]{2,}$/;
export class OutreachError extends Error { constructor(m, status = 400) { super(m); this.status = status; } }

export async function setContactEmail(env, sourceId, email) {
  const e = String(email || '').trim().toLowerCase();
  if (e && !EMAIL.test(e)) throw new OutreachError('That does not look like an email address.');
  const r = await env.DB.prepare('UPDATE kp_recipe_sources SET contact_email = ? WHERE id = ?').bind(e || null, sourceId).run();
  if (!r.meta.changes) throw new OutreachError('Source not found', 404);
  return { id: sourceId, contact_email: e || null };
}

export function buildMessage(env, source, recipeNames) {
  const sample = recipeNames.slice(0, 3).map((n) => `"${n}"`).join(', ');
  const sign = env.OUTREACH_SIGNOFF || 'The KidPoshan team';
  const subject = `Permission to feature ${source.name} recipes on KidPoshan`;
  const text = [
    `Hello ${source.name},`,
    '',
    `I run KidPoshan (https://www.kidposhan.in), a free guide that helps parents plan healthy meals for children and gives each dish a Poshan Score.`,
    '',
    `We use recipes from ${source.name}${sample ? `, for example ${sample}` : ''}. Each recipe shows your name, the photo credit and a link to your original page, and the cooking steps are written in our own words.`,
    '',
    `We would like to keep using your menu with your permission. KidPoshan is not a selling site. If we ever make money, we will share a portion of it with you. Visitors can also give a small optional Rs 5 contribution towards sharing with authors and keeping the site running.`,
    '',
    `Please reply to this email:`,
    `  YES  - you are happy for us to keep featuring your recipes`,
    `  NO   - we will take your recipes and photos down straight away`,
    '',
    `Your recipes are already linked and credited on our pages, so if you would rather they were not there, a reply of NO is enough and we will remove them promptly.`,
    '',
    `Thank you,`,
    sign,
    'https://www.kidposhan.in',
  ].join('\n');
  return { subject, text };
}

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const utf8 = (s) => new TextEncoder().encode(s);
const b64 = (s) => btoa(String.fromCharCode(...utf8(s)));

export function rawEmail(from, to, subject, text) {
  const body = b64(text).replace(/(.{76})/g, '$1\r\n');
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${b64(subject)}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    body,
  ].join('\r\n');
}

async function accessToken(env, fetchFn = fetch) {
  if (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET || !env.GMAIL_REFRESH_TOKEN || !env.GMAIL_SENDER) throw new OutreachError('Gmail is not connected yet (see OUTREACH.md).', 503);
  const r = await fetchFn('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GMAIL_CLIENT_ID, client_secret: env.GMAIL_CLIENT_SECRET, refresh_token: env.GMAIL_REFRESH_TOKEN, grant_type: 'refresh_token' }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new OutreachError('Google sign-in for Gmail failed: ' + (j.error_description || j.error || r.status), 502);
  return j.access_token;
}

export async function gmailSend(env, to, subject, text, fetchFn = fetch) {
  const token = await accessToken(env, fetchFn);
  const raw = b64url(utf8(rawEmail(env.GMAIL_SENDER, to, subject, text)));
  const r = await fetchFn('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ raw }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new OutreachError('Gmail refused the message: ' + (j.error?.message || r.status), 502);
  return { threadId: j.threadId, id: j.id };
}

async function recipeNamesFor(env, sourceId) {
  const { results } = await env.DB.prepare("SELECT name FROM kp_recipes WHERE source_id = ? AND review_status = 'approved' ORDER BY poshan_score IS NULL, poshan_score DESC, id LIMIT 3").bind(sourceId).all();
  return results.map((r) => r.name.replace(/\s*[|–—-]\s*.*$/, '').trim() || r.name);
}

export async function previewMessage(env, sourceId) {
  const s = await env.DB.prepare('SELECT id, name, contact_email FROM kp_recipe_sources WHERE id = ?').bind(sourceId).first();
  if (!s) throw new OutreachError('Source not found', 404);
  return { to: s.contact_email, ...buildMessage(env, s, await recipeNamesFor(env, s.id)) };
}

// One email per address. A source that was already emailed is skipped, never emailed twice.
export async function sendOutreach(env, sourceIds, { send = gmailSend } = {}) {
  const out = [];
  for (const id of sourceIds.slice(0, 20)) {
    const s = await env.DB.prepare('SELECT id, name, contact_email, active FROM kp_recipe_sources WHERE id = ?').bind(id).first();
    if (!s) { out.push({ id, skipped: 'not found' }); continue; }
    if (!s.contact_email) { out.push({ id, skipped: 'no email address' }); continue; }
    const dup = await env.DB.prepare('SELECT source_id FROM kp_outreach WHERE source_id = ? OR to_email = ?').bind(id, s.contact_email).first();
    if (dup) { out.push({ id, skipped: 'already emailed' }); continue; }
    try {
      const m = buildMessage(env, s, await recipeNamesFor(env, s.id));
      const sent = await send(env, s.contact_email, m.subject, m.text);
      await env.DB.prepare("INSERT INTO kp_outreach (source_id, to_email, status, gmail_thread, sent_at) VALUES (?,?,'sent',?,?)").bind(id, s.contact_email, sent.threadId || null, now()).run();
      out.push({ id, sent: true, to: s.contact_email });
    } catch (e) { out.push({ id, error: String(e.message).slice(0, 160) }); if (e.status === 503) break; }
  }
  return out;
}

// What a reply says, as a first guess for the owner to confirm. Never acts on its own.
export function classifyReply(text) {
  const t = ' ' + String(text || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ') + ' ';
  const no = /\b(no|not|don't|dont|do not|remove|take down|stop|decline|refuse|object|not allowed|without permission)\b/.test(t);
  const yes = /\b(yes|yep|ok|okay|sure|agree|agreed|allowed|go ahead|happy|fine|permission granted|you may|please feel free|glad)\b/.test(t);
  if (yes && !no) return 'replied_yes';
  if (no && !yes) return 'replied_no';
  return 'replied_other';
}

export async function checkReplies(env, { fetchFn = fetch } = {}) {
  const { results: open } = await env.DB.prepare("SELECT source_id, to_email, gmail_thread FROM kp_outreach WHERE status IN ('sent','replied_other') AND gmail_thread IS NOT NULL LIMIT 40").all();
  if (!open.length) return [];
  const token = await accessToken(env, fetchFn);
  const me = String(env.GMAIL_SENDER).toLowerCase();
  const out = [];
  for (const o of open) {
    const r = await fetchFn(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(o.gmail_thread)}?format=metadata&metadataHeaders=From`, { headers: { authorization: 'Bearer ' + token } });
    if (!r.ok) { out.push({ source_id: o.source_id, error: r.status }); continue; }
    const th = await r.json();
    const msgs = (th.messages || []).map((m) => ({ from: ((m.payload?.headers || []).find((h) => h.name.toLowerCase() === 'from') || {}).value || '', snippet: m.snippet || '', at: Math.floor((+m.internalDate || 0) / 1000) }));
    const theirs = msgs.filter((m) => !m.from.toLowerCase().includes(me));
    if (!theirs.length) continue;
    const last = theirs[theirs.length - 1];
    const status = /mailer-daemon|postmaster/i.test(last.from) ? 'bounced' : classifyReply(last.snippet);
    await env.DB.prepare('UPDATE kp_outreach SET status = ?, replied_at = ?, reply_snippet = ? WHERE source_id = ?').bind(status, last.at || now(), last.snippet.slice(0, 300), o.source_id).run();
    out.push({ source_id: o.source_id, status });
  }
  return out;
}

const NO_REPLY_DAYS = 14;
export async function listOutreach(env) {
  const { results } = await env.DB.prepare(
    `SELECT s.id, s.name, s.url, s.contact_email, s.photos_hidden, o.status, o.sent_at, o.replied_at, o.reply_snippet, o.note,
            (SELECT count(*) FROM kp_recipes r WHERE r.source_id = s.id AND r.review_status = 'approved') AS live_recipes
       FROM kp_recipe_sources s LEFT JOIN kp_outreach o ON o.source_id = s.id
      WHERE s.active = 1 AND (live_recipes > 0 OR o.source_id IS NOT NULL)
      ORDER BY live_recipes DESC, s.name`
  ).all();
  const cut = now() - NO_REPLY_DAYS * 86400;
  const rows = results.map((r) => ({ ...r, status: r.status === 'sent' && r.sent_at < cut ? 'no_reply' : r.status || (r.contact_email ? 'not_sent' : 'no_email') }));
  const tally = {}; for (const r of rows) tally[r.status] = (tally[r.status] || 0) + 1;
  return { sources: rows, tally };
}

// The owner's decision about a reply. "remove" takes the author's live recipes down and hides their photos (for a NO).
export async function markOutreach(env, sourceId, { status, note, remove } = {}) {
  if (!['replied_yes', 'replied_no', 'replied_other', 'no_reply', 'bounced', 'sent'].includes(status)) throw new OutreachError('Unknown status');
  const r = await env.DB.prepare('UPDATE kp_outreach SET status = ?, note = COALESCE(?, note) WHERE source_id = ?').bind(status, note ? String(note).slice(0, 300) : null, sourceId).run();
  if (!r.meta.changes) throw new OutreachError('This site has not been emailed yet.', 404);
  let removed = 0;
  if (status === 'replied_no' && remove) {
    await env.DB.prepare('UPDATE kp_recipe_sources SET photos_hidden = 1 WHERE id = ?').bind(sourceId).run();
    removed = (await env.DB.prepare("UPDATE kp_recipes SET review_status = 'rejected' WHERE source_id = ? AND review_status = 'approved'").bind(sourceId).run()).meta.changes;
  }
  return { source_id: sourceId, status, removed };
}
