// The words of the site's pages, apps and buttons in Hindi, Bengali and Gujarati: a translation memory.
// A line of English is stored once (numbers in it become {#}, so "20 recipes" and "5 recipes" are one line) and translated once per language by the
// Worker's AI binding. The pages look the words up in the browser (public/kp-i18n.js) and the site build bakes them into the static pages.
// A line a native speaker has corrected has status 'reviewed' and is never overwritten by the AI.
// The AI may not change a {#} marker or a brand name; a translation that does, or that is not in the language, is not stored.
import { LANGS } from './translate.js';
import { ask, modelsFor, usingClaude } from './llm.js';

export const UI_MODELS = ['@cf/meta/llama-4-scout-17b-16e-instruct', '@cf/mistralai/mistral-small-3.1-24b-instruct'];
export const UI_DAILY_CALLS = 150;             // AI calls a day for this job (raise with the UI_DAILY_CALLS variable)
const CALLS_PER_RUN = 5, CALLS_PER_RUN_CLAUDE = 10, BATCH_CHARS = 1800, BATCH_MAX = 10, MAX_KEY = 1800, MAX_PUBLIC_KEY = 300, NEW_KEYS_PER_DAY = 3000;

const NUM = /\d+(?:[.,]\d+)*/g;
export function keyOf(text) {
  const nums = [];
  const t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  return { key: t.replace(NUM, (m) => { nums.push(m); return '{#}'; }), nums };
}
export const hasWords = (s) => /\p{L}{2}/u.test(s);

// words that must come out the same way in every translation of this site
const KEEP = 'Poshan Score, KidPoshan, Open Food Facts, ICMR-NIN, NIN, FSSAI, WHO, ICMR, Bournvita, Horlicks, WhatsApp, Google, Bing';
const GLOSSARY = {
  hi: { Good: 'अच्छा', OK: 'ठीक', 'Do not use': 'न दें', Home: 'होम', Recipes: 'रेसिपी', Products: 'प्रोडक्ट', 'Meal Ideas': 'मील आइडिया', Rankings: 'रैंकिंग', 'Scan a pack': 'पैक स्कैन करें', Search: 'खोजें', Check: 'जाँचें' },
  bn: { Good: 'ভালো', OK: 'মোটামুটি', 'Do not use': 'দেবেন না', Home: 'হোম', Recipes: 'রেসিপি', Products: 'প্রোডাক্ট', 'Meal Ideas': 'মিল আইডিয়া', Rankings: 'র‍্যাঙ্কিং', 'Scan a pack': 'প্যাক স্ক্যান করুন', Search: 'খুঁজুন', Check: 'দেখুন' },
  gu: { Good: 'સારું', OK: 'ઠીક', 'Do not use': 'ન આપવું', Home: 'હોમ', Recipes: 'રેસીપી', Products: 'પ્રોડક્ટ', 'Meal Ideas': 'મીલ આઈડિયા', Rankings: 'રેન્કિંગ', 'Scan a pack': 'પેક સ્કેન કરો', Search: 'શોધો', Check: 'તપાસો' },
};
const SCRIPT = { hi: /[ऀ-ॿ]/g, bn: /[ঀ-৿]/g, gu: /[઀-૿]/g };

