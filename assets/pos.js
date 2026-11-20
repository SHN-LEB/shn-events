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
  function sellerKey(id) { return 'shn-seller-' + id; }

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
      cart: [],
      seller: load(sellerKey(opts.eventId), ''),
      discount: '',
      note: '',
      query: '',
      cat: '',
      cartOpen: false,
      syncing: false,
      lastError: ''
    };
    current = pos;
    container.innerHTML = '<div class="pos" id="pos"></div>';
    if (pos.data) render(pos); else container.querySelector('#pos').innerHTML = '<div class="loading"><div class="spinner"></div><div>Loading products…</div></div>';
    refresh(pos);
    flush(pos);
    timers.push(setInterval(function () { if (current === pos) { flush(pos); } }, 20000));
    timers.push(setInterval(function () { if (current === pos && !pos.payOpen) refresh(pos); }, 120000));
    window.addEventListener('online', onOnline);
  }

  function onOnline() { if (current) flush(current); }

  function unmount() {
    timers.forEach(clearInterval);
    timers = [];
    window.removeEventListener('online', onOnline);
    current = null;
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
      save(dataKey(pos.eventId), res.pos);
      if (!pos.admin) staffTopbar(pos.eventId, res.pos.event.name);
      if (pos.data.staff.indexOf(pos.seller) < 0) pos.seller = '';
      if (!pos.payOpen) render(pos);
      warmPictures(res.pos.products);
    }).catch(function (err) {
      if (current !== pos) return;
      if (err.offline) { pos.offline = true; if (pos.data) render(pos); else showLoadError(pos, err); return; }
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
        return flush(pos);
      }
    }).catch(function (err) {
      pos.syncing = false;
      if (err.offline) { pos.offline = true; drawSync(pos); return; }
      if (err.code === 'auth') return;
      // the server refused it: keep it, show why, never lose it silently
      var q3 = queue(pos).map(function (x) { if (x.qid === next.qid) x.error = err.message; return x; });
      setQueue(pos, q3);
      if (current === pos) { S.toast('A ' + (next.type === 'sale' ? 'sale' : 'clock entry') + ' could not be saved: ' + err.message, true); render(pos); flush(pos); }
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
      ['', ].concat(cats).map(function (c) {
        return '<button class="chip' + (pos.cat === c ? ' active' : '') + '" data-cat="' + S.esc(c) + '">' + (c ? S.esc(c) : 'All') + '</button>';
      }).join('') + '</div></div>' +
      '<div class="tiles" id="posTiles"></div>' +
      '</section>' +
      '<aside class="pos-cart' + (pos.cartOpen ? ' open' : '') + '" id="posCart"></aside>' +
      '</div>' +
      '<button class="pos-cartbar" id="posCartBar"></button>';
    root.querySelector('#posSearch').oninput = function () { pos.query = this.value; drawTiles(pos); };
    Array.prototype.forEach.call(root.querySelectorAll('[data-cat]'), function (b) {
      b.onclick = function () { pos.cat = b.getAttribute('data-cat'); render(pos); };
    });
    root.querySelector('#posStaff').onclick = function () { openStaff(pos); };
    root.querySelector('#posRecent').onclick = function () { openRecent(pos); };
    root.querySelector('#posRefresh').onclick = function () { S.toast('Refreshing…'); refresh(pos); flush(pos); };
    root.querySelector('#posCartBar').onclick = function () { pos.cartOpen = true; drawCart(pos); };
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
    else html = '<span class="sync good">All sales saved</span>';
    el.innerHTML = html;
  }

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
      var left = stockOf(pos, p, pend);
      var n = inCart(pos, p.ref);
      var pic = picUrl(p.picture);
      return '<button class="tile' + (left <= 0 ? ' out' : '') + '" data-ref="' + S.esc(p.ref) + '">' +
        (n ? '<span class="tile-count">' + n + '</span>' : '') +
        '<span class="tile-img">' + (pic
          ? '<img src="' + S.esc(pic) + '" alt="" loading="lazy" onerror="this.parentNode.innerHTML=\'<span class=&quot;ph&quot;>' + S.esc(initials(p.name)) + '</span>\'">'
          : '<span class="ph">' + S.esc(initials(p.name)) + '</span>') + '</span>' +
        '<span class="tile-name">' + S.esc(p.name) + '</span>' +
        '<span class="tile-foot"><b>' + S.money(p.price) + '</b><span class="tile-stock">' + (left <= 0 ? 'None left' : left + ' left') + '</span></span>' +
        '</button>';
    }).join('');
    Array.prototype.forEach.call(el.querySelectorAll('.tile'), function (b) {
      b.onclick = function () { addToCart(pos, b.getAttribute('data-ref')); };
    });
  }

  function product(pos, ref) {
    return pos.data.products.filter(function (p) { return p.ref === ref; })[0];
  }

  function addToCart(pos, ref, delta) {
    delta = delta || 1;
    var p = product(pos, ref);
    if (!p) return;
    if (delta > 0 && stockOf(pos, p, pendingQty(pos)) <= 0) {
      if (!window.confirm('"' + p.name + '" shows no stock left. Add it anyway?')) return;
    }
    var line = pos.cart.filter(function (l) { return l.ref === ref; })[0];
    if (!line) { line = { ref: ref, qty: 0 }; pos.cart.push(line); }
    line.qty += delta;
    pos.cart = pos.cart.filter(function (l) { return l.qty > 0; });
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

  function drawCart(pos) {
    var el = document.getElementById('posCart');
    var bar = document.getElementById('posCartBar');
    if (!el) return;
    var d = pos.data;
    var t = totals(pos);
    var open = openShiftNames(pos);
    var sellers = d.staff.filter(function (n) { return open[n]; });
    if (pos.seller && sellers.indexOf(pos.seller) < 0) pos.seller = '';
    if (!pos.seller && sellers.length === 1) pos.seller = sellers[0];
    var discBad = t.disc > d.maxDiscountPct;

    el.className = 'pos-cart' + (pos.cartOpen ? ' open' : '');
    el.innerHTML =
      '<div class="cart-head"><h2>Sale</h2><button class="link-btn cart-close" id="cartClose">Close</button></div>' +
      '<div class="cart-section"><div class="cart-label">Sold by</div>' +
      (sellers.length
        ? '<div class="sellers">' + sellers.map(function (n) {
          return '<button class="seller' + (pos.seller === n ? ' active' : '') + '" data-seller="' + S.esc(n) + '">' + S.esc(n) + '</button>';
        }).join('') + '</div>'
        : '<div class="cart-empty-seller">Nobody is clocked in. <button class="link-btn" id="cartClockIn">Clock in</button></div>') +
      '</div>' +
      '<div class="cart-lines">' + (pos.cart.length ? pos.cart.map(function (l) {
        var p = product(pos, l.ref);
        if (!p) return '';
        return '<div class="cart-line"><div class="cl-main"><div class="cl-name">' + S.esc(p.name) + '</div>' +
          '<div class="cl-price">' + S.money(p.price) + ' each</div></div>' +
          '<div class="qty"><button data-dec="' + S.esc(l.ref) + '" aria-label="One less">−</button><span>' + l.qty + '</span>' +
          '<button data-inc="' + S.esc(l.ref) + '" aria-label="One more">+</button></div>' +
          '<div class="cl-total">' + S.money(r2(p.price * l.qty)) + '</div></div>';
      }).join('') : '<div class="cart-empty">Tap products to add them.</div>') + '</div>' +
      (pos.cart.length ? (
        '<div class="cart-section disc-row">' +
        '<label for="cartDisc">Discount %</label>' +
        '<input class="input" id="cartDisc" inputmode="decimal" placeholder="0" value="' + S.esc(pos.discount) + '">' +
        '<input class="input" id="cartNote" placeholder="Note: promo code, voucher…" value="' + S.esc(pos.note) + '">' +
        '<div class="small ' + (discBad ? 'neg' : 'muted') + '" id="discHint">Up to ' + d.maxDiscountPct + '%</div></div>' +
        '<div class="cart-totals">' +
        (t.off ? '<div><span>Subtotal</span><span>' + S.money(t.sub) + '</span></div><div><span>Discount ' + t.disc + '%</span><span>−' + S.money(t.off) + '</span></div>' : '') +
        '<div class="grand"><span>Total</span><span>' + S.money(t.total) + '</span></div>' +
        '<div class="lbp-eq"><span></span><span>' + lbp(t.total * d.fxRate) + '</span></div></div>' +
        '<div class="cart-actions"><button class="btn btn-ghost" id="cartClear">Clear</button>' +
        '<button class="btn btn-accent btn-big" id="cartPay"' + (!pos.seller || discBad ? ' disabled' : '') + '>Charge ' + S.money(t.total) + '</button></div>' +
        (!pos.seller ? '<div class="small muted center">Pick who made the sale.</div>' : '')
      ) : '');

    bar.innerHTML = t.units ? '<span>' + t.units + (t.units === 1 ? ' item' : ' items') + '</span><b>' + S.money(t.total) + '</b><span>Review ›</span>' : '';
    bar.className = 'pos-cartbar' + (t.units && !pos.cartOpen ? ' show' : '');

    var q = function (s) { return el.querySelector(s); };
    q('#cartClose').onclick = function () { pos.cartOpen = false; drawCart(pos); };
    if (q('#cartClockIn')) q('#cartClockIn').onclick = function () { openStaff(pos); };
    Array.prototype.forEach.call(el.querySelectorAll('[data-seller]'), function (b) {
      b.onclick = function () { pos.seller = b.getAttribute('data-seller'); save(sellerKey(pos.eventId), pos.seller); drawCart(pos); };
    });
    Array.prototype.forEach.call(el.querySelectorAll('[data-inc]'), function (b) { b.onclick = function () { addToCart(pos, b.getAttribute('data-inc'), 1); }; });
    Array.prototype.forEach.call(el.querySelectorAll('[data-dec]'), function (b) { b.onclick = function () { addToCart(pos, b.getAttribute('data-dec'), -1); }; });
    if (q('#cartDisc')) {
      q('#cartDisc').onchange = function () { pos.discount = this.value.replace(/[^0-9.]/g, ''); drawCart(pos); };
      q('#cartNote').oninput = function () { pos.note = this.value; };
      q('#cartClear').onclick = function () {
        if (!window.confirm('Clear this sale?')) return;
        pos.cart = []; pos.discount = ''; pos.note = ''; drawTiles(pos); drawCart(pos);
      };
      q('#cartPay').onclick = function () { openPay(pos); };
    }
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

  /* ---------------- payment */
  function openPay(pos) {
    var d = pos.data;
    var t = totals(pos);
    var fx = d.fxRate;
    var step = d.lbpStep || 5000;
    if (!fx) { S.toast('The exchange rate is not set for this event.', true); return; }
    var st = { method: 'Cash', online: '', recvUsd: '', recvLbp: '', changeUsd: null, changeLbp: null };
    pos.payOpen = true;
    var m = modal(
      '<div class="pay-head"><h2>Payment</h2><button class="link-btn" data-close>Cancel</button></div>' +
      '<div class="pay-total"><div class="big">' + S.money(t.total) + '</div><div class="muted">' + lbp(t.total * fx) + ' at ' + S.num(fx) + '</div></div>' +
      '<div class="seg" id="paySeg">' + ['Cash', 'Online', 'Split'].map(function (x) {
        return '<button data-m="' + x + '" class="' + (x === 'Cash' ? 'active' : '') + '">' + (x === 'Split' ? 'Cash + online' : x) + '</button>';
      }).join('') + '</div>' +
      '<div id="payBody"></div>' +
      '<div id="payError"></div>' +
      '<button class="btn btn-accent btn-big btn-block" id="payConfirm">Confirm sale</button>',
      function () { pos.payOpen = false; });

    function cashDue() { return st.method === 'Online' ? 0 : r2(t.total - (st.method === 'Split' ? parseNum(st.online) : 0)); }
    function paid() { return parseNum(st.recvUsd) + parseNum(st.recvLbp) / fx; }

    function body() {
      var due = cashDue();
      var html = '';
      if (st.method === 'Split') {
        html += '<div class="field"><label>Paid online (USD)</label><input class="input money-in" id="payOnline" inputmode="decimal" value="' + S.esc(st.online) + '" placeholder="0"></div>';
      }
      if (st.method === 'Online') {
        html += '<p class="muted">The customer paid the full amount online (card, Whish or other). No cash changes hands.</p>';
      } else {
        html += '<div class="due-line">Cash to collect: <b>' + S.money(due) + '</b> <span class="muted">(' + lbp(due * fx) + ')</span></div>' +
          '<div class="row-2">' +
          '<div class="field"><label>Received USD</label><input class="input money-in" id="payUsd" inputmode="decimal" placeholder="0" value="' + S.esc(st.recvUsd) + '"></div>' +
          '<div class="field"><label>Received LBP</label><input class="input money-in" id="payLbp" inputmode="numeric" placeholder="0" value="' + S.esc(st.recvLbp) + '"></div>' +
          '</div>' +
          '<div class="quick"><button data-exact="usd">Exact in USD</button><button data-exact="lbp">Exact in LBP</button></div>' +
          '<div id="changeBox"></div>';
      }
      document.getElementById('payBody').innerHTML = html;
      var on = document.getElementById('payOnline');
      if (on) on.oninput = function () { st.online = this.value; st.changeUsd = null; st.changeLbp = null; drawChange(); };
      var u = document.getElementById('payUsd');
      if (u) {
        u.oninput = function () { st.recvUsd = this.value; st.changeUsd = null; st.changeLbp = null; drawChange(); };
        document.getElementById('payLbp').oninput = function () { st.recvLbp = this.value; st.changeUsd = null; st.changeLbp = null; drawChange(); };
        document.getElementById('payLbp').onblur = function () { if (parseNum(this.value)) this.value = Math.round(parseNum(this.value)).toLocaleString('en-US'); };
        Array.prototype.forEach.call(document.querySelectorAll('[data-exact]'), function (b) {
          b.onclick = function () {
            var due2 = cashDue();
            if (b.getAttribute('data-exact') === 'usd') { st.recvUsd = String(due2); st.recvLbp = ''; }
            else { st.recvUsd = ''; st.recvLbp = roundLbp(due2 * fx, step).toLocaleString('en-US'); }
            st.changeUsd = null; st.changeLbp = null;
            body();
          };
        });
      }
      drawChange();
    }

    function drawChange() {
      var box = document.getElementById('changeBox');
      if (!box) return;
      var due = cashDue();
      var p = paid();
      var tol = step / fx + 0.005;
      if (!parseNum(st.recvUsd) && !parseNum(st.recvLbp)) { box.innerHTML = ''; return; }
      if (p < due - tol) {
        var short = r2(due - p);
        box.innerHTML = '<div class="owed">Still to collect: <b>' + S.money(short) + '</b> (' + lbp(roundLbp(short * fx, step)) + ')</div>';
        return;
      }
      var change = r2(p - due);
      if (change < 0.005 || Math.abs(change * fx) < step / 2) {
        box.innerHTML = '<div class="nochange">No change to give.</div>';
        st.changeUsd = 0; st.changeLbp = 0;
        return;
      }
      if (st.changeUsd === null) st.changeUsd = String(Math.floor(change));
      var restUsd = Math.max(0, change - parseNum(st.changeUsd));
      var suggested = roundLbp(restUsd * fx, step);
      if (st.changeLbp === null) st.changeLbp = suggested ? suggested.toLocaleString('en-US') : '0';
      box.innerHTML =
        '<div class="change-due">Change to give: <b>' + S.money(change) + '</b> <span class="muted">(' + lbp(roundLbp(change * fx, step)) + ')</span></div>' +
        '<div class="quick"><button data-ch="usd">All in USD</button><button data-ch="lbp">All in LBP</button></div>' +
        '<div class="row-2">' +
        '<div class="field"><label>Change given USD</label><input class="input money-in" id="chUsd" inputmode="numeric" value="' + S.esc(st.changeUsd) + '"></div>' +
        '<div class="field"><label>Change given LBP</label><input class="input money-in" id="chLbp" inputmode="numeric" value="' + S.esc(st.changeLbp) + '"></div>' +
        '</div>' +
        '<div class="small muted" id="chHint">' + (suggested ? 'Give ' + lbp(suggested) + ' with the $' + S.num(parseNum(st.changeUsd)) + '.' : 'All change in USD.') + ' LBP rounded to ' + S.num(step) + '.</div>';
      document.getElementById('chUsd').oninput = function () {
        st.changeUsd = this.value;
        var rest = Math.max(0, change - parseNum(st.changeUsd));
        var sug = roundLbp(rest * fx, step);
        st.changeLbp = sug.toLocaleString('en-US');
        document.getElementById('chLbp').value = st.changeLbp;
        document.getElementById('chHint').textContent = (sug ? 'Give ' + lbp(sug) + ' with the $' + S.num(parseNum(st.changeUsd)) + '.' : 'All change in USD.') + ' LBP rounded to ' + S.num(step) + '.';
      };
      document.getElementById('chLbp').oninput = function () { st.changeLbp = this.value; };
      Array.prototype.forEach.call(box.querySelectorAll('[data-ch]'), function (b) {
        b.onclick = function () {
          if (b.getAttribute('data-ch') === 'usd') { st.changeUsd = String(Math.round(change)); st.changeLbp = '0'; }
          else { st.changeUsd = '0'; st.changeLbp = roundLbp(change * fx, step).toLocaleString('en-US'); }
          drawChange();
        };
      });
    }

    Array.prototype.forEach.call(m.el.querySelectorAll('[data-m]'), function (b) {
      b.onclick = function () {
        st.method = b.getAttribute('data-m');
        st.changeUsd = null; st.changeLbp = null;
        Array.prototype.forEach.call(m.el.querySelectorAll('[data-m]'), function (x) { x.className = x === b ? 'active' : ''; });
        body();
      };
    });
    body();

    m.el.querySelector('#payConfirm').onclick = function () {
      var err = '';
      var due = cashDue();
      var fxTol = step / fx + 0.005;
      var sale = {
        id: newSaleId(), seller: pos.seller, method: st.method, discountPct: t.disc, note: pos.note.trim(),
        lines: pos.cart.map(function (l) { return { ref: l.ref, qty: l.qty }; }),
        onlineUsd: st.method === 'Split' ? r2(parseNum(st.online)) : (st.method === 'Online' ? t.total : 0),
        recvUsd: 0, recvLbp: 0, changeUsd: 0, changeLbp: 0, clientTime: new Date().toISOString(), total: t.total
      };
      if (st.method === 'Split' && !(sale.onlineUsd > 0 && sale.onlineUsd < t.total)) err = 'Enter the part paid online (less than the total).';
      if (!err && due > 0) {
        sale.recvUsd = parseNum(st.recvUsd);
        sale.recvLbp = Math.round(parseNum(st.recvLbp));
        sale.changeUsd = parseNum(st.changeUsd || 0);
        sale.changeLbp = Math.round(parseNum(st.changeLbp || 0));
        var p = sale.recvUsd + sale.recvLbp / fx;
        if (p < due - fxTol) err = 'The cash received is less than ' + S.money(due) + '.';
        else {
          var diff = (p - due) - sale.changeUsd - sale.changeLbp / fx;
          if (Math.abs(diff) > 1 + fxTol) err = diff > 0 ? 'Not enough change given. Check the amounts.' : 'More change given than due. Check the amounts.';
        }
      }
      if (err) { m.el.querySelector('#payError').innerHTML = '<div class="form-error">' + S.esc(err) + '</div>'; return; }
      enqueue(pos, { qid: sale.id, type: 'sale', sale: sale });
      pos.cart = []; pos.discount = ''; pos.note = ''; pos.cartOpen = false;
      m.close();
      render(pos);
      var change = sale.changeUsd || sale.changeLbp
        ? ' Give back ' + [sale.changeUsd ? '$' + S.num(sale.changeUsd) : '', sale.changeLbp ? lbp(sale.changeLbp) : ''].filter(Boolean).join(' + ') + '.'
        : '';
      S.toast('Sale saved: ' + S.money(sale.total) + '.' + change);
      flush(pos);
    };
  }

  /* ---------------- clock in / out */
  function openStaff(pos) {
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
        }).join('') + '</div>' : '<p class="muted">No staff in the event Settings tab yet.</p>');
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
          if (dir === 'in' && !pos.seller) { pos.seller = name; save(sellerKey(pos.eventId), name); }
          if (dir === 'out' && pos.seller === name) pos.seller = '';
          m.el.querySelector('.pos-dialog').innerHTML = html();
          Array.prototype.forEach.call(m.el.querySelectorAll('[data-close]'), function (x) { x.onclick = m.close; });
          wire();
          drawCart(pos);
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
        ' · ' + S.esc(s.seller || '') + '<div class="small muted">' + S.esc((s.date || '') + ' ' + (s.time || '')) + ' · ' +
        S.esc((s.lines || []).map(function (l) { return l.qty + '× ' + l.name; }).join(', ')) + '</div>' +
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
