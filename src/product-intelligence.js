const PRODUCT_SCHEMA = {
  type: 'object',
  properties: {
    query: { type: 'string' },
    products: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          brand: { type: 'string' },
          name: { type: 'string' },
          category: { type: 'string' },
          subcategory: { type: 'string' },
          pack_size: { type: ['string', 'null'] },
          gtin: { type: ['string', 'null'] },
          ingredients: { type: 'array', items: { type: 'string' } },
          nutrition_per_100g: {
            type: 'object',
            properties: {
              energy_kcal: { type: ['number', 'null'] },
              protein_g: { type: ['number', 'null'] },
              carbohydrate_g: { type: ['number', 'null'] },
              total_sugars_g: { type: ['number', 'null'] },
              added_sugars_g: { type: ['number', 'null'] },
              total_fat_g: { type: ['number', 'null'] },
              saturated_fat_g: { type: ['number', 'null'] },
              fibre_g: { type: ['number', 'null'] },
              sodium_mg: { type: ['number', 'null'] }
            },
            required: ['energy_kcal','protein_g','carbohydrate_g','total_sugars_g','added_sugars_g','total_fat_g','saturated_fat_g','fibre_g','sodium_mg']
          },
          allergens: { type: 'array', items: { type: 'string' } },
          age_notes: { type: 'string' },
          product_match_confidence: { type: 'string', enum: ['high','medium','low'] },
          evidence_quality: { type: 'string', enum: ['verified','partially_verified','insufficient'] },
          source_urls: { type: 'array', items: { type: 'string' } },
          source_notes: { type: 'array', items: { type: 'string' } }
        },
        required: ['brand','name','category','subcategory','pack_size','gtin','ingredients','nutrition_per_100g','allergens','age_notes','product_match_confidence','evidence_quality','source_urls','source_notes']
      }
    }
  },
  required: ['query','products']
};

function safeText(v) { return typeof v === 'string' ? v.trim() : ''; }

function buildPrompt({ query, age, meal, season, preference }) {
  return `You are the KidPoshan Product Research Agent. Research current packaged-food products relevant to this request: "${safeText(query)}".

Context:
- Child age: ${age || 'not specified'}
- Meal/part of day: ${meal || 'not specified'}
- Season: ${season || 'not specified'}
- Food preference: ${preference || 'not specified'}

Your job is PRODUCT RESEARCH, not health scoring.
1. Use Google Search to discover relevant products available in India.
2. Prefer official manufacturer/brand pages and authoritative product-data sources. Use retailer pages for corroboration and current product identity.
3. Use URL Context to inspect the most relevant product pages you find.
4. Identify the exact product/SKU when possible. Do not merge different pack sizes or formulations into one product.
5. Extract ingredients and nutrition facts only when supported by a source. Never invent missing values. Missing nutrition values must be null.
6. Prefer nutrition values per 100 g where the source provides them. If only another basis is available, preserve the available information in source_notes rather than silently converting it.
7. Record source URLs for every product. Include source notes explaining what was verified.
8. If the evidence is insufficient to identify the product or verify meaningful product facts, set evidence_quality to "insufficient".
9. Do NOT calculate a KidPoshan Score. Do NOT assign Good/Better/Best. That is handled by a separate deterministic KidPoshan scoring engine.
10. Return only products genuinely relevant to the query; avoid generic search-result noise.

Return structured JSON matching the supplied schema.`;
}

async function callGemini(env, prompt) {
  const key = env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not configured in Cloudflare Secrets.');
  const model = env.GEMINI_MODEL || 'gemini-3.8-flash';
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: {
      'x-goog-api-key': key,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model,
      input: prompt,
      tools: [{ type: 'google_search' }, { type: 'url_context' }],
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema: PRODUCT_SCHEMA
      }
    })
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Gemini request failed (${response.status}): ${detail.slice(0,500)}`);
  }
  const data = await response.json();
  const text = data.output_text || '';
  if (!text) throw new Error('Gemini returned no structured output.');
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('Gemini returned invalid JSON.'); }
  return { parsed, raw: data };
}

function normaliseProduct(p) {
  return {
    brand: safeText(p.brand), name: safeText(p.name), category: safeText(p.category), subcategory: safeText(p.subcategory),
    pack_size: p.pack_size ?? null, gtin: p.gtin ?? null,
    ingredients: Array.isArray(p.ingredients) ? p.ingredients.map(safeText).filter(Boolean) : [],
    nutrition_per_100g: p.nutrition_per_100g || {},
    allergens: Array.isArray(p.allergens) ? p.allergens.map(safeText).filter(Boolean) : [],
    age_notes: safeText(p.age_notes),
    product_match_confidence: p.product_match_confidence,
    evidence_quality: p.evidence_quality,
    source_urls: Array.isArray(p.source_urls) ? p.source_urls.map(safeText).filter(Boolean) : [],
    source_notes: Array.isArray(p.source_notes) ? p.source_notes.map(safeText).filter(Boolean) : []
  };
}

export async function researchProducts(env, input) {
  const query = safeText(input.query);
  if (!query) throw new Error('Search query is required.');
  const prompt = buildPrompt(input);
  const result = await callGemini(env, prompt);
  const products = Array.isArray(result.parsed.products) ? result.parsed.products.map(normaliseProduct) : [];
  return { query, products, model: env.GEMINI_MODEL || 'gemini-3.8-flash' };
}
