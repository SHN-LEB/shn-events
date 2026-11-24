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
  function holdKey(id) { return 'shn-hold-' + id; }
  function demoKey(id) { return 'shn-demo-' + id; }
  function contactsKey(id) { return 'shn-contacts-' + id; }
  function refillKey(id) { return 'shn-refill-' + id; }

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
      return mount(S.app, { eventId: eventId, token: token, admin: false, home: true });
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
      if ((err.code === 'closed' || err.code === 'draft' || err.code === 'ended') && document.getElementById('pinDots')) {
        S.app.innerHTML = '<div class="card empty"><h2>' + S.esc(err.code === 'closed' ? 'This event is closed' : err.code === 'draft' ? 'This event is not launched yet' : 'Access has ended') + '</h2>' +
          '<p class="muted">' + S.esc(err.code === 'ended' ? err.message : 'Ask your manager.') + '</p></div>';
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
        mount(S.app, { eventId: eventId, token: res.token, admin: false, home: true });
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
      view: opts.home ? 'home' : 'products',
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
        if ((err.code === 'auth' || err.code === 'ended') && !pos.admin) {
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
      if (!res || !res.pos || !res.pos.products || !res.pos.event) {
        var e = new Error('The server answered without the product list.');
        e.offline = true;
        e.detail = 'posData: incomplete answer (version ' + (res && res.version) + ', keys: ' + Object.keys(res || {}).join(',') + ')';
        throw e;
      }
      pos.data = res.pos;
      pos.offline = false;
      pos.preview = false;
      save(dataKey(pos.eventId), res.pos);
      if (!pos.admin) staffTopbar(pos.eventId, res.pos.event.name);
      if (pos.data.staff.indexOf(pos.seller) < 0) pos.seller = '';
      if (pos.view === 'checkout') update(pos); else if (pos.view === 'products' || pos.view === 'home') render(pos); else drawSync(pos);
      warmPictures(res.pos.products);
    }).catch(function (err) {
      if (current !== pos) return;
      if (err.offline) {
        pos.offline = true;
        if (err.detail) report(pos, err, 'posData');
        if (!pos.data) showLoadError(pos, err); else if (pos.view === 'products') render(pos);
        if (err.detail) setTimeout(function () { if (current === pos) refresh(pos); }, 5000);
        return;
      }
      if (err.code === 'closed' || err.code === 'draft') { pos.el.innerHTML = '<div class="card empty"><h2>' + (err.code === 'draft' ? 'This event is not launched yet' : 'This event is closed') + '</h2><p class="muted">Ask your manager.</p></div>'; return; }
      report(pos, err, 'posData');
      if (!pos.data) showLoadError(pos, err); else showError(pos, 'Couldn\'t refresh the products.', err);
    });
  }

  function showLoadError(pos, err) {
    pos.el.querySelector('#pos').innerHTML = '<div class="card empty"><h2>Couldn\'t load the POS</h2><p class="muted">' + S.esc(err.message) + '</p>' +
      detailsHtml(err) +
      '<button class="btn btn-primary" id="posRetry">Try again</button></div>';
    document.getElementById('posRetry').onclick = function () { refresh(pos); };
  }

  /* ---------------- errors: a plain sentence for staff, the technical details underneath (for screenshots),
     and a copy in the master sheet's Errors tab */
  function detailsHtml(err) {
    var tech = (err && (err.detail || err.stack || err.message)) || String(err);
    var when = new Date().toTimeString().slice(0, 8);
    return '<div class="err-details">Details: ' + S.esc(String(tech).split('\n')[0].slice(0, 300)) + ' · v' + S.esc(S.version) + ' · ' + when + '</div>';
  }
  function report(pos, err, where) {
    S.reportError(err, { eventId: pos && pos.eventId, where: (pos && pos.admin ? 'admin POS: ' : 'staff POS: ') + where });
  }
  function showError(pos, sentence, err) {
    pos.lastError = { sentence: sentence, err: err };
    var slot = document.getElementById('posErr');
    if (slot) { slot.outerHTML = errorSlot(pos); wireErrorSlot(pos, document); }
  }
  function errorSlot(pos) {
    if (!pos.lastError) return '<div id="posErr"></div>';
    return '<div id="posErr" class="err-box"><div><b>' + S.esc(pos.lastError.sentence) + '</b> ' + S.esc(pos.lastError.err.message || '') +
      '</div>' + detailsHtml(pos.lastError.err) + '<button class="link-btn" id="posErrClose">Dismiss</button></div>';
  }
  function wireErrorSlot(pos, root) {
    var b = root.querySelector('#posErrClose');
    if (b) b.onclick = function () { pos.lastError = null; var slot = document.getElementById('posErr'); if (slot) slot.outerHTML = '<div id="posErr"></div>'; };
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
    var call = next.type === 'sale' ? req(pos, 'recordSale', { sale: next.sale })
      : next.type === 'return' ? req(pos, 'recordReturn', { ret: next.ret })
        : next.type === 'count' ? req(pos, 'recordCount', { count: next.count })
          : next.type === 'cash' ? req(pos, 'recordCash', { cash: next.cash })
            : next.type === 'day' ? req(pos, 'dayAction', { day: next.day })
              : next.type === 'customer' ? req(pos, 'recordCustomer', { customer: next.customer })
                : next.type === 'refill' ? req(pos, 'recordRefill', { refill: next.refill })
                  : next.type === 'demo' ? req(pos, 'recordDemo', { demo: next.demo })
                    : req(pos, 'clock', { name: next.name, direction: next.direction, clientTime: next.clientTime, note: next.note || '' });
    var answerKey = { sale: 'sale', 'return': 'sale', clock: 'openShifts', count: 'count', cash: 'cash', day: 'day', customer: 'customer', refill: 'refill', demo: 'demo' }[next.type];
    return call.then(function (res) {
      if (!res || !res[answerKey]) {
        var e = new Error('The server answered without confirming.');
        e.offline = true;
        e.detail = next.type + ': incomplete answer (version ' + (res && res.version) + ')';
        throw e;
      }
      var q2 = queue(pos).filter(function (x) { return x.qid !== next.qid; });
      setQueue(pos, q2);
      pos.syncing = false;
      if ((next.type === 'sale' || next.type === 'return') && pos.data) {
        pos.data.recentSales = [res.sale].concat((pos.data.recentSales || []).filter(function (s) { return s.id !== res.sale.id; }));
      }
      if (next.type === 'clock' && pos.data) pos.data.openShifts = res.openShifts;
      if (next.type === 'day' && pos.data) pos.data.day = res.day;
      if (pos.data) save(dataKey(pos.eventId), pos.data);
      if (current === pos) {
        if (!q2.some(function (x) { return !x.error; })) refresh(pos);
        else drawSync(pos);
        return flush(pos);
      }
    }).catch(function (err) {
      pos.syncing = false;
      if (err.offline) { pos.offline = true; if (err.detail) report(pos, err, 'sync'); drawSync(pos); return; }
      if (err.code === 'auth') return;
      report(pos, err, 'sync ' + next.type);
      // the server refused it: keep it, show why, never lose it silently
      var q3 = queue(pos).map(function (x) { if (x.qid === next.qid) x.error = err.message; return x; });
      setQueue(pos, q3);
      if (current === pos) {
        showError(pos, 'A ' + ({ clock: 'clock entry', customer: 'customer contact', refill: 'refill request', demo: 'demo count' }[next.type] || next.type) + ' could not be saved.', err);
        if (pos.view === 'products') render(pos);
        flush(pos);
      }
    });
  }

  /* stock shown = server stock − sales still waiting on this phone */
  function pendingQty(pos) {
    var out = {};
    queue(pos).forEach(function (x) {
      if (x.error) return;
      if (x.type === 'sale') x.sale.lines.forEach(function (l) { out[l.ref] = (out[l.ref] || 0) + l.qty; });
      if (x.type === 'return') x.ret.lines.forEach(function (l) { out[l.ref] = (out[l.ref] || 0) - l.qty; });
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
    if (pos.view === 'return') return renderReturn(pos);
    if (pos.view === 'home') return renderHome(pos);
    if (pos.view === 'clock') return renderClock(pos);
    if (pos.view === 'count') return renderCount(pos);
    if (pos.view === 'cash') return renderCash(pos);
    if (pos.view === 'demo') return renderDemo(pos);
    if (pos.view === 'customers') return renderCustomers(pos);
    document.body.classList.remove('pos-checkout');
    var d = pos.data;
    var cats = [];
    d.products.forEach(function (p) { if (p.category && cats.indexOf(p.category) < 0) cats.push(p.category); });
    cats.sort();
    var held = holds(pos).length;
    root.innerHTML =
      '<div class="pos-bar">' +
      '<div class="pos-bar-actions">' +
      (pos.admin ? '' : '<button class="btn btn-ghost btn-sm" id="posHome">‹ Home</button>') +
      '<button class="btn btn-ghost btn-sm' + (held ? ' has-hold' : '') + '" id="posHold">On hold' + (held ? ' <b>' + held + '</b>' : '') + '</button>' +
      '<button class="btn btn-ghost btn-sm" id="posRecent">Recent sales</button>' +
      '<button class="btn btn-ghost btn-sm icon-only" id="posCustomer" title="Add a customer contact" aria-label="Add a customer contact">' + ICONS.person + '</button>' +
      '<button class="icon-btn btn-sm-h" id="posRefresh" title="Reload products and stock" aria-label="Refresh">' + ICONS.refresh + '<span id="syncDot"></span></button>' +
      '</div></div>' + errorSlot(pos) +
      '<div class="pos-grid">' +
      '<section class="pos-products">' +
      '<div class="pos-filters">' +
      '<div class="search-wrap"><input class="input" id="posSearch" type="search" placeholder="Search, ref code or barcode" value="' + S.esc(pos.query) + '" autocomplete="off" enterkeyhint="search">' +
      '<button class="scan-btn" id="posScan" type="button" aria-label="Scan a barcode" title="Scan a barcode">' + ICONS.scan + '</button></div>' +
      '<div class="chips pos-chips">' +
      [''].concat(cats).map(function (c) {
        return '<button class="chip' + (pos.cat === c ? ' active' : '') + '" data-cat="' + S.esc(c) + '">' + (c ? S.esc(c) : 'All') + '</button>';
      }).join('') + '</div></div>' +
      '<div class="tiles" id="posTiles"></div>' +
      '</section>' +
      '<aside class="pos-cart" id="posCart"></aside>' +
      '</div>' +
      '<button class="pos-cartbar" id="posCartBar"></button>';
    var search = root.querySelector('#posSearch');
    search.oninput = function () { pos.query = this.value; drawTiles(pos); };
    // a barcode typed (or sent by a scanner gun) + Enter adds the product
    search.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var hit = byBarcode(pos, search.value);
      if (hit) { e.preventDefault(); addToCart(pos, hit.ref, 1); S.toast('Added: ' + hit.name); pos.query = ''; search.value = ''; drawTiles(pos); }
    });
    root.querySelector('#posScan').onclick = function () {
      openScanner(pos, { title: 'Scan products', popup: true }, null);
    };
    Array.prototype.forEach.call(root.querySelectorAll('[data-cat]'), function (b) {
      b.onclick = function () { pos.cat = b.getAttribute('data-cat'); render(pos); };
    });
    root.querySelector('#posHold').onclick = function () { openHolds(pos); };
    root.querySelector('#posCustomer').onclick = function () { openCustomer(pos); };
    if (root.querySelector('#posHome')) root.querySelector('#posHome').onclick = function () { go(pos, 'home'); };
    root.querySelector('#posRecent').onclick = function () { openRecent(pos); };
    root.querySelector('#posRefresh').onclick = function () { S.toast('Refreshing…'); refresh(pos); flush(pos); };
    root.querySelector('#posCartBar').onclick = function () { openCheckout(pos); };
    wireErrorSlot(pos, root);
    drawTiles(pos);
    drawCart(pos);
    drawSync(pos);
  }

  function drawSync(pos) {
    if (current !== pos) return;
    var q = queue(pos);
    var failed = q.filter(function (x) { return x.error; }).length;
    var waiting = q.length - failed;
    var dot = document.getElementById('syncDot');
    if (dot) {
      dot.className = failed ? 'sync-dot bad' : waiting ? 'sync-dot warn' : '';
      dot.textContent = failed ? failed : waiting ? waiting : '';
      dot.parentNode.title = failed ? failed + ' not saved: check Recent sales' : waiting ? waiting + ' waiting to send' + (pos.offline ? ' (offline)' : '') : 'Reload products and stock';
    }
    var el = document.getElementById('posSync');
    if (!el) return;
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
    return pos.cart.reduce(function (a, x) { return a + (x.ref === ref ? x.qty : 0); }, 0);
  }

  function tileInner(pos, p, pend) {
    var n = inCart(pos, p.ref);
    var pic = picUrl(p.picture);
    return '<span class="tile-img">' + (pic
        ? '<img src="' + S.esc(pic) + '" alt="" loading="lazy" onerror="this.parentNode.querySelector(\'.ph\').hidden=false;this.remove()">'
        : '') + '<span class="ph"' + (pic ? ' hidden' : '') + '>' + S.esc(initials(p.name)) + '</span>' +
      '<span class="tile-qty-wrap">' + tileQty(n, p.ref) + '</span></span>' +
      '<span class="tile-name">' + S.esc(p.name) + '</span>' +
      '<span class="tile-row"><span class="tile-price">' + S.money(p.price) + '</span><span class="tile-stock">' + stockText(pos, p, pend) + '</span></span>';
  }
  function stockText(pos, p, pend) {
    if (!hasStock(p)) return '';
    var left = stockOf(pos, p, pend);
    return left <= 0 ? '0 left' : left + ' left';
  }
  function tileQty(n, ref) {
    return n ? '<span class="tile-qty"><button class="tq" data-dec="' + S.esc(ref) + '" aria-label="One less">−</button><b>' + n + '</b>' +
      '<button class="tq" data-inc="' + S.esc(ref) + '" aria-label="One more">+</button></span>' : '';
  }
  function tileClass(pos, p, pend) {
    var n = inCart(pos, p.ref);
    var out = hasStock(p) && stockOf(pos, p, pend) + n <= 0;
    return 'tile' + (out ? ' out' : '') + (n ? ' in-cart' : '');
  }

  function drawTiles(pos) {
    var el = document.getElementById('posTiles');
    if (!el) return;
    var q = pos.query.trim().toLowerCase();
    var pend = pendingQty(pos);
    var list = pos.data.products.filter(function (p) {
      if (pos.cat && p.category !== pos.cat) return false;
      return !q || p.name.toLowerCase().indexOf(q) >= 0 || String(p.ref).toLowerCase().indexOf(q) >= 0 ||
        (q.length >= 4 && (p.barcodes || []).some(function (b) { return b.indexOf(q) >= 0; }));
    });
    if (!pos.data.products.length) {
      el.innerHTML = '<div class="card empty"><p class="muted">No products in this event yet. Ask your manager to fill the Listing tab.</p></div>';
      return;
    }
    if (!list.length) { el.innerHTML = '<div class="card empty"><p class="muted">No products match.</p></div>'; return; }
    el.innerHTML = list.map(function (p) {
      return '<div class="' + tileClass(pos, p, pend) + '" data-ref="' + S.esc(p.ref) + '" role="button" tabindex="0">' + tileInner(pos, p, pend) + '</div>';
    }).join('');
    el.onclick = function (e) {
      var t = e.target.closest('.tile');
      if (!t) return;
      var inc = e.target.closest('[data-inc]'), dec = e.target.closest('[data-dec]');
      if (dec) return addToCart(pos, dec.getAttribute('data-dec'), -1);
      if (inc) return addToCart(pos, inc.getAttribute('data-inc'), 1);
      addToCart(pos, t.getAttribute('data-ref'), 1);
    };
  }

  /* only the tapped tile changes: its picture is never redrawn */
  function updateTile(pos, ref) {
    var el = document.querySelector('#posTiles .tile[data-ref="' + (window.CSS && CSS.escape ? CSS.escape(ref) : ref) + '"]');
    var p = product(pos, ref);
    if (!el || !p) return;
    var pend = pendingQty(pos);
    var n = inCart(pos, ref);
    el.className = tileClass(pos, p, pend);
    el.querySelector('.tile-qty-wrap').innerHTML = tileQty(n, ref);
    el.querySelector('.tile-stock').textContent = stockText(pos, p, pend);
  }

  function product(pos, ref) {
    return pos.data.products.filter(function (p) { return p.ref === ref; })[0];
  }

  var lineSeq = 0;
  function newLine(ref, qty) { return { key: 'L' + (++lineSeq), ref: ref, qty: qty, disc: 0, round: true, note: '' }; }

  /* from a tile: works on the full-price line of that product */
  function addToCart(pos, ref, delta) {
    delta = delta || 1;
    var p = product(pos, ref);
    if (!p) return;
    if (delta > 0 && hasStock(p) && stockOf(pos, p, pendingQty(pos)) <= 0) {
      if (!window.confirm('"' + p.name + '" shows no stock left. Add it anyway?')) return;
    }
    var line = pos.cart.filter(function (l) { return l.ref === ref && !l.disc; })[0];
    if (!line && delta < 0) line = pos.cart.filter(function (l) { return l.ref === ref; }).pop();
    if (!line) { if (delta < 0) return; line = newLine(ref, 0); pos.cart.push(line); }
    line.qty += delta;
    afterCartChange(pos, ref);
  }

  /* from the checkout: works on one line */
  function changeLine(pos, key, delta) {
    var line = pos.cart.filter(function (l) { return l.key === key; })[0];
    if (!line) return;
    if (delta > 0) {
      var p = product(pos, line.ref);
      if (p && hasStock(p) && stockOf(pos, p, pendingQty(pos)) <= 0 && !window.confirm('"' + p.name + '" shows no stock left. Add it anyway?')) return;
    }
    line.qty += delta;
    afterCartChange(pos, line.ref);
  }

  function afterCartChange(pos, ref) {
    pos.cart = pos.cart.filter(function (l) { return l.qty > 0; });
    if (pos.view === 'checkout') { if (!pos.cart.length) closeCheckout(pos); else renderCheckout(pos); return; }
    updateTile(pos, ref);
    drawCart(pos);
  }

  /* same maths as the server: item discounts (optionally rounded down), or one order discount that replaces them */
  function lineTotal(pos, l, ignoreItemDisc) {
    var p = product(pos, l.ref);
    if (!p) return 0;
    var gross = p.price * l.qty;
    if (ignoreItemDisc || !l.disc) return r2(gross);
    var t = r2(gross * (1 - l.disc / 100));
    return l.round ? Math.floor(t) : t;
  }

  function totals(pos) {
    var sub = 0, afterItems = 0;
    var order = parseNum(pos.discount);
    pos.cart.forEach(function (l) { var p = product(pos, l.ref); if (p) sub += p.price * l.qty; afterItems += lineTotal(pos, l, order > 0); });
    sub = r2(sub); afterItems = r2(afterItems);
    var total = afterItems;
    if (order > 0) { total = r2(afterItems * (1 - order / 100)); if (pos.roundOrder !== false) total = Math.floor(total); }
    var maxItem = pos.cart.reduce(function (a, l) { return Math.max(a, l.disc || 0); }, 0);
    return { sub: sub, disc: order, maxDisc: Math.max(order, order > 0 ? 0 : maxItem), off: r2(sub - total), total: total,
      units: pos.cart.reduce(function (a, l) { return a + l.qty; }, 0), itemDisc: pos.cart.some(function (l) { return l.disc > 0; }) };
  }

  /* the % button on a checkout line: discount some of the units */
  function openItemDiscount(pos, key) {
    var line = pos.cart.filter(function (l) { return l.key === key; })[0];
    if (!line) return;
    var p = product(pos, line.ref);
    var editing = line.disc > 0;
    var m = modal(
      '<div class="pay-head"><h2>Item discount</h2><button class="link-btn" data-close>Cancel</button></div>' +
      '<p class="muted" style="margin-top:0">' + S.esc(p.name) + ' · ' + S.money(p.price) + ' each</p>' +
      '<div class="two">' +
      '<div class="field"><label for="idQty">Quantity discounted</label><input class="input money-in" id="idQty" inputmode="numeric" value="' + (editing ? line.qty : 1) + '"></div>' +
      '<div class="field"><label for="idPct">Discount %</label><input class="input money-in" id="idPct" inputmode="decimal" placeholder="0" value="' + (editing ? line.disc : '') + '"></div>' +
      '</div>' +
      '<div class="field"><label for="idNote">Note (optional)</label><input class="input" id="idNote" placeholder="Promo code, voucher…" value="' + S.esc(line.note || '') + '"></div>' +
      '<label class="check"><input type="checkbox" id="idRound"' + (line.round !== false ? ' checked' : '') + '> Round down to whole $</label>' +
      '<div class="small muted" id="idPreview"></div>' +
      '<div id="idErr"></div>' +
      '<div class="dialog-actions">' + (editing ? '<button class="btn btn-ghost" id="idRemove">Remove discount</button>' : '') +
      '<button class="btn btn-primary" id="idOk">OK</button></div>');
    var $ = function (sel) { return m.el.querySelector(sel); };
    var maxQ = line.qty;
    function preview() {
      var q = Math.max(1, Math.min(maxQ, Math.round(parseNum($('#idQty').value)) || 1));
      var d = parseNum($('#idPct').value);
      var t = r2(p.price * q * (1 - d / 100));
      if ($('#idRound').checked && d > 0) t = Math.floor(t);
      $('#idPreview').innerHTML = (d > 0 ? S.esc(q + '× ' + S.money(p.price) + ' → ' + S.money(t)) : '') +
        (d > pos.data.maxDiscountPct ? '<div class="warn-text">Above the ' + S.num(pos.data.maxDiscountPct) + '% max: the manager PIN is asked at Confirm.</div>' : '');
    }
    ['#idQty', '#idPct'].forEach(function (s2) { $(s2).oninput = preview; });
    $('#idRound').onchange = preview;
    preview();
    if ($('#idRemove')) $('#idRemove').onclick = function () {
      line.disc = 0; line.note = ''; line.round = true;
      mergeFullPrice(pos, line.ref);
      m.close(); renderCheckout(pos);
    };
    $('#idOk').onclick = function () {
      var q = Math.round(parseNum($('#idQty').value));
      var d = parseNum($('#idPct').value);
      var err = '';
      if (!(q >= 1 && q <= maxQ)) err = 'Quantity must be between 1 and ' + maxQ + '.';
      else if (!(d > 0)) err = 'Enter the discount %.';
      else if (d > 100) err = 'A discount can\'t be more than 100%.';
      if (err) { $('#idErr').innerHTML = '<div class="form-error">' + S.esc(err) + '</div>'; return; }
      var target = line;
      if (q < line.qty) { line.qty -= q; target = newLine(line.ref, q); pos.cart.splice(pos.cart.indexOf(line) + 1, 0, target); }
      target.disc = d; target.round = $('#idRound').checked; target.note = $('#idNote').value.trim();
      pos.discount = ''; // an item discount and an order discount don't mix
      m.close(); renderCheckout(pos);
    };
  }

  function mergeFullPrice(pos, ref) {
    var full = pos.cart.filter(function (l) { return l.ref === ref && !l.disc; });
    if (full.length < 2) return;
    full[0].qty = full.reduce(function (a, l) { return a + l.qty; }, 0);
    pos.cart = pos.cart.filter(function (l) { return !(l.ref === ref && !l.disc && l !== full[0]); });
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
        return p ? '<div class="cart-line simple"><div class="cl-name">' + l.qty + '× ' + S.esc(p.name) + (l.disc ? ' <span class="disc-tag">−' + S.num(l.disc) + '%</span>' : '') + '</div><div class="cl-total">' + S.money(lineTotal(pos, l)) + '</div></div>' : '';
      }).join('') : '<div class="cart-empty">Tap products to add them.</div>') + '</div>' +
      (pos.cart.length
        ? '<div class="cart-totals"><div class="grand"><span>Total</span><span>' + S.money(t.total) + '</span></div></div>' +
          '<div class="cart-actions"><button class="btn btn-ghost" id="cartClear">Clear</button><button class="btn btn-ghost" id="cartHold">Hold</button>' +
          '<button class="btn btn-accent btn-big" id="cartReview">Checkout</button></div>'
        : '');
    bar.innerHTML = t.units ? '<span>' + t.units + (t.units === 1 ? ' item' : ' items') + '</span><b>' + S.money(t.total) + '</b><span>Checkout ›</span>' : '';
    bar.className = 'pos-cartbar' + (t.units ? ' show' : '');
    var clr = el.querySelector('#cartClear');
    if (clr) clr.onclick = function () { if (window.confirm('Clear this sale?')) { resetSale(pos); render(pos); } };
    var rev = el.querySelector('#cartReview');
    if (rev) rev.onclick = function () { openCheckout(pos); };
    var hb = el.querySelector('#cartHold');
    if (hb) hb.onclick = function () { holdSale(pos); };
  }

  function resetSale(pos) {
    pos.cart = []; pos.discount = ''; pos.note = ''; pos.seller = ''; pos.pay = null; pos.roundOrder = true; pos.customer = null; pos.approval = '';
  }

  /* ---------------- barcodes */
  function normCode(c) { return String(c || '').replace(/\s+/g, '').replace(/^0+/, ''); }
  function byBarcode(pos, code) {
    var c = normCode(code);
    if (c.length < 4) return null;
    return pos.data.products.filter(function (p) {
      return (p.barcodes || []).some(function (b) { return normCode(b) === c; }) || String(p.ref) === String(code).trim();
    })[0] || null;
  }

  /* camera scanner: the phone's own barcode reader where there is one, else the ZXing library (loaded on first use) */
  var zxingLoading = null;
  function loadZxing() {
    if (window.ZXing) return Promise.resolve();
    if (!zxingLoading) zxingLoading = new Promise(function (res, rej) {
      var sc = document.createElement('script');
      sc.src = 'assets/vendor/zxing.min.js';
      sc.onload = function () { res(); };
      sc.onerror = function () { zxingLoading = null; rej(new Error('Could not load the barcode reader. Check the internet.')); };
      document.head.appendChild(sc);
    });
    return zxingLoading;
  }

  function openScanner(pos, opts, onCode) {
    var wrap = document.createElement('div');
    wrap.className = 'scan-full';
    wrap.innerHTML = '<div class="scan-top"><b>' + S.esc(opts.title || 'Scan a barcode') + '</b><button class="btn btn-ghost btn-sm" id="scanDone">Done</button></div>' +
      '<div class="scan-view"><video id="scanVideo" playsinline muted></video><div class="scan-frame"></div></div>' +
      '<div class="scan-msg" id="scanMsg">Point the camera at the barcode.</div>' +
      '<div class="scan-manual"><input class="input" id="scanType" inputmode="numeric" placeholder="Or type the barcode"><button class="btn btn-primary" id="scanTypeGo">OK</button></div>';
    document.body.appendChild(wrap);
    var video = wrap.querySelector('#scanVideo'), msg = wrap.querySelector('#scanMsg');
    var stream = null, stopped = false, last = '', lastAt = 0, zx = null, raf = null, paused = false;
    function stop() {
      stopped = true;
      if (raf) clearTimeout(raf);
      if (zx) { try { zx.reset(); } catch (e) { /* ignore */ } }
      if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
      wrap.remove();
    }
    function got(code) {
      if (paused) return;
      var now = Date.now();
      if (code === last && now - lastAt < 2000) return;
      last = code; lastAt = now;
      if (opts.popup) { paused = true; showPop(code); return; }
      if (opts.count) { paused = true; showCountPop(code); return; }
      var r = onCode ? onCode(code) || { ok: true } : { ok: true };
      msg.textContent = r.text || code;
      msg.className = 'scan-msg ' + (r.ok ? 'good' : 'bad');
      if (navigator.vibrate) navigator.vibrate(r.ok ? 60 : [40, 60, 40]);
      if (r.ok && !opts.continuous) stop();
    }
    wrap.querySelector('#scanDone').onclick = stop;
    /* stock count: Sellable and Demo for the scanned game, then OK (back to the list) or Scan next */
    function showCountPop(code) {
      var hit = byBarcode(pos, code);
      var view = wrap.querySelector('.scan-view');
      var pop = document.createElement('div');
      pop.className = 'scan-pop' + (hit ? '' : ' bad');
      if (navigator.vibrate) navigator.vibrate(hit ? 60 : [40, 60, 40]);
      function resume() { pop.remove(); paused = false; lastAt = Date.now(); msg.textContent = 'Point the camera at the barcode.'; msg.className = 'scan-msg'; }
      if (!hit) {
        pop.innerHTML = '<div class="sp-name">No game with this barcode</div><div class="sp-sub">' + S.esc(code) + '</div>' +
          '<div class="sp-btns"><button class="btn btn-ghost" data-sp="close">Close</button><button class="btn btn-primary" data-sp="again">Try again</button></div>';
        view.appendChild(pop);
        pop.querySelector('[data-sp="again"]').onclick = resume;
        pop.querySelector('[data-sp="close"]').onclick = stop;
        return;
      }
      var cur = opts.count.get(hit.ref) || {};
      var row = function (k, label) {
        return '<div class="sp-row"><span>' + label + '</span><div class="qty big-qty"><button type="button" data-dec="' + k + '" aria-label="One less">−</button>' +
          '<input data-v="' + k + '" inputmode="numeric" placeholder="–" value="' + S.esc(cur[k] == null ? '' : cur[k]) + '" aria-label="' + label + '">' +
          '<button type="button" data-inc="' + k + '" aria-label="One more">+</button></div></div>';
      };
      pop.innerHTML = '<div class="sp-name">' + S.esc(hit.name) + '</div><div class="sp-sub">Count what is on the stand</div>' +
        row('s', 'Sellable') + (hit.demo ? row('d', 'Demo') : '') +
        '<div class="sp-btns"><button class="btn btn-ghost" data-sp="another">Scan next</button><button class="btn btn-accent" data-sp="ok">OK</button></div>' +
        '<button class="link-btn sp-cancel" data-sp="cancel">Cancel</button>';
      view.appendChild(pop);
      var inp = function (k) { return pop.querySelector('[data-v="' + k + '"]'); };
      Array.prototype.forEach.call(pop.querySelectorAll('[data-v]'), function (x) { x.oninput = function () { x.value = x.value.replace(/[^0-9]/g, ''); }; });
      Array.prototype.forEach.call(pop.querySelectorAll('[data-inc],[data-dec]'), function (b) {
        b.onclick = function () {
          var k = b.getAttribute('data-inc') || b.getAttribute('data-dec'), x = inp(k);
          var v = x.value === '' ? 0 : Number(x.value);
          x.value = Math.max(0, v + (b.getAttribute('data-inc') ? 1 : -1));
        };
      });
      function saveIt() {
        var v = { s: inp('s').value };
        if (inp('d')) v.d = inp('d').value;
        opts.count.set(hit.ref, v);
      }
      pop.querySelector('[data-sp="ok"]').onclick = function () { saveIt(); stop(); opts.count.done(hit.ref); };
      pop.querySelector('[data-sp="another"]').onclick = function () {
        saveIt(); resume();
        msg.textContent = 'Saved ' + hit.name + '. Scan the next game.'; msg.className = 'scan-msg good';
      };
      pop.querySelector('[data-sp="cancel"]').onclick = resume;
    }

    /* POS: what was scanned, how many, then OK (back to the POS) or Scan another game */
    function showPop(code) {
      var hit = byBarcode(pos, code);
      var view = wrap.querySelector('.scan-view');
      var pop = document.createElement('div');
      pop.className = 'scan-pop' + (hit ? '' : ' bad');
      if (navigator.vibrate) navigator.vibrate(hit ? 60 : [40, 60, 40]);
      function resume() { pop.remove(); paused = false; lastAt = Date.now(); msg.textContent = 'Point the camera at the barcode.'; msg.className = 'scan-msg'; }
      if (!hit) {
        pop.innerHTML = '<div class="sp-name">No game with this barcode</div><div class="sp-sub">' + S.esc(code) + '</div>' +
          '<div class="sp-btns"><button class="btn btn-ghost" data-sp="close">Close</button><button class="btn btn-primary" data-sp="again">Try again</button></div>';
        view.appendChild(pop);
        pop.querySelector('[data-sp="again"]').onclick = resume;
        pop.querySelector('[data-sp="close"]').onclick = stop;
        return;
      }
      var already = inCart(pos, hit.ref);
      var left = stockOf(pos, hit, pendingQty(pos));
      pop.innerHTML = '<div class="sp-name">' + S.esc(hit.name) + '</div>' +
        '<div class="sp-sub">' + S.money(hit.price) + (already ? ' · already ' + already + ' in sale' : '') + ' · ' + Math.max(0, left) + ' left</div>' +
        '<div class="sp-qty"><div class="qty big-qty"><button type="button" data-sp="dec" aria-label="One less">−</button>' +
        '<input id="spQty" inputmode="numeric" value="1" aria-label="Quantity"><button type="button" data-sp="inc" aria-label="One more">+</button></div></div>' +
        '<div class="sp-btns"><button class="btn btn-ghost" data-sp="another">Scan another game</button><button class="btn btn-accent" data-sp="ok">OK</button></div>' +
        '<button class="link-btn sp-cancel" data-sp="cancel">Cancel</button>';
      view.appendChild(pop);
      var q = pop.querySelector('#spQty');
      var val = function () { return Math.max(1, Math.round(Number(q.value) || 1)); };
      pop.querySelector('[data-sp="dec"]').onclick = function () { q.value = Math.max(1, val() - 1); };
      pop.querySelector('[data-sp="inc"]').onclick = function () { q.value = val() + 1; };
      q.oninput = function () { q.value = q.value.replace(/[^0-9]/g, ''); };
      function add() {
        var n = val();
        addToCart(pos, hit.ref, n);
        return n;
      }
      pop.querySelector('[data-sp="ok"]').onclick = function () { add(); stop(); render(pos); };
      pop.querySelector('[data-sp="another"]').onclick = function () {
        var n = add(); resume();
        msg.textContent = 'Added ' + n + '× ' + hit.name + '. Scan the next game.'; msg.className = 'scan-msg good';
      };
      pop.querySelector('[data-sp="cancel"]').onclick = resume;
    }
    var typed = wrap.querySelector('#scanType');
    wrap.querySelector('#scanTypeGo').onclick = function () { if (typed.value.trim()) { last = ''; got(typed.value.trim()); typed.value = ''; } };
    typed.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); wrap.querySelector('#scanTypeGo').click(); } });
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { msg.textContent = 'This browser cannot use the camera here. Type the barcode instead.'; return; }
    var formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'];
    if ('BarcodeDetector' in window) {
      Promise.resolve(window.BarcodeDetector.getSupportedFormats ? window.BarcodeDetector.getSupportedFormats() : formats).then(function (sup) {
        var det = new window.BarcodeDetector({ formats: formats.filter(function (f) { return sup.indexOf(f) >= 0; }) });
        return navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then(function (st) {
          if (stopped) { st.getTracks().forEach(function (t) { t.stop(); }); return; }
          stream = st; video.srcObject = st; return video.play().then(function () {
            (function tick() {
              if (stopped) return;
              det.detect(video).then(function (codes) { if (codes && codes[0]) got(codes[0].rawValue); }).catch(function () {})
                .then(function () { raf = setTimeout(tick, 180); });
            })();
          });
        });
      }).catch(function (err) { msg.textContent = cameraError(err); msg.className = 'scan-msg bad'; });
      return;
    }
    loadZxing().then(function () {
      if (stopped) return;
      var hints = new Map();
      hints.set(window.ZXing.DecodeHintType.POSSIBLE_FORMATS, [window.ZXing.BarcodeFormat.EAN_13, window.ZXing.BarcodeFormat.EAN_8, window.ZXing.BarcodeFormat.UPC_A,
        window.ZXing.BarcodeFormat.UPC_E, window.ZXing.BarcodeFormat.CODE_128, window.ZXing.BarcodeFormat.CODE_39, window.ZXing.BarcodeFormat.ITF]);
      zx = new window.ZXing.BrowserMultiFormatReader(hints, 200);
      return zx.decodeFromConstraints({ video: { facingMode: 'environment' }, audio: false }, video, function (result) {
        if (result && !stopped) got(result.getText());
      });
    }).catch(function (err) { msg.textContent = cameraError(err); msg.className = 'scan-msg bad'; });
  }
  function cameraError(err) {
    var n = err && err.name;
    if (n === 'NotAllowedError') return 'Camera blocked. Allow the camera for this site in the browser settings, or type the barcode.';
    if (n === 'NotFoundError') return 'No camera found. Type the barcode instead.';
    return (err && err.message) || 'The camera could not start. Type the barcode instead.';
  }

  /* ---------------- sales on hold (kept on this phone) */
  function holds(pos) { return load(holdKey(pos.eventId), []); }
  function holdSale(pos, silent) {
    if (!pos.cart.length) return;
    var t = totals(pos);
    var h = holds(pos);
    h.push({ id: 'H' + Date.now().toString(36), at: new Date().toISOString(), cart: pos.cart, discount: pos.discount, roundOrder: pos.roundOrder, note: pos.note,
      customer: pos.customer || null, total: t.total, units: t.units });
    save(holdKey(pos.eventId), h);
    resetSale(pos);
    pos.view = 'products';
    render(pos);
    if (!silent) S.toast('Sale put on hold: ' + S.money(t.total) + '. Find it under On hold.');
  }
  function openHolds(pos) {
    var list = holds(pos);
    var m = modal('<div class="pay-head"><h2>On hold</h2><button class="link-btn" data-close>Close</button></div>' +
      (list.length ? list.slice().reverse().map(function (h) {
        var names = h.cart.map(function (l) { var p = product(pos, l.ref); return l.qty + '× ' + (p ? p.name : l.ref); });
        return '<div class="sale-row"><div class="sr-main"><b>' + S.money(h.total) + '</b> · ' + h.units + ' item' + (h.units === 1 ? '' : 's') +
          ' · held at ' + new Date(h.at).toTimeString().slice(0, 5) + (h.customer && h.customer.name ? ' · ' + S.esc(h.customer.name) : '') +
          '<div class="sr-items">' + names.map(function (n) { return '<div>' + S.esc(n) + '</div>'; }).join('') + '</div></div>' +
          '<div class="hold-actions"><button class="btn btn-primary btn-sm" data-resume="' + h.id + '">Resume</button><button class="link-btn neg" data-hdel="' + h.id + '">Delete</button></div></div>';
      }).join('') : '<p class="muted">No sales on hold. Use <b>Hold</b> at checkout to keep a sale aside while you serve someone else.</p>'));
    Array.prototype.forEach.call(m.el.querySelectorAll('[data-resume]'), function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-resume');
        var h = holds(pos).filter(function (x) { return x.id === id; })[0];
        if (!h) return;
        if (pos.cart.length) {
          if (!window.confirm('Put the current sale on hold and resume this one?')) return;
          holdSale(pos, true);
        }
        save(holdKey(pos.eventId), holds(pos).filter(function (x) { return x.id !== id; }));
        pos.cart = h.cart.filter(function (l) { return product(pos, l.ref); });
        pos.cart.forEach(function (l) { l.key = 'L' + (++lineSeq); });
        pos.discount = h.discount || ''; pos.roundOrder = h.roundOrder !== false; pos.note = h.note || ''; pos.customer = h.customer || null;
        m.close();
        openCheckout(pos);
      };
    });
    Array.prototype.forEach.call(m.el.querySelectorAll('[data-hdel]'), function (b) {
      b.onclick = function () {
        if (!window.confirm('Delete this sale on hold?')) return;
        save(holdKey(pos.eventId), holds(pos).filter(function (x) { return x.id !== b.getAttribute('data-hdel'); }));
        m.close(); render(pos);
      };
    });
  }

  /* ---------------- customer contacts */
  function contactFields(c) {
    c = c || {};
    return '<div class="field"><label for="cuName">Name</label><input class="input" id="cuName" autocomplete="off" value="' + S.esc(c.name || '') + '"></div>' +
      '<div class="two"><div class="field"><label for="cuPhone">Phone</label><input class="input" id="cuPhone" type="tel" inputmode="tel" autocomplete="off" value="' + S.esc(c.phone || '') + '"></div>' +
      '<div class="field"><label for="cuEmail">Email</label><input class="input" id="cuEmail" type="email" inputmode="email" autocomplete="off" value="' + S.esc(c.email || '') + '"></div></div>';
  }
  function readContact(root) {
    var v = function (sel) { var x = root.querySelector(sel); return x ? x.value.trim() : ''; };
    var c = { name: v('#cuName'), phone: v('#cuPhone'), email: v('#cuEmail') };
    if (v('#cuNote')) c.note = v('#cuNote');
    return c.name || c.phone || c.email ? c : null;
  }
  function enqueueContact(pos, c, saleId, by) {
    var item = Object.assign({ id: 'U' + newSaleId().slice(1), saleId: saleId || '', by: by || '', clientTime: new Date().toISOString() }, c);
    enqueue(pos, { qid: item.id, type: 'customer', customer: item });
    var list = load(contactsKey(pos.eventId), []);
    list.unshift({ name: c.name, phone: c.phone, email: c.email, at: item.clientTime, sale: !!saleId });
    save(contactsKey(pos.eventId), list.slice(0, 100));
  }
  function openCustomer(pos, after) {
    var open = openShiftNames(pos);
    var by = pos.data.staff.filter(function (n) { return open[n]; }).join(', ');
    var m = modal('<div class="pay-head"><h2>Customer contact</h2><button class="link-btn" data-close>Cancel</button></div>' +
      '<p class="small muted" style="margin-top:0">All optional. Fill what the customer agrees to give.</p>' + contactFields() +
      '<div class="field"><label for="cuNote">Note</label><input class="input" id="cuNote" placeholder="e.g. Interested in strategy games, wants the newsletter"></div>' +
      '<div id="cuErr"></div><button class="btn btn-accent btn-big btn-block" id="cuSave">Save contact</button>');
    m.el.querySelector('#cuSave').onclick = function () {
      var c = readContact(m.el);
      if (!c) { m.el.querySelector('#cuErr').innerHTML = '<div class="form-error">Enter a name, phone or email.</div>'; return; }
      enqueueContact(pos, c, '', by);
      m.close();
      S.toast('Contact saved' + (c.name ? ': ' + c.name : '') + '.');
      flush(pos);
      if (after) after();
    };
    setTimeout(function () { var n = m.el.querySelector('#cuName'); if (n) n.focus(); }, 60);
  }

  /* ---------------- checkout: one full page, every field visible from the start */
  function newPay() {
    return { method: 'Cash', online: '', recvUsd: '', recvLbp: '', changeUsd: '', changeLbp: '' };
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
      var at = 0, seen = 0;
      while (at < formatted.length && seen < digitsBefore) { if (/[0-9]/.test(formatted[at])) seen++; at++; }
      try { input.setSelectionRange(at, at); } catch (e) { /* some inputs refuse */ }
      onValue(formatted);
    });
  }

  /* two amount fields (USD | LBP) where typing one fills the other with the rest of `target()` */
  function pairFields(root, usdSel, lbpSel, getTarget, getFx, getStep, onChange) {
    var u = root.querySelector(usdSel), l = root.querySelector(lbpSel);
    u.addEventListener('input', function () {
      var rest = Math.max(0, roundLbp((getTarget() - parseNum(u.value)) * getFx(), getStep()));
      l.value = fmtLbpInput(rest);
      onChange(u.value, l.value);
    });
    liveCommas(l, function (v) {
      u.value = String(Math.max(0, Math.round(getTarget() - parseNum(v) / getFx())));
      onChange(u.value, v);
    });
  }

  function keepAboveKeyboard(root) {
    Array.prototype.forEach.call(root.querySelectorAll('input'), function (inp) {
      inp.addEventListener('focus', function () {
        if (window.innerWidth > 900) return;
        setTimeout(function () { inp.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 250);
      });
    });
  }

  function notesRow() {
    return '<div class="notes">' + [1, 5, 10, 20, 50, 100].map(function (n) { return '<button class="note" data-note="' + n + '">$' + n + '</button>'; }).join('') +
      '<button class="note clear" id="notesClear">Clear</button></div>';
  }

  function renderCheckout(pos) {
    var root = pos.el.querySelector('#pos');
    var d = pos.data;
    var pay = pos.pay;
    var open = openShiftNames(pos);
    var sellers = d.staff.filter(function (n) { return open[n]; });
    if (pos.seller && sellers.indexOf(pos.seller) < 0) pos.seller = '';
    if (!pos.seller && sellers.length === 1) pos.seller = sellers[0];
    document.body.classList.add('pos-checkout');

    root.innerHTML =
      '<div class="co">' +
      '<div class="co-top"><button class="btn btn-ghost btn-sm" id="coBack">‹ Back to products</button>' +
      '<button class="link-btn neg" id="coClear">Clear sale</button></div>' +
      errorSlot(pos) +

      '<section class="co-card"><h3>Items</h3>' + pos.cart.map(function (l) {
        var p = product(pos, l.ref);
        if (!p) return '';
        var orderOn = parseNum(pos.discount) > 0;
        var gross = r2(p.price * l.qty), lt = lineTotal(pos, l, orderOn);
        return '<div class="cart-line co-line"><div class="cl-main"><div class="cl-name">' + S.esc(p.name) + '</div>' +
          '<div class="cl-price">' + S.money(p.price) + ' each' + (l.disc && !orderOn ? ' · <span class="disc-tag">−' + S.num(l.disc) + '%' + (l.note ? ' · ' + S.esc(l.note) : '') + '</span>' : '') + '</div></div>' +
          '<div class="qty"><button data-ldec="' + l.key + '" aria-label="One less">−</button><span>' + l.qty + '</span>' +
          '<button data-linc="' + l.key + '" aria-label="One more">+</button></div>' +
          '<div class="cl-total">' + (lt !== gross ? '<s>' + S.money(gross) + '</s>' : '') + S.money(lt) + '</div>' +
          '<button class="pct' + (l.disc && !orderOn ? ' on' : '') + '" data-pct="' + l.key + '" aria-label="Item discount">%</button></div>';
      }).join('') +
      '<div class="field co-note"><label for="coNote">Note</label><input class="input" id="coNote" placeholder="Promo code, voucher…" value="' + S.esc(pos.note) + '"></div>' +
      '</section>' +

      '<section class="co-card co-total"><button class="pct-total" id="coOrderDisc" aria-label="Discount on the whole sale" title="Discount on the whole sale">%</button>' +
      '<div class="co-total-main"><div class="co-sub" id="coSub"></div><div class="big" id="coTotal"></div><div class="muted" id="coTotalLbp"></div><div class="small warn-text" id="coDiscErr"></div></div></section>' +

      '<section class="co-card"><h3>Payment</h3>' +
      '<div class="seg" id="paySeg">' + ['Cash', 'Online', 'Split'].map(function (x) {
        return '<button data-m="' + x + '" class="' + (pay.method === x ? 'active' : '') + '">' + (x === 'Split' ? 'Cash + online' : x) + '</button>';
      }).join('') + '</div>' +
      '<div class="qr-btns" id="qrBtns" hidden>' + (d.whishLink ? '<button class="whish-btn" id="whishBtn"><img src="assets/whish.png" alt="">Show Whish QR</button>' : '') +
      (cardLink() ? '<button class="whish-btn" id="cardBtn"><span class="card-ico">' + ICONS.card + '</span>Pay by Card Online</button>' : '') + '</div>' +
      '<div class="field" id="onlineField"><label for="payOnline">Paid online (USD)</label><input class="input money-in" id="payOnline" inputmode="decimal" placeholder="0" value="' + S.esc(pay.online) + '"></div>' +
      '<div class="two">' +
      '<div class="field cashf"><label for="payUsd">Received USD</label><input class="input money-in" id="payUsd" inputmode="decimal" placeholder="0" value="' + S.esc(pay.recvUsd) + '"></div>' +
      '<div class="field cashf"><label for="payLbp">Received LBP</label><input class="input money-in" id="payLbp" inputmode="numeric" placeholder="0" value="' + S.esc(pay.recvLbp) + '"></div>' +
      '</div>' + notesRow() +
      '<div class="pay-status" id="payStatus"></div>' +
      '<div class="two">' +
      '<div class="field cashf"><label for="chUsd">Change given USD</label><input class="input money-in" id="chUsd" inputmode="numeric" placeholder="0" value="' + S.esc(pay.changeUsd) + '"></div>' +
      '<div class="field cashf"><label for="chLbp">Change given LBP</label><input class="input money-in" id="chLbp" inputmode="numeric" placeholder="0" value="' + S.esc(pay.changeLbp) + '"></div>' +
      '</div>' +
      '<div class="small muted cashf-hint">LBP change is rounded to ' + S.num(d.lbpStep || 5000) + '.</div>' +
      '</section>' +

      '<section class="co-card"><h3>Sold by <span class="req">required</span></h3>' +
      '<div class="sellers">' + sellers.map(function (n) {
        return '<button class="seller' + (pos.seller === n ? ' active' : '') + '" data-seller="' + S.esc(n) + '">' + S.esc(n) + '</button>';
      }).join('') + '<button class="seller add" id="coClockIn">+ Clock in</button></div>' +
      (sellers.length ? '' : '<div class="small muted" style="margin-top:6px">Nobody is clocked in yet.</div>') +
      '</section>' +

      '<section class="co-card co-cust"><details id="coCust"' + (pos.customer ? ' open' : '') + '><summary>Customer contact <span class="opt">optional</span></summary>' +
      '<div class="cust-fields">' + contactFields(pos.customer) + '</div></details></section>' +

      '<div id="payError"></div>' +
      '<div class="co-btns"><button class="btn btn-accent btn-big" id="payConfirm">Confirm sale</button><button class="btn btn-ghost btn-big" id="coHold">Hold</button></div>' +
      '</div>';

    var $ = function (sel) { return root.querySelector(sel); };
    var clearErr = function () { $('#payError').innerHTML = ''; };
    $('#coBack').onclick = function () { closeCheckout(pos); };
    $('#coClear').onclick = function () { if (window.confirm('Clear this sale?')) { resetSale(pos); closeCheckout(pos); } };
    Array.prototype.forEach.call(root.querySelectorAll('[data-linc]'), function (b) { b.onclick = function () { changeLine(pos, b.getAttribute('data-linc'), 1); }; });
    Array.prototype.forEach.call(root.querySelectorAll('[data-ldec]'), function (b) { b.onclick = function () { changeLine(pos, b.getAttribute('data-ldec'), -1); }; });
    Array.prototype.forEach.call(root.querySelectorAll('[data-pct]'), function (b) { b.onclick = function () { openItemDiscount(pos, b.getAttribute('data-pct')); }; });
    Array.prototype.forEach.call(root.querySelectorAll('[data-seller]'), function (b) {
      b.onclick = function () {
        pos.seller = b.getAttribute('data-seller');
        Array.prototype.forEach.call(root.querySelectorAll('[data-seller]'), function (x) { x.classList.toggle('active', x === b); });
        clearErr();
      };
    });
    $('#coClockIn').onclick = function () {
      openStaff(pos, function (name, dir) { if (dir === 'in') pos.seller = name; renderCheckout(pos); });
    };
    $('#coOrderDisc').onclick = function () { openOrderDiscount(pos); };
    $('#coNote').oninput = function () { pos.note = this.value; };
    Array.prototype.forEach.call(root.querySelectorAll('.cust-fields input'), function (x) {
      x.addEventListener('input', function () { pos.customer = readContact(root.querySelector('.cust-fields')); });
    });
    $('#coHold').onclick = function () { holdSale(pos); window.scrollTo(0, 0); };
    Array.prototype.forEach.call(root.querySelectorAll('[data-m]'), function (b) {
      b.onclick = function () {
        pay.method = b.getAttribute('data-m');
        Array.prototype.forEach.call(root.querySelectorAll('[data-m]'), function (x) { x.classList.toggle('active', x === b); });
        clearErr(); update(pos);
      };
    });
    $('#payOnline').oninput = function () { pay.online = this.value; update(pos); };
    $('#payUsd').oninput = function () { pay.recvUsd = this.value; update(pos); };
    liveCommas($('#payLbp'), function (v) { pay.recvLbp = v; update(pos); });
    Array.prototype.forEach.call(root.querySelectorAll('[data-note]'), function (b) {
      b.onclick = function () {
        pay.recvUsd = String(r2(parseNum(pay.recvUsd) + Number(b.getAttribute('data-note'))));
        $('#payUsd').value = pay.recvUsd;
        update(pos);
      };
    });
    $('#notesClear').onclick = function () { pay.recvUsd = ''; $('#payUsd').value = ''; update(pos); };
    pairFields(root, '#chUsd', '#chLbp', function () { return calc(pos).change; }, function () { return pos.data.fxRate; },
      function () { return pos.data.lbpStep || 5000; }, function (u, l) { pay.changeUsd = u; pay.changeLbp = l; clearErr(); });
    keepAboveKeyboard(root);
    $('#payConfirm').onclick = function () { confirmSale(pos); };
    if ($('#whishBtn')) $('#whishBtn').onclick = function () { showWhish(pos, calc(pos).online, 'whish'); };
    if ($('#cardBtn')) $('#cardBtn').onclick = function () { showWhish(pos, calc(pos).online, 'card'); };
    wireErrorSlot(pos, root);
    update(pos);
  }

  /* the % next to the total: one discount on the whole sale (replaces item discounts) */
  function openOrderDiscount(pos) {
    var had = parseNum(pos.discount) > 0;
    var items = pos.cart.some(function (l) { return l.disc > 0; });
    var m = modal(
      '<div class="pay-head"><h2>Discount on the whole sale</h2><button class="link-btn" data-close>Cancel</button></div>' +
      '<div class="field"><label for="odPct">Discount %</label><input class="input money-in" id="odPct" inputmode="decimal" placeholder="0" value="' + S.esc(pos.discount) + '"></div>' +
      '<label class="check"><input type="checkbox" id="odRound"' + (pos.roundOrder !== false ? ' checked' : '') + '> Round the total down to whole $</label>' +
      (items ? '<div class="small warn-text">This replaces the item discounts already on this sale.</div>' : '') +
      '<div class="small muted" id="odPreview"></div><div id="odErr"></div>' +
      '<div class="dialog-actions">' + (had ? '<button class="btn btn-ghost" id="odRemove">Remove discount</button>' : '') + '<button class="btn btn-primary" id="odOk">OK</button></div>');
    var $ = function (sel) { return m.el.querySelector(sel); };
    function preview() {
      var keep = { d: pos.discount, r: pos.roundOrder };
      pos.discount = $('#odPct').value.replace(/[^0-9.]/g, ''); pos.roundOrder = $('#odRound').checked;
      var t = totals(pos);
      $('#odPreview').innerHTML = t.disc > 0 ? 'New total: <b>' + S.money(t.total) + '</b>' + (t.disc > pos.data.maxDiscountPct ? '<div class="warn-text">Above the ' + S.num(pos.data.maxDiscountPct) + '% max: the manager PIN is asked at Confirm.</div>' : '') : '';
      pos.discount = keep.d; pos.roundOrder = keep.r;
    }
    $('#odPct').oninput = preview; $('#odRound').onchange = preview; preview();
    if ($('#odRemove')) $('#odRemove').onclick = function () { pos.discount = ''; m.close(); renderCheckout(pos); };
    $('#odOk').onclick = function () {
      var d = parseNum($('#odPct').value);
      if (d > 100) { $('#odErr').innerHTML = '<div class="form-error">A discount can\'t be more than 100%.</div>'; return; }
      pos.discount = d > 0 ? String(d) : '';
      pos.roundOrder = $('#odRound').checked;
      if (d > 0 && items) {
        pos.cart.forEach(function (l) { l.disc = 0; l.note = ''; l.round = true; });
        var refs = {}; pos.cart.forEach(function (l) { refs[l.ref] = 1; });
        Object.keys(refs).forEach(function (r) { mergeFullPrice(pos, r); });
      }
      m.close(); renderCheckout(pos);
    };
    setTimeout(function () { $('#odPct').focus(); }, 60);
  }

  /* manager PIN: checked on the phone (works offline), checked again by the server */
  function sha256(text) {
    if (!window.crypto || !crypto.subtle || !window.TextEncoder) return Promise.resolve(null);
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    }).catch(function () { return null; });
  }
  function askManagerPin(pos, reason, onOk) {
    var pin = '';
    var m = modal('<div class="pay-head"><h2>Manager PIN</h2><button class="link-btn" data-close>Cancel</button></div>' +
      '<p class="muted" style="margin-top:0">' + S.esc(reason) + '</p><div id="mpErr"></div>' +
      '<div class="pin-dots" id="mpDots"><span></span><span></span><span></span><span></span></div>' +
      '<div class="keypad">' + [1, 2, 3, 4, 5, 6, 7, 8, 9, '', 0, '⌫'].map(function (k) {
        return k === '' ? '<span></span>' : '<button type="button" class="key" data-k="' + k + '">' + k + '</button>';
      }).join('') + '</div>');
    function draw() { Array.prototype.forEach.call(m.el.querySelectorAll('#mpDots span'), function (d, i) { d.className = i < pin.length ? 'on' : ''; }); }
    function press(k) {
      if (k === '⌫') pin = pin.slice(0, -1); else if (pin.length < 4) pin += k;
      draw();
      if (pin.length === 4) {
        var tried = pin;
        sha256(pos.eventId + ':' + tried).then(function (h) {
          if (h && pos.data.managerPinHash && h !== pos.data.managerPinHash) {
            pin = ''; draw();
            m.el.querySelector('#mpErr').innerHTML = '<div class="form-error">Wrong manager PIN.</div>';
            return;
          }
          m.close(); onOk(tried);
        });
      }
    }
    Array.prototype.forEach.call(m.el.querySelectorAll('.key'), function (b) { b.onclick = function () { press(b.getAttribute('data-k')); }; });
  }

  function cardLink() { return (window.SHN_CONFIG && window.SHN_CONFIG.CARD_PAY_LINK) || ''; }

  /* full-screen QR for the customer to scan: Whish, or the card payment page (Stripe) */
  function showWhish(pos, amount, kind) {
    var card = kind === 'card';
    var link = card ? cardLink() : pos.data.whishLink;
    if (!link || !window.qrcode) return;
    var qr = window.qrcode(0, 'M');
    qr.addData(link);
    qr.make();
    var n = qr.getModuleCount(), cells = '';
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (qr.isDark(r, c)) cells += 'M' + c + ' ' + r + 'h1v1h-1z';
    var svg = '<svg viewBox="-4 -4 ' + (n + 8) + ' ' + (n + 8) + '" class="whish-qr" role="img" aria-label="Whish QR code" shape-rendering="crispEdges">' +
      '<rect x="-4" y="-4" width="' + (n + 8) + '" height="' + (n + 8) + '" fill="#fff"/><path d="' + cells + '" fill="#000"/></svg>';
    var wrap = document.createElement('div');
    wrap.className = 'whish-full';
    wrap.innerHTML = '<div class="whish-inner">' + (card ? '<div class="whish-logo card-logo">' + ICONS.card + '</div>' : '<img class="whish-logo" src="assets/whish.png" alt="Whish Money">') +
      '<div class="whish-amount">' + (amount > 0 ? 'Pay ' + S.money(amount) : card ? 'Pay by card' : 'Pay with Whish') + '</div>' +
      '<div class="whish-sub">' + (card ? 'Scan with your phone camera, enter ' + (amount > 0 ? S.money(amount) : 'the amount') + ' and pay by card' : 'Scan with the Whish app to transfer') + '</div>' + svg +
      '<button class="btn btn-primary btn-big btn-block" id="whishDone">Done</button></div>';
    document.body.appendChild(wrap);
    wrap.querySelector('#whishDone').onclick = function () {
      wrap.remove();
      // before the sale is closed: check the amount on the customer's phone
      var m = modal('<div class="pay-check">' + (card ? '<div class="card-logo small-logo">' + ICONS.card + '</div>' : '<img class="whish-logo small-logo" src="assets/whish.png" alt="">') +
        '<h2>Check the customer\'s phone</h2>' +
        '<p>Make sure the payment went through ' + (card ? 'by card' : 'on Whish') + (amount > 0 ? ' for exactly' : '') + '</p>' +
        (amount > 0 ? '<div class="whish-amount">' + S.money(amount) + '</div>' : '') +
        '<p class="small muted">If the amount is different, sort it out with the customer before confirming the sale.</p>' +
        '<button class="btn btn-accent btn-big btn-block" data-close>Done</button></div>');
      return m;
    };
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

  function setStatus(st, cls, html) { st.className = 'pay-status ' + cls; st.innerHTML = '<span>' + html + '</span>'; }

  /* updates the numbers on the page without rebuilding it (the layout never moves) */
  function update(pos) {
    var root = pos.el.querySelector('#pos');
    if (!root || pos.view !== 'checkout' || !root.querySelector('#coTotal')) return;
    var d = pos.data, pay = pos.pay, c = calc(pos), t = c.t;
    var $ = function (sel) { return root.querySelector(sel); };
    $('#coSub').innerHTML = t.off ? 'Subtotal ' + S.money(t.sub) + ' · Discount −' + S.money(t.off) : '&nbsp;';
    $('#coTotal').textContent = S.money(t.total);
    $('#coTotalLbp').textContent = lbp(roundLbp(t.total * c.fx, c.step)) + ' at ' + S.num(c.fx);
    $('#coDiscErr').textContent = t.maxDisc > d.maxDiscountPct ? 'Discount above the ' + S.num(d.maxDiscountPct) + '% max: the manager PIN is asked at Confirm.' : '';
    $('#coOrderDisc').classList.toggle('on', t.disc > 0);
    $('#coOrderDisc').textContent = t.disc > 0 ? '−' + S.num(t.disc) + '%' : '%';
    var cash = pay.method !== 'Online';
    $('#onlineField').hidden = pay.method !== 'Split';
    if ($('#qrBtns')) $('#qrBtns').hidden = pay.method === 'Cash';
    Array.prototype.forEach.call(root.querySelectorAll('.cashf'), function (f) {
      f.classList.toggle('off', !cash);
      f.querySelector('input').disabled = !cash;
    });
    $('.cashf-hint').classList.toggle('off', !cash);
    Array.prototype.forEach.call(root.querySelectorAll('.note'), function (b) { b.disabled = !cash; });
    var st = $('#payStatus');
    if (!cash) return setStatus(st, 'muted', 'Paid in full online. No cash.');
    if (!c.paid) return setStatus(st, 'muted', 'Cash to collect: <b>' + S.money(c.due) + '</b> (' + lbp(roundLbp(c.due * c.fx, c.step)) + ')');
    if (c.paid < c.due - c.tol) {
      var short = r2(c.due - c.paid);
      return setStatus(st, 'owed', 'Still to collect: <b>' + S.money(short) + '</b> (' + lbp(roundLbp(short * c.fx, c.step)) + ')');
    }
    if (c.change < 0.005 || Math.abs(c.change * c.fx) < c.step / 2) return setStatus(st, 'good', 'Exact amount. No change to give.');
    setStatus(st, 'good', 'Change to give: <b>' + S.money(c.change) + '</b> (' + lbp(roundLbp(c.change * c.fx, c.step)) + ')');
  }

  function confirmSale(pos) {
    var pay = pos.pay, c = calc(pos), t = c.t;
    var err = '';
    var needsPin = t.maxDisc > pos.data.maxDiscountPct;
    if (pay.method === 'Split' && !(c.online > 0 && c.online < t.total)) err = 'Enter the part paid online (less than the total).';
    var sale = {
      id: newSaleId(), seller: pos.seller, method: pay.method, discountPct: t.disc, roundTotal: pos.roundOrder !== false, note: pos.note.trim(),
      lines: pos.cart.map(function (l) {
        return t.disc > 0 || !l.disc ? { ref: l.ref, qty: l.qty } : { ref: l.ref, qty: l.qty, discountPct: l.disc, roundDown: l.round !== false, note: l.note };
      }),
      onlineUsd: c.online, recvUsd: 0, recvLbp: 0, changeUsd: 0, changeLbp: 0, clientTime: new Date().toISOString(), total: t.total
    };
    if (needsPin && pos.approval) sale.approval = pos.approval;
    if (!err && c.hasCash) {
      sale.recvUsd = parseNum(pay.recvUsd);
      sale.recvLbp = Math.round(parseNum(pay.recvLbp));
      sale.changeUsd = parseNum(pay.changeUsd);
      sale.changeLbp = Math.round(parseNum(pay.changeLbp));
      if (c.paid < c.due - c.tol) err = 'The cash received is less than ' + S.money(c.due) + '.';
      else {
        var diff = c.change - sale.changeUsd - sale.changeLbp / c.fx;
        if (Math.abs(diff) > c.tol) err = diff > 0 ? 'Change to give is ' + S.money(c.change) + '. Enter the change given (USD and/or LBP).' : 'More change given than due. Check the amounts.';
      }
    }
    if (!err && !pos.seller) err = 'Pick who made the sale (Sold by).';
    var box = pos.el.querySelector('#payError');
    if (err) { box.innerHTML = '<div class="form-error">' + S.esc(err) + '</div>'; box.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    if (needsPin && !pos.approval) {
      askManagerPin(pos, 'This sale has a ' + S.num(t.maxDisc) + '% discount, above the ' + S.num(pos.data.maxDiscountPct) + '% max.', function (p2) { pos.approval = p2; confirmSale(pos); });
      return;
    }
    var customer = pos.customer;
    enqueue(pos, { qid: sale.id, type: 'sale', sale: sale });
    if (customer) enqueueContact(pos, customer, sale.id, sale.seller);
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

  /* ---------------- returns: a full page, like checkout */
  function remainingToReturn(pos, s) {
    var left = {};
    s.lines.forEach(function (l) { left[l.ref] = (left[l.ref] || 0) + l.qty; });
    Object.keys(s.returned || {}).forEach(function (r) { left[r] = (left[r] || 0) - s.returned[r]; });
    queue(pos).forEach(function (x) {
      if (x.type !== 'return' || x.error || x.ret.saleId !== s.id) return;
      x.ret.lines.forEach(function (l) { left[l.ref] = (left[l.ref] || 0) - l.qty; });
    });
    return left;
  }

  function openReturn(pos, s) {
    pos.view = 'return';
    pos.ret = { sale: s, qty: {}, method: 'Cash', refundUsd: '', refundLbp: '', note: '' };
    renderReturn(pos);
    window.scrollTo(0, 0);
  }

  function returnDue(pos) {
    var r = pos.ret, due = 0;
    r.sale.lines.forEach(function (l) { if (r.qty[l.ref]) due += (l.total / l.qty) * r.qty[l.ref]; });
    return r2(due);
  }

  function renderReturn(pos) {
    var root = pos.el.querySelector('#pos');
    var r = pos.ret, s = r.sale, d = pos.data;
    var left = remainingToReturn(pos, s);
    document.body.classList.add('pos-checkout');
    root.innerHTML =
      '<div class="co">' +
      '<div class="co-top"><button class="btn btn-ghost btn-sm" id="rtBack">‹ Back to products</button></div>' +
      '<section class="co-card"><h3>Return items</h3>' +
      '<div class="small muted" style="margin-bottom:8px">Sale of ' + S.money(s.total) + ' · ' + S.esc(s.method) + ' · ' + S.esc(s.seller) + ' · ' + S.esc((s.date || '') + ' ' + (s.time || '')) + '</div>' +
      s.lines.map(function (l) {
        var max = Math.max(0, left[l.ref] || 0);
        var q = r.qty[l.ref] || 0;
        return '<div class="cart-line"><div class="cl-main"><div class="cl-name">' + S.esc(l.name) + '</div>' +
          '<div class="cl-price">' + S.money(r2(l.total / l.qty)) + ' each paid · ' + max + ' can be returned</div></div>' +
          '<div class="qty"><button data-rdec="' + S.esc(l.ref) + '"' + (q <= 0 ? ' disabled' : '') + '>−</button><span>' + q + '</span>' +
          '<button data-rinc="' + S.esc(l.ref) + '"' + (q >= max ? ' disabled' : '') + '>+</button></div>' +
          '<div class="cl-total">' + (q ? '−' + S.money(r2(l.total / l.qty * q)) : '') + '</div></div>';
      }).join('') +
      '<button class="link-btn" id="rtAll">Return everything</button></section>' +
      '<section class="co-card co-total"><div class="co-sub">Refund due</div><div class="big" id="rtDue"></div><div class="muted" id="rtDueLbp"></div></section>' +
      '<section class="co-card"><h3>Refund</h3>' +
      '<div class="seg seg2">' + ['Cash', 'Online'].map(function (x) {
        return '<button data-rm="' + x + '" class="' + (r.method === x ? 'active' : '') + '">' + (x === 'Cash' ? 'Cash back' : 'Refunded online') + '</button>';
      }).join('') + '</div>' +
      '<div class="pay-status" id="rtStatus"></div>' +
      '<div class="two">' +
      '<div class="field cashf"><label for="rtUsd">Refund given USD</label><input class="input money-in" id="rtUsd" inputmode="numeric" placeholder="0" value="' + S.esc(r.refundUsd) + '"></div>' +
      '<div class="field cashf"><label for="rtLbp">Refund given LBP</label><input class="input money-in" id="rtLbp" inputmode="numeric" placeholder="0" value="' + S.esc(r.refundLbp) + '"></div>' +
      '</div>' +
      '<div class="field"><label for="rtNote">Reason (optional)</label><input class="input" id="rtNote" placeholder="Changed mind, wrong game…" value="' + S.esc(r.note) + '"></div>' +
      '</section>' +
      '<div id="rtError"></div>' +
      '<button class="btn btn-accent btn-big btn-block" id="rtConfirm">Confirm return</button>' +
      '</div>';
    var $ = function (sel) { return root.querySelector(sel); };
    $('#rtBack').onclick = function () { pos.view = 'products'; pos.ret = null; render(pos); };
    Array.prototype.forEach.call(root.querySelectorAll('[data-rinc],[data-rdec]'), function (b) {
      b.onclick = function () {
        var ref = b.getAttribute('data-rinc') || b.getAttribute('data-rdec');
        r.qty[ref] = (r.qty[ref] || 0) + (b.getAttribute('data-rinc') ? 1 : -1);
        r.refundUsd = ''; r.refundLbp = '';
        renderReturn(pos);
      };
    });
    $('#rtAll').onclick = function () {
      s.lines.forEach(function (l) { r.qty[l.ref] = Math.max(0, left[l.ref] || 0); });
      r.refundUsd = ''; r.refundLbp = '';
      renderReturn(pos);
    };
    Array.prototype.forEach.call(root.querySelectorAll('[data-rm]'), function (b) {
      b.onclick = function () { r.method = b.getAttribute('data-rm'); renderReturn(pos); };
    });
    $('#rtNote').oninput = function () { r.note = this.value; };
    pairFields(root, '#rtUsd', '#rtLbp', function () { return returnDue(pos); }, function () { return d.fxRate; },
      function () { return d.lbpStep || 5000; }, function (u, l) { r.refundUsd = u; r.refundLbp = l; $('#rtError').innerHTML = ''; });
    keepAboveKeyboard(root);
    var due = returnDue(pos), fx = d.fxRate, step = d.lbpStep || 5000;
    $('#rtDue').textContent = S.money(due);
    $('#rtDueLbp').textContent = lbp(roundLbp(due * fx, step));
    var cash = r.method === 'Cash';
    Array.prototype.forEach.call(root.querySelectorAll('.cashf'), function (f) { f.classList.toggle('off', !cash); f.querySelector('input').disabled = !cash; });
    setStatus($('#rtStatus'), cash ? 'good' : 'muted', !due ? 'Pick the items coming back.' : cash
      ? 'Give back: <b>' + S.money(due) + '</b> (' + lbp(roundLbp(due * fx, step)) + ')'
      : 'Refund ' + S.money(due) + ' online. No cash leaves the drawer.');
    $('#rtConfirm').onclick = function () {
      var lines = s.lines.filter(function (l) { return r.qty[l.ref] > 0; }).map(function (l) { return { ref: l.ref, qty: r.qty[l.ref] }; });
      var err = '';
      if (!lines.length) err = 'Pick the items coming back.';
      var ret = { id: 'R' + newSaleId().slice(1), saleId: s.id, lines: lines, method: r.method, refundUsd: 0, refundLbp: 0,
        note: r.note.trim(), clientTime: new Date().toISOString(), total: -due, seller: s.seller };
      if (!err && cash) {
        ret.refundUsd = parseNum(r.refundUsd);
        ret.refundLbp = Math.round(parseNum(r.refundLbp));
        var diff = due - ret.refundUsd - ret.refundLbp / fx;
        if (Math.abs(diff) > step / fx + 0.005) err = diff > 0 ? 'Enter what was given back (USD and/or LBP): ' + S.money(due) + ' is due.' : 'More given back than due. Check the amounts.';
      }
      if (err) { $('#rtError').innerHTML = '<div class="form-error">' + S.esc(err) + '</div>'; return; }
      var limit = pos.data.returnApprovalUsd || 0;
      if (limit > 0 && due > limit) {
        if (!r.approval) {
          var btn = this;
          askManagerPin(pos, 'Returns above ' + S.money(limit) + ' need the manager PIN.', function (p2) { r.approval = p2; btn.click(); });
          return;
        }
        ret.approval = r.approval;
      }
      enqueue(pos, { qid: ret.id, type: 'return', ret: ret });
      pos.view = 'products'; pos.ret = null;
      render(pos);
      window.scrollTo(0, 0);
      S.toast('Return saved: ' + S.money(due) + (cash ? ' given back.' : ' refunded online.'));
      flush(pos);
    };
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
  /* clock in / out list, used in a page (home) or a small window (POS, checkout, counts) */
  function staffPanel(pos, box, after, inModal) {
    var d = pos.data;
    var open = openShiftNames(pos);
    box.innerHTML = (inModal ? '<div class="pay-head"><h2>Clock in / out</h2><button class="link-btn" data-close>Done</button></div>' : '') +
      (d.staff.length ? '<div class="staff-list">' + d.staff.map(function (n) {
        var since = open[n];
        var cl = since ? clockedLabel(since) : null;
        return '<div class="staff-row"><div class="sr-top"><div><b>' + S.esc(n) + '</b><div class="small ' + (cl && cl.old ? 'shift-old' : 'muted') + '">' + (since ? 'Clocked in ' + cl.text + (cl.old ? ' · forgot to clock out?' : '') : 'Not clocked in') + '</div></div>' +
          (since ? '<button class="btn btn-ghost" data-out="' + S.esc(n) + '">Clock out</button>'
            : '<button class="btn btn-primary" data-in="' + S.esc(n) + '">Clock in</button>') + '</div>' +
          '<input class="input staff-note" data-note-for="' + S.esc(n) + '" placeholder="Note for the manager (optional), e.g. arrived at 15:10"></div>';
      }).join('') + '</div>' : '<p class="muted">' + (pos.preview ? 'Still loading the staff list. Try again in a moment.' : 'No staff in the event Settings tab yet.') + '</p>');
    Array.prototype.forEach.call(box.querySelectorAll('[data-in],[data-out]'), function (b) {
      b.onclick = function () {
        var name = b.getAttribute('data-in') || b.getAttribute('data-out');
        var dir = b.getAttribute('data-in') ? 'in' : 'out';
        if (dir === 'out' && !window.confirm('Clock out ' + name + '?')) return;
        var noteEl = Array.prototype.filter.call(box.querySelectorAll('[data-note-for]'), function (x) { return x.getAttribute('data-note-for') === name; })[0];
        enqueue(pos, { qid: 'C' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), type: 'clock', name: name, direction: dir,
          clientTime: new Date().toISOString(), note: noteEl ? noteEl.value.trim() : '' });
        if (dir === 'out' && pos.seller === name) pos.seller = '';
        S.toast(name + (dir === 'in' ? ' clocked in.' : ' clocked out.'));
        flush(pos);
        after(name, dir);
      };
    });
  }

  /* "at 13:32" today, "Sun 22 Nov, 23:53" on an earlier day */
  function clockedLabel(since) {
    var d = String(since).indexOf('T') > 0 ? new Date(since) : new Date(String(since).replace(' ', 'T'));
    if (isNaN(d)) return { text: 'at ' + String(since).slice(11, 16), old: false };
    var now = new Date();
    var hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    if (d.toDateString() === now.toDateString()) return { text: 'at ' + hm, old: false };
    return { text: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()] + ' ' + d.getDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()] + ', ' + hm, old: true };
  }

  function openStaff(pos, after, under) {
    // "under": a window this one opens on top of (it comes back, untouched, when this one closes)
    var m = modal('<div id="staffBox"></div>', under ? function () { under.hidden = false; under.id = 'posModal'; } : null);
    var box = m.el.querySelector('#staffBox');
    function draw() {
      staffPanel(pos, box, function (name, dir) {
        if (after) { m.close(); after(name, dir); } else { draw(); drawCart(pos); }
      }, true);
      Array.prototype.forEach.call(box.querySelectorAll('[data-close]'), function (x) { x.onclick = m.close; });
    }
    draw();
  }

  /* ================================================================ staff home: POS, clock, stock count, cash count */
  function go(pos, view) { pos.view = view; render(pos); window.scrollTo(0, 0); }

  function pageTop(pos, title, right) {
    return '<div class="co-top"><button class="btn btn-ghost btn-sm" data-home>‹ Home</button><h2 class="page-title">' + S.esc(title) + '</h2>' + (right || '<span></span>') + '</div>';
  }
  function wireTop(pos, root) {
    Array.prototype.forEach.call(root.querySelectorAll('[data-home]'), function (b) { b.onclick = function () { go(pos, 'home'); }; });
  }

  /* day state as the server knows it, plus what is still waiting on this phone */
  function dayNow(pos) {
    var d = JSON.parse(JSON.stringify(pos.data.day || { open: false, number: 0, next: 1, counts: {} }));
    d.counts = d.counts || {};
    queue(pos).forEach(function (x) {
      if (x.error) return;
      if (x.type === 'day' && x.day.action === 'open' && !d.open) { d.open = true; d.number = d.next; d.countsFor = 'Closing'; d.openedAt = x.day.clientTime; d.counts = {}; }
      if (x.type === 'day' && x.day.action === 'close' && d.open) { d.open = false; d.next = d.number + 1; d.countsFor = 'Opening'; d.counts = {}; }
      if (x.type === 'count' && x.count.purpose === (d.open ? 'Closing' : 'Opening')) d.counts.stock = true;
      if (x.type === 'cash' && x.cash.kind === 'count' && x.cash.purpose === (d.open ? 'Closing' : 'Opening')) d.counts.cash = true;
    });
    return d;
  }

  /* expected cash = server figure + sales, returns and handovers still waiting on this phone (never shown, only compared) */
  function expectedNow(pos) {
    var e = pos.data.expectedCash || { usd: 0, lbp: 0 };
    var usd = e.usd, lbp = e.lbp;
    queue(pos).forEach(function (x) {
      if (x.error) return;
      if (x.type === 'sale') { usd += (x.sale.recvUsd || 0) - (x.sale.changeUsd || 0); lbp += (x.sale.recvLbp || 0) - (x.sale.changeLbp || 0); }
      if (x.type === 'return') { usd -= x.ret.refundUsd || 0; lbp -= x.ret.refundLbp || 0; }
      if (x.type === 'cash' && x.cash.kind === 'handover') { usd -= x.cash.usd || 0; lbp -= x.cash.lbp || 0; }
      if (x.type === 'cash' && x.cash.kind === 'cashin') { usd += x.cash.usd || 0; lbp += x.cash.lbp || 0; }
    });
    return { usd: r2(usd), lbp: Math.round(lbp) };
  }

  var ICONS = {
    pos: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6h15l-1.5 9h-12z"/><path d="M6 6 5 3H2"/><circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    count: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="m8 9 1.5 1.5L12 8M8 15l1.5 1.5L12 14M14 9h3M14 15h3"/></svg>',
    cash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 10v4M18 10v4"/></svg>',
    demo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.3"/><circle cx="15.5" cy="15.5" r="1.3"/><circle cx="15.5" cy="8.5" r="1.3"/><circle cx="8.5" cy="15.5" r="1.3"/></svg>',
    customers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c.6-3.4 3-5.4 6-5.4s5.4 2 6 5.4"/><path d="M16 4.6a3.2 3.2 0 0 1 0 6.3M18.5 14.9c1.4.8 2.3 2.5 2.5 5.1"/></svg>',
    person: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="8" r="3.4"/><path d="M3.5 20c.7-3.6 3.2-5.6 6.5-5.6 1.6 0 3 .5 4.1 1.4"/><path d="M19 14v6M16 17h6"/></svg>',
    card: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19M6.5 15h4"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>',
    scan: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 8v8M10 8v8M13 8v8M16.5 8v8"/></svg>'
  };

  function renderHome(pos) {
    document.body.classList.remove('pos-checkout');
    var root = pos.el.querySelector('#pos');
    var d = dayNow(pos);
    var when = function (v) { return v ? (String(v).indexOf('T') > 0 ? new Date(v).toTimeString().slice(0, 5) : String(v).slice(11, 16)) : ''; };
    var mark = function (ok) { return ok ? '<span class="ok">✓</span>' : '<span class="no">–</span>'; };
    var cash = expectedNow(pos), warn = pos.data.cashWarn || {};
    var tooMuch = (warn.usd && cash.usd > warn.usd) || (warn.lbp && cash.lbp > warn.lbp);
    var demoN = demoState(pos);
    root.innerHTML =
      '<div class="home">' +
      '<div class="day-strip' + (d.open ? ' open' : '') + '">' +
      '<div class="ds-main"><b>' + (d.open ? 'Day ' + d.number + ' open since ' + when(d.openedAt) : 'Day not started') + '</b>' +
      '<div class="small">' + (d.open ? 'Closing counts' : 'Opening counts') + ': cash ' + mark(d.counts.cash) + ' · stock ' + mark(d.counts.stock) + '</div></div>' +
      '<button class="btn ' + (d.open ? 'btn-ghost' : 'btn-primary') + ' btn-sm" id="dayBtn">' + (d.open ? 'Close day' : 'Start day') + '</button></div>' +
      (tooMuch ? '<div class="cash-warn"><b>Too much cash in the drawer.</b> Ask your manager to collect it, then submit a handover in Cash count.</div>' : '') +
      errorSlot(pos) +
      '<div class="home-grid">' +
      [['pos', 'POS', 'Sell, checkout, returns'],
        ['demo', 'Demo counter', demoN.total || demoN.customers ? demoN.total + ' plays · ' + demoN.customers + ' activated' : 'Games played at the stand'],
        ['clock', 'Clock in / out', 'Start and end your shift'], ['count', 'Stock count', 'Count, request a refill'],
        ['cash', 'Cash count', 'Count the drawer, handovers'], ['customers', 'Customers', 'Save a customer contact']].map(function (b) {
        return '<button class="home-box" data-go="' + b[0] + '">' + ICONS[b[0]] + '<b>' + b[1] + '</b><span>' + S.esc(b[2]) + '</span></button>';
      }).join('') + '</div>' +
      '<div class="home-foot"><span id="posSync"></span></div></div>';
    Array.prototype.forEach.call(root.querySelectorAll('[data-go]'), function (b) {
      b.onclick = function () { var v = b.getAttribute('data-go'); go(pos, v === 'pos' ? 'products' : v); };
    });
    root.querySelector('#dayBtn').onclick = function () { openDayDialog(pos); };
    wireErrorSlot(pos, root);
    drawSync(pos);
  }

  function namePicker(pos, selected, id) {
    var open = openShiftNames(pos);
    var names = pos.data.staff.filter(function (n) { return open[n]; });
    return '<div class="sellers" id="' + id + '">' + names.map(function (n) {
      return '<button class="seller' + (selected === n ? ' active' : '') + '" data-pick="' + S.esc(n) + '">' + S.esc(n) + '</button>';
    }).join('') + '<button class="seller add" data-clockin>+ Clock in</button></div>' +
      (names.length ? '' : '<div class="small muted" style="margin-top:6px">Nobody is clocked in yet.</div>');
  }
  function wirePicker(pos, root, onPick, onReRender) {
    Array.prototype.forEach.call(root.querySelectorAll('[data-pick]'), function (b) {
      b.onclick = function () {
        Array.prototype.forEach.call(root.querySelectorAll('[data-pick]'), function (x) { x.classList.toggle('active', x === b); });
        onPick(b.getAttribute('data-pick'));
      };
    });
    var c = root.querySelector('[data-clockin]');
    if (c) c.onclick = function () {
      var under = root.closest ? root.closest('#posModal') : null;
      if (under) { under.removeAttribute('id'); under.hidden = true; }
      openStaff(pos, function (name, dir) { if (dir === 'in') onPick(name); onReRender(); }, under);
    };
  }

  function openDayDialog(pos) {
    var d = dayNow(pos);
    var action = d.open ? 'close' : 'open';
    var who = '';
    var missing = [];
    if (!d.counts.cash) missing.push('cash');
    if (!d.counts.stock) missing.push('stock');
    var stillIn = d.open ? Object.keys(openShiftNames(pos)) : [];
    var m = modal(
      '<div class="pay-head"><h2>' + (d.open ? 'Close day ' + d.number : 'Start day ' + d.next) + '</h2><button class="link-btn" data-close>Cancel</button></div>' +
      (stillIn.length ? '<div class="pay-status owed" id="stillIn"><span><b>' + S.esc(stillIn.join(', ')) + '</b> ' + (stillIn.length === 1 ? 'is' : 'are') + ' still clocked in. Clock out before closing?' +
        '<br><button class="btn btn-ghost btn-sm" id="clockAllOut" style="margin-top:8px">Clock out ' + (stillIn.length === 1 ? S.esc(stillIn[0]) : 'everyone') + ' now</button></span></div>' : '') +
      (missing.length
        ? '<div class="pay-status owed"><span>No ' + (d.open ? 'closing' : 'opening') + ' ' + missing.join(' or ') + ' count yet. You can still ' + (d.open ? 'close' : 'start') + ' the day, but the report will have gaps.</span></div>'
        : '<div class="pay-status good"><span>Cash and stock counted. Ready.</span></div>') +
      '<h3 class="rs-title">Who is ' + (d.open ? 'closing' : 'starting') + ' the day?</h3><div id="dayWho">' + namePicker(pos, '', 'dayNames') + '</div>' +
      (d.open ? '<div class="field" style="margin-top:12px"><label for="dayNotes">Notes for the day (optional)</label><textarea class="input" id="dayNotes" rows="3" placeholder="Weather, crowd, what sold, problems, what to bring tomorrow…"></textarea></div>' : '') +
      '<div id="dayErr"></div>' +
      '<button class="btn btn-accent btn-big btn-block" id="dayGo">' + (d.open ? 'Close day' : 'Start day') + '</button>');
    function wire() { wirePicker(pos, m.el, function (n) { who = n; }, function () { m.el.querySelector('#dayWho').innerHTML = namePicker(pos, who, 'dayNames'); wire(); }); }
    wire();
    var cao = m.el.querySelector('#clockAllOut');
    if (cao) cao.onclick = function () {
      var t = new Date().toISOString();
      stillIn.forEach(function (n) {
        enqueue(pos, { qid: 'C' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), type: 'clock', name: n, direction: 'out', clientTime: t, note: 'Clocked out at Close day' });
      });
      flush(pos);
      m.el.querySelector('#stillIn').outerHTML = '<div class="pay-status good"><span>' + S.esc(stillIn.join(', ')) + ' clocked out.</span></div>';
      S.toast('Clocked out: ' + stillIn.join(', ') + '.');
    };
    m.el.querySelector('#dayGo').onclick = function () {
      if (!who) { m.el.querySelector('#dayErr').innerHTML = '<div class="form-error">Pick your name.</div>'; return; }
      var dayNo = d.open ? d.number : d.next;
      var notesEl = m.el.querySelector('#dayNotes');
      if (action === 'close') { saveDemo(pos, who, true); sendRefills(pos, who); drop('shn-countdraft-' + pos.eventId); pos.countState = null; } // demo counter + refill requests go with the day, then reset
      enqueue(pos, { qid: 'D' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), type: 'day',
        day: { action: action, by: who, notes: notesEl ? notesEl.value.trim() : '', clientTime: new Date().toISOString() } });
      m.close();
      render(pos);
      flush(pos);
      if (action === 'open') { S.toast('Day started.'); return; }
      var m2 = modal('<div class="pay-head"><h2>Day ' + dayNo + ' closed</h2><button class="link-btn" data-close>Done</button></div>' +
        '<p class="muted" style="margin-top:0">The report is in the event sheet (Days tab). Share the day\'s summary with the team:</p>' +
        '<button class="btn btn-accent btn-big btn-block" id="shareDay">Share summary on WhatsApp</button>');
      m2.el.querySelector('#shareDay').onclick = function () {
        var b = this; b.disabled = true; b.textContent = 'Preparing…';
        // wait until the close is sent, so the summary has the final figures
        waitQueue(pos, 15000).then(function () {
          return shareSummary({ eventId: pos.eventId, token: pos.token, day: dayNo });
        }).then(function () { m2.close(); }, function () { b.disabled = false; b.textContent = 'Share summary on WhatsApp'; });
      };
    };
  }

  /* ---------------- clock in / out page */
  function renderClock(pos) {
    var root = pos.el.querySelector('#pos');
    root.innerHTML = '<div class="co">' + pageTop(pos, 'Clock in / out') + '<section class="co-card" id="clockBody"></section></div>';
    wireTop(pos, root);
    staffPanel(pos, root.querySelector('#clockBody'), function () { renderClock(pos); });
  }

  /* ---------------- purpose of a count */
  function purposeHtml(pos, current) {
    var d = dayNow(pos);
    if (!d.open) return '<div class="purpose"><span class="pill pill-upcoming">Opening count</span> <span class="small muted">Before Start day</span></div>';
    return '<div class="seg seg2" id="purposeSeg">' + [['Spot', 'Spot check'], ['Closing', 'Closing count']].map(function (x) {
      return '<button data-purpose="' + x[0] + '" class="' + (current === x[0] ? 'active' : '') + '">' + x[1] + '</button>';
    }).join('') + '</div>';
  }
  function purposeOf(pos, chosen) { return dayNow(pos).open ? (chosen || 'Spot') : 'Opening'; }
  function wirePurpose(root, st) {
    Array.prototype.forEach.call(root.querySelectorAll('[data-purpose]'), function (b) {
      b.onclick = function () {
        st.purpose = b.getAttribute('data-purpose');
        Array.prototype.forEach.call(root.querySelectorAll('[data-purpose]'), function (x) { x.classList.toggle('active', x === b); });
      };
    });
  }

  /* ---------------- stock count page */
  function renderCount(pos) {
    var root = pos.el.querySelector('#pos');
    var st = pos.countState = pos.countState || load('shn-countdraft-' + pos.eventId, null) || { purpose: 'Spot', by: '', values: {} };
    var refills = load(refillKey(pos.eventId), {});
    var pend = pendingQty(pos);
    var prods = pos.data.products;
    root.innerHTML = '<div class="co count-page">' + pageTop(pos, 'Stock count') +
      '<section class="co-card">' + purposeHtml(pos, st.purpose) +
      '<div class="count-tools"><button class="btn btn-ghost" id="countScan">' + ICONS.scan + ' Scan</button></div></section>' +
      '<section class="co-card"><table class="count-tbl"><thead><tr><th>Product</th><th>Sellable</th><th>Demo</th><th>Variance</th><th>Refill</th></tr></thead><tbody>' +
      prods.map(function (p, i) {
        var v = st.values[p.ref] || {};
        var rq = refills[p.ref];
        return '<tr data-ref="' + S.esc(p.ref) + '"><td class="ct-name">' + S.esc(p.name) + '</td>' +
          '<td><input class="input ct-in" data-k="s" data-i="' + i + '" inputmode="numeric" enterkeyhint="next" value="' + S.esc(v.s == null ? '' : v.s) + '"></td>' +
          '<td>' + (p.demo ? '<input class="input ct-in" data-k="d" data-i="' + i + '" inputmode="numeric" enterkeyhint="next" value="' + S.esc(v.d == null ? '' : v.d) + '">' : '<span class="muted small">–</span>') + '</td>' +
          '<td class="ct-mark"></td>' +
          '<td><input class="input ct-in rf" data-rf="' + S.esc(p.ref) + '" inputmode="numeric" enterkeyhint="next" value="' + S.esc(rq ? rq : '') + '" aria-label="Refill quantity"></td></tr>';
      }).join('') + '</tbody></table>' +
      '<p class="small muted" style="margin:8px 0 0">Refill: how many more you need. Kept on this phone and sent to your manager when the day is closed.</p></section>' +
      '<section class="co-card"><h3>Counted by <span class="req">required</span></h3><div id="countWho">' + namePicker(pos, st.by, 'countNames') + '</div></section>' +
      '<div id="countErr"></div><button class="btn btn-accent btn-big btn-block" id="countSave">Save count</button></div>';
    wireTop(pos, root);
    wirePurpose(root, st);
    function wireWho() { wirePicker(pos, root, function (n) { st.by = n; keep(); }, function () { root.querySelector('#countWho').innerHTML = namePicker(pos, st.by, 'countNames'); wireWho(); }); }
    wireWho();
    var inputs = Array.prototype.slice.call(root.querySelectorAll('.ct-in'));
    function keep() { save('shn-countdraft-' + pos.eventId, st); }
    function mark(tr) {
      var ref = tr.getAttribute('data-ref');
      var p = product(pos, ref), v = st.values[ref] || {};
      var cell = tr.querySelector('.ct-mark');
      var parts = [];
      var expS = p.live - (pend[ref] || 0), expD = p.demo || 0;
      if (v.s !== undefined && v.s !== '') { var ds = Number(v.s) - expS; parts.push(ds === 0 ? '' : (ds > 0 ? '+' : '') + ds); }
      if (v.d !== undefined && v.d !== '') { var dd = Number(v.d) - expD; parts.push(dd === 0 ? '' : 'demo ' + (dd > 0 ? '+' : '') + dd); }
      if (!parts.length) { cell.innerHTML = ''; return; }
      var bad = parts.filter(Boolean);
      cell.innerHTML = bad.length ? '<span class="ct-bad">✗ ' + S.esc(bad.join(' · ')) + '</span>' : '<span class="ct-ok">✓</span>';
    }
    inputs.forEach(function (inp, k) {
      inp.addEventListener('input', function () {
        var tr = inp.closest('tr'), ref = tr.getAttribute('data-ref');
        inp.value = inp.value.replace(/[^0-9]/g, '');
        if (inp.getAttribute('data-rf')) {
          var r = load(refillKey(pos.eventId), {});
          if (Number(inp.value) > 0) r[ref] = Number(inp.value); else delete r[ref];
          save(refillKey(pos.eventId), r);
          return;
        }
        st.values[ref] = st.values[ref] || {};
        st.values[ref][inp.getAttribute('data-k')] = inp.value;
        keep();
        mark(tr);
      });
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); var next = inputs[k + 1]; if (next) { next.focus(); next.select(); } else inp.blur(); }
      });
    });
    Array.prototype.forEach.call(root.querySelectorAll('tbody tr'), mark);
    keepAboveKeyboard(root);
    root.querySelector('#countScan').onclick = function () {
      openScanner(pos, { title: 'Scan to count', count: {
        get: function (ref) { return st.values[ref] || {}; },
        set: function (ref, v) {
          st.values[ref] = st.values[ref] || {};
          st.values[ref].s = v.s;
          if (v.d !== undefined) st.values[ref].d = v.d;
          keep();
          var tr = row(ref);
          if (tr) {
            var si = tr.querySelector('[data-k="s"]'), di = tr.querySelector('[data-k="d"]');
            if (si) si.value = v.s; if (di && v.d !== undefined) di.value = v.d;
            mark(tr);
          }
        },
        done: function (ref) {
          setTimeout(function () {
            var tr = row(ref);
            if (!tr) return;
            tr.scrollIntoView({ block: 'center' });
            tr.classList.add('flash');
            setTimeout(function () { tr.classList.remove('flash'); }, 1500);
          }, 60);
        }
      } }, null);
    };
    function row(ref) { return root.querySelector('tr[data-ref="' + (window.CSS && CSS.escape ? CSS.escape(ref) : ref) + '"]'); }
    root.querySelector('#countSave').onclick = function () {
      var lines = Object.keys(st.values).map(function (ref) {
        var v = st.values[ref];
        return { ref: ref, sellable: v.s === '' || v.s == null ? '' : Number(v.s), demo: v.d === '' || v.d == null ? '' : Number(v.d) };
      }).filter(function (l) { return l.sellable !== '' || l.demo !== ''; });
      var err = !lines.length ? 'Enter at least one quantity.' : !st.by ? 'Pick who counted.' : '';
      if (err) { root.querySelector('#countErr').innerHTML = '<div class="form-error">' + S.esc(err) + '</div>'; return; }
      var off = Array.prototype.filter.call(root.querySelectorAll('.ct-bad'), function () { return true; }).length;
      var count = { id: 'K' + newSaleId().slice(1), countedBy: st.by, purpose: purposeOf(pos, st.purpose), lines: lines, clientTime: new Date().toISOString() };
      enqueue(pos, { qid: count.id, type: 'count', count: count });
      pos.countState = null;
      drop('shn-countdraft-' + pos.eventId);
      S.toast('Count saved: ' + lines.length + ' product' + (lines.length === 1 ? '' : 's') + (off ? ', ' + off + ' with a variance.' : ', all correct.'));
      go(pos, 'home');
      flush(pos);
    };
  }

  /* ---------------- cash count page (banknotes) + handovers */
  var USD_NOTES = [100, 50, 20, 10, 5, 1];
  var LBP_NOTES = [100000, 50000, 20000, 10000, 5000, 1000];

  function renderCash(pos) {
    var root = pos.el.querySelector('#pos');
    var st = pos.cashState = pos.cashState || { purpose: 'Spot', by: '', usd: {}, lbp: {}, result: null };
    function rows(cur, notes) {
      return notes.map(function (n) {
        var q = st[cur][n] || '';
        return '<tr><td class="cn-note">' + (cur === 'usd' ? '$' + n : S.num(n)) + '</td><td>×</td>' +
          '<td><input class="input ct-in cn-in" data-cur="' + cur + '" data-note="' + n + '" inputmode="numeric" enterkeyhint="next" value="' + S.esc(q) + '"></td>' +
          '<td class="cn-sub" data-sub="' + cur + n + '"></td></tr>';
      }).join('');
    }
    root.innerHTML = '<div class="co cash-page">' + pageTop(pos, 'Cash count') +
      '<section class="co-card">' + purposeHtml(pos, st.purpose) +
      '<button class="btn btn-ghost btn-block" id="handoverBtn" style="margin-top:10px">Submit a handover</button></section>' +
      '<section class="co-card"><div class="cash-cols">' +
      '<div><h3>USD</h3><table class="count-tbl cn-tbl"><tbody>' + rows('usd', USD_NOTES) + '</tbody></table><div class="cn-total">Total <b id="totUsd"></b></div></div>' +
      '<div><h3>LBP</h3><table class="count-tbl cn-tbl"><tbody>' + rows('lbp', LBP_NOTES) + '</tbody></table><div class="cn-total">Total <b id="totLbp"></b></div></div>' +
      '</div></section>' +
      '<section class="co-card"><h3>Counted by <span class="req">required</span></h3><div id="cashWho">' + namePicker(pos, st.by, 'cashNames') + '</div></section>' +
      '<div id="cashResult"></div><div id="cashErr"></div>' +
      '<button class="btn btn-accent btn-big btn-block" id="cashSave">Check &amp; save count</button></div>';
    wireTop(pos, root);
    wirePurpose(root, st);
    function wireWho() { wirePicker(pos, root, function (n) { st.by = n; }, function () { root.querySelector('#cashWho').innerHTML = namePicker(pos, st.by, 'cashNames'); wireWho(); }); }
    wireWho();
    function totals2() {
      var u = 0, l = 0;
      USD_NOTES.forEach(function (n) { u += n * (Number(st.usd[n]) || 0); });
      LBP_NOTES.forEach(function (n) { l += n * (Number(st.lbp[n]) || 0); });
      return { usd: u, lbp: l };
    }
    function draw() {
      USD_NOTES.forEach(function (n) { root.querySelector('[data-sub="usd' + n + '"]').textContent = st.usd[n] ? '$' + S.num(n * st.usd[n]) : ''; });
      LBP_NOTES.forEach(function (n) { root.querySelector('[data-sub="lbp' + n + '"]').textContent = st.lbp[n] ? S.num(n * st.lbp[n]) : ''; });
      var t = totals2();
      root.querySelector('#totUsd').textContent = S.money(t.usd);
      root.querySelector('#totLbp').textContent = lbp(t.lbp);
    }
    var inputs = Array.prototype.slice.call(root.querySelectorAll('.cn-in'));
    inputs.forEach(function (inp, k) {
      inp.addEventListener('input', function () {
        inp.value = inp.value.replace(/[^0-9]/g, '');
        st[inp.getAttribute('data-cur')][inp.getAttribute('data-note')] = inp.value;
        root.querySelector('#cashResult').innerHTML = '';
        draw();
      });
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); var next = inputs[k + 1]; if (next) { next.focus(); next.select(); } else inp.blur(); }
      });
    });
    draw();
    keepAboveKeyboard(root);
    root.querySelector('#handoverBtn').onclick = function () { openHandover(pos); };
    root.querySelector('#cashSave').onclick = function () {
      if (!st.by) { root.querySelector('#cashErr').innerHTML = '<div class="form-error">Pick who counted.</div>'; return; }
      root.querySelector('#cashErr').innerHTML = '';
      var t = totals2();
      var exp = expectedNow(pos);
      var du = r2(t.usd - exp.usd), dl = t.lbp - exp.lbp;
      var cash = { id: 'M' + newSaleId().slice(1), kind: 'count', by: st.by, usd: t.usd, lbp: t.lbp, purpose: purposeOf(pos, st.purpose),
        banknotes: { usd: st.usd, lbp: st.lbp }, clientTime: new Date().toISOString() };
      enqueue(pos, { qid: cash.id, type: 'cash', cash: cash });
      flush(pos);
      var correct = Math.abs(du) < 0.005 && dl === 0;
      root.querySelector('#cashResult').innerHTML = correct
        ? '<div class="cash-res good">✓ Correct</div>'
        : '<div class="cash-res bad">✗ Variance: ' + [du ? 'USD ' + (du > 0 ? '+' : '−') + S.money(Math.abs(du)) : '', dl ? 'LBP ' + (dl > 0 ? '+' : '−') + S.num(Math.abs(dl)) : ''].filter(Boolean).join(' · ') + '</div>';
      root.querySelector('#cashSave').textContent = 'Saved. Back to home';
      root.querySelector('#cashSave').onclick = function () { pos.cashState = null; go(pos, 'home'); };
    };
  }

  /* handover: cash taken out of the drawer (to the manager) or added to it (from the manager) */
  function openHandover(pos) {
    var mode = 'out', who = '';
    var m = modal(
      '<div class="pay-head"><h2>Cash handover</h2><button class="link-btn" data-close>Cancel</button></div>' +
      '<div class="seg seg2" id="hoMode"><button type="button" class="active" data-mode="out">Taking money out</button><button type="button" data-mode="in">Adding money</button></div>' +
      '<p class="small muted" id="hoHint" style="margin:8px 0 10px"></p>' +
      '<div class="two"><div class="field"><label for="hoUsd">Amount USD</label><input class="input money-in" id="hoUsd" inputmode="decimal" placeholder="0"></div>' +
      '<div class="field"><label for="hoLbp">Amount LBP</label><input class="input money-in" id="hoLbp" inputmode="numeric" placeholder="0"></div></div>' +
      '<div class="field"><label for="hoTo" id="hoToLabel">Collected by</label><input class="input" id="hoTo" placeholder="Name of the person taking the cash"></div>' +
      '<div id="hoWhoBox" hidden><h3 class="rs-title">Received by</h3><div id="hoWho">' + namePicker(pos, '', 'hoNames') + '</div></div>' +
      '<div class="field"><label for="hoNote">Note (optional)</label><input class="input" id="hoNote"></div>' +
      '<div id="hoErr"></div><button class="btn btn-accent btn-big btn-block" id="hoSave">Submit handover</button>');
    var $ = function (sel) { return m.el.querySelector(sel); };
    liveCommas($('#hoLbp'), function () {});
    function wire() { wirePicker(pos, m.el, function (n) { who = n; $('#hoErr').innerHTML = ''; }, function () { $('#hoWho').innerHTML = namePicker(pos, who, 'hoNames'); wire(); }); }
    wire();
    function setMode(md) {
      mode = md;
      Array.prototype.forEach.call(m.el.querySelectorAll('#hoMode button'), function (b) { b.classList.toggle('active', b.getAttribute('data-mode') === md); });
      $('#hoHint').textContent = md === 'out' ? 'Cash leaving the drawer, e.g. collected by the manager.' : 'Cash put into the drawer, e.g. extra change brought by the manager.';
      $('#hoToLabel').textContent = md === 'out' ? 'Collected by' : 'Brought by';
      $('#hoTo').placeholder = md === 'out' ? 'Name of the person taking the cash' : 'Name of the person bringing the cash';
      $('#hoWhoBox').hidden = md === 'out';
      $('#hoSave').textContent = md === 'out' ? 'Submit handover' : 'Add to the drawer';
      $('#hoErr').innerHTML = '';
    }
    Array.prototype.forEach.call(m.el.querySelectorAll('#hoMode button'), function (b) { b.onclick = function () { setMode(b.getAttribute('data-mode')); }; });
    setMode('out');
    $('#hoSave').onclick = function () {
      var usd = parseNum($('#hoUsd').value), l = Math.round(parseNum($('#hoLbp').value)), name = $('#hoTo').value.trim();
      var err = !usd && !l ? (mode === 'out' ? 'Enter the amount handed over.' : 'Enter the amount added.')
        : !name ? (mode === 'out' ? 'Who collected the cash?' : 'Who brought the cash?') : mode === 'in' && !who ? 'Pick who received it.' : '';
      if (err) { $('#hoErr').innerHTML = '<div class="form-error">' + S.esc(err) + '</div>'; return; }
      var cash;
      if (mode === 'out') {
        var open = openShiftNames(pos);
        cash = { id: 'H' + newSaleId().slice(1), kind: 'handover', by: pos.data.staff.filter(function (n) { return open[n]; }).join(', '), to: name, usd: usd, lbp: l,
          note: $('#hoNote').value.trim(), clientTime: new Date().toISOString() };
      } else {
        cash = { id: 'I' + newSaleId().slice(1), kind: 'cashin', from: name, by: who, usd: usd, lbp: l, note: $('#hoNote').value.trim(), clientTime: new Date().toISOString() };
      }
      enqueue(pos, { qid: cash.id, type: 'cash', cash: cash });
      m.close();
      var amt = [usd ? S.money(usd) : '', l ? lbp(l) : ''].filter(Boolean).join(' + ');
      S.toast(mode === 'out' ? 'Handover saved: ' + amt + ' to ' + name + '.' : 'Added to the drawer: ' + amt + ' from ' + name + '.');
      flush(pos);
      if (pos.view === 'home') render(pos);
    };
  }

  /* ---------------- refill quantities typed in the stock count: sent with Close day, then cleared */
  function sendRefills(pos, by) {
    var r = load(refillKey(pos.eventId), {});
    var lines = Object.keys(r).filter(function (k) { return r[k] > 0 && product(pos, k); }).map(function (k) { return { ref: k, qty: r[k] }; });
    drop(refillKey(pos.eventId));
    if (!lines.length) return false;
    var req = { id: 'Q' + newSaleId().slice(1), by: by || '', lines: lines, note: '', clientTime: new Date().toISOString() };
    enqueue(pos, { qid: req.id, type: 'refill', refill: req });
    return true;
  }

  /* ---------------- demo counter: plays per demo game + customers activated, kept on this phone until saved */
  function demoState(pos) {
    var d = load(demoKey(pos.eventId), null) || { plays: {}, customers: 0 };
    d.total = Object.keys(d.plays).reduce(function (a, k) { return a + (d.plays[k] || 0); }, 0);
    return d;
  }
  function setDemo(pos, d) { save(demoKey(pos.eventId), { plays: d.plays, customers: d.customers }); }
  function saveDemo(pos, by, silent) {
    var d = demoState(pos);
    if (!d.total && !d.customers) return false;
    var entry = { id: 'G' + newSaleId().slice(1), by: by || '', plays: d.plays, customers: d.customers, clientTime: new Date().toISOString() };
    enqueue(pos, { qid: entry.id, type: 'demo', demo: entry });
    drop(demoKey(pos.eventId));
    if (!silent) S.toast('Demo counter saved: ' + d.total + ' plays, ' + d.customers + ' customers activated.');
    return true;
  }
  function renderDemo(pos) {
    var root = pos.el.querySelector('#pos');
    var demos = pos.data.products.filter(function (p) { return p.demo > 0; });
    var d = demoState(pos);
    root.innerHTML = '<div class="co demo-page">' + pageTop(pos, 'Demo counter', '<button class="btn btn-ghost btn-sm" id="demoSave">Save</button>') +
      '<section class="co-card demo-cust"><div><b>Customers activated</b><div class="small muted">People who played a game</div></div>' +
      '<div class="qty big-qty"><button id="custDec" aria-label="One less">−</button><span id="custN">' + d.customers + '</span><button id="custInc" aria-label="One more">+</button></div></section>' +
      (demos.length ? '<p class="small muted">Tap a game each time it is played. Counts stay on this phone until the day is closed (or you press Save).</p>' +
        '<div class="tiles demo-tiles">' + demos.map(function (p) {
          var pic = picUrl(p.picture), n = d.plays[p.ref] || 0;
          return '<div class="tile demo-tile' + (n ? ' in-cart' : '') + '" data-ref="' + S.esc(p.ref) + '" role="button" tabindex="0"><span class="tile-img">' + (pic
            ? '<img src="' + S.esc(pic) + '" alt="" loading="lazy" onerror="this.parentNode.querySelector(\'.ph\').hidden=false;this.remove()">' : '') +
            '<span class="ph"' + (pic ? ' hidden' : '') + '>' + S.esc(initials(p.name)) + '</span>' +
            '<span class="demo-n">' + n + '</span>' + (n ? '<button class="demo-dec" data-ddec="' + S.esc(p.ref) + '" aria-label="One less">−</button>' : '') + '</span>' +
            '<span class="tile-name">' + S.esc(p.name) + '</span></div>';
        }).join('') + '</div>'
        : '<div class="card empty"><p class="muted">No demo units in this event. Demo quantities are set in the Listing tab (Demo Qty).</p></div>') +
      '<div class="demo-foot"><span class="small muted">Total <b>' + d.total + '</b> plays</span></div></div>';
    wireTop(pos, root);
    function bump(ref, delta) {
      var s2 = demoState(pos);
      s2.plays[ref] = Math.max(0, (s2.plays[ref] || 0) + delta);
      if (!s2.plays[ref]) delete s2.plays[ref];
      setDemo(pos, s2);
      if (navigator.vibrate && delta > 0) navigator.vibrate(25);
      renderDemo(pos);
    }
    var tiles = root.querySelector('.demo-tiles');
    if (tiles) tiles.onclick = function (e) {
      var dec = e.target.closest('[data-ddec]');
      if (dec) return bump(dec.getAttribute('data-ddec'), -1);
      var t = e.target.closest('.demo-tile');
      if (t) bump(t.getAttribute('data-ref'), 1);
    };
    function cust(delta) { var s2 = demoState(pos); s2.customers = Math.max(0, (s2.customers || 0) + delta); setDemo(pos, s2); root.querySelector('#custN').textContent = s2.customers; }
    root.querySelector('#custInc').onclick = function () { cust(1); if (navigator.vibrate) navigator.vibrate(25); };
    root.querySelector('#custDec').onclick = function () { cust(-1); };
    root.querySelector('#demoSave').onclick = function () {
      var open = openShiftNames(pos);
      if (!saveDemo(pos, pos.data.staff.filter(function (n) { return open[n]; }).join(', '))) { S.toast('Nothing to save yet.'); return; }
      flush(pos);
      renderDemo(pos);
    };
  }

  /* ---------------- customers page */
  function renderCustomers(pos) {
    var root = pos.el.querySelector('#pos');
    var list = load(contactsKey(pos.eventId), []);
    root.innerHTML = '<div class="co">' + pageTop(pos, 'Customers') +
      '<section class="co-card"><h3>New contact</h3><p class="small muted" style="margin-top:0">All optional. Fill what the customer agrees to give.</p>' + contactFields() +
      '<div class="field"><label for="cuNote">Note</label><input class="input" id="cuNote" placeholder="e.g. Interested in strategy games, wants the newsletter"></div>' +
      '<div id="cuErr"></div><button class="btn btn-accent btn-big btn-block" id="cuSave">Save contact</button></section>' +
      '<section class="co-card"><h3>Saved on this phone</h3>' + (list.length ? list.slice(0, 30).map(function (c) {
        return '<div class="contact-row"><b>' + S.esc(c.name || '—') + '</b> <span class="small muted">' + S.esc([c.phone, c.email].filter(Boolean).join(' · ')) + '</span>' +
          '<div class="small muted">' + new Date(c.at).toTimeString().slice(0, 5) + (c.sale ? ' · with a sale' : '') + '</div></div>';
      }).join('') : '<p class="muted small">None yet.</p>') + '</section></div>';
    wireTop(pos, root);
    root.querySelector('#cuSave').onclick = function () {
      var c = readContact(root);
      if (!c) { root.querySelector('#cuErr').innerHTML = '<div class="form-error">Enter a name, phone or email.</div>'; return; }
      var open = openShiftNames(pos);
      enqueueContact(pos, c, '', pos.data.staff.filter(function (n) { return open[n]; }).join(', '));
      S.toast('Contact saved' + (c.name ? ': ' + c.name : '') + '.');
      flush(pos);
      renderCustomers(pos);
    };
  }

  /* resolves once the queue is empty (or after the timeout) */
  function waitQueue(pos, ms) {
    var until = Date.now() + ms;
    return new Promise(function (res) {
      (function check() {
        flush(pos);
        if (!queue(pos).some(function (x) { return !x.error; }) || Date.now() > until) return res();
        setTimeout(check, 700);
      })();
    });
  }

  /* ---------------- WhatsApp summary: a picture (shared with the phone's share sheet), text as a fallback */
  function shareSummary(o) {
    S = window.SHN;
    S.toast('Preparing the summary…');
    return S.api('daySummary', { eventId: o.eventId, day: o.day || null }, { token: o.token, quiet: true }).then(function (res) {
      var d = res.summary;
      var text = summaryText(d);
      return drawSummary(d).then(function (blob) {
        var name = 'SHN LEB - ' + d.event + ' - Day ' + (d.day || '') + '.png';
        var file = null;
        try { file = blob && new File([blob], name, { type: 'image/png' }); } catch (e) { file = null; }
        if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
          return navigator.share({ files: [file], text: text }).catch(function (err) { if (err && err.name !== 'AbortError') throw err; });
        }
        // no picture sharing on this device: show the picture to save, and open WhatsApp with the text
        showSummaryImage(blob, name, text);
      });
    }).catch(function (err) { S.toast(err.message || 'Could not prepare the summary.', true); throw err; });
  }

  function summaryText(d) {
    var L = [];
    L.push('*SHN LEB · ' + d.event + '*');
    L.push((d.day ? 'Day ' + d.day + ' · ' : '') + niceDate(d.date) + (d.status === 'Open' ? ' (still open)' : ''));
    L.push('');
    L.push('Sales: ' + S.money(d.sales) + (d.targetSales ? ' (target ' + S.money(d.targetSales) + ')' : ''));
    L.push('Units: ' + d.units + (d.targetQty ? ' (target ' + d.targetQty + ')' : '') + ' · Sales made: ' + d.tickets + ' · Average: ' + S.money(d.avgTicket));
    L.push('Cash ' + S.money(d.cash) + ' · Online ' + S.money(d.online) + (d.returns ? ' · Returns ' + S.money(d.returns) : ''));
    if (d.products.length) { L.push(''); L.push('Top games:'); d.products.forEach(function (p) { L.push('• ' + p.units + '× ' + p.name); }); }
    if (d.demoPlays || d.customersActivated) L.push('', 'Demo plays: ' + d.demoPlays + ' · Customers activated: ' + d.customersActivated);
    if (d.contacts) L.push('Contacts collected: ' + d.contacts);
    if (d.cashDiffUsd != null || d.stockDiff != null) {
      L.push('', 'Closing check: cash ' + (d.cashDiffUsd === 0 && !d.cashDiffLbp ? 'OK' : 'off by ' + S.money(d.cashDiffUsd || 0) + ' / ' + S.num(d.cashDiffLbp || 0) + ' LBP') +
        (d.stockDiff != null ? ' · stock ' + (d.stockDiff === 0 ? 'OK' : 'off by ' + d.stockDiff) : ''));
    }
    if (d.refills.length) { L.push('', 'Refill requests:'); d.refills.forEach(function (r) { L.push('• ' + (r.lines.map(function (l) { return l.qty + '× ' + l.name; }).join(', ') || '') + (r.note ? ' (' + r.note + ')' : '')); }); }
    if (d.notes) L.push('', 'Notes: ' + d.notes);
    return L.join('\n');
  }

  var logoImg = null;
  function loadLogo() {
    if (logoImg) return Promise.resolve(logoImg);
    return new Promise(function (res) {
      var im = new Image();
      im.onload = function () { logoImg = im; res(im); };
      im.onerror = function () { res(null); };
      im.src = 'assets/logo-white.png';
    });
  }

  function drawSummary(d) {
    return loadLogo().then(function (logo) {
      var W = 1080, pad = 64;
      var c = document.createElement('canvas');
      var x = c.getContext('2d');
      var rows = [];
      // measure height first
      var extra = (d.products.length ? 60 + d.products.length * 52 : 0) + (d.refills.length ? 60 + d.refills.length * 48 : 0) + (d.notes ? 140 : 0) +
        (d.cashDiffUsd != null || d.stockDiff != null ? 90 : 0);
      c.width = W; c.height = 760 + extra;
      x.fillStyle = '#f7f2ec'; x.fillRect(0, 0, W, c.height);
      x.fillStyle = '#231F20'; x.fillRect(0, 0, W, 210);
      if (logo) { var h = 76, w = logo.width * h / logo.height; x.drawImage(logo, pad, 40, w, h); }
      x.fillStyle = '#EB5C24'; x.fillRect(0, 206, W, 8);
      x.fillStyle = '#fff'; x.font = '600 40px -apple-system, Segoe UI, Roboto, Arial, sans-serif';
      x.fillText(fit(x, d.event, W - 2 * pad), pad, 172);
      x.fillStyle = '#c9c3bd'; x.font = '28px -apple-system, Segoe UI, Roboto, Arial, sans-serif';
      var sub = (d.day ? 'Day ' + d.day + ' · ' : '') + niceDate(d.date) + (d.status === 'Open' ? ' · still open' : '');
      x.textAlign = 'right'; x.fillText(sub, W - pad, 80); x.textAlign = 'left';
      var y = 270;
      var box = function (bx, by, bw, label, value, sub2, color) {
        x.fillStyle = '#fff'; roundRect(x, bx, by, bw, 150, 22); x.fill();
        x.fillStyle = '#7a736d'; x.font = '26px -apple-system, Segoe UI, Roboto, Arial, sans-serif'; x.fillText(label, bx + 28, by + 46);
        x.fillStyle = color || '#231F20'; x.font = '700 52px -apple-system, Segoe UI, Roboto, Arial, sans-serif'; x.fillText(value, bx + 28, by + 106);
        if (sub2) { x.fillStyle = '#7a736d'; x.font = '24px -apple-system, Segoe UI, Roboto, Arial, sans-serif'; x.fillText(sub2, bx + 28, by + 138); }
      };
      var bw = (W - 2 * pad - 24) / 2;
      var hit = d.targetSales ? (d.sales >= d.targetSales ? '✓ target ' + S.money(d.targetSales) : 'target ' + S.money(d.targetSales)) : '';
      box(pad, y, bw, 'Sales', S.money(d.sales), hit, '#EB5C24');
      box(pad + bw + 24, y, bw, 'Units sold', String(d.units), d.tickets + (d.tickets === 1 ? ' sale' : ' sales') + ' · avg ' + S.money(d.avgTicket));
      y += 174;
      box(pad, y, bw, 'Cash · Online', S.money(d.cash), S.money(d.online) + ' online' + (d.returns ? ' · returns ' + S.money(d.returns) : ''));
      box(pad + bw + 24, y, bw, 'Demo plays', String(d.demoPlays), d.customersActivated + ' customers activated' + (d.contacts ? ' · ' + d.contacts + ' contacts' : ''));
      y += 200;
      var head = function (t) { y += 10; x.fillStyle = '#EB5C24'; x.font = '600 30px -apple-system, Segoe UI, Roboto, Arial, sans-serif'; x.fillText(t, pad, y); y += 46; };
      var line = function (t, color) { x.fillStyle = color || '#231F20'; x.font = '30px -apple-system, Segoe UI, Roboto, Arial, sans-serif'; x.fillText(fit(x, t, W - 2 * pad), pad, y); y += 48; };
      if (d.products.length) { head('Top games'); d.products.forEach(function (p) { line(p.units + '×  ' + p.name); }); y += 14; }
      if (d.cashDiffUsd != null || d.stockDiff != null) {
        head('Closing check');
        var cashOk = d.cashDiffUsd === 0 && !d.cashDiffLbp;
        line('Cash ' + (cashOk ? '✓ correct' : 'off by ' + S.money(d.cashDiffUsd || 0) + ' / ' + S.num(d.cashDiffLbp || 0) + ' LBP') +
          (d.stockDiff != null ? '   ·   Stock ' + (d.stockDiff === 0 ? '✓ correct' : 'off by ' + d.stockDiff) : ''), cashOk && !d.stockDiff ? '#1f7a3a' : '#b42318');
      }
      if (d.refills.length) { head('Refill requests'); d.refills.forEach(function (r) { line(r.lines.map(function (l) { return l.qty + '× ' + l.name; }).join(', ') + (r.note ? ' (' + r.note + ')' : '')); }); }
      if (d.notes) { head('Notes'); wrap(x, d.notes, W - 2 * pad, 3).forEach(function (t) { line(t, '#4a4440'); }); }
      x.fillStyle = '#9a938d'; x.font = '22px -apple-system, Segoe UI, Roboto, Arial, sans-serif';
      x.fillText('SHN LEB Events', pad, c.height - 34);
      // crop to content
      var outH = Math.min(c.height, Math.max(y + 40, 700));
      var o = document.createElement('canvas'); o.width = W; o.height = outH;
      var ox = o.getContext('2d'); ox.drawImage(c, 0, 0);
      ox.fillStyle = '#f7f2ec'; ox.fillRect(0, outH - 70, W, 70);
      ox.fillStyle = '#9a938d'; ox.font = '22px -apple-system, Segoe UI, Roboto, Arial, sans-serif'; ox.fillText('SHN LEB Events', pad, outH - 30);
      return new Promise(function (res) { o.toBlob(function (b) { res(b); }, 'image/png'); });
    });
  }
  function niceDate(iso) {
    var p = String(iso || '').split('-');
    if (p.length !== 3) return String(iso || '');
    var dt = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getDay()] + ' ' + dt.getDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][dt.getMonth()] + ' ' + p[0];
  }
  function roundRect(x, a, b, w, h, r) { x.beginPath(); x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r); x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath(); }
  function fit(x, t, w) { t = String(t); if (x.measureText(t).width <= w) return t; while (t.length > 3 && x.measureText(t + '…').width > w) t = t.slice(0, -1); return t + '…'; }
  function wrap(x, t, w, maxLines) {
    var words = String(t).split(/\s+/), out = [], cur = '';
    words.forEach(function (wd) { var n = cur ? cur + ' ' + wd : wd; if (x.measureText(n).width > w && cur) { out.push(cur); cur = wd; } else cur = n; });
    if (cur) out.push(cur);
    if (out.length > maxLines) { out = out.slice(0, maxLines); out[maxLines - 1] += '…'; }
    return out;
  }
  function showSummaryImage(blob, name, text) {
    var url = blob ? URL.createObjectURL(blob) : '';
    var m = modal('<div class="pay-head"><h2>Day summary</h2><button class="link-btn" data-close>Close</button></div>' +
      (url ? '<img class="summary-img" src="' + url + '" alt="Day summary">' : '') +
      '<div class="dialog-actions">' + (url ? '<a class="btn btn-ghost" href="' + url + '" download="' + S.esc(name) + '">Save picture</a>' : '') +
      '<a class="btn btn-accent" href="https://wa.me/?text=' + encodeURIComponent(text) + '" target="_blank" rel="noopener">Send as text on WhatsApp</a></div>');
    return m;
  }

  /* a number field that already has a value: tapping it selects the whole value */
  document.addEventListener('focusin', function (e) {
    var t = e.target;
    if (!t || t.tagName !== 'INPUT' || !/^(numeric|decimal)$/.test(t.getAttribute('inputmode') || '') || !t.value) return;
    setTimeout(function () { try { t.select(); } catch (x) { /* some inputs refuse */ } }, 0);
  });

  /* ---------------- recent sales */
  function openRecent(pos) {
    var q = queue(pos);
    var failed = q.filter(function (x) { return x.error; });
    var waiting = q.filter(function (x) { return (x.type === 'sale' || x.type === 'return') && !x.error; });
    var sales = pos.data.recentSales || [];
    function itemsHtml(lines) {
      return '<div class="sr-items">' + lines.map(function (l) { return '<div>' + Math.abs(l.qty) + '× ' + S.esc(l.name) + '</div>'; }).join('') + '</div>';
    }
    function row(s, extra) {
      var isReturn = !!s.returnOf || s.kind === 'return';
      var head = isReturn
        ? '<b>Return · ' + S.money(s.total) + '</b> · ' + (s.method === 'Online' ? 'refunded online' : 'cash back' +
          (s.changeUsd || s.changeLbp ? ' ' + [s.changeUsd ? '$' + S.num(s.changeUsd) : '', s.changeLbp ? lbp(s.changeLbp) : ''].filter(Boolean).join(' + ') : ''))
        : '<b>' + S.money(s.total) + '</b> · ' + S.esc(s.method || '') + ' · ' + S.esc(s.seller || '');
      var units = 0, back = 0;
      if (!isReturn) {
        (s.lines || []).forEach(function (l) { units += l.qty; });
        Object.keys(s.returned || {}).forEach(function (r) { back += s.returned[r]; });
      }
      return '<div class="sale-row' + (s.void ? ' voided' : '') + (isReturn ? ' is-return' : '') + '"><div class="sr-main">' + head +
        '<div class="small muted">' + S.esc((s.date || '') + ' ' + (s.time || '')) + '</div>' + itemsHtml(s.lines || []) +
        (back ? '<div class="small tag-ret">' + back + ' of ' + units + ' item' + (units === 1 ? '' : 's') + ' returned</div>' : '') +
        (s.void ? '<div class="small neg">Cancelled: ' + S.esc(s.voidReason) + '</div>' : '') + '</div>' + (extra || '') + '</div>';
    }
    function pendingRow(x) {
      if (x.type === 'return') {
        var r = x.ret;
        return { kind: 'return', total: r.total, method: r.method, changeUsd: r.refundUsd, changeLbp: r.refundLbp, time: new Date(r.clientTime).toTimeString().slice(0, 5),
          lines: r.lines.map(function (l) { var p = product(pos, l.ref); return { qty: -l.qty, name: p ? p.name : l.ref }; }) };
      }
      var s = x.sale;
      return { total: s.total, method: s.method, seller: s.seller, time: new Date(s.clientTime).toTimeString().slice(0, 5),
        lines: s.lines.map(function (l) { var p = product(pos, l.ref); return { qty: l.qty, name: p ? p.name : l.ref }; }) };
    }
    var m = modal(
      '<div class="pay-head"><h2>Recent sales</h2><button class="link-btn" data-close>Close</button></div>' +
      (failed.length ? '<h3 class="rs-title neg">Not saved</h3>' + failed.map(function (x) {
        var label = { clock: 'Clock ' + x.direction, count: 'Stock count', cash: x.cash && x.cash.kind === 'handover' ? 'Handover' : x.cash && x.cash.kind === 'cashin' ? 'Cash added' : 'Cash count', day: 'Day ' + (x.day && x.day.action),
          customer: 'Customer contact', refill: 'Refill request', demo: 'Demo counter' }[x.type];
        return row(label ? { total: 0, method: label, seller: x.name || (x.count && x.count.countedBy) || (x.cash && x.cash.by) || (x.day && x.day.by) || (x.customer && x.customer.name) || (x.refill && x.refill.by) || (x.demo && x.demo.by) || '', lines: [] } : pendingRow(x),
          '<div><div class="small neg">' + S.esc(x.error) + '</div><button class="btn btn-ghost btn-sm" data-discard="' + S.esc(x.qid) + '">Discard</button></div>');
      }).join('') : '') +
      (waiting.length ? '<h3 class="rs-title">Waiting to send</h3>' + waiting.map(function (x) { return row(pendingRow(x)); }).join('') : '') +
      '<h3 class="rs-title">Saved</h3>' +
      (sales.length ? sales.map(function (s) {
        if (s.returnOf || s.void) return row(s);
        var left = remainingToReturn(pos, s);
        var any = Object.keys(left).some(function (r) { return left[r] > 0; });
        return row(s, any ? '<button class="btn btn-ghost btn-sm" data-return="' + S.esc(s.id) + '">Return</button>' : '');
      }).join('') : '<p class="muted">No sales yet.</p>'));
    Array.prototype.forEach.call(m.el.querySelectorAll('[data-discard]'), function (b) {
      b.onclick = function () {
        if (!window.confirm('Discard this entry? It will not be recorded.')) return;
        setQueue(pos, queue(pos).filter(function (x) { return x.qid !== b.getAttribute('data-discard'); }));
        m.close(); render(pos);
      };
    });
    Array.prototype.forEach.call(m.el.querySelectorAll('[data-return]'), function (b) {
      b.onclick = function () {
        var s = sales.filter(function (x) { return x.id === b.getAttribute('data-return'); })[0];
        m.close();
        if (s) openReturn(pos, s);
      };
    });
  }

  window.SHN_POS = { staff: staff, mount: mount, unmount: unmount, shareSummary: shareSummary };
})();
