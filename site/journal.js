// The Substitution Tribune, laid out as a magazine.
// Reads the publication's RSS feed, proxied same-origin at /journal/feed (see netlify.toml).
// Works with Substack today and Ghost later: both publish standard RSS.
(function () {
  var mag = document.getElementById('journal-posts');
  if (!mag) return;
  var CONTENT_NS = 'http://purl.org/rss/1.0/modules/content/';
  var DC_NS = 'http://purl.org/dc/elements/1.1/';

  function text(item, tag) {
    var el = item.getElementsByTagName(tag)[0];
    return el ? el.textContent.trim() : '';
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function firstImage(html) {
    var m = /<img[^>]+src="(https:[^"]+)"/i.exec(html || '');
    return m ? m[1] : '';
  }
  function parse(item) {
    var link = text(item, 'link');
    if (!/^https:\/\//.test(link)) return null;
    var body = (item.getElementsByTagNameNS(CONTENT_NS, 'encoded')[0] || {}).textContent || '';
    var enc = item.getElementsByTagName('enclosure')[0];
    var img = enc && /^image\//.test(enc.getAttribute('type') || '') ? enc.getAttribute('url') : firstImage(body);
    var words = body.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
    var date = new Date(text(item, 'pubDate'));
    var author = (item.getElementsByTagNameNS(DC_NS, 'creator')[0] || {}).textContent || '';
    var cat = text(item, 'category');
    return {
      link: link,
      title: text(item, 'title'),
      dek: text(item, 'description').replace(/<[^>]+>/g, ''),
      img: /^https:\/\//.test(img || '') ? img : '',
      date: isNaN(date) ? '' : date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
      mins: words > 60 ? Math.max(1, Math.round(words / 230)) + ' min read' : '',
      author: author.trim(),
      kicker: cat ? cat.toUpperCase() : ''
    };
  }
  function kicker(p) {
    return [p.kicker, p.date, p.mins].filter(Boolean).map(esc).join(' <i>·</i> ');
  }
  function cover(p, cls) {
    return p.img
      ? '<div class="' + cls + '" style="background-image:url(\'' + esc(p.img) + '\')"></div>'
      : '<div class="' + cls + ' mag-noimg"><span>T</span></div>';
  }
  function lead(p) {
    return '<a class="mag-lead" href="' + esc(p.link) + '">' + cover(p, 'mag-lead-img') +
      '<div class="mag-lead-copy"><div class="mag-kicker">' + kicker(p) + '</div>' +
      '<h3>' + esc(p.title) + '</h3>' + (p.dek ? '<p class="mag-dek">' + esc(p.dek) + '</p>' : '') +
      (p.author ? '<p class="mag-byline">By ' + esc(p.author) + '</p>' : '') +
      '<span class="mag-more">Read the issue &rarr;</span></div></a>';
  }
  function story(p) {
    return '<a class="mag-story" href="' + esc(p.link) + '">' + cover(p, 'mag-story-img') +
      '<div class="mag-kicker">' + kicker(p) + '</div><h4>' + esc(p.title) + '</h4>' +
      (p.dek ? '<p>' + esc(p.dek) + '</p>' : '') + '</a>';
  }
  function brief(p, i) {
    return '<a class="mag-brief" href="' + esc(p.link) + '"><span class="mag-no">' + ('0' + (i + 1)).slice(-2) +
      '</span><span class="mag-brief-copy"><b>' + esc(p.title) + '</b><em>' + esc(p.date) + '</em></span></a>';
  }

  function render(posts) {
    if (!posts.length) return;
    var html = lead(posts[0]);
    var secondary = posts.slice(1, 4);
    var more = posts.slice(4, 8);
    if (secondary.length) html += '<div class="mag-row">' + secondary.map(story).join('') + '</div>';
    if (more.length) html += '<div class="mag-index"><div class="eyebrow">ALSO IN THE TRIBUNE</div>' + more.map(brief).join('') + '</div>';
    mag.innerHTML = html;
    mag.hidden = false;
  }
  window.__tribuneRender = render; // used for design previews only

  // Ghost (once live): visitors' browsers read the Ghost Content API directly, so no request
  // touches Netlify. Paste the public Content API key from Ghost > Settings > Integrations.
  var GHOST_URL = 'https://tribune.substitution.app';
  var GHOST_KEY = '';
  if (GHOST_KEY) {
    fetch(GHOST_URL + '/ghost/api/content/posts/?key=' + GHOST_KEY + '&limit=8&include=authors,tags')
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (data) {
        render((data.posts || []).map(function (p) {
          var d = new Date(p.published_at);
          return {
            link: p.url, title: p.title || '', dek: p.custom_excerpt || p.excerpt || '',
            img: p.feature_image || '',
            date: isNaN(d) ? '' : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
            mins: p.reading_time ? p.reading_time + ' min read' : '',
            author: p.primary_author ? p.primary_author.name : '',
            kicker: p.primary_tag ? p.primary_tag.name.toUpperCase() : ''
          };
        }).filter(function (p) { return /^https:\/\//.test(p.link); }));
      })
      .catch(function () {});
    return;
  }

  // Substack (today): its feed blocks direct browser reads, so it is relayed through Netlify.
  fetch('/journal/feed', { headers: { Accept: 'application/rss+xml, application/xml' } })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
    .then(function (xml) {
      var doc = new DOMParser().parseFromString(xml, 'application/xml');
      var items = Array.prototype.slice.call(doc.getElementsByTagName('item'), 0, 8);
      render(items.map(parse).filter(Boolean));
    })
    .catch(function () { /* keep the section quiet if the feed is unavailable */ });
})();
