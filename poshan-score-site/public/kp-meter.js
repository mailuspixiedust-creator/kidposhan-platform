/* The Poshan meter: a fuel-gauge style dial with the four score zones, and the "biggest claim" card.
   kpMeter({score, band, capped}) -> HTML.  kpClaimCard(claim) -> HTML.  kpMeter.animate(root) swings the needles into place.
   Zones are the real tiers: Do not use 0-49, OK 50-79, Good 80-100. */
(function () {
  var CSS = '.kpm{display:grid;justify-items:center;gap:2px;max-width:340px;margin:0 auto}.kpm svg{width:100%;height:auto;display:block;overflow:visible}'
    + '.kpm-needle{transition:transform 1.4s cubic-bezier(.2,.9,.25,1.05)}.kpm-score{font:700 40px/1 var(--display,Georgia,serif);fill:var(--ink,#221A12)}.kpm-tier{font:700 13px var(--body,sans-serif);letter-spacing:.08em;text-transform:uppercase;fill:var(--muted,#6B5D4B)}'
    + '.kpm-tick{font:600 10px var(--body,sans-serif);fill:var(--muted,#6B5D4B)}.kpm-cap{font:700 10px var(--body,sans-serif);fill:#A6402A}'
    + '.kpm-nd,.kpm-hub{fill:var(--ink,#221A12)}.kpm-hub2{fill:var(--bg,#fff)}.kpm-note{font-size:12.5px;color:var(--muted,#6B5D4B);text-align:center;margin:2px 0 0}'
    + '.kpm-verdict{margin:6px 0 0;text-align:center;font-size:16px}.kpm-verdict b{font-size:18px}.kpm-why{margin:2px 0 0;text-align:center;font-size:13.5px;color:#A6402A;font-weight:600}'
    + '.kpm-leg{list-style:none;margin:12px 0 0;padding:0;display:grid;gap:6px;width:100%}.kpm-leg li{display:grid;grid-template-columns:14px 62px 90px minmax(0,1fr);gap:8px;align-items:baseline;font-size:13.5px;padding:6px 8px;border-radius:10px;border:1.5px solid transparent}'
    + '.kpm-leg li.on{border-color:var(--ink,#221A12);background:var(--paper,var(--card,#fff));color:var(--ink,#221A12)}.kpm-leg i{width:14px;height:14px;border-radius:4px;align-self:center}.kpm-leg .r{color:var(--muted,#6B5D4B);font-variant-numeric:tabular-nums}.kpm-leg .n{font-weight:700}.kpm-leg .m{color:var(--ink,#221A12)}'
    + '.kpm-fine{font-size:12px;color:var(--muted,#6B5D4B);text-align:center;margin:8px 0 0}'
    + '@media(max-width:420px){.kpm-leg li{grid-template-columns:14px 52px 80px minmax(0,1fr);font-size:12.5px}}'
    + '.kpc{border:1.5px solid var(--line,#E7DFCE);border-radius:16px;padding:14px 16px;background:var(--paper,#fff);display:grid;gap:6px}'
    + '.kpc-k{font:700 11px var(--body,sans-serif);letter-spacing:.1em;text-transform:uppercase;color:var(--muted,#6B5D4B)}'
    + '.kpc-big{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}.kpc-big b{font:700 34px/1 var(--display,Georgia,serif)}.kpc-big span{font-size:15px;color:var(--ink,#221A12)}'
    + '.kpc-bar{height:10px;border-radius:99px;background:var(--line,#E7DFCE);overflow:hidden}.kpc-bar i{display:block;height:100%;background:var(--leaf,#3F6B3C);border-radius:99px}'
    + '.kpc.warn .kpc-bar i{background:#A6402A}.kpc p{margin:0;font-size:14.5px}.kpc small{color:var(--muted,#6B5D4B);font-size:13px}';
  var ZONES = [[0, 50, '#BE4430', 'Do not use'], [50, 80, '#E3A008', 'OK'], [80, 100, '#3F6B3C', 'Good']];
  var MEANING = { Good: 'Fine most days, with variety.', OK: 'Some days, not every day.', 'Do not use': 'Better left on the shelf for a child.' };
  var CX = 110, CY = 112, R = 92;
  function pt(s, r) { var a = (180 - s * 1.8) * Math.PI / 180; return [CX + r * Math.cos(a), CY - r * Math.sin(a)]; }
  function arc(s0, s1, r) { var p0 = pt(s0, r), p1 = pt(s1, r); return 'M' + p0[0].toFixed(2) + ' ' + p0[1].toFixed(2) + ' A' + r + ' ' + r + ' 0 0 1 ' + p1[0].toFixed(2) + ' ' + p1[1].toFixed(2); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function css() { if (document.getElementById('kpm-css')) return; var s = document.createElement('style'); s.id = 'kpm-css'; s.textContent = CSS; document.head.appendChild(s); }

  function kpMeter(o) {
    css();
    var sc = Math.max(0, Math.min(100, Math.round(+o.score || 0)));
    var tier = o.band || (sc >= 80 ? 'Good' : sc >= 50 ? 'OK' : 'Do not use');
    var rot = -90 + sc * 1.8;
    var zones = ZONES.map(function (z) { return '<path d="' + arc(z[0] + (z[0] ? .6 : 0), z[1] - .6, R) + '" stroke="' + z[2] + '" stroke-width="22" fill="none" stroke-linecap="butt"/>'; }).join('');
    var ticks = [0, 50, 80, 100].map(function (s) { var p = pt(s, R + 18); return '<text class="kpm-tick" x="' + p[0].toFixed(1) + '" y="' + (p[1] + 3).toFixed(1) + '" text-anchor="middle">' + s + '</text>'; }).join('');
    var cap = '';
    if (o.capped) { var a = pt(79.5, R - 15), b = pt(79.5, R + 13), t = pt(79.5, R + 27); cap = '<line x1="' + a[0].toFixed(1) + '" y1="' + a[1].toFixed(1) + '" x2="' + b[0].toFixed(1) + '" y2="' + b[1].toFixed(1) + '" stroke="#A6402A" stroke-width="3"/><text class="kpm-cap" x="' + t[0].toFixed(1) + '" y="' + (t[1] - 2).toFixed(1) + '" text-anchor="middle">held at OK</text>'; }
    var label = 'Poshan Score ' + sc + ' out of 100, ' + tier + (o.capped ? ', held at OK by a high sodium, sugar or saturated fat reading' : '');
    return '<div class="kpm"><svg viewBox="0 0 220 178" role="img" aria-label="' + esc(label) + '">'
      + zones + ticks + cap
      + '<g transform="translate(' + CX + ' ' + CY + ')"><g class="kpm-needle" data-rot="' + rot + '" style="transform:rotate(-90deg)"><path class="kpm-nd" d="M-4 0 L0 -76 L4 0 Z"/></g><circle class="kpm-hub" r="8"/><circle class="kpm-hub2" r="3"/></g>'
      + '<text class="kpm-score" x="' + CX + '" y="' + (CY + 42) + '" text-anchor="middle">' + sc + '</text>'
      + '<text class="kpm-tier" x="' + CX + '" y="' + (CY + 62) + '" text-anchor="middle">' + esc(tier) + '</text></svg>'
      + (o.note ? '<p class="kpm-note">' + esc(o.note) + '</p>' : '')
      + (o.verdict !== false ? '<p class="kpm-verdict"><b>' + esc(o.capped ? 'OK' : tier) + '.</b> ' + esc(MEANING[o.capped ? 'OK' : tier] || '') + '</p>' : '')
      + (o.capped ? '<p class="kpm-why">The number is ' + sc + ', but it is held at OK' + (o.why && o.why.length ? ' because ' + esc(o.why.join(' and ')) + (o.why.length > 1 ? ' are' : ' is') + ' high' : ' because a risk reading is high') + '.</p>' : '')
      + (o.legend ? legend(o.capped ? 'OK' : tier) : '') + '</div>';
  }
  function legend(tier) {
    var rows = ZONES.slice().reverse().map(function (z) { return '<li class="' + (z[3] === tier ? 'on' : '') + '"><i style="background:' + z[2] + '"></i><span class="r">' + z[0] + '–' + (z[1] === 100 ? 100 : z[1] - 1) + '</span><span class="n">' + z[3] + '</span><span class="m">' + MEANING[z[3]] + '</span></li>'; }).join('');
    return '<ul class="kpm-leg" aria-label="What each zone means">' + rows + '</ul><p class="kpm-fine">How often this is a good choice for a child of this age, one serving at a time. A guide, not medical advice.</p>';
  }
  // which risk readings hold a pack down (sugar, sodium, saturated fat, trans fat scoring 3 or less)
  kpMeter.why = function (metrics) {
    var names = { sugar: 'added sugar', sodium: 'sodium', satfat: 'saturated fat', trans: 'trans fat' };
    return (metrics || []).filter(function (m) { return names[m.id] && m.score === 0; }).map(function (m) { return names[m.id]; });
  };
  kpMeter.animate = function (root) {
    (root || document).querySelectorAll('.kpm-needle').forEach(function (n) { var r = n.getAttribute('data-rot'); requestAnimationFrame(function () { requestAnimationFrame(function () { n.style.transform = 'rotate(' + r + 'deg)'; }); }); });
  };

  // the biggest claim on the pack, against what the ingredient list says
  function kpClaimCard(c) {
    css();
    if (!c) return '';
    var warn = !c.found || (c.percent != null && c.percent < 20 && !c.grains);
    var big = !c.found ? '0%' : c.percent != null ? c.percent + '%' : 'not printed';
    var bar = c.percent != null ? '<div class="kpc-bar" aria-hidden="true"><i style="width:' + Math.max(2, Math.min(100, c.percent)) + '%"></i></div>' : '';
    return '<div class="kpc' + (warn ? ' warn' : '') + '"><div class="kpc-k">The name says</div><div class="kpc-big"><b>' + esc(big) + '</b><span>' + esc(c.claim.toLowerCase()) + '</span></div>' + bar
      + '<p>' + esc(c.verdict) + '</p>' + (c.top && c.top.length ? '<small>Biggest ingredients, largest first: ' + esc(c.top.join(', ')) + '.</small>' : '') + '</div>';
  }
  window.kpMeter = kpMeter; window.kpClaimCard = kpClaimCard;
})();
