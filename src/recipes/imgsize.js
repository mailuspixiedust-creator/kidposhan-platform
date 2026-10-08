// Photo sharpness: read the pixel width of a dish photo from the first bytes of the file (JPEG / PNG / WebP headers),
// so the sharpest photo of a dish becomes its hero and recipes with better photos can be shown first.
// Only the first 64 KB are read; the rest of the download is cancelled.

const HEAD = 65536;

export function sizeOf(b) {
  const u16 = (i) => (b[i] << 8) | b[i + 1];
  const u32 = (i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  const l16 = (i) => b[i] | (b[i + 1] << 8);
  const l24 = (i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { w: u32(16), h: u32(20) };
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xff) { i++; continue; }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: u16(i + 5), w: u16(i + 7) };
      i += 2 + u16(i + 2);
    }
    return null;
  }
  if (b.length > 30 && b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) {      // RIFF....WEBP
    const kind = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (kind === 'VP8 ') return { w: l16(26) & 0x3fff, h: l16(28) & 0x3fff };
    if (kind === 'VP8L') { const v = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0; return { w: (v & 0x3fff) + 1, h: ((v >>> 14) & 0x3fff) + 1 }; }
    if (kind === 'VP8X') return { w: 1 + l24(24), h: 1 + l24(27) };
  }
  return null;
}

export async function probeWidth(url, fetchFn = fetch) {
  try {
    const r = await fetchFn(url, { headers: { Range: `bytes=0-${HEAD - 1}`, Accept: 'image/*' }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) return 0;
    const chunks = []; let got = 0;
    const rd = r.body.getReader();
    while (got < HEAD) { const { value, done } = await rd.read(); if (done) break; chunks.push(value); got += value.length; }
    try { await rd.cancel(); } catch { /* already closed */ }
    const buf = new Uint8Array(got); let o = 0; for (const c of chunks) { buf.set(c, o); o += c.length; }
    return sizeOf(buf)?.w || 0;
  } catch { return 0; }
}

// Look at the first few photos (the finished dish comes first; the rest are step shots) and put the sharpest first.
// A later photo only replaces the current hero when it is clearly sharper (1.25x), so a step shot does not displace the finished dish.
// Returns { images, width }; width 0 = could not be measured.
export async function rankImages(images, { probe = probeWidth, look = 6 } = {}) {
  if (!images.length) return { images, width: 0 };
  const widths = [];
  for (const u of images.slice(0, look)) widths.push(await probe(u));
  let best = 0;
  widths.forEach((w, i) => { if (w > widths[best] * 1.25) best = i; });
  if (!widths[best]) return { images, width: 0 };
  return { images: [images[best], ...images.filter((_, i) => i !== best)], width: widths[best] };
}
