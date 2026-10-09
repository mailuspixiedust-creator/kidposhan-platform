import fs from "node:fs";

const file = "src/recipe-catalogue-v2.js";
let s = fs.readFileSync(file, "utf8");

function replaceOnce(oldText, newText, label) {
  if (!s.includes(oldText)) throw new Error(`Could not find expected ${label} block.`);
  s = s.replace(oldText, newText);
}

replaceOnce(`function parseQuantity(raw) {
  const value = clean(raw);

  if (!value) {
    return { raw: "", quantitative: false };
  }

  if (/\\bto taste\\b/i.test(value)) {
    return {
      raw: value,
      quantitative: false,
      assumed: true,
      assumption: "to_taste_3g"
    };
  }

  if (/\\bas needed\\b|\\bhandful\\b|\\bsome\\b|\\bfew\\b|\\ba pinch\\b/i.test(value)) {
    return {
      raw: value,
      quantitative: false,
      assumed: false
    };
  }

  if (/\\d/.test(value)) {
    return {
      raw: value,
      quantitative: true
    };
  }

  return {
    raw: value,
    quantitative: false
  };
}`,
`function parseQuantity(raw) {
  const value = clean(raw);

  if (!value) return { raw: "", quantitative: false, qualitative_phrase: null };

  const patterns = [
    ["to taste", /\\bto taste\\b/i],
    ["as required", /\\bas required\\b/i],
    ["as needed", /\\bas needed\\b/i],
    ["handful", /\\bhandful\\b/i],
    ["some", /\\bsome\\b/i],
    ["few", /\\bfew\\b/i],
    ["a pinch", /\\ba pinch\\b/i]
  ];

  for (const [phrase, re] of patterns) {
    if (re.test(value)) {
      return {
        raw: value,
        quantitative: false,
        qualitative_phrase: phrase
      };
    }
  }

  if (/\\d/.test(value)) {
    return { raw: value, quantitative: true, qualitative_phrase: null };
  }

  return { raw: value, quantitative: false, qualitative_phrase: null };
}`,
"parseQuantity");

replaceOnce(`function normalizeIngredients(recipe) {
  const list = Array.isArray(recipe.recipeIngredient)
    ? recipe.recipeIngredient
    : [];

  return list.map((raw, index) => {
    const value = clean(raw);

    // JSON-LD normally gives a single ingredient string.
    // Preserve the original wording rather than inventing a quantity.
    const quantity = parseQuantity(value);

    return {
      name: value,
      key: normalizeKey(value),
      qty: value,
      quantity,
      source_index: index
    };
  });
}`,
`function normalizeIngredients(recipe) {
  const list = Array.isArray(recipe.recipeIngredient)
    ? recipe.recipeIngredient
    : [];

  return list.map((raw, index) => {
    const sourceText = clean(raw);
    const quantity = parseQuantity(sourceText);
    let name = sourceText;

    if (quantity.qualitative_phrase) {
      const phrase = quantity.qualitative_phrase.replace(/[.*+?^$\\{\\}()|[\\]\\\\]/g, "\\\\$&");
      name = clean(sourceText.replace(new RegExp("\\\\s*" + phrase + "\\\\s*", "i"), " "));
    }

    return {
      source_text: sourceText,
      name,
      key: normalizeKey(name),
      qty: sourceText,
      quantity,
      source_index: index
    };
  });
}`,
"normalizeIngredients");

replaceOnce(`function nutritionInputs(recipe, ingredients) {
  const n = recipe.nutrition || {};
  const ingredientText = ingredients
    .map(x => x.name)
    .join(" ")
    .toLowerCase();

  const protein = parseNumber(n.protein);
  const fibre = parseNumber(n.fibre ?? n.fiber);
  const sodium = parseNumber(n.sodium);
  const satFat = parseNumber(n.saturatedFat ?? n.saturated_fat);
  const addedSugar = parseNumber(n.addedSugar ?? n.added_sugar);

  const palmOil = /\\bpalm\\s+oil\\b/.test(ingredientText);
  const maida = /\\bmaida\\b|\\brefined\\s+(?:wheat\\s+)?flour\\b/.test(ingredientText);
  const wholeGrain =
    /\\bwhole\\s*grain\\b|\\bwhole\\s*wheat\\b|\\bwholegrain\\b/.test(ingredientText);

  // KidPoshan convention:
  // "salt to taste" = 3 g salt.
  // Sodium contribution of NaCl is approximately 39.3%.
  let sodiumValue = Number.isFinite(sodium) ? sodium : 0;

  const saltToTaste = ingredients.some(
    x => /\\bsalt\\b/i.test(x.name) && /\\bto taste\\b/i.test(x.name)
  );

  if (!Number.isFinite(sodium) && saltToTaste) {
    sodiumValue += 3000 * 0.393;
  }

  return {
    addedSugar: Number.isFinite(addedSugar) ? addedSugar : 0,
    sodium: sodiumValue,
    satFat: Number.isFinite(satFat) ? satFat : 0,
    additives: 0,
    palmOil,
    maida,
    protein: Number.isFinite(protein) ? protein : 0,
    fibre: Number.isFinite(fibre) ? fibre : 0,
    wholeGrain,
    category: clean(n.category || recipe.recipeCategory || "")
  };
}`,
`function nutritionInputs(recipe, ingredients, approvedStandards = new Map()) {
  const n = recipe.nutrition || {};
  const ingredientText = ingredients.map(x => x.name).join(" ").toLowerCase();

  const protein = parseNumber(n.protein);
  const fibre = parseNumber(n.fibre ?? n.fiber);
  const sodium = parseNumber(n.sodium);
  const satFat = parseNumber(n.saturatedFat ?? n.saturated_fat);
  const addedSugar = parseNumber(n.addedSugar ?? n.added_sugar);

  const palmOil = /\\bpalm\\s+oil\\b/.test(ingredientText);
  const maida = /\\bmaida\\b|\\brefined\\s+(?:wheat\\s+)?flour\\b/.test(ingredientText);
  const wholeGrain = /\\bwhole\\s*grain\\b|\\bwhole\\s*wheat\\b|\\bwholegrain\\b/.test(ingredientText);

  let sodiumValue = Number.isFinite(sodium) ? sodium : 0;

  if (!Number.isFinite(sodium)) {
    for (const ingredient of ingredients) {
      const phrase = ingredient.quantity?.qualitative_phrase;
      if (!phrase) continue;

      const standard = approvedStandards.get(
        `${ingredient.key}|${normalizeKey(phrase)}`
      );

      if (
        standard &&
        Number(standard.approved) === 1 &&
        standard.unit === "g" &&
        standard.min_quantity != null &&
        standard.max_quantity != null &&
        Number(standard.min_quantity) === Number(standard.max_quantity) &&
        ingredient.key === "salt"
      ) {
        sodiumValue += Number(standard.min_quantity) * 1000 * 0.393;
      }
    }
  }

  return {
    addedSugar: Number.isFinite(addedSugar) ? addedSugar : 0,
    sodium: sodiumValue,
    satFat: Number.isFinite(satFat) ? satFat : 0,
    additives: 0,
    palmOil,
    maida,
    protein: Number.isFinite(protein) ? protein : 0,
    fibre: Number.isFinite(fibre) ? fibre : 0,
    wholeGrain,
    category: clean(n.category || recipe.recipeCategory || "")
  };
}`,
"nutritionInputs");

