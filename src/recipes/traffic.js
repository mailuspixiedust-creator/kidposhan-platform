// Traffic for the admin page: for each page, how many real (non-bot) visitors, from which country and city, and the average time they stayed.
// No IP address is stored: the country and city are read from Cloudflare's lookup when the page loads, and only those words are kept.

const now = () => Math.floor(Date.now() / 1000);
const MAX_SECONDS = 1800;          // a tab left open for hours is not 3 hours of reading: time is capped at 30 minutes
const KEEP_DAYS = 400;

// Crawlers, uptime monitors, link-preview fetchers, scrapers and headless browsers are not visitors.
const BOT = /bot|crawl|spider|slurp|preview|monitor|uptime|pingdom|curl|wget|python|node-fetch|axios|go-http|java\/|okhttp|scrapy|headless|lighthouse|phantom|puppeteer|playwright|selenium|facebookexternalhit|whatsapp|telegram|discord|slack|linkedin|twitter|embedly|pinterest|archive|semrush|ahrefs|mj12|petalbot|yandex|baidu|duckduck|bingpreview|applebot|google-|chrome-lighthouse|gtmetrix|statuscake|datadog|newrelic/i;
export const isBot = (ua, cf = {}) => !String(ua || '').trim() || BOT.test(ua) || !!cf.verifiedBotCategory;

// "/Products/" , "/products.html" , "/index.html" -> "/products", "/"; the meal page's recipe views arrive as /meal-ideas/recipe/123
export function normalizePath(p) {
  let s = String(p || '').split('?')[0].split('#')[0].trim().toLowerCase();
  if (!/^\/[a-z0-9\-_/.%]*$/.test(s) || s.length > 160) return null;
  s = s.replace(/\/index(\.html)?$/, '/').replace(/\.html$/, '');
  if (s.length > 1) s = s.replace(/\/+$/, '');
  return s || '/';
}
const clean = (v, n = 60) => (v ? String(v).replace(/[<>\n\r]/g, ' ').trim().slice(0, n) : null);
const rand = () => [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('');

// One page view. meta = { ua, country, region, city, cf }. Returns what the page needs to report its time later.
export async function recordPageview(env, { vid, path } = {}, meta = {}) {
  const p = normalizePath(path);
  if (!p) return { ok: false };
  const t = now();
  const bot = isBot(meta.ua, meta.cf);
  const okVid = /^[A-Za-z0-9]{16,40}$/.test(String(vid || ''));
  if (!bot && !okVid) return { ok: false };
  const hour = await env.DB.prepare('SELECT count(*) n FROM kp_pageviews WHERE ts > ?').bind(t - 3600).first();
  if (hour.n > 20000) return { ok: false };                                               // flood guard
  const tok = bot ? null : rand();
  const res = await env.DB.prepare('INSERT INTO kp_pageviews (ts, path, vid, country, region, city, is_bot, tok) VALUES (?,?,?,?,?,?,?,?)')
    .bind(t, p, bot ? null : vid, clean(meta.country, 2), clean(meta.region), clean(meta.city), bot ? 1 : 0, tok).run();
  return bot ? { ok: true, bot: true } : { ok: true, id: res.meta.last_row_id, tok };
}

// The page reports how long it was on screen when the visitor leaves (only the page load that holds the secret can).
export async function recordSeconds(env, { id, tok, seconds } = {}) {
  const s = Math.round(Number(seconds));
  if (!Number.isFinite(s) || s < 1 || !tok || !Number.isInteger(+id)) return { ok: false };
  await env.DB.prepare('UPDATE kp_pageviews SET seconds = ? WHERE id = ? AND tok = ? AND is_bot = 0 AND ts > ?').bind(Math.min(s, MAX_SECONDS), +id, String(tok), now() - 86400).run();
  return { ok: true };
}

export async function pruneViews(env) {
  const r = await env.DB.prepare('DELETE FROM kp_pageviews WHERE ts < ?').bind(now() - KEEP_DAYS * 86400).run();
  return { deleted: r.meta?.changes || 0 };
}

// path = optional: the locations table then shows only that page.
export async function trafficReport(env, { days = 30, path = null } = {}) {
  const d = Math.min(Math.max(parseInt(days, 10) || 30, 1), 400), since = now() - d * 86400;
  const where = 'is_bot = 0 AND ts >= ?' + (path ? ' AND path = ?' : '');
  const args = path ? [since, path] : [since];
  const one = async (sql, ...a) => (await env.DB.prepare(sql).bind(...a).first());
  const all = async (sql, ...a) => (await env.DB.prepare(sql).bind(...a).all()).results;
  const totals = await one(`SELECT COUNT(*) views, COUNT(DISTINCT vid) visitors, AVG(CASE WHEN seconds > 0 THEN seconds END) avg_s FROM kp_pageviews WHERE is_bot = 0 AND ts >= ?`, since);
  const bots = await one('SELECT COUNT(*) n FROM kp_pageviews WHERE is_bot = 1 AND ts >= ?', since);
  const pages = await all(`SELECT path, COUNT(*) views, COUNT(DISTINCT vid) visitors, AVG(CASE WHEN seconds > 0 THEN seconds END) avg_s, SUM(seconds > 0) timed FROM kp_pageviews WHERE is_bot = 0 AND ts >= ? GROUP BY path ORDER BY views DESC LIMIT 150`, since);
  const countries = await all(`SELECT COALESCE(country, '??') country, COUNT(*) views, COUNT(DISTINCT vid) visitors FROM kp_pageviews WHERE ${where} GROUP BY 1 ORDER BY views DESC LIMIT 60`, ...args);
  const cities = await all(`SELECT COALESCE(country, '??') country, COALESCE(city, 'Unknown') city, COUNT(*) views, COUNT(DISTINCT vid) visitors FROM kp_pageviews WHERE ${where} GROUP BY 1, 2 ORDER BY views DESC LIMIT 150`, ...args);
  const by_day = await all(`SELECT date(ts, 'unixepoch') day, COUNT(*) views, COUNT(DISTINCT vid) visitors FROM kp_pageviews WHERE ${where} GROUP BY 1 ORDER BY 1`, ...args);
  // recipe views arrive as /meal-ideas/recipe/ID: show the recipe's name
  const ids = pages.map((p) => (p.path.match(/^\/meal-ideas\/recipe\/(\d+)$/) || [])[1]).filter(Boolean);
  const names = new Map();
  if (ids.length) for (const r of await all(`SELECT id, name FROM kp_recipes WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids)) names.set(String(r.id), String(r.name).split('|')[0].trim());
  const rnd = (v) => (v == null ? null : Math.round(v));
  return {
    days: d, path,
    totals: { views: totals.views, visitors: totals.visitors, avg_seconds: rnd(totals.avg_s), bots_excluded: bots.n },
    pages: pages.map((p) => ({ path: p.path, label: names.get((p.path.match(/\/(\d+)$/) || [])[1]) ? 'Recipe: ' + names.get(p.path.match(/\/(\d+)$/)[1]) : null, views: p.views, visitors: p.visitors, avg_seconds: rnd(p.avg_s), timed: p.timed })),
    countries, cities, by_day,
  };
}
