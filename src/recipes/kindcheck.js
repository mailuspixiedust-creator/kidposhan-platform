// Is each pack filed under the right kind of food? The kind sets the serving size and whether the stricter snack line applies, so a wrong kind
// gives a wrong score (and a wrong place in the rankings). The check:
//   1. a name that plainly says what the pack is ("... Instant Noodles", "... Ketchup") is trusted without asking anyone;
//   2. otherwise two different language models each read the name, brand and ingredients and pick the kind. Only when BOTH agree, and both are
//      sure, and the kind differs from the filed one, is the pack moved to the right kind and rescored (with a note of what changed);
//   3. when they are unsure, or disagree with each other and neither backs the filed kind, the pack goes to the owner's queue with the reason.
// It runs a few packs per cron run, never while the scanner is waiting, and never more than DAILY_CAP a day, so the free AI allowance
// is never used up before the scanner gets to it.
import { ALL_KINDS, kindByKey, scorePack, isSpiceProduct } from './ready.js';

export const KIND_MODELS = ['@cf/meta/llama-4-scout-17b-16e-instruct', '@cf/mistralai/mistral-small-3.1-24b-instruct'];
export const DAILY_CAP = 150;

// kinds that are close enough that a pack filed under one and judged to be the other is not a mistake worth acting on
const FAMILIES = [
  ['chips', 'namkeen', 'roasted_snacks', 'popcorn_makhana', 'papad'],
  ['kids_biscuits', 'millet_cookies', 'rusk_toast'],
  ['rolled_oats', 'muesli', 'breakfast_cereal', 'poha_flakes'],
  ['dosa_mix', 'ragi_dosa_mix', 'idli_mix', 'dosa_batter'],
  ['chapati', 'paratha'],
  ['instant_noodles', 'noodles', 'vermicelli_pasta'],
  ['fruit_juice', 'soft_drink', 'drink_mix'],
  ['plain_milk', 'flavoured_milk'],
  ['peanut_butter', 'nut_butter'],
  ['millet_porridge', 'baby_cereal'],
];
export const sameFamily = (a, b) => a === b || FAMILIES.some((f) => f.includes(a) && f.includes(b));

// Names that plainly say what the pack is. A filed kind that matches one of these needs no second opinion.
const PLAIN = [
  ['instant_noodles', /\b(noodles?|vermicelli|ramen|pasta|spaghetti|macaroni)\b/i], ['chips', /\b(chips|crisps|kurkure|nachos)\b/i], ['kids_biscuits', /\b(biscuits?|cookies?|crackers?)\b/i],
  ['rolled_oats', /\boats?\b/i], ['breakfast_cereal', /\b(corn ?flakes|chocos|cereals?)\b/i], ['muesli', /\b(muesli|granola)\b/i], ['ketchup', /\bketchup\b/i], ['mayonnaise', /\bmayonnaise\b/i], ['jam', /\bjam\b/i], ['paneer', /\bpaneer\b/i], ['cheese', /\bcheese\b/i],
  ['ice_cream', /\bice[- ]?cream\b/i], ['yoghurt', /\b(yogh?urt|curd|dahi)\b/i], ['peanut_butter', /\bpeanut butter\b/i], ['instant_soup', /\bsoup\b/i], ['namkeen', /\b(namkeen|bhujia|chivda|mixture)\b/i],
];
export const plainName = (name, kind) => PLAIN.some(([k, re]) => sameFamily(k, kind) && re.test(String(name || '')));

