// Paste a recipe's web address, get its Poshan Score. The page is read the way a person's browser would read it (robots.txt obeyed, one request),
// its ingredient list and servings are taken from the recipe's own data, and the score is worked out with the same method as every recipe on the site.
// Nothing from the page is kept: no text, no photo, no ingredient list. Only a one-day hash of the connection and the site's name are logged, to
// limit how many links one visitor can check.
import { fetchHtml, extractFromHtml } from './extract.js';
import { RobotsDisallowed, TryLater } from './polite.js';
import { parseIngredientLine } from './normalize.js';
import { computeRecipeScore } from './score.js';

const PER_HOUR = 12, PER_DAY = 40;
const AGE_GROUPS = ['1-3', '4-6', '7-9', '10-12', '13-15', '16-18', 'adult'];
const MAX_HTML = 2_500_000;

// A pasted link may carry spaces or a missing "https://": tidy it, and refuse anything that is not an ordinary public web page.
export function cleanUrl(raw) {
  let t = String(raw || '').trim().replace(/\s+/g, '');
  if (!t || t.length > 600) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) t = 'https://' + t;
  let u; try { u = new URL(t); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  if (u.port && u.port !== '80' && u.port !== '443') return null;
  const h = u.hostname.toLowerCase();
  if (!h.includes('.') || h.includes(':') || /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || /(^|\.)(localhost|local|internal|lan|home|corp|invalid|test|example)$/.test(h)) return null;
  u.hash = '';
  return u;
}

const fail = (reason, message, extra = {}) => ({ ok: false, reason, message, ...extra });

async function limit(env, who) {
  if (!who) return null;
  const h = await env.DB.prepare(`SELECT COUNT(*) n FROM kp_scans WHERE who = ? AND kind = 'recipe' AND ts > datetime('now','-1 hour')`).bind(who).first();
  if ((h?.n || 0) >= PER_HOUR) return fail('rate', 'That is a lot of links for one hour. Please try again a little later.', { status: 429 });
  const d = await env.DB.prepare(`SELECT COUNT(*) n FROM kp_scans WHERE who = ? AND kind = 'recipe' AND ts > datetime('now','-1 day')`).bind(who).first();
  if ((d?.n || 0) >= PER_DAY) return fail('rate', 'That is the most links we can check in one day from one phone. Please come back tomorrow.', { status: 429 });
  return null;
}

export async function checkRecipeLink(env, rawUrl, { who = null } = {}) {
  const u = cleanUrl(rawUrl);
  if (!u) return fail('bad_url', 'That does not look like the address of a recipe page. Paste the full link, for example https://www.example.com/recipes/dal-tadka.');
  // a recipe that is already on this site: no need to read it again
  if (/(^|\.)kidposhan\.in$/.test(u.hostname)) {
    const m = u.pathname.match(/^\/recipes\/(\d+)-/);
    return fail('own', m ? 'That recipe is already scored on KidPoshan.' : 'That is a KidPoshan page, not a recipe from another site.', m ? { link: u.pathname } : {});
  }
  const tooMany = await limit(env, who);
  if (tooMany) return tooMany;
  if (who) await env.DB.prepare('INSERT INTO kp_scans (who, kind, barcode) VALUES (?,?,?)').bind(who, 'recipe', u.hostname.slice(0, 80)).run();

  let page;
  try { page = await fetchHtml(u.toString(), env); }
  catch (e) {
    if (e instanceof RobotsDisallowed || e.code === 'robots') return fail('robots', 'That site asks programs not to read its pages, so we cannot check this link. Look the recipe up in our recipes instead, or type its main ingredients.');
    if (e instanceof TryLater || e.code === 'later') return fail('later', 'We are reading that site a little too often just now. Please try again in a minute.');
    return fail('fetch', `We could not open that page (${String(e.message || e).slice(0, 60)}). Check the link and try again.`);
  }
  const html = String(page.html || '').slice(0, MAX_HTML);
  let ex = null;
  try { ex = extractFromHtml(html, page.finalUrl || u.toString()); } catch { ex = null; }
  const lines = ex && Array.isArray(ex.ingredients) ? ex.ingredients.map((x) => String(x || '').trim()).filter(Boolean) : [];
  if (!ex || lines.length < 3) return fail('not_recipe', 'We could not find a recipe with an ingredient list on that page. Paste the link of the recipe page itself, not a list or a home page.');

  const ingredients = lines.slice(0, 60).map(parseIngredientLine);
  const row = { name: ex.name || '', servings: ex.servings, nutrition_json: ex.nutrition ? JSON.stringify(ex.nutrition) : null };
  const r = computeRecipeScore(row, ingredients);
  if (r.status === 'pending') {
    return fail('few_weighed', `We could only weigh ${Math.round((r.estimate?.coverage || 0) * 100)}% of the ingredients on that page, which is not enough for an honest score.`,
      { name: ex.name || null, host: u.hostname, unweighed: (r.estimate?.unweighed || []).slice(0, 8).map((x) => x.line) });
  }
  const d = r.detail || {};
  const bands = {};
  for (const id of AGE_GROUPS) {
    const b = r.bands && r.bands[id]; if (!b) continue;
    bands[id] = { total: b.total, tier: b.tier, capped: !!b.capped, metrics: b.metrics.map((m) => ({ n: m.n, id: m.id, name: m.name, score: m.score, reading: m.reading })) };
  }
  return {
    ok: true,
    name: ex.name || 'Recipe', host: u.hostname.replace(/^www\./, ''), url: page.finalUrl || u.toString(), image_url: ex.image_url || null,
    servings: d.per_serving_basis || null, ingredients_total: lines.length, ingredients_weighed: Math.round((d.coverage ?? 1) * 100),
    score_kind: r.status,                   // exact: the page gives the nutrition itself; estimated: worked out from the ingredients
    reference_band: '4-6', score: r.score, bands,
    per_serving: d.inputs ? { protein: d.inputs.protein, fibre: d.inputs.fibre, saturated_fat: d.inputs.satFat, sodium: d.inputs.sodium, added_sugar: d.inputs.addedSugar } : null,
    assumptions: (d.assumptions || []).slice(0, 6), unweighed: (d.unweighed || []).slice(0, 8).map((x) => x.line),
  };
}
