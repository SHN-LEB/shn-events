/* SHN LEB Events — web app: admin side, router, shared helpers (POS lives in pos.js) */
(function () {
  'use strict';

  var APP_VERSION = '1.7.0';
  var API_URL = (window.SHN_CONFIG && window.SHN_CONFIG.API_URL) || '';
  var TOKEN_KEY = 'shn-events-admin';
  var TABS = [
    { id: 'settings', label: 'Settings' },
    { id: 'inventory', label: 'Inventory' },
    { id: 'pos', label: 'POS' },
    { id: 'cash', label: 'Cash' },
    { id: 'shifts', label: 'Shifts & pay' },
    { id: 'days', label: 'Days' },
    { id: 'expenses', label: 'Expenses' },
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'pnl', label: 'P&L' }
  ];
  var TAB_HINT = {
    inventory: 'Opening stock from the SHN Catalogue, demo units, refills and returns, external products and daily counts.',
    pos: 'Product list with pictures and search, seller buttons, discounts, USD/LBP payment and change, online and split payments.',
    cash: 'Drawer balance in USD and LBP, handovers and cash counts.',
    shifts: 'Clock in and out, hours and commissions per employee.',
    expenses: 'Rent, transport, bags, marketing and other event costs.',
    dashboard: 'Sales by day, category, game, seller and payment type, against daily targets.',
    pnl: 'Sales, COGS, staff cost, expenses, external products settlement and net profit.'
  };

  var app = document.getElementById('app');
  var topbarRight = document.getElementById('topbarRight');
  var state = { events: null, filter: 'all', event: null, inv: null, invQuery: '', invCat: '' };

  /* ---------------- storage (wrapped: some browsers block it) */
  function getToken() {
    try {
      var raw = localStorage.getItem(TOKEN_KEY);
      if (!raw) return null;
      var t = JSON.parse(raw);
      if (!t || !t.token || t.expires < Date.now()) return null;
      return t.token;
    } catch (e) { return memToken; }
  }
  var memToken = null;
  function setToken(token, expires) {
    memToken = token;
    try {
      if (token) localStorage.setItem(TOKEN_KEY, JSON.stringify({ token: token, expires: expires }));
      else localStorage.removeItem(TOKEN_KEY);
    } catch (e) { /* in-memory only */ }
  }

  /* ---------------- api */
  /* opts.token: send this token instead of the admin one; opts.quiet: don't redirect on auth errors */
  function api(action, data, opts) {
    opts = opts || {};
    var body = Object.assign({ action: action, token: opts.token || getToken() }, data || {});
    return fetch(API_URL, { method: 'POST', body: JSON.stringify(body), redirect: 'follow' })
      .then(function (r) {
        if (!r.ok) { var e = new Error('The server did not answer (' + r.status + ').'); e.offline = true; throw e; }
        return r.json();
      }, function () {
        var e = new Error('No connection. Check the internet and try again.');
        e.offline = true;
        throw e;
      })
      .then(function (res) {
        if (!res.ok) {
          if (res.code === 'auth' && !opts.token && !opts.quiet) { setToken(null); go('#/login'); }
          var err = new Error(res.error || 'Something went wrong.');
          err.code = res.code;
          if (res.detail) err.detail = res.detail;
          throw err;
        }
        return res;
      });
  }

  /* ---------------- helpers */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function parseDay(iso) {
    var p = String(iso || '').split('-');
    if (p.length !== 3) return null;
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }
  function fmtDay(iso, withYear) {
    var d = parseDay(iso);
    if (!d || isNaN(d)) return '';
    return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + (withYear ? ' ' + d.getFullYear() : '');
  }
  function fmtRange(a, b) {
    if (a === b) return fmtDay(a, true);
    var da = parseDay(a), db = parseDay(b);
    var sameYear = da && db && da.getFullYear() === db.getFullYear();
    return fmtDay(a, !sameYear) + ' – ' + fmtDay(b, true);
  }
  function todayIso() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function phase(ev) {
    if (ev.status === 'Closed') return { key: 'closed', label: 'Closed' };
    var t = todayIso();
    if (t < ev.startDate) return { key: 'upcoming', label: 'Upcoming' };
    if (t > ev.endDate) return { key: 'ended', label: 'Ended' };
    return { key: 'live', label: 'Live' };
  }
  function num(n) { return Number(n || 0).toLocaleString('en-US'); }
  function money(n) { n = Number(n || 0); return '$' + n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }); }

  var toastTimer;
  function toast(msg, bad) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast' + (bad ? ' bad' : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 3200);
  }
  function loading(text) {
    app.innerHTML = '<div class="loading"><div class="spinner"></div><div>' + esc(text || 'Loading…') + '</div></div>';
  }
  function go(hash) {
    if (location.hash === hash) render(); else location.hash = hash;
  }

  function setTopbar() {
    topbarRight.innerHTML = getToken()
      ? '<button class="link-btn" id="signOut">Sign out</button>'
      : '';
    var b = document.getElementById('signOut');
    if (b) b.onclick = function () { setToken(null); state.events = null; go('#/login'); };
  }

  /* ---------------- views */
  function viewNotConfigured() {
    app.innerHTML =
      '<div class="login-wrap"><div class="card login-card">' +
      '<h1>Almost there</h1>' +
      '<p class="muted">The app is not connected to the back office yet. Paste the Apps Script web app URL into <code>config.js</code>.</p>' +
      '</div></div>';
  }

  function viewLogin() {
    app.innerHTML =
      '<div class="login-wrap"><form class="card login-card" id="loginForm" autocomplete="on">' +
      '<img class="login-logo" src="assets/logo-dark.png" alt="Superheated Neurons">' +
      '<h1>Management sign in</h1>' +
      '<p class="muted">SHN LEB Events: create and manage events.</p>' +
      '<div id="loginError"></div>' +
      '<div class="field"><label for="pw">Password</label>' +
      '<input class="input" id="pw" type="password" autocomplete="current-password" required autofocus></div>' +
      '<button class="btn btn-primary btn-block" id="loginBtn" type="submit">Sign in</button>' +
      '</form></div>';
    document.getElementById('loginForm').onsubmit = function (e) {
      e.preventDefault();
      var btn = document.getElementById('loginBtn');
      btn.disabled = true; btn.textContent = 'Signing in…';
      api('adminLogin', { password: document.getElementById('pw').value })
        .then(function (res) {
          setToken(res.token, res.expires);
          go('#/');
        })
        .catch(function (err) {
          document.getElementById('loginError').innerHTML = '<div class="form-error">' + esc(err.message) + '</div>';
          btn.disabled = false; btn.textContent = 'Sign in';
        });
    };
  }

  function viewHome() {
    if (!state.events) {
      loading('Loading events…');
      api('listEvents').then(function (res) {
        state.events = res.events || [];
        viewHome();
      }).catch(function (err) { showError(err); });
      return;
    }
    var events = state.events.slice().sort(function (a, b) {
      var order = { live: 0, upcoming: 1, ended: 2, closed: 3 };
      var pa = order[phase(a).key], pb = order[phase(b).key];
      if (pa !== pb) return pa - pb;
      return pa <= 1 ? (a.startDate < b.startDate ? -1 : 1) : (a.startDate > b.startDate ? -1 : 1);
    });
    var counts = { all: events.length, live: 0, upcoming: 0, past: 0 };
    events.forEach(function (e) {
      var k = phase(e).key;
      if (k === 'live') counts.live++; else if (k === 'upcoming') counts.upcoming++; else counts.past++;
    });
    var shown = events.filter(function (e) {
      var k = phase(e).key;
      if (state.filter === 'all') return true;
      if (state.filter === 'past') return k === 'ended' || k === 'closed';
      return k === state.filter;
    });
    var chips = [['all', 'All'], ['live', 'Live'], ['upcoming', 'Upcoming'], ['past', 'Past']].map(function (c) {
      return '<button class="chip' + (state.filter === c[0] ? ' active' : '') + '" data-filter="' + c[0] + '">' +
        c[1] + '<span class="count">' + counts[c[0]] + '</span></button>';
    }).join('');

    var body;
    if (!events.length) {
      body = '<div class="card empty"><h2>No events yet</h2><p class="muted">Create your first event to get its own Google Sheet, PIN and staff link.</p>' +
        '<button class="btn btn-accent" data-new>+ New event</button></div>';
    } else if (!shown.length) {
      body = '<div class="card empty"><p class="muted">No events here.</p></div>';
    } else {
      body = '<div class="grid">' + shown.map(cardHtml).join('') + '</div>';
    }

    app.innerHTML =
      '<div class="page-head"><h1>Events</h1><button class="btn btn-accent" data-new>+ New event</button></div>' +
      (events.length ? '<div class="chips">' + chips + '</div>' : '') + body;

    Array.prototype.forEach.call(app.querySelectorAll('[data-filter]'), function (b) {
      b.onclick = function () { state.filter = b.getAttribute('data-filter'); viewHome(); };
    });
    Array.prototype.forEach.call(app.querySelectorAll('[data-new]'), function (b) { b.onclick = openNewEvent; });
  }

  function cardHtml(ev) {
    var p = phase(ev);
    return '<a class="card event-card" href="#/event/' + encodeURIComponent(ev.id) + '/settings">' +
      '<div class="event-card-top"><h3>' + esc(ev.name) + '</h3><span class="pill pill-' + p.key + '">' + p.label + '</span></div>' +
      '<div class="event-meta">' +
      '<div>' + esc(fmtRange(ev.startDate, ev.endDate)) + '</div>' +
      (ev.venue ? '<div>' + esc(ev.venue) + '</div>' : '') +
      '</div>' +
      '<div><span class="tag">' + esc(ev.type) + '</span></div>' +
      '</a>';
  }

  function openNewEvent() {
    var t = todayIso();
    var wrap = document.createElement('div');
    wrap.className = 'dialog-backdrop';
    wrap.innerHTML =
      '<form class="card dialog" id="newForm" role="dialog" aria-modal="true" aria-labelledby="newTitle">' +
      '<h2 id="newTitle">New event</h2>' +
      '<div id="newError"></div>' +
      '<div class="field"><label for="evName">Event name</label><input class="input" id="evName" required maxlength="80" placeholder="e.g. Sassine Christmas Market 2026"></div>' +
      '<div class="row-2">' +
      '<div class="field"><label for="evType">Type</label><select class="input" id="evType"><option>Sales</option><option>Awareness</option></select></div>' +
      '<div class="field"><label for="evVenue">Venue</label><input class="input" id="evVenue" maxlength="80" placeholder="e.g. Sassine Square"></div>' +
      '</div>' +
      '<div class="row-2">' +
      '<div class="field"><label for="evStart">Start date</label><input class="input" id="evStart" type="date" required value="' + t + '"></div>' +
      '<div class="field"><label for="evEnd">End date</label><input class="input" id="evEnd" type="date" required value="' + t + '"></div>' +
      '</div>' +
      '<p class="muted small">Creates the event and its own Google Sheet with a new 4-digit PIN. Takes about 10 seconds.</p>' +
      '<div class="dialog-actions"><button type="button" class="btn btn-ghost" id="newCancel">Cancel</button>' +
      '<button type="submit" class="btn btn-primary" id="newSubmit">Create event</button></div>' +
      '</form>';
    document.body.appendChild(wrap);
    var close = function () { wrap.remove(); };
    document.getElementById('newCancel').onclick = close;
    wrap.addEventListener('click', function (e) { if (e.target === wrap) close(); });
    document.getElementById('evStart').onchange = function () {
      var end = document.getElementById('evEnd');
      if (end.value < this.value) end.value = this.value;
    };
    setTimeout(function () { document.getElementById('evName').focus(); }, 30);

    document.getElementById('newForm').onsubmit = function (e) {
      e.preventDefault();
      var data = {
        name: document.getElementById('evName').value.trim(),
        type: document.getElementById('evType').value,
        venue: document.getElementById('evVenue').value.trim(),
        startDate: document.getElementById('evStart').value,
        endDate: document.getElementById('evEnd').value
      };
      var errBox = document.getElementById('newError');
      if (data.endDate < data.startDate) {
        errBox.innerHTML = '<div class="form-error">The end date is before the start date.</div>';
        return;
      }
      var btn = document.getElementById('newSubmit');
      btn.disabled = true; btn.textContent = 'Creating…';
      api('createEvent', data).then(function (res) {
        close();
        if (state.events) state.events.push(res.event);
        state.event = null;
        toast('Event created with its Google Sheet.');
        go('#/event/' + encodeURIComponent(res.event.id) + '/settings');
      }).catch(function (err) {
        errBox.innerHTML = '<div class="form-error">' + esc(err.message) + '</div>';
        btn.disabled = false; btn.textContent = 'Create event';
      });
    };
  }

  function viewEvent(id, tab) {
    if (!state.event || state.event.id !== id) {
      state.inv = null;
      state.report = null;
      state.pnl = null;
      loading('Opening event…');
      api('getEvent', { id: id }).then(function (res) {
        state.event = res.event;
        viewEvent(id, tab);
      }).catch(function (err) { showError(err, true); });
      return;
    }
    var ev = state.event;
    var p = phase(ev);
    var tabs = TABS.map(function (t) {
      return '<a class="tab' + (t.id === tab ? ' active' : '') + '" href="#/event/' + encodeURIComponent(ev.id) + '/' + t.id + '">' + esc(t.label) + '</a>';
    }).join('');

    app.innerHTML =
      '<a class="back" href="#/">‹ All events</a>' +
      '<div class="event-head"><div>' +
      '<h1>' + esc(ev.name) + '</h1>' +
      '<div class="event-sub"><span class="pill pill-' + p.key + '">' + p.label + '</span>' +
      '<span>' + esc(fmtRange(ev.startDate, ev.endDate)) + '</span>' +
      (ev.venue ? '<span>' + esc(ev.venue) + '</span>' : '') +
      '<span class="tag">' + esc(ev.type) + '</span></div>' +
      '</div><div class="event-actions">' +
      '<a class="btn btn-ghost" href="' + esc(ev.sheetUrl) + '" target="_blank" rel="noopener">Open Google Sheet</a>' +
      (ev.status === 'Closed'
        ? '<button class="btn btn-ghost" id="statusBtn">Reopen event</button>'
        : '<button class="btn btn-danger" id="statusBtn">Close event</button>') +
      '</div></div>' +
      '<nav class="tabs" aria-label="Event sections">' + tabs + '</nav>' +
      '<section id="tabBody"></section>';

    document.getElementById('statusBtn').onclick = function () {
      var closing = ev.status !== 'Closed';
      if (closing && !confirmClose()) return;
      var btn = this; btn.disabled = true;
      api('setEventStatus', { id: ev.id, status: closing ? 'Closed' : 'Open' }).then(function (res) {
        ev.status = res.event.status;
        if (state.events) state.events.forEach(function (e) { if (e.id === ev.id) e.status = ev.status; });
        toast(closing ? 'Event closed. The PIN no longer works.' : 'Event reopened.');
        viewEvent(id, tab);
      }).catch(function (err) { btn.disabled = false; toast(err.message, true); });
    };

    var body = document.getElementById('tabBody');
    if (tab === 'settings') body.innerHTML = settingsHtml(ev);
    else if (tab === 'inventory') viewInventory(body, ev);
    else if (tab === 'pos') window.SHN_POS.mount(body, { eventId: ev.id, token: getToken(), admin: true });
    else if (tab === 'cash' || tab === 'shifts' || tab === 'days') viewReport(body, ev, tab);
    else if (tab === 'expenses' || tab === 'dashboard' || tab === 'pnl') viewPnl(body, ev, tab);
    else {
      var def = TABS.filter(function (t) { return t.id === tab; })[0] || TABS[0];
      body.innerHTML = '<div class="card placeholder"><h2>' + esc(def.label) + '</h2>' +
        '<p class="muted">' + esc(TAB_HINT[def.id] || '') + '</p>' +
        '<p class="small muted">Coming in phase ' + def.phase + '.</p></div>';
    }
    var copy = document.getElementById('copyLink');
    if (copy) copy.onclick = function () {
      var text = document.getElementById('staffLink').textContent;
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
        .then(function () { toast('Staff link copied.'); }, function () { toast('Select the link and copy it.'); });
    };
  }

  function confirmClose() {
    return window.confirm('Close this event? Staff will no longer be able to use its PIN. You can reopen it later.');
  }

  function staffLink(ev) {
    var base = location.origin + location.pathname.replace(/index\.html$/, '');
    return base + '?e=' + encodeURIComponent(ev.id);
  }

  function settingsHtml(ev) {
    var s = ev.settings || {};
    function item(k, v, isEmpty) {
      return '<div class="card kv-item"><div class="k">' + esc(k) + '</div><div class="v' + (isEmpty ? ' empty-v' : '') + '">' + v + '</div></div>';
    }
    return '' +
      '<div class="note">These values live in the <b>Settings</b> tab of the event\'s Google Sheet. Edit them there, then reload this page.</div>' +
      '<h2 class="section-title">Event</h2>' +
      '<div class="kv">' +
      item('Dates', esc(fmtRange(ev.startDate, ev.endDate))) +
      item('Opening hours', s.openingHours ? esc(s.openingHours) : 'Not set', !s.openingHours) +
      item('Exchange rate', s.fxRate ? num(s.fxRate) + ' LBP / $' : 'Not set', !s.fxRate) +
      item('Max discount', num(s.maxDiscountPct) + '%') +
      '</div>' +
      '<h2 class="section-title">Opening cash</h2>' +
      '<div class="kv">' +
      item('USD', money(s.openingCashUsd)) +
      item('LBP', num(s.openingCashLbp) + ' LBP') +
      '</div>' +
      '<h2 class="section-title">Daily targets</h2>' +
      '<div class="kv">' +
      item('Units per day', s.dailyTargetQty == null ? 'Not set' : num(s.dailyTargetQty), s.dailyTargetQty == null) +
      item('Sales per day', s.dailyTargetSales == null ? 'Not set' : money(s.dailyTargetSales), s.dailyTargetSales == null) +
      '</div>' +
      '<h2 class="section-title">Staff</h2>' + staffHtml(ev.staff || []) +
      '<h2 class="section-title">Staff access</h2>' +
      '<div class="kv">' + item('PIN', esc(s.pin || '—')) + '</div>' +
      '<div class="card card-pad" style="margin-top:12px">' +
      '<div class="small muted" style="margin-bottom:8px">Staff link (the POS opens here from phase 3)</div>' +
      '<div class="share"><code id="staffLink">' + esc(staffLink(ev)) + '</code>' +
      '<button class="btn btn-ghost" id="copyLink">Copy</button></div></div>';
  }

  function staffHtml(staff) {
    if (!staff.length) {
      return '<div class="card card-pad muted">No staff yet. Add each employee in the event\'s Google Sheet: <b>Settings</b> tab, staff columns E–J, with their hourly rate and commission tiers.</div>';
    }
    return '<div class="card table-wrap"><table class="tbl"><thead><tr><th>Name</th><th class="num">Hourly rate</th>' +
      '<th class="num">Commission under threshold</th><th class="num">Threshold</th><th class="num">Commission at/over</th><th>Status</th></tr></thead><tbody>' +
      staff.map(function (p) {
        return '<tr><td><b>' + esc(p.name) + '</b></td><td class="num">' + money(p.hourlyRate) + '/h</td>' +
          '<td class="num">' + money(p.commissionUnder) + '</td><td class="num">' + money(p.threshold) + '</td>' +
          '<td class="num">' + money(p.commissionOver) + '</td><td>' + (p.active ? '<span class="pill pill-live">Active</span>' : '<span class="pill pill-closed">Inactive</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  /* ---------------- inventory */
  function viewInventory(body, ev) {
    if (!state.inv || state.inv.id !== ev.id) {
      body.innerHTML = '<div class="loading"><div class="spinner"></div><div>Loading stock…</div></div>';
      api('getInventory', { id: ev.id }).then(function (res) {
        state.inv = { id: ev.id, data: res.inventory };
        if (document.getElementById('tabBody') === body) viewInventory(body, ev);
      }).catch(function (err) {
        body.innerHTML = '<div class="card empty"><h2>Couldn\'t load stock</h2><p class="muted">' + esc(err.message) + '</p>' +
          '<button class="btn btn-primary" id="invRetry">Try again</button></div>';
        document.getElementById('invRetry').onclick = function () { viewInventory(body, ev); };
      });
      return;
    }
    var data = state.inv.data;
    var items = data.items;
    if (!items.length) {
      body.innerHTML = warningsHtml(data.warnings) +
        '<div class="card empty"><h2>No products yet</h2>' +
        '<p class="muted">In the event\'s Google Sheet, open the <b>Listing</b> tab. Pick or paste product names in the <b>Product</b> column, ' +
        'then type the <b>Opening Qty</b> and <b>Demo Qty</b>. Ref Code, category and price fill in by themselves.</p>' +
        '<p class="muted">External products go in columns I–R of the same tab.</p>' +
        '<a class="btn btn-primary" href="' + esc(ev.sheetUrl) + '" target="_blank" rel="noopener">Open Google Sheet</a> ' +
        '<button class="btn btn-ghost" id="invRefresh">Refresh</button></div>';
      document.getElementById('invRefresh').onclick = function () { state.inv = null; viewInventory(body, ev); };
      return;
    }
    var cats = [];
    items.forEach(function (i) { if (cats.indexOf(i.category) < 0) cats.push(i.category); });
    cats.sort();
    var sum = function (f) { return items.reduce(function (a, i) { return a + f(i); }, 0); };
    var stats = [
      ['Products', num(items.length)],
      ['Opening units', num(sum(function (i) { return i.opening; }))],
      ['Refills / returns', signed(sum(function (i) { return i.moves; }))],
      ['Sold', num(sum(function (i) { return i.sold; }))],
      ['In stock', num(sum(function (i) { return i.live; }))],
      ['Demo units', num(sum(function (i) { return i.demo; }))]
    ];
    body.innerHTML =
      '<div class="stats">' + stats.map(function (s) {
        return '<div class="card stat"><div class="k">' + s[0] + '</div><div class="v">' + s[1] + '</div></div>';
      }).join('') + '</div>' +
      warningsHtml(data.warnings) +
      '<div class="toolbar">' +
      '<input class="input search" id="invSearch" type="search" placeholder="Search product or ref code" value="' + esc(state.invQuery) + '">' +
      '<select class="input" id="invCat"><option value="">All categories</option>' +
      cats.map(function (c) { return '<option' + (c === state.invCat ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') +
      '</select>' +
      '<button class="btn btn-ghost" id="invRefresh">Refresh</button></div>' +
      '<div id="invList"></div>' +
      '<p class="small muted">Live stock = opening + refills/returns − sold. Demo units are counted separately and never sold. ' +
      'Edit quantities in the event\'s Google Sheet (Listing and Stock Moves tabs), then Refresh.</p>';
    document.getElementById('invRefresh').onclick = function () { state.inv = null; viewInventory(body, ev); };
    var search = document.getElementById('invSearch');
    search.oninput = function () { state.invQuery = search.value; drawInvList(items); };
    document.getElementById('invCat').onchange = function () { state.invCat = this.value; drawInvList(items); };
    drawInvList(items);
  }

  /* ---------------- management reports: cash, shifts & pay, days */
  function viewReport(body, ev, tab) {
    if (!state.report || state.report.id !== ev.id) {
      body.innerHTML = '<div class="loading"><div class="spinner"></div><div>Loading…</div></div>';
      api('eventReport', { id: ev.id }).then(function (res) {
        state.report = { id: ev.id, data: res.report };
        if (document.getElementById('tabBody') === body) viewReport(body, ev, tab);
      }).catch(function (err) {
        body.innerHTML = '<div class="card empty"><h2>Couldn\'t load</h2><p class="muted">' + esc(err.message) + '</p><button class="btn btn-primary" id="repRetry">Try again</button></div>';
        document.getElementById('repRetry').onclick = function () { viewReport(body, ev, tab); };
      });
      return;
    }
    var r = state.report.data;
    var refresh = '<div class="toolbar"><span></span><button class="btn btn-ghost" id="repRefresh">Refresh</button></div>';
    var lbpTxt = function (n) { return num(Math.round(n)) + ' LBP'; };
    var sgn = function (n, f) { n = Number(n) || 0; return n === 0 ? '<span class="good-t">0</span>' : '<span class="neg">' + (n > 0 ? '+' : '−') + f(Math.abs(n)) + '</span>'; };
    var html = '';
    if (tab === 'cash') {
      var c = r.cash;
      html = refresh +
        '<div class="stats stats-4">' +
        stat('Expected in drawer', money(c.expected.usd) + '<div class="sub">' + lbpTxt(c.expected.lbp) + '</div>') +
        stat('Opening cash', money(c.opening.usd) + '<div class="sub">' + lbpTxt(c.opening.lbp) + '</div>') +
        stat('Cash taken − given', money(c.received.usd - c.given.usd) + '<div class="sub">' + lbpTxt(c.received.lbp - c.given.lbp) + '</div>') +
        stat('Handed over', money(c.handedOver.usd) + '<div class="sub">' + lbpTxt(c.handedOver.lbp) + '</div>') +
        '</div><p class="small muted">Online payments so far: ' + money(c.online) + ' (never in the drawer).</p>' +
        '<h2 class="section-title">Cash counts</h2>' +
        (c.counts.length ? '<div class="card table-wrap"><table class="tbl"><thead><tr><th>When</th><th>Type</th><th>By</th><th class="num">Counted</th><th class="num">Expected</th><th class="num">Difference</th></tr></thead><tbody>' +
          c.counts.map(function (x) {
            return '<tr><td>' + esc(x.at) + '<div class="pref">Day ' + esc(x.day) + '</div></td><td>' + esc(x.purpose) + '</td><td>' + esc(x.by) + '</td>' +
              '<td class="num">' + money(x.usd) + '<div class="pref">' + lbpTxt(x.lbp) + '</div></td>' +
              '<td class="num">' + money(x.expUsd) + '<div class="pref">' + lbpTxt(x.expLbp) + '</div></td>' +
              '<td class="num">' + sgn(x.diffUsd, money) + '<div class="pref">' + sgn(x.diffLbp, function (v) { return num(v) + ' LBP'; }) + '</div></td></tr>';
          }).join('') + '</tbody></table></div>' : '<div class="card card-pad muted">No cash counts yet.</div>') +
        '<h2 class="section-title">Handovers</h2>' +
        (c.handovers.length ? '<div class="card table-wrap"><table class="tbl"><thead><tr><th>When</th><th>Collected by</th><th>From</th><th class="num">USD</th><th class="num">LBP</th><th>Note</th></tr></thead><tbody>' +
          c.handovers.map(function (h) {
            return '<tr><td>' + esc(h.at) + '</td><td><b>' + esc(h.to) + '</b></td><td>' + esc(h.by) + '</td><td class="num">' + money(h.usd) + '</td><td class="num">' + num(h.lbp) + '</td><td>' + esc(h.note) + '</td></tr>';
          }).join('') + '</tbody></table></div>' : '<div class="card card-pad muted">No handovers yet.</div>');
    }
    if (tab === 'shifts') {
      var people = {};
      r.pay.forEach(function (d) { var p = people[d.name] = people[d.name] || { hours: 0, cost: 0, comm: 0, pay: 0 }; p.hours += d.hours; p.cost += d.hoursCost; p.comm += d.commission; p.pay += d.pay; });
      html = refresh +
        '<h2 class="section-title" style="margin-top:0">Totals per person</h2>' +
        (Object.keys(people).length ? '<div class="card table-wrap"><table class="tbl"><thead><tr><th>Employee</th><th class="num">Hours</th><th class="num">Hours pay</th><th class="num">Commission</th><th class="num">Total pay</th></tr></thead><tbody>' +
          Object.keys(people).sort().map(function (n) {
            var p = people[n];
            return '<tr><td><b>' + esc(n) + '</b></td><td class="num">' + p.hours.toFixed(2) + '</td><td class="num">' + money(p.cost) + '</td><td class="num">' + money(p.comm) + '</td><td class="num"><b>' + money(p.pay) + '</b></td></tr>';
          }).join('') + '</tbody></table></div>' : '<div class="card card-pad muted">No shifts or sales yet.</div>') +
        '<h2 class="section-title">By day</h2>' +
        (r.pay.length ? '<div class="card table-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Employee</th><th>In – out</th><th class="num">Hours</th><th class="num">Units sold</th><th class="num">Commission</th><th class="num">Pay</th></tr></thead><tbody>' +
          r.pay.map(function (d) {
            return '<tr><td>' + esc(fmtDay(d.date, false)) + '</td><td><b>' + esc(d.name) + '</b>' +
              (d.open ? '<div><span class="pill pill-ended">Not clocked out</span></div>' : '') +
              (d.notes.length ? '<div class="small warn-text">' + esc(d.notes.join(' · ')) + '</div>' : '') + '</td>' +
              '<td>' + (d.shifts.map(function (x) { return esc(x.in) + ' – ' + esc(x.out || '…'); }).join('<br>') || '–') + '</td>' +
              '<td class="num">' + d.hours.toFixed(2) + '</td><td class="num">' + num(d.units) + '</td><td class="num">' + money(d.commission) + '</td><td class="num"><b>' + money(d.pay) + '</b></td></tr>';
          }).join('') + '</tbody></table></div>' : '') +
        '<p class="small muted">Pay = hours × hourly rate + commission (per item, on the price actually paid; returns are taken off). ' +
        'To fix a clock-in or out time, edit the Shifts tab of the event\'s Google Sheet, then Refresh.</p>';
    }
    if (tab === 'days') {
      var dv = function (v, f) { return v === '' || v == null ? '<span class="muted">–</span>' : sgn(v, f); };
      html = refresh + (r.days.length ? '<div class="card table-wrap"><table class="tbl"><thead><tr><th>Day</th><th>Opened / closed</th>' +
        '<th class="num">Cash at opening</th><th class="num">Cash at closing</th><th class="num">Cash change during day</th>' +
        '<th class="num">Stock at opening</th><th class="num">Stock at closing</th><th class="num">Stock change during day</th><th class="num">Demo missing</th><th class="num">Sales</th></tr></thead><tbody>' +
        r.days.map(function (d) {
          var usd = function (v) { return money(v); }, lb = function (v) { return num(v) + ' LBP'; }, u = function (v) { return num(v) + ' units'; };
          return '<tr><td><b>Day ' + esc(d.day) + '</b><div class="pref">' + esc(fmtDay(d.date, false)) + '</div>' + (d.status === 'Open' ? '<span class="pill pill-live">Open</span>' : '') + '</td>' +
            '<td class="small">' + esc(String(d.openedAt).slice(11)) + ' ' + esc(d.openedBy) + '<br>' + esc(String(d.closedAt).slice(11)) + ' ' + esc(d.closedBy) + '</td>' +
            '<td class="num">' + dv(d.openCashUsd, usd) + '<div class="pref">' + dv(d.openCashLbp, lb) + '</div></td>' +
            '<td class="num">' + dv(d.closeCashUsd, usd) + '<div class="pref">' + dv(d.closeCashLbp, lb) + '</div></td>' +
            '<td class="num"><b>' + dv(d.varUsd, usd) + '</b><div class="pref">' + dv(d.varLbp, lb) + '</div></td>' +
            '<td class="num">' + dv(d.openStock, u) + '</td><td class="num">' + dv(d.closeStock, u) + '</td><td class="num"><b>' + dv(d.varStock, u) + '</b></td>' +
            '<td class="num">' + (d.demoMissing === '' ? '–' : num(d.demoMissing)) + '</td>' +
            '<td class="num">' + (d.sales === '' ? '–' : money(d.sales)) + '<div class="pref">' + (d.units === '' ? '' : num(d.units) + ' units') + '</div></td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<p class="small muted">Differences compare counted with expected. "Change during day" is the difference that appeared between that day\'s opening and closing counts: a non-zero value points to the day a variance happened.</p>'
        : '<div class="card empty"><h2>No business days yet</h2><p class="muted">Staff start and close days from the home page of the staff link.</p></div>');
    }
    body.innerHTML = html;
    document.getElementById('repRefresh').onclick = function () { state.report = null; viewReport(body, ev, tab); };
  }
  /* ---------------- expenses, dashboard, P&L */
  function viewPnl(body, ev, tab) {
    if (!state.pnl || state.pnl.id !== ev.id) {
      body.innerHTML = '<div class="loading"><div class="spinner"></div><div>Working out the numbers…</div></div>';
      api('pnl', { id: ev.id, writeSheet: tab === 'pnl' }).then(function (res) {
        state.pnl = { id: ev.id, data: res.pnl };
        if (document.getElementById('tabBody') === body) viewPnl(body, ev, tab);
      }).catch(function (err) {
        body.innerHTML = '<div class="card empty"><h2>Couldn\'t load</h2><p class="muted">' + esc(err.message) + '</p><button class="btn btn-primary" id="pnlRetry">Try again</button></div>';
        document.getElementById('pnlRetry').onclick = function () { viewPnl(body, ev, tab); };
      });
      return;
    }
    var p = state.pnl.data, L = p.lines, d = p.dashboard;
    var refresh = '<div class="toolbar"><span></span><button class="btn btn-ghost" id="pnlRefresh">Refresh</button></div>';
    var html = '';
    if (tab === 'expenses') {
      var today = todayIso();
      html = '<form class="card card-pad exp-form" id="expForm">' +
        '<div class="exp-grid">' +
        '<div class="field"><label>Date</label><input class="input" type="date" id="exDate" value="' + today + '"></div>' +
        '<div class="field"><label>Type</label><select class="input" id="exType">' + p.expenseTypes.map(function (t) { return '<option>' + esc(t) + '</option>'; }).join('') + '</select></div>' +
        '<div class="field exp-desc"><label>Description</label><input class="input" id="exDesc" placeholder="e.g. Booth rent, taxi for stock"></div>' +
        '<div class="field"><label>Amount USD</label><input class="input" id="exUsd" inputmode="decimal" placeholder="0"></div>' +
        '<div class="field"><label>Amount LBP</label><input class="input" id="exLbp" inputmode="numeric" placeholder="0"></div>' +
        '</div><div id="exErr"></div><button class="btn btn-primary" id="exAdd" type="submit">Add expense</button>' +
        '<span class="small muted" style="margin-left:10px">LBP is converted at ' + num(p.fxRate) + ' LBP / $. Staff pay is added to the P&L automatically, don\'t enter it here.</span></form>' +
        '<div class="toolbar"><h2 class="section-title" style="margin:6px 0">Expenses · ' + money(L.expenses) + '</h2><button class="btn btn-ghost" id="pnlRefresh">Refresh</button></div>' +
        (p.expenses.length ? '<div class="card table-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Type</th><th>Description</th><th class="num">USD</th><th class="num">LBP</th><th class="num">Total USD</th><th></th></tr></thead><tbody>' +
          p.expenses.map(function (e) {
            return '<tr><td>' + esc(fmtDay(e.date, false)) + '</td><td>' + esc(e.type) + '</td><td>' + esc(e.description) + '</td><td class="num">' + (e.usd ? money(e.usd) : '–') + '</td>' +
              '<td class="num">' + (e.lbp ? num(e.lbp) : '–') + '</td><td class="num"><b>' + money(e.total) + '</b></td>' +
              '<td>' + (e.id ? '<button class="link-btn neg" data-del="' + esc(e.id) + '">Delete</button>' : '<span class="small muted">in sheet</span>') + '</td></tr>';
          }).join('') + '</tbody></table></div>' : '<div class="card card-pad muted">No expenses yet.</div>');
    }
    if (tab === 'dashboard') {
      var maxDay = Math.max.apply(null, d.days.map(function (x) { return x.sales; }).concat([d.targetSales || 0, 1]));
      var bar = function (label, value, max, extra) {
        return '<div class="bar-row"><div class="bar-label">' + label + '</div><div class="bar-track"><div class="bar-fill" style="width:' + Math.max(0, Math.min(100, value / max * 100)) + '%"></div></div><div class="bar-val">' + extra + '</div></div>';
      };
      var maxCat = Math.max.apply(null, d.categories.map(function (x) { return x.sales; }).concat([1]));
      var maxProd = Math.max.apply(null, d.products.map(function (x) { return x.units; }).concat([1]));
      var maxSeller = Math.max.apply(null, d.sellers.map(function (x) { return x.sales; }).concat([1]));
      html = refresh + '<div class="stats">' +
        stat('Sales', money(d.sales)) + stat('Units sold', num(d.units)) + stat('Tickets', num(d.tickets) + '<div class="sub">sales made</div>') +
        stat('Average ticket', money(d.avgTicket)) + stat('Per day', money(d.avgPerDay) + '<div class="sub">' + d.avgUnitsPerDay + ' units</div>') +
        stat('Cash / online', money(d.cash) + '<div class="sub">' + money(d.online) + ' online</div>') + '</div>' +
        '<div class="dash-grid">' +
        '<div class="card card-pad"><h3>Sales per day' + (d.targetSales ? ' <span class="small muted">(target ' + money(d.targetSales) + ')</span>' : '') + '</h3>' +
        (d.days.length ? d.days.map(function (x) {
          var hit = d.targetSales ? (x.sales >= d.targetSales ? ' <span class="good-t">✓</span>' : ' <span class="neg">✗</span>') : '';
          return bar(esc(fmtDay(x.date, false)) + (x.weekend ? ' <span class="pref">weekend</span>' : ''), x.sales, maxDay, money(x.sales) + hit + '<div class="pref">' + num(x.units) + ' units</div>');
        }).join('') : '<p class="muted">No sales yet.</p>') +
        '<p class="small muted">Weekdays: ' + money(d.weekday.avgSales) + ' a day (' + d.weekday.days + ' days) · Weekends: ' + money(d.weekend.avgSales) + ' a day (' + d.weekend.days + ' days)</p></div>' +
        '<div class="card card-pad"><h3>By category</h3>' + (d.categories.length ? d.categories.map(function (x) { return bar(esc(x.name), x.sales, maxCat, money(x.sales) + '<div class="pref">' + num(x.units) + ' units</div>'); }).join('') : '<p class="muted">No sales yet.</p>') + '</div>' +
        '<div class="card card-pad"><h3>Top products</h3>' + (d.products.length ? d.products.map(function (x) { return bar(esc(x.name), x.units, maxProd, num(x.units) + ' units<div class="pref">' + money(x.sales) + '</div>'); }).join('') : '<p class="muted">No sales yet.</p>') + '</div>' +
        '<div class="card card-pad"><h3>By seller</h3>' + (d.sellers.length ? d.sellers.map(function (x) { return bar(esc(x.name || '–'), x.sales, maxSeller, money(x.sales) + '<div class="pref">' + num(x.units) + ' units</div>'); }).join('') : '<p class="muted">No sales yet.</p>') + '</div>' +
        '</div>';
    }
    if (tab === 'pnl') {
      var line = function (k, v, cls) { return '<tr class="' + (cls || '') + '"><td>' + k + '</td><td class="num">' + (v < 0 ? '−' + money(-v) : money(v)) + '</td></tr>'; };
      html = refresh + '<div class="pnl-wrap"><div class="card table-wrap"><table class="tbl pnl"><tbody>' +
        line('Sales <span class="pref">VAT included, after discounts and returns</span>', L.sales, 'strong') +
        line('&nbsp;&nbsp;SHN products', L.shnSales, 'sub') + line('&nbsp;&nbsp;External products', L.externalSales, 'sub') +
        line('COGS <span class="pref">' + p.cogsPct + '% of SHN product sales</span>', -L.cogs) +
        line('Owed to external product partners', -L.partnersOwed) +
        line('Gross margin', L.gross, 'strong') +
        line('Staff pay <span class="pref">hours + commission</span>', -L.staffCost) +
        Object.keys(L.expensesByType).sort().map(function (k) { return line('Expenses: ' + esc(k), -L.expensesByType[k]); }).join('') +
        line('Net profit <span class="pref">' + L.netPct + '% of sales</span>', L.net, 'total' + (L.net < 0 ? ' neg' : '')) +
        '</tbody></table></div>' +
        '<div><div class="card card-pad small"><b>For reference</b><br>Returns refunded: ' + money(L.returns) + '<br>VAT included in sales: ' + money(L.vatIncluded) + '</div>' +
        (p.partners.length ? '<div class="card table-wrap" style="margin-top:12px"><table class="tbl"><thead><tr><th>External partner</th><th class="num">Units</th><th class="num">Sales</th><th class="num">Owed</th></tr></thead><tbody>' +
          p.partners.map(function (x) { return '<tr><td><b>' + esc(x.partner) + '</b></td><td class="num">' + num(x.units) + '</td><td class="num">' + money(x.sales) + '</td><td class="num"><b>' + money(x.owed) + '</b></td></tr>'; }).join('') + '</tbody></table></div>' : '') +
        '</div></div><p class="small muted">The P&L and Sales Tracker tabs of the event\'s Google Sheet were updated just now. They also update every time a business day is closed.</p>';
    }
    body.innerHTML = html;
    var rb = document.getElementById('pnlRefresh');
    if (rb) rb.onclick = function () { state.pnl = null; viewPnl(body, ev, tab); };
    if (tab === 'expenses') {
      var lb = document.getElementById('exLbp');
      lb.oninput = function () { var n = Math.round(Number(lb.value.replace(/[^0-9]/g, ''))); lb.value = n ? n.toLocaleString('en-US') : ''; };
      document.getElementById('expForm').onsubmit = function (e) {
        e.preventDefault();
        var btn = document.getElementById('exAdd'); btn.disabled = true;
        api('addExpense', { id: ev.id, expense: {
          date: document.getElementById('exDate').value, type: document.getElementById('exType').value,
          description: document.getElementById('exDesc').value, usd: Number(document.getElementById('exUsd').value.replace(/[^0-9.]/g, '')) || 0,
          lbp: Number(lb.value.replace(/[^0-9]/g, '')) || 0 } }).then(function () {
          toast('Expense added.'); state.pnl = null; viewPnl(body, ev, tab);
        }).catch(function (err) { btn.disabled = false; document.getElementById('exErr').innerHTML = '<div class="form-error">' + esc(err.message) + '</div>'; });
      };
      Array.prototype.forEach.call(body.querySelectorAll('[data-del]'), function (b) {
        b.onclick = function () {
          if (!window.confirm('Delete this expense?')) return;
          api('deleteExpense', { id: ev.id, expenseId: b.getAttribute('data-del') }).then(function () { toast('Expense deleted.'); state.pnl = null; viewPnl(body, ev, tab); })
            .catch(function (err) { toast(err.message, true); });
        };
      });
    }
  }

  function stat(k, v) { return '<div class="card stat"><div class="k">' + k + '</div><div class="v">' + v + '</div></div>'; }

  function signed(n) { return n > 0 ? '+' + num(n) : num(n); }

  function warningsHtml(w) {
    if (!w || !w.length) return '';
    return '<div class="warn-box"><b>' + w.length + (w.length === 1 ? ' thing to check' : ' things to check') + ' in the Google Sheet</b><ul>' +
      w.slice(0, 12).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') +
      (w.length > 12 ? '<li>…and ' + (w.length - 12) + ' more</li>' : '') + '</ul></div>';
  }

  function drawInvList(items) {
    var q = state.invQuery.trim().toLowerCase();
    var shown = items.filter(function (i) {
      if (state.invCat && i.category !== state.invCat) return false;
      return !q || i.name.toLowerCase().indexOf(q) >= 0 || String(i.ref).toLowerCase().indexOf(q) >= 0;
    });
    var el = document.getElementById('invList');
    if (!shown.length) { el.innerHTML = '<div class="card empty"><p class="muted">No products match.</p></div>'; return; }
    function liveCls(i) { return i.live < 0 ? 'neg' : i.live === 0 ? 'zero' : ''; }
    function nameCell(i) {
      return '<div class="pname">' + esc(i.name) + '</div><div class="pref">' + esc(i.ref) +
        '</div>';
    }
    el.innerHTML =
      '<div class="card table-wrap inv-table"><table class="tbl"><thead><tr><th>Product</th><th>Category</th><th class="num">Price</th>' +
      '<th class="num">Opening</th><th class="num">Refills / returns</th><th class="num">Sold</th><th class="num">In stock</th><th class="num">Demo</th></tr></thead><tbody>' +
      shown.map(function (i) {
        return '<tr><td>' + nameCell(i) + '</td><td>' + esc(i.category) + '</td><td class="num">' + money(i.price) + '</td>' +
          '<td class="num">' + num(i.opening) + '</td><td class="num">' + (i.moves ? signed(i.moves) : '–') + '</td>' +
          '<td class="num">' + num(i.sold) + '</td><td class="num live ' + liveCls(i) + '">' + num(i.live) + '</td>' +
          '<td class="num">' + (i.demo ? num(i.demo) : '–') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="inv-cards">' + shown.map(function (i) {
        return '<div class="card inv-card"><div class="inv-main">' + nameCell(i) +
          '<div class="pmeta">' + money(i.price) + ' · ' + esc(i.category) + '</div>' +
          '<div class="pmeta">Opening ' + num(i.opening) + (i.moves ? ' · Moves ' + signed(i.moves) : '') + ' · Sold ' + num(i.sold) +
          (i.demo ? ' · Demo ' + num(i.demo) : '') + '</div></div>' +
          '<div class="inv-live ' + liveCls(i) + '"><div class="n">' + num(i.live) + '</div><div class="l">in stock</div></div></div>';
      }).join('') + '</div>';
  }

  /* every unexpected error is copied to the master sheet's Errors tab */
  var reported = 0;
  function reportError(err, ctx) {
    if (!API_URL || reported >= 20 || (err && (err.code === 'auth' || err.code === 'invalid' || err.code === 'bad_pin'))) return;
    reported++;
    ctx = ctx || {};
    var e = {
      eventId: ctx.eventId || new URLSearchParams(location.search).get('e') || '',
      where: ctx.where || location.hash || 'app',
      device: navigator.userAgent.slice(0, 200),
      version: APP_VERSION,
      message: String((err && err.message) || err).slice(0, 500),
      details: String((err && (err.detail || err.stack)) || '').slice(0, 1500)
    };
    try {
      fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'logError', error: e }) }).catch(function () {});
    } catch (x) { /* never fail while reporting */ }
  }
  window.addEventListener('error', function (ev) { reportError(ev.error || ev.message, { where: 'page error' }); });
  window.addEventListener('unhandledrejection', function (ev) { reportError(ev.reason, { where: 'promise' }); });

  function showError(err, withBack) {
    if (err && err.code === 'auth') return;
    if (!err.offline) reportError(err, { where: 'admin ' + location.hash });
    app.innerHTML = '<div class="card empty"><h2>Couldn\'t load</h2><p class="muted">' + esc(err.message) + '</p>' +
      '<div class="err-details">Details: ' + esc(String(err.detail || err.message).slice(0, 300)) + ' · v' + APP_VERSION + ' · ' + new Date().toTimeString().slice(0, 8) + '</div>' +
      '<button class="btn btn-primary" id="retry">Try again</button>' +
      (withBack ? ' <a class="btn btn-ghost" href="#/">All events</a>' : '') + '</div>';
    document.getElementById('retry').onclick = render;
  }

  /* ---------------- router */
  var staffEvent = new URLSearchParams(location.search).get('e');

  function render() {
    if (staffEvent) {
      if (!API_URL) return viewNotConfigured();
      return window.SHN_POS.staff(staffEvent);
    }
    if (window.SHN_POS) window.SHN_POS.unmount();
    setTopbar();
    if (!API_URL) return viewNotConfigured();
    var hash = location.hash || '#/';
    if (!getToken() && hash !== '#/login') return go('#/login');
    if (hash === '#/login') return getToken() ? go('#/') : viewLogin();
    var m = hash.match(/^#\/event\/([^/]+)\/?([a-z]*)$/);
    if (m) return viewEvent(decodeURIComponent(m[1]), m[2] || 'settings');
    return viewHome();
  }

  window.SHN = {
    api: api, esc: esc, num: num, money: money, toast: toast, fmtRange: fmtRange, phase: phase,
    version: APP_VERSION, reportError: reportError,
    app: app, topbarRight: topbarRight, isAdmin: function () { return !!getToken(); }
  };

  window.addEventListener('hashchange', render);
  window.addEventListener('DOMContentLoaded', function () { render(); });
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }
})();
