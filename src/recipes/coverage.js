// How well the recipe catalogue covers every filter combination (child's age x meal x season x preference),
// and a background step that looks for more recipes where a combination is short of MIN_RESULTS (20).

import { searchRecipes, MIN_RESULTS } from './api.js';
import { discoverForQuery, shouldDiscover, queryKey, CUISINES } from './live.js';
import { tavilyLeft } from './tavily.js';

export const AGE_POINTS = [9, 18, 48, 84, 126];   // the five age groups on the page (months)
const OCCASIONS = ['breakfast', 'lunchbox', 'lunch', 'snack_4pm', 'dinner'];
const SEASONS = ['summer', 'monsoon', 'winter', 'all'];
const PREFS = ['veg', 'jain', 'nonveg'];

// One preference at a time (100 combinations) keeps each admin request small.
export async function coverageReport(env, { pref = 'veg', world = 'india' } = {}) {
  if (!PREFS.includes(pref)) throw new Error('pref must be veg, jain or nonveg');
  const rows = [];
  for (const age of AGE_POINTS) for (const occasion of OCCASIONS) for (const season of SEASONS) {
    const r = await searchRecipes(env, { age, occasion, season, pref, world, limit: 40, vid: null });
    rows.push({ age_months: age, occasion, season, pref, count: r.count, short: r.count < MIN_RESULTS });
  }
  const counts = rows.map((r) => r.count).sort((a, b) => a - b);
  return {
    pref, world, target: MIN_RESULTS, combinations: rows.length,
    below_target: rows.filter((r) => r.short).length,
    lowest: counts[0], median: counts[Math.floor(counts.length / 2)],
    worst: rows.filter((r) => r.short).sort((a, b) => a.count - b.count).slice(0, 15),
  };
}

// Looks at a few random combinations; for the first one that is short, starts a recipe-led search for new recipes and sites
// (a regional cuisine for India, Southeast Asian or European cuisines for the other two shelves). At most once a day per
// combination and cuisine, and only while enough of the daily Tavily cap is left for parents' own searches.
export const TAVILY_RESERVE = 8;
export async function fillOneGap(env, { sample = 6, rnd = Math.random } = {}) {
  if ((await tavilyLeft(env)) <= TAVILY_RESERVE) return { skipped: 'keeping the rest of today\'s Tavily searches for parents' };
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  for (let i = 0; i < sample; i++) {
    const roll = rnd();
    const world = roll < 0.5 ? 'india' : roll < 0.75 ? 'asia' : 'europe';   // half the effort on the main list, a quarter on each shelf
    const q = { age: pick(AGE_POINTS), occasion: pick(OCCASIONS), season: pick(SEASONS), pref: pick(PREFS), world, cuisine: pick(CUISINES[world]), limit: 40, vid: null };
    const r = await searchRecipes(env, q);
    if (r.count >= MIN_RESULTS) continue;
    if (!(await shouldDiscover(env, queryKey(q)))) continue;
    const found = await discoverForQuery(env, q, { publishedCount: r.count });
    return { combo: queryKey(q), world, cuisine: q.cuisine, had: r.count, target: MIN_RESULTS, found };
  }
  return { checked: sample, short: 0 };
}

// "Seen" rows older than this are forgotten.
export async function pruneSeen(env, { days = 60 } = {}) {
  const cut = Math.floor(Date.now() / 1000) - days * 86400;
  const r = await env.DB.prepare('DELETE FROM kp_seen WHERE last_at < ?').bind(cut).run();
  return { pruned: r.meta.changes };
}
