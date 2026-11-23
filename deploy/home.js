// Homepage promos: Shop marquee (live catalog from /api/products) and the latest Tribune issue (/journal/feed).
(function () {
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(cents) {
    var n = cents / 100;
    return '$' + (n % 1 ? n.toFixed(2) : String(n));
  }

  // ---------- Shop marquee ----------
  var band = document.getElementById('shop-band');
  var track = band && band.querySelector('[data-marquee-track]');
  if (track) {
    fetch('/api/products', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (d) {
        var list = (d.products || []).filter(function (p) {
          return p.images && p.images.length && p.variants && p.variants.some(function (v) { return v.available; });
        });
        if (list.length < 3) return;
        var tile = function (p, hidden) {
          return '<a class="m-tile" href="/shop#' + esc(p.id) + '"' + (hidden ? ' tabindex="-1" aria-hidden="true"' : '') + '>' +
            '<div class="m-media"><img src="' + esc(p.images[0].src) + '" alt="' + (hidden ? '' : esc(p.title)) + '" loading="lazy" decoding="async" /></div>' +
            '<div class="m-copy"><b>' + esc(p.title) + '</b><span>' + money(p.price_from) + '</span></div></a>';
        };
        track.innerHTML = list.map(function (p) { return tile(p, false); }).join('') +
                          list.map(function (p) { return tile(p, true); }).join('');
        track.style.setProperty('--dur', Math.max(40, list.length * 6) + 's');
        band.hidden = false;
      })
      .catch(function () { /* leave the section hidden if the shop is unreachable */ });
  }

  // ---------- Latest Tribune issue ----------
  var strip = document.getElementById('tribune-latest');
  if (strip) {
    fetch('/journal/feed')
      .then(function (r) { return r.ok ? r.text() : Promise.reject(r.status); })
      .then(function (xml) {
        var doc = new DOMParser().parseFromString(xml, 'application/xml');
        var item = doc.getElementsByTagName('item')[0];
        if (!item) return;
        var get = function (t) { var el = item.getElementsByTagName(t)[0]; return el ? el.textContent.trim() : ''; };
        var link = get('link'), title = get('title');
        if (!/^https:\/\//.test(link) || !title) return;
        strip.innerHTML = '<a href="' + esc(link) + '">' + esc(title) + '</a>';
        var read = document.getElementById('tribune-latest-link');
        if (read) read.href = link;
      })
      .catch(function () {});
  }
})();
