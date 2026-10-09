// Every Tavily search made by the recipe code goes through here, so one daily cap protects the free quota.
// The cap is TAVILY_DAILY_CAP (a Worker variable or secret); 25 searches a day when it is not set. At "basic" depth one search is 1 credit.
// (Older parts of the site that call Tavily themselves, such as product research, are not counted here.)

export const DEFAULT_DAILY_CAP = 25;
const today = () => new Date().toISOString().slice(0, 10);
export const dailyCap = (env) => (+env.TAVILY_DAILY_CAP > 0 ? Math.floor(+env.TAVILY_DAILY_CAP) : DEFAULT_DAILY_CAP);

export class TavilyCapError extends Error { constructor(cap) { super(`Tavily daily limit reached (${cap} searches). It resets at midnight UTC.`); this.code = 'tavily_cap'; } }

// Reserves one search for today. Atomic: the counter only moves while it is under the cap.
export async function spendTavily(env) {
  const cap = dailyCap(env);
  const row = await env.DB.prepare(
    'INSERT INTO kp_tavily_calls (day, calls) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET calls = calls + 1 WHERE calls < ? RETURNING calls'
  ).bind(today(), cap).first();
  if (!row) throw new TavilyCapError(cap);
}

// Searches still allowed today. The background gap filler keeps some in reserve for parents' own searches.
export async function tavilyLeft(env) {
  const t = await env.DB.prepare('SELECT calls FROM kp_tavily_calls WHERE day = ?').bind(today()).first();
  return Math.max(0, dailyCap(env) - (t ? t.calls : 0));
}

// POST https://api.tavily.com/search with the shared body defaults. Throws TavilyCapError over the cap and Error on an HTTP failure.
export async function tavilySearchRaw(env, body, fetchFn = fetch) {
  await spendTavily(env);
  const res = await fetchFn('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.TAVILY_API_KEY}` },
    body: JSON.stringify({ search_depth: 'basic', max_results: 10, ...body }),
  });
  if (!res.ok) throw new Error(`Tavily ${res.status}`);
  return (await res.json()).results || [];
}

// What the admin page shows: our own count for today, and Tavily's account usage when its /usage endpoint answers.
export async function tavilyUsage(env, fetchFn = fetch) {
  const cap = dailyCap(env);
  const t = await env.DB.prepare('SELECT calls FROM kp_tavily_calls WHERE day = ?').bind(today()).first();
  const week = await env.DB.prepare("SELECT coalesce(sum(calls), 0) n FROM kp_tavily_calls WHERE day >= date('now','-6 day')").first();
  const out = { configured: !!env.TAVILY_API_KEY, cap_per_day: cap, used_today: t ? t.calls : 0, used_last_7_days: week.n, account: null };
  if (!env.TAVILY_API_KEY) return out;
  try {
    const r = await fetchFn('https://api.tavily.com/usage', { headers: { authorization: `Bearer ${env.TAVILY_API_KEY}` } });
    if (r.ok) {
      const j = await r.json();
      const a = j.account || {}, k = j.key || {};
      out.account = {
        plan: a.current_plan ?? null,
        used: a.plan_usage ?? k.usage ?? null,
        limit: a.plan_limit ?? k.limit ?? null,
      };
    } else out.account_error = `Tavily answered ${r.status}`;
  } catch (e) { out.account_error = 'Could not reach Tavily'; }
  return out;
}
