// node poshan-score-site/test-build-cache.cjs : checks the saved copies the site build uses. No network, no database.
const fs = require('fs'), os = require('os'), path = require('path');
const { createCache } = require('./build-cache.cjs');
let failed = 0; const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) failed++; };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kp-cache-'));
  let calls = 0, mode = 'up', version = 1, clock = 1000e9;
  const fetchFn = async () => { calls++; if (mode === 'down') return { ok: false, status: 500 }; if (mode === 'gone') return { ok: false, status: 404 }; return { ok: true, status: 200, json: async () => ({ version }) }; };
  const make = (env = {}) => createCache({ dir, env, fetchFn, now: () => clock });
  const U = 'https://platform.example/api/kp/recipes/1';

  let c = make(); await c.getJson(U);
  const again = make(); const v = await again.getJson(U);
  ok(calls === 1 && v.version === 1 && again.report().ok, 'A second build reads the saved copy and asks the platform for nothing');

  clock += 25 * 3600e3; version = 2; c = make();
  ok((await c.getJson(U)).version === 2 && calls === 2, 'A copy older than 24 hours is fetched again');

  version = 3; c = make({ KP_FRESH: '1' });
  ok((await c.getJson(U)).version === 3 && calls === 3, 'KP_FRESH=1 fetches again even when the copy is new');

  mode = 'down'; c = make({ KP_FRESH: '1' });
  const stale = await c.getJson(U);
  ok(stale.version === 3 && !c.report().ok && /DO NOT DEPLOY/.test(c.report().lines.join(' ')), 'When the platform fails, an older copy may fill in, but the build says DO NOT DEPLOY');

  c = make(); let threw = false; try { await c.getJson(U + '9'); } catch (e) { threw = true; }
  ok(threw && !c.report().ok, 'When the platform fails and nothing is saved, the build fails');

  const before = calls; c = make({ KP_OFFLINE: '1' }); clock += 999 * 3600e3;
  ok((await c.getJson(U)).version === 3 && calls === before && c.report().ok, 'KP_OFFLINE=1 uses the saved copies and asks for nothing, even while the platform is down');

  mode = 'gone'; c = make(); threw = false; try { await c.getJson(U); } catch (e) { threw = true; }
  mode = 'down'; const c2 = make(); let back = null; try { back = await c2.getJson(U); } catch (e) { /* expected */ }
  ok(threw && c.report().ok && back === null, 'A recipe that is gone (404) loses its saved copy, so it cannot come back from the cache');

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED'); process.exitCode = failed ? 1 : 0;
})();
