/**
 * KidPoshan Recipe Catalogue Builder v2
 *
 * Design:
 * - Discovery is a backend/catalogue-building job, NOT a parent-search operation.
 * - Parent searches should query D1 only.
 * - All 50 active registered sources are considered during a catalogue refresh.
 * - Direct source discovery is preferred where possible.
 * - Tavily is a fallback discovery mechanism, not the per-parent-search engine.
 *
 * This file is intentionally standalone. It does NOT modify src/index.js.
 */

import { calculatePoshanScore } from "./poshan-score.js";

export const CATALOGUE_VERSION = "recipe-catalogue-v2";
export const SCORING_VERSION = "poshan-home-v1";

export const AGE_BRACKETS = {
  "5-9": { min: 5, max: 9 },
  "10-13": { min: 10, max: 13 }
};

function text(v) {
  return v == null ? "" : String(v).trim();
}

function clean(v) {
  return text(v).replace(/\s+/g, " ").trim();
}

function normalizeKey(v) {
  return clean(v)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseJSON(v, fallback = null) {
  try {
    return typeof v === "string" ? JSON.parse(v) : (v ?? fallback);
  } catch {
    return fallback;
  }
}

function absoluteUrl(value, baseUrl) {
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return "";
  }
}

function parseJsonLd(html) {
  const output = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;

  while ((m = re.exec(html))) {
    const raw = m[1].replace(/^\s*<!--/, "").replace(/-->\s*$/, "").trim();
    const data = parseJSON(raw);
    if (data) output.push(data);
  }

  return output;
}

function recipeNodes(value) {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value.flatMap(recipeNodes);
  }

  if (value["@graph"]) {
    return recipeNodes(value["@graph"]);
  }

  if (value["@type"]) {
    const types = Array.isArray(value["@type"])
      ? value["@type"]
      : [value["@type"]];

    if (types.some(t => String(t).toLowerCase() === "recipe")) {
      return [value];
    }
  }

  return [];
}

export function extractRecipesFromHtml(html, pageUrl) {
  const recipes = [];

  for (const block of parseJsonLd(html)) {
    for (const recipe of recipeNodes(block)) {
      recipes.push(normalizeRecipe(recipe, pageUrl));
    }
  }

  return recipes;
}

function parseQuantity(raw) {
  const value = clean(raw);

  if (!value) {
    return { raw: "", quantitative: false };
  }

  if (/\bto taste\b/i.test(value)) {
    return {
      raw: value,
      quantitative: false,
      assumed: true,
      assumption: "to_taste_3g"
    };
  }

  if (/\bas needed\b|\bhandful\b|\bsome\b|\bfew\b|\ba pinch\b/i.test(value)) {
    return {
      raw: value,
      quantitative: false,
      assumed: false
    };
  }

  if (/\d/.test(value)) {
    return {
      raw: value,
      quantitative: true
    };
  }

  return {
    raw: value,
    quantitative: false
  };
}

function normalizeIngredients(recipe) {
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
}

export function quantitativeQuality(ingredients) {
  if (!ingredients.length) {
    return {
      percentage: 0,
      band: "Low",
      quantitative_count: 0,
      total: 0
    };
  }

  const quantitative = ingredients.filter(
    x => x.quantity && x.quantity.quantitative
  ).length;

  const percentage = Math.round(
    (quantitative / ingredients.length) * 100
  );

  return {
    percentage,
    band: percentage >= 90
      ? "High"
      : percentage >= 70
        ? "Medium"
        : "Low",
    quantitative_count: quantitative,
    total: ingredients.length
  };
}

