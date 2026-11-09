// The static pages (Home, Age & Metrics, Why We Do This, Built with Parents, Privacy, Products, Recipes, Scan, Meal Ideas, Compare) in Hindi, Bengali and Gujarati.
// Each page is split into the units a person reads (a heading, a paragraph with its links and bold words, a button, a table cell). A unit is looked up in the translation
// memory kept by the platform (see src/recipes/uitext.js); the inline tags inside a unit travel as numbered markers (<a1>...</a1>) so that a link stays a link.
// A unit with no translation yet stays in English, and is listed so that it can be queued for translation (ui-seed.sql).
const { LANGS } = require('./i18n.cjs');
const { alternates, switcher } = require('./build-i18n.cjs');

const STATIC = ['/', '/age-metrics', '/meal-ideas', '/products', '/recipes', '/scan', '/why-we-do-this', '/built-with-parents', '/privacy', '/compare', '/best', '/brands', '/ideas'];
const FOLDER = /^\/(products|recipes|best|ideas|brands)\//;
const BLOCK = new Set('html head body title meta link p div li ul ol table thead tbody tfoot tr td th h1 h2 h3 h4 h5 h6 section header footer nav main article aside form fieldset legend button label select option optgroup summary details figure figcaption blockquote dl dt dd hr caption address'.split(' '));
const RAW = new Set(['script', 'style', 'noscript', 'textarea', 'pre', 'svg', 'code', 'select']);   // kept as they are
const ATTR = ['placeholder', 'aria-label', 'title', 'alt'];
const NUM = /\d+(?:[.,]\d+)*/g;
const MAX_UNIT = 1800;