const KEYS = ALL_KINDS.map((k) => k.kind).join(', ');
export function buildMessages(p) {
  let ing = [];
  try { ing = JSON.parse(p.ingredients_json || '[]'); } catch { ing = []; }
  const sys = `You sort packaged foods sold in India into one kind of food. Reply with only JSON like {"kind":"kids_biscuits","confidence":"high"}.
"kind" must be exactly one of these keys, or "none" if the product is not a food in any of them (a spice, oil, tea or a non-food): ${KEYS}
"confidence" is "high" only when the name or ingredients make the kind obvious, otherwise "low".
Judge what the product IS, not its flavour: Maggi Masala Noodles are noodles; a chocolate bar is chocolate; atta is flour; fried dal sold as a snack is namkeen; Kellogg's Chocos, corn flakes, wheat flakes, muesli and oats are breakfast cereals, never biscuits.`;
  const user = `Name: ${String(p.name || '').slice(0, 140)}
Brand: ${String(p.brand || '').slice(0, 60)}
Pack size: ${String(p.pack_size || '').slice(0, 30)}
Ingredients: ${ing.slice(0, 8).join(', ').slice(0, 220) || 'not listed'}`;
  return [{ role: 'system', content: sys }, { role: 'user', content: user }];
}

export function parseAnswer(raw) {
  const t = String(raw ?? '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < a) return null;
  try {
    const j = JSON.parse(t.slice(a, b + 1));
    const kind = String(j.kind || '').trim();
    if (kind !== 'none' && !kindByKey(kind)) return null;
    return { kind, confidence: String(j.confidence || '').toLowerCase() === 'high' ? 'high' : 'low' };
  } catch { return null; }
}

// What to do with one pack, from the kind it is filed under and the two models' answers: 'ok' | 'change' (to .kind) | 'flag' (with .reason) | 'skip'.
export function decide(filedKind, answers) {
  const got = (answers || []).filter(Boolean);
  if (!got.length) return { action: 'skip' };
  const filed = kindByKey(filedKind)?.label || filedKind, label = (k) => kindByKey(k)?.label || k;
  if (got.some((a) => a.kind !== 'none' && sameFamily(filedKind, a.kind))) return { action: 'ok' };           // someone backs the filed kind: leave it
  const kinds = [...new Set(got.map((a) => a.kind))];
  if (kinds.length === 1 && kinds[0] === 'none') return got.every((a) => a.confidence === 'high')
    ? { action: 'flag', reason: `The check thinks this is not one of our kinds of food (for example a spice, oil or non-food). It is filed as "${filed}".` } : { action: 'ok' };
  const agree = got.length === 2 && kinds.length === 1 && kinds[0] !== 'none';
  if (agree && got.every((a) => a.confidence === 'high')) return { action: 'change', kind: kinds[0], note: `Moved from "${filed}" to "${label(kinds[0])}" by the kind check.` };
  const guess = kinds.filter((k) => k !== 'none').map(label).join(' or ');
  return { action: 'flag', reason: `The check thinks this may be "${guess}", not "${filed}". The kind sets the serving size and the snack line.` };
}

export async function classify(env, p) {
  const models = env.KIND_MODELS ? String(env.KIND_MODELS).split(',') : KIND_MODELS;
  const out = [];
  for (const model of models) {
    const r = await env.AI.run(model, { messages: buildMessages(p), max_tokens: 40, temperature: 0 });
    const raw = r?.response ?? r?.result?.response ?? r?.choices?.[0]?.message?.content;
    out.push(parseAnswer(raw && typeof raw === 'object' ? JSON.stringify(raw) : raw));
  }
  return out;
}

// Re-score one pack under a new kind. The label values are the same; the serving size and the snack line follow the kind.
async function moveToKind(env, p, kind, note) {
  let n = {}, ing = []; try { n = JSON.parse(p.nutrition_json || 'null') || {}; ing = JSON.parse(p.ingredients_json || '[]'); } catch { /* keep empty */ }
  const sc = scorePack(n, ing, p.name, kind);
  await env.DB.prepare(
    `UPDATE kp_ready_products SET kind = ?, kidposhan_score = ?, score_status = ?, score_breakdown_json = ?, kind_note = ?, kind_checked_at = datetime('now') WHERE id = ?`
  ).bind(kind, sc.score, sc.status, sc.detail ? JSON.stringify(sc.detail) : null, note, p.id).run();
}

const dayKey = () => `kindcheck:${new Date().toISOString().slice(0, 10)}`;
async function usedToday(env) { const r = await env.DB.prepare('SELECT found FROM kp_ready_research WHERE kind = ?').bind(dayKey()).first(); return r?.found || 0; }
async function addUsed(env, n) {
  await env.DB.prepare(`INSERT INTO kp_ready_research (kind, last_run_at, found, runs) VALUES (?, datetime('now'), ?, 1) ON CONFLICT(kind) DO UPDATE SET found = found + excluded.found, runs = runs + 1, last_run_at = datetime('now')`).bind(dayKey(), n).run();
}

// Cron / admin: the next packs whose kind has not been checked, live ones first.
export async function kindCheckPending(env, { limit = 25 } = {}) {
  if (!env.AI) return { skipped: 'no AI binding' };
  const waiting = await env.DB.prepare(`SELECT COUNT(*) AS n FROM kp_ready_products WHERE data_source = 'scan' AND score_status != 'exact' AND found_at > datetime('now','-3 days')`).first();
  if (waiting?.n) return { skipped: 'scanner is waiting' };
  const used = await usedToday(env);
  const room = Math.max(0, DAILY_CAP - used);
  const { results } = await env.DB.prepare(
    `SELECT id, kind, name, brand, pack_size, status, auto_approved, reviewed_at, ingredients_json, nutrition_json, review_flags FROM kp_ready_products
      WHERE kind_checked_at IS NULL AND status IN ('approved','candidate') ORDER BY status = 'approved' DESC, id LIMIT ?`
  ).bind(Math.min(limit, 200)).all();
  const stats = { looked: 0, trusted: 0, ok: 0, moved: 0, flagged: 0, spice: 0, unreadable: 0, dailyRoom: room };
  let asked = 0;
  for (const p of results) {
    if (isSpiceProduct(p.name)) { await env.DB.prepare(`UPDATE kp_ready_products SET status = 'rejected', kind_checked_at = datetime('now'), reviewed_at = datetime('now') WHERE id = ?`).bind(p.id).run(); stats.spice++; continue; }
    if (plainName(p.name, p.kind)) { await env.DB.prepare(`UPDATE kp_ready_products SET kind_checked_at = datetime('now') WHERE id = ?`).bind(p.id).run(); stats.trusted++; continue; }
    if (asked >= room) { stats.capped = true; break; }
    let answers;
    try { answers = await classify(env, p); } catch (e) { stats.stopped = String(e.message || e).slice(0, 80); break; }   // out of AI allowance: try again later
    asked++; stats.looked++;
    let d = decide(p.kind, answers);
    // a kind the owner chose by hand is never changed behind their back: it is put to them as a question instead
    if (d.action === 'change' && p.reviewed_at && !p.auto_approved) d = { action: 'flag', reason: `You filed this as "${kindByKey(p.kind)?.label || p.kind}"; both checks are fairly sure it is "${kindByKey(d.kind)?.label || d.kind}". The kind sets the serving size and the snack line.` };
    if (d.action === 'skip') { await env.DB.prepare(`UPDATE kp_ready_products SET kind_checked_at = datetime('now') WHERE id = ?`).bind(p.id).run(); stats.unreadable++; continue; }
    if (d.action === 'ok') { await env.DB.prepare(`UPDATE kp_ready_products SET kind_checked_at = datetime('now') WHERE id = ?`).bind(p.id).run(); stats.ok++; continue; }
    if (d.action === 'change') { await moveToKind(env, p, d.kind, d.note); stats.moved++; continue; }
    // not sure: a live pack goes back to the owner's queue; a waiting one stays there with the reason added
    let flags = []; try { flags = JSON.parse(p.review_flags || '[]'); } catch { flags = []; }
    flags.push(d.reason);
    await env.DB.prepare(`UPDATE kp_ready_products SET review_flags = ?, kind_checked_at = datetime('now'), status = 'candidate', auto_approved = 0 WHERE id = ?`).bind(JSON.stringify(flags), p.id).run();
    stats.flagged++;
  }
  if (asked) await addUsed(env, asked);
  return stats;
}
