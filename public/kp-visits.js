/* Counts each browser once, and notes which page was read and for how long (nothing personal is stored: no name, number or IP address).
   The numbers are for the owner's admin page. Nothing is shown on the pages. */
(function () {
  var API = 'https://kidposhan-platform.mailus-pixiedust.workers.dev';
  var local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  function id() {
    try {
      var v = localStorage.getItem('kp_vid');
      if (!v) { v = Array.prototype.map.call(crypto.getRandomValues(new Uint8Array(12)), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); localStorage.setItem('kp_vid', v); }
      return v;
    } catch (e) { return ''; }
  }
  var vid = local ? '' : id();
  if (!vid) return;
  function post(path, body) { return fetch(API + path, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(body), keepalive: true }); }
  post('/api/kp/visit', { vid: vid }).catch(function () {});

  // the page being read now: the address, or for the Meal Ideas app the recipe (or the saved list) that is open
  function currentPath() {
    var h = location.hash || '', m = h.match(/^#\/r\/(\d+)/);
    if (/meal-ideas/.test(location.pathname)) { if (m) return '/meal-ideas/recipe/' + m[1]; if (h === '#/saved') return '/meal-ideas/saved'; }
    return location.pathname;
  }
  var view = null;
  function seconds() { if (view.visible) { view.shown += Date.now() - view.last; } view.last = Date.now(); return Math.round(view.shown / 1000); }
  function flush() {
    if (!view || !view.id) return;
    var s = seconds(); if (s < 1 || s === view.sent) return; view.sent = s;
    var body = JSON.stringify({ id: view.id, tok: view.tok, seconds: s });
    try { if (!(navigator.sendBeacon && navigator.sendBeacon(API + '/api/kp/pv/time', new Blob([body], { type: 'text/plain' })))) post('/api/kp/pv/time', JSON.parse(body)); } catch (e) {}
  }
  function start() {
    if (view) flush();
    var v = view = { id: null, tok: null, shown: 0, last: Date.now(), visible: document.visibilityState === 'visible', sent: 0 };
    post('/api/kp/pv', { vid: vid, path: currentPath() }).then(function (r) { return r.json(); }).then(function (d) { if (d && d.id) { v.id = d.id; v.tok = d.tok; } }).catch(function () {});
  }
  document.addEventListener('visibilitychange', function () { if (!view) return; seconds(); view.visible = document.visibilityState === 'visible'; view.last = Date.now(); if (!view.visible) flush(); });
  window.addEventListener('pagehide', flush);
  window.addEventListener('hashchange', function () { var p = currentPath(); if (!view || p !== view.path) { start(); view.path = p; } });
  start(); view.path = currentPath();
})();
