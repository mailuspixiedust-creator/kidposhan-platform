// Candidate processing: fetch -> extract -> normalize -> tag -> upsert.

import { fetchHtml, extractFromHtml } from './extract.js';
import { parseIngredientLine } from './normalize.js';
import { tagRecipe } from './tag.js';
import { scoreRecipe } from './score.js';
import { isIndexPath } from './discover.js';

export function buildRecipe(extracted, source) {
  const ingredients = extracted.ingredients.map(parseIngredientLine);
  const tags = tagRecipe({
    name: extracted.name || '',
    description: extracted.description || '',
    category: extracted.category || [],
    keywords: extracted.keywords || '',
    ingredients,
    sourceUrl: extracted.source_url,
    collectionHint: `${source.url} ${source.notes || ''}`,
  });
  // Everything waits for the owner's decision. Flags only tell the reviewer where to look closely.
  const flags = [];
  if (extracted.completeness === 'partial') flags.push('partial');
  if (extracted.method === 'heuristic') flags.push('read_without_recipe_card');
  if (!extracted.name) flags.push('no_name');
  if (!tags.occasions.length) flags.push('no_meal_type');
  if (/review/.test(tags.reasons.diet || '')) flags.push('check_jain');
  if (source.status === 'suggested') flags.push('new_site');
  return { extracted, ingredients, tags, review: 'pending', flags };
}

export async function processCandidate(env, cand, source) {
  try {
    if (isIndexPath(new URL(cand.url).pathname)) {
      await env.DB.prepare("UPDATE kp_recipe_candidates SET status='not_recipe', last_error='roundup/index page', processed_at=datetime('now') WHERE id=?").bind(cand.id).run();
      return { id: cand.id, status: 'not_recipe' };
    }
    const { html, finalUrl } = await fetchHtml(cand.url, env);
    const extracted = extractFromHtml(html, finalUrl);
    if (!extracted) {
      await env.DB.prepare(
        "UPDATE kp_recipe_candidates SET status='not_recipe', attempts=attempts+1, processed_at=datetime('now') WHERE id=?"
      ).bind(cand.id).run();
      return { id: cand.id, status: 'not_recipe' };
    }
    const built = buildRecipe(extracted, source);
    const recipeId = await upsertRecipe(env, source.id, finalUrl, built, cand.query_key || null);
    const status = extracted.completeness === 'complete' ? 'extracted' : 'partial';
    await env.DB.prepare(
      "UPDATE kp_recipe_candidates SET status=?, attempts=attempts+1, last_error=NULL, processed_at=datetime('now') WHERE id=?"
    ).bind(status, cand.id).run();
    return { id: cand.id, status, recipe_id: recipeId, method: extracted.method, name: extracted.name };
  } catch (e) {
    if (e.code === 'robots') {
      await env.DB.prepare(
        "UPDATE kp_recipe_candidates SET status='robots_blocked', last_error=?, processed_at=datetime('now') WHERE id=?"
      ).bind(e.message.slice(0, 500), cand.id).run();
      return { id: cand.id, status: 'robots_blocked' };
    }
    if (e.code === 'later') {
      // pacing, not a failure: leave it pending and don't count an attempt
      await env.DB.prepare('UPDATE kp_recipe_candidates SET not_before=? WHERE id=?').bind(e.notBefore, cand.id).run();
      return { id: cand.id, status: 'later' };
    }
    await env.DB.prepare(
      "UPDATE kp_recipe_candidates SET status='error', attempts=attempts+1, last_error=?, processed_at=datetime('now') WHERE id=?"
    ).bind(String(e.message).slice(0, 500), cand.id).run();
    return { id: cand.id, status: 'error', error: e.message };
  }
}

