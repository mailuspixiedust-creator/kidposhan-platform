/* The ingredient checklist on a recipe page: tick "At home" or "To buy". What is to buy is listed under the stores of the visitor's country
   (the store list is in /kp-buy.js), with a button to copy the list or send it on WhatsApp. The ticks stay on this device only. */
(function () {
  var box = document.querySelector('.shop'); if (!box) return;
  var id = box.getAttribute('data-id'), key = 'kp_shop_' + id, title = box.getAttribute('data-title') || 'Shopping list', pageUrl = box.getAttribute('data-url') || location.href;
  var rows = Array.prototype.slice.call(box.querySelectorAll('.ingrow')), panel = box.querySelector('.tobuy');
  var st = {}; try { st = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch (e) {}
  var cc = null, ready = false;
  function save() { try { localStorage.setItem(key, JSON.stringify(st)); } catch (e) {} }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function stores() { var b = window.kpBuy; if (!b) return []; return cc ? (b.sets[cc] || b.other) : b.sets.IN; }
  function href(s, q) { return s[3] ? s[2] : s[2] + encodeURIComponent(q) + (s[4] || ''); }
  function oldCopy(t) { try { var x = document.createElement('textarea'); x.value = t; x.setAttribute('readonly', ''); x.style.cssText = 'position:fixed;top:0;left:0;opacity:0'; document.body.appendChild(x); x.select(); var ok = document.execCommand('copy'); document.body.removeChild(x); return ok; } catch (e) { return false; } }
  function copy(t) { try { if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t).then(function () { return true; }, function () { return oldCopy(t); }); } catch (e) {} return Promise.resolve(oldCopy(t)); }
  function render() {
    rows.forEach(function (r) {
      var s = st[r.getAttribute('data-i')];
      r.querySelector('[data-s=home]').checked = s === 'home'; r.querySelector('[data-s=buy]').checked = s === 'buy'; r.classList.toggle('isbuy', s === 'buy');
    });
    var items = rows.filter(function (r) { return st[r.getAttribute('data-i')] === 'buy'; });
    if (!items.length || !ready) { panel.hidden = true; panel.innerHTML = ''; return; }
    var lines = items.map(function (r) { return r.getAttribute('data-line'); });
    var text = title + '\n' + lines.map(function (l) { return '- ' + l; }).join('\n') + '\n\n' + pageUrl;
    var h = '<b>' + items.length + (items.length === 1 ? ' item' : ' items') + ' to buy</b>';
    stores().forEach(function (s) {
      h += '<div class="tbs"><b>' + esc(s[1]) + '</b><div class="tbl">' + items.map(function (r) { var q = r.getAttribute('data-q'); return '<a data-buy="' + esc(s[0]) + '" data-q="' + esc(q) + '" href="' + esc(href(s, q)) + '" target="_blank" rel="nofollow noopener">' + esc(q) + '</a>'; }).join('') + '</div></div>';
    });
    h += '<div class="tbt"><button type="button" class="cp" data-buy="shop-copy" data-q="' + esc(id) + '">Copy this list</button><a class="wa" data-buy="list-whatsapp" data-q="' + esc(id) + '" target="_blank" rel="noopener" href="https://wa.me/?text=' + encodeURIComponent(text) + '">Send it on WhatsApp</a></div>';
    h += '<p class="fine">Each link searches that item in the store. The apps do not let a website fill a cart, so tapping also copies the item name. We earn nothing from these links.</p>';
    panel.innerHTML = h; panel.hidden = false;
    panel.querySelector('.cp').onclick = function (e) { var b = e.currentTarget; copy(text).then(function (ok) { b.textContent = ok ? 'Copied' : 'Could not copy'; setTimeout(function () { b.textContent = 'Copy this list'; }, 2500); }); };
  }
  box.addEventListener('change', function (e) {
    var inp = e.target; if (!inp.getAttribute || !inp.getAttribute('data-s')) return;
    var i = inp.closest('.ingrow').getAttribute('data-i'), s = inp.getAttribute('data-s');
    if (inp.checked) st[i] = s; else if (st[i] === s) delete st[i];
    save(); render();
  });
  box.querySelector('.shopall').addEventListener('click', function () { rows.forEach(function (r) { var i = r.getAttribute('data-i'); if (st[i] !== 'home') st[i] = 'buy'; }); save(); render(); });
  render();
  // the country decides which stores are shown; if it cannot be found, the Indian stores are shown after a moment
  if (window.kpBuy) window.kpBuy.country(function (c) { cc = c; ready = true; render(); });
  setTimeout(function () { if (!ready) { ready = true; render(); } }, 2500);
})();
