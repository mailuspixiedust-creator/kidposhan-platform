// Backfill: collect every photo of the dish for recipes that were read before photo collection existed.
// New recipes get their photos when the page is first read (pipeline.js). This job re-reads old pages politely
// (robots.txt obeyed, paced per site) a few at a time; live recipes go first.

import { fetchHtml, extractFromHtml } from './extract.js';
import { collectImages } from './images.js';

export async function galleryFor(env, id) {
  const r = await env.DB.prepare('SELECT id, source_url FROM kp_recipes WHERE id = ?').bind(id).first();
  if (!r) return { id, skipped: 'not found' };
  let html, finalUrl;
  try { ({ html, finalUrl } = await fetchHtml(r.source_url, env)); }
  catch (e) {
    if (e.code === 'later') return { id, later: true };           // pacing, not a failure: try again next run
    await env.DB.prepare("UPDATE kp_recipes SET images_json = '[]' WHERE id = ? AND images_json IS NULL").bind(id).run();
    return { id, error: String(e.message).slice(0, 120) };         // robots / HTTP error: do not retry forever
  }
  const ex = extractFromHtml(html, finalUrl);
  const images = collectImages(html, finalUrl, ex?.ld_images || []);
  await env.DB.prepare('UPDATE kp_recipes SET images_json = ?, image_url = COALESCE(?, image_url) WHERE id = ?')
    .bind(JSON.stringify(images), images[0] || null, id).run();
  return { id, photos: images.length };
}

export async function galleryPending(env, { limit = 4 } = {}) {
  const { results } = await env.DB.prepare(
    `SELECT id FROM kp_recipes WHERE images_json IS NULL ORDER BY (review_status = 'approved') DESC, id LIMIT ?`
  ).bind(limit).all();
  const out = [];
  for (const r of results) out.push(await galleryFor(env, r.id));
  return out;
}