export function buildMessages(lang, keys) {
  const name = LANGS[lang];
  const glossary = Object.entries(GLOSSARY[lang]).map(([a, b]) => `${a} = ${b}`).join('; ');
  return [
    { role: 'system', content: `You translate the text of a website for Indian parents from English into ${name}. The site scores recipes and packaged foods for children's health.
Answer with a JSON array of strings only: one translation for each line given, in the same order, nothing else.
Rules:
- A marker {#} stands for a number: keep every {#} exactly, in a sensible place; do not add or remove any.
- Keep these names in English letters: ${KEEP}. Keep names of dishes, brands and products as they are.
- Use these fixed translations when the word stands alone or as the main word: ${glossary}.
- Plain, friendly, correct everyday language. Do not add, drop or soften any fact, number, warning or advice. Do not explain.
- Keep any punctuation, and any HTML-like or markdown marks, exactly as given.` },
    { role: 'user', content: JSON.stringify(keys) },
  ];
}
function parseArray(text) {
  const t = String(text || ''); const a = t.indexOf('['), b = t.lastIndexOf(']');
  if (a < 0 || b < a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}
const count = (s, re) => (String(s).match(re) || []).length;
export function checkLine(lang, src, tgt) {
  if (typeof tgt !== 'string' || !tgt.trim()) return 'empty';
  if (count(src, /\{#\}/g) !== count(tgt, /\{#\}/g)) return 'a number marker changed';
  // markers for a link or a bold word, <a_a>...</a_a>: the same ones, no others
  const tags = (x) => (String(x).match(/<\/?[a-z0-9]+_[a-z]+\/?>/g) || []).sort().join('');
  if (tags(src) !== tags(tgt)) return 'markers changed';
  if (/<(?![\/a-z0-9]+_[a-z]+\/?>)[^>]*>/i.test(tgt)) return 'markup added';
  const letters = (src.match(/\p{L}/gu) || []).length;
  if (letters >= 8) {
    const inScript = count(tgt, SCRIPT[lang]), tl = (tgt.match(/\p{L}/gu) || []).length;
    if (!inScript || inScript / Math.max(tl, 1) < 0.3) return 'not in the language';
    if (tgt.length > src.length * 5 + 40 || tgt.length < src.length * 0.2) return 'length is off';
  }
  return null;
}

async function translateBatch(env, lang, keys) {
  const models = modelsFor(env, env.UI_MODELS ? String(env.UI_MODELS).split(',') : UI_MODELS);
  let last = 'no answer';
  for (const model of models) {
    try {
      const out = parseArray(await ask(env, model, buildMessages(lang, keys), 6000));
      if (!Array.isArray(out) || out.length !== keys.length) { last = `${model}: wrong number of lines`; continue; }
      return { model, out };
    } catch (e) { last = `${model}: ${String(e && e.message || e).slice(0, 80)}`; }
  }
  return { error: last };
}

// the cron: translate lines that have no translation yet, a few calls at a time, within the day's cap
export async function translateUiPending(env, { calls } = {}) {
  if (!env.AI && !usingClaude(env)) return { skipped: 'no AI binding' };
  if (!calls) calls = usingClaude(env) ? CALLS_PER_RUN_CLAUDE : CALLS_PER_RUN;
  const cap = Number(env.UI_DAILY_CALLS) > 0 ? Number(env.UI_DAILY_CALLS) : (usingClaude(env) ? 400 : UI_DAILY_CALLS);
  const day = new Date().toISOString().slice(0, 10);
  const used = (await env.DB.prepare('SELECT n FROM kp_ui_calls WHERE day = ?').bind(day).first())?.n || 0;
  let room = Math.min(calls, cap - used), done = 0, failed = 0, made = 0;
  for (const lang of Object.keys(LANGS)) {
    while (room > 0) {
      let { results } = await env.DB.prepare(
        `SELECT s.key FROM kp_ui_src s WHERE NOT EXISTS (SELECT 1 FROM kp_ui_i18n t WHERE t.key = s.key AND t.lang = ?)
           AND (SELECT COUNT(*) FROM kp_ui_fail f WHERE f.key = s.key AND f.lang = ?) < 3 ORDER BY s.hits DESC, s.first_seen LIMIT ?`).bind(lang, lang, BATCH_MAX).all();
      if (!results.length && usingClaude(env)) results = (await env.DB.prepare("SELECT key FROM kp_ui_i18n WHERE lang = ? AND status = 'machine' AND (model IS NULL OR model NOT LIKE 'claude%') LIMIT ?").bind(lang, BATCH_MAX).all()).results;
      if (!results.length) break;
      const keys = []; let chars = 0;
      for (const r of results) { if (keys.length && chars + r.key.length > BATCH_CHARS) break; keys.push(r.key); chars += r.key.length; }
      room--; made++;
      await env.DB.prepare('INSERT INTO kp_ui_calls (day, n) VALUES (?,1) ON CONFLICT(day) DO UPDATE SET n = n + 1').bind(day).run();
      let res = await translateBatch(env, lang, keys);
      if (res.error && /wrong number/.test(res.error) && keys.length > 1) {
        // halves: the lines are put back together in order
        const mid = Math.ceil(keys.length / 2), a = await translateBatch(env, lang, keys.slice(0, mid)), b = await translateBatch(env, lang, keys.slice(mid));
        if (!a.error && !b.error) res = { model: a.model, out: [...a.out, ...b.out] };
        else res = { model: (a.model || b.model), out: [...(a.error ? keys.slice(0, mid).map(() => null) : a.out), ...(b.error ? keys.slice(mid).map(() => null) : b.out)] };
      }
      // the free allowance for today is used up: stop, and do not blame the lines
      if (res.error && /daily free allocation|4006/.test(res.error)) return { calls: made, done, failed, stopped: 'the free AI allowance for today is used up' };
      // everything this call decided is written in one go (a Worker run may make only so many database calls)
      const stmts = [];
      const failWith = (k, why) => { failed++; stmts.push(env.DB.prepare("INSERT INTO kp_ui_fail (key, lang, why, at) VALUES (?,?,?,datetime('now'))").bind(k, lang, String(why).slice(0, 200))); };
      if (res.error) { for (const k of keys) failWith(k, res.error); }
      else {
        for (let i = 0; i < keys.length; i++) {
          const bad = checkLine(lang, keys[i], res.out[i]);
          if (bad) { failWith(keys[i], bad); continue; }
          stmts.push(env.DB.prepare(`INSERT INTO kp_ui_i18n (key, lang, tgt, status, model, updated_at) VALUES (?,?,?,'machine',?,datetime('now'))
            ON CONFLICT(key, lang) DO UPDATE SET tgt = excluded.tgt, model = excluded.model, updated_at = excluded.updated_at WHERE kp_ui_i18n.status = 'machine'`).bind(keys[i], lang, res.out[i].trim(), res.model));
          done++;
        }
      }
      if (stmts.length) await env.DB.batch(stmts);
    }
  }
  return { calls: made, done, failed };
}

// lines the pages report that have no translation yet (the browser sends what it could not translate)
export async function collectUi(env, strings) {
  const day = (await env.DB.prepare("SELECT COUNT(*) n FROM kp_ui_src WHERE first_seen >= datetime('now','-1 day')").first()).n;
  let room = Math.max(0, NEW_KEYS_PER_DAY - day), queued = 0;
  for (const raw of (Array.isArray(strings) ? strings : []).slice(0, 80)) {
    const { key } = keyOf(raw);
    if (!key || key.length > MAX_PUBLIC_KEY || !hasWords(key) || /[<>]|https?:|@/.test(key)) continue;
    const had = await env.DB.prepare('SELECT 1 x FROM kp_ui_src WHERE key = ?').bind(key).first();
    if (had) { await env.DB.prepare('UPDATE kp_ui_src SET hits = hits + 1 WHERE key = ?').bind(key).run(); continue; }
    if (room <= 0) continue;
    await env.DB.prepare("INSERT INTO kp_ui_src (key, hits, first_seen) VALUES (?,1,datetime('now'))").bind(key).run();
    room--; queued++;
  }
  return { queued };
}

// everything translated so far in one language: { key: translation }
export async function uiMap(env, lang) {
  if (!LANGS[lang]) return { map: {} };
  const { results } = await env.DB.prepare('SELECT key, tgt FROM kp_ui_i18n WHERE lang = ?').bind(lang).all();
  const map = {}; for (const r of results) map[r.key] = r.tgt;
  return { lang, n: results.length, map };
}
export const MAX_LINE = MAX_KEY;
