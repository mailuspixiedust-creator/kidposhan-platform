/* One search for the whole site: type a recipe or a product ("ragi dosa", "Saffola") and jump to it. Adds a Search button to the header of every page. */
(function () {
  var API = 'https://kidposhan-platform.mailus-pixiedust.workers.dev';
  var css = '.kps-btn{margin-left:auto;display:inline-flex;align-items:center;gap:7px;height:38px;padding:0 13px;border-radius:999px;border:1px solid #E7DFCE;background:#fff;color:#221A12;font:600 13px/1 system-ui,-apple-system,Segoe UI,sans-serif;cursor:pointer;flex-shrink:0}'
    + '.kps-btn svg{width:16px;height:16px}.kps-btn:focus-visible{outline:3px solid #221A12;outline-offset:2px}'
    + '.nb-burger,.hamburger{margin-left:10px!important}'
    + '.brand-name,.nb-name{white-space:nowrap}.brand-name b,.nb-name b{white-space:nowrap}'
    + '@media(max-width:560px){.nav-cta,.nb-cta{display:none!important}.brand-name,.nb-name{font-size:16px!important}.brand-mark,.nb-mark{flex-shrink:0}nav{gap:8px}}'
    + '@media(max-width:520px){.kps-btn span{display:none}.kps-btn{padding:0 11px}}'
    + '.kps-bg{position:fixed;inset:0;z-index:400;background:rgba(20,15,8,.55);display:flex;justify-content:center;align-items:flex-start;padding:12px;box-sizing:border-box}'
    + '.kps{width:min(620px,100%);max-height:calc(100vh - 24px);overflow:auto;overflow-x:hidden;background:#FDFBF6;color:#221A12;border-radius:18px;box-shadow:0 24px 60px rgba(0,0,0,.4);font-family:system-ui,-apple-system,Segoe UI,sans-serif}'
    + '.kps form{display:flex;gap:8px;padding:14px;border-bottom:1px solid #E7DFCE;position:sticky;top:0;background:#FDFBF6}'
    + '.kps input{flex:1;min-width:0;font:inherit;font-size:17px;padding:11px 14px;border:1.5px solid #D9CFB8;border-radius:12px;background:#fff;color:#221A12}'
    + '.kps input:focus{outline:3px solid #3F6B3C;outline-offset:1px}'
    + '.kps .x{border:0;background:none;font-size:28px;line-height:1;cursor:pointer;color:#6B5D4B;padding:0 8px}'
    + '.kps h3{margin:0;padding:12px 16px 4px;font:700 12px/1 system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#6B5D4B}'
    + '.kps ul{list-style:none;margin:0;padding:0 8px 8px}'
    + '.kps li a{display:flex;align-items:center;gap:12px;padding:9px 8px;border-radius:12px;text-decoration:none;color:inherit}'
    + '.kps li a:hover,.kps li a:focus-visible{background:#F6F0E4;outline:none}'
    + '.kps .th{width:46px;height:46px;border-radius:10px;background:#E3EEDF center/cover no-repeat;flex-shrink:0}'
    + '.kps .nm{flex:1;min-width:0;font-weight:600;font-size:15px;line-height:1.25}.kps .nm small{display:block;font-weight:400;color:#6B5D4B;font-size:12.5px;margin-top:2px}'
    + '.kps .sc{min-width:42px;text-align:center;border-radius:999px;padding:5px 8px;font:800 14px/1 system-ui,sans-serif;color:#fff;background:#3F6B3C}'
    + '.kps .sc[data-b="OK"]{background:#B5790A}.kps .sc[data-b="Do not use"]{background:#A6402A}'
    + '.kps .msg{padding:18px 16px;color:#6B5D4B;font-size:14.5px}'
    + '.kps .eg{display:flex;flex-wrap:wrap;gap:8px;padding:0 16px 16px}.kps .eg button{font:inherit;font-size:14px;padding:7px 13px;border-radius:999px;border:1.5px solid #D9CFB8;background:#fff;color:#221A12;cursor:pointer}.kps .eg button:hover{border-color:#B5790A;background:#FFF8E6}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  var band = function (v, capped) { return capped ? 'OK' : v >= 80 ? 'Good' : v >= 50 ? 'OK' : 'Do not use'; };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var nice = function (n) { var t = String(n || '').split('|')[0].replace(/\(.*?\)/g, '').replace(/\brecipes?\b/ig, '').replace(/\s+/g, ' ').trim(); return t || String(n || ''); };
  var onMeal = /meal-ideas/.test(location.pathname);
  // the age (in months) chosen on the Meal Ideas page, if any: scores in the results are for that age
  function chosenAge() { try { var c = JSON.parse(localStorage.getItem('kp_choices') || '{}'); var a = (c.age || []).filter(Number.isFinite); return a.length ? Math.min.apply(null, a) : null; } catch (e) { return null; } }

  function open(opener, prefill, only) {
    var bg = document.createElement('div'); bg.className = 'kps-bg';
    bg.innerHTML = '<div class="kps" role="dialog" aria-modal="true" aria-label="Search recipes and products"><form role="search"><input type="search" name="q" placeholder="Try: tangy lunchbox for 9 year, or ragi dosa" aria-label="Search" autocomplete="off" maxlength="80"><button class="x" type="button" aria-label="Close search">×</button></form><div class="out" aria-live="polite"></div></div>';
    document.body.appendChild(bg);
    var input = bg.querySelector('input'), out = bg.querySelector('.out'), timer = 0, seq = 0;
    var close = function () { bg.remove(); document.removeEventListener('keydown', onKey); opener && opener.focus && opener.focus(); };
    var onKey = function (e) { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    bg.addEventListener('click', function (e) { if (e.target === bg) close(); });
    bg.querySelector('.x').onclick = close;
    bg.querySelector('form').onsubmit = function (e) { e.preventDefault(); run(); };
    input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(run, 250); });
    out.addEventListener('click', function (e) { var a = e.target.closest('a'); if (a && onMeal && /meal-ideas.*#\/r\//.test(a.getAttribute('href'))) { e.preventDefault(); location.hash = a.getAttribute('href').split('#')[1]; close(); } });
    function row(href, img, name, sub, score, b) { return '<li><a href="' + esc(href) + '"><span class="th"' + (img ? ' style="background-image:url(\'' + esc(img) + '\')"' : '') + '></span><span class="nm">' + esc(name) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span>' + (score != null ? '<span class="sc" data-b="' + b + '">' + Math.round(score) + '</span>' : '') + '</a></li>'; }
    var EXAMPLES = ['tangy meal for 9 year', 'sweet snack for 5 year', 'mild dinner for toddler', 'spicy veg lunch for 12 year', 'crunchy snack', 'creamy breakfast for 4 year'];
    function intro() { out.innerHTML = '<p class="msg">Search by name, or describe what you want in your own words: a taste, a meal and your child\'s age.</p><div class="eg">' + EXAMPLES.map(function (e) { return '<button type="button" data-q="' + esc(e) + '">' + esc(e) + '</button>'; }).join('') + '</div>'; }
    out.addEventListener('click', function (e) { var b = e.target.closest('.eg button'); if (b) { input.value = b.getAttribute('data-q'); run(); input.focus(); } });
    function run() {
      var q = input.value.trim(); if (q.length < 2) { intro(); return; }
      var my = ++seq; out.innerHTML = '<p class="msg">Searching…</p>';
      fetch(API + '/api/kp/search?q=' + encodeURIComponent(q) + (chosenAge() ? '&age_months=' + chosenAge() : '') + (only === 'recipes' ? '&only=recipes' : '')).then(function (r) { return r.json(); }).then(function (d) {
        if (my !== seq) return;
        var h = d.age_label && ((d.recipes && d.recipes.length) || (d.products && d.products.length)) ? '<p class="msg" style="padding-bottom:0">Scores are for ' + esc(d.age_label) + '. Pick your child\'s age on Meal Ideas or Products to change it.</p>' : '';
        if (d.understood) h = ((d.recipes && d.recipes.length) || (d.products && d.products.length) ? '<p class="msg" style="padding-bottom:0">Showing <b>' + esc(d.understood.text) + '</b>. Scores are for that age. Best score first, among the ones that fit.</p>' : '<p class="msg">We found no recipe that fits <b>' + esc(d.understood.text) + '</b>. Try leaving out the taste or the meal, or a different age.</p><div class="eg">' + EXAMPLES.slice(0, 4).map(function (e) { return '<button type="button" data-q="' + esc(e) + '">' + esc(e) + '</button>'; }).join('') + '</div>');
        if (d.recipes && d.recipes.length) h += '<h3>Recipes</h3><ul>' + d.recipes.map(function (r) { return row('/meal-ideas#/r/' + r.id, r.image_url, nice(r.name), r.total_minutes ? (r.total_minutes >= 240 ? 'Make ahead' : r.total_minutes + ' min') : '', r.score, band(r.score, r.capped)); }).join('') + '</ul>';
        if (d.products && d.products.length) h += '<h3>Products</h3><ul>' + d.products.map(function (p) { return row('/products?open=' + p.id, p.image_url, p.name, [p.brand, p.category, p.unchecked ? 'not yet checked' : ''].filter(Boolean).join(' · '), p.score, p.band); }).join('') + '</ul>';
        out.innerHTML = h || '<p class="msg">We have not scored "' + esc(q) + '" yet. We are adding the best-known kids\' foods first, and what you search for helps us choose. Try one word, like "oats" or "ragi".</p>';
      }).catch(function () { if (my === seq) out.innerHTML = '<p class="msg">Search is not available just now. Please try again.</p>'; });
    }
    input.focus();
    if (prefill) { input.value = prefill; run(); } else intro();
  }
  // open(q, opener, { only: 'recipes' }) leaves the packs out
  window.kpSearch = { open: function (q, opener, opts) { open(opener || null, q, opts && opts.only); } };

  function init() {
    var nav = document.querySelector('nav'); if (!nav || document.querySelector('.kps-btn')) return;
    var b = document.createElement('button'); b.type = 'button'; b.className = 'kps-btn'; b.setAttribute('aria-label', 'Search recipes and products');
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2.2"/><path d="M20 20l-4-4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg><span>Search</span>';
    b.onclick = function () { open(b); };
    var before = nav.querySelector('.nb-burger, .hamburger');
    if (before) nav.insertBefore(b, before); else nav.appendChild(b);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

/* Beta: a pill by the logo, a line in the footer, and the "Report a mistake" window (used by the scan, product and Products pages). */
(function () {
  var API = 'https://kidposhan-platform.mailus-pixiedust.workers.dev';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var css = '.kp-beta{display:inline-block;margin-left:7px;padding:1px 7px;border-radius:999px;border:1.5px solid #B5790A;color:#B5790A;font:700 10px/1.5 system-ui,sans-serif;letter-spacing:.1em;vertical-align:middle;-webkit-text-fill-color:#B5790A}'
    + '.kp-betafoot{margin:10px auto 0;max-width:720px;padding:0 16px;text-align:center;font-size:13px;opacity:.85}.kp-betafoot a{color:inherit}'
    + '.kprep-bg{position:fixed;inset:0;background:rgba(20,15,8,.55);display:grid;place-items:center;z-index:400;padding:16px}.kprep{background:var(--bg,#FDFBF6);color:var(--ink,#221A12);border-radius:18px;padding:20px;width:min(440px,100%);max-height:90vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.35);font:16px/1.45 system-ui,sans-serif}'
    + '.kprep h2{margin:0 0 4px;font-size:21px}.kprep p{margin:0 0 10px;color:var(--muted,#6B5D4B);font-size:14.5px}.kprep label.o{display:flex;gap:10px;align-items:flex-start;padding:9px 10px;border:1.5px solid var(--line,#E7DFCE);border-radius:12px;margin:6px 0;cursor:pointer}.kprep label.o input{margin-top:3px}'
    + '.kprep textarea,.kprep input[type=email]{width:100%;box-sizing:border-box;border:1.5px solid var(--line,#E7DFCE);border-radius:12px;padding:10px 12px;font:inherit;background:var(--paper,#fff);color:inherit;margin-top:6px}'
    + '.kprep .row{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}.kprep button{font:700 15px system-ui,sans-serif;border-radius:12px;padding:11px 18px;cursor:pointer;border:1.5px solid var(--leaf,#3F6B3C);background:var(--leaf,#3F6B3C);color:#fff}.kprep button.alt{background:none;color:var(--leaf,#3F6B3C)}.kprep .msg{margin-top:10px;font-size:14.5px}';
  function addCss() { if (document.getElementById('kp-beta-css')) return; var s = document.createElement('style'); s.id = 'kp-beta-css'; s.textContent = css; document.head.appendChild(s); }
  function ready(fn) { if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }
  ready(function () {
    addCss();
    var brand = document.querySelector('.nb-name, .brand-name');
    if (brand && !document.querySelector('.kp-beta')) { var s = document.createElement('span'); s.className = 'kp-beta'; s.textContent = 'BETA'; s.title = 'Poshan Score is a beta, built with parents'; brand.appendChild(s); }
    var f = document.querySelector('footer');
    if (f && !f.querySelector('.kp-betafoot')) { var p = document.createElement('p'); p.className = 'kp-betafoot'; p.innerHTML = 'Poshan Score is a <b>beta</b>, built with parents. <a href="/built-with-parents">How it works, and how to help</a>'; f.appendChild(p); }
  });
  window.kpReport = function (o) {
    addCss();
    var bg = document.createElement('div'); bg.className = 'kprep-bg';
    bg.innerHTML = '<div class="kprep" role="dialog" aria-modal="true" aria-labelledby="kprh"><h2 id="kprh">Report a mistake</h2><p>' + esc(o && o.name ? o.name : 'This pack') + '. Thank you for helping us get it right.</p>'
      + '<form><label class="o"><input type="radio" name="r" value="name" checked><span>The name is different from my pack</span></label>'
      + '<label class="o"><input type="radio" name="r" value="numbers"><span>The numbers do not match the label</span></label>'
      + '<label class="o"><input type="radio" name="r" value="photo"><span>The photo is wrong</span></label>'
      + '<label class="o"><input type="radio" name="r" value="other"><span>Something else</span></label>'
      + '<textarea rows="3" maxlength="600" placeholder="What does your pack say? (optional, except for Something else)" aria-label="What is wrong"></textarea>'
      + '<input type="email" placeholder="Your email, if you want to hear what we did (optional)" aria-label="Your email, optional">'
      + '<div class="row"><button type="submit">Send</button><button type="button" class="alt kprc">Close</button></div><div class="msg" role="status"></div></form></div>';
    function close() { bg.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey); bg.onclick = function (e) { if (e.target === bg) close(); }; bg.querySelector('.kprc').onclick = close;
    bg.querySelector('form').onsubmit = function (e) {
      e.preventDefault(); var msg = bg.querySelector('.msg'), reason = bg.querySelector('input[name=r]:checked').value;
      msg.textContent = 'Sending…';
      fetch(API + '/api/kp/report', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ reason: reason, note: bg.querySelector('textarea').value, email: bg.querySelector('input[type=email]').value, product_id: o && o.product_id, barcode: o && o.barcode }) })
        .then(function (r) { return r.json().then(function (j) { return [r.ok, j]; }); })
        .then(function (x) { msg.textContent = x[0] ? 'Thank you. We will look at it.' : (x[1].error || 'Something went wrong. Please try again.'); if (x[0]) bg.querySelector('form').querySelector('button[type=submit]').disabled = true; })
        .catch(function () { msg.textContent = 'No connection. Please try again.'; });
    };
    document.body.appendChild(bg); bg.querySelector('input').focus();
  };
})();
