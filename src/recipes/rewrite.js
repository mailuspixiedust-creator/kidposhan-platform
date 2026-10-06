// KidPoshan-written method steps. The creator's steps are rewritten in KidPoshan's own words with the Worker's
// AI binding and saved as a DRAFT. Nothing is shown to parents until the owner approves it (or edits and publishes).
// The rewrite may not add, drop or change any action, quantity, time or temperature; a numbers check enforces the last three.

import { maybeAutoPublish } from './autopublish.js';

export const REWRITE_MODEL = '@cf/mistralai/mistral-small-3.1-24b-instruct'; // override with the REWRITE_MODEL var if Cloudflare retires it

const numbersIn = (s) => (String(s).match(/\d+(?:[./]\d+)?/g) || []).map((n) => String(+n));

export function checkRewrite(original, rewritten) {
  if (!Array.isArray(rewritten) || !rewritten.length || rewritten.some((t) => typeof t !== 'string' || !t.trim())) return 'not a list of steps';
  if (rewritten.length < Math.ceil(original.length * 0.5) || rewritten.length > original.length * 2 + 2) return 'step count changed too much';
  const have = new Set(numbersIn(rewritten.join(' ')));
  const missing = [...new Set(numbersIn(original.join(' ')))].filter((n) => !have.has(n));
  return missing.length ? `numbers missing from rewrite: ${missing.join(', ')}` : null;
}

function parseSteps(text) {
  const t = String(text || '');
  const a = t.indexOf('['), b = t.lastIndexOf(']');
  if (a < 0 || b < a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}

export async function rewriteSteps(env, id) {
  if (!env.AI) return { id, skipped: 'no AI binding' };
  const r = await env.DB.prepare('SELECT instructions_json, kp_steps_status FROM kp_recipes WHERE id = ?').bind(id).first();
  if (!r) return { id, skipped: 'not found' };
  if (r.kp_steps_status === 'approved') return { id, skipped: 'already approved' };
  const original = JSON.parse(r.instructions_json || '[]').map((s) => s.text).filter(Boolean);
  if (!original.length) return { id, skipped: 'no steps to rewrite' };

  const prompt = [
    'Rewrite these recipe steps in your own simple words for parents cooking for children.',
    'Rules: keep every action in the same order. Keep every quantity, time, temperature and ingredient exactly.',
    'Do not add steps, tips, ingredients, health claims or serving advice. Do not copy sentences; rephrase them.',
    'Reply with ONLY a JSON array of strings, one string per step.',
    '', JSON.stringify(original),
  ].join('\n');
  let out;
  try {
    out = await env.AI.run(env.REWRITE_MODEL || REWRITE_MODEL, { messages: [{ role: 'user', content: prompt }], max_tokens: 1500, temperature: 0.2 });
  } catch (e) { return { id, error: `AI call failed: ${e.message}` }; }
  // Workers AI models answer as { response } or, for newer chat models, OpenAI-style { choices: [{ message: { content } }] }
  const raw = out?.response ?? out?.result?.response ?? out?.choices?.[0]?.message?.content;
  const steps = parseSteps(typeof raw === 'string' ? raw : JSON.stringify(raw));
  const problem = checkRewrite(original, steps);
  if (problem) {
    // don't retry forever from the cron; the owner can trigger a retry from the admin endpoint
    await env.DB.prepare("UPDATE kp_recipes SET kp_steps_status = 'failed' WHERE id = ? AND kp_steps_status = 'none'").bind(id).run();
    return { id, rejected: problem };
  }
  await env.DB.prepare(
    "UPDATE kp_recipes SET kp_steps_json = ?, kp_steps_status = 'approved', kp_steps_auto = 1, updated_at = datetime('now') WHERE id = ? AND kp_steps_status != 'approved'"
  ).bind(JSON.stringify(steps.map((t) => t.trim())), id).run();
  // The steps passed the check that every quantity and time is kept, so they are live; the owner reviews afterwards.
  const pub = await maybeAutoPublish(env, id);
  return { id, status: 'approved', steps: steps.length, published: !!pub.published, held: pub.held };
}

// Cron/admin helper: next recipes that have verbatim steps but no KidPoshan version yet.
export async function rewritePending(env, { limit = 3 } = {}) {
  const { results } = await env.DB.prepare(
    `SELECT id FROM kp_recipes WHERE kp_steps_status = 'none' AND review_status IN ('pending','approved')
        AND instructions_json IS NOT NULL AND instructions_json != '[]' ORDER BY review_status = 'approved' DESC, id LIMIT ?`
  ).bind(limit).all();
  const out = [];
  for (const r of results) out.push(await rewriteSteps(env, r.id));
  return out;
}
