// Author outreach: ask each recipe site's owner for permission, by Gmail, and keep track of who replied and how.
// The owner can press Send per site, or switch on automatic sending (off by default, with a daily limit). Replies are read from Gmail:
// contacted, agreed / no / other, and a phone number are written to the database for the owner to confirm.
// Gmail API needs four Worker secrets: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, GMAIL_SENDER (see OUTREACH.md).

const now = () => Math.floor(Date.now() / 1000);
const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[A-Za-z]{2,}$/;
export class OutreachError extends Error { constructor(m, status = 400) { super(m); this.status = status; } }

export async function setContactEmail(env, sourceId, email) {
  const e = String(email || '').trim().toLowerCase();
  if (e && !EMAIL.test(e)) throw new OutreachError('That does not look like an email address.');
  const r = await env.DB.prepare("UPDATE kp_recipe_sources SET contact_email = ?, contact_email_source = CASE WHEN ? IS NULL THEN NULL ELSE 'owner' END WHERE id = ?").bind(e || null, e || null, sourceId).run();
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
    `If you are happy to be reached, you are welcome to add a phone or WhatsApp number we can use (this is optional).`,
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

// A try-out: the exact email for this site, sent to YOUR OWN Gmail address only. Nothing is recorded and the creator is not contacted.
export async function sendTest(env, sourceId, { send = gmailSend } = {}) {
  const s = await env.DB.prepare('SELECT id, name FROM kp_recipe_sources WHERE id = ?').bind(sourceId).first();
  if (!s) throw new OutreachError('Source not found', 404);
  if (!env.GMAIL_SENDER) throw new OutreachError('Gmail is not connected yet (see OUTREACH.md).', 503);
  const m = buildMessage(env, s, await recipeNamesFor(env, s.id));
  const note = `[TEST: this was sent only to you. It has NOT been sent to ${s.name}.]\n\n`;
  await send(env, env.GMAIL_SENDER, '[TEST] ' + m.subject, note + m.text);
  return { sent_to: env.GMAIL_SENDER, subject: '[TEST] ' + m.subject };
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

// ---- reading a reply ----
// The text the creator actually wrote: everything from the quoted copy of our own email onwards is cut away.
export function replyText(raw) {
  const lines = String(raw || '').replace(/\r/g, '').split('\n');
  const out = [];
  for (const line of lines) {
    if (/^\s*>/.test(line)) break;
    if (/^\s*On .{5,200}wrote:\s*$/i.test(line) || /^\s*-{2,}\s*Original Message\s*-{2,}/i.test(line) || /^\s*From:\s.+/i.test(line) && out.length) break;
    if (/^\s*Sent from my /i.test(line)) break;
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Walks a Gmail message payload for its readable text (plain text preferred, HTML with tags removed otherwise).
const fromB64url = (d) => { try { const b = atob(String(d).replace(/-/g, '+').replace(/_/g, '/')); return new TextDecoder().decode(Uint8Array.from(b, (c) => c.charCodeAt(0))); } catch { return ''; } };
export function messageText(payload) {
  const found = { plain: '', html: '' };
  const walk = (p) => {
    if (!p) return;
    if (p.mimeType === 'text/plain' && p.body?.data && !found.plain) found.plain = fromB64url(p.body.data);
    else if (p.mimeType === 'text/html' && p.body?.data && !found.html) found.html = fromB64url(p.body.data);
    (p.parts || []).forEach(walk);
  };
  walk(payload);
  if (found.plain) return found.plain;
  return found.html.replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ').trim();
}

// A phone number in the reply: an Indian mobile, or an international number that starts with +. Not dates, years or order numbers.
export function extractPhone(text) {
  const t = String(text || '');
  const india = t.match(/(?:\+?91[\s-]?)?(?<![\d])([6-9]\d{4}[\s-]?\d{5})(?![\d])/);
  if (india) return '+91' + india[1].replace(/\D/g, '');
  const intl = t.match(/\+\d{1,3}[\s().-]?\d(?:[\s().-]?\d){7,12}/);
  if (intl) { const d = intl[0].replace(/[^\d+]/g, ''); if (d.replace(/\D/g, '').length >= 9 && d.replace(/\D/g, '').length <= 15) return d; }
  return null;
}

// What a reply says, as a first guess for the owner to confirm.
export function classifyReply(text) {
  let t = ' ' + String(text || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ') + ' ';
  t = t.replace(/\b(no|not a|not any) (problem|issue|worries|objection|concerns?)\b/g, ' yes ').replace(/\b(don't|dont|do not) mind\b/g, ' yes ').replace(/\bwith pleasure\b/g, ' yes ');
  const no = /\b(no|not|don't|dont|do not|remove|take down|stop|decline|refuse|object|not allowed|without permission)\b/.test(t);
  const yes = /\b(yes|yep|ok|okay|sure|agree|agreed|allowed|go ahead|happy|fine|permission granted|you may|please feel free|glad|welcome)\b/.test(t);
  if (yes && !no) return 'replied_yes';
  if (no && !yes) return 'replied_no';
  return 'replied_other';
}

const AUTO_REPLY = /out of office|automatic reply|auto-?reply|autoreply|away from (the )?(office|my desk)|on vacation|delivery status notification/i;

// Reads the Gmail threads we started and records how each creator answered. Never changes a site the owner has already decided on,
// except to add a phone number that was missing.
export async function checkReplies(env, { fetchFn = fetch } = {}) {
  const { results: open } = await env.DB.prepare(
    "SELECT source_id, to_email, gmail_thread, status, owner_confirmed, phone FROM kp_outreach WHERE gmail_thread IS NOT NULL AND (status IN ('sent','replied_other') OR (status = 'replied_yes' AND phone IS NULL) OR (status = 'replied_no' AND owner_confirmed = 0)) ORDER BY coalesce(replied_at, sent_at) LIMIT 40"
  ).all();
  if (!open.length) return [];
  const token = await accessToken(env, fetchFn);
  const me = String(env.GMAIL_SENDER).toLowerCase();
  const out = [];
  for (const o of open) {
    const r = await fetchFn(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(o.gmail_thread)}?format=full`, { headers: { authorization: 'Bearer ' + token } });
    if (!r.ok) { out.push({ source_id: o.source_id, error: r.status }); continue; }
    const th = await r.json();
    const hdr = (m, n) => ((m.payload?.headers || []).find((h) => h.name.toLowerCase() === n) || {}).value || '';
    const msgs = (th.messages || []).map((m) => ({
      from: hdr(m, 'from'), subject: hdr(m, 'subject'), auto: /auto-replied|auto-generated/i.test(hdr(m, 'auto-submitted') + hdr(m, 'precedence')),
      at: Math.floor((+m.internalDate || 0) / 1000), text: replyText(messageText(m.payload) || m.snippet || ''), snippet: m.snippet || '',
    }));
    const theirs = msgs.filter((m) => !m.from.toLowerCase().includes(me) && !m.auto && !AUTO_REPLY.test(m.subject) && !AUTO_REPLY.test(m.text.slice(0, 300)));
    const bounced = msgs.find((m) => /mailer-daemon|postmaster/i.test(m.from));
    if (!theirs.length && !bounced) continue;
    const last = theirs[theirs.length - 1];
    let status = o.status, text = last?.text || '', at = last?.at || now();
    if (!theirs.length) { status = 'bounced'; text = bounced.snippet; at = bounced.at; }
    else if (!o.owner_confirmed) status = classifyReply(text);
    // a phone number anywhere in what they have written so far
    const phone = o.phone || extractPhone(theirs.map((m) => m.text).join('\n'));
    if (status === o.status && phone === o.phone && !last) continue;
    await env.DB.prepare('UPDATE kp_outreach SET status = ?, replied_at = ?, reply_snippet = ?, reply_text = ?, phone = ? WHERE source_id = ?')
      .bind(status, at, text.slice(0, 300), text.slice(0, 2000), phone || null, o.source_id).run();
    out.push({ source_id: o.source_id, status, phone: phone || null });
  }
  return out;
}

const NO_REPLY_DAYS = 14;
export async function listOutreach(env) {
  const { results } = await env.DB.prepare(
    `SELECT s.id, s.name, s.url, s.contact_email, s.contact_email_source, s.photos_hidden, o.status, o.sent_at, o.replied_at, o.reply_snippet, o.reply_text, o.note, o.phone, o.owner_confirmed,
            (SELECT count(*) FROM kp_recipes r WHERE r.source_id = s.id AND r.review_status = 'approved') AS live_recipes
       FROM kp_recipe_sources s LEFT JOIN kp_outreach o ON o.source_id = s.id
      WHERE s.active = 1 AND (live_recipes > 0 OR o.source_id IS NOT NULL)
      ORDER BY live_recipes DESC, s.name`
  ).all();
  const cut = now() - NO_REPLY_DAYS * 86400;
  const rows = results.map((r) => ({ ...r, status: r.status === 'sent' && r.sent_at < cut ? 'no_reply' : r.status || (r.contact_email ? 'not_sent' : 'no_email') }));
  const tally = {}; for (const r of rows) tally[r.status] = (tally[r.status] || 0) + 1;
  tally.with_phone = rows.filter((r) => r.phone).length;
  return { sources: rows, tally };
}

// The owner's decision about a reply. "remove" takes the author's live recipes down and hides their photos (for a NO).
export async function markOutreach(env, sourceId, { status, note, remove } = {}) {
  if (!['replied_yes', 'replied_no', 'replied_other', 'no_reply', 'bounced', 'sent'].includes(status)) throw new OutreachError('Unknown status');
  const r = await env.DB.prepare('UPDATE kp_outreach SET status = ?, owner_confirmed = 1, note = COALESCE(?, note) WHERE source_id = ?').bind(status, note ? String(note).slice(0, 300) : null, sourceId).run();
  if (!r.meta.changes) throw new OutreachError('This site has not been emailed yet.', 404);
  let removed = 0;
  if (status === 'replied_no' && remove) {
    await env.DB.prepare('UPDATE kp_recipe_sources SET photos_hidden = 1 WHERE id = ?').bind(sourceId).run();
    removed = (await env.DB.prepare("UPDATE kp_recipes SET review_status = 'rejected' WHERE source_id = ? AND review_status = 'approved'").bind(sourceId).run()).meta.changes;
  }
  return { source_id: sourceId, status, removed };
}

export async function setPhone(env, sourceId, phone) {
  const p = String(phone || '').trim();
  if (p && !/^\+?[\d\s().-]{8,20}$/.test(p)) throw new OutreachError('That does not look like a phone number.');
  const r = await env.DB.prepare('UPDATE kp_outreach SET phone = ? WHERE source_id = ?').bind(p || null, sourceId).run();
  if (!r.meta.changes) throw new OutreachError('This site has not been emailed yet.', 404);
  return { source_id: sourceId, phone: p || null };
}

// ---- settings and automatic sending ----
export async function getSetting(env, key, def = null) {
  const r = await env.DB.prepare('SELECT value FROM kp_settings WHERE key = ?').bind(key).first();
  return r ? r.value : def;
}
export async function setSetting(env, key, value) {
  await env.DB.prepare('INSERT INTO kp_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, String(value)).run();
}
const gmailConnected = (env) => !!(env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN && env.GMAIL_SENDER);

export async function outreachSettings(env) {
  const sentToday = await env.DB.prepare('SELECT count(*) n FROM kp_outreach WHERE sent_at > ?').bind(now() - 86400).first();
  return { auto: (await getSetting(env, 'outreach_auto', '0')) === '1', daily_cap: +(await getSetting(env, 'outreach_daily_cap', '10')), sent_last_24h: sentToday.n, gmail_connected: gmailConnected(env) };
}
export async function updateOutreachSettings(env, { auto, daily_cap } = {}) {
  if (auto != null) {
    if (auto && !gmailConnected(env)) throw new OutreachError('Connect Gmail first (see OUTREACH.md). Nothing can be sent until then.', 503);
    await setSetting(env, 'outreach_auto', auto ? '1' : '0');
  }
  if (daily_cap != null) {
    const n = Math.floor(+daily_cap);
    if (!(n >= 1 && n <= 50)) throw new OutreachError('The daily limit must be between 1 and 50.');
    await setSetting(env, 'outreach_daily_cap', n);
  }
  return outreachSettings(env);
}

// Sends the permission email to creators who have an address, by itself, within the daily limit. Off until the owner switches it on.
// Only active registered sites with live recipes; never a site that refused, never twice to the same site or address.
export async function autoOutreach(env, { send = gmailSend } = {}) {
  if ((await getSetting(env, 'outreach_auto', '0')) !== '1') return { skipped: 'automatic sending is off' };
  if (!gmailConnected(env)) return { skipped: 'Gmail is not connected' };
  const cap = +(await getSetting(env, 'outreach_daily_cap', '10'));
  const used = (await env.DB.prepare('SELECT count(*) n FROM kp_outreach WHERE sent_at > ?').bind(now() - 86400).first()).n;
  const room = cap - used;
  if (room <= 0) return { skipped: `daily limit of ${cap} reached` };
  const { results } = await env.DB.prepare(
    `SELECT s.id FROM kp_recipe_sources s
      WHERE s.active = 1 AND s.status = 'registered' AND s.contact_email IS NOT NULL AND s.contact_email != '' AND s.rights_status != 'refused'
        AND NOT EXISTS (SELECT 1 FROM kp_outreach o WHERE o.source_id = s.id OR o.to_email = s.contact_email)
        AND (SELECT count(*) FROM kp_recipes r WHERE r.source_id = s.id AND r.review_status = 'approved') > 0
      ORDER BY (SELECT count(*) FROM kp_recipes r WHERE r.source_id = s.id AND r.review_status = 'approved') DESC LIMIT ?`
  ).bind(Math.min(room, 5)).all();                                   // at most 5 per run, spread over the day
  if (!results.length) return { sent: 0 };
  const res = await sendOutreach(env, results.map((r) => r.id), { send });
  return { sent: res.filter((r) => r.sent).length, results: res };
}

// ---- finding a creator's contact address on their own site ----
const JUNK = /(noreply|no-reply|donotreply|example\.|sentry|wixpress|wordpress\.|@2x|\.png|\.jpg|\.jpeg|\.gif|\.webp|\.svg|yourdomain|domain\.com|email\.com|your@|name@|user@)/i;
const FREE_MAIL = /@(gmail|googlemail|outlook|hotmail|yahoo|icloud|proton|protonmail)\./i;
export function decodeCfEmail(hex) {
  const key = parseInt(hex.slice(0, 2), 16);
  let s = '';
  for (let i = 2; i < hex.length; i += 2) s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return s;
}
export function emailsFromHtml(html) {
  const out = new Set(), h = String(html || '');
  for (const m of h.matchAll(/mailto:([^"'?\s>]+)/gi)) { try { out.add(decodeURIComponent(m[1]).toLowerCase()); } catch { /* skip */ } }
  for (const m of h.matchAll(/data-cfemail="([0-9a-f]+)"/gi)) { try { out.add(decodeCfEmail(m[1]).toLowerCase()); } catch { /* skip */ } }
  for (const m of h.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g)) out.add(m[0].toLowerCase());
  return [...out].filter((e) => EMAIL.test(e) && !JUNK.test(e));
}
// An address on the site's own domain, or a personal free-mail address given as the contact. Anything else (an agency, an ad network) is skipped.
export function pickEmail(emails, siteUrl) {
  let host = ''; try { host = new URL(siteUrl).hostname.replace(/^www\./, ''); } catch { /* none */ }
  const own = emails.filter((e) => host && (e.endsWith('@' + host) || e.endsWith('.' + host)));
  const prefer = (list) => list.find((e) => /^(hello|hi|contact|info|mail|admin|team|recipes?)@/.test(e)) || list[0];
  if (own.length) return prefer(own);
  const free = emails.filter((e) => FREE_MAIL.test(e));
  return free.length ? prefer(free) : null;
}

async function politePage(env, url) {
  const { politeFetch } = await import('./polite.js');
  const res = await politeFetch(env, url);
  if (!res.ok) return '';
  return (await res.text()).slice(0, 400000);
}

export async function findContactEmail(env, source, { fetchPage = (u) => politePage(env, u) } = {}) {
  const origin = new URL(source.url).origin;
  for (const path of ['/contact/', '/contact-us/', '/about/', '/about-me/', '/']) {
    let html = '';
    try { html = await fetchPage(origin + path); }
    catch (e) { if (e.code === 'later') return { later: true }; continue; }     // pacing: try again next run; robots or HTTP errors: next page
    const email = pickEmail(emailsFromHtml(html), source.url);
    if (email) return { email, page: path };
  }
  return { email: null };
}

// Called by the 30-minute run: a couple of sites per run that have live recipes but no contact address.
export async function findContactEmails(env, { limit = 2, find = findContactEmail } = {}) {
  const { results } = await env.DB.prepare(
    `SELECT s.id, s.name, s.url FROM kp_recipe_sources s
      WHERE s.active = 1 AND s.status = 'registered' AND (s.contact_email IS NULL OR s.contact_email = '') AND s.contact_checked_at IS NULL
        AND (SELECT count(*) FROM kp_recipes r WHERE r.source_id = s.id AND r.review_status = 'approved') > 0
      ORDER BY (SELECT count(*) FROM kp_recipes r WHERE r.source_id = s.id AND r.review_status = 'approved') DESC LIMIT ?`
  ).bind(limit).all();
  const out = [];
  for (const s of results) {
    const f = await find(env, s);
    if (f.later) { out.push({ id: s.id, later: true }); continue; }
    if (f.email) await env.DB.prepare("UPDATE kp_recipe_sources SET contact_email = ?, contact_email_source = 'auto', contact_checked_at = datetime('now') WHERE id = ?").bind(f.email, s.id).run();
    else await env.DB.prepare("UPDATE kp_recipe_sources SET contact_checked_at = datetime('now') WHERE id = ?").bind(s.id).run();
    out.push({ id: s.id, email: f.email || null });
  }
  return out;
}
