// Owner review: decide what parents see.
//   GET  /api/kp/admin/review?status=pending|approved|rejected&limit=20&offset=0
//   POST /api/kp/admin/review/:id   { action: 'publish'|'reject'|'pending', diet?, age_min_months?, age_max_months?, occasions?, seasons?, note? }
//   GET  /api/kp/admin/sources?status=suggested|registered|blocked
//   POST /api/kp/admin/sources/:id  { status?: 'registered'|'blocked', rights_status?: 'granted'|'requested'|'not_requested'|'refused' }

import { parseIngredientLine } from './normalize.js';
import { scoreRecipe } from './score.js';

const OCCASIONS = ['breakfast', 'lunchbox', 'lunch', 'snack_4pm', 'dinner'];
const SEASONS = ['summer', 'monsoon', 'winter', 'all'];
const DIETS = ['veg', 'jain', 'egg', 'nonveg'];
const STATUSES = ['pending', 'approved', 'rejected'];

export async function listForReview(env, { status = 'pending', limit = 20, offset = 0, reviewed = '' } = {}) {
  if (!STATUSES.includes(status)) throw new Error('bad status');
  // the owner's bookmark: reviewed = 'yes' | 'no' | '' (all)
  const bookmark = reviewed === 'yes' ? 'AND r.owner_reviewed_at IS NOT NULL' : reviewed === 'no' ? 'AND r.owner_reviewed_at IS NULL' : '';
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.name, r.source_url, r.image_url, r.description, r.ingredients_raw_json, r.instructions_json,
            r.total_minutes, r.diet, r.age_min_months, r.age_max_months, r.tag_reasons_json, r.flags_json,
            r.extraction_method, r.completeness, r.found_for, r.created_at, r.reviewed_at, r.review_note,
            r.source_rating, r.source_rating_count,
            r.poshan_score, r.score_status, r.score_breakdown_json, r.score_approved, r.kp_steps_json, r.kp_steps_status,
            r.publish_origin, r.auto_published_at, r.owner_reviewed_at, r.hold_reasons_json, r.ingredients_edited, r.score_hidden, r.kp_steps_auto,
            s.id AS source_id, s.name AS source_name, s.status AS source_status, s.rights_status, s.region,
            (SELECT group_concat(occasion) FROM kp_recipe_occasions WHERE recipe_id = r.id) AS occasions,
            (SELECT group_concat(season)   FROM kp_recipe_seasons   WHERE recipe_id = r.id) AS seasons
       FROM kp_recipes r JOIN kp_recipe_sources s ON s.id = r.source_id
      WHERE r.review_status = ? AND s.status != 'blocked' ${bookmark}
      ORDER BY ${status === 'approved' ? '(r.owner_reviewed_at IS NULL) DESC, r.auto_published_at DESC,' : '(r.found_for IS NOT NULL) DESC,'} r.created_at DESC
      LIMIT ? OFFSET ?`
  ).bind(status, Math.min(limit, 50), offset).all();
  const { count } = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM kp_recipes r JOIN kp_recipe_sources s ON s.id = r.source_id WHERE r.review_status = ? AND s.status != 'blocked' ${bookmark}`
  ).bind(status).first();
  const { n: unreviewed } = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM kp_recipes r JOIN kp_recipe_sources s ON s.id = r.source_id WHERE r.review_status = 'approved' AND r.owner_reviewed_at IS NULL AND s.status != 'blocked'"
  ).first();
  return {
    status, total: count, unreviewed,
    items: results.map((r) => ({
      ...r,
      ingredients: JSON.parse(r.ingredients_raw_json || '[]'),
      instructions: JSON.parse(r.instructions_json || '[]'), // owner's private preview only; public display still needs rights
      tag_reasons: JSON.parse(r.tag_reasons_json || '{}'),
      flags: JSON.parse(r.flags_json || '[]'),
      score_detail: JSON.parse(r.score_breakdown_json || 'null'),
      hold_reasons: JSON.parse(r.hold_reasons_json || '[]'),
      kp_steps: JSON.parse(r.kp_steps_json || '[]'),
      occasions: r.occasions ? r.occasions.split(',') : [],
      seasons: r.seasons ? r.seasons.split(',') : [],
      ingredients_raw_json: undefined, instructions_json: undefined, tag_reasons_json: undefined, flags_json: undefined, score_breakdown_json: undefined, kp_steps_json: undefined, hold_reasons_json: undefined,
    })),
  };
}

