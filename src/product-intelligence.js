import { searchWeb } from './web-search.js';

function clean(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function arr(v) {
  return Array.isArray(v) ? v : [];
}

function normalizeText(v) {
  return clean(v)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function brandName(brand) {
  if (typeof brand === 'string') return clean(brand);
  if (brand && typeof brand === 'object') return clean(brand.name);
  return '';
}

function firstValue(...values) {
  for (const value of values) {
    const v = clean(value);
    if (v) return v;
  }
  return '';
}

function extractProductObjects(value, out = []) {
  if (!value) return out;

  if (Array.isArray(value)) {
    for (const item of value) {
      extractProductObjects(item, out);
    }
    return out;
  }

  if (typeof value !== 'object') return out;

  const type = value['@type'];

  if (
    type === 'Product' ||
    (Array.isArray(type) && type.includes('Product'))
  ) {
    out.push(value);
  }

  if (value['@graph']) {
    extractProductObjects(value['@graph'], out);
  }

  if (value.mainEntity) {
    extractProductObjects(value.mainEntity, out);
  }

  if (value.itemListElement) {
    extractProductObjects(value.itemListElement, out);
  }

  return out;
}

function parseJsonLd(html) {
  const products = [];
  const regex =
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  let match;

  while ((match = regex.exec(html))) {
    let text = match[1]
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();

    if (!text) continue;

    try {
      const parsed = JSON.parse(text);
      extractProductObjects(parsed, products);
    } catch {
      // Some sites contain malformed JSON-LD. Ignore that block.
    }
  }

  return products;
}

function extractMeta(html, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`,
      'i'
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`,
      'i'
    )
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return clean(match[1]);
  }

  return '';
}

function stripHtml(html) {
  return clean(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/\s+/g, ' ')
  );
}

function extractLabeled(text, labels) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const patterns = [
      new RegExp(
        `${escaped}\\s*[:#-]\\s*([^|;,]{2,100})`,
        'i'
      ),
      new RegExp(
        `${escaped}\\s+([^|;,]{2,100})`,
        'i'
      )
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) {
        return clean(match[1]);
      }
    }
  }

  return '';
}

function extractPackSize(text, name = '') {
  const source = `${name} ${text}`;

  const match = source.match(
    /\b(\d+(?:\.\d+)?)\s*(kg|g|mg|ml|l|litre|liter|litres|liters)\b/i
  );

  if (!match) {
    return {
      value: '',
      unit: ''
    };
  }

  return {
    value: match[1],
    unit: match[2].toLowerCase()
  };
}

function extractIngredients(text) {
  const match = text.match(
    /ingredients?\s*[:\-]\s*([^]{0,1500})/i
  );

  if (!match?.[1]) return [];

  return match[1]
    .split(/[.;]\s+/)
    .map(x => clean(x))
    .filter(Boolean)
    .slice(0, 100);
}

function extractNutrition(text) {
  const nutrition = {
    serving_size: '',
    energy_kcal: '',
    protein_g: '',
    carbohydrate_g: '',
    sugars_g: '',
    added_sugars_g: '',
    fat_g: '',
    saturated_fat_g: '',
    fibre_g: '',
    sodium_mg: ''
  };

  const patterns = {
    serving_size: [
      /serving\s*size\s*[:\-]\s*([^|;,]{1,80})/i
    ],
    energy_kcal: [
      /energy\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*kcal/i
    ],
    protein_g: [
      /protein\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*g/i
    ],
    carbohydrate_g: [
      /(?:carbohydrate|carbohydrates)\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*g/i
    ],
    sugars_g: [
      /(?:total\s*)?sugars?\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*g/i
    ],
    added_sugars_g: [
      /added\s+sugars?\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*g/i
    ],
    fat_g: [
      /(?:total\s*)?fat\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*g/i
    ],
    saturated_fat_g: [
      /saturated\s+fat\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*g/i
    ],
    fibre_g: [
      /(?:dietary\s+)?f(?:i|l)bre\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*g/i
    ],
    sodium_mg: [
      /sodium\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*mg/i
    ]
  };

  for (const [field, regexes] of Object.entries(patterns)) {
    for (const regex of regexes) {
      const match = text.match(regex);
      if (match?.[1]) {
        nutrition[field] = clean(match[1]);
        break;
      }
    }
  }

  return nutrition;
}

function getIdentifier(product) {
  const sku = clean(product?.sku);

  if (sku) {
    return {
      value: sku,
      type: 'sku'
    };
  }

  const mpn = clean(product?.mpn);

  if (mpn) {
    return {
      value: mpn,
      type: 'mpn'
    };
  }

  const gtin = firstValue(
    product?.gtin,
    product?.gtin8,
    product?.gtin12,
    product?.gtin13,
    product?.gtin14
  );

  if (gtin) {
    return {
      value: gtin,
      type: 'gtin'
    };
  }

  return {
    value: '',
    type: ''
  };
}

async function fetchPage(url) {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; KidPoshanProductResearch/1.0)',
        'Accept':
          'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8'
      },
      redirect: 'follow'
    });

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        html: ''
      };
    }

    const html = await response.text();

    return {
      ok: true,
      status: response.status,
      html
    };
  } catch {
    return {
      ok: false,
      status: 0,
      html: ''
    };
  }
}

