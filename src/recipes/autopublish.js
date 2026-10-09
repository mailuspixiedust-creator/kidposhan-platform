// Publish by default, review afterwards.
// A recipe goes live on its own only when every check below passes. Anything else stays "held" in the owner's
// Waiting list with the reasons written down. The owner can always pull a live recipe back, edit its steps, ingredients
// or tags, or confirm it. Once the owner has decided on a recipe (reviewed_at set), this code never touches it again.

// Review flags (pipeline.js buildRecipe) that always hold a recipe back.
const HOLD_FLAGS = {
  partial: 'the page was read only in part (no full recipe card)',
  read_without_recipe_card: 'no structured recipe card on the page, so it was read by guesswork',
  no_name: 'no recipe name found',
  no_meal_type: 'no meal type could be worked out (breakfast, lunchbox, ...)',
  check_jain: 'Jain suitability needs a person to confirm',
  new_site: 'this site is not in your registry yet',
};
const CARD_METHODS = new Set(['jsonld', 'microdata', 'wprm', 'tasty']);
const MIN_INGREDIENTS = 3, MIN_STEPS = 2;
const UNDER_ONE_YEAR = 12; // months

// Pure: everything the checks need is passed in, so it is easy to test. Returns the list of reasons (empty = go live).
export function holdReasons({ recipe, source, flags = [], ingredients = [], steps = 0, occasions = 0 }) {
  const why = [];
  if (!source || source.status !== 'registered' || !source.active) why.push('the site is not an active, registered site');
  if (recipe.completeness !== 'complete') why.push('the recipe was not read completely (name, ingredients and steps)');
  if (!CARD_METHODS.has(recipe.extraction_method)) why.push('not read from a structured recipe card');
  for (const f of flags) if (HOLD_FLAGS[f]) why.push(HOLD_FLAGS[f]);
  if (ingredients.length < MIN_INGREDIENTS) why.push(`only ${ingredients.length} ingredient lines`);
  if (steps < MIN_STEPS) why.push(`only ${steps} step(s) in the original`);
  if (recipe.kp_steps_status !== 'approved') why.push('the KidPoshan steps are not ready yet');
  if (!occasions) why.push('no meal type selected');
  if (!(recipe.age_min_months <= recipe.age_max_months)) why.push('the age range is not valid');
  // Safety: very young children have rules that rule-based tagging cannot be trusted with (textures, honey, salt, allergens).
  if (recipe.age_min_months < UNDER_ONE_YEAR) why.push('suitable for under 12 months: a person must confirm');
  if (ingredients.some((i) => i.ingredient_key === 'honey') && recipe.age_min_months < 24) why.push('contains honey and is tagged for under 2 years: a person must confirm');
  return [...new Set(why)];
}

// Evaluates one recipe and, if it passes, publishes it. Never touches a recipe the owner has already decided on.
export async function maybeAutoPublish(env, id) {
  const r = await env.DB.prepare(
    `SELECT id, review_status, reviewed_at, completeness, extraction_method, flags_json, age_min_months, age_max_months,
            instructions_json, kp_steps_status, source_id
       FROM kp_recipes WHERE id = ?`
  ).bind(id).first();
  if (!r) return { id, skipped: 'not found' };
  if (r.reviewed_at) return { id, skipped: 'the owner has already decided on this recipe' };
  if (r.review_status !== 'pending') return { id, skipped: `already ${r.review_status}` };

  const source = await env.DB.prepare('SELECT status, active FROM kp_recipe_sources WHERE id = ?').bind(r.source_id).first();
  const { results: ingredients } = await env.DB.prepare('SELECT ingredient_key FROM kp_recipe_ingredients WHERE recipe_id = ?').bind(id).all();
  const { n: occasions } = await env.DB.prepare('SELECT COUNT(*) AS n FROM kp_recipe_occasions WHERE recipe_id = ?').bind(id).first();
  let flags = [], steps = 0;
  try { flags = JSON.parse(r.flags_json || '[]'); } catch { /* ignore */ }
  try { steps = JSON.parse(r.instructions_json || '[]').length; } catch { /* ignore */ }

  const why = holdReasons({ recipe: r, source, flags, ingredients, steps, occasions });
  if (why.length) {
    await env.DB.prepare('UPDATE kp_recipes SET hold_reasons_json = ? WHERE id = ?').bind(JSON.stringify(why), id).run();
    return { id, held: why };
  }
  await env.DB.prepare(
    `UPDATE kp_recipes SET review_status = 'approved', publish_origin = 'auto', auto_published_at = datetime('now'),
            hold_reasons_json = NULL, updated_at = datetime('now')
      WHERE id = ? AND reviewed_at IS NULL AND review_status = 'pending'`
  ).bind(id).run();
  return { id, published: true };
}

// Sweep: evaluate recipes that are waiting and have their KidPoshan steps ready.
export async function autoPublishPending(env, { limit = 25 } = {}) {
  const { results } = await env.DB.prepare(
    // Held recipes (hold_reasons_json set) are re-checked only when something about them changes, not on every run.
    `SELECT id FROM kp_recipes WHERE review_status = 'pending' AND reviewed_at IS NULL AND kp_steps_status = 'approved'
        AND hold_reasons_json IS NULL ORDER BY id LIMIT ?`
  ).bind(limit).all();
  const out = { published: 0, held: 0 };
  for (const r of results) { const x = await maybeAutoPublish(env, r.id); if (x.published) out.published++; else if (x.held) out.held++; }
  return out;
}