function parseNumber(v) {
  if (v == null || v === "") return null;
  const m = String(v).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function nutritionInputs(recipe, ingredients) {
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

  const palmOil = /\bpalm\s+oil\b/.test(ingredientText);
  const maida = /\bmaida\b|\brefined\s+(?:wheat\s+)?flour\b/.test(ingredientText);
  const wholeGrain =
    /\bwhole\s*grain\b|\bwhole\s*wheat\b|\bwholegrain\b/.test(ingredientText);

  // KidPoshan convention:
  // "salt to taste" = 3 g salt.
  // Sodium contribution of NaCl is approximately 39.3%.
  let sodiumValue = Number.isFinite(sodium) ? sodium : 0;

  const saltToTaste = ingredients.some(
    x => /\bsalt\b/i.test(x.name) && /\bto taste\b/i.test(x.name)
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
}

function normalizeRecipe(recipe, pageUrl) {
  const ingredients = normalizeIngredients(recipe);

  return {
    name: clean(recipe.name),
    description: clean(recipe.description),
    source_recipe_url: pageUrl,
    image_url: absoluteUrl(
      Array.isArray(recipe.image) ? recipe.image[0] : recipe.image,
      pageUrl
    ),
    ingredients,
    nutrition: recipe.nutrition || {},
    prep_minutes: parseNumber(recipe.totalTime),
    quantitative_quality: quantitativeQuality(ingredients),
    raw_recipe: recipe
  };
}

function ageEligible(recipe, bracket) {
  if (!bracket) return true;

  const min = parseNumber(recipe.age_min);
  const max = parseNumber(recipe.age_max);

  if (!Number.isFinite(min) && !Number.isFinite(max)) return true;

  return (
    (Number.isFinite(min) ? min : 0) <= bracket.max &&
    (Number.isFinite(max) ? max : 99) >= bracket.min
  );
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": "KidPoshanRecipeCatalogue/1.0 (+https://kidposhan.in)"
    }
  });

  if (!response.ok) return null;

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return null;

  return response.text();
}

