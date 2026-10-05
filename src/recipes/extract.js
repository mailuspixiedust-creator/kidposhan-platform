// Recipe extraction: JSON-LD -> microdata -> recipe-plugin HTML -> heading heuristic.
// Wording is preserved: we only strip tags, decode entities and collapse whitespace.
// A page without JSON-LD is NOT discarded (registry rule); it falls through to later methods.

import { politeFetch, UA } from './polite.js';
export { UA };

// Every page request goes through politeFetch: robots.txt is obeyed and each site is paced.
export async function fetchHtml(url, env) {
  if (!env?.DB) throw new Error('fetchHtml needs env (for robots.txt cache and pacing)');
  const res = await politeFetch(env, url, {
    headers: { accept: 'text/html,application/xhtml+xml' },
    redirect: 'follow',
    cf: { cacheTtl: 3600 },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get('content-type') || '';
  if (!type.includes('html')) throw new Error(`Not HTML: ${type}`);
  return { html: await res.text(), finalUrl: res.url || url };
}

export function extractFromHtml(html, url) {
  return (
    fromJsonLd(html, url) ||
    fromMicrodata(html, url) ||
    fromPluginHtml(html, url) ||
    fromHeuristic(html, url)
  );
}

// ---------- text helpers ----------
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', frac12: '½', frac14: '¼', frac34: '¾', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', deg: '°', hellip: '…' };
export function decode(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z0-9]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}
export function clean(s) {
  if (s == null) return '';
  return decode(String(s).replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}
function isoMinutes(v) {
  if (!v || typeof v !== 'string') return null;
  const m = v.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/i);
  if (!m) return null;
  const mins = (+m[1] || 0) * 1440 + (+m[2] || 0) * 60 + (+m[3] || 0);
  return mins || null;
}
function firstImage(img) {
  if (!img) return null;
  if (typeof img === 'string') return img;
  if (Array.isArray(img)) return firstImage(img[0]);
  return img.url || img.contentUrl || null;
}
function asArray(v) { return v == null ? [] : Array.isArray(v) ? v : [v]; }
function hasType(node, t) { return asArray(node && node['@type']).some((x) => String(x).toLowerCase() === t); }

function result(base) {
  const ingredients = (base.ingredients || []).map(clean).filter(Boolean);
  const instructions = (base.instructions || []).filter((s) => s.text);
  return {
    name: clean(base.name) || null,
    image_url: base.image_url || null,
    description: clean(base.description) || null,
    ingredients,
    instructions,
    servings: base.servings ? clean(Array.isArray(base.servings) ? base.servings[0] : base.servings) : null,
    prep_minutes: base.prep_minutes ?? null,
    cook_minutes: base.cook_minutes ?? null,
    total_minutes: base.total_minutes ?? null,
    rating: base.rating ?? null,
    rating_count: base.rating_count ?? null,
    category: (base.category || []).map(clean).filter(Boolean),
    keywords: base.keywords ? clean(asArray(base.keywords).join(', ')) : '',
    method: base.method,
    nutrition: base.nutrition || null,
    completeness: base.name && ingredients.length >= 2 && instructions.length >= 1 ? 'complete' : 'partial',
    source_url: base.url,
  };
}

// ---------- 1. JSON-LD ----------
function* walk(node) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) yield* walk(n); return; }
  yield node;
  if (node['@graph']) yield* walk(node['@graph']);
  if (node.mainEntity) yield* walk(node.mainEntity);
}
function flattenInstructions(v, section = null, out = []) {
  for (const item of asArray(v)) {
    if (typeof item === 'string') {
      // A single string may hold several paragraphs; keep them as given, split only on line breaks.
      for (const part of item.split(/\n+|<br\s*\/?>|<\/p>/i)) { const t = clean(part); if (t) out.push({ section, text: t }); }
    } else if (item && typeof item === 'object') {
      if (hasType(item, 'howtosection')) flattenInstructions(item.itemListElement, clean(item.name) || section, out);
      else if (item.itemListElement) flattenInstructions(item.itemListElement, section, out);
      else { const t = clean(item.text || item.name); if (t) out.push({ section, text: t }); }
    }
  }
  return out;
}
export function fromJsonLd(html, url) {
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const [, raw] of blocks) {
    let data;
    try { data = JSON.parse(raw.trim()); }
    catch { try { data = JSON.parse(raw.trim().replace(/,\s*([}\]])/g, '$1').replace(/[\u0000-\u001f]/g, ' ')); } catch { continue; } }
    for (const node of walk(data)) {
      if (!hasType(node, 'recipe')) continue;
      const agg = node.aggregateRating || {};
      return result({
        method: 'jsonld', url,
        name: node.name, image_url: firstImage(node.image), description: node.description,
        ingredients: asArray(node.recipeIngredient || node.ingredients),
        instructions: flattenInstructions(node.recipeInstructions),
        servings: node.recipeYield,
        prep_minutes: isoMinutes(node.prepTime), cook_minutes: isoMinutes(node.cookTime), total_minutes: isoMinutes(node.totalTime),
        rating: agg.ratingValue != null ? +agg.ratingValue : null,
        rating_count: agg.ratingCount != null ? +agg.ratingCount : agg.reviewCount != null ? +agg.reviewCount : null,
        category: asArray(node.recipeCategory).concat(asArray(node.recipeCuisine)),
        keywords: node.keywords,
        nutrition: node.nutrition,
      });
    }
  }
  return null;
}

