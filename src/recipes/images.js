// Collect the photos that belong to ONE dish from its recipe page: the finished dish and its step-by-step shots.
// A recipe page also carries logos, avatars, ads and thumbnails of OTHER recipes ("you may also like"), so the rule is strict:
//   - only images inside the post body (before the related-posts / sidebar / comments / footer blocks),
//   - only images from the same folder as the hero photo (a blog stores one post's photos together, e.g. /uploads/2017/03/),
//   - never size-cropped thumbnails (name-360x480.jpg) or icons, logos, avatars, rating stars, video thumbnails.
// If the page has no clear post body, only the hero is returned.

const MAX_IMAGES = 30;
const CROP = /-\d{2,4}x\d{2,4}(?=\.[a-z0-9]+$)/i;
const NOT_PHOTO = /(logo|avatar|gravatar|icon|sprite|stars?[-_.]|rating|pinterest|share|button|banner|\badv|emoji|spacer|pixel|\.svg|\.gif|\/vi\/|hqdefault|youtube)/i;
const BODY_START = /class=["'][^"']*(?:entry-content|post-content|article-content|recipe-content|post-body|single-content)/i;
const BODY_END = /class=["'][^"']*(?:related|yarpp|jp-relatedposts|post-navigation|comments-area|comment-respond|sidebar|widget-area|site-footer|author-box|newsletter)/i;

const strip = (u) => String(u || '').split('#')[0].split('?')[0];
const dirOf = (u) => strip(u).replace(/[^/]*$/, '');
const abs = (u, base) => { if (!u) return null; try { return new URL(u, base).toString(); } catch { return null; } };

// the largest candidate an <img> tag offers: srcset widest, else data-large-file / data-src / src
function bestSrc(tag, base) {
  const attr = (n) => (tag.match(new RegExp(`\\s${n}=["']([^"']+)["']`, 'i')) || [])[1];
  const set = attr('data-lazy-srcset') || attr('data-srcset') || attr('srcset');
  if (set) {
    const cand = set.split(',').map((c) => c.trim().split(/\s+/)).filter((c) => c[0] && !c[0].startsWith('data:'))
      .map(([u, w]) => ({ u, w: parseInt(w, 10) || 0 })).sort((a, b) => b.w - a.w);
    if (cand.length) return abs(cand[0].u, base);
  }
  const plain = [attr('data-large-file'), attr('data-lazy-src'), attr('data-src'), attr('data-original'), attr('src')].find((v) => v && !v.startsWith('data:'));
  return plain ? abs(plain, base) : null;
}

// ldImages: image URLs from the page's Recipe JSON-LD (usually crops of one photo; the uncropped one is the hero)
export function collectImages(html, pageUrl, ldImages = []) {
  const og = (String(html).match(/property=["']og:image["'][^>]*content=["']([^"']+)["']/i) || [])[1];
  const ld = ldImages.map((u) => abs(u, pageUrl)).filter(Boolean);
  const hero = ld.find((u) => !CROP.test(strip(u))) || ld[0] || abs(og, pageUrl);
  if (!hero) return [];
  const out = [hero], seen = new Set([strip(hero).replace(CROP, '')]);
  const start = String(html).search(BODY_START);
  if (start < 0) return out;
  let body = String(html).slice(start);
  const end = body.search(BODY_END);
  if (end > 0) body = body.slice(0, end);
  const dir = dirOf(hero);
  for (const m of body.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0], src = bestSrc(tag, pageUrl);
    if (!src || NOT_PHOTO.test(src)) continue;
    const clean = strip(src);
    if (dirOf(clean) !== dir || CROP.test(clean)) continue;       // other dishes' thumbnails live elsewhere or are cropped
    const w = parseInt((tag.match(/\swidth=["'](\d+)["']/i) || [])[1], 10);
    if (w && w < 200) continue;                                     // tiny images
    const key = clean.replace(CROP, '');
    if (seen.has(key)) continue;
    seen.add(key); out.push(src);
    if (out.length >= MAX_IMAGES) break;
  }
  return out;
}
