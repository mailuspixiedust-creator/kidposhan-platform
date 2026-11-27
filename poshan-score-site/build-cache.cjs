// What the site build reads from the platform, saved on this computer, so that a rebuild that only changes the layout does not touch the database.
// (The free plan allows 5 million database rows read a day; one full build asks for every product and recipe, and several builds in a day used it up.)
//
//   node build.cjs                  uses saved copies less than 24 hours old, and fetches only what is missing or older
//   KP_FRESH=1 node build.cjs       fetches everything again: use it after recipes or products have changed, and ALWAYS after something
//                                   was hidden or taken down (a creator saying no, a wrong score, a changed age rule)
//   KP_OFFLINE=1 node build.cjs     uses only the saved copies, however old, and asks the platform for nothing
//   KP_CACHE_HOURS=48               how old a saved copy may be before it is fetched again
//
// If anything could not be fetched, the build ends with a failure code and says DO NOT DEPLOY: pages may be missing or out of date.
const fs = require('fs'), path = require('path'), crypto = require('crypto');

function createCache({ dir = path.join(__dirname, '.build-cache'), env = process.env, fetchFn = (u) => fetch(u), now = () => Date.now() } = {}) {
  const fresh = env.KP_FRESH === '1', offline = env.KP_OFFLINE === '1', maxAge = (Number(env.KP_CACHE_HOURS) > 0 ? Number(env.KP_CACHE_HOURS) : 24) * 3600e3;
  const stats = { saved: 0, fetched: 0, stale: [], failed: [], oldest: 0 };
  const fileOf = (u) => path.join(dir, crypto.createHash('sha1').update(u).digest('hex') + '.json');
  const read = (u) => { try { const j = JSON.parse(fs.readFileSync(fileOf(u), 'utf8')); return j && j.url === u ? j : null; } catch (e) { return null; } };
  const write = (u, data) => { fs.mkdirSync(dir, { recursive: true }); const f = fileOf(u), tmp = f + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, JSON.stringify({ url: u, at: now(), data })); fs.renameSync(tmp, f); };
  const useSaved = (c) => { stats.saved++; stats.oldest = Math.max(stats.oldest, now() - c.at); return c.data; };

  async function getJson(u) {
    const c = read(u);
    if (c && (offline || (!fresh && now() - c.at < maxAge))) return useSaved(c);
    if (offline) { stats.failed.push(u); throw new Error(u + ' -> no saved copy (KP_OFFLINE)'); }
    let status = 0;
    try {
      const r = await fetchFn(u); status = r.status;
      if (!r.ok) throw new Error(u + ' -> ' + r.status);
      const data = await r.json();
      write(u, data); stats.fetched++;
      return data;
    } catch (e) {
      // gone: the recipe or product is no longer listed. Its saved copy goes too, so it can never come back from the cache
      if (status === 404 || status === 410) { try { fs.unlinkSync(fileOf(u)); } catch (x) { /* none saved */ } throw e; }
      if (c) { stats.stale.push(u); return useSaved(c); }
      stats.failed.push(u);
      throw e;
    }
  }
  // the last lines of a build: where the data came from, and whether it is safe to deploy
  function report() {
    const hours = Math.round(stats.oldest / 3600e3 * 10) / 10;
    const lines = [`data: ${stats.fetched} requests to the platform, ${stats.saved} from saved copies${stats.saved ? ` (the oldest ${hours} hours old; KP_FRESH=1 fetches everything again)` : ''}`];
    const ok = !stats.failed.length && !stats.stale.length;
    if (!ok) lines.push(`DO NOT DEPLOY: the platform did not answer for ${stats.failed.length + stats.stale.length} requests (${stats.failed.length} with nothing saved, ${stats.stale.length} filled from older copies).`);
    return { ok, lines };
  }
  return { getJson, report, stats };
}

module.exports = { createCache };