const dec = (s) => String(s).replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&middot;/g, '·').replace(/&hellip;/g, '…').replace(/&rsquo;/g, '’').replace(/&lsquo;/g, '‘').replace(/&ldquo;/g, '“').replace(/&rdquo;/g, '”').replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16)));
const enc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const hasWords = (s) => /[A-Za-z]{2}/.test(s);
function keyOf(text) { const nums = []; const t = String(text).replace(/\s+/g, ' ').trim(); return { key: t.replace(NUM, (m) => { nums.push(m); return '{#}'; }), nums }; }
const fill = (tgt, nums) => { let i = 0; return tgt.replace(/\{#\}/g, () => (i < nums.length ? nums[i++] : '')); };

const letters = (n) => { let s = ''; n = n - 1; do { s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0); return s; };
const MARK = /<(\/?)([a-z0-9]+_[a-z]+)(\/?)>/g;
function tokenize(html) {
  const re = /<!--[\s\S]*?-->|<![^>]*>|<(script|style|noscript|textarea|pre|svg|code|select)\b[^>]*>[\s\S]*?<\/\1\s*>|<\/?[a-zA-Z][^>]*>|[^<]+|</g;
  const out = []; let m;
  while ((m = re.exec(html))) {
    const v = m[0];
    if (v.startsWith('<!')) out.push({ t: 'raw', v });
    else if (m[1]) out.push({ t: 'raw', v, name: m[1].toLowerCase() });
    else if (v[0] === '<' && v.length > 1) { const nm = (v.match(/^<\/?([a-zA-Z][a-zA-Z0-9]*)/) || [])[1]; out.push({ t: 'tag', v, name: nm.toLowerCase(), close: v[1] === '/' }); }
    else out.push({ t: 'text', v });
  }
  return out;
}

// the policy of one page: which units are not words to translate (lists of recipe names, for example)
const SKIP_INSIDE = { '/recipes': ['li'] };

function bake(html, { map, rel, code, SITE, units, avail }) {
  const stats = { total: 0, done: 0 };
  const L = LANGS[code];
  const toks = tokenize(html);
  const out = [];
  const stack = [];                          // the open tags (to know where we are)
  let buf = [];
  const skipLi = (SKIP_INSIDE[rel] || []);
  const tr = (text) => { const k = keyOf(text); if (hasWords(k.key)) stats.total++; const t = map[k.key]; if (!t) { if (hasWords(k.key)) units.add(k.key); return null; } stats.done++; return fill(t, k.nums); };
  const attrs = (tag) => {
    let v = tag.v;
    for (const a of ATTR) v = v.replace(new RegExp('(\\s' + a + '=)("([^"]*)"|\'([^\']*)\')', 'i'), (m0, pre, q, d1, d2) => { const val = dec(d1 != null ? d1 : d2); if (!hasWords(val)) return m0; const t = tr(val); return t ? `${pre}"${enc(t).replace(/"/g, '&quot;')}"` : m0; });
    if (tag.name === 'meta') v = v.replace(/(\scontent=)("([^"]*)"|'([^']*)')/i, (m0, pre, q, d1, d2) => { const val = dec(d1 != null ? d1 : d2); const isText = /(name|property)=["'](description|og:title|og:description|twitter:title|twitter:description)["']/i.test(tag.v); if (!isText || !hasWords(val)) return m0; const t = tr(val); return t ? `${pre}"${enc(t).replace(/"/g, '&quot;')}"` : m0; });
    return v;
  };
  const inSkip = () => stack.some((n) => skipLi.includes(n)) || stack.some((n) => n.startsWith('a:/recipes/') || n.startsWith('a:/products/'));
  const flush = () => {
    if (!buf.length) return;
    // a row of links with only spaces between them (a menu): each link is read on its own
    const groups = []; let cur = [], depth = 0, onlyLinks = true;
    for (const b of buf) {
      if (b.t === 'tag' && b.name === 'a' && !b.close) { depth++; cur.push(b); }
      else if (b.t === 'tag' && b.name === 'a' && b.close) { cur.push(b); depth--; if (!depth) { groups.push(cur); cur = []; } }
      else if (depth) cur.push(b);
      else if (b.t === 'text' && !b.v.trim()) cur.push(b);
      else { onlyLinks = false; break; }
    }
    if (onlyLinks && groups.length > 1 && !cur.some((b) => b.t !== 'text')) {
      const all = buf; buf = [];
      for (const g of groups) { buf = g; flushOne(); }
      for (const b of cur) out.push(b.v);
      return;
    }
    flushOne();
  };
  const flushOne = () => {
    if (!buf.length) return;
    // build the unit: the text with its inline tags as numbered markers
    let text = '', idx = 0; const open = {}; const closeStack = []; let words = false;
    for (const b of buf) {
      if (b.t === 'text') { text += dec(b.v); }
      else if (b.t === 'raw') { idx++; const nm = (b.name || 'x'); const k = nm + '_' + letters(idx); open[k] = { raw: b.v }; text += `<${k}/>`; }
      else if (b.close) { const o = closeStack.pop(); if (o) text += `</${o}>`; else text += ''; }
      else if (/\/>$/.test(b.v) || ['br', 'img', 'wbr', 'input'].includes(b.name)) { idx++; const k = b.name + '_' + letters(idx); open[k] = { raw: b.v }; text += `<${k}/>`; }
      else { idx++; const k = b.name + '_' + letters(idx); open[k] = { open: b.v }; closeStack.push(k); text += `<${k}>`; }
    }
    // the text that is read (without the markers) must hold words, and the unit must be of a sensible size
    const readable = text.replace(MARK, ' ');
    if (!hasWords(readable) || text.length > MAX_UNIT || inSkip()) { out.push(...buf.map((b) => b.v)); buf = []; return; }
    const m = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
    let wrap = null, inner = m[2];
    const w = m[2].match(/^<([a-z0-9]+_a)>([\s\S]*)<\/\1>$/);
    if (w && open[w[1]] && open[w[1]].open && !w[2].includes('<' + w[1] + '>')) { wrap = w[1]; inner = w[2]; }
    const t = tr(inner);
    if (t == null) { out.push(...buf.map((b) => b.v)); buf = []; return; }
    // put the original tags back; the markers must all be there, or the unit stays in English
    let body = enc(t).replace(/&lt;(\/?)([a-z0-9]+_[a-z]+)(\/?)&gt;/g, (x, sl, nm, selfc) => `<${sl}${nm}${selfc}>`);
    let ok = true;
    const used = new Set();
    body = body.replace(MARK, (x, sl, nm, selfc) => { const o = open[nm]; if (!o) { ok = false; return ''; } used.add(sl + nm + selfc); if (o.raw !== undefined) return o.raw; if (sl) return `</${nm.replace(/_[a-z]+$/, '')}>`; return o.open; });
    const need = Object.keys(open).length - (wrap ? 1 : 0); const have = new Set(); (t.match(MARK) || []).forEach((x) => have.add(x.replace(/[</>]/g, '')));
    if (!ok || have.size !== need) { out.push(...buf.map((b) => b.v)); buf = []; return; }
    if (wrap) body = open[wrap].open + body + `</${wrap.replace(/_[a-z]+$/, '')}>`;
    out.push(m[1] + body + m[3]); buf = [];
  };
  for (const tk of toks) {
    if (tk.t === 'tag') {
      if (BLOCK.has(tk.name)) {
        flush();
        if (tk.close) { for (let i = stack.length - 1; i >= 0; i--) if (stack[i] === tk.name) { stack.length = i; break; } }
        else if (!['meta', 'link', 'hr', 'input'].includes(tk.name)) stack.push(tk.name);
        out.push(attrs(tk));
      } else {
        // an inline tag: part of the unit being read (its own attributes, such as a link's title, are translated)
        if (tk.name === 'a' && !tk.close) { const h = (tk.v.match(/href=["']([^"']*)["']/i) || [])[1] || ''; stack.push('a:' + (h.startsWith('http') ? '' : (h.startsWith('/') ? h : '/' + h))); }
        else if (tk.name === 'a' && tk.close) { for (let i = stack.length - 1; i >= 0; i--) if (stack[i].startsWith('a:')) { stack.length = i; break; } }
        buf.push({ ...tk, v: tk.close ? tk.v : attrs(tk) });
      }
    } else if (tk.t === 'raw') {
      if (tk.name === 'script' || tk.name === 'style' || tk.name === 'noscript' || tk.name === 'textarea' || tk.name === 'pre' || tk.name === 'select') { flush(); out.push(tk.v); } else buf.push(tk);
    } else buf.push(tk);
  }
  flush();
  let html2 = out.join('');
  // the language of the page, its address and the links between the languages
  html2 = html2.replace(/<html\b([^>]*?)>/i, (m0, a) => `<html${/\slang=/.test(a) ? a.replace(/\slang=["'][^"']*["']/i, ` lang="${L.html}"`) : a + ` lang="${L.html}"`}>`);
  const url = `${SITE}/${code}${rel === '/' ? '/' : rel}`;
  html2 = html2.replace(/<link rel="canonical"[^>]*>\s*/i, '').replace(/<meta property="og:url"[^>]*>\s*/i, '').replace(/<\/head>/i, (m0) => `<link rel="canonical" href="${url}">\n<meta property="og:url" content="${url}">\n${m0}`);
  const relPath = rel === '/' ? '' : rel.replace(/^\//, '');
  html2 = html2.replace(/<\/head>/i, (m0) => alternates(SITE, relPath) + '\n' + m0).replace(/<body\b[^>]*>/i, (m0) => m0 + '\n' + switcher(relPath, code));
  // links: a page that exists in the language points to it
  html2 = html2.replace(/(<(?:a|link|script|img|source|form)\b[^>]*?\s)(href|src|action)=("([^"]*)"|'([^']*)')/gi, (m0, pre, attr, q, d1, d2) => {
    const v = d1 != null ? d1 : d2;
    if (!v || /^(#|mailto:|tel:|javascript:|data:|https?:|\/\/)/i.test(v)) return m0;
    let u; try { u = new URL(v, SITE + '/'); } catch { return m0; }
    let p = u.pathname.replace(/\/index(\.html)?$/, '/').replace(/\.html$/, ''); if (p.length > 1) p = p.replace(/\/+$/, '');
    const local = attr === 'href' && pre.startsWith('<a') && !/^\/(hi|bn|gu)\//.test(p) && ((avail ? avail.has(p) : STATIC.includes(p)) || FOLDER.test(p));
    const nv = (local ? '/' + code + (p === '/' ? '/' : p) : (v.startsWith('/') ? u.pathname : '/' + u.pathname.replace(/^\//, ''))) + u.search + u.hash;
    return `${pre}${attr}="${nv}"`;
  });
  return { html: html2, total: stats.total, done: stats.done };
}

const STOP = /\b(the|a|an|to|for|your|you|is|are|of|in|and|or|with|from|on|at|by|this|that|it|we|our|can|will|not|no|if|as|per|all|any|one|more|than|how|what|pick|choose|see|check|try|tap|open|show|find|add|save|get|use|make|ready|please)\b/i;
function jsStrings(src) {
  const out = new Set();
  const lits = String(src).match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g) || [];
  for (const lit of lits) {
    const body = lit.slice(1, -1).replace(/\\n/g, ' ').replace(/\\(['"`])/g, '$1');
    // pieces of text between the code and the tags: "Showing ${n} ideas" is "Showing", "ideas"
    for (let piece of body.split(/\$\{[^}]*\}|<[^>]*>/)) {
      piece = dec(piece).replace(/\s+/g, ' ').trim();
      const k = keyOf(piece).key;
      if (!/\s/.test(k)) { if (/</.test(body) && /^[A-Z][A-Za-z]{2,18}$/.test(k)) out.add(k); continue; }      // one word: only from a piece of HTML (a button, a label)
      if (k.length < 4 || k.length > 200) continue;
      if (/[=;(){}\[\]\\|]|=>|https?:|\.(js|css|png|html)\b|\bvar |\bfunction\b|\breturn\b|^[a-z-]+:/.test(k.replace(/\{#\}/g, ''))) continue;
      const letters = (k.match(/[A-Za-z]/g) || []).length;
      if (letters / k.length < 0.6 || !STOP.test(k)) continue;
      if (!/^[A-Z“"'(\u2018\u201c]/.test(k) && !/[.?!:]$/.test(k)) continue;
      out.add(k);
    }
  }
  return out;
}

module.exports = { bake, STATIC, keyOf, jsStrings };
