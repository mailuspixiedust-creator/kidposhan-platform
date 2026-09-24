import { searchWeb } from './web-search.js';

function clean(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function normalizeText(v) {
  return clean(v).toLowerCase().replace(/\s+/g, ' ').trim();
}

function firstValue(...values) {
  for (const value of values) {
    const v = clean(value);
    if (v) return v;
  }
  return '';
}

function brandName(brand) {
  if (typeof brand === 'string') return clean(brand);
  if (brand && typeof brand === 'object') return clean(brand.name);
  return '';
}

function extractProductObjects(value, out = []) {
  if (!value) return out;

  if (Array.isArray(value)) {
    for (const item of value) extractProductObjects(item, out);
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

  if (value['@graph']) extractProductObjects(value['@graph'], out);
  if (value.mainEntity) extractProductObjects(value.mainEntity, out);
  if (value.itemListElement) extractProductObjects(value.itemListElement, out);

  return out;
}

function parseJsonLd(html) {
  const products = [];

  const regex =
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  let match;

  while ((match = regex.exec(html))) {
    let jsonText = match[1]
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();

    if (!jsonText) continue;

    try {
      const parsed = JSON.parse(jsonText);
      extractProductObjects(parsed, products);
    } catch {
      // Ignore malformed JSON-LD
    }
  }

  return products;
}

function extractMeta(html, property) {
function extractImageUrl(product, html) {
  const image = product?.image;

  if (typeof image === 'string' && image.trim()) {
    return image.trim();
  }

  if (Array.isArray(image) && image.length > 0) {
    const first = image[0];

    if (typeof first === 'string' && first.trim()) {
      return first.trim();
    }

    if (first && typeof first === 'object' && first.url) {
      return clean(first.url);
    }
  }

  if (image && typeof image === 'object' && image.url) {
    return clean(image.url);
  }

  return extractMeta(html, 'og:image');
}
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

/*
 * Remove scripts, styles, forms, SVGs and obvious UI junk.
 * This prevents things like "I am interested..." from becoming
 * ingredient/product text.
 */
function stripHtml(html) {
  return clean(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<form[\s\S]*?<\/form>/gi, ' ')
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<button[\s\S]*?<\/button>/gi, ' ')
      .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&#39;/gi, "'")
      .replace(/&quot;/gi, '"')
      .replace(/\s+/g, ' ')
  );
}

function extractPackSize(text, name = '') {
  const source = `${name} ${text}`;

  const match = source.match(
    /\b(\d+(?:\.\d+)?)\s*(kg|g|mg|ml|l|litre|liter|litres|liters)\b/i
  );

  if (!match) return { value: '', unit: '' };

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
      /carbohydrate[s]?\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*g/i
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

/*
 * Trade / B2B pages must never become consumer products.
 */
function isTradePage(url = '', title = '', text = '') {
  const source = `${url} ${title} ${text}`.toLowerCase();

  const tradeTerms = [
    'manufacturer',
    'manufacturers',
    'wholesaler',
    'wholesalers',
    'supplier',
    'suppliers',
    'exporter',
    'exporters',
    'bulk order',
    'bulk orders',
    'india mart',
    'indiamart',
    'tradeindia',
    'directory',
    'distributor',
    'distributors',
    'b2b'
  ];

  return tradeTerms.some(term => source.includes(term));
}

/*
 * We want consumer retail / brand sources.
 */
function isPreferredRetailSource(url = '') {
  const host = (() => {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return '';
    }
  })();

  const preferred = [
    'amazon.in',
    'blinkit.com',
    'zepto.com',
    'bigbasket.com',
    'flipkart.com',
    'swiggy.com',
    'instamart',
    'jiomart.com',
    'dmart.in',
    'naturebasket.co.in',
    'tataconsumer.com',
    'slurrpfarm.com',
    '24mantra.com',
    'organictattva.com'
  ];

  return preferred.some(domain => host === domain || host.endsWith(`.${domain}`));
}

async function fetchPage(url) {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; KidPoshanProductResearch/1.0)',
        Accept:
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

    return {
      ok: true,
      status: response.status,
      html: await response.text()
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

  if (isTradePage(result.url, result.title, text)) {
    return null;
  }

  const jsonProducts = parseJsonLd(html);
  const product = jsonProducts[0] || {};

  const name = firstValue(
    product.name,
    extractMeta(html, 'og:title'),
    extractMeta(html, 'twitter:title'),
    result.title
  );

  const brand = firstValue(
    brandName(product.brand),
    extractMeta(html, 'product:brand')
  );

  const identifier = getIdentifier(product);
const imageUrl = extractImageUrl(product, html);

  /*
   * STRICT IDENTITY RULE:
   * No explicit identifier = no product identity.
   */
  if (!brand || !identifier.value) {
    return null;
  }

  const sku =
    identifier.type === 'sku'
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
    product.category
  );

  const productUrl = firstValue(
    product.url,
    result.url
  );

  const productKey =
    `${normalizeText(brand)}|${normalizeText(identifier.value)}`;

  return {
    name,
    brand,
    sku,
  image_url: imageUrl,
    pack_size: pack.value
      ? `${pack.value} ${pack.unit}`
      : '',
    category,
    ingredients,
    nutrition,
    source_urls: [productUrl].filter(Boolean),
    source_notes: [
      `Explicit product identifier extracted from page structured data: ${identifier.type}.`,
      'Consumer product page passed trade-page filtering.',
      jsonProducts.length
        ? 'Product structured data found on page.'
        : 'Product metadata/text extraction used.'
    ],
    verification_status: 'verified',
    product_key: productKey,
    identifier_type: identifier.type,
    identifier_value: identifier.value,
    product_url: productUrl,
    kidposhan_score: null
  };
}

