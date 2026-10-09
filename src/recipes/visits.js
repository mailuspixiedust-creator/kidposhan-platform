// The small "Visitors" count at the bottom right of the pages: unique browsers, counted by a random id the browser keeps.
// No name, number, email or IP address is stored. Crawlers and monitors are not counted.

const BOT = /bot|crawl|spider|slurp|preview|monitor|curl|wget|python|headless|lighthouse|facebookexternalhit/i;
const now = () => Math.floor(Date.now() / 1000);

export async function visitCount(env) {
  return (await env.DB.prepare('SELECT count(*) n FROM kp_site_visitors').first()).n;
}

// Registers the browser (once) and returns the total. A bad id or a crawler just gets the total back.
export async function recordVisit(env, vid, userAgent = '') {
  if (/^[A-Za-z0-9]{16,40}$/.test(String(vid || '')) && !BOT.test(userAgent)) {
    const t = now();
    const hour = await env.DB.prepare('SELECT count(*) n FROM kp_site_visitors WHERE first_seen > ?').bind(t - 3600).first();
    if (hour.n < 5000) await env.DB.prepare('INSERT OR IGNORE INTO kp_site_visitors (vid, first_seen) VALUES (?, ?)').bind(vid, t).run();   // flood guard
  }
  return visitCount(env);
}
