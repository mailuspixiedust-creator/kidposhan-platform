/* "Buy" links that fit the visitor's country. The page ships with the Indian quick-commerce apps; this swaps in the main grocery or delivery
   services of the visitor's country (the country comes from the site's own server, nothing else is sent). Every link is a plain search, no affiliate code.
   A tap also copies the item's name, so it can be pasted into the app's search box if the app opens without the search. */
(function () {
  if (window.__kpBuy) return; window.__kpBuy = 1;
  var API = 'https://kidposhan-platform.mailus-pixiedust.workers.dev';
  var S = {
    IN: [['blinkit', 'Blinkit', 'https://blinkit.com/s/?q='], ['zepto', 'Zepto', 'https://www.zepto.com/search?query='], ['instamart', 'Swiggy Instamart', 'https://www.swiggy.com/instamart/search?custom_back=true&query=']],
    US: [['doordash', 'DoorDash', 'https://www.doordash.com/search/store/', 0, '/'], ['instacart', 'Instacart', 'https://www.instacart.com/store/s?k='], ['walmart', 'Walmart', 'https://www.walmart.com/search?q='], ['amazon', 'Amazon Fresh', 'https://www.amazon.com/s?i=amazonfresh&k=']],
    CA: [['instacart', 'Instacart', 'https://www.instacart.ca/store/s?k='], ['walmart', 'Walmart', 'https://www.walmart.ca/search?q='], ['voila', 'Voila', 'https://voila.ca/search?q='], ['superstore', 'Real Canadian Superstore', 'https://www.realcanadiansuperstore.ca/en/search?search-bar=']],
    PH: [['pandamart', 'foodpanda pandamart', 'https://www.foodpanda.ph/pandamart/', 1], ['lazada', 'Lazada', 'https://www.lazada.com.ph/catalog/?q=']],
    GB: [['ocado', 'Ocado', 'https://www.ocado.com/search?entry='], ['tesco', 'Tesco', 'https://www.tesco.com/groceries/en-GB/search?query='], ['sainsburys', "Sainsbury's", 'https://www.sainsburys.co.uk/gol-ui/SearchResults/']],
    IE: [['tesco', 'Tesco', 'https://www.tesco.ie/groceries/en-IE/search?query='], ['amazon', 'Amazon', 'https://www.amazon.ie/s?k=']],
    AU: [['woolworths', 'Woolworths', 'https://www.woolworths.com.au/shop/search/products?searchTerm='], ['coles', 'Coles', 'https://www.coles.com.au/search/products?q='], ['amazon', 'Amazon', 'https://www.amazon.com.au/s?k=']],
    NZ: [['woolworths', 'Woolworths', 'https://www.woolworths.co.nz/shop/searchproducts?search='], ['amazon', 'Amazon', 'https://www.amazon.com.au/s?k=']],
    AE: [['noon', 'noon', 'https://www.noon.com/uae-en/search/?q='], ['carrefour', 'Carrefour', 'https://www.carrefouruae.com/mafuae/en/search?keyword='], ['amazon', 'Amazon', 'https://www.amazon.ae/s?k=']],
    SA: [['noon', 'noon', 'https://www.noon.com/saudi-en/search/?q='], ['amazon', 'Amazon', 'https://www.amazon.sa/s?k=']],
    SG: [['fairprice', 'FairPrice', 'https://www.fairprice.com.sg/search?query='], ['amazon', 'Amazon', 'https://www.amazon.sg/s?k=']],
    DE: [['rewe', 'REWE', 'https://shop.rewe.de/productList?search='], ['amazon', 'Amazon', 'https://www.amazon.de/s?k=']]
  };
  var OTHER = [['web', 'Search online', 'https://www.google.com/search?q=buy+']];
  function swap(cc) {
    var set = S[cc] || (cc ? OTHER : null); if (!set || cc === 'IN') return;
    var boxes = document.querySelectorAll('.buy:not(.buyr), .buyr li');
    Array.prototype.forEach.call(boxes, function (box) {
      var olds = box.querySelectorAll('a[data-buy]'); if (!olds.length) return;
      var q = olds[0].getAttribute('data-q') || '';
      set.forEach(function (st) {
        var a = document.createElement('a'); a.setAttribute('data-buy', st[0]); a.setAttribute('data-q', q);
        a.href = st[3] ? st[2] : st[2] + encodeURIComponent(q) + (st[4] || ''); a.target = '_blank'; a.rel = 'nofollow noopener'; a.textContent = st[1];
        olds[0].parentNode.insertBefore(a, olds[0]);
      });
      Array.prototype.forEach.call(olds, function (o) { o.parentNode.removeChild(o); });
    });
    var h = document.querySelector('.buyr summary'); if (h) h.textContent = 'Get the ingredients delivered';
    var ph = document.querySelector('.buy:not(.buyr) > b'); if (ph) ph.textContent = cc === 'IN' ? 'Find it on' : 'Find it at';
  }
  // the visitor's country: ?cc=XX in the address (to try another country), else the one saved for this visit, else asked from our server once
  var asked = null;
  function country(cb) {
    var want = (location.search + ' ' + location.hash).match(/[?&]cc=([A-Za-z]{2})\b/);
    if (want) return cb(want[1].toUpperCase());
    var cached = ''; try { cached = sessionStorage.getItem('kp_cc') || ''; } catch (e) {}
    if (cached) return cb(cached);
    if (!asked) asked = fetch(API + '/api/kp/geo').then(function (r) { return r.json(); }).then(function (d) { var cc = d && d.country; if (cc) { try { sessionStorage.setItem('kp_cc', cc); } catch (e) {} } return cc || ''; }).catch(function () { return ''; });
    asked.then(function (cc) { if (cc) cb(cc); });
  }
  // the Meal Ideas app builds its own "To buy" links from these
  window.kpBuy = { sets: S, other: OTHER, country: country };
  country(swap);

  var toast;
  function say(t) {
    if (!toast) { toast = document.createElement('div'); toast.setAttribute('role', 'status'); toast.style.cssText = 'position:fixed;left:12px;right:12px;bottom:14px;max-width:460px;margin:0 auto;background:#222;color:#fff;border-radius:12px;padding:12px 14px;font:14px system-ui;z-index:99;box-shadow:0 6px 24px rgba(0,0,0,.3)'; document.body.appendChild(toast); }
    toast.textContent = t; toast.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(function () { toast.style.display = 'none'; }, 5000);
  }
  function old(t) { try { var x = document.createElement('textarea'); x.value = t; x.setAttribute('readonly', ''); x.style.cssText = 'position:fixed;top:0;left:0;opacity:0'; document.body.appendChild(x); x.select(); var ok = document.execCommand('copy'); document.body.removeChild(x); return ok; } catch (e) { return false; } }
  function copy(t) { try { if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t).then(function () { return true; }, function () { return old(t); }); } catch (e) {} return Promise.resolve(old(t)); }
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-buy]'); if (!el) return;
    if (el.tagName === 'BUTTON' && el.getAttribute('data-buy') === 'list-copy') {
      var lines = []; try { lines = JSON.parse(el.getAttribute('data-items')); } catch (x) {}
      copy(el.getAttribute('data-title') + '\n' + lines.map(function (l) { return '- ' + l; }).join('\n')).then(function (ok) { say(ok ? 'Shopping list copied. Paste it into any note, message or the store app.' : 'Could not copy. Use the WhatsApp button instead.'); });
      return;
    }
    var q = el.getAttribute('data-q');
    if (el.tagName === 'A' && q && el.getAttribute('data-buy') !== 'list-whatsapp') copy(q).then(function (ok) { if (ok) say('Copied "' + q + '". If the app opens without the search, paste it into its search box.'); });
  }, true);
})();