function dedupeProducts(products) {
  const map = new Map();

  for (const product of products) {
    if (!product?.product_key) continue;

    const existing = map.get(product.product_key);

    if (!existing) {
      map.set(product.product_key, product);
      continue;
    }

    const existingSources = existing.source_urls || [];
    const newSources = product.source_urls || [];

    existing.source_urls = [
      ...new Set([...existingSources, ...newSources])
    ];
  }

  return [...map.values()];
}

async function runTargetedSearches(env, query) {
  const searches = [
    {
      query: `${query} packaged food brand India`,
      domains: []
    },
    {
      query: `site:amazon.in ${query}`,
      domains: ['amazon.in']
    },
    {
      query: `site:blinkit.com ${query}`,
      domains: ['blinkit.com']
    },
    {
      query: `site:zepto.com ${query}`,
      domains: ['zepto.com']
    },
    {
      query: `site:bigbasket.com ${query}`,
      domains: ['bigbasket.com']
    },
    {
      query: `site:flipkart.com ${query}`,
      domains: ['flipkart.com']
    },
    {
      query: `site:swiggy.com/instamart ${query}`,
      domains: ['swiggy.com']
    }
  ];

  const allResults = [];

  for (const search of searches) {
    try {
      const result = await searchWeb(env, search.query, {
        search_depth: 'advanced',
        topic: 'general',
        max_results: 6,
        include_domains: search.domains
      });

      for (const item of result.results || []) {
        if (item?.url) {
          allResults.push(item);
        }
      }
    } catch {
      // Continue with the other discovery lanes.
    }
  }

  const unique = new Map();

  for (const result of allResults) {
    const key = result.url;

    if (!unique.has(key)) {
      unique.set(key, result);
    }
  }

  return [...unique.values()];
}

export async function researchProducts(env, input = {}) {
  const query =
    clean(input?.query) ||
    'packaged food for children';

  const candidates = await runTargetedSearches(
    env,
    query
  );

  /*
   * Retail/brand sources first.
   */
  candidates.sort((a, b) => {
    const aPreferred = isPreferredRetailSource(a.url) ? 1 : 0;
    const bPreferred = isPreferredRetailSource(b.url) ? 1 : 0;

    return bPreferred - aPreferred;
  });

  const selectedCandidates = candidates
    .filter(result => !isTradePage(result.url, result.title))
    .slice(0, 30);

  const fetched = await Promise.all(
    selectedCandidates.map(async result => ({
      result,
      page: await fetchPage(result.url)
    }))
  );

  const products = [];

  for (const item of fetched) {
    if (!item.page.ok || !item.page.html) continue;

    const product = productFromPage(
      item.result,
      item.page
    );

    if (product) {
      products.push(product);
    }
  }

  const uniqueProducts = dedupeProducts(products);

  return {
    ok: true,
    provider: 'tavily-page-extractor',
    model: 'deterministic',
    query,

    research_notes: [
      'Discovery uses multiple consumer-retail search lanes.',
      'Retail and brand websites are preferred.',
      'Trade, wholesale and manufacturer-directory pages are rejected.',
      'Product pages are fetched directly by the Cloudflare Worker.',
      'Product structured data is preferred.',
      'No SKU, MPN or GTIN is invented.',
      'Product identity requires Brand + explicit product identifier.',
      'Manufacturing location is not part of product identity.',
      'Products without an explicit identifier are not promoted to product identity.'
    ],

    products: uniqueProducts,

    citations: selectedCandidates.map(result => ({
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