export async function reviewRecipe(env, id, body) {
  const action = body.action;
  // Bookmark only: tick a recipe as reviewed (or not) and keep a note. Does not change whether it is live.
  if (action === 'mark') {
    const exists = await env.DB.prepare('SELECT id FROM kp_recipes WHERE id = ?').bind(id).first();
    if (!exists) throw new Error('recipe not found');
    const sets = [], args = [];
    if (body.reviewed != null) sets.push(body.reviewed ? "owner_reviewed_at = datetime('now')" : 'owner_reviewed_at = NULL');
    if (body.note != null) { sets.push('review_note = ?'); args.push(String(body.note).slice(0, 500)); }
    if (!sets.length) throw new Error('nothing to save');
    await env.DB.prepare(`UPDATE kp_recipes SET ${sets.join(', ')} WHERE id = ?`).bind(...args, id).run();
    return env.DB.prepare('SELECT id, owner_reviewed_at, review_note FROM kp_recipes WHERE id = ?').bind(id).first();
  }
  const status = { publish: 'approved', reject: 'rejected', pending: 'pending' }[action];
  if (!status) throw new Error('action must be publish, reject or pending');

  const sets = ["review_status = ?", "reviewed_at = datetime('now')", "updated_at = datetime('now')"];
  const args = [status];
  // Confirming or publishing marks the recipe as looked at; pulling it back records why it is not live.
  if (status === 'approved') sets.push("publish_origin = COALESCE(publish_origin, 'owner')");
  // Publishing counts as having looked at it, but saving edits on a live recipe leaves the bookmark as it was.
  if (status === 'approved' && !body.keep_review_mark) sets.push("owner_reviewed_at = datetime('now')");
  if (action === 'pending') { sets.push('hold_reasons_json = ?'); args.push(JSON.stringify(['pulled back by you'])); }
  if (body.diet != null) { if (!DIETS.includes(body.diet)) throw new Error('bad diet'); sets.push('diet = ?'); args.push(body.diet); }
  for (const f of ['age_min_months', 'age_max_months']) {
    if (body[f] != null) {
      const v = +body[f];
      if (!Number.isInteger(v) || v < 6 || v > 144) throw new Error(`${f} must be 6-144`);
      sets.push(`${f} = ?`); args.push(v);
    }
  }
  // KidPoshan-written steps: the owner's edited version is saved and counts as approved when publishing.
  let stepsStatus = null;
  if (Array.isArray(body.kp_steps)) {
    const steps = body.kp_steps.map((t) => String(t).trim()).filter(Boolean).slice(0, 60);
    if (steps.length) {
      stepsStatus = action === 'publish' || body.approve_steps ? 'approved' : 'draft';
      sets.push('kp_steps_json = ?', 'kp_steps_status = ?', 'kp_steps_auto = 0'); args.push(JSON.stringify(steps), stepsStatus);
    }
  } else if (body.approve_steps === true) {
    sets.push("kp_steps_status = CASE WHEN kp_steps_json IS NOT NULL THEN 'approved' ELSE kp_steps_status END");
  }
  if (body.score_approved != null) { sets.push('score_approved = ?'); args.push(body.score_approved ? 1 : 0); }
  if (body.score_hidden != null) { sets.push('score_hidden = ?'); args.push(body.score_hidden ? 1 : 0); }
  // Ingredient lines edited by the owner replace the parsed ones, are kept on re-crawls, and the score is worked out again.
  let ingStmts = [];
  if (Array.isArray(body.ingredients)) {
    const lines = body.ingredients.map((t) => String(t).replace(/\s+/g, ' ').trim()).filter(Boolean);
    if (!lines.length || lines.length > 60 || lines.some((l) => l.length > 300)) throw new Error('ingredients: 1 to 60 lines, each under 300 characters');
    const ins = env.DB.prepare('INSERT INTO kp_recipe_ingredients (recipe_id, position, raw_text, quantity, unit, name, ingredient_key, is_pantry) VALUES (?,?,?,?,?,?,?,?)');
    ingStmts = [env.DB.prepare('DELETE FROM kp_recipe_ingredients WHERE recipe_id = ?').bind(id), ...lines.map((l, n) => { const p = parseIngredientLine(l); return ins.bind(id, n, p.raw_text, p.quantity, p.unit, p.name, p.ingredient_key, p.is_pantry ? 1 : 0); })];
    sets.push('ingredients_raw_json = ?', 'ingredients_edited = 1'); args.push(JSON.stringify(lines));
  }
  if (action === 'publish' && !body.steps_link_only) {
    const cur = await env.DB.prepare('SELECT kp_steps_status AS st, kp_steps_json AS ks, instructions_json AS ij FROM kp_recipes WHERE id = ?').bind(id).first();
    if (!cur) throw new Error('recipe not found');
    const hasSteps = JSON.parse(cur.ij || '[]').length > 0;
    const approved = stepsStatus === 'approved' || (body.approve_steps === true && cur.ks) || (!Array.isArray(body.kp_steps) && cur.st === 'approved');
    if (hasSteps && !approved) throw new Error('approve or write the KidPoshan steps before publishing (or choose "publish with link to original steps")');
  }
  if (body.note != null) { sets.push('review_note = ?'); args.push(String(body.note).slice(0, 500)); }

  const stmts = [env.DB.prepare(`UPDATE kp_recipes SET ${sets.join(', ')} WHERE id = ?`).bind(...args, id), ...ingStmts];
  if (Array.isArray(body.occasions)) {
    const occ = body.occasions.filter((o) => OCCASIONS.includes(o));
    if (action === 'publish' && !occ.length) throw new Error('pick at least one meal before publishing');
    stmts.push(env.DB.prepare('DELETE FROM kp_recipe_occasions WHERE recipe_id = ?').bind(id));
    occ.forEach((o) => stmts.push(env.DB.prepare('INSERT INTO kp_recipe_occasions (recipe_id, occasion) VALUES (?, ?)').bind(id, o)));
  }
  if (Array.isArray(body.seasons)) {
    let sea = body.seasons.filter((x) => SEASONS.includes(x));
    if (!sea.length || sea.includes('all')) sea = ['all'];
    stmts.push(env.DB.prepare('DELETE FROM kp_recipe_seasons WHERE recipe_id = ?').bind(id));
    sea.forEach((x) => stmts.push(env.DB.prepare('INSERT INTO kp_recipe_seasons (recipe_id, season) VALUES (?, ?)').bind(id, x)));
  }
  await env.DB.batch(stmts);
  if (ingStmts.length) await scoreRecipe(env, id);
  return { id, review_status: status };
}

