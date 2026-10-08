/* Small "Visitors" count at the bottom right of every KidPoshan page (unique browsers; nothing personal is stored). */
(function () {
  var API = 'https://kidposhan-platform.mailus-pixiedust.workers.dev';
  var local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  function show(n) {
    var el = document.getElementById('kpvc');
    if (!el) {
      el = document.createElement('div'); el.id = 'kpvc';
      el.setAttribute('aria-label', 'Number of visitors');
      el.style.cssText = 'position:fixed;right:8px;bottom:6px;z-index:40;font:11px/1.2 system-ui,-apple-system,Segoe UI,sans-serif;color:#6B5D4B;background:rgba(253,251,246,.75);padding:2px 8px;border-radius:99px;pointer-events:none';
      document.body.appendChild(el);
    }
    el.textContent = 'Visitors ' + Number(n).toLocaleString('en-IN');
  }
  function id() {
    try {
      var v = localStorage.getItem('kp_vid');
      if (!v) { v = Array.prototype.map.call(crypto.getRandomValues(new Uint8Array(12)), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); localStorage.setItem('kp_vid', v); }
      return v;
    } catch (e) { return ''; }
  }
  function go() {
    var vid = local ? '' : id();
    var req = vid
      ? fetch(API + '/api/kp/visit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ vid: vid }) })
      : fetch(API + '/api/kp/visit');
    req.then(function (r) { return r.json(); }).then(function (d) { if (d && d.count != null) show(d.count); }).catch(function () {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
})();
