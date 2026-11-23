/* SHN LEB Events — web app: admin side, router, shared helpers (POS lives in pos.js) */
(function () {
  'use strict';

  var APP_VERSION = '1.8.0';
  var API_URL = (window.SHN_CONFIG && window.SHN_CONFIG.API_URL) || '';
  var TOKEN_KEY = 'shn-events-admin';
  var DRAFT_TABS = [
    { id: 'info', label: 'Info' },
    { id: 'breakeven', label: 'Break-even' }
  ];
  var TABS = [
    { id: 'info', label: 'Info' },
    { id: 'breakeven', label: 'Break-even' },
    { id: 'settings', label: 'Settings' },
    { id: 'inventory', label: 'Inventory' },
    { id: 'pos', label: 'POS' },
    { id: 'cash', label: 'Cash' },
    { id: 'shifts', label: 'Shifts & pay' },
    { id: 'days', label: 'Days' },
    { id: 'customers', label: 'Customers' },
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
    if (ev.status === 'Draft') return { key: 'draft', label: 'Draft' };
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
      state.overview = null;
      loading('Loading events…');
      api('listEvents').then(function (res) {
        state.events = res.events || [];
        viewHome();
      }).catch(function (err) { showError(err); });
      return;
    }
    var events = state.events.slice().sort(function (a, b) {
      var order = { live: 0, draft: 1, upcoming: 2, ended: 3, closed: 4 };
      var pa = order[phase(a).key], pb = order[phase(b).key];
      if (pa !== pb) return pa - pb;
      return pa <= 2 ? (a.startDate < b.startDate ? -1 : 1) : (a.startDate > b.startDate ? -1 : 1);
    });
    var counts = { all: events.length, live: 0, draft: 0, upcoming: 0, past: 0 };
    events.forEach(function (e) {
      var k = phase(e).key;
      if (k === 'live' || k === 'draft' || k === 'upcoming') counts[k]++; else counts.past++;
    });
    var shown = events.filter(function (e) {
      var k = phase(e).key;
      if (state.filter === 'all') return true;
      if (state.filter === 'past') return k === 'ended' || k === 'closed';
      return k === state.filter;
    });
    var chips = [['all', 'All'], ['live', 'Live'], ['draft', 'Drafts'], ['upcoming', 'Upcoming'], ['past', 'Past']].map(function (c) {
      return '<button class="chip' + (state.filter === c[0] ? ' active' : '') + '" data-filter="' + c[0] + '">' +
        c[1] + '<span class="count">' + counts[c[0]] + '</span></button>';
    }).join('');

    var body;
    if (!events.length) {
      body = '<div class="card empty"><h2>No events yet</h2><p class="muted">Create your first event as a draft: fill its info and break-even, then launch it to get its Google Sheet, PIN and staff link.</p>' +
        '<button class="btn btn-accent" data-new>+ New event</button></div>';
    } else if (!shown.length) {
      body = '<div class="card empty"><p class="muted">No events here.</p></div>';
    } else {
      body = '<div class="grid">' + shown.map(cardHtml).join('') + '</div>';
    }

    app.innerHTML =
      '<div class="page-head"><h1>Events</h1><button class="btn btn-accent" data-new>+ New event</button></div>' +
      '<div id="overview"></div>' +
      (events.length ? '<div class="chips">' + chips + '</div>' : '') + body;
    drawOverview();

    Array.prototype.forEach.call(app.querySelectorAll('[data-filter]'), function (b) {
      b.onclick = function () { state.filter = b.getAttribute('data-filter'); viewHome(); };
    });
    Array.prototype.forEach.call(app.querySelectorAll('[data-new]'), function (b) { b.onclick = openNewEvent; });
  }

  /* running events: today's figures, drawer and warnings */
  function drawOverview() {
    var el = document.getElementById('overview');
    if (!el) return;
    var live = (state.events || []).filter(function (e) { return phase(e).key === 'live'; });
    if (!live.length) { el.innerHTML = ''; return; }
    if (!state.overview || state.overview.at < Date.now() - 60000) {
      if (!state.overview) el.innerHTML = '<div class="card card-pad muted small">Loading today\'s figures…</div>';
      api('overview').then(function (res) {
        state.overview = { at: Date.now(), list: res.overview || [] };
        drawOverview();
      }).catch(function () { el.innerHTML = ''; });
      if (!state.overview) return;
    }
    var list = state.overview.list;
    if (!list.length) { el.innerHTML = ''; return; }
    el.innerHTML = '<h2 class="section-title" style="margin-top:0">Running now</h2><div class="ov-grid">' + list.map(function (o) {
      if (o.error) return '<div class="card ov-card"><b>' + esc(o.name) + '</b><div class="small neg">' + esc(o.error) + '</div></div>';
      var hit = o.targetSales ? (o.sales >= o.targetSales ? ' <span class="good-t">✓ target</span>' : ' <span class="muted">of ' + money(o.targetSales) + '</span>') : '';
      return '<a class="card ov-card' + (o.cashWarn ? ' warn' : '') + '" href="#/event/' + encodeURIComponent(o.id) + '/dashboard">' +
        '<div class="ov-top"><b>' + esc(o.name) + '</b><span class="pill ' + (o.dayOpen ? 'pill-live' : 'pill-closed') + '">' + (o.dayOpen ? 'Day ' + o.dayNumber + ' open' : 'Day closed') + '</span></div>' +
        '<div class="ov-nums"><div><div class="k">Today</div><div class="v">' + money(o.sales) + hit + '</div><div class="pref">' + num(o.units) + ' units · ' + num(o.tickets) + ' sales</div></div>' +
        '<div><div class="k">Drawer</div><div class="v' + (o.cashWarn ? ' neg' : '') + '">' + money(o.cash.usd) + '</div><div class="pref' + (o.cashWarn ? ' neg' : '') + '">' + num(o.cash.lbp) + ' LBP</div></div></div>' +
        (o.cashWarn ? '<div class="ov-warn">Too much cash in the drawer: ask for a handover.</div>' : '') +
        '<div class="small muted">' + (o.onShift.length ? 'On shift: ' + esc(o.onShift.join(', ')) : 'Nobody clocked in') +
        (o.refills ? ' · <span class="warn-text">' + o.refills + ' refill request' + (o.refills === 1 ? '' : 's') + '</span>' : '') + '</div></a>';
    }).join('') + '</div>';
  }

  function cardHtml(ev) {
    var p = phase(ev);
    return '<a class="card event-card" href="#/event/' + encodeURIComponent(ev.id) + '/' + (ev.status === 'Draft' ? 'info' : 'settings') + '">' +
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
      '<p class="muted small">Creates a draft. Fill its info and break-even, then press Launch event: that creates its Google Sheet and PIN.</p>' +
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
        toast('Draft created.');
        go('#/event/' + encodeURIComponent(res.event.id) + '/info');
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
    var draft = ev.status === 'Draft';
    var list = draft ? DRAFT_TABS : TABS;
    if (!list.some(function (t) { return t.id === tab; })) return go('#/event/' + encodeURIComponent(ev.id) + '/' + list[0].id);
    var p = phase(ev);
    var tabs = list.map(function (t) {
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
      (draft
        ? '<button class="btn btn-accent" id="launchBtn">Launch event</button>' +
          '<button class="btn btn-ghost" id="dupBtn">Duplicate</button>' +
          '<button class="btn btn-danger" id="delBtn">Delete draft</button>'
        : '<a class="btn btn-ghost" href="' + esc(ev.sheetUrl) + '" target="_blank" rel="noopener">Open Google Sheet</a>' +
          '<button class="btn btn-ghost" id="dupBtn">Duplicate</button>' +
          (ev.status === 'Closed'
            ? '<button class="btn btn-ghost" id="statusBtn">Reopen event</button>'
            : '<button class="btn btn-danger" id="statusBtn">Close event</button>')) +
      '</div></div>' +
      (draft ? '<div class="note">This event is a <b>draft</b>: it has no Google Sheet, PIN or staff link yet. Use Info and Break-even to decide, then <b>Launch event</b>.' +
        (ev.copyFrom ? ' Products, quantities, demo units and staff will be copied from the event it was duplicated from.' : '') + '</div>' : '') +
      '<nav class="tabs" aria-label="Event sections">' + tabs + '</nav>' +
      '<section id="tabBody"></section>';

    var sb = document.getElementById('statusBtn');
    if (sb) sb.onclick = function () {
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
    var lb = document.getElementById('launchBtn');
    if (lb) lb.onclick = function () {
      if (!window.confirm('Launch "' + ev.name + '"? This creates its Google Sheet (' + ev.startDate.replace(/-/g, '') + ' - ' + ev.name + ') with a PIN. Takes about 10 seconds.')) return;
      lb.disabled = true; lb.textContent = 'Launching…';
      api('launchEvent', { id: ev.id }).then(function (res) {
        state.event = res.event; state.events = null;
        toast('Event launched. Its Google Sheet is ready.');
        go('#/event/' + encodeURIComponent(ev.id) + '/settings');
      }).catch(function (err) { lb.disabled = false; lb.textContent = 'Launch event'; toast(err.message, true); });
    };
    var db = document.getElementById('delBtn');
    if (db) db.onclick = function () {
      if (!window.confirm('Delete the draft "' + ev.name + '"? Its info and break-even are lost.')) return;
      db.disabled = true;
      api('deleteDraft', { id: ev.id }).then(function () {
        state.events = null; state.event = null; toast('Draft deleted.'); go('#/');
      }).catch(function (err) { db.disabled = false; toast(err.message, true); });
    };
    document.getElementById('dupBtn').onclick = function () { openDuplicate(ev); };

    var body = document.getElementById('tabBody');
    if (tab === 'info') viewInfo(body, ev);
    else if (tab === 'breakeven') viewBreakeven(body, ev);
    else if (tab === 'settings') { body.innerHTML = settingsHtml(ev); wireSettings(ev); }
    else if (tab === 'inventory') viewInventory(body, ev);
    else if (tab === 'pos') window.SHN_POS.mount(body, { eventId: ev.id, token: getToken(), admin: true });
    else if (tab === 'cash' || tab === 'shifts' || tab === 'days' || tab === 'customers') viewReport(body, ev, tab);
    else if (tab === 'expenses' || tab === 'dashboard' || tab === 'pnl') viewPnl(body, ev, tab);
  }

  function confirmClose() {
    return window.confirm('Close this event? Staff will no longer be able to use its PIN. You can reopen it later.');
  }

  function openDuplicate(ev) {
    var wrap = document.createElement('div');
    wrap.className = 'dialog-backdrop';
    wrap.innerHTML =
      '<form class="card dialog" id="dupForm" role="dialog" aria-modal="true">' +
      '<h2>Duplicate event</h2>' +
      '<p class="muted small" style="margin-top:0">Creates a new draft with the same info and break-even. When you launch it, products with their quantities and demo units, external products and staff are copied from <b>' + esc(ev.name) + '</b>.</p>' +
      '<div id="dupError"></div>' +
      '<div class="field"><label for="dName">Event name</label><input class="input" id="dName" required maxlength="80" value="' + esc(ev.name) + '"></div>' +
      '<div class="field"><label for="dVenue">Venue</label><input class="input" id="dVenue" maxlength="80" value="' + esc(ev.venue) + '"></div>' +
      '<div class="row-2">' +
      '<div class="field"><label for="dStart">Start date</label><input class="input" id="dStart" type="date" required></div>' +
      '<div class="field"><label for="dEnd">End date</label><input class="input" id="dEnd" type="date" required></div>' +
      '</div>' +
      '<div class="dialog-actions"><button type="button" class="btn btn-ghost" id="dupCancel">Cancel</button>' +
      '<button type="submit" class="btn btn-primary" id="dupGo">Create draft</button></div></form>';
    document.body.appendChild(wrap);
    var close = function () { wrap.remove(); };
    document.getElementById('dupCancel').onclick = close;
    wrap.addEventListener('click', function (e) { if (e.target === wrap) close(); });
    document.getElementById('dStart').onchange = function () { var e2 = document.getElementById('dEnd'); if (!e2.value || e2.value < this.value) e2.value = this.value; };
    document.getElementById('dupForm').onsubmit = function (e) {
      e.preventDefault();
      var btn = document.getElementById('dupGo'); btn.disabled = true;
      api('duplicateEvent', { id: ev.id, name: document.getElementById('dName').value.trim(), venue: document.getElementById('dVenue').value.trim(),
        startDate: document.getElementById('dStart').value, endDate: document.getElementById('dEnd').value }).then(function (res) {
        close(); state.events = null; state.event = null;
        toast('Draft created from ' + ev.name + '.');
        go('#/event/' + encodeURIComponent(res.event.id) + '/info');
      }).catch(function (err) { btn.disabled = false; document.getElementById('dupError').innerHTML = '<div class="form-error">' + esc(err.message) + '</div>'; });
    };
  }

  function staffLink(ev) {
    var base = location.origin + location.pathname.replace(/index\.html$/, '');
    return base + '?e=' + encodeURIComponent(ev.id);
  }

  function fmtStamp(ms) {
    var d = new Date(ms);
    return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ', ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function settingsHtml(ev) {
    var s = ev.settings || {};
    function item(k, v, isEmpty) {
      return '<div class="card kv-item"><div class="k">' + esc(k) + '</div><div class="v' + (isEmpty ? ' empty-v' : '') + '">' + v + '</div></div>';
    }
    return '' +
      '<div class="note">These values live in the <b>Settings</b> tab of the event\'s Google Sheet. Edit them there, then reload this page. Name, dates, venue and opening hours are edited in <b>Info</b>.</div>' +
      '<h2 class="section-title">Event</h2>' +
      '<div class="kv">' +
      item('Dates', esc(fmtRange(ev.startDate, ev.endDate))) +
      item('Opening hours', s.openingHours ? esc(s.openingHours) : 'Not set', !s.openingHours) +
      item('Exchange rate', s.fxRate ? num(s.fxRate) + ' LBP / $' : 'Not set', !s.fxRate) +
      item('Max discount', num(s.maxDiscountPct) + '% <span class="pref">above it: manager PIN</span>') +
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
      '<h2 class="section-title">Staff</h2>' +
      '<div class="kv" style="margin-bottom:12px">' + item('Commission threshold', money(s.commissionThreshold) + ' <span class="pref">items paid at or above it earn the higher commission</span>') + '</div>' +
      staffHtml(ev.staff || []) +
      '<h2 class="section-title">Staff access</h2>' +
      '<div class="kv">' + item('Staff PIN', esc(s.pin || '—')) + item('Manager PIN', esc(s.managerPin || '—') + ' <span class="pref">returns above the limit, discounts above the max</span>') +
      item('Staff access ends', s.accessEnds ? esc(fmtStamp(s.accessEnds)) + ' <span class="pref">12h after closing on the last day</span>' : '—') + '</div>' +
      '<div class="card card-pad" style="margin-top:12px">' +
      '<div class="small muted" style="margin-bottom:8px">Staff link (send it with the PIN, separately)</div>' +
      '<div class="share"><code id="staffLink">' + esc(staffLink(ev)) + '</code>' +
      '<button class="btn btn-ghost" id="copyLink">Copy</button><button class="btn btn-ghost" id="shareLink">Share</button></div></div>';
  }

  function wireSettings(ev) {
    var link = staffLink(ev);
    document.getElementById('copyLink').onclick = function () {
      (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject())
        .then(function () { toast('Staff link copied.'); }, function () { toast('Select the link and copy it.'); });
    };
    document.getElementById('shareLink').onclick = function () {
      var text = 'SHN LEB · ' + ev.name + ': staff link for the POS, clock in/out and counts. Your manager gives you the PIN.';
      if (navigator.share) {
        navigator.share({ title: 'SHN LEB · ' + ev.name, text: text, url: link }).catch(function () {});
      } else {
        window.open('https://wa.me/?text=' + encodeURIComponent(text + '\n' + link), '_blank', 'noopener');
      }
    };
  }

  function staffHtml(staff) {
    if (!staff.length) {
      return '<div class="card card-pad muted">No staff yet. Add each employee in the event\'s Google Sheet: <b>Settings</b> tab, staff columns E–I, with their hourly rate and commissions.</div>';
    }
    var old = staff.some(function (p) { return p.threshold != null; });
    return '<div class="card table-wrap"><table class="tbl"><thead><tr><th>Name</th><th class="num">Hourly rate</th>' +
      '<th class="num">Commission under threshold</th>' + (old ? '<th class="num">Own threshold</th>' : '') + '<th class="num">Commission at/over</th><th>Status</th></tr></thead><tbody>' +
      staff.map(function (p) {
        return '<tr><td><b>' + esc(p.name) + '</b></td><td class="num">' + money(p.hourlyRate) + '/h</td>' +
          '<td class="num">' + money(p.commissionUnder) + '</td>' + (old ? '<td class="num">' + (p.threshold == null ? '–' : money(p.threshold)) + '</td>' : '') +
          '<td class="num">' + money(p.commissionOver) + '</td><td>' + (p.active ? '<span class="pill pill-live">Active</span>' : '<span class="pill pill-closed">Inactive</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  /* ---------------- info page (drafts and launched events) */
  var INFO_FORM = [
    ['description', 'Description', 'area', 'What the event is, who comes, anything worth knowing'],
    ['openingHours', 'Opening hours', 'text', 'e.g. WD: 4pm-11pm / WE: 12pm-11pm'],
    ['mapsLink', 'Google Maps link', 'url', 'https://maps.app.goo.gl/…'],
    ['standLocation', 'Stand location', 'text', 'e.g. Near the main entrance, next to the food court'],
    ['standSize', 'Stand size', 'text', 'e.g. 3x3 m'],
    ['organizerName', 'Organizer', 'text', 'Company or contact name'],
    ['organizerPhone', 'Organizer phone', 'tel', ''],
    ['organizerEmail', 'Organizer email', 'email', ''],
    ['setupTime', 'Setup', 'text', 'e.g. Fri 5 Dec, 10am-2pm'],
    ['teardownTime', 'Teardown', 'text', 'e.g. Wed 31 Dec after closing'],
    ['objectives', 'Objectives', 'area', 'e.g. 30% profit, 200 customers activated, launch 7zar Shou Season 3'],
    ['notes', 'Other notes', 'area', '']
  ];

  function viewInfo(body, ev) {
    var info = JSON.parse(JSON.stringify(ev.info || {}));
    if (!info.openingHours && ev.settings && ev.settings.openingHours) info.openingHours = ev.settings.openingHours;
    info.focusGames = info.focusGames || [];
    var f = function (k) { return esc(info[k] || ''); };
    var field = function (d) {
      var input = d[2] === 'area'
        ? '<textarea class="input" data-info="' + d[0] + '" rows="3" placeholder="' + esc(d[3]) + '">' + f(d[0]) + '</textarea>'
        : '<input class="input" data-info="' + d[0] + '" type="' + d[2] + '" placeholder="' + esc(d[3]) + '" value="' + f(d[0]) + '">';
      return '<div class="field' + (d[2] === 'area' ? ' info-wide' : d[0] === 'openingHours' || d[0] === 'mapsLink' ? ' info-half' : '') + '"><label>' + esc(d[1]) + '</label>' + input + '</div>';
    };
    body.innerHTML =
      '<form class="info-form" id="infoForm">' +
      '<section class="card card-pad"><h3>Event</h3><div class="info-grid">' +
      '<div class="field info-wide"><label for="iName">Event name</label><input class="input" id="iName" required maxlength="80" value="' + esc(ev.name) + '"></div>' +
      '<div class="field"><label for="iType">Type</label><select class="input" id="iType">' + ['Sales', 'Awareness'].map(function (t) { return '<option' + (t === ev.type ? ' selected' : '') + '>' + t + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="iVenue">Location</label><input class="input" id="iVenue" maxlength="80" value="' + esc(ev.venue) + '"></div>' +
      '<div class="field"><label for="iStart">Start date</label><input class="input" id="iStart" type="date" value="' + esc(ev.startDate) + '"></div>' +
      '<div class="field"><label for="iEnd">End date</label><input class="input" id="iEnd" type="date" value="' + esc(ev.endDate) + '"></div>' +
      INFO_FORM.slice(0, 2).map(field).join('') +
      '</div></section>' +
      '<section class="card card-pad"><h3>Place and stand</h3><div class="info-grid">' + INFO_FORM.slice(2, 5).map(field).join('') +
      '<div class="field"><label>&nbsp;</label><a class="btn btn-ghost" id="mapsOpen" target="_blank" rel="noopener"' + (info.mapsLink ? ' href="' + f('mapsLink') + '"' : ' hidden') + '>Open in Maps</a></div>' +
      '</div></section>' +
      '<section class="card card-pad"><h3>Organizer and timing</h3><div class="info-grid">' + INFO_FORM.slice(5, 10).map(field).join('') + '</div></section>' +
      '<section class="card card-pad"><h3>Focus and objectives</h3>' +
      '<div class="field"><label for="iFocus">Focus games</label><div class="focus-add"><input class="input" id="iFocus" list="catNames" placeholder="Type to search the SHN Catalogue" autocomplete="off">' +
      '<button type="button" class="btn btn-ghost" id="focusAdd">Add</button></div><datalist id="catNames"></datalist><div class="chips focus-chips" id="focusChips"></div></div>' +
      '<div class="info-grid">' + INFO_FORM.slice(10).map(field).join('') + '</div></section>' +
      '<div class="info-save"><span class="small muted" id="infoState">Nothing to fill is mandatory.</span><div id="infoErr"></div>' +
      '<button class="btn btn-primary" id="infoSave" type="submit">Save info</button></div>' +
      '</form>';
    var dirty = false;
    var stateEl = document.getElementById('infoState');
    var markDirty = function () { dirty = true; stateEl.textContent = 'Not saved yet.'; stateEl.className = 'small warn-text'; };
    Array.prototype.forEach.call(body.querySelectorAll('input,select,textarea'), function (x) { x.addEventListener('input', markDirty); });
    function drawFocus() {
      document.getElementById('focusChips').innerHTML = info.focusGames.length ? info.focusGames.map(function (g, i) {
        return '<span class="chip active">' + esc(g) + ' <button type="button" class="chip-x" data-rm="' + i + '" aria-label="Remove">×</button></span>';
      }).join('') : '<span class="small muted">No focus games yet.</span>';
      Array.prototype.forEach.call(body.querySelectorAll('[data-rm]'), function (b) {
        b.onclick = function () { info.focusGames.splice(Number(b.getAttribute('data-rm')), 1); markDirty(); drawFocus(); };
      });
    }
    drawFocus();
    var fi = document.getElementById('iFocus');
    function addFocus() {
      var v = fi.value.trim();
      if (!v) return;
      if (info.focusGames.indexOf(v) < 0) info.focusGames.push(v);
      fi.value = ''; markDirty(); drawFocus();
    }
    document.getElementById('focusAdd').onclick = addFocus;
    fi.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addFocus(); } });
    fi.addEventListener('change', function () { if (state.catNames && state.catNames.indexOf(fi.value) >= 0) addFocus(); });
    function fillNames() {
      document.getElementById('catNames').innerHTML = state.catNames.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('');
    }
    if (state.catNames) fillNames();
    else api('catalogueNames').then(function (res) { state.catNames = res.names || []; if (document.getElementById('catNames')) fillNames(); }).catch(function () {});
    var maps = body.querySelector('[data-info="mapsLink"]');
    maps.addEventListener('input', function () {
      var a = document.getElementById('mapsOpen');
      if (/^https?:\/\//.test(maps.value.trim())) { a.href = maps.value.trim(); a.hidden = false; } else a.hidden = true;
    });
    document.getElementById('infoForm').onsubmit = function (e) {
      e.preventDefault();
      Array.prototype.forEach.call(body.querySelectorAll('[data-info]'), function (x) { info[x.getAttribute('data-info')] = x.value.trim(); });
      var btn = document.getElementById('infoSave'); btn.disabled = true; btn.textContent = 'Saving…';
      api('saveInfo', { id: ev.id, event: { name: document.getElementById('iName').value.trim(), type: document.getElementById('iType').value,
        venue: document.getElementById('iVenue').value.trim(), startDate: document.getElementById('iStart').value, endDate: document.getElementById('iEnd').value, info: info } })
        .then(function (res) {
          state.event = res.event; state.events = null;
          dirty = false;
          toast('Info saved.' + (ev.status === 'Draft' ? '' : ' The event sheet was updated too.'));
          viewEvent(ev.id, 'info');
        }).catch(function (err) {
          btn.disabled = false; btn.textContent = 'Save info';
          document.getElementById('infoErr').innerHTML = '<div class="form-error">' + esc(err.message) + '</div>';
        });
    };
    leaveGuard(function () { return dirty; });
  }

  /* asks before leaving a page with unsaved changes */
  var guardFn = null;
  function leaveGuard(fn) { guardFn = fn; }
  window.addEventListener('beforeunload', function (e) { if (guardFn && guardFn()) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------------- break-even simulation */
  function daysBetween(a, b) {
    var da = parseDay(a), db = parseDay(b);
    if (!da || !db) return 1;
    return Math.max(1, Math.round((db - da) / 86400000) + 1);
  }
  function hoursFrom(text) {
    var m = String(text || '').match(/(\d{1,2})(?:[:.h](\d{2}))?\s*(am|pm)?\s*(?:-|–|to)\s*(\d{1,2})(?:[:.h](\d{2}))?\s*(am|pm)?/i);
    if (!m) return 8;
    var a = Number(m[1]) + Number(m[2] || 0) / 60, b = Number(m[4]) + Number(m[5] || 0) / 60;
    var ap = (m[3] || '').toLowerCase(), bp = (m[6] || ap).toLowerCase();
    if (ap === 'pm' && a < 12) a += 12;
    if (ap === 'am' && a === 12) a = 0;
    if (bp === 'pm' && b < 12) b += 12;
    if (bp === 'am' && b === 12) b = 0;
    if (b <= a) b += 24;
    return Math.round((b - a) * 2) / 2;
  }

  function beDefaults(ev) {
    var d = ev.defaults || {};
    var info = ev.info || {};
    return {
      days: daysBetween(ev.startDate, ev.endDate), hoursPerDay: hoursFrom(info.openingHours || (ev.settings && ev.settings.openingHours)), staffCount: 2,
      staffRate: d.staffRate || 3, avgPrice: 25, overPct: 20, commUnder: 0.5, commOver: 1, threshold: (ev.settings && ev.settings.commissionThreshold) || d.threshold || 30,
      cogsPct: (ev.settings && ev.settings.cogsPct) || d.cogsPct || 35, rentFixed: 0, rentPct: 0, others: [], otherPct: 0, targetPct: 30,
      refEvent: '', refUnits: '', growthPct: 10
    };
  }

  function beCalc(b) {
    var n = function (v) { var x = Number(v); return isNaN(x) ? 0 : x; };
    var days = Math.max(1, n(b.days)), price = n(b.avgPrice);
    var staffCost = days * n(b.hoursPerDay) * n(b.staffCount) * n(b.staffRate);
    var otherFixed = (b.others || []).reduce(function (a, o) { return a + n(o.amount); }, 0);
    var fixed = n(b.rentFixed) + otherFixed + staffCost;
    var over = Math.min(100, Math.max(0, n(b.overPct))) / 100;
    var comm = over * n(b.commOver) + (1 - over) * n(b.commUnder);
    var pctCosts = (n(b.cogsPct) + n(b.rentPct) + n(b.otherPct)) / 100;
    var contrib = price * (1 - pctCosts) - comm;
    var out = { days: days, price: price, staffCost: staffCost, otherFixed: otherFixed, fixed: fixed, comm: comm, contrib: contrib, rentPerDay: n(b.rentFixed) / days };
    out.beTotal = contrib > 0 ? fixed / contrib : null;
    out.bePerDay = out.beTotal == null ? null : out.beTotal / days;
    var t = n(b.targetPct) / 100, tc = contrib - t * price;
    out.tTotal = tc > 0 ? fixed / tc : null;
    out.tPerDay = out.tTotal == null ? null : out.tTotal / days;
    var ref = n(b.refUnits);
    if (ref > 0) {
      out.fPerDay = ref * (1 + n(b.growthPct) / 100);
      out.fTotal = out.fPerDay * days;
      out.fSales = out.fTotal * price;
      out.fProfit = out.fTotal * contrib - fixed;
      out.fPct = out.fSales ? out.fProfit / out.fSales * 100 : 0;
    }
    return out;
  }

  function viewBreakeven(body, ev) {
    var b = Object.assign(beDefaults(ev), ev.breakeven || {});
    b.others = (b.others || []).map(function (o) { return { label: o.label || '', amount: o.amount }; });
    var past = (state.events || []).filter(function (e) { return e.id !== ev.id && e.avgUnitsPerDay > 0; });
    if (!state.events) api('listEvents').then(function (res) { state.events = res.events || []; if (document.getElementById('beForm')) viewBreakeven(body, ev); }).catch(function () {});
    var launched = ev.status !== 'Draft';
    var inp = function (k, label, suffix, step) {
      return '<div class="field"><label>' + label + '</label><div class="in-suffix"><input class="input" data-be="' + k + '" inputmode="decimal" value="' + esc(b[k]) + '"' + (step ? ' step="' + step + '"' : '') + '>' +
        (suffix ? '<span>' + suffix + '</span>' : '') + '</div></div>';
    };
    body.innerHTML =
      '<div class="be-wrap"><form class="be-form" id="beForm">' +
      '<section class="card card-pad"><h3>Event and staff</h3><div class="be-grid">' +
      inp('days', 'Number of days', 'days') + inp('hoursPerDay', 'Opening hours per day', 'h') + inp('staffCount', 'Staff on the stand', 'people') + inp('staffRate', 'Rate per hour', '$') +
      '</div></section>' +
      '<section class="card card-pad"><h3>Sales and commission</h3><div class="be-grid">' +
      inp('avgPrice', 'Average game price', '$') + inp('cogsPct', 'COGS', '% of price') +
      inp('threshold', 'Commission threshold', '$') + inp('overPct', 'Games sold at/over threshold', '%') +
      inp('commUnder', 'Commission under threshold', '$ / game') + inp('commOver', 'Commission at/over threshold', '$ / game') +
      '</div><div class="small muted">Games under the threshold: <b id="underPct"></b>. No VAT is taken off the price.</div></section>' +
      '<section class="card card-pad"><h3>Rent</h3><div class="be-grid">' + inp('rentFixed', 'Fixed rent (whole event)', '$') + inp('rentPct', 'Rent as % of sales', '%') +
      '<div class="field"><label>Rent per day</label><div class="be-out" id="rentDay"></div></div></div></section>' +
      '<section class="card card-pad"><h3>Other expenses</h3><div id="others"></div>' +
      '<button type="button" class="btn btn-ghost btn-sm" id="otherAdd">+ Add expense</button>' +
      '<div class="be-grid" style="margin-top:12px">' + inp('otherPct', 'Other expenses as % of sales', '%') + '</div></section>' +
      '<section class="card card-pad"><h3>Target and forecast</h3><div class="be-grid">' + inp('targetPct', 'Target profit', '% of sales') +
      '<div class="field"><label>Similar past event</label><select class="input" id="beRef"><option value="">Type the figure</option>' +
      past.map(function (e) { return '<option value="' + esc(e.id) + '"' + (b.refEvent === e.id ? ' selected' : '') + '>' + esc(e.name) + ' (' + e.avgUnitsPerDay + '/day)</option>'; }).join('') + '</select></div>' +
      inp('refUnits', 'Games a day at that event', 'games') + inp('growthPct', 'Growth expected', '%') +
      '</div></section>' +
      '<div class="info-save"><span class="small muted" id="beState"></span><div id="beErr"></div><button class="btn btn-primary" id="beSave" type="submit">Save simulation</button></div>' +
      '</form><aside class="be-results" id="beResults"></aside></div>';

    var dirty = false;
    function markDirty() { dirty = true; var s2 = document.getElementById('beState'); s2.textContent = 'Not saved yet.'; s2.className = 'small warn-text'; }
    function drawOthers() {
      document.getElementById('others').innerHTML = b.others.length ? b.others.map(function (o, i) {
        return '<div class="other-row"><input class="input" data-ol="' + i + '" placeholder="e.g. Transport, bags, decoration" value="' + esc(o.label) + '">' +
          '<div class="in-suffix"><input class="input" data-oa="' + i + '" inputmode="decimal" placeholder="0" value="' + esc(o.amount == null ? '' : o.amount) + '"><span>$</span></div>' +
          '<button type="button" class="link-btn neg" data-od="' + i + '">Remove</button></div>';
      }).join('') : '<p class="small muted" style="margin-top:0">No other expenses yet.</p>';
      Array.prototype.forEach.call(body.querySelectorAll('[data-ol]'), function (x) { x.oninput = function () { b.others[Number(x.getAttribute('data-ol'))].label = x.value; markDirty(); }; });
      Array.prototype.forEach.call(body.querySelectorAll('[data-oa]'), function (x) { x.oninput = function () { b.others[Number(x.getAttribute('data-oa'))].amount = x.value.replace(/[^0-9.]/g, ''); markDirty(); drawResults(); }; });
      Array.prototype.forEach.call(body.querySelectorAll('[data-od]'), function (x) { x.onclick = function () { b.others.splice(Number(x.getAttribute('data-od')), 1); markDirty(); drawOthers(); drawResults(); }; });
    }
    document.getElementById('otherAdd').onclick = function () { b.others.push({ label: '', amount: '' }); markDirty(); drawOthers(); };
    Array.prototype.forEach.call(body.querySelectorAll('[data-be]'), function (x) {
      x.oninput = function () {
        b[x.getAttribute('data-be')] = x.value.replace(/[^0-9.]/g, '');
        if (x.getAttribute('data-be') === 'refUnits') { b.refEvent = ''; document.getElementById('beRef').value = ''; }
        markDirty(); drawResults();
      };
    });
    document.getElementById('beRef').onchange = function () {
      b.refEvent = this.value;
      var e2 = past.filter(function (x) { return x.id === b.refEvent; })[0];
      if (e2) { b.refUnits = e2.avgUnitsPerDay; body.querySelector('[data-be="refUnits"]').value = e2.avgUnitsPerDay; }
      markDirty(); drawResults();
    };
    function perDay(v) { return v == null ? '<span class="neg">Not reachable</span>' : '<b>' + Math.ceil(v - 1e-9) + '</b> <span class="pref">(' + (Math.round(v * 10) / 10) + ')</span>'; }
    function drawResults() {
      var c = beCalc(b);
      document.getElementById('underPct').textContent = Math.max(0, 100 - (Number(b.overPct) || 0)) + '%';
      document.getElementById('rentDay').textContent = money(Math.round(c.rentPerDay * 100) / 100) + (Number(b.rentPct) ? ' + ' + b.rentPct + '% of sales' : '');
      var html = '<div class="card card-pad be-card be-main"><div class="k">Break-even</div><div class="be-big">' + perDay(c.bePerDay) + ' <span class="be-unit">games / day</span></div>' +
        (c.beTotal != null ? '<div class="small muted">' + Math.ceil(c.beTotal) + ' games over ' + c.days + ' day' + (c.days === 1 ? '' : 's') + ' · ' + money(Math.round(c.bePerDay * c.price)) + ' sales a day</div>'
          : '<div class="small neg">Each game costs more than it brings in. Raise the price or lower the costs.</div>') + '</div>' +
        '<div class="card card-pad be-card"><div class="k">For ' + (Number(b.targetPct) || 0) + '% profit</div><div class="be-big">' + perDay(c.tPerDay) + ' <span class="be-unit">games / day</span></div>' +
        (c.tTotal != null ? '<div class="small muted">' + money(Math.round(c.tPerDay * c.price)) + ' sales a day</div>' : '') + '</div>';
      if (c.fPerDay != null) {
        var good = c.bePerDay != null && c.fPerDay >= c.bePerDay;
        html += '<div class="card card-pad be-card ' + (good ? 'be-good' : 'be-bad') + '"><div class="k">Forecast</div><div class="be-big"><b>' + (Math.round(c.fPerDay * 10) / 10) + '</b> <span class="be-unit">games / day</span></div>' +
          '<div class="small">' + (good ? '✓ Above break-even' : '✗ Below break-even') + ' · profit ' + (c.fProfit < 0 ? '−' : '') + money(Math.abs(Math.round(c.fProfit))) + ' (' + (Math.round(c.fPct * 10) / 10) + '% of ' + money(Math.round(c.fSales)) + ' sales)</div></div>';
      }
      html += '<div class="card table-wrap"><table class="tbl be-tbl"><tbody>' +
        '<tr><td>Staff</td><td class="num">' + money(Math.round(c.staffCost)) + '</td></tr>' +
        '<tr><td>Fixed rent</td><td class="num">' + money(Number(b.rentFixed) || 0) + '</td></tr>' +
        '<tr><td>Other expenses (fixed)</td><td class="num">' + money(Math.round(c.otherFixed)) + '</td></tr>' +
        '<tr class="strong"><td>Fixed costs</td><td class="num">' + money(Math.round(c.fixed)) + '</td></tr>' +
        '<tr><td>Commission per game <span class="pref">average</span></td><td class="num">' + money(Math.round(c.comm * 100) / 100) + '</td></tr>' +
        '<tr><td>Left from each game <span class="pref">after COGS, % costs, commission</span></td><td class="num">' + money(Math.round(c.contrib * 100) / 100) + '</td></tr>' +
        '</tbody></table></div>';
      if (launched) html += '<div id="beActual"></div>';
      document.getElementById('beResults').innerHTML = html;
      if (launched) drawActual(c);
    }
    function drawActual(c) {
      var el = document.getElementById('beActual');
      if (!el) return;
      if (!state.pnl || state.pnl.id !== ev.id) {
        el.innerHTML = '<div class="card card-pad small muted">Loading actual sales…</div>';
        if (!state.pnlLoading) {
          state.pnlLoading = true;
          api('pnl', { id: ev.id, writeSheet: false }).then(function (res) {
            state.pnlLoading = false; state.pnl = { id: ev.id, data: res.pnl };
            drawActual(beCalc(b));
          }).catch(function () { state.pnlLoading = false; el.innerHTML = ''; });
        }
        return;
      }
      var d = state.pnl.data.dashboard, L = state.pnl.data.lines;
      if (!d.days.length) { el.innerHTML = '<div class="card card-pad small muted">Actual sales show here once the first sales are in.</div>'; return; }
      var good = c.bePerDay != null && d.avgUnitsPerDay >= c.bePerDay;
      el.innerHTML = '<div class="card card-pad be-card ' + (good ? 'be-good' : 'be-bad') + '"><div class="k">Actual so far · ' + d.days.length + ' day' + (d.days.length === 1 ? '' : 's') + ' with sales</div>' +
        '<div class="be-big"><b>' + d.avgUnitsPerDay + '</b> <span class="be-unit">games / day</span></div>' +
        '<div class="small">' + (good ? '✓ Above break-even' : '✗ Below break-even') + ' · net profit so far ' + (L.net < 0 ? '−' : '') + money(Math.abs(L.net)) + ' (' + L.netPct + '%)</div></div>';
    }
    drawOthers();
    drawResults();
    var st0 = document.getElementById('beState');
    st0.textContent = ev.breakeven ? 'Saved.' : 'Starting values: change them, then save.';
    document.getElementById('beForm').onsubmit = function (e) {
      e.preventDefault();
      var btn = document.getElementById('beSave'); btn.disabled = true; btn.textContent = 'Saving…';
      var save = Object.assign({}, b, { others: b.others.filter(function (o) { return o.label || Number(o.amount); }), savedAt: new Date().toISOString() });
      api('saveBreakeven', { id: ev.id, breakeven: save }).then(function (res) {
        state.event = res.event; dirty = false;
        toast('Simulation saved.');
        btn.disabled = false; btn.textContent = 'Save simulation';
        var s3 = document.getElementById('beState'); s3.textContent = 'Saved.'; s3.className = 'small muted';
      }).catch(function (err) {
        btn.disabled = false; btn.textContent = 'Save simulation';
        document.getElementById('beErr').innerHTML = '<div class="form-error">' + esc(err.message) + '</div>';
      });
    };
    leaveGuard(function () { return dirty; });
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
      '<div id="refillBox"></div>' +
      '<div class="toolbar">' +
      '<input class="input search" id="invSearch" type="search" placeholder="Search product, ref code or barcode" value="' + esc(state.invQuery) + '">' +
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
    drawRefills(ev);
  }

  /* refill requests sent from the stock count page */
  function drawRefills(ev) {
    var box = document.getElementById('refillBox');
    if (!box) return;
    if (!state.report || state.report.id !== ev.id) {
      api('eventReport', { id: ev.id }).then(function (res) { state.report = { id: ev.id, data: res.report }; drawRefills(ev); }).catch(function () {});
      return;
    }
    var list = (state.report.data.refills || []);
    var open = list.filter(function (r) { return r.status !== 'Done'; });
    if (!list.length) { box.innerHTML = ''; return; }
    box.innerHTML = '<div class="card card-pad refills"><h3 style="margin-top:0">Refill requests' + (open.length ? ' <span class="pill pill-ended">' + open.length + ' open</span>' : '') + '</h3>' +
      list.slice(0, 12).map(function (r) {
        return '<div class="refill-row' + (r.status === 'Done' ? ' done' : '') + '"><div><b>' + esc(r.at) + '</b> · ' + esc(r.by) + (r.day ? ' · day ' + esc(r.day) : '') +
          '<div>' + r.lines.map(function (l) { return num(l.qty) + '× ' + esc(l.name); }).join(', ') + '</div>' +
          (r.note ? '<div class="small muted">' + esc(r.note) + '</div>' : '') + '</div>' +
          (r.status === 'Done' ? '<span class="pill pill-closed">Done</span>'
            : '<div class="refill-actions">' + (r.lines.length ? '<button class="btn btn-primary btn-sm" data-rstock="' + esc(r.id) + '">Add to stock</button>' : '') +
              '<button class="btn btn-ghost btn-sm" data-rdone="' + esc(r.id) + '">Mark done</button></div>') + '</div>';
      }).join('') +
      '<p class="small muted" style="margin-bottom:0">Add to stock writes the quantities in the Stock Moves tab (today, +qty) and marks the request done. Edit them there if what arrived is different.</p></div>';
    Array.prototype.forEach.call(box.querySelectorAll('[data-rstock],[data-rdone]'), function (b) {
      b.onclick = function () {
        var rid = b.getAttribute('data-rstock') || b.getAttribute('data-rdone');
        b.disabled = true;
        api('setRefill', { id: ev.id, requestId: rid, status: 'Done', toStock: !!b.getAttribute('data-rstock') }).then(function () {
          toast(b.getAttribute('data-rstock') ? 'Added to stock.' : 'Marked done.');
          state.report = null; state.inv = null;
          viewInventory(document.getElementById('tabBody'), ev);
        }).catch(function (err) { b.disabled = false; toast(err.message, true); });
      };
    });
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
        '<th class="num">Stock at opening</th><th class="num">Stock at closing</th><th class="num">Stock change during day</th><th class="num">Demo missing</th><th class="num">Sales</th>' +
        '<th class="num">Demo plays</th><th class="num">Customers activated</th><th></th></tr></thead><tbody>' +
        r.days.map(function (d) {
          var usd = function (v) { return money(v); }, lb = function (v) { return num(v) + ' LBP'; }, u = function (v) { return num(v) + ' units'; };
          return '<tr><td><b>Day ' + esc(d.day) + '</b><div class="pref">' + esc(fmtDay(d.date, false)) + '</div>' + (d.status === 'Open' ? '<span class="pill pill-live">Open</span>' : '') + '</td>' +
            '<td class="small">' + esc(String(d.openedAt).slice(11)) + ' ' + esc(d.openedBy) + '<br>' + esc(String(d.closedAt).slice(11)) + ' ' + esc(d.closedBy) + '</td>' +
            '<td class="num">' + dv(d.openCashUsd, usd) + '<div class="pref">' + dv(d.openCashLbp, lb) + '</div></td>' +
            '<td class="num">' + dv(d.closeCashUsd, usd) + '<div class="pref">' + dv(d.closeCashLbp, lb) + '</div></td>' +
            '<td class="num"><b>' + dv(d.varUsd, usd) + '</b><div class="pref">' + dv(d.varLbp, lb) + '</div></td>' +
            '<td class="num">' + dv(d.openStock, u) + '</td><td class="num">' + dv(d.closeStock, u) + '</td><td class="num"><b>' + dv(d.varStock, u) + '</b></td>' +
            '<td class="num">' + (d.demoMissing === '' ? '–' : num(d.demoMissing)) + '</td>' +
            '<td class="num">' + (d.sales === '' ? '–' : money(d.sales)) + '<div class="pref">' + (d.units === '' ? '' : num(d.units) + ' units') + '</div></td>' +
            '<td class="num">' + (d.demoPlays === '' ? '–' : num(d.demoPlays)) + '</td><td class="num">' + (d.customersActivated === '' ? '–' : num(d.customersActivated)) + '</td>' +
            '<td><button class="btn btn-ghost btn-sm" data-share-day="' + esc(d.day) + '">Share</button></td></tr>' +
            (d.notes ? '<tr class="day-note"><td colspan="13"><span class="pref">Notes:</span> ' + esc(d.notes) + '</td></tr>' : '');
        }).join('') + '</tbody></table></div>' +
        '<p class="small muted">Differences compare counted with expected. "Change during day" is the difference that appeared between that day\'s opening and closing counts: a non-zero value points to the day a variance happened.</p>'
        : '<div class="card empty"><h2>No business days yet</h2><p class="muted">Staff start and close days from the home page of the staff link.</p></div>');
    }
    if (tab === 'customers') {
      var cu = r.customers || [];
      html = refresh + (cu.length ? '<div class="toolbar" style="margin-top:0"><span class="small muted">' + cu.length + ' contact' + (cu.length === 1 ? '' : 's') + ' · also in the Customers tab of the Google Sheet</span>' +
        '<button class="btn btn-ghost btn-sm" id="cuCsv">Download CSV</button></div>' +
        '<div class="card table-wrap"><table class="tbl"><thead><tr><th>When</th><th>Name</th><th>Phone</th><th>Email</th><th>Note</th><th>Added by</th></tr></thead><tbody>' +
        cu.map(function (c) {
          return '<tr><td>' + esc(c.at) + (c.saleId ? '<div class="pref">with a sale</div>' : '') + '</td><td><b>' + esc(c.name) + '</b></td><td>' + esc(c.phone) + '</td><td>' + esc(c.email) + '</td><td>' + esc(c.note) + '</td><td>' + esc(c.by) + '</td></tr>';
        }).join('') + '</tbody></table></div>'
        : '<div class="card empty"><h2>No customer contacts yet</h2><p class="muted">Staff can add a customer\'s name, phone or email at checkout or from the Customers box of the staff link. Every field is optional.</p></div>') +
        (r.demo && (r.demo.plays || r.demo.customers) ? '<p class="small muted">Demo counter: ' + num(r.demo.plays) + ' plays, ' + num(r.demo.customers) + ' customers activated.</p>' : '');
    }
    body.innerHTML = html;
    document.getElementById('repRefresh').onclick = function () { state.report = null; viewReport(body, ev, tab); };
    Array.prototype.forEach.call(body.querySelectorAll('[data-share-day]'), function (b) {
      b.onclick = function () { window.SHN_POS.shareSummary({ eventId: ev.id, token: getToken(), day: Number(b.getAttribute('data-share-day')) }); };
    });
    var csv = document.getElementById('cuCsv');
    if (csv) csv.onclick = function () {
      var q = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
      var text = ['When,Name,Phone,Email,Note,Added by'].concat((r.customers || []).map(function (c) { return [c.at, c.name, c.phone, c.email, c.note, c.by].map(q).join(','); })).join('\n');
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
      a.download = ev.startDate.replace(/-/g, '') + ' - ' + ev.name + ' - customers.csv';
      document.body.appendChild(a); a.click(); a.remove();
    };
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
    var refresh = '<div class="toolbar"><span></span><div class="tb-actions">' + (tab !== 'expenses' ? '<button class="btn btn-ghost" id="pdfBtn">PDF report</button>' : '') +
      '<button class="btn btn-ghost" id="pnlRefresh">Refresh</button></div></div>';
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
        stat('Cash / online', money(d.cash) + '<div class="sub">' + money(d.online) + ' online</div>') +
        (d.demoPlays || d.customersActivated ? stat('Demo plays', num(d.demoPlays)) + stat('Customers activated', num(d.customersActivated)) : '') + '</div>' +
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
        ((d.demoProducts || []).length ? '<div class="card card-pad"><h3>Demo plays</h3>' + (function () {
          var mx = Math.max.apply(null, d.demoProducts.map(function (x) { return x.plays; }).concat([1]));
          return d.demoProducts.slice(0, 12).map(function (x) { return bar(esc(x.name), x.plays, mx, num(x.plays) + ' plays'); }).join('');
        })() + '</div>' : '') +
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
    var pb = document.getElementById('pdfBtn');
    if (pb) pb.onclick = function () { pdfReport(ev); };
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

  /* ---------------- PDF report: a print-ready page, saved as PDF from the print dialog */
  function pdfReport(ev) {
    var w = window.open('', '_blank');
    if (!w) { toast('Allow pop-ups for this site to make the PDF.', true); return; }
    w.document.write('<!doctype html><title>Preparing the report…</title><p style="font-family:sans-serif;padding:24px">Preparing the report…</p>');
    Promise.all([api('pnl', { id: ev.id, writeSheet: true }), api('eventReport', { id: ev.id })]).then(function (res) {
      var p = res[0].pnl, r = res[1].report, L = p.lines, d = p.dashboard;
      state.pnl = { id: ev.id, data: p }; state.report = { id: ev.id, data: r };
      var row = function (k, v, cls) { return '<tr class="' + (cls || '') + '"><td>' + k + '</td><td class="n">' + (v < 0 ? '−' + money(-v) : money(v)) + '</td></tr>'; };
      var people = {};
      r.pay.forEach(function (x) { var q = people[x.name] = people[x.name] || { hours: 0, comm: 0, pay: 0 }; q.hours += x.hours; q.comm += x.commission; q.pay += x.pay; });
      var be = ev.breakeven ? beCalc(Object.assign(beDefaults(ev), ev.breakeven)) : null;
      var logo = location.origin + location.pathname.replace(/index\.html$/, '') + 'assets/logo-dark.png';
      var html = '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(ev.startDate.replace(/-/g, '') + ' - ' + ev.name + ' - report') + '</title><style>' +
        'body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#231F20;margin:28px;font-size:12px}h1{font-size:22px;margin:4px 0}h2{font-size:14px;margin:22px 0 8px;color:#EB5C24;border-bottom:2px solid #EB5C24;padding-bottom:3px}' +
        '.head{display:flex;justify-content:space-between;align-items:center}.head img{height:42px}.sub{color:#666}table{border-collapse:collapse;width:100%}td,th{padding:5px 8px;border-bottom:1px solid #e6e1da;text-align:left}th{background:#f6f1ea}' +
        '.n{text-align:right;white-space:nowrap}.strong td{font-weight:700}.total td{font-weight:700;font-size:14px;border-top:2px solid #231F20}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}' +
        '.box{border:1px solid #e6e1da;border-radius:8px;padding:8px}.box .k{color:#666;font-size:11px}.box .v{font-size:16px;font-weight:700}.two{display:grid;grid-template-columns:1fr 1fr;gap:18px}.neg{color:#b42318}' +
        '@media print{body{margin:12mm}button{display:none}}</style></head><body>' +
        '<div class="head"><div><div class="sub">SHN LEB · Event report</div><h1>' + esc(ev.name) + '</h1><div class="sub">' + esc(fmtRange(ev.startDate, ev.endDate)) + (ev.venue ? ' · ' + esc(ev.venue) : '') + '</div></div><img src="' + logo + '" alt="SHN"></div>' +
        '<h2>Key figures</h2><div class="grid">' +
        [['Sales', money(d.sales)], ['Units sold', num(d.units)], ['Sales made', num(d.tickets)], ['Average sale', money(d.avgTicket)],
          ['Per day', money(d.avgPerDay)], ['Units per day', d.avgUnitsPerDay], ['Cash / online', money(d.cash) + ' / ' + money(d.online)], ['Net profit', money(L.net) + ' (' + L.netPct + '%)'],
          ['Demo plays', num(d.demoPlays || 0)], ['Customers activated', num(d.customersActivated || 0)], ['Contacts collected', num((r.customers || []).length)], ['Break-even', be && be.bePerDay != null ? Math.ceil(be.bePerDay) + ' games / day' : '–']]
          .map(function (x) { return '<div class="box"><div class="k">' + x[0] + '</div><div class="v">' + x[1] + '</div></div>'; }).join('') + '</div>' +
        '<div class="two"><div><h2>P&amp;L</h2><table>' + row('Sales (VAT included)', L.sales, 'strong') + row('COGS (' + p.cogsPct + '% of SHN products)', -L.cogs) + row('Owed to external partners', -L.partnersOwed) +
        row('Gross margin', L.gross, 'strong') + row('Staff pay', -L.staffCost) + Object.keys(L.expensesByType).sort().map(function (k) { return row('Expenses: ' + esc(k), -L.expensesByType[k]); }).join('') +
        row('Net profit', L.net, 'total') + '</table><p class="sub">Returns refunded: ' + money(L.returns) + ' · VAT included in sales: ' + money(L.vatIncluded) + '</p></div>' +
        '<div><h2>Top products</h2><table><tr><th>Product</th><th class="n">Units</th><th class="n">Sales</th></tr>' + d.products.slice(0, 12).map(function (x) { return '<tr><td>' + esc(x.name) + '</td><td class="n">' + num(x.units) + '</td><td class="n">' + money(x.sales) + '</td></tr>'; }).join('') + '</table></div></div>' +
        '<h2>Days</h2><table><tr><th>Day</th><th class="n">Sales</th><th class="n">Units</th><th class="n">Cash diff (closing)</th><th class="n">Stock diff</th><th class="n">Demo plays</th><th class="n">Customers</th><th>Notes</th></tr>' +
        r.days.slice().reverse().map(function (x) {
          return '<tr><td>Day ' + esc(x.day) + ' · ' + esc(fmtDay(x.date, false)) + '</td><td class="n">' + (x.sales === '' ? '–' : money(x.sales)) + '</td><td class="n">' + (x.units === '' ? '–' : num(x.units)) + '</td>' +
            '<td class="n">' + (x.closeCashUsd === '' ? '–' : money(x.closeCashUsd) + ' / ' + num(x.closeCashLbp) + ' LBP') + '</td><td class="n">' + (x.closeStock === '' ? '–' : num(x.closeStock)) + '</td>' +
            '<td class="n">' + (x.demoPlays === '' ? '–' : num(x.demoPlays)) + '</td><td class="n">' + (x.customersActivated === '' ? '–' : num(x.customersActivated)) + '</td><td>' + esc(x.notes || '') + '</td></tr>';
        }).join('') + '</table>' +
        '<div class="two"><div><h2>Staff</h2><table><tr><th>Employee</th><th class="n">Hours</th><th class="n">Commission</th><th class="n">Pay</th></tr>' +
        Object.keys(people).sort().map(function (n) { var q = people[n]; return '<tr><td>' + esc(n) + '</td><td class="n">' + q.hours.toFixed(2) + '</td><td class="n">' + money(q.comm) + '</td><td class="n">' + money(q.pay) + '</td></tr>'; }).join('') + '</table></div>' +
        '<div><h2>By category</h2><table>' + d.categories.map(function (x) { return '<tr><td>' + esc(x.name) + '</td><td class="n">' + num(x.units) + (x.units === 1 ? ' unit' : ' units') + '</td><td class="n">' + money(x.sales) + '</td></tr>'; }).join('') + '</table>' +
        (p.partners.length ? '<h2>External partners</h2><table>' + p.partners.map(function (x) { return '<tr><td>' + esc(x.partner) + '</td><td class="n">' + num(x.units) + (x.units === 1 ? ' unit' : ' units') + '</td><td class="n">owed ' + money(x.owed) + '</td></tr>'; }).join('') + '</table>' : '') + '</div></div>' +
        '<p class="sub" style="margin-top:24px">Made ' + esc(new Date().toLocaleString('en-GB')) + ' · SHN LEB Events v' + APP_VERSION + '</p>' +
        '<button onclick="print()" style="margin-top:10px;padding:10px 16px">Print / save as PDF</button></body></html>';
      w.document.open(); w.document.write(html); w.document.close();
      w.onload = function () { setTimeout(function () { try { w.print(); } catch (e) { /* the button is there */ } }, 300); };
    }).catch(function (err) {
      w.document.body.innerHTML = '<p style="font-family:sans-serif;padding:24px">Couldn\'t make the report: ' + esc(err.message) + '</p>';
    });
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
      return !q || i.name.toLowerCase().indexOf(q) >= 0 || String(i.ref).toLowerCase().indexOf(q) >= 0 ||
        (i.barcodes || []).some(function (b) { return b.indexOf(q) >= 0; });
    });
    var el = document.getElementById('invList');
    if (!shown.length) { el.innerHTML = '<div class="card empty"><p class="muted">No products match.</p></div>'; return; }
    function liveCls(i) { return i.live < 0 ? 'neg' : i.live === 0 ? 'zero' : ''; }
    function nameCell(i) {
      return '<div class="pname">' + esc(i.name) + '</div><div class="pref">' + esc(i.ref) +
        ((i.barcodes || []).length ? ' · <span class="barcode">' + esc(i.barcodes.join(', ')) + '</span>' : (i.consignment ? '' : ' · <span class="muted">no barcode</span>')) + '</div>';
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

  var lastHash = location.hash;
  var skipGuard = false;
  function onHash() {
    if (skipGuard) { skipGuard = false; return; }
    if (guardFn && guardFn() && !window.confirm('You have changes that are not saved. Leave this page anyway?')) {
      skipGuard = true;
      location.hash = lastHash;
      return;
    }
    render();
  }

  function render() {
    guardFn = null;
    lastHash = location.hash;
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
    if (m) return viewEvent(decodeURIComponent(m[1]), m[2] || 'info');
    return viewHome();
  }

  window.SHN = {
    api: api, esc: esc, num: num, money: money, toast: toast, fmtRange: fmtRange, phase: phase,
    version: APP_VERSION, reportError: reportError,
    app: app, topbarRight: topbarRight, isAdmin: function () { return !!getToken(); }
  };

  window.addEventListener('hashchange', onHash);
  window.addEventListener('DOMContentLoaded', function () { render(); });
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }
})();
