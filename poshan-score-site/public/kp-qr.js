/* A QR code for the page (or for the comparison on it), drawn in the browser by the MIT-licensed qrcode-generator library (/qrcode.js).
   A button with class "qrb" and data-qr-url opens a box (class "qrbox", the next element) with the code and a link to download it.
   Nothing is sent anywhere: the code is made on the visitor's own device. */
(function () {
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('.qrb') : null;
    if (!b) return;
    var holder = b.parentNode, box = holder && holder.nextElementSibling;
    if (!box || !box.classList.contains('qrbox')) return;
    if (!box.hidden) { box.hidden = true; return; }
    var url = b.getAttribute('data-qr-url') || location.href;
    try {
      var qr = window.qrcode(0, 'M'); qr.addData(url); qr.make();
      var svg = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
      box.innerHTML = svg + '<a download="kidposhan-qr.svg" href="data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) + '">Download the QR code</a><small>Scan it to open this page</small>';
    } catch (err) { box.textContent = 'The QR code could not be made on this device.'; }
    box.hidden = false;
  });
})();
