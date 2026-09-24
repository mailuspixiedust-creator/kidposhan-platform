import { searchWeb } from './web-search.js';

function clean(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeIngredient(value) {
  return clean(value)
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(
      /\b(boiled|mashed|grated|chopped|finely|roughly|sliced|diced|crushed|peeled|washed)\b/g,
      ' '
    )
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function retailerFromUrl(url) {
  try {
    const host = new URL(url)
      .hostname
      .replace(/^www\./, '')
      .toLowerCase();

    if (
      host === 'blinkit.com' ||
      host.endsWith('.blinkit.com')
    ) {
      return {
        name: 'Blinkit',
        type: 'quick_commerce'
      };
    }

    if (
      host === 'zepto.com' ||
      host.endsWith('.zepto.com')
    ) {
      return {
        name: 'Zepto',
        type: 'quick_commerce'
      };
    }

    if (
      host === 'bigbasket.com' ||
      host.endsWith('.bigbasket.com')
    ) {
      return {
        name: 'BigBasket',
        type: 'grocery'
      };
    }

    if (
      host === 'swiggy.com' ||
      host.endsWith('.swiggy.com')
    ) {
      return {
        name: 'Swiggy Instamart',
        type: 'quick_commerce'
      };
    }

    if (
      host === 'amazon.in' ||
      host.endsWith('.amazon.in')
    ) {
      return {
        name: 'Amazon',
        type: 'marketplace'
      };
    }

    if (
      host === 'flipkart.com' ||
      host.endsWith('.flipkart.com')
    ) {
      return {
        name: 'Flipkart',
        type: 'marketplace'
      };
    }

    return null;
  } catch {
    return null;
  }
}

function extractMeta(html, name) {
  const escaped = name.replace(
    /[.*+?^${}()|[\]\\]/g,
    '\\$&'
  );

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

  for (const re of patterns) {
    const match = re.exec(html);

    if (match?.[1]) {
      return clean(match[1]);
    }
  }

  return '';
}

function stripHtml(html) {
  return clean(
    String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&#8377;/gi, '₹')
  );
}

function extractJsonLd(html) {
  const objects = [];

  const matches =
    String(html || '').match(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi
    ) || [];

  for (const block of matches) {
    const body = block
      .replace(/^.*?>/s, '')
      .replace(/<\/script>$/i, '')
      .trim();

    try {
      const parsed = JSON.parse(body);

      if (Array.isArray(parsed)) {
        objects.push(...parsed);
      } else if (parsed && typeof parsed === 'object') {
        objects.push(parsed);
      }
    } catch {
      // Ignore malformed JSON-LD.
    }
  }

  return objects;
}

function findProductJsonLd(objects) {
  for (const obj of objects) {
    if (!obj || typeof obj !== 'object') {
      continue;
    }

    const type = obj['@type'];

    if (
      type === 'Product' ||
      (Array.isArray(type) && type.includes('Product'))
    ) {
      return obj;
    }

    if (Array.isArray(obj['@graph'])) {
      const found = findProductJsonLd(obj['@graph']);

      if (found) {
        return found;
      }
    }
  }

  return null;
}

function extractPrice(product, html, text) {
  const offers = product?.offers;

  if (offers) {
    const offer = Array.isArray(offers)
      ? offers[0]
      : offers;

    const rawPrice =
      offer?.price ??
      offer?.lowPrice ??
      offer?.highPrice ??
      '';

    const price = Number(
      String(rawPrice).replace(/,/g, '')
    );

    if (
      Number.isFinite(price) &&
      price > 0
    ) {
      return price;
    }
  }

  const metaPrice =
    extractMeta(
      html,
      'product:price:amount'
    ) ||
    extractMeta(
      html,
      'og:price:amount'
    );

  const metaNumber = Number(
    String(metaPrice).replace(/,/g, '')
  );

  if (
    Number.isFinite(metaNumber) &&
    metaNumber > 0
  ) {
    return metaNumber;
  }

  const priceMatch = text.match(
    /(?:₹|Rs\.?|INR)\s*([0-9]+(?:\.[0-9]{1,2})?)/i
  );

  if (priceMatch) {
    const price = Number(priceMatch[1]);

    if (
      Number.isFinite(price) &&
      price > 0
    ) {
      return price;
    }
  }

  return null;
}

function extractUnit(text, name) {
  const source = `${name} ${text}`;

  const patterns = [
    {
      re: /(\d+(?:\.\d+)?)\s*(kg|kilogram|kilograms)\b/i,
      unit: 'kg'
    },
    {
      re: /(\d+(?:\.\d+)?)\s*(g|gram|grams)\b/i,
      unit: 'g'
    },
    {
      re: /(\d+(?:\.\d+)?)\s*(l|litre|liter|litres|liters)\b/i,
      unit: 'L'
    },
    {
      re: /(\d+(?:\.\d+)?)\s*(ml|millilitre|milliliter|millilitres|milliliters)\b/i,
      unit: 'ml'
    },
    {
      re: /(\d+)\s*(pcs|pc|pieces)\b/i,
      unit: 'pcs'
    }
  ];

  for (const pattern of patterns) {
    const match = pattern.re.exec(source);

    if (match) {
      return {
        value: Number(match[1]),
        unit: pattern.unit,
        label: `${match[1]} ${pattern.unit}`
      };
    }
  }

  return {
    value: null,
    unit: null,
    label: ''
  };
}

function extractImage(product, html) {
  const image = product?.image;

  if (
    typeof image === 'string' &&
    image.trim()
  ) {
    return image.trim();
  }

  if (Array.isArray(image)) {
    for (const item of image) {
      if (
        typeof item === 'string' &&
        item.trim()
      ) {
        return item.trim();
      }

      if (
        item &&
        typeof item === 'object'
      ) {
        const url = clean(
          item.url ||
          item.contentUrl
        );

        if (url) {
          return url;
        }
      }
    }
  }

  if (
    image &&
    typeof image === 'object'
  ) {
    const url = clean(
      image.url ||
      image.contentUrl
    );

    if (url) {
      return url;
    }
  }

  return (
    extractMeta(html, 'og:image') ||
    extractMeta(html, 'twitter:image') ||
    ''
  );
}

/*
 * IMPORTANT:
 *
 * A pincode appearing anywhere on a page is NOT evidence
 * of delivery availability.
 *
 * For example:
 *
 * 700078 as a product part number
 * 700078 inside an unrelated address
 *
 * must NOT become an availability verification.
 *
 * We therefore only accept explicit delivery/serviceability
 * language around the requested pincode.
 */
function locationEvidence(text, location) {
  const pincode = clean(location);

  if (!pincode) {
    return {
      verified: false,
      evidence: ''
    };
  }

  const source = String(text || '');
  const lower = source.toLowerCase();
  const pin = pincode.toLowerCase();

  const patterns = [
    `deliver to ${pin}`,
    `delivery to ${pin}`,
    `deliverable to ${pin}`,
    `delivery available in ${pin}`,
    `delivery available for ${pin}`,
    `available for delivery to ${pin}`,
    `available in ${pin}`,
    `serves ${pin}`,
    `serviceable ${pin}`,
    `serviceable for ${pin}`,
    `pincode ${pin}`,
    `pin code ${pin}`
  ];

  for (const pattern of patterns) {
    const index = lower.indexOf(pattern);

    if (index >= 0) {
      return {
        verified: true,
        evidence: source.slice(
          Math.max(0, index - 180),
          Math.min(
            source.length,
            index + pattern.length + 300
          )
        )
      };
    }
  }

  return {
    verified: false,
    evidence: ''
  };
}

function ingredientMatches(
  ingredient,
  productName,
  text
) {
  const words = normalizeIngredient(
    ingredient
  )
    .split(' ')
    .filter(Boolean);

  if (!words.length) {
    return false;
  }

  const productText =
    normalizeIngredient(productName);

  /*
   * For raw ingredients, require the actual
   * product/listing name to contain the ingredient.
   *
   * This is much safer than accepting a page merely
   * because the ingredient appears somewhere in its
   * unrelated body text.
   */
  const productMatches =
    words.every(word =>
      productText.includes(word)
    );

  if (productMatches) {
    return true;
  }

  /*
   * Fallback for retailers whose structured product
   * name is incomplete but page title/content clearly
   * identifies the ingredient.
   */
  const pageText =
    normalizeIngredient(
      `${productName} ${text.slice(0, 5000)}`
    );

  return words.every(word =>
    pageText.includes(word)
  );
}

async function targetedIngredientSearches(
  env,
  ingredient,
  location
) {
  const searches = [
    {
      query: `site:blinkit.com ${ingredient} ${location}`,
      domains: ['blinkit.com']
    },
    {
      query: `site:zepto.com ${ingredient} ${location}`,
      domains: ['zepto.com']
    },
    {
      query: `site:bigbasket.com ${ingredient} ${location}`,
      domains: ['bigbasket.com']
    },
    {
      query: `site:swiggy.com/instamart ${ingredient} ${location}`,
      domains: ['swiggy.com']
    },
    {
      query: `site:amazon.in ${ingredient} ${location}`,
      domains: ['amazon.in']
    },
    {
      query: `site:flipkart.com ${ingredient} ${location}`,
      domains: ['flipkart.com']
    }
  ];

  const results = [];

  for (const search of searches) {
    try {
      const result = await searchWeb(
        env,
        search.query,
        {
          search_depth: 'advanced',
          topic: 'general',
          max_results: 6,
          include_domains: search.domains
        }
      );

      for (
        const item of result.results || []
      ) {
        if (item?.url) {
          results.push(item);
        }
      }
    } catch {
      /*
       * One retailer failing must not stop
       * the other retailer searches.
       */
    }
  }

  const unique = new Map();

  for (const item of results) {
    if (!unique.has(item.url)) {
      unique.set(item.url, item);
    }
  }

  return [...unique.values()];
}

async function fetchPage(url) {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; KidPoshanIngredientResearch/1.0)',
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

function extractOffer(
  result,
  page,
  ingredient,
  location
) {
  const html = page.html || '';
  const text = stripHtml(html);

  /*
   * Only approved consumer retailers can
   * become ingredient offers.
   */
  const retailer = retailerFromUrl(
    result.url
  );

  if (!retailer) {
    return null;
  }

  const jsonLdObjects =
    extractJsonLd(html);

  const product =
    findProductJsonLd(
      jsonLdObjects
    ) || {};

  const productName = clean(
    product.name ||
    extractMeta(html, 'og:title') ||
    extractMeta(html, 'twitter:title') ||
    result.title
  );

  if (!productName) {
    return null;
  }

  /*
   * Reject unrelated pages.
   *
   * Example:
   * ingredient = carrot
   * page = car accessory
   *
   * The page must actually identify the requested
   * ingredient/product.
   */
  if (
    !ingredientMatches(
      ingredient,
      productName,
      text
    )
  ) {
    return null;
  }

  const imageUrl =
    extractImage(
      product,
      html
    );

  const price =
    extractPrice(
      product,
      html,
      text
    );

  const unitInfo =
    extractUnit(
      text,
      productName
    );

  /*
   * Exact pincode verification.
   *
   * If the retailer page does not explicitly
   * demonstrate serviceability for this pincode,
   * the offer is rejected.
   */
  const locationCheck =
    locationEvidence(
      text,
      location
    );

  if (!locationCheck.verified) {
    return null;
  }

  return {
    ingredient_key:
      normalizeIngredient(
        ingredient
      ),

    ingredient_name:
      clean(ingredient),

    product_name:
      productName,

    retailer_name:
      retailer.name,

    retailer_type:
      retailer.type,

    url:
      result.url,

    affiliate_url:
      null,

    image_url:
      imageUrl || null,

    price,

    currency:
      'INR',

    unit_value:
      unitInfo.value,

    unit:
      unitInfo.unit,

    unit_label:
      unitInfo.label,

    availability_status:
      'available',

    location:
      clean(location),

    source_url:
      result.url,

    evidence_text:
      locationCheck.evidence,

    checked_at:
      Date.now()
  };
}

export async function researchIngredientOffers(
  env,
  input = {}
) {
  const ingredient =
    clean(input.ingredient);

  const location =
    clean(
      input.location ||
      input.pincode
    );

  if (!ingredient) {
    throw new Error(
      'Missing ingredient.'
    );
  }

  if (!location) {
    throw new Error(
      'Missing location/pincode.'
    );
  }

  const candidates =
    await targetedIngredientSearches(
      env,
      ingredient,
      location
    );

  const fetched =
    await Promise.all(
      candidates
        .slice(0, 30)
        .map(async result => ({
          result,
          page:
            await fetchPage(
              result.url
            )
        }))
    );

  const offers = [];

  for (const item of fetched) {
    if (
      !item.page.ok ||
      !item.page.html
    ) {
      continue;
    }

    const offer =
      extractOffer(
        item.result,
        item.page,
        ingredient,
        location
      );

    if (offer) {
      offers.push(offer);
    }
  }

  /*
   * Deduplicate the same retailer/product/location.
   */
  const unique =
    new Map();

  for (const offer of offers) {
    const key = [
      offer.ingredient_key,
      offer.retailer_name,
      offer.product_name,
      offer.url,
      offer.location
    ].join('|');

    if (!unique.has(key)) {
      unique.set(
        key,
        offer
      );
    }
  }

  return {
    ok: true,

    provider:
      'tavily-page-extractor',

    model:
      'deterministic',

    ingredient,

    ingredient_key:
      normalizeIngredient(
        ingredient
      ),

    location,

    candidates_checked:
      candidates.length,

    offers:
      [...unique.values()]
  };
}