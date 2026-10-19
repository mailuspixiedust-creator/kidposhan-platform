/* Counts each browser once, quietly (nothing personal is stored). The count is for the owner's admin page; it is not shown on the pages. */
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
  function go() {
    var vid = local ? '' : id();
    if (!vid) return;
    fetch(API + '/api/kp/visit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ vid: vid }) }).catch(function () {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
})();