function productFromPage(result, page) {
  const html = page.html || '';
  const text = stripHtml(html);
  const jsonProducts = parseJsonLd(html);

  let product = jsonProducts[0] || {};

  const name = firstValue(
    product.name,
    extractMeta(html, 'og:title'),
    extractMeta(html, 'twitter:title'),
    result.title
  );

  const brand = firstValue(
    brandName(product.brand),
    extractMeta(html, 'product:brand'),
    extractLabeled(text, ['Brand', 'Brand Name'])
  );

  const identifier = getIdentifier(product);

  const sku = identifier.type === 'sku'
    ? identifier.value
    : '';

  const pack = extractPackSize(
    `${product.description || ''} ${text}`,
    name
  );

  const ingredients = extractIngredients(
    `${product.description || ''} ${text}`
  );

  const nutrition = extractNutrition(text);

  const category = firstValue(
    product.category,
    extractLabeled(text, ['Category', 'Product Category'])
  );

  const productUrl = firstValue(
    product.url,
    result.url
  );

  const productKeyBrand = normalizeText(brand);
  const productKeyIdentifier = normalizeText(
    identifier.value
  );

  const productKey =
    productKeyBrand && productKeyIdentifier
      ? `${productKeyBrand}|${productKeyIdentifier}`
      : '';

  const identityStatus =
    brand && identifier.value
      ? 'verified'
      : 'unverified';

  return {
    name,
    brand,
    sku,
    pack_size: pack.value
      ? `${pack.value} ${pack.unit}`
      : '',
    category,
    ingredients,
    nutrition,
    source_urls: [productUrl].filter(Boolean),
    source_notes: [
      identifier.type
        ? `Product identifier extracted from page structured data: ${identifier.type}.`
        : 'No explicit SKU, MPN or GTIN found on the page.',
      jsonProducts.length
        ? 'Product structured data found on page.'
        : 'No Product JSON-LD found; fallback page metadata/text extraction used.'
    ],
    verification_status:
      identityStatus === 'verified'
        ? 'verified'
        : 'partially_verified',
    product_key: productKey,
    identifier_type: identifier.type,
    identifier_value: identifier.value,
    product_url: productUrl,
    kidposhan_score: null
  };
}

function productFromTavilyResult(result) {
  const raw = result.raw_content || result.snippet || '';
  const text = clean(raw);

  const name = clean(result.title);

  const brand = extractLabeled(text, [
    'Brand',
    'Brand Name',
    'Manufacturer Brand'
  ]);

  const identifier = extractLabeled(text, [
    'SKU',
    'Product SKU',
    'MPN',
    'Model Number',
    'GTIN',
    'EAN',
    'UPC'
  ]);

  const identifierType = /sku/i.test(identifier)
    ? 'sku'
    : '';

  const pack = extractPackSize(text, name);

  const productKey =
    brand && identifier
      ? `${normalizeText(brand)}|${normalizeText(identifier)}`
      : '';

  return {
    name,
    brand,
    sku: identifierType === 'sku' ? identifier : '',
    pack_size: pack.value
      ? `${pack.value} ${pack.unit}`
      : '',
    category: '',
    ingredients: extractIngredients(text),
    nutrition: extractNutrition(text),
    source_urls: [result.url].filter(Boolean),
    source_notes: [
      'Fallback extraction from Tavily indexed page content.'
    ],
    verification_status:
      brand && identifier
        ? 'partially_verified'
        : 'insufficient',
    product_key: productKey,
    identifier_type: identifierType,
    identifier_value: identifier,
    product_url: result.url,
    kidposhan_score: null
  };
}

function dedupeProducts(products) {
  const map = new Map();

  for (const product of products) {
    const key =
      product.product_key ||
      `${normalizeText(product.brand)}|${normalizeText(product.name)}|${product.product_url}`;

    if (!key || key === '||') continue;

    const existing = map.get(key);

    if (!existing) {
      map.set(key, product);
      continue;
    }

    // Prefer the record with a verified identity.
    if (
      product.verification_status === 'verified' &&
      existing.verification_status !== 'verified'
    ) {
      map.set(key, product);
    }
  }

  return [...map.values()];
}

export async function researchProducts(env, input = {}) {
  const query = clean(input?.query) || 'packaged food for children';

  const search = await searchWeb(env, query, {
    search_depth: 'advanced',
    topic: 'general',
    max_results: input?.max_results
      ? Number(input.max_results)
      : 8
  });

  const candidates = arr(search.results)
    .filter(result => clean(result.url))
    .slice(0, 8);

  const fetched = await Promise.all(
    candidates.map(async result => ({
      result,
      page: await fetchPage(result.url)
    }))
  );

  const products = [];

  for (const item of fetched) {
    if (item.page.ok && item.page.html) {
      const product = productFromPage(
        item.result,
        item.page
      );

      if (product.name) {
        products.push(product);
        continue;
      }
    }

    const fallback = productFromTavilyResult(
      item.result
    );

    if (fallback.name) {
      products.push(fallback);
    }
  }

  const uniqueProducts = dedupeProducts(products);

  return {
    ok: true,
    provider: 'tavily-page-extractor',
    model: 'deterministic',
    query,
    research_notes: [
      'Products are discovered using Tavily.',
      'Product pages are fetched directly by the Cloudflare Worker.',
      'Structured Product data is preferred when published by the page.',
      'No SKU, MPN or GTIN is invented when the page does not provide one.',
      'Product identity is based on Brand + explicit product identifier.',
      'Manufacturing location is not part of product identity.'
    ],
    products: uniqueProducts,
    citations: candidates.map(result => ({
      url: result.url,
      title: result.title || ''
    })),
    score_status: 'not_scored',
    score_message:
      'Products are extracted without inventing a KidPoshan Score.'
  };
}

export function geminiRuntimeStatus() {
  return {
    provider: 'tavily-page-extractor',
    model: 'deterministic',
    secret_present: false
  };
}