const marker = `export async function buildRecipeCatalogue(env, options = {}) {`;
if (!s.includes(marker)) throw new Error("Could not find buildRecipeCatalogue marker.");

const helpers = `
async function loadApprovedQuantityStandards(env) {
  const { results } = await env.DB.prepare(\`
    SELECT ingredient_key, phrase, min_quantity, max_quantity, unit, approved
    FROM qualitative_quantity_standards
    WHERE approved=1
  \`).all();

  const map = new Map();
  for (const row of results || []) {
    map.set(\`\${normalizeKey(row.ingredient_key)}|\${normalizeKey(row.phrase)}\`, row);
  }
  return map;
}

async function recordQualitativeEvidence(env, recipe) {
  for (const ingredient of recipe.ingredients || []) {
    const phrase = ingredient.quantity?.qualitative_phrase;
    if (!phrase) continue;

    const ingredientKey = normalizeKey(ingredient.key);
    const normalizedPhrase = normalizeKey(phrase);
    const termId = makeId("qqt");

    await env.DB.prepare(\`
      INSERT OR IGNORE INTO qualitative_quantity_terms
      (id, phrase, normalized_phrase, ingredient_key, ingredient_name, context_key, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'observed', ?, ?)
    \`).bind(
      termId,
      phrase,
      normalizedPhrase,
      ingredientKey,
      ingredient.name,
      null,
      now(),
      now()
    ).run();

    const term = await env.DB.prepare(\`
      SELECT id FROM qualitative_quantity_terms
      WHERE normalized_phrase=? AND ingredient_key=? AND COALESCE(context_key,'')=''
      LIMIT 1
    \`).bind(normalizedPhrase, ingredientKey).first();

    if (!term) continue;

    await env.DB.prepare(\`
      INSERT INTO qualitative_quantity_evidence
      (id, term_id, recipe_id, source_url, source_name, original_text,
       observed_quantity, observed_unit, observed_min, observed_max,
       observed_unit_normalized, context_json, evidence_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, 'observed', ?)
    \`).bind(
      makeId("qqe"),
      term.id,
      null,
      recipe.source_recipe_url || null,
      recipe.source_name || null,
      ingredient.source_text || ingredient.qty || ingredient.name,
      JSON.stringify({ ingredient_key: ingredientKey, phrase }),
      now()
    ).run();
  }
}

`;

s = s.replace(marker, helpers + marker);

replaceOnce(
`function scoreAndPrepare(candidates) {
  return candidates.map(recipe => {
    const inputs = nutritionInputs(recipe.raw_recipe, recipe.ingredients);

    const score = calculatePoshanScore(inputs, "home_cooked");

    return {
      ...recipe,
      nutrition_inputs: inputs,
      poshan_score: score.finalScore,
      score_band: score.band,
      score_breakdown: score.breakdown,
      scoring_version: SCORING_VERSION
    };
  });
}`,
`async function scoreAndPrepare(env, candidates) {
  const approvedStandards = await loadApprovedQuantityStandards(env);

  for (const recipe of candidates) {
    await recordQualitativeEvidence(env, recipe);

    const inputs = nutritionInputs(
      recipe.raw_recipe,
      recipe.ingredients,
      approvedStandards
    );

    const score = calculatePoshanScore(inputs, "home_cooked");

    recipe.nutrition_inputs = inputs;
    recipe.poshan_score = score.finalScore;
    recipe.score_band = score.band;
    recipe.score_breakdown = score.breakdown;
    recipe.scoring_version = SCORING_VERSION;
  }

  return candidates;
}`,
"scoreAndPrepare");

replaceOnce(
`candidates: scoreAndPrepare(candidates),`,
`candidates: await scoreAndPrepare(env, candidates),`,
"catalogue scoring call"
);

fs.writeFileSync(file, s, "utf8");
console.log("Patched src/recipe-catalogue-v2.js successfully.");
