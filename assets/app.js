/* SHN LEB Events — web app (Phase 2: + inventory, staff) */
(function () {
  'use strict';

  var API_URL = (window.SHN_CONFIG && window.SHN_CONFIG.API_URL) || '';
  var TOKEN_KEY = 'shn-events-admin';
  var TABS = [
    { id: 'settings', label: 'Settings' },
    { id: 'inventory', label: 'Inventory' },
    { id: 'pos', label: 'POS', phase: 3 },
    { id: 'cash', label: 'Cash', phase: 4 },
    { id: 'shifts', label: 'Shifts', phase: 4 },
    { id: 'expenses', label: 'Expenses', phase: 5 },
    { id: 'dashboard', label: 'Dashboard', phase: 5 },
    { id: 'pnl', label: 'P&L', phase: 5 }
  ];
  var TAB_HINT = {
    inventory: 'Opening stock from the SHN Catalogue, demo units, refills and returns, consignment items and daily counts.',
    pos: 'Product list with pictures and search, seller buttons, discounts, USD/LBP payment and change, online and split payments.',
    cash: 'Drawer balance in USD and LBP, handovers and cash counts.',
    shifts: 'Clock in and out, hours and commissions per employee.',
    expenses: 'Rent, transport, bags, marketing and other event costs.',
    dashboard: 'Sales by day, category, game, seller and payment type, against daily targets.',
    pnl: 'Sales, COGS, staff cost, expenses, consignment settlement and net profit.'
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
  function api(action, data) {
    var body = Object.assign({ action: action, token: getToken() }, data || {});
    return fetch(API_URL, { method: 'POST', body: JSON.stringify(body), redirect: 'follow' })
      .then(function (r) {
        if (!r.ok) throw new Error('The server did not answer (' + r.status + ').');
        return r.json();
      }, function () {
        throw new Error('No connection. Check the internet and try again.');
      })
      .then(function (res) {
        if (!res.ok) {
          if (res.code === 'auth') { setToken(null); go('#/login'); }
          var err = new Error(res.error || 'Something went wrong.');
          err.code = res.code;
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
        '<p class="muted">Partner products go in the consignment columns (I–R) of the same tab.</p>' +
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
        (i.consignment ? ' · <span class="tag">Consignment' + (i.partner ? ': ' + esc(i.partner) : '') + '</span>' : '') + '</div>';
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

  function showError(err, withBack) {
    if (err && err.code === 'auth') return;
    app.innerHTML = '<div class="card empty"><h2>Couldn\'t load</h2><p class="muted">' + esc(err.message) + '</p>' +
      '<button class="btn btn-primary" id="retry">Try again</button>' +
      (withBack ? ' <a class="btn btn-ghost" href="#/">All events</a>' : '') + '</div>';
    document.getElementById('retry').onclick = render;
  }

  /* ---------------- router */
  function render() {
    setTopbar();
    if (!API_URL) return viewNotConfigured();
    var hash = location.hash || '#/';
    if (!getToken() && hash !== '#/login') return go('#/login');
    if (hash === '#/login') return getToken() ? go('#/') : viewLogin();
    var m = hash.match(/^#\/event\/([^/]+)\/?([a-z]*)$/);
    if (m) return viewEvent(decodeURIComponent(m[1]), m[2] || 'settings');
    return viewHome();
  }

  window.addEventListener('hashchange', render);
  render();
})();