async function upsertRecipe(env, sourceId, url, { extracted: x, ingredients, tags, review, flags }, foundFor) {
  const row = await env.DB.prepare(
    `INSERT INTO kp_recipes (source_id, source_url, name, image_url, description, ingredients_raw_json, instructions_json,
       servings, prep_minutes, cook_minutes, total_minutes, source_rating, source_rating_count,
       extraction_method, completeness, diet, age_min_months, age_max_months, tag_reasons_json, review_status,
       flags_json, found_for)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(source_url) DO UPDATE SET
       name=excluded.name, image_url=excluded.image_url, description=excluded.description,
       ingredients_raw_json=excluded.ingredients_raw_json, instructions_json=excluded.instructions_json,
       servings=excluded.servings, prep_minutes=excluded.prep_minutes, cook_minutes=excluded.cook_minutes,
       total_minutes=excluded.total_minutes, source_rating=excluded.source_rating,
       source_rating_count=excluded.source_rating_count, extraction_method=excluded.extraction_method,
       completeness=excluded.completeness, tag_reasons_json=excluded.tag_reasons_json,
       -- once the owner has decided, a re-crawl never changes the tags or the decision
       diet=CASE WHEN kp_recipes.reviewed_at IS NULL THEN excluded.diet ELSE kp_recipes.diet END,
       age_min_months=CASE WHEN kp_recipes.reviewed_at IS NULL THEN excluded.age_min_months ELSE kp_recipes.age_min_months END,
       age_max_months=CASE WHEN kp_recipes.reviewed_at IS NULL THEN excluded.age_max_months ELSE kp_recipes.age_max_months END,
       flags_json=excluded.flags_json,
       updated_at=datetime('now')
     RETURNING id, reviewed_at`
  ).bind(
    sourceId, url, x.name || '(untitled)', x.image_url, x.description,
    JSON.stringify(x.ingredients), JSON.stringify(x.instructions),
    x.servings, x.prep_minutes, x.cook_minutes,
    x.total_minutes ?? ((x.prep_minutes || 0) + (x.cook_minutes || 0) || null),
    x.rating, x.rating_count, x.method, x.completeness,
    tags.diet, tags.age_min_months, tags.age_max_months, JSON.stringify(tags.reasons), review,
    JSON.stringify(flags || []), foundFor
  ).first();
  const id = row.id;
  const reviewed = !!row.reviewed_at;

  const ins = env.DB.prepare(
    'INSERT INTO kp_recipe_ingredients (recipe_id, position, raw_text, quantity, unit, name, ingredient_key, is_pantry) VALUES (?,?,?,?,?,?,?,?)'
  );
  const occ = env.DB.prepare('INSERT OR IGNORE INTO kp_recipe_occasions (recipe_id, occasion) VALUES (?,?)');
  const sea = env.DB.prepare('INSERT OR IGNORE INTO kp_recipe_seasons (recipe_id, season) VALUES (?,?)');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM kp_recipe_ingredients WHERE recipe_id=?').bind(id),
    ...ingredients.map((i, n) => ins.bind(id, n, i.raw_text, i.quantity, i.unit, i.name, i.ingredient_key, i.is_pantry ? 1 : 0)),
    // owner-edited meal/season tags survive re-crawls
    ...(reviewed ? [] : [
      env.DB.prepare('DELETE FROM kp_recipe_occasions WHERE recipe_id=?').bind(id),
      env.DB.prepare('DELETE FROM kp_recipe_seasons WHERE recipe_id=?').bind(id),
      ...tags.occasions.map((o) => occ.bind(id, o)),
      ...tags.seasons.map((x) => sea.bind(id, x)),
    ]),
  ]);
  if (x.nutrition) await env.DB.prepare('UPDATE kp_recipes SET nutrition_json=? WHERE id=?').bind(JSON.stringify(x.nutrition), id).run();
  await scoreRecipe(env, id); // recipe-level Poshan Score, from this recipe's own ingredients
  return id;
}

export async function processPending(env, { limit = 10, queryKey = null } = {}) {
  // Candidates found for a live parent search go first, so they reach the review screen quickly.
  const { results: cands } = await env.DB.prepare(
    `SELECT c.id, c.url, c.source_id, c.query_key, s.url AS source_url, s.notes AS source_notes, s.status AS source_status
       FROM kp_recipe_candidates c JOIN kp_recipe_sources s ON s.id = c.source_id
      WHERE (c.status = 'pending' OR (c.status = 'error' AND c.attempts < 3))
        AND (s.status = 'suggested' OR (s.status = 'registered' AND s.active = 1))
        AND (? IS NULL OR c.query_key = ?)
        AND (c.not_before IS NULL OR c.not_before <= ?)
      ORDER BY c.query_key IS NULL, c.discovered_via = 'self', c.id LIMIT ?`
  ).bind(queryKey, queryKey, Date.now(), limit * 5).all();
  // Spread each run across sites: at most 2 pages per site, so pacing rarely has to wait.
  const perHost = new Map(), picked = [];
  for (const c of cands) {
    const h = new URL(c.url).hostname, n = perHost.get(h) || 0;
    if (n >= 2) continue;
    perHost.set(h, n + 1); picked.push(c);
    if (picked.length >= limit) break;
  }
  const out = [];
  for (const c of picked) {
    out.push(await processCandidate(env, c, { id: c.source_id, url: c.source_url, notes: c.source_notes, status: c.source_status }));
  }
  return out;
}