const SITE_STATES = {
  active:  "s.status = 'registered' AND s.active = 1",
  paused:  "s.status = 'registered' AND s.active = 0",
  blocked: "s.status = 'blocked'",
  new:     "s.status = 'suggested'",
  all:     '1 = 1',
};
const RIGHTS = ['not_requested', 'requested', 'granted', 'refused'];
export const siteState = (s) => (s.status === 'blocked' ? 'blocked' : s.status === 'suggested' ? 'new' : s.active ? 'active' : 'paused');

// GET /api/kp/admin/sources?state=new|active|paused|blocked|all&q=text
export async function listSources(env, { state = 'all', q = '', status } = {}) {
  if (status === 'suggested') state = 'new'; // older callers
  if (!SITE_STATES[state]) throw new Error('state must be new, active, paused, blocked or all');
  const like = `%${String(q).trim().toLowerCase()}%`;
  const { results } = await env.DB.prepare(
    `SELECT s.id, s.name, s.url, s.platform, s.region, s.area, s.notes, s.owner_notes, s.status, s.active,
            s.rights_status, s.rights_updated_at, s.photos_hidden, s.crawl_mode, s.last_crawled_at, s.world,
            COALESCE(SUM(r.review_status = 'pending'), 0)  AS pending,
            COALESCE(SUM(r.review_status = 'approved'), 0) AS published,
            COALESCE(SUM(r.review_status = 'rejected'), 0) AS rejected,
            (SELECT COUNT(*) FROM kp_recipe_candidates c WHERE c.source_id = s.id AND c.status = 'robots_blocked') AS robots_blocked,
            (SELECT COUNT(*) FROM kp_recipe_candidates c WHERE c.source_id = s.id AND c.status = 'error') AS errors
       FROM kp_recipe_sources s LEFT JOIN kp_recipes r ON r.source_id = s.id
      WHERE ${SITE_STATES[state]}
        AND (? = '%%' OR lower(s.name) LIKE ? OR lower(s.url) LIKE ? OR lower(COALESCE(s.area,'')) LIKE ?)
      GROUP BY s.id
      ORDER BY pending DESC, published DESC, s.name`
  ).bind(like, like, like, like).all();
  const { results: totals } = await env.DB.prepare(
    `SELECT CASE WHEN status = 'blocked' THEN 'blocked' WHEN status = 'suggested' THEN 'new'
                 WHEN active = 1 THEN 'active' ELSE 'paused' END AS state, COUNT(*) AS n
       FROM kp_recipe_sources GROUP BY 1`
  ).all();
  const counts = { new: 0, active: 0, paused: 0, blocked: 0 };
  totals.forEach((t) => { counts[t.state] = t.n; });
  counts.all = counts.new + counts.active + counts.paused + counts.blocked;
  return { state, counts, items: results.map((r) => ({ ...r, state: siteState(r) })) };
}

