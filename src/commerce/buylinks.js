// Buy-link resolver. One place that decides where a "Buy" button goes.
// Today: retailer search deeplinks (referential buys). Later, in this order of preference:
//   live product URL from /api/live-commerce  ->  Cuelinks affiliate URL  ->  search deeplink.
// The frontend never hard-codes retailer or affiliate URLs; it renders what this returns.

export const RETAILERS = [
  { id: 'blinkit',   label: 'Blinkit',   kind: 'qcom',   search: (q) => `https://blinkit.com/s/?q=${q}` },
  { id: 'instamart', label: 'Instamart', kind: 'qcom',   search: (q) => `https://www.swiggy.com/instamart/search?query=${q}` },
  { id: 'zepto',     label: 'Zepto',     kind: 'qcom',   search: (q) => `https://www.zeptonow.com/search?query=${q}` },
  { id: 'bigbasket', label: 'BigBasket', kind: 'grocery',search: (q) => `https://www.bigbasket.com/ps/?q=${q}` },
  { id: 'amazon',    label: 'Amazon',    kind: 'marketplace', search: (q) => `https://www.amazon.in/s?k=${q}` },
];

// Search terms that land on the right product rather than a recipe or a toy.
const SEARCH_OVERRIDES = {
  carrot: 'carrot fresh', potato: 'potato fresh', onion: 'onion fresh', tomato: 'tomato fresh',
  rava: 'sooji rava', poha: 'poha thick', besan: 'besan gram flour', ragi: 'ragi flour',
  moong_dal: 'moong dal yellow', toor_dal: 'toor dal', paneer: 'paneer fresh', curd: 'curd dahi',
  coriander_leaves: 'coriander leaves', curry_leaves: 'curry leaves', green_chilli: 'green chilli',
};

export function searchTerm(key, name) {
  return SEARCH_OVERRIDES[key] || name || (key || '').replace(/_/g, ' ');
}

// Placeholder until Cuelinks is wired: returns null so callers fall back to the plain URL.
// Keep retailer URL and affiliate URL as separate fields (handoff doc, section 15).
export async function resolveAffiliate(env, url) {
  if (!env.CUELINKS_API_KEY) return null;
  // TODO: call Cuelinks link-conversion API server-side and cache the result in D1.
  return null;
}

export async function buyLinksFor(env, { key, name }, { liveOffers = [] } = {}) {
  const q = encodeURIComponent(searchTerm(key, name));
  const out = [];
  for (const r of RETAILERS) {
    const live = liveOffers.find((o) => o.retailer === r.id && o.available);
    const productUrl = live?.product_url || r.search(q);
    out.push({
      retailer: r.id,
      label: r.label,
      kind: r.kind,
      type: live ? 'live_product' : 'search',
      product_url: productUrl,
      affiliate_url: await resolveAffiliate(env, productUrl),
      price: live?.price ?? null,
      unit: live?.unit ?? null,
      eta: live?.eta ?? null,
    });
  }
  return out;
}
