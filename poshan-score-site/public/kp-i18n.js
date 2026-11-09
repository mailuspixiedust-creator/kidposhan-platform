/* The words of the site in Hindi, Bengali and Gujarati.
   - On a page in one of those languages (<html lang="hi"|"bn"|"gu">): looks up every line of text (and placeholders, labels, titles) in the translation
     memory kept by the platform and replaces it, also for what an app writes onto the page later. A line it has no translation for stays in English and is
     reported (the line only, with numbers as {#}: never a name or anything typed by the visitor) so that it gets translated.
   - On an English page: adds a small line to switch to the same page in another language.
   Nothing about the visitor is sent. */
(function () {
  var API = 'https://kidposhan-platform.mailus-pixiedust.workers.dev';
  var NAMES = { hi: 'हिन्दी', bn: 'বাংলা', gu: 'ગુજરાતી' };
  // pages that exist in every language, and the folders that do
  var STATIC = ['/', '/age-metrics', '/meal-ideas', '/products', '/recipes', '/scan', '/why-we-do-this', '/built-with-parents', '/privacy', '/compare', '/best', '/brands', '/ideas'];
  var FOLDERS = /^\/(products|recipes|best|ideas|brands)\//;
  var lang = String(document.documentElement.lang || 'en').slice(0, 2);
  var local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  if (local) API = '/px';
  var bare = function (p) { p = String(p || '/').replace(/^\/(hi|bn|gu)(?=\/|$)/, '').replace(/\/index(\.html)?$/, '/').replace(/\.html$/, ''); if (p.length > 1) p = p.replace(/\/+$/, ''); return p || '/'; };
  var here = bare(location.pathname);
  var avail = {};   // { hi: ['/', '/privacy', ...] }: the static pages that exist in each language (from /i18n-pages.json)
  var hasLocal = function (p, l) { return FOLDERS.test(p) || ((avail[l || lang] || []).indexOf(p) >= 0); };

  /* ---------- English pages: the language line ---------- */
  var getAvail = function (then) { fetch(local ? '/i18n-pages.json' : '/i18n-pages.json').then(function (r) { return r.json(); }).then(function (d) { avail = d || {}; then(); }).catch(function () { /* no switcher, no rewriting */ }); };
  if (!NAMES[lang]) {
    if (document.querySelector('.langs, .kp-langbar')) return;
    getAvail(function () {
      var codes = Object.keys(NAMES).filter(function (c) { return hasLocal(here, c); });
      if (!codes.length) return;
      var bar = document.createElement('div');
      bar.className = 'kp-langbar';
      bar.setAttribute('translate', 'no');
      bar.style.cssText = 'font:13px/1.4 system-ui,sans-serif;text-align:right;padding:6px 14px;background:rgba(127,127,127,.08)';
      bar.innerHTML = 'English · ' + codes.map(function (c) { return '<a href="/' + c + (here === '/' ? '/' : here) + location.search + '" hreflang="' + c + '" style="color:inherit;margin-left:8px">' + NAMES[c] + '</a>'; }).join(' ');
      var put = function () { document.body.insertBefore(bar, document.body.firstChild); };
      if (document.body) put(); else document.addEventListener('DOMContentLoaded', put);
    });
    return;
  }

  /* ---------- pages in a language ---------- */
  var NUM = /\d+(?:[.,]\d+)*/g;
  var STOP = /\b(the|a|an|to|for|your|you|is|are|of|in|and|or|with|from|on|at|by|this|that|it|we|our|can|will|not|no|if|as|per|all|any|one|more|than|how|what|pick|choose|see|check|try|tap|open|show|find|add|save|get|use|make|ready|please)\b/i;
  var UI_TAGS = { BUTTON: 1, LABEL: 1, OPTION: 1, SUMMARY: 1, TH: 1, LEGEND: 1 };
  var map = {}, pending = {}, sent = {}, timer = null, flushT = null;
  var KEY = 'kp_ui_' + lang;
  try { var c = JSON.parse(localStorage.getItem(KEY) || 'null'); if (c && c.map) map = c.map; } catch (e) { /* ignore */ }

  function keyOf(text) { var nums = []; var t = String(text).replace(/\s+/g, ' ').trim(); return { key: t.replace(NUM, function (m) { nums.push(m); return '{#}'; }), nums: nums }; }
  function fill(tgt, nums) { var i = 0; return tgt.replace(/\{#\}/g, function () { return i < nums.length ? nums[i++] : ''; }); }
  function skip(el) {
    for (var n = el; n && n.nodeType === 1; n = n.parentNode) {
      var t = n.tagName;
      if (t === 'SCRIPT' || t === 'STYLE' || t === 'NOSCRIPT' || t === 'TEXTAREA' || t === 'CODE' || t === 'PRE' || t === 'SVG' || t === 'svg') return true;
      if (n.getAttribute && (n.getAttribute('translate') === 'no' || n.getAttribute('lang') === 'en')) return true;
      if (t === 'A') { var h = n.getAttribute('href') || ''; if (/\/(recipes|products)\/|#\/r\/|open=/.test(h)) return true; }
    }
    return false;
  }
  function looksUi(key, el) {
    if (key.length < 3 || key.length > 200 || !/[A-Za-z]{2}/.test(key)) return false;
    if (/[<>@]|https?:|^[\d{#}\s.,:/·–-]+$/.test(key)) return false;
    if (/\s/.test(key)) return STOP.test(key);
    return !!(el && UI_TAGS[el.tagName]);
  }
  function note(key, el) { if (!sent[key] && !pending[key] && looksUi(key, el)) { pending[key] = 1; schedule(); } }
  function textNode(node) {
    var raw = node.nodeValue;
    if (node.__kp === raw) return;
    var m = raw.match(/^(\s*)([\s\S]*?)(\s*)$/);
    if (!m[2] || !/[A-Za-z]{2}/.test(m[2])) return;
    if (skip(node.parentNode)) return;
    var k = keyOf(m[2]), t = map[k.key];
    if (t) { var out = m[1] + fill(t, k.nums) + m[3]; node.nodeValue = out; node.__kp = out; } else note(k.key, node.parentNode);
  }
  var ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];
  function attrs(el) {
    if (skip(el)) return;
    for (var i = 0; i < ATTRS.length; i++) {
      var v = el.getAttribute(ATTRS[i]); if (!v || el['__kp_' + ATTRS[i]] === v || !/[A-Za-z]{2}/.test(v)) continue;
      var k = keyOf(v), t = map[k.key];
      if (t) { var out = fill(t, k.nums); el.setAttribute(ATTRS[i], out); el['__kp_' + ATTRS[i]] = out; } else if (/\s/.test(k.key)) note(k.key, null);
    }
    if (el.tagName === 'INPUT' && /^(button|submit)$/i.test(el.type) && el.value && !el.__kp_v) { var kv = keyOf(el.value), tv = map[kv.key]; if (tv) { el.value = fill(tv, kv.nums); el.__kp_v = 1; } }
  }
  function link(a) {
    var h = a.getAttribute('href'); if (!h || /^(#|mailto:|tel:|javascript:)/i.test(h)) return;
    var u; try { u = new URL(h, location.href); } catch (e) { return; }
    if (u.origin !== location.origin || /^\/(hi|bn|gu)(\/|$)/.test(u.pathname)) return;
    var p = bare(u.pathname); if (!hasLocal(p)) return;
    a.setAttribute('href', '/' + lang + (p === '/' ? '/' : p) + u.search + u.hash);
  }
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { textNode(root); return; }
    if (root.nodeType !== 1) return;
    if (skip(root)) return;
    attrs(root); if (root.tagName === 'A') link(root);
    var w = document.createTreeWalker(root, 5 /* text + element */, null), n;
    while ((n = w.nextNode())) { if (n.nodeType === 3) textNode(n); else if (n.nodeType === 1) { if (skip(n)) continue; attrs(n); if (n.tagName === 'A') link(n); } }
  }
  function all() { walk(document.body); if (document.title && !document.title.__kp) { var k = keyOf(document.title), t = map[k.key]; if (t) document.title = fill(t, k.nums); } }
  function schedule() { clearTimeout(flushT); flushT = setTimeout(flush, 2500); }
  function flush() {
    var list = Object.keys(pending).slice(0, 80); if (!list.length) return;
    list.forEach(function (k) { sent[k] = 1; delete pending[k]; });
    try { fetch(API + '/api/kp/ui-i18n/collect', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ strings: list }), keepalive: true }); } catch (e) { /* ignore */ }
  }
  function refresh() {
    fetch(API + '/api/kp/ui-i18n?lang=' + lang).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.map) return; map = d.map; try { localStorage.setItem(KEY, JSON.stringify({ t: Date.now(), map: map })); } catch (e) { /* ignore */ }
      all();
    }).catch(function () { /* the page stays as it is */ });
  }
  function start() {
    all();
    new MutationObserver(function (muts) {
      clearTimeout(timer);
      timer = setTimeout(function () {
        for (var i = 0; i < muts.length; i++) {
          var m = muts[i];
          if (m.type === 'characterData') textNode(m.target);
          else if (m.type === 'attributes') attrs(m.target);
          else for (var j = 0; j < m.addedNodes.length; j++) walk(m.addedNodes[j]);
        }
      }, 40);
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    refresh();
  }
  getAvail(function () { if (document.body) walk(document.body); });
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