// POST /api/kp/admin/sources/:id  { state?: active|paused|blocked, rights_status?, owner_notes? }
export async function updateSource(env, id, body) {
  if (body.status && !body.state) body.state = body.status === 'registered' ? 'active' : body.status; // older callers
  const sets = [], args = [];
  if (body.state) {
    const map = { active: ['registered', 1], paused: ['registered', 0], blocked: ['blocked', 0] }[body.state];
    if (!map) throw new Error('state must be active, paused or blocked');
    sets.push('status = ?', 'active = ?', "state_updated_at = datetime('now')"); args.push(...map);
  }
  if (body.rights_status) {
    if (!RIGHTS.includes(body.rights_status)) throw new Error('rights_status must be not_requested, requested, granted or refused');
    sets.push('rights_status = ?', "rights_updated_at = datetime('now')"); args.push(body.rights_status);
  }
  if (body.photos_hidden != null) { sets.push('photos_hidden = ?'); args.push(body.photos_hidden ? 1 : 0); }
  if (body.world != null) {
    if (!['india', 'asia', 'europe'].includes(body.world)) throw new Error('world must be india, asia or europe');
    sets.push('world = ?'); args.push(body.world);
  }
  if (body.owner_notes != null) { sets.push('owner_notes = ?'); args.push(String(body.owner_notes).slice(0, 1000)); }
  if (!sets.length) throw new Error('nothing to update');
  const exists = await env.DB.prepare('SELECT id FROM kp_recipe_sources WHERE id = ?').bind(id).first();
  if (!exists) throw new Error('site not found');
  const stmts = [env.DB.prepare(`UPDATE kp_recipe_sources SET ${sets.join(', ')} WHERE id = ?`).bind(...args, id)];
  // Blocking withdraws waiting recipes and queued pages. Published recipes stay until you reject them.
  if (body.state === 'blocked') {
    stmts.push(env.DB.prepare("UPDATE kp_recipes SET review_status = 'rejected', review_note = 'site blocked', reviewed_at = datetime('now') WHERE source_id = ? AND review_status = 'pending'").bind(id));
    stmts.push(env.DB.prepare("DELETE FROM kp_recipe_candidates WHERE source_id = ? AND status = 'pending'").bind(id));
  }
  await env.DB.batch(stmts);
  const row = await env.DB.prepare('SELECT * FROM kp_recipe_sources WHERE id = ?').bind(id).first();
  return { ...row, state: siteState(row) };
}
