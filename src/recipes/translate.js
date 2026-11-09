// A recipe's ingredient lines and method steps in Hindi, Bengali and Gujarati, made with the Worker's AI binding and kept in kp_recipe_i18n.
// The AI may not add, drop or change a quantity, time or temperature: a numbers check rejects a translation that does. A translation is kept
// with a fingerprint of the English lists it came from, so the site uses it only while those lists are unchanged.
// It runs a few at a time from the cron, never more than DAILY_CAP a day, so the free AI allowance is not used up.
import { recipeDetail } from './api.js';
import { ask, modelsFor, usingClaude } from './llm.js';

export const LANGS = { hi: 'Hindi (Devanagari script)', bn: 'Bengali (Bengali script)', gu: 'Gujarati (Gujarati script)' };
export const TRANSLATE_MODELS = ['@cf/meta/llama-4-scout-17b-16e-instruct', '@cf/mistralai/mistral-small-3.1-24b-instruct'];
export const DAILY_CAP = 300;          // recipe-in-one-language jobs a day (raise it with the I18N_DAILY_CAP variable once the AI plan allows)
const PER_RUN = 5, PER_RUN_CLAUDE = 12;

// the same lists the pages show: ingredient lines and method steps, in order
export function sourceLists(d) {
  const ing = (d.ingredients || []).map((i) => i.raw_text).filter((t) => t && !/^(null|undefined|\s)+$/i.test(String(t))).map((t) => String(t));
  const steps = (Array.isArray(d.method) ? d.method : []).map((st) => String(st.text || ''));
  return { ing, steps };
}
// a short fingerprint of the English lists (the site build computes the same one)
export function fingerprint(ing, steps) {
  const s = JSON.stringify([ing, steps]);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16);
}

const DIGITS = [['०', '0'], ['१', '1'], ['२', '2'], ['३', '3'], ['४', '4'], ['५', '5'], ['६', '6'], ['७', '7'], ['८', '8'], ['९', '9'],
  ['০', '0'], ['১', '1'], ['২', '2'], ['৩', '3'], ['৪', '4'], ['৫', '5'], ['৬', '6'], ['৭', '7'], ['৮', '8'], ['৯', '9'],
  ['૦', '0'], ['૧', '1'], ['૨', '2'], ['૩', '3'], ['૪', '4'], ['૫', '5'], ['૬', '6'], ['૭', '7'], ['૮', '8'], ['૯', '9']];
const asciiDigits = (s) => DIGITS.reduce((t, [a, b]) => t.split(a).join(b), String(s));
const numbersIn = (s) => (asciiDigits(s).match(/\d+(?:[./]\d+)?/g) || []).map((n) => String(+n));
const SCRIPT = { hi: /[ऀ-ॿ]/g, bn: /[ঀ-৿]/g, gu: /[઀-૿]/g };

export function buildMessages(lang, ing, steps) {
  const name = LANGS[lang];
  return [
    { role: 'system', content: `You translate recipes from English into ${name} for Indian parents. Answer with JSON only: {"ingredients":[...],"steps":[...]}.
Rules:
- Same number of items, in the same order, one translated line for each line given.
- Keep every number, fraction, time, temperature and quantity exactly as given, written with the digits 0-9.
- Use the everyday words an Indian home cook uses for each ingredient and action. Keep a brand name, and a word that has no common ${name.split(' ')[0]} name, in English letters.
- Units: cup, tablespoon, teaspoon, gram, kg, ml, minutes, hours may be written in ${name.split(' ')[0]}; keep the number in front.
- Do not add, drop or change any instruction, ingredient or amount, and do not explain.` },
    { role: 'user', content: JSON.stringify({ ingredients: ing, steps }) },
  ];
}

