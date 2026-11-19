/* SHN Events — web app (Phase 1: admin login, events home, new event, event page) */
(function () {
  'use strict';

  var API_URL = (window.SHN_CONFIG && window.SHN_CONFIG.API_URL) || '';
  var TOKEN_KEY = 'shn-events-admin';
  var TABS = [
    { id: 'settings', label: 'Settings' },
    { id: 'inventory', label: 'Inventory', phase: 2 },
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
  var state = { events: null, filter: 'all', event: null };

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
  function money(n) { return '$' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 }); }

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
      '<h1>Management sign in</h1>' +
      '<p class="muted">Create and manage SHN events.</p>' +
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
      '<h2 class="section-title">Staff access</h2>' +
      '<div class="kv">' + item('PIN', esc(s.pin || '—')) + '</div>' +
      '<div class="card card-pad" style="margin-top:12px">' +
      '<div class="small muted" style="margin-bottom:8px">Staff link (the POS opens here from phase 3)</div>' +
      '<div class="share"><code id="staffLink">' + esc(staffLink(ev)) + '</code>' +
      '<button class="btn btn-ghost" id="copyLink">Copy</button></div></div>';
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