function sourceDomain(sourceUrl) {
  try {
    return new URL(sourceUrl).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

async function tavilySearch(env, query, domains = []) {
  if (!env.TAVILY_API_KEY) {
    return { results: [], skipped: true };
  }

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.TAVILY_API_KEY}`
    },
    body: JSON.stringify({
      query,
      search_depth: "basic",
      max_results: 20,
      include_answer: false,
      include_images: false,
      include_domains: domains
    })
  });

  if (!response.ok) {
    throw new Error(`Tavily ${response.status}`);
  }

  return response.json();
}

/**
 * Build a catalogue refresh.
 *
 * This function is intended for an admin/cron job.
 * It does NOT run when a parent searches the website.
 *
 * Strategy:
 * - Load all active sources.
 * - Attempt direct discovery using each source's registered URL.
 * - If Tavily is configured, use batched domain searches as fallback.
 * - Fetch candidate pages and extract Recipe JSON-LD.
 * - Return normalized candidates for persistence.
 */
export async function buildRecipeCatalogue(env, options = {}) {
  const limitPerSource = Math.min(
    Math.max(Number(options.limitPerSource || 5), 1),
    20
  );

  const { results: sources } = await env.DB.prepare(`
    SELECT *
    FROM recipe_sources
    WHERE active=1
    ORDER BY id
  `).all();

  const candidates = [];
  const errors = [];
  const visited = new Set();

  // Direct source discovery:
  // Try registered source URLs first. This costs no search API credits.
  for (const source of sources) {
    try {
      const html = await fetchHtml(source.source_url);
      if (!html) continue;

      const recipes = extractRecipesFromHtml(html, source.source_url);

      for (const recipe of recipes.slice(0, limitPerSource)) {
        if (!recipe.name || !recipe.ingredients.length) continue;

        candidates.push({
          ...recipe,
          source_id: source.id,
          source_name: source.source_name,
          platform: source.platform,
          creator_type: source.creator_type,
          region: source.region,
          state_or_area: source.state_or_area,
          source_url: source.source_url,
          discovery_method: "direct"
        });
      }
    } catch (error) {
      errors.push({
        source_id: source.id,
        method: "direct",
        error: String(error?.message || error)
      });
    }
  }

  // Search fallback:
  // Batch all source domains. We do not call Tavily once per source.
  if (env.TAVILY_API_KEY && options.useSearchFallback !== false) {
    const domains = sources
      .map(s => sourceDomain(s.source_url))
      .filter(Boolean);

    const uniqueDomains = [...new Set(domains)];

    for (let i = 0; i < uniqueDomains.length; i += 20) {
      const batch = uniqueDomains.slice(i, i + 20);

      try {
        const search = await tavilySearch(
          env,
          "Indian kids healthy recipes ingredients quantities",
          batch
        );

        for (const result of search.results || []) {
          const url = clean(result.url);
          if (!url || visited.has(url)) continue;

          visited.add(url);

          const html = await fetchHtml(url);
          if (!html) continue;

          const recipes = extractRecipesFromHtml(html, url);

          const source = sources.find(
            s => sourceDomain(s.source_url) === sourceDomain(url)
          );

          if (!source) continue;

          for (const recipe of recipes) {
            if (!recipe.name || !recipe.ingredients.length) continue;

            candidates.push({
              ...recipe,
              source_id: source.id,
              source_name: source.source_name,
              platform: source.platform,
              creator_type: source.creator_type,
              region: source.region,
              state_or_area: source.state_or_area,
              source_url: source.source_url,
              discovery_method: "search"
            });
          }
        }
      } catch (error) {
        errors.push({
          method: "search",
          domains: batch,
          error: String(error?.message || error)
        });
      }
    }
  }

  return {
    catalogue_version: CATALOGUE_VERSION,
    source_count: sources.length,
    sources_considered: sources.length,
    candidates: scoreAndPrepare(candidates),
    errors
  };
}

function scoreAndPrepare(candidates) {
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
}

export function dedupeCatalogue(candidates) {
  const map = new Map();

  for (const recipe of candidates) {
    const key = [
      recipe.source_id,
      normalizeKey(recipe.name),
      recipe.source_recipe_url
    ].join("|");

    if (!map.has(key)) {
      map.set(key, recipe);
    }
  }

  return [...map.values()];
}

export function rankCatalogue(candidates, limit = 10) {
  return dedupeCatalogue(candidates)
    .sort((a, b) => {
      if (b.poshan_score !== a.poshan_score) {
        return b.poshan_score - a.poshan_score;
      }

      return (
        (b.quantitative_quality?.percentage || 0) -
        (a.quantitative_quality?.percentage || 0)
      );
    })
    .slice(0, Math.min(Math.max(limit, 1), 50));
}

/**
 * Parent-search helper.
 *
 * This intentionally performs NO web search.
 * It expects the recipes to already exist in D1.
 */
export async function searchRecipeCatalogue(env, filters = {}) {
  const bracket = AGE_BRACKETS[filters.age_bracket];

  let sql = `
    SELECT r.*, rs.source_name, rs.platform,
           rs.region AS source_region,
           rs.state_or_area AS source_state
    FROM recipes r
    LEFT JOIN recipe_sources rs ON rs.id = r.source_id
    WHERE r.status='published'
  `;

  const args = [];

  if (filters.meal) {
    sql += ` AND r.meal_moment=?`;
    args.push(filters.meal);
  }

  if (filters.season && filters.season !== "All Seasons") {
    sql += ` AND (r.season=? OR r.season='All Seasons')`;
    args.push(filters.season);
  }

  if (filters.diet && filters.diet !== "All") {
    sql += ` AND r.diet=?`;
    args.push(filters.diet);
  }

  if (bracket) {
    sql += ` AND (r.age_min IS NULL OR r.age_min<=?)
             AND (r.age_max IS NULL OR r.age_max>=?)`;
    args.push(bracket.max, bracket.min);
  }

  if (filters.region) {
    sql += ` AND (rs.region=? OR rs.region='Pan-India')`;
    args.push(filters.region);
  }

  if (filters.q) {
    sql += ` AND (lower(r.name) LIKE ? OR lower(r.description) LIKE ?)`;
    const q = `%${normalizeKey(filters.q)}%`;
    args.push(q, q);
  }

  sql += ` ORDER BY r.score DESC, r.name LIMIT 10`;

  const { results } = await env.DB.prepare(sql).bind(...args).all();

  return {
    source: "d1_catalogue",
    web_search_performed: false,
    recipes: results
  };
}
