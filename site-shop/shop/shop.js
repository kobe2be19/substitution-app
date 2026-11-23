/* Substitution Shop — catalog from /api/products, bag in this browser, Stripe Checkout via /api/checkout. */
(function () {
  "use strict";
  var API = "/api";
  var BAG_KEY = "sub-bag-v1";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var money = function (cents) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((cents || 0) / 100);
  };
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  var state = { products: [], byId: {}, shipping: null, filter: "All", current: null, sel: {}, qty: 1, img: 0 };

  // ---------- bag (kept in this browser; prices are re-checked at checkout) ----------
  function loadBag() {
    try { var b = JSON.parse(localStorage.getItem(BAG_KEY) || "[]"); return Array.isArray(b) ? b : []; }
    catch (e) { return []; }
  }
  var bag = loadBag();
  function saveBag() { try { localStorage.setItem(BAG_KEY, JSON.stringify(bag)); } catch (e) {} }

  function category(p) {
    var t = (p.title + " " + (p.tags || []).join(" ")).toLowerCase();
    if (/\b(hat|cap|beanie|snapback|visor|bucket)\b/.test(t)) return "Headwear";
    if (/\b(tee|t-shirt|shirt|hoodie|crewneck|sweatshirt|sweater|jacket|shorts|pants|joggers|polo|jersey|socks|zip|quarter-zip|sleeve|pullover)\b/.test(t)) return "Apparel";
    return "Accessories";
  }

  // ---------- catalog ----------
  function load() {
    fetch(API + "/products", { headers: { Accept: "application/json" } })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (data) {
        state.products = data.products || [];
        state.shipping = typeof data.shipping_flat === "number" ? data.shipping_flat : null;
        state.products.forEach(function (p) { p.category = category(p); state.byId[p.id] = p; });
        // Drop bag lines for products that no longer exist.
        bag = bag.filter(function (l) { var p = state.byId[l.product_id]; return p && variant(p, l.variant_id); });
        saveBag();
        if (state.shipping != null) {
          $("[data-ship-note]").textContent = money(state.shipping) + " per order, whatever you add to the bag.";
        }
        renderFilters(); renderGrid(); renderBag();
        openFromHash();
      })
      .catch(function () {
        $("[data-grid]").innerHTML = "";
        var empty = $("[data-empty]");
        empty.hidden = false;
        $("h2", empty).textContent = "The shop is resting.";
        $("p", empty).innerHTML = "Please check back shortly, or write to <a href=\"mailto:info@substitution.app\">info@substitution.app</a>.";
      });
  }

  function variant(p, id) { for (var i = 0; i < p.variants.length; i++) if (p.variants[i].id === id) return p.variants[i]; return null; }
  function imageFor(p, vid) {
    for (var i = 0; i < p.images.length; i++) if (p.images[i].variant_ids.indexOf(vid) > -1) return p.images[i].src;
    return p.images[0] ? p.images[0].src : "";
  }
  function priceLabel(p) { return p.price_from === p.price_to ? money(p.price_from) : "From " + money(p.price_from); }

  function renderFilters() {
    var cats = [];
    state.products.forEach(function (p) { if (cats.indexOf(p.category) < 0) cats.push(p.category); });
    var box = $("[data-filters]");
    if (cats.length < 2) { box.hidden = true; return; }
    var order = ["Apparel", "Headwear", "Accessories"];
    cats.sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });
    box.innerHTML = ["All"].concat(cats).map(function (c) {
      return '<button type="button" data-filter="' + esc(c) + '"' + (c === state.filter ? ' aria-pressed="true"' : ' aria-pressed="false"') + ">" + esc(c) + "</button>";
    }).join("");
    box.hidden = false;
  }

  function renderGrid() {
    var grid = $("[data-grid]");
    var list = state.products.filter(function (p) { return state.filter === "All" || p.category === state.filter; });
    $("[data-empty]").hidden = state.products.length > 0;
    grid.innerHTML = list.map(function (p, i) {
      var img = p.images[0] ? p.images[0].src : "";
      var alt = p.images[1] ? p.images[1].src : "";
      var soldOut = !p.variants.some(function (v) { return v.available; });
      return '<a class="card" href="#' + esc(p.id) + '" data-product="' + esc(p.id) + '">' +
        '<div class="card-media">' +
          (img ? '<img src="' + esc(img) + '" alt="' + esc(p.title) + '" loading="' + (i < 6 ? "eager" : "lazy") + '" />' : "") +
          (alt ? '<img class="card-alt" src="' + esc(alt) + '" alt="" loading="lazy" />' : "") +
          (soldOut ? '<span class="card-flag">Sold out</span>' : "") +
        "</div>" +
        '<div class="card-copy"><span class="card-kicker">' + esc(p.category) + "</span><h3>" + esc(p.title) + "</h3><p>" + priceLabel(p) + "</p></div></a>";
    }).join("");
  }

  // ---------- product sheet ----------
  var sheet = $("[data-sheet]");
  function selectedVariant() {
    var p = state.current; if (!p) return null;
    var ids = Object.keys(state.sel).map(function (k) { return state.sel[k]; });
    for (var i = 0; i < p.variants.length; i++) {
      var v = p.variants[i];
      if (ids.every(function (id) { return v.options.indexOf(id) > -1; })) return v;
    }
    return null;
  }
  function valueAvailable(oi, valueId) {
    var p = state.current;
    return p.variants.some(function (v) {
      if (!v.available || v.options.indexOf(valueId) < 0) return false;
      return Object.keys(state.sel).every(function (k) { return Number(k) === oi || v.options.indexOf(state.sel[k]) > -1; });
    });
  }

  function openProduct(id) {
    var p = state.byId[id]; if (!p) return;
    state.current = p; state.qty = 1; state.img = 0; state.sel = {};
    // Preselect the first available variant.
    var first = p.variants.filter(function (v) { return v.available; })[0] || p.variants[0];
    p.options.forEach(function (o, oi) {
      var hit = o.values.filter(function (val) { return first.options.indexOf(val.id) > -1; })[0];
      if (hit) state.sel[oi] = hit.id;
    });
    $("[data-sheet-kicker]").textContent = p.category.toUpperCase();
    $("[data-sheet-title]").textContent = p.title;
    $("[data-sheet-desc]").textContent = p.description || "";
    renderSheet();
    if (!sheet.open) { if (sheet.showModal) sheet.showModal(); else sheet.setAttribute("open", ""); }
    if (location.hash !== "#" + id) history.replaceState(null, "", "#" + id);
  }

  function renderSheet() {
    var p = state.current; var v = selectedVariant();
    $("[data-sheet-price]").textContent = v ? money(v.price) : priceLabel(p);
    $("[data-sheet-options]").innerHTML = p.options.map(function (o, oi) {
      var isColor = o.type === "color";
      var chosen = o.values.filter(function (val) { return val.id === state.sel[oi]; })[0];
      return '<div class="opt"><span class="opt-label">' + esc(o.name) + (chosen ? ' <b>' + esc(chosen.title) + "</b>" : "") + '</span><div class="opt-values' + (isColor ? " swatches" : "") + '">' +
        o.values.map(function (val) {
          var on = state.sel[oi] === val.id; var ok = valueAvailable(oi, val.id);
          var style = isColor && val.colors && val.colors[0] ? ' style="--swatch:' + esc(val.colors[0]) + '"' : "";
          return '<button type="button" data-opt="' + oi + '" data-val="' + val.id + '" aria-pressed="' + on + '"' + (ok ? "" : ' class="na"') + style +
            (isColor ? ' aria-label="' + esc(val.title) + '" title="' + esc(val.title) + '">' : ">" + esc(val.title)) + (isColor ? "" : "") + "</button>";
        }).join("") + "</div></div>";
    }).join("");
    $("[data-sheet-qty]").textContent = state.qty;
    var add = $("[data-add]");
    if (!v || !v.available) { add.disabled = true; add.textContent = v ? "Sold out" : "Choose an option"; }
    else { add.disabled = false; add.textContent = "Add to bag · " + money(v.price * state.qty); }
    // Images: the selected variant's first, then the rest.
    var imgs = p.images.slice();
    if (v) imgs.sort(function (a, b) { return (b.variant_ids.indexOf(v.id) > -1) - (a.variant_ids.indexOf(v.id) > -1); });
    imgs = imgs.slice(0, 6);
    if (state.img >= imgs.length) state.img = 0;
    var main = imgs[state.img];
    $("[data-sheet-image]").innerHTML = main ? '<img src="' + esc(main.src) + '" alt="' + esc(p.title) + '" />' : "";
    $("[data-sheet-thumbs]").innerHTML = imgs.length > 1 ? imgs.map(function (im, i) {
      return '<button type="button" data-thumb="' + i + '" aria-pressed="' + (i === state.img) + '"><img src="' + esc(im.src) + '" alt="" loading="lazy" /></button>';
    }).join("") : "";
  }

  function closeSheet() {
    if (sheet.open) { if (sheet.close) sheet.close(); else sheet.removeAttribute("open"); }
    state.current = null;
    if (location.hash) history.replaceState(null, "", location.pathname);
  }
  function openFromHash() { var id = location.hash.slice(1); if (id && state.byId[id]) openProduct(id); }

  // ---------- bag ----------
  var bagEl = $("[data-bag]"), scrim = $("[data-scrim]");
  function openBag() { bagEl.classList.add("open"); bagEl.setAttribute("aria-hidden", "false"); scrim.hidden = false; document.body.classList.add("locked"); }
  function closeBag() { bagEl.classList.remove("open"); bagEl.setAttribute("aria-hidden", "true"); scrim.hidden = true; document.body.classList.remove("locked"); }

  function renderBag() {
    var count = 0, subtotal = 0;
    var html = bag.map(function (l, i) {
      var p = state.byId[l.product_id]; var v = p && variant(p, l.variant_id);
      if (!p || !v) return "";
      count += l.quantity; subtotal += v.price * l.quantity;
      return '<div class="line"><img src="' + esc(imageFor(p, v.id)) + '" alt="" />' +
        '<div class="line-copy"><b>' + esc(p.title) + "</b><span>" + esc(v.title) + "</span>" +
        '<div class="qty small"><button type="button" data-line="' + i + '" data-d="-1" aria-label="Fewer">−</button><output>' + l.quantity + '</output><button type="button" data-line="' + i + '" data-d="1" aria-label="More">+</button></div></div>' +
        '<div class="line-price">' + money(v.price * l.quantity) + '<button type="button" class="remove" data-remove="' + i + '">Remove</button></div></div>';
    }).join("");
    $("[data-bag-lines]").innerHTML = html || '<p class="bag-empty">Your bag is empty.</p>';
    $("[data-bag-subtotal]").textContent = money(subtotal);
    $("[data-bag-ship]").textContent = state.shipping != null ? money(state.shipping) + " flat" : "Flat rate";
    $("[data-checkout]").disabled = count === 0;
    var c = $("[data-bag-count]"); c.textContent = count; c.hidden = count === 0;
  }

  function addToBag() {
    var p = state.current, v = selectedVariant(); if (!p || !v || !v.available) return;
    var line = bag.filter(function (l) { return l.product_id === p.id && l.variant_id === v.id; })[0];
    if (line) line.quantity = Math.min(10, line.quantity + state.qty);
    else bag.push({ product_id: p.id, variant_id: v.id, quantity: state.qty });
    saveBag(); renderBag(); closeSheet(); openBag();
  }

  function checkout() {
    var btn = $("[data-checkout]"), err = $("[data-bag-error]");
    err.textContent = ""; btn.disabled = true; btn.textContent = "Opening checkout…";
    fetch(API + "/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: bag })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (res.ok && res.d.url) { location.href = res.d.url; return; }
        throw new Error(res.d.error || "Checkout could not start.");
      })
      .catch(function (e) { err.textContent = e.message || "Checkout could not start."; btn.disabled = false; btn.textContent = "Checkout"; });
  }

  // ---------- events ----------
  document.addEventListener("click", function (e) {
    var t = e.target.closest("button, a"); if (!t) { if (e.target === sheet) closeSheet(); return; }
    if (t.hasAttribute("data-product")) { e.preventDefault(); openProduct(t.getAttribute("data-product")); return; }
    if (t.hasAttribute("data-filter")) { state.filter = t.getAttribute("data-filter"); renderFilters(); renderGrid(); return; }
    if (t.hasAttribute("data-opt")) { state.sel[Number(t.getAttribute("data-opt"))] = Number(t.getAttribute("data-val")); state.img = 0; renderSheet(); return; }
    if (t.hasAttribute("data-thumb")) { state.img = Number(t.getAttribute("data-thumb")); renderSheet(); return; }
    if (t.hasAttribute("data-qty")) { state.qty = Math.max(1, Math.min(10, state.qty + Number(t.getAttribute("data-qty")))); renderSheet(); return; }
    if (t.hasAttribute("data-add")) { addToBag(); return; }
    if (t.hasAttribute("data-close-sheet")) { closeSheet(); return; }
    if (t.hasAttribute("data-open-bag")) { openBag(); return; }
    if (t.hasAttribute("data-close-bag")) { closeBag(); return; }
    if (t.hasAttribute("data-line")) {
      var l = bag[Number(t.getAttribute("data-line"))];
      if (l) { l.quantity += Number(t.getAttribute("data-d")); if (l.quantity < 1) bag.splice(bag.indexOf(l), 1); else l.quantity = Math.min(10, l.quantity); saveBag(); renderBag(); }
      return;
    }
    if (t.hasAttribute("data-remove")) { bag.splice(Number(t.getAttribute("data-remove")), 1); saveBag(); renderBag(); return; }
    if (t.hasAttribute("data-checkout")) { checkout(); return; }
  });
  scrim.addEventListener("click", closeBag);
  sheet.addEventListener("close", function () { state.current = null; if (location.hash) history.replaceState(null, "", location.pathname); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeBag(); });
  window.addEventListener("hashchange", openFromHash);
  // Returning from Stripe with the back button: re-enable the button.
  window.addEventListener("pageshow", function () { var b = $("[data-checkout]"); b.textContent = "Checkout"; renderBag(); });

  load();
})();
