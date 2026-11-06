// Compare two packs side by side: pick any two products, see the score, the ten yes-or-no checks and the score at every age next to each other.
// A static page: the picking and the numbers come from the live API in the visitor's browser (the packs are searched by name, scored for the chosen age).
// The address keeps the choice (?a=283&b=292&age=4-6y), so a comparison can be shared.
const CLIENT_JS = String.raw`(function () {
  var API = '__API__';
  var AGES = [['1-3y', '1–3 years'], ['4-6y', '4–6 years'], ['7-9y', '7–9 years'], ['10-12y', '10–12 years'], ['13-15y', '13–15 years'], ['16-18y', '16–18 years'], ['adult', 'Adults']];
  var AGE_MONTHS = { '1-3y': 24, '4-6y': 60, '7-9y': 96, '10-12y': 132, '13-15y': 168, '16-18y': 204, adult: 300 };
  var COLOR = { Good: '#3F6B3C', OK: '#B5790A', 'Do not use': '#A6402A' };
  var q = new URLSearchParams(location.search);
  var state = { age: AGES.some(function (a) { return a[0] === q.get('age'); }) ? q.get('age') : '4-6y', a: null, b: null, ida: q.get('a'), idb: q.get('b') };
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function tier(p) { return p.capped ? 'OK' : p.band; }
  function pill(n, t) { return n == null ? '–' : '<span class="pill" style="background:' + (COLOR[t] || COLOR.OK) + '">' + esc(n) + '</span>'; }

  var sel = $('age');
  sel.innerHTML = AGES.map(function (a) { return '<option value="' + a[0] + '"' + (a[0] === state.age ? ' selected' : '') + '>' + a[1] + '</option>'; }).join('');
  sel.onchange = function () { state.age = sel.value; reload(); };

  function keep() {
    var p = new URLSearchParams();
    if (state.a) p.set('a', state.a.id);
    if (state.b) p.set('b', state.b.id);
    p.set('age', state.age);
    try { history.replaceState(null, '', location.pathname + '?' + p.toString()); } catch (e) { /* ignore */ }
  }
  function load(id) { return fetch(API + '/api/kp/products/' + encodeURIComponent(id) + '?age=' + state.age).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
  function reload() {
    Promise.all([state.a ? load(state.a.id) : null, state.b ? load(state.b.id) : null]).then(function (r) { if (r[0]) state.a = r[0]; if (r[1]) state.b = r[1]; keep(); draw(); });
  }
  function pick(slot, id) {
    load(id).then(function (d) { if (!d) return; state[slot] = d; $('res' + slot).innerHTML = ''; $('q' + slot).value = ''; keep(); draw(); });
  }

  ['a', 'b'].forEach(function (slot) {
    var input = $('q' + slot), box = $('res' + slot), timer = null, seq = 0;
    input.addEventListener('input', function () {
      clearTimeout(timer);
      var v = input.value.trim();
      if (v.length < 2) { box.innerHTML = ''; return; }
      timer = setTimeout(function () {
        var my = ++seq;
        fetch(API + '/api/kp/search?limit=6&age_months=' + AGE_MONTHS[state.age] + '&q=' + encodeURIComponent(v)).then(function (r) { return r.json(); }).then(function (d) {
          if (my !== seq) return;
          var items = (d.products || []);
          box.innerHTML = items.length ? items.map(function (p) { return '<button type="button" data-id="' + p.id + '"><b>' + esc(p.name) + '</b><small>' + esc([p.brand, p.category].filter(Boolean).join(' · ')) + '</small></button>'; }).join('') : '<p class="fine">No pack found. Try the brand or the name on the front.</p>';
          Array.prototype.forEach.call(box.querySelectorAll('button'), function (b) { b.onclick = function () { pick(slot, b.getAttribute('data-id')); }; });
        }).catch(function () { box.innerHTML = '<p class="fine">Search is not available just now.</p>'; });
      }, 250);
    });
  });

  function head(p) {
    if (!p) return '<div class="empty">Pick a pack</div>';
    return '<div class="ph">' + (p.image_url ? '<img src="' + esc(p.image_url) + '" alt="" referrerpolicy="no-referrer" onerror="this.remove()">' : '') +
      '<a href="/products?open=' + esc(p.id) + '" class="nm" data-id="' + esc(p.id) + '">' + esc(String(p.name || '').split('|')[0]) + '</a><small>' + esc([p.brand, p.pack_size].filter(Boolean).join(' · ')) + '</small>' +
      '<div class="big" style="background:' + (COLOR[tier(p)] || COLOR.OK) + '">' + esc(Math.round(p.score)) + '</div><div class="tr">' + esc(p.capped ? 'OK (held)' : p.band) + '</div></div>';
  }
  function checkCell(m) {
    if (!m) return '<td>–</td>';
    return '<td class="' + (m.score ? 'y' : 'n') + '"><b>' + (m.score ? 'Yes' : 'No') + '</b><small>' + esc(m.reading || '') + '</small></td>';
  }
  function draw() {
    $('heads').innerHTML = '<div>' + head(state.a) + '</div><div>' + head(state.b) + '</div>';
    var out = $('out');
    if (!state.a || !state.b) { out.innerHTML = '<p class="fine">Choose two packs to compare them check by check.</p>'; return; }
    var A = state.a, B = state.b, ma = A.metrics || [], mb = B.metrics || [];
    var rows = '';
    for (var i = 0; i < Math.max(ma.length, mb.length); i++) {
      var x = ma[i], y = mb[i], name = (x || y).name;
      rows += '<tr><td class="cn">' + esc((x || y).n) + '. ' + esc(name) + '</td>' + checkCell(x) + checkCell(y) + '</tr>';
    }
    var ages = AGES.map(function (a) {
      var va = (A.scores_by_age || {})[a[0]], vb = (B.scores_by_age || {})[a[0]];
      return '<tr><td class="cn">' + esc(a[1]) + '</td><td>' + (va == null ? '–' : '<b>' + esc(va) + '</b>') + '</td><td>' + (vb == null ? '–' : '<b>' + esc(vb) + '</b>') + '</td></tr>';
    }).join('');
    var sa = Math.round(A.score), sb = Math.round(B.score), label = (AGES.filter(function (a) { return a[0] === state.age; })[0] || [0, ''])[1];
    var passA = ma.filter(function (m) { return m.score; }).length, passB = mb.filter(function (m) { return m.score; }).length;
    var verdict;
    if (sa === sb) verdict = 'Both score ' + sa + ' out of 100 for ' + label + '.';
    else {
      var hi = sa > sb ? A : B, lo = sa > sb ? B : A, hs = Math.max(sa, sb), ls = Math.min(sa, sb);
      var fixed = (hi.metrics || []).filter(function (m, k) { return m.score && lo.metrics && lo.metrics[k] && !lo.metrics[k].score; }).map(function (m) { return m.id === 'hfss' || /^HFSS/i.test(m.name) ? 'not being high in fat, sugar or salt' : m.name.toLowerCase(); });
      verdict = String(hi.name).split('|')[0] + ' scores higher for ' + label + ': ' + hs + ' against ' + ls + ' out of 100' + (fixed.length ? '. It passes ' + fixed.slice(0, 4).join(', ') + ', which the other does not' : '') + '.';
    }
    out.innerHTML = '<p class="verdict">' + esc(verdict) + '</p><div class="scroll"><table class="cmp"><tr><th></th><th>' + esc(String(A.name).split('|')[0]).slice(0, 40) + '</th><th>' + esc(String(B.name).split('|')[0]).slice(0, 40) + '</th></tr>' +
      '<tr class="sum"><td class="cn">Checks passed (of 10)</td><td><b>' + passA + '</b></td><td><b>' + passB + '</b></td></tr>' + rows + '</table></div>' +
      '<h2>Score at every age</h2><div class="scroll"><table class="cmp"><tr><th></th><th>' + esc(String(A.name).split('|')[0]).slice(0, 40) + '</th><th>' + esc(String(B.name).split('|')[0]).slice(0, 40) + '</th></tr>' + ages + '</table></div>' +
      '<p class="fine">Scores are out of 100 for one serving as the label gives it. Packs of different sizes or kinds are compared on their own serving.</p>';
    Array.prototype.forEach.call(document.querySelectorAll('#heads a.nm'), function (a) { a.setAttribute('href', '/products?open=' + a.getAttribute('data-id')); });
  }
  if (state.ida || state.idb) {
    Promise.all([state.ida ? load(state.ida) : null, state.idb ? load(state.idb) : null]).then(function (r) { state.a = r[0]; state.b = r[1]; draw(); });
  } else draw();
})();`;

