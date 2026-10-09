// Polite fetching: obey robots.txt and pace requests per site.
//  - robots.txt is fetched once per site per day and cached in D1.
//  - Rules for "KidPoshanBot" apply if present, otherwise the "*" group.
//  - Allow/Disallow use longest-match precedence with * and $ wildcards (Google/RFC 9309 behaviour).
//  - robots.txt missing (4xx) = allowed; server error or unreachable = treat as disallowed for now.
//  - At least MIN_GAP_MS between requests to the same site, or the site's Crawl-delay if longer (capped).

export const BOT_NAME = 'KidPoshanBot';
export const UA = `Mozilla/5.0 (compatible; ${BOT_NAME}/1.0; +https://kidposhan.in/bot)`;
const ROBOTS_TTL_MS = 24 * 3600e3;
const MIN_GAP_MS = 10e3;
const MAX_DELAY_MS = 60e3;
const MAX_INLINE_WAIT_MS = 12e3; // wait inside this run if the gap is short; otherwise try again later

export class RobotsDisallowed extends Error { constructor(url) { super(`robots.txt disallows ${url}`); this.code = 'robots'; } }
export class TryLater extends Error { constructor(url, notBefore) { super(`pacing: try ${url} later`); this.code = 'later'; this.notBefore = notBefore; } }

// ---------- parsing ----------
export function parseRobots(text) {
  const groups = []; let cur = null, lastWasAgent = false;
  for (let line of String(text || '').split(/\r?\n/)) {
    line = line.replace(/#.*/, '').trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (key === 'user-agent') {
      if (!lastWasAgent || !cur) { cur = { agents: [], rules: [], delay: null }; groups.push(cur); }
      cur.agents.push(val.toLowerCase()); lastWasAgent = true; continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === 'allow' || key === 'disallow') { if (val || key === 'allow') cur.rules.push({ allow: key === 'allow', path: val }); }
    else if (key === 'crawl-delay') { const d = parseFloat(val); if (Number.isFinite(d)) cur.delay = d; }
  }
  return groups;
}

function groupFor(groups, bot = BOT_NAME) {
  const b = bot.toLowerCase();
  const own = groups.filter((g) => g.agents.some((a) => a !== '*' && b.includes(a)));
  if (own.length) return { rules: own.flatMap((g) => g.rules), delay: own.find((g) => g.delay != null)?.delay ?? null };
  const star = groups.filter((g) => g.agents.includes('*'));
  return { rules: star.flatMap((g) => g.rules), delay: star.find((g) => g.delay != null)?.delay ?? null };
}

function ruleMatches(pattern, path) {
  if (pattern === '') return true;
  const anchored = pattern.endsWith('$');
  const re = new RegExp('^' + pattern.replace(/\$$/, '').split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (anchored ? '$' : ''));
  return re.test(path);
}

export function robotsAllows(groups, urlOrPath, bot = BOT_NAME) {
  let path;
  try { const u = new URL(urlOrPath); path = u.pathname + u.search; } catch { path = urlOrPath; }
  const { rules, delay } = groupFor(groups, bot);
  let best = null;
  for (const r of rules) {
    if (!ruleMatches(r.path, path)) continue;
    const len = r.path.length;
    if (!best || len > best.len || (len === best.len && r.allow)) best = { allow: r.allow, len };
  }
  return { allowed: best ? best.allow : true, delayMs: delay != null ? Math.min(delay * 1000, MAX_DELAY_MS) : null };
}

// ---------- robots cache ----------
async function robotsFor(env, origin) {
  const row = await env.DB.prepare('SELECT body, status, fetched_at FROM kp_robots_cache WHERE origin = ?').bind(origin).first();
  if (row && Date.now() - row.fetched_at < ROBOTS_TTL_MS) return row;
  let status, body = '';
  try {
    const res = await fetch(origin + '/robots.txt', { headers: { 'user-agent': UA }, redirect: 'follow' });
    status = res.status;
    if (res.ok) body = (await res.text()).slice(0, 500000);
  } catch { status = 599; }
  await env.DB.prepare(
    `INSERT INTO kp_robots_cache (origin, body, status, fetched_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(origin) DO UPDATE SET body = excluded.body, status = excluded.status, fetched_at = excluded.fetched_at`
  ).bind(origin, body, status, Date.now()).run();
  return { body, status, fetched_at: Date.now() };
}

export async function checkRobots(env, url) {
  const origin = new URL(url).origin;
  const r = await robotsFor(env, origin);
  if (r.status >= 500) return { allowed: false, delayMs: null, reason: 'robots.txt unreachable' };
  if (r.status >= 400) return { allowed: true, delayMs: null, reason: 'no robots.txt' };
  return robotsAllows(parseRobots(r.body), url);
}

// ---------- pacing ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function reserveSlot(env, host, gapMs) {
  const now = Date.now();
  const row = await env.DB.prepare('SELECT next_ok_at FROM kp_host_pacing WHERE host = ?').bind(host).first();
  const nextOk = row ? row.next_ok_at : 0;
  const start = Math.max(now, nextOk);
  if (start - now > MAX_INLINE_WAIT_MS) return { wait: null, notBefore: start };
  await env.DB.prepare(
    `INSERT INTO kp_host_pacing (host, next_ok_at) VALUES (?, ?)
     ON CONFLICT(host) DO UPDATE SET next_ok_at = excluded.next_ok_at`
  ).bind(host, start + gapMs).run();
  return { wait: start - now };
}

export async function politeFetch(env, url, init = {}) {
  const rob = await checkRobots(env, url);
  if (!rob.allowed) throw new RobotsDisallowed(url);
  const host = new URL(url).hostname;
  const minGap = env.CRAWL_MIN_GAP_MS != null ? +env.CRAWL_MIN_GAP_MS : MIN_GAP_MS; // optional override (tests)
  const gap = Math.max(minGap, rob.delayMs || 0);
  const slot = await reserveSlot(env, host, gap);
  if (slot.wait == null) throw new TryLater(url, slot.notBefore);
  if (slot.wait > 0) await sleep(slot.wait);
  return fetch(url, { ...init, headers: { 'user-agent': UA, ...(init.headers || {}) } });
}
