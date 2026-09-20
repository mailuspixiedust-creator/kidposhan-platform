/* KidPoshan Product Intelligence Engine — Diagnostic v2
 *
 * Gemini is used only for discovery/extraction. The deterministic KidPoshan
 * scoring engine remains a separate layer and is intentionally not invoked here.
 *
 * This module deliberately never returns the Gemini API key.
 */

const GEMINI_DEFAULT_MODEL = 'gemini-3.8-flash';

const PRODUCT_SCHEMA = {
  type: 'object',
  properties: {
    products: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          brand: { type: 'string' },
          product_type: { type: 'string' },
          ingredient_match: { type: 'string' },
          ingredients: { type: 'string' },
          nutrition_per_100g: {
            type: 'object',
            properties: {
              energy_kcal: { type: ['number', 'null'] },
              protein_g: { type: ['number', 'null'] },
              carbohydrate_g: { type: ['number', 'null'] },
              total_sugars_g: { type: ['number', 'null'] },
              added_sugars_g: { type: ['number', 'null'] },
              fibre_g: { type: ['number', 'null'] },
              total_fat_g: { type: ['number', 'null'] },
              saturated_fat_g: { type: ['number', 'null'] },
              sodium_mg: { type: ['number', 'null'] }
            },
            required: [
              'energy_kcal', 'protein_g', 'carbohydrate_g', 'total_sugars_g',
              'added_sugars_g', 'fibre_g', 'total_fat_g', 'saturated_fat_g', 'sodium_mg'
            ]
          },
          pack_size: { type: ['string', 'null'] },
          price: { type: ['number', 'null'] },
          currency: { type: ['string', 'null'] },
          source_urls: { type: 'array', items: { type: 'string' } },
          source_notes: { type: 'array', items: { type: 'string' } },
          facts_verified: { type: 'boolean' },
          missing_facts: { type: 'array', items: { type: 'string' } }
        },
        required: [
          'name', 'brand', 'product_type', 'ingredient_match', 'ingredients',
          'nutrition_per_100g', 'pack_size', 'price', 'currency',
          'source_urls', 'source_notes', 'facts_verified', 'missing_facts'
        ]
      }
    }
  },
  required: ['products']
};

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function error(code, message, extra = {}) {
  const e = new Error(message);
  e.code = code;
  Object.assign(e, extra);
  return e;
}

function extractInteractionText(data) {
  if (typeof data?.output_text === 'string') return data.output_text;
  if (Array.isArray(data?.outputs)) {
    for (const item of data.outputs) {
      if (typeof item?.text === 'string') return item.text;
      if (Array.isArray(item?.content)) {
        for (const c of item.content) {
          if (typeof c?.text === 'string') return c.text;
        }
      }
    }
  }
  if (Array.isArray(data?.output)) {
    for (const item of data.output) {
      if (typeof item?.text === 'string') return item.text;
      if (Array.isArray(item?.content)) {
        for (const c of item.content) {
          if (typeof c?.text === 'string') return c.text;
        }
      }
    }
  }
  return '';
}

function parseJsonText(text) {
  const raw = clean(text);
  if (!raw) throw error('GEMINI_EMPTY_RESPONSE', 'Gemini returned an empty response.');
  try { return JSON.parse(raw); } catch {}
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) {
    try { return JSON.parse(fenced[1]); } catch {}
  }
  throw error('GEMINI_INVALID_JSON', 'Gemini returned a response that was not valid JSON.');
}

async function callGemini(env, prompt) {
  const key = clean(env?.GEMINI_API_KEY);
  if (!key) {
    throw error(
      'SECRET_MISSING',
      'SECRET_MISSING: GEMINI_API_KEY is visible in Cloudflare Settings but is not reaching the active Worker runtime.'
    );
  }

  const model = clean(env?.GEMINI_MODEL) || GEMINI_DEFAULT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/interactions`;
  const body = {
    model,
    input: prompt,
    tools: [
      { type: 'google_search' },
      { type: 'url_context' }
    ],
    response_format: {
      type: 'text',
      mime_type: 'application/json',
      schema: PRODUCT_SCHEMA
    }
  };

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'x-goog-api-key': key,
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    });
  } catch (e) {
    throw error('GEMINI_NETWORK_ERROR', `Gemini network request failed: ${e?.message || e}`);
  }

  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch {}

  if (!response.ok) {
    const providerMessage = data?.error?.message || raw.slice(0, 500) || 'Unknown Gemini error';
    const code = response.status === 401 || response.status === 403
      ? 'GEMINI_AUTH_FAILED'
      : response.status === 404
        ? 'GEMINI_MODEL_OR_ENDPOINT_ERROR'
        : response.status === 429
          ? 'GEMINI_RATE_LIMITED'
          : 'GEMINI_API_ERROR';
    throw error(`${code}: ${providerMessage}`.slice(0, 900), `${code}: ${providerMessage}`, { status: response.status });
  }

  const text = extractInteractionText(data);
  return { model, data, text };
}

function promptForResearch({ query, age, meal, season, preference }) {
  return `You are the KidPoshan Product Intelligence research layer.

User request: ${query || 'food product'}
Child age: ${age ?? 'not specified'}
Part of day: ${meal || 'not specified'}
Season: ${season || 'not specified'}
Food preference: ${preference || 'not specified'}

Research current packaged-food products available in India that genuinely match the request.

Rules:
1. Use Google Search and URL Context to find current, verifiable product information.
2. Prefer manufacturer/brand pages and authoritative product-data sources. Retailer pages may be used for current pack size/price when needed.
3. Identify the exact product/SKU and brand.
4. Extract the ingredient list and nutrition facts only when the source supports them.
5. Normalize nutrition values to per 100 g where the source provides enough information to do so. If a value cannot be verified, return null and list it in missing_facts.
6. Never invent nutrition, ingredient, price, pack size, or source information.
7. Include source URLs and short source notes for every product.
8. Do NOT calculate or estimate a KidPoshan Score. That is a separate deterministic engine.
9. Return candidates even when some facts are missing, but set facts_verified=false and list the missing facts.
10. Prefer products that are actually relevant to the user's requested food rather than generic children's foods.
11. Return up to 12 useful products.
`;
}

export async function researchProducts(env, input = {}) {
  const query = clean(input.query);
  const age = input.age == null || input.age === '' ? null : Number(input.age);
  const meal = clean(input.meal);
  const season = clean(input.season);
  const preference = clean(input.preference);

  if (!query) throw error('QUERY_MISSING', 'Please enter what you are looking for.');
  if (age !== null && !Number.isFinite(age)) throw error('AGE_INVALID', 'Child age must be a number.');

  const prompt = promptForResearch({ query, age, meal, season, preference });
  const { model, text, data } = await callGemini(env, prompt);
  const parsed = parseJsonText(text);
  const products = Array.isArray(parsed?.products) ? parsed.products : [];

  return {
    ok: true,
    provider: 'gemini',
    model,
    query,
    products,
    count: products.length,
    diagnostic: {
      secret_present: true,
      api_response_received: true,
      response_id: data?.id || data?.interaction?.id || null
    }
  };
}

export function geminiRuntimeStatus(env) {
  const present = typeof env?.GEMINI_API_KEY === 'string' && env.GEMINI_API_KEY.trim().length > 0;
  return {
    provider: 'gemini',
    model: clean(env?.GEMINI_MODEL) || GEMINI_DEFAULT_MODEL,
    secret_present: present
  };
}