function parseJson(text) {
  const t = String(text || '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}

// null when the translation is acceptable, otherwise why not
export function checkTranslation(lang, src, out) {
  if (!out || !Array.isArray(out.ingredients) || !Array.isArray(out.steps)) return 'not the expected shape';
  if (out.ingredients.length !== src.ing.length || out.steps.length !== src.steps.length) return 'the number of lines changed';
  const all = [...out.ingredients, ...out.steps];
  if (all.some((t) => typeof t !== 'string' || !t.trim())) return 'an empty line';
  for (let i = 0; i < src.ing.length; i++) {
    const have = new Set(numbersIn(out.ingredients[i]));
    const missing = [...new Set(numbersIn(src.ing[i]))].filter((n) => !have.has(n));
    if (missing.length) return `ingredient ${i + 1}: numbers missing (${missing.join(', ')})`;
  }
  for (let i = 0; i < src.steps.length; i++) {
    const have = new Set(numbersIn(out.steps[i]));
    const missing = [...new Set(numbersIn(src.steps[i]))].filter((n) => !have.has(n));
    if (missing.length) return `step ${i + 1}: numbers missing (${missing.join(', ')})`;
  }
  // it has to be in the language: most of the letters are in its script
  const text = all.join(' ');
  const letters = (text.match(/\p{L}/gu) || []).length, inScript = (text.match(SCRIPT[lang]) || []).length;
  if (letters > 40 && inScript / letters < 0.5) return 'not mostly in the language';
  const srcLen = [...src.ing, ...src.steps].join(' ').length, outLen = text.length;
  if (outLen > srcLen * 4 + 200 || outLen < srcLen * 0.25) return 'length is off';
  return null;
}

export async function translateLists(env, lang, src) {
  const models = modelsFor(env, env.TRANSLATE_MODELS ? String(env.TRANSLATE_MODELS).split(',') : TRANSLATE_MODELS);
  let why = 'no model answered';
  for (const model of models) {
    try {
      const out = parseJson(await ask(env, model, buildMessages(lang, src.ing, src.steps), 4500));
      const bad = checkTranslation(lang, src, out);
      if (!bad) return { ok: true, model, ingredients: out.ingredients.map((t) => t.trim()), steps: out.steps.map((t) => t.trim()) };
      why = `${model}: ${bad}`;
    } catch (e) { why = `${model}: ${String(e && e.message || e).slice(0, 80)}`; }
  }
  return { ok: false, why };
}

// one recipe in one language: translate and store
export async function translateRecipe(env, id, lang) {
  const d = await recipeDetail(env, id, { lite: true });
  if (!d) return { ok: false, why: 'recipe not found' };
  const src = sourceLists(d);
  if (!src.ing.length && !src.steps.length) return { ok: false, why: 'nothing to translate' };
  const out = await translateLists(env, lang, src);
  if (!out.ok) return out;
  await env.DB.prepare(`INSERT INTO kp_recipe_i18n (recipe_id, lang, ingredients_json, steps_json, model, src_hash, translated_at) VALUES (?,?,?,?,?,?,datetime('now'))
    ON CONFLICT(recipe_id, lang) DO UPDATE SET ingredients_json = excluded.ingredients_json, steps_json = excluded.steps_json, model = excluded.model, src_hash = excluded.src_hash, translated_at = excluded.translated_at`)
    .bind(id, lang, JSON.stringify(out.ingredients), JSON.stringify(out.steps), out.model, fingerprint(src.ing, src.steps)).run();
  return { ok: true, id, lang, model: out.model };
}

// the cron: the next recipes that have no translation yet (a failed one is tried again on a later day, not on every run)
export async function translatePending(env, { limit } = {}) {
  if (!env.AI && !usingClaude(env)) return { skipped: 'no AI binding' };
  if (!limit) limit = usingClaude(env) ? PER_RUN_CLAUDE : PER_RUN;
  const cap = Number(env.I18N_DAILY_CAP) > 0 ? Number(env.I18N_DAILY_CAP) : (usingClaude(env) ? 600 : DAILY_CAP);
  const used = (await env.DB.prepare("SELECT COUNT(*) n FROM kp_recipe_i18n WHERE translated_at >= datetime('now','-1 day')").first()).n + (await env.DB.prepare("SELECT COUNT(*) n FROM kp_i18n_tries WHERE tried_at >= datetime('now','-1 day')").first()).n;
  const room = Math.max(0, Math.min(limit, cap - used));
  if (!room) return { done: 0, cap_reached: true };
  const pairs = [];
  for (const lang of Object.keys(LANGS)) {
    const { results } = await env.DB.prepare(
      `SELECT r.id FROM kp_recipes r WHERE r.poshan_score IS NOT NULL AND r.score_hidden = 0 AND r.total_minutes IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM kp_recipe_i18n t WHERE t.recipe_id = r.id AND t.lang = ?)
         AND NOT EXISTS (SELECT 1 FROM kp_i18n_tries f WHERE f.recipe_id = r.id AND f.lang = ? AND f.tried_at >= datetime('now','-1 day'))
       ORDER BY r.id LIMIT ?`).bind(lang, lang, room).all();
    for (const r of results) pairs.push([r.id, lang]);
  }
  if (usingClaude(env) && pairs.length < room) {
    const { results } = await env.DB.prepare("SELECT recipe_id, lang FROM kp_recipe_i18n WHERE model NOT LIKE 'claude%' ORDER BY CASE lang WHEN 'gu' THEN 0 WHEN 'bn' THEN 1 ELSE 2 END, recipe_id LIMIT ?").bind(room - pairs.length).all();
    for (const r of results) pairs.push([r.recipe_id, r.lang]);
  }
  pairs.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
  let done = 0, failed = 0; const notes = [];
  for (const [id, lang] of pairs.slice(0, room)) {
    const r = await translateRecipe(env, id, lang);
    if (r.ok) done++;
    else { failed++; notes.push(`${id}/${lang}: ${r.why}`); await env.DB.prepare("INSERT INTO kp_i18n_tries (recipe_id, lang, why, tried_at) VALUES (?,?,?,datetime('now'))").bind(id, lang, String(r.why).slice(0, 200)).run(); }
  }
  return { done, failed, notes: notes.slice(0, 5) };
}

// everything translated so far in one language, for the site build: { id: { h, ing, steps } }
export async function translationsFor(env, lang) {
  if (!LANGS[lang]) return { items: {} };
  const { results } = await env.DB.prepare('SELECT recipe_id, ingredients_json, steps_json, src_hash FROM kp_recipe_i18n WHERE lang = ?').bind(lang).all();
  const items = {};
  for (const r of results) { try { items[r.recipe_id] = { h: r.src_hash, ing: JSON.parse(r.ingredients_json), steps: JSON.parse(r.steps_json) }; } catch { /* skip */ } }
  return { lang, items };
}