function build(ctx) {
  const { withMeta, SITE, RECIPE_CSS, NAV, PLATFORM } = ctx;
  const css = RECIPE_CSS + `
.pick{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:14px 0}.pick label{font-size:13px;color:var(--dim);font-weight:600;display:block;margin-bottom:4px}
.pick input,.agebar select{width:100%;font:inherit;padding:10px 12px;border:1.5px solid var(--line);border-radius:12px;background:var(--card);color:var(--ink)}
.res{display:grid;gap:4px;margin-top:6px}.res button{text-align:left;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 10px;font:inherit;color:var(--ink);cursor:pointer}.res button small{display:block;color:var(--dim)}
.agebar{margin:6px 0 4px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}.agebar select{width:auto}
#heads{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:16px 0}.ph{text-align:center;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px 10px}
.ph img{width:84px;height:84px;object-fit:contain;background:#fff;border-radius:12px;border:1px solid var(--line)}.ph .nm{display:block;color:var(--ink);font-weight:700;text-decoration:none;margin-top:6px}.ph small{display:block;color:var(--dim)}
.big{width:68px;height:68px;border-radius:50%;display:grid;place-items:center;color:#fff;font-size:26px;font-weight:700;margin:10px auto 4px}.tr{font-weight:600;font-size:14px}.empty{border:1.5px dashed var(--line);border-radius:16px;padding:36px 10px;text-align:center;color:var(--dim)}
.verdict{font-size:17px;font-weight:600}.scroll{overflow-x:auto}.cmp{width:100%;border-collapse:collapse;font-size:14.5px}.cmp th,.cmp td{padding:9px 6px;border-bottom:1px solid var(--line);text-align:center;vertical-align:top}
.cmp th{font-size:13px;color:var(--dim);font-weight:600}.cmp .cn{text-align:left;width:38%}.cmp small{display:block;color:var(--dim);font-size:12px;font-weight:400}.cmp td.y b{color:#3F6B3C}.cmp td.n b{color:#A6402A}.cmp .sum td{background:rgba(127,127,127,.08)}
.pill{display:inline-block;min-width:38px;color:#fff;border-radius:999px;padding:2px 9px;font-weight:700}
@media(max-width:520px){.pick{grid-template-columns:1fr}.cmp small{display:none}.cmp .cn{width:34%}}`;
  const title = 'Compare two packs: which scores better for your child?';
  const desc = 'Put any two packaged foods side by side: the Poshan Score, the ten yes-or-no checks and the score for every age from toddlers to adults.';
  let html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>${css}</style></head><body>
${NAV}
<main>
<p class="crumb"><a href="/">Home</a> › Compare</p>
<h1>Compare two packs</h1>
<p>Choose two products to see them side by side: the score, each of the ten checks, and the score at every age.</p>
<div class="agebar"><label for="age">Score for</label><select id="age"></select></div>
<div class="pick"><div><label for="qa">First pack</label><input id="qa" type="search" autocomplete="off" placeholder="Search a pack, e.g. Bournvita"><div class="res" id="resa"></div></div>
<div><label for="qb">Second pack</label><input id="qb" type="search" autocomplete="off" placeholder="Search a pack, e.g. Horlicks"><div class="res" id="resb"></div></div></div>
<div id="heads"></div>
<div id="out"></div>
<p style="margin-top:22px"><a class="cta" href="/products">All products</a><a class="cta alt" href="/best">Best by food type</a></p>
<p class="fine">Poshan Score is an independent rating, not a certification, and no brand pays to be here. Label values come from the pack's own page or Open Food Facts. The age guide is general, not medical advice.</p>
</main><script>${CLIENT_JS.replace('__API__', PLATFORM)}</script><script src="/kp-visits.js" defer></script></body></html>`;
  html = withMeta(html, { url: `${SITE}/compare`, title, desc });
  return { html, url: `${SITE}/compare` };
}

module.exports = { build };