// ---------- 2. Microdata ----------
function itemprop(html, names) {
  const re = new RegExp(`<(\\w+)[^>]*itemprop=["'](?:${names})["'][^>]*?(?:content=["']([^"']*)["'])?[^>]*>([\\s\\S]*?)<\\/\\1>`, 'gi');
  return [...html.matchAll(re)].map((m) => clean(m[2] || m[3])).filter(Boolean);
}
export function fromMicrodata(html, url) {
  if (!/itemtype=["'][^"']*schema\.org\/Recipe["']/i.test(html)) return null;
  const ingredients = itemprop(html, 'recipeIngredient|ingredients');
  if (!ingredients.length) return null;
  return result({
    method: 'microdata', url,
    name: itemprop(html, 'name')[0] || pageTitle(html),
    ingredients,
    instructions: itemprop(html, 'recipeInstructions').map((text) => ({ section: null, text })),
  });
}

// ---------- 3. Recipe-plugin HTML (WP Recipe Maker, Tasty Recipes, Yummly/ZipList-style) ----------
function byClass(html, tag, cls) {
  const re = new RegExp(`<${tag}[^>]*class=["'][^"']*\\b${cls}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  return [...html.matchAll(re)].map((m) => clean(m[1])).filter(Boolean);
}
function listInside(html, containerCls) {
  const start = html.search(new RegExp(`class=["'][^"']*\\b${containerCls}\\b`, 'i'));
  if (start < 0) return [];
  const slice = html.slice(start, start + 40000);
  const end = slice.search(/<\/(ul|ol)>\s*<\/div>/i);
  return [...slice.slice(0, end > 0 ? end : undefined).matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => clean(m[1])).filter(Boolean);
}
export function fromPluginHtml(html, url) {
  let ingredients = byClass(html, 'li', 'wprm-recipe-ingredient');
  let steps = byClass(html, 'div', 'wprm-recipe-instruction-text');
  let method = 'wprm';
  if (!ingredients.length) {
    ingredients = listInside(html, 'tasty-recipes-ingredients');
    steps = listInside(html, 'tasty-recipes-instructions');
    method = 'tasty';
  }
  if (!ingredients.length) return null;
  return result({
    method, url,
    name: byClass(html, 'h2', 'wprm-recipe-name')[0] || byClass(html, 'h2', 'tasty-recipes-title')[0] || pageTitle(html),
    ingredients,
    instructions: steps.map((text) => ({ section: null, text })),
  });
}

// ---------- 4. Heading heuristic (blogspot, older WordPress, media articles) ----------
const H_ING = /ingredients?|ingrediants|samagri|सामग्री/i;
const H_METHOD = /method|instructions?|directions?|how to (make|prepare)|preparation|procedure|विधि/i;
function sectionAfter(html, headingRe) {
  const heads = [...html.matchAll(/<(h[2-5]|strong|b)[^>]*>([\s\S]*?)<\/\1>/gi)];
  const idx = heads.findIndex((h) => headingRe.test(clean(h[2])) && clean(h[2]).length < 60);
  if (idx < 0) return [];
  const from = heads[idx].index + heads[idx][0].length;
  const nextH = html.slice(from).search(/<h[2-4][^>]*>/i);
  const chunk = html.slice(from, nextH > 0 ? from + nextH : from + 15000);
  const rawLis = [...chunk.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => m[1]);
  // A list made only of links is site navigation / a category list, not an ingredient list.
  const linkOnly = rawLis.filter((h) => /^\s*<a\b[^>]*>[\s\S]*?<\/a>\s*$/i.test(h)).length;
  if (rawLis.length >= 3 && linkOnly / rawLis.length >= 0.7) return [];
  const lis = rawLis.map(clean).filter(Boolean);
  if (lis.length) return lis;
  return [...chunk.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => clean(m[1])).filter((t) => t && t.length < 400);
}
function pageTitle(html) {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (og) return clean(og[1]);
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return t ? clean(t[1]).split(/\s[|–-]\s/)[0] : null;
}
export function fromHeuristic(html, url) {
  const ingredients = sectionAfter(html, H_ING);
  if (ingredients.length < 2) return null;
  // Listing pages: most "ingredients" are titles like "Chicken Recipes".
  if (ingredients.filter((i) => /\brecipes?$/i.test(i)).length / ingredients.length >= 0.4) return null;
  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  const r = result({
    method: 'heuristic', url,
    name: pageTitle(html),
    image_url: og ? og[1] : null,
    ingredients,
    instructions: sectionAfter(html, H_METHOD).map((text) => ({ section: null, text })),
  });
  r.completeness = 'partial'; // heuristic results always go through review
  return r;
}
