/* SHN LEB Events — POS (staff link with PIN, or the POS tab for management)
 * Sales are saved on the device first, then sent to the back office. Nothing is lost if the
 * internet drops: the queue is retried until the server confirms each sale.
 */
(function () {
  'use strict';

  var S; // shared helpers from app.js (window.SHN), read at mount time
  var current = null; // the mounted POS
  var timers = [];

  /* ---------------- storage */
  function load(key, fallback) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode: memory only */ }
  }
  function drop(key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } }

  function staffTokenKey(id) { return 'shn-staff-' + id; }
  function dataKey(id) { return 'shn-pos-' + id; }
  function queueKey(id) { return 'shn-queue-' + id; }
  function preKey(id) { return 'shn-pre-' + id; }

  function getStaffToken(id) {
    var t = load(staffTokenKey(id), null);
    return t && t.token && t.expires > Date.now() ? t.token : null;
  }

  /* ---------------- money */
  function r2(n) { return Math.round(n * 100) / 100; }
  function parseNum(v) {
    var n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.]/g, ''));
    return isNaN(n) ? 0 : n;
  }
  function lbp(n) { return Math.round(n).toLocaleString('en-US') + ' LBP'; }
  function roundLbp(n, step) { return Math.round(n / step) * step; }
  function newSaleId() {
    return 'S' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
  }
  function picUrl(u) {
    if (!u) return '';
    if (/cdn\.shopify\.com|\/cdn\/shop\//.test(u)) return u + (u.indexOf('?') >= 0 ? '&' : '?') + 'width=300';
    return u;
  }
  function initials(name) {
    return String(name).replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 2)
      .map(function (w) { return w.charAt(0).toUpperCase(); }).join('');
  }

  /* ================================================================ staff entry (link + PIN) */
  function staff(eventId) {
    S = window.SHN;
    document.body.classList.add('pos-mode');
    if (current && current.eventId === eventId && current.el.isConnected) return;
    var token = getStaffToken(eventId);
    if (token) {
      staffTopbar(eventId, (load(dataKey(eventId), {}).event || {}).name);
      return mount(S.app, { eventId: eventId, token: token, admin: false });
    }
    pinScreen(eventId);
  }

  function staffTopbar(eventId, name) {
    S.topbarRight.innerHTML = (name ? '<span class="topbar-event">' + S.esc(name) + '</span>' : '') +
      '<button class="link-btn" id="lockPos">Lock</button>';
    document.getElementById('lockPos').onclick = function () {
      var q = load(queueKey(eventId), []);
      if (q.length && !window.confirm(q.length + ' item(s) are still waiting to be sent. They stay on this phone and are sent after the next PIN. Lock anyway?')) return;
      drop(staffTokenKey(eventId));
      unmount();
      pinScreen(eventId);
    };
  }

  function pinScreen(eventId) {
    S.topbarRight.innerHTML = '';
    var cached = load(dataKey(eventId), {}).event;
    var pin = '';
    S.app.innerHTML =
      '<div class="login-wrap"><div class="card login-card pin-card">' +
      '<img class="login-logo" src="assets/logo-dark.png" alt="Superheated Neurons">' +
      '<h1 id="pinEvent">' + S.esc(cached ? cached.name : 'Event POS') + '</h1>' +
      '<p class="muted">Enter the event PIN.</p>' +
      '<div id="pinError"></div>' +
      '<div class="pin-dots" id="pinDots"><span></span><span></span><span></span><span></span></div>' +
      '<div class="keypad">' +
      [1, 2, 3, 4, 5, 6, 7, 8, 9, '', 0, '⌫'].map(function (k) {
        return k === '' ? '<span></span>' : '<button type="button" class="key" data-k="' + k + '">' + k + '</button>';
      }).join('') +
      '</div></div></div>';
    // download names, prices and pictures while the PIN is typed
    S.api('posCatalog', { eventId: eventId }, { quiet: true }).then(function (res) {
      save(preKey(eventId), res.catalog);
      var h = document.getElementById('pinEvent');
      if (h) h.textContent = res.catalog.event.name;
      warmPictures(res.catalog.products);
    }).catch(function (err) {
      if (err.code === 'closed' && document.getElementById('pinDots')) {
        S.app.innerHTML = '<div class="card empty"><h2>This event is closed</h2><p class="muted">Ask your manager.</p></div>';
      }
    });
    if (!cached) {
      S.api('eventPublic', { eventId: eventId }, { quiet: true }).then(function (res) {
        var h = document.getElementById('pinEvent');
        if (h) h.textContent = res.event.name;
      }).catch(function (err) {
        if (err.code === 'not_found') {
          S.app.innerHTML = '<div class="card empty"><h2>Event not found</h2><p class="muted">Check the link with your manager.</p></div>';
        }
      });
    }
    var busy = false;
    function draw() {
      Array.prototype.forEach.call(document.querySelectorAll('#pinDots span'), function (d, i) {
        d.className = i < pin.length ? 'on' : '';
      });
    }
    function press(k) {
      if (busy) return;
      if (k === '⌫') pin = pin.slice(0, -1);
      else if (pin.length < 4) pin += k;
      draw();
      if (pin.length === 4) submit();
    }
    function submit() {
      busy = true;
      document.getElementById('pinError').innerHTML = '<div class="muted small" style="margin-bottom:10px">Checking…</div>';
      S.api('staffLogin', { eventId: eventId, pin: pin }, { quiet: true }).then(function (res) {
        save(staffTokenKey(eventId), { token: res.token, expires: res.expires });
        document.removeEventListener('keydown', onKey);
        staffTopbar(eventId, res.event.name);
        mount(S.app, { eventId: eventId, token: res.token, admin: false });
      }).catch(function (err) {
        busy = false;
        pin = '';
        draw();
        var box = document.getElementById('pinError');
        if (box) box.innerHTML = '<div class="form-error">' + S.esc(err.message) + '</div>';
      });
    }
    function onKey(e) {
      if (!document.getElementById('pinDots')) { document.removeEventListener('keydown', onKey); return; }
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('⌫');
    }
    document.addEventListener('keydown', onKey);
    Array.prototype.forEach.call(document.querySelectorAll('.key'), function (b) {
      b.onclick = function () { press(b.getAttribute('data-k')); };
    });
  }

  /* ================================================================ POS */
  function mount(container, opts) {
    S = window.SHN;
    unmount();
    var pos = {
      eventId: opts.eventId,
      token: opts.token,
      admin: !!opts.admin,
      el: container,
      data: load(dataKey(opts.eventId), null),
      view: 'products',
      pay: null,
      cart: [],
      seller: '',
      discount: '',
      note: '',
      query: '',
      cat: '',
      syncing: false,
      lastError: ''
    };
    current = pos;
    if (!pos.data) {
      // products downloaded while the PIN was typed: show them right away, stock follows
      var pre = load(preKey(opts.eventId), null);
      if (pre) {
        pos.preview = true;
        pos.data = { event: pre.event, products: pre.products, staff: [], openShifts: [], fxRate: 0, maxDiscountPct: 0, lbpStep: 5000, recentSales: [] };
      }
    }
    container.innerHTML = '<div class="pos" id="pos"></div>';
    if (pos.data) render(pos); else container.querySelector('#pos').innerHTML = '<div class="loading"><div class="spinner"></div><div>Loading products…</div></div>';
    refresh(pos);
    flush(pos);
    timers.push(setInterval(function () { if (current === pos) { flush(pos); } }, 20000));
    timers.push(setInterval(function () { if (current === pos && pos.view !== 'checkout') refresh(pos); }, 120000));
    window.addEventListener('online', onOnline);
  }

  function onOnline() { if (current) flush(current); }

  function unmount() {
    timers.forEach(clearInterval);
    timers = [];
    window.removeEventListener('online', onOnline);
    current = null;
    document.body.classList.remove('pos-checkout');
    var sheet = document.getElementById('posModal');
    if (sheet) sheet.remove();
  }

  function req(pos, action, data) {
    return S.api(action, Object.assign({ eventId: pos.eventId }, data || {}), { token: pos.token, quiet: true })
      .catch(function (err) {
        if (err.code === 'auth' && !pos.admin) {
          drop(staffTokenKey(pos.eventId));
          unmount();
          pinScreen(pos.eventId);
        }
        throw err;
      });
  }

  function refresh(pos) {
    return req(pos, 'posData').then(function (res) {
      if (current !== pos) return;
      pos.data = res.pos;
      pos.offline = false;
      pos.preview = false;
      save(dataKey(pos.eventId), res.pos);
      if (!pos.admin) staffTopbar(pos.eventId, res.pos.event.name);
      if (pos.data.staff.indexOf(pos.seller) < 0) pos.seller = '';
      if (pos.view === 'checkout') update(pos); else render(pos);
      warmPictures(res.pos.products);
    }).catch(function (err) {
      if (current !== pos) return;
      if (err.offline) { pos.offline = true; if (!pos.data) showLoadError(pos, err); else if (pos.view !== 'checkout') render(pos); return; }
      if (err.code === 'closed') { pos.el.innerHTML = '<div class="card empty"><h2>This event is closed</h2><p class="muted">Ask your manager.</p></div>'; return; }
      if (!pos.data) showLoadError(pos, err); else S.toast(err.message, true);
    });
  }

  function showLoadError(pos, err) {
    pos.el.querySelector('#pos').innerHTML = '<div class="card empty"><h2>Couldn\'t load the POS</h2><p class="muted">' + S.esc(err.message) + '</p>' +
      '<button class="btn btn-primary" id="posRetry">Try again</button></div>';
    document.getElementById('posRetry').onclick = function () { refresh(pos); };
  }

  var warmed = {};
  function warmPictures(products) {
    if (!navigator.onLine || !('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return;
    var urls = products.map(function (p) { return picUrl(p.picture); }).filter(function (u) { return u && !warmed[u]; });
    var i = 0;
    function next() {
      if (i >= urls.length) return;
      var u = urls[i++];
      warmed[u] = true;
      fetch(u, { mode: 'no-cors' }).catch(function () {}).then(next);
    }
    next(); next(); next();
  }

  /* ---------------- queue (sales + clock in/out waiting to be sent) */
  function queue(pos) { return load(queueKey(pos.eventId), []); }
  function setQueue(pos, q) { save(queueKey(pos.eventId), q); }
  function enqueue(pos, item) { var q = queue(pos); q.push(item); setQueue(pos, q); }

  function flush(pos) {
    if (pos.syncing) return Promise.resolve();
    var q = queue(pos);
    var next = q.filter(function (x) { return !x.error; })[0];
    if (!next) { drawSync(pos); return Promise.resolve(); }
    pos.syncing = true;
    drawSync(pos);
    var call = next.type === 'sale'
      ? req(pos, 'recordSale', { sale: next.sale })
      : req(pos, 'clock', { name: next.name, direction: next.direction, clientTime: next.clientTime });
    return call.then(function (res) {
      var q2 = queue(pos).filter(function (x) { return x.qid !== next.qid; });
      setQueue(pos, q2);
      pos.syncing = false;
      if (next.type === 'sale' && pos.data) {
        pos.data.recentSales = [res.sale].concat((pos.data.recentSales || []).filter(function (s) { return s.id !== res.sale.id; }));
      }
      if (next.type === 'clock' && pos.data) pos.data.openShifts = res.openShifts;
      if (pos.data) save(dataKey(pos.eventId), pos.data);
      if (current === pos) {
        if (!q2.some(function (x) { return !x.error; })) refresh(pos);
        else drawSync(pos);
        return flush(pos);
      }
    }).catch(function (err) {
      pos.syncing = false;
      if (err.offline) { pos.offline = true; drawSync(pos); return; }
      if (err.code === 'auth') return;
      // the server refused it: keep it, show why, never lose it silently
      var q3 = queue(pos).map(function (x) { if (x.qid === next.qid) x.error = err.message; return x; });
      setQueue(pos, q3);
      if (current === pos) { S.toast('A ' + (next.type === 'sale' ? 'sale' : 'clock entry') + ' could not be saved: ' + err.message, true); if (pos.view !== 'checkout') render(pos); flush(pos); }
    });
  }

  /* stock shown = server stock − sales still waiting on this phone */
  function pendingQty(pos) {
    var out = {};
    queue(pos).forEach(function (x) {
      if (x.type !== 'sale' || x.error) return;
      x.sale.lines.forEach(function (l) { out[l.ref] = (out[l.ref] || 0) + l.qty; });
    });
    return out;
  }

  function openShiftNames(pos) {
    var open = {};
    (pos.data.openShifts || []).forEach(function (s) { open[s.name] = s.since; });
    queue(pos).forEach(function (x) {
      if (x.type !== 'clock' || x.error) return;
      if (x.direction === 'in') open[x.name] = open[x.name] || x.clientTime;
      else delete open[x.name];
    });
    return open;
  }

  /* ---------------- render */
  function render(pos) {
    var root = pos.el.querySelector('#pos');
    if (!root || !pos.data) return;
    if (pos.view === 'checkout') return renderCheckout(pos);
    document.body.classList.remove('pos-checkout');
    var d = pos.data;
    var cats = [];
    d.products.forEach(function (p) { if (p.category && cats.indexOf(p.category) < 0) cats.push(p.category); });
    cats.sort();
    root.innerHTML =
      '<div class="pos-bar">' +
      '<div class="pos-sync" id="posSync"></div>' +
      '<div class="pos-bar-actions">' +
      '<button class="btn btn-ghost btn-sm" id="posStaff">Clock in / out</button>' +
      '<button class="btn btn-ghost btn-sm" id="posRecent">Recent sales</button>' +
      '<button class="btn btn-ghost btn-sm" id="posRefresh" title="Reload products and stock">Refresh</button>' +
      '</div></div>' +
      '<div class="pos-grid">' +
      '<section class="pos-products">' +
      '<div class="pos-filters">' +
      '<input class="input" id="posSearch" type="search" placeholder="Search product or ref code" value="' + S.esc(pos.query) + '" autocomplete="off">' +
      '<div class="chips pos-chips">' +
      [''].concat(cats).map(function (c) {
        return '<button class="chip' + (pos.cat === c ? ' active' : '') + '" data-cat="' + S.esc(c) + '">' + (c ? S.esc(c) : 'All') + '</button>';
      }).join('') + '</div></div>' +
      '<div class="tiles" id="posTiles"></div>' +
      '</section>' +
      '<aside class="pos-cart" id="posCart"></aside>' +
      '</div>' +
      '<button class="pos-cartbar" id="posCartBar"></button>';
    root.querySelector('#posSearch').oninput = function () { pos.query = this.value; drawTiles(pos); };
    Array.prototype.forEach.call(root.querySelectorAll('[data-cat]'), function (b) {
      b.onclick = function () { pos.cat = b.getAttribute('data-cat'); render(pos); };
    });
    root.querySelector('#posStaff').onclick = function () { openStaff(pos); };
    root.querySelector('#posRecent').onclick = function () { openRecent(pos); };
    root.querySelector('#posRefresh').onclick = function () { S.toast('Refreshing…'); refresh(pos); flush(pos); };
    root.querySelector('#posCartBar').onclick = function () { openCheckout(pos); };
    drawTiles(pos);
    drawCart(pos);
    drawSync(pos);
  }

  function drawSync(pos) {
    var el = document.getElementById('posSync');
    if (!el || current !== pos) return;
    var q = queue(pos);
    var failed = q.filter(function (x) { return x.error; }).length;
    var waiting = q.length - failed;
    var html;
    if (failed) html = '<span class="sync bad">' + failed + ' not saved: check Recent sales</span>';
    else if (waiting) html = '<span class="sync warn">' + (pos.syncing ? 'Sending ' : '') + waiting + ' waiting to send' + (pos.offline ? ' (offline)' : '') + '</span>';
    else if (pos.offline) html = '<span class="sync warn">Offline: sales are kept on this device</span>';
    else if (pos.preview) html = '<span class="sync warn">Loading stock…</span>';
    else html = '<span class="sync good">All sales saved</span>';
    el.innerHTML = html;
  }

  function hasStock(p) { return typeof p.live === 'number'; }
  function stockOf(pos, p, pend) { return p.live - (pend[p.ref] || 0) - inCart(pos, p.ref); }
  function inCart(pos, ref) {
    var l = pos.cart.filter(function (x) { return x.ref === ref; })[0];
    return l ? l.qty : 0;
  }

  function drawTiles(pos) {
    var el = document.getElementById('posTiles');
    if (!el) return;
    var q = pos.query.trim().toLowerCase();
    var pend = pendingQty(pos);
    var list = pos.data.products.filter(function (p) {
      if (pos.cat && p.category !== pos.cat) return false;
      return !q || p.name.toLowerCase().indexOf(q) >= 0 || String(p.ref).toLowerCase().indexOf(q) >= 0;
    });
    if (!pos.data.products.length) {
      el.innerHTML = '<div class="card empty"><p class="muted">No products in this event yet. Ask your manager to fill the Listing tab.</p></div>';
      return;
    }
    if (!list.length) { el.innerHTML = '<div class="card empty"><p class="muted">No products match.</p></div>'; return; }
    el.innerHTML = list.map(function (p) {
      var n = inCart(pos, p.ref);
      var known = hasStock(p);
      var left = known ? stockOf(pos, p, pend) : null;
      var pic = picUrl(p.picture);
      return '<div class="tile' + (known && left + n <= 0 ? ' out' : '') + (n ? ' in-cart' : '') + '" data-ref="' + S.esc(p.ref) + '" role="button" tabindex="0">' +
        '<span class="tile-img">' + (pic
          ? '<img src="' + S.esc(pic) + '" alt="" loading="lazy" onerror="this.parentNode.innerHTML=\'<span class=&quot;ph&quot;>' + S.esc(initials(p.name)) + '</span>\'">'
          : '<span class="ph">' + S.esc(initials(p.name)) + '</span>') + '</span>' +
        '<span class="tile-name">' + S.esc(p.name) + '</span>' +
        '<span class="tile-price">' + S.money(p.price) + '</span>' +
        (n
          ? '<span class="tile-qty"><button class="tq" data-dec="' + S.esc(p.ref) + '" aria-label="One less">−</button><b>' + n + '</b>' +
            '<button class="tq" data-inc="' + S.esc(p.ref) + '" aria-label="One more">+</button></span>'
          : '<span class="tile-stock">' + (known ? (left <= 0 ? 'None left' : left + ' left') : '') + '</span>') +
        '</div>';
    }).join('');
    Array.prototype.forEach.call(el.querySelectorAll('.tile'), function (t) {
      t.onclick = function (e) {
        var inc = e.target.closest('[data-inc]'), dec = e.target.closest('[data-dec]');
        if (dec) return addToCart(pos, dec.getAttribute('data-dec'), -1);
        if (inc) return addToCart(pos, inc.getAttribute('data-inc'), 1);
        addToCart(pos, t.getAttribute('data-ref'), 1);
      };
    });
  }

  function product(pos, ref) {
    return pos.data.products.filter(function (p) { return p.ref === ref; })[0];
  }

  function addToCart(pos, ref, delta) {
    delta = delta || 1;
    var p = product(pos, ref);
    if (!p) return;
    if (delta > 0 && hasStock(p) && stockOf(pos, p, pendingQty(pos)) <= 0) {
      if (!window.confirm('"' + p.name + '" shows no stock left. Add it anyway?')) return;
    }
    var line = pos.cart.filter(function (l) { return l.ref === ref; })[0];
    if (!line) { line = { ref: ref, qty: 0 }; pos.cart.push(line); }
    line.qty += delta;
    pos.cart = pos.cart.filter(function (l) { return l.qty > 0; });
    if (pos.view === 'checkout') { if (!pos.cart.length) closeCheckout(pos); else renderCheckout(pos); return; }
    drawTiles(pos);
    drawCart(pos);
  }

  function totals(pos) {
    var sub = 0;
    pos.cart.forEach(function (l) { var p = product(pos, l.ref); if (p) sub += p.price * l.qty; });
    var disc = parseNum(pos.discount);
    var total = r2(sub * (1 - disc / 100));
    return { sub: r2(sub), disc: disc, off: r2(sub - total), total: total, units: pos.cart.reduce(function (a, l) { return a + l.qty; }, 0) };
  }

  /* laptop side panel + phone bottom bar: a summary; everything else happens on the checkout page */
  function drawCart(pos) {
    var el = document.getElementById('posCart');
    var bar = document.getElementById('posCartBar');
    if (!el) return;
    var t = totals(pos);
    el.innerHTML =
      '<div class="cart-head"><h2>Current sale</h2></div>' +
      '<div class="cart-lines">' + (pos.cart.length ? pos.cart.map(function (l) {
        var p = product(pos, l.ref);
        return p ? '<div class="cart-line simple"><div class="cl-name">' + l.qty + '× ' + S.esc(p.name) + '</div><div class="cl-total">' + S.money(r2(p.price * l.qty)) + '</div></div>' : '';
      }).join('') : '<div class="cart-empty">Tap products to add them.</div>') + '</div>' +
      (pos.cart.length
        ? '<div class="cart-totals"><div class="grand"><span>Total</span><span>' + S.money(t.sub) + '</span></div></div>' +
          '<div class="cart-actions"><button class="btn btn-ghost" id="cartClear">Clear</button>' +
          '<button class="btn btn-accent btn-big" id="cartReview">Review &amp; pay</button></div>'
        : '');
    bar.innerHTML = t.units ? '<span>' + t.units + (t.units === 1 ? ' item' : ' items') + '</span><b>' + S.money(t.sub) + '</b><span>Review ›</span>' : '';
    bar.className = 'pos-cartbar' + (t.units ? ' show' : '');
    var clr = el.querySelector('#cartClear');
    if (clr) clr.onclick = function () { if (window.confirm('Clear this sale?')) { resetSale(pos); render(pos); } };
    var rev = el.querySelector('#cartReview');
    if (rev) rev.onclick = function () { openCheckout(pos); };
  }

  function resetSale(pos) {
    pos.cart = []; pos.discount = ''; pos.note = ''; pos.seller = ''; pos.pay = null;
  }

  /* ---------------- checkout: one full page, every field visible from the start */
  function newPay() {
    return { method: 'Cash', online: '', recvUsd: '', recvLbp: '', changeUsd: '', changeLbp: '', touched: false, error: '' };
  }

  function openCheckout(pos) {
    if (!pos.cart.length) return;
    if (!pos.data.fxRate) { S.toast('Still loading the event settings. Try again in a moment.', true); refresh(pos); return; }
    pos.view = 'checkout';
    if (!pos.pay) pos.pay = newPay();
    renderCheckout(pos);
    window.scrollTo(0, 0);
  }

  function closeCheckout(pos) {
    pos.view = 'products';
    render(pos);
  }

  function fmtLbpInput(v) {
    var n = Math.round(parseNum(v));
    return n ? n.toLocaleString('en-US') : '';
  }

  /* keeps commas while typing without moving the cursor to the end */
  function liveCommas(input, onValue) {
    input.addEventListener('input', function () {
      var digitsBefore = input.value.slice(0, input.selectionStart).replace(/[^0-9]/g, '').length;
      var formatted = fmtLbpInput(input.value);
      input.value = formatted;
      var pos2 = 0, seen = 0;
      while (pos2 < formatted.length && seen < digitsBefore) { if (/[0-9]/.test(formatted[pos2])) seen++; pos2++; }
      try { input.setSelectionRange(pos2, pos2); } catch (e) { /* some inputs refuse */ }
      onValue(formatted);
    });
  }

  function renderCheckout(pos) {
    var root = pos.el.querySelector('#pos');
    var d = pos.data;
    var pay = pos.pay;
    var open = openShiftNames(pos);
    var sellers = d.staff.filter(function (n) { return open[n]; });
    if (pos.seller && sellers.indexOf(pos.seller) < 0) pos.seller = '';
    document.body.classList.add('pos-checkout');

    root.innerHTML =
      '<div class="co">' +
      '<div class="co-top"><button class="btn btn-ghost btn-sm" id="coBack">‹ Back to products</button>' +
      '<button class="link-btn neg" id="coClear">Clear sale</button></div>' +

      '<section class="co-card"><h3>Items</h3>' + pos.cart.map(function (l) {
        var p = product(pos, l.ref);
        if (!p) return '';
        return '<div class="cart-line"><div class="cl-main"><div class="cl-name">' + S.esc(p.name) + '</div>' +
          '<div class="cl-price">' + S.money(p.price) + ' each</div></div>' +
          '<div class="qty"><button data-dec="' + S.esc(l.ref) + '" aria-label="One less">−</button><span>' + l.qty + '</span>' +
          '<button data-inc="' + S.esc(l.ref) + '" aria-label="One more">+</button></div>' +
          '<div class="cl-total">' + S.money(r2(p.price * l.qty)) + '</div></div>';
      }).join('') + '</section>' +

      '<section class="co-card"><h3>Sold by <span class="req">required</span></h3>' +
      (sellers.length
        ? '<div class="sellers">' + sellers.map(function (n) {
          return '<button class="seller' + (pos.seller === n ? ' active' : '') + '" data-seller="' + S.esc(n) + '">' + S.esc(n) + '</button>';
        }).join('') + '</div>'
        : '<div class="cart-empty-seller">Nobody is clocked in. <button class="link-btn" id="coClockIn">Clock in</button></div>') +
      '</section>' +

      '<section class="co-card"><h3>Discount</h3><div class="two">' +
      '<div class="field"><label for="coDisc">Discount %</label><input class="input" id="coDisc" inputmode="decimal" placeholder="0" value="' + S.esc(pos.discount) + '"></div>' +
      '<div class="field"><label for="coNote">Note</label><input class="input" id="coNote" placeholder="Promo code, voucher…" value="' + S.esc(pos.note) + '"></div>' +
      '</div><div class="small neg" id="coDiscErr"></div></section>' +

      '<section class="co-card co-total"><div class="co-sub" id="coSub"></div><div class="big" id="coTotal"></div><div class="muted" id="coTotalLbp"></div></section>' +

      '<section class="co-card"><h3>Payment</h3>' +
      '<div class="seg" id="paySeg">' + ['Cash', 'Online', 'Split'].map(function (x) {
        return '<button data-m="' + x + '" class="' + (pay.method === x ? 'active' : '') + '">' + (x === 'Split' ? 'Cash + online' : x) + '</button>';
      }).join('') + '</div>' +
      '<div class="field"><label for="payOnline">Paid online (USD)</label><input class="input money-in" id="payOnline" inputmode="decimal" placeholder="0" value="' + S.esc(pay.online) + '"></div>' +
      '<div class="two">' +
      '<div class="field"><label for="payUsd">Received USD</label><input class="input money-in" id="payUsd" inputmode="decimal" placeholder="0" value="' + S.esc(pay.recvUsd) + '"></div>' +
      '<div class="field"><label for="payLbp">Received LBP</label><input class="input money-in" id="payLbp" inputmode="numeric" placeholder="0" value="' + S.esc(pay.recvLbp) + '"></div>' +
      '</div>' +
      '<div class="notes">' + [100, 50, 20, 10, 5].map(function (n) { return '<button class="note" data-note="' + n + '">$' + n + '</button>'; }).join('') +
      '<button class="note clear" id="notesClear">Clear</button></div>' +
      '<div class="pay-status" id="payStatus"></div>' +
      '<div class="two">' +
      '<div class="field"><label for="chUsd">Change given USD</label><input class="input money-in" id="chUsd" inputmode="numeric" placeholder="0" value="' + S.esc(pay.changeUsd) + '"></div>' +
      '<div class="field"><label for="chLbp">Change given LBP</label><input class="input money-in" id="chLbp" inputmode="numeric" placeholder="0" value="' + S.esc(pay.changeLbp) + '"></div>' +
      '</div>' +
      '<div class="small muted">LBP change is rounded to ' + S.num(d.lbpStep || 5000) + '.</div>' +
      '</section>' +

      '<div id="payError"></div>' +
      '<button class="btn btn-accent btn-big btn-block" id="payConfirm">Confirm sale</button>' +
      '</div>';

    var $ = function (sel) { return root.querySelector(sel); };
    $('#coBack').onclick = function () { closeCheckout(pos); };
    $('#coClear').onclick = function () { if (window.confirm('Clear this sale?')) { resetSale(pos); closeCheckout(pos); } };
    Array.prototype.forEach.call(root.querySelectorAll('[data-inc]'), function (b) { b.onclick = function () { addToCart(pos, b.getAttribute('data-inc'), 1); }; });
    Array.prototype.forEach.call(root.querySelectorAll('[data-dec]'), function (b) { b.onclick = function () { addToCart(pos, b.getAttribute('data-dec'), -1); }; });
    Array.prototype.forEach.call(root.querySelectorAll('[data-seller]'), function (b) {
      b.onclick = function () {
        pos.seller = b.getAttribute('data-seller');
        Array.prototype.forEach.call(root.querySelectorAll('[data-seller]'), function (x) { x.classList.toggle('active', x === b); });
        root.querySelector('#payError').innerHTML = '';
      };
    });
    if ($('#coClockIn')) $('#coClockIn').onclick = function () { openStaff(pos, function () { renderCheckout(pos); }); };
    $('#coDisc').oninput = function () { pos.discount = this.value.replace(/[^0-9.]/g, ''); suggestChange(pos); update(pos); };
    $('#coNote').oninput = function () { pos.note = this.value; };
    Array.prototype.forEach.call(root.querySelectorAll('[data-m]'), function (b) {
      b.onclick = function () {
        pay.method = b.getAttribute('data-m');
        Array.prototype.forEach.call(root.querySelectorAll('[data-m]'), function (x) { x.classList.toggle('active', x === b); });
        suggestChange(pos); update(pos);
      };
    });
    $('#payOnline').oninput = function () { pay.online = this.value; suggestChange(pos); update(pos); };
    $('#payUsd').oninput = function () { pay.recvUsd = this.value; suggestChange(pos); update(pos); };
    liveCommas($('#payLbp'), function (v) { pay.recvLbp = v; suggestChange(pos); update(pos); });
    Array.prototype.forEach.call(root.querySelectorAll('[data-note]'), function (b) {
      b.onclick = function () {
        pay.recvUsd = String(r2(parseNum(pay.recvUsd) + Number(b.getAttribute('data-note'))));
        $('#payUsd').value = pay.recvUsd;
        suggestChange(pos); update(pos);
      };
    });
    $('#notesClear').onclick = function () { pay.recvUsd = ''; $('#payUsd').value = ''; suggestChange(pos); update(pos); };
    // change given: each side recalculates the other
    $('#chUsd').oninput = function () {
      pay.changeUsd = this.value;
      var c = calc(pos);
      var lbpLeft = Math.max(0, roundLbp((c.change - parseNum(pay.changeUsd)) * c.fx, c.step));
      pay.changeLbp = fmtLbpInput(lbpLeft);
      $('#chLbp').value = pay.changeLbp;
      update(pos);
    };
    liveCommas($('#chLbp'), function (v) {
      pay.changeLbp = v;
      var c = calc(pos);
      pay.changeUsd = String(Math.max(0, Math.round(c.change - parseNum(v) / c.fx)));
      $('#chUsd').value = pay.changeUsd;
      update(pos);
    });
    // keep the field being typed in above the phone keyboard (once, no jumping)
    Array.prototype.forEach.call(root.querySelectorAll('input'), function (inp) {
      inp.addEventListener('focus', function () {
        if (window.innerWidth > 900) return;
        setTimeout(function () { inp.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 250);
      });
    });
    $('#payConfirm').onclick = function () { confirmSale(pos); };
    update(pos);
  }

  function calc(pos) {
    var d = pos.data, pay = pos.pay, t = totals(pos);
    var fx = d.fxRate, step = d.lbpStep || 5000;
    var online = pay.method === 'Online' ? t.total : (pay.method === 'Split' ? r2(parseNum(pay.online)) : 0);
    var due = r2(Math.max(0, t.total - online));
    var paid = parseNum(pay.recvUsd) + parseNum(pay.recvLbp) / fx;
    var tol = step / fx + 0.005;
    var change = r2(paid - due);
    return { t: t, fx: fx, step: step, online: online, due: due, paid: paid, tol: tol, change: change, hasCash: due > 0 };
  }

  /* fills the change fields with a suggestion: whole dollars, the rest in LBP */
  function suggestChange(pos) {
    var c = calc(pos), pay = pos.pay;
    if (!c.hasCash || c.paid === 0 || c.change < 0.005 || Math.abs(c.change * c.fx) < c.step / 2) {
      pay.changeUsd = ''; pay.changeLbp = '';
    } else {
      var usd = Math.floor(c.change);
      pay.changeUsd = String(usd);
      pay.changeLbp = fmtLbpInput(Math.max(0, roundLbp((c.change - usd) * c.fx, c.step)));
    }
    var root = pos.el.querySelector('#pos');
    var a = root.querySelector('#chUsd'), b = root.querySelector('#chLbp');
    if (a) a.value = pay.changeUsd;
    if (b) b.value = pay.changeLbp;
  }

  /* updates the numbers on the page without rebuilding it (the layout never moves) */
  function update(pos) {
    var root = pos.el.querySelector('#pos');
    if (!root || pos.view !== 'checkout') return;
    var d = pos.data, pay = pos.pay, c = calc(pos), t = c.t;
    var $ = function (sel) { return root.querySelector(sel); };
    $('#coSub').innerHTML = t.off ? 'Subtotal ' + S.money(t.sub) + ' · Discount ' + t.disc + '% −' + S.money(t.off) : '&nbsp;';
    $('#coTotal').textContent = S.money(t.total);
    $('#coTotalLbp').textContent = lbp(roundLbp(t.total * c.fx, c.step)) + ' at ' + S.num(c.fx);
    $('#coDiscErr').textContent = t.disc > d.maxDiscountPct ? 'This discount is above what is allowed for this event.' : '';
    var split = pay.method === 'Split', cash = pay.method !== 'Online';
    $('#payOnline').disabled = !split;
    ['#payUsd', '#payLbp', '#chUsd', '#chLbp'].forEach(function (s) { $(s).disabled = !cash; });
    Array.prototype.forEach.call(root.querySelectorAll('.note'), function (b) { b.disabled = !cash; });
    var st = $('#payStatus');
    if (!cash) { st.className = 'pay-status muted'; st.innerHTML = '<span>Paid in full online. No cash.</span>'; return; }
    if (!c.paid) { st.className = 'pay-status muted'; st.innerHTML = '<span>Cash to collect: <b>' + S.money(c.due) + '</b> (' + lbp(roundLbp(c.due * c.fx, c.step)) + ')</span>'; return; }
    if (c.paid < c.due - c.tol) {
      var short = r2(c.due - c.paid);
      st.className = 'pay-status owed'; st.innerHTML = '<span>Still to collect: <b>' + S.money(short) + '</b> (' + lbp(roundLbp(short * c.fx, c.step)) + ')</span>';
      return;
    }
    if (c.change < 0.005 || Math.abs(c.change * c.fx) < c.step / 2) { st.className = 'pay-status good'; st.innerHTML = '<span>Exact amount. No change to give.</span>'; return; }
    st.className = 'pay-status good';
    st.innerHTML = '<span>Change to give: <b>' + S.money(c.change) + '</b> (' + lbp(roundLbp(c.change * c.fx, c.step)) + ')</span>';
  }

  function confirmSale(pos) {
    var pay = pos.pay, c = calc(pos), t = c.t;
    var err = '';
    if (!pos.seller) err = 'Pick who made the sale (Sold by).';
    else if (t.disc > pos.data.maxDiscountPct) err = 'The discount is above what is allowed for this event.';
    else if (pay.method === 'Split' && !(c.online > 0 && c.online < t.total)) err = 'Enter the part paid online (less than the total).';
    var sale = {
      id: newSaleId(), seller: pos.seller, method: pay.method, discountPct: t.disc, note: pos.note.trim(),
      lines: pos.cart.map(function (l) { return { ref: l.ref, qty: l.qty }; }),
      onlineUsd: c.online, recvUsd: 0, recvLbp: 0, changeUsd: 0, changeLbp: 0, clientTime: new Date().toISOString(), total: t.total
    };
    if (!err && c.hasCash) {
      sale.recvUsd = parseNum(pay.recvUsd);
      sale.recvLbp = Math.round(parseNum(pay.recvLbp));
      sale.changeUsd = parseNum(pay.changeUsd);
      sale.changeLbp = Math.round(parseNum(pay.changeLbp));
      if (c.paid < c.due - c.tol) err = 'The cash received is less than ' + S.money(c.due) + '.';
      else {
        var diff = c.change - sale.changeUsd - sale.changeLbp / c.fx;
        if (Math.abs(diff) > 1 + c.tol) err = diff > 0 ? 'Not enough change given. Check the amounts.' : 'More change given than due. Check the amounts.';
      }
    }
    var box = pos.el.querySelector('#payError');
    if (err) { box.innerHTML = '<div class="form-error">' + S.esc(err) + '</div>'; box.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    enqueue(pos, { qid: sale.id, type: 'sale', sale: sale });
    resetSale(pos);
    pos.view = 'products';
    render(pos);
    window.scrollTo(0, 0);
    var change = sale.changeUsd || sale.changeLbp
      ? ' Give back ' + [sale.changeUsd ? '$' + S.num(sale.changeUsd) : '', sale.changeLbp ? lbp(sale.changeLbp) : ''].filter(Boolean).join(' + ') + '.'
      : '';
    S.toast('Sale saved: ' + S.money(sale.total) + '.' + change);
    flush(pos);
  }

  /* ---------------- modal helper */
  function modal(html, onClose) {
    var old = document.getElementById('posModal');
    if (old) old.remove();
    var wrap = document.createElement('div');
    wrap.className = 'dialog-backdrop';
    wrap.id = 'posModal';
    wrap.innerHTML = '<div class="card dialog pos-dialog" role="dialog" aria-modal="true">' + html + '</div>';
    document.body.appendChild(wrap);
    var close = function () { wrap.remove(); if (onClose) onClose(); };
    wrap.addEventListener('click', function (e) { if (e.target === wrap) close(); });
    Array.prototype.forEach.call(wrap.querySelectorAll('[data-close]'), function (b) { b.onclick = close; });
    return { el: wrap, close: close };
  }

  /* ---------------- clock in / out */
  function openStaff(pos, after) {
    var d = pos.data;
    function html() {
      var open = openShiftNames(pos);
      return '<div class="pay-head"><h2>Clock in / out</h2><button class="link-btn" data-close>Done</button></div>' +
        (d.staff.length ? '<div class="staff-list">' + d.staff.map(function (n) {
          var since = open[n];
          var t = since ? (String(since).indexOf('T') > 0 ? new Date(since).toTimeString().slice(0, 5) : String(since).slice(11, 16)) : '';
          return '<div class="staff-row"><div><b>' + S.esc(n) + '</b><div class="small muted">' + (since ? 'Clocked in at ' + t : 'Not clocked in') + '</div></div>' +
            (since ? '<button class="btn btn-ghost" data-out="' + S.esc(n) + '">Clock out</button>'
              : '<button class="btn btn-primary" data-in="' + S.esc(n) + '">Clock in</button>') + '</div>';
        }).join('') + '</div>' : '<p class="muted">' + (pos.preview ? 'Still loading the staff list. Close this and try again in a moment.' : 'No staff in the event Settings tab yet.') + '</p>');
    }
    var m = modal(html());
    function wire() {
      Array.prototype.forEach.call(m.el.querySelectorAll('[data-in],[data-out]'), function (b) {
        b.onclick = function () {
          var name = b.getAttribute('data-in') || b.getAttribute('data-out');
          var dir = b.getAttribute('data-in') ? 'in' : 'out';
          if (dir === 'out' && !window.confirm('Clock out ' + name + '?')) return;
          var now = new Date().toISOString();
          enqueue(pos, { qid: 'C' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), type: 'clock', name: name, direction: dir, clientTime: now });
          if (dir === 'out' && pos.seller === name) pos.seller = '';
          m.el.querySelector('.pos-dialog').innerHTML = html();
          Array.prototype.forEach.call(m.el.querySelectorAll('[data-close]'), function (x) { x.onclick = m.close; });
          wire();
          if (after) after(); else drawCart(pos);
          flush(pos);
        };
      });
    }
    wire();
  }

  /* ---------------- recent sales */
  function openRecent(pos) {
    var failed = queue(pos).filter(function (x) { return x.error; });
    var waiting = queue(pos).filter(function (x) { return x.type === 'sale' && !x.error; });
    var sales = pos.data.recentSales || [];
    function saleRow(s, extra) {
      return '<div class="sale-row' + (s.void ? ' voided' : '') + '"><div class="sr-main"><b>' + S.money(s.total) + '</b> · ' + S.esc(s.method || '') +
        ' · ' + S.esc(s.seller || '') + '<div class="small muted">' + S.esc((s.date || '') + ' ' + (s.time || '')) +
        '</div><div class="sr-items">' + (s.lines || []).map(function (l) { return '<div>' + l.qty + '× ' + S.esc(l.name) + '</div>'; }).join('') + '</div>' +
        (s.void ? '<div class="small neg">Voided: ' + S.esc(s.voidReason) + '</div>' : '') + '</div>' + (extra || '') + '</div>';
    }
    function pendingAsSale(x) {
      var s = x.sale;
      return { total: s.total, method: s.method, seller: s.seller, date: '', time: new Date(s.clientTime).toTimeString().slice(0, 5),
        lines: s.lines.map(function (l) { var p = product(pos, l.ref); return { qty: l.qty, name: p ? p.name : l.ref }; }) };
    }
    var m = modal(
      '<div class="pay-head"><h2>Recent sales</h2><button class="link-btn" data-close>Close</button></div>' +
      (failed.length ? '<h3 class="rs-title neg">Not saved</h3>' + failed.map(function (x) {
        return saleRow(x.type === 'sale' ? pendingAsSale(x) : { total: 0, method: 'Clock ' + x.direction, seller: x.name, lines: [] },
          '<div class="small neg">' + S.esc(x.error) + '</div><button class="btn btn-ghost btn-sm" data-discard="' + S.esc(x.qid) + '">Discard</button>');
      }).join('') : '') +
      (waiting.length ? '<h3 class="rs-title">Waiting to send</h3>' + waiting.map(function (x) { return saleRow(pendingAsSale(x)); }).join('') : '') +
      '<h3 class="rs-title">Saved</h3>' +
      (sales.length ? sales.map(function (s) {
        return saleRow(s, pos.admin && !s.void ? '<button class="btn btn-ghost btn-sm" data-void="' + S.esc(s.id) + '">Void</button>' : '');
      }).join('') : '<p class="muted">No sales yet.</p>') +
      (!pos.admin ? '<p class="small muted">To cancel a sale, ask a manager. Voids are done from the management side.</p>' : ''));
    Array.prototype.forEach.call(m.el.querySelectorAll('[data-discard]'), function (b) {
      b.onclick = function () {
        if (!window.confirm('Discard this entry? It will not be recorded.')) return;
        setQueue(pos, queue(pos).filter(function (x) { return x.qid !== b.getAttribute('data-discard'); }));
        m.close(); render(pos);
      };
    });
    Array.prototype.forEach.call(m.el.querySelectorAll('[data-void]'), function (b) {
      b.onclick = function () {
        var reason = window.prompt('Why is this sale voided? (required)');
        if (!reason || !reason.trim()) return;
        b.disabled = true;
        req(pos, 'voidSale', { saleId: b.getAttribute('data-void'), reason: reason.trim() }).then(function () {
          S.toast('Sale voided. Stock is back.');
          m.close();
          refresh(pos);
        }).catch(function (err) { b.disabled = false; S.toast(err.message, true); });
      };
    });
  }

  window.SHN_POS = { staff: staff, mount: mount, unmount: unmount };
})();
