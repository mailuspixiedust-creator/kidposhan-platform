/**
 * KidPoshan qualitative quantity repository integration.
 *
 * This module records ambiguous quantity language as evidence.
 * It NEVER converts an unapproved qualitative phrase into a numeric quantity.
 */

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeKey(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const QUALITATIVE_PATTERNS = [
  /\bto taste\b/i,
  /\bas required\b/i,
  /\bas needed\b/i,
  /\baccording to taste\b/i,
  /\bsome\b/i,
  /\bfew\b/i,
  /\ba few\b/i,
  /\bhandful\b/i,
  /\bpinch\b/i,
  /\bneeded\b/i
];

function findQualitativePhrase(text) {
  const source = clean(text);
  if (!source) return "";

  for (const pattern of QUALITATIVE_PATTERNS) {
    const match = source.match(pattern);
    if (match) return match[0].toLowerCase();
  }

  return "";
}

function inferIngredientName(sourceText, phrase) {
  if (!phrase) return clean(sourceText);
  return clean(sourceText.replace(new RegExp(`\\s*${phrase}\\b`, "i"), ""));
}

/**
 * Records every qualitative quantity observation found in a recipe.
 *
 * Existing approved standards are deliberately NOT applied here.
 * This is an evidence-collection step only.
 */
export async function recordQualitativeQuantityEvidence(
  env,
  source,
  recipe,
  recipeUrl
) {
  if (!env?.DB) return { recorded: 0 };

  const sourceIngredients = Array.isArray(recipe?.recipeIngredient)
    ? recipe.recipeIngredient
    : [];

  let recorded = 0;

  for (const item of sourceIngredients) {
    const originalText = clean(item);
    const phrase = findQualitativePhrase(originalText);
    if (!phrase) continue;

    const ingredientName = inferIngredientName(originalText, phrase);
    const ingredientKey = normalizeKey(ingredientName);
    if (!ingredientKey) continue;

    const termId = `qqt-${crypto.randomUUID()}`;
    const evidenceId = `qqe-${crypto.randomUUID()}`;
    const now = Math.floor(Date.now() / 1000);

    // Find an existing term first. Multiple recipes must accumulate
    // against the same phrase + ingredient rather than creating duplicates.
    let term = await env.DB.prepare(`
      SELECT id
      FROM qualitative_quantity_terms
      WHERE normalized_phrase=? AND ingredient_key=? AND COALESCE(context_key,'')=''
      LIMIT 1
    `).bind(phrase, ingredientKey).first();

    if (!term) {
      await env.DB.prepare(`
        INSERT INTO qualitative_quantity_terms
        (id, phrase, normalized_phrase, ingredient_key, ingredient_name,
         context_key, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, NULL, 'observed', ?, ?)
      `).bind(
        termId,
        phrase,
        phrase,
        ingredientKey,
        ingredientName,
        now,
        now
      ).run();

      term = { id: termId };
    }

    await env.DB.prepare(`
      INSERT INTO qualitative_quantity_evidence
      (id, term_id, recipe_id, source_url, source_name, original_text,
       observed_quantity, observed_unit, observed_min, observed_max,
       observed_unit_normalized, context_json, evidence_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, 'observed', ?)
    `).bind(
      evidenceId,
      term.id,
      recipe?.source_recipe_id || null,
      recipeUrl || null,
      source?.source_name || null,
      originalText,
      JSON.stringify({
        ingredient_name: ingredientName,
        qualitative_phrase: phrase
      }),
      now
    ).run();

    recorded += 1;
  }

  return { recorded };
}

export { findQualitativePhrase };
