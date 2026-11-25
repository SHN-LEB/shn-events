/* SHN LEB Promoters — management pages (portal) and the promoter phone link (?p=<project>&u=<promoter>) */
(function () {
  'use strict';

  var S;
  var TAB_COLORS = ['#fde3d6', '#dcebff', '#dff3e4', '#fff0c2', '#ece2ff', '#ffe0ea', '#d9f3f3', '#f1e9dc'];
  var TAB_INK = ['#8a3a12', '#1f4fb8', '#1a6b3e', '#7a5a00', '#5b3aa6', '#a3244f', '#11686b', '#5e4a2c'];

  function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* full or blocked */ } }
  function drop(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  function uid(prefix) { return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function hhmm(t) { var d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function picUrl(u) {
    if (!u) return '';
    if (/cdn\.shopify\.com|\/cdn\/shop\//.test(u)) return u + (u.indexOf('?') >= 0 ? '&' : '?') + 'width=300';
    return u;
  }
  function initials(name) {
    return String(name).replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 2)
      .map(function (w) { return w.charAt(0).toUpperCase(); }).join('');
  }
  function storeLabel(l) { return l.store + (l.branch ? ' ' + l.branch : ''); }
  function base() { return location.origin + location.pathname.replace(/index\.html$/, ''); }
  function promoLink(projectId, promoterId) { return base() + '?p=' + encodeURIComponent(projectId) + '&u=' + encodeURIComponent(promoterId); }
  function copy(text, done) {
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
      .then(function () { S.toast(done); }, function () { S.toast('Select the text and copy it.'); });
  }
  function share(title, text, link) {
    if (navigator.share) navigator.share({ title: title, text: text, url: link }).catch(function () {});
    else window.open('https://wa.me/?text=' + encodeURIComponent(text + '\n' + link), '_blank', 'noopener');
  }
  function rateText(p) {
    var parts = [];
    if (p.hourlyRate) parts.push(S.money(p.hourlyRate) + '/h');
    if (p.threshold == null) { if (p.commissionUnder) parts.push(S.money(p.commissionUnder) + '/unit'); }
    else parts.push(S.money(p.commissionUnder) + '/unit under ' + S.money(p.threshold) + ', ' + S.money(p.commissionOver) + ' at or over');
    return parts.join(' · ') || 'No pay set';
  }

  /* ================================================================ MANAGEMENT (portal) */
  var st = { projects: null, project: null, report: null };

  function admin(hash) {
    S = window.SHN;
    var m = hash.match(/^#\/project\/([^/]+)\/?([a-z]*)$/);
    if (m) return viewProject(decodeURIComponent(m[1]), m[2] || 'team');
    return viewProjects();
  }

  function viewProjects() {
    if (!st.projects) {
      S.loading('Loading projects…');
      S.api('listProjects').then(function (res) { st.projects = res.projects || []; viewProjects(); }).catch(function (e) { S.showError(e); });
      return;
    }
    var list = st.projects.slice().sort(function (a, b) {
      if (a.status !== b.status) return a.status === 'Open' ? -1 : 1;
      return a.createdAt > b.createdAt ? -1 : 1;
    });
    S.app.innerHTML = S.sectionNav('promoters') +
      '<div class="page-head"><h1>Promoters</h1><button class="btn btn-accent" id="newProj">+ New project</button></div>' +
      (list.length ? '<div class="grid">' + list.map(function (p) {
        return '<a class="card event-card" href="#/project/' + encodeURIComponent(p.id) + '/team">' +
          '<div class="event-card-top"><h3>' + S.esc(p.name) + '</h3><span class="pill ' + (p.status === 'Open' ? 'pill-live' : 'pill-closed') + '">' + S.esc(p.status) + '</span></div>' +
          '<div class="event-meta"><div>Started ' + S.esc(String(p.createdAt).slice(0, 10)) + '</div></div></a>';
      }).join('') + '</div>'
        : '<div class="card empty"><h2>No projects yet</h2><p class="muted">A project is a promoters campaign in stores (for example Spinneys Christmas). It gets its own Google Sheet with the promoters, stores, games and results.</p>' +
          '<button class="btn btn-accent" id="newProj2">+ New project</button></div>');
    var open = function () {
      dialog('New project', '<div class="field"><label for="pjName">Project name</label><input class="input" id="pjName" maxlength="80" required placeholder="e.g. Spinneys Christmas 2026"></div>' +
        '<p class="muted small">Creates the project\'s Google Sheet in the promoters folder. You add promoters, stores and games next.</p>', 'Create project',
      function (box, done, fail) {
        S.api('createProject', { name: box.querySelector('#pjName').value.trim() }).then(function (res) {
          done();
          st.projects.push(res.project);
          st.project = res.project;
          S.go('#/project/' + encodeURIComponent(res.project.id) + '/team');
        }).catch(fail);
      });
    };
    document.getElementById('newProj').onclick = open;
    var b2 = document.getElementById('newProj2');
    if (b2) b2.onclick = open;
  }

  /* small form dialog: onSubmit(box, done, fail) */
  function dialog(title, body, submitLabel, onSubmit, extraBtn) {
    var wrap = document.createElement('div');
    wrap.className = 'dialog-backdrop';
    wrap.innerHTML = '<form class="card dialog" role="dialog" aria-modal="true"><h2>' + S.esc(title) + '</h2><div class="dlg-err"></div>' + body +
      '<div class="dialog-actions">' + (extraBtn || '') + '<button type="button" class="btn btn-ghost" data-cancel>Cancel</button>' +
      '<button type="submit" class="btn btn-primary" data-ok>' + S.esc(submitLabel) + '</button></div></form>';
    document.body.appendChild(wrap);
    var form = wrap.querySelector('form');
    var close = function () { wrap.remove(); };
    wrap.querySelector('[data-cancel]').onclick = close;
    wrap.addEventListener('click', function (e) { if (e.target === wrap) close(); });
    var first = form.querySelector('input,select,textarea');
    if (first) setTimeout(function () { first.focus(); }, 30);
    var btn = wrap.querySelector('[data-ok]');
    form.onsubmit = function (e) {
      e.preventDefault();
      btn.disabled = true;
      onSubmit(form, close, function (err) {
        btn.disabled = false;
        form.querySelector('.dlg-err').innerHTML = '<div class="form-error">' + S.esc(err.message || err) + '</div>';
      });
    };
    return form;
  }

  var PTABS = [{ id: 'team', label: 'Promoters' }, { id: 'stores', label: 'Stores' }, { id: 'games', label: 'Games' }, { id: 'results', label: 'Results' }];

  function viewProject(id, tab) {
    if (!st.project || st.project.id !== id || !st.project.promoters) {
      S.loading('Loading project…');
      S.api('getProject', { id: id }).then(function (res) { st.project = res.project; st.report = null; viewProject(id, tab); })
        .catch(function (e) { S.showError(e, true); });
      return;
    }
    var p = st.project;
    S.app.innerHTML = S.sectionNav('promoters') +
      '<a class="back" href="#/promoters">‹ All projects</a>' +
      '<div class="page-head" style="margin-bottom:6px"><h1>' + S.esc(p.name) + '</h1>' +
      '<div class="head-actions"><span class="pill ' + (p.status === 'Open' ? 'pill-live' : 'pill-closed') + '">' + S.esc(p.status) + '</span>' +
      '<a class="btn btn-ghost btn-sm" href="' + S.esc(p.sheetUrl) + '" target="_blank" rel="noopener">Open Google Sheet</a>' +
      '<button class="btn btn-ghost btn-sm" id="pjStatus">' + (p.status === 'Open' ? 'Close project' : 'Reopen') + '</button></div></div>' +
      '<nav class="tabs">' + PTABS.map(function (t) {
        return '<a class="tab' + (t.id === tab ? ' active' : '') + '" href="#/project/' + encodeURIComponent(id) + '/' + t.id + '">' + t.label + '</a>';
      }).join('') + '</nav><div id="ptab"></div>';
    document.getElementById('pjStatus').onclick = function () {
      var to = p.status === 'Open' ? 'Closed' : 'Open';
      if (to === 'Closed' && !window.confirm('Close this project? Promoter links stop working until you reopen it.')) return;
      S.api('setProjectStatus', { id: id, status: to }).then(function (res) {
        st.project = res.project;
        (st.projects || []).forEach(function (x) { if (x.id === id) x.status = to; });
        viewProject(id, tab);
      }).catch(function (e) { S.toast(e.message, true); });
    };
    var el = document.getElementById('ptab');
    if (tab === 'stores') return tabStores(el, p);
    if (tab === 'games') return tabGames(el, p);
    if (tab === 'results') return tabResults(el, p);
    return tabTeam(el, p);
  }

  function refreshProject(res) { st.project = res.project; viewProject(st.project.id, (location.hash.split('/')[3] || 'team')); }

  function promoterForm(x) {
    x = x || {};
    var v = function (n) { return n == null || n === '' ? '' : String(n); };
    return '<div class="field"><label for="prName">Name</label><input class="input" id="prName" maxlength="80" required value="' + S.esc(x.name || '') + '"></div>' +
      '<div class="row-2"><div class="field"><label for="prRate">Hourly rate (USD)</label><input class="input" id="prRate" type="number" min="0" step="0.01" inputmode="decimal" value="' + v(x.hourlyRate) + '"></div>' +
      '<div class="field"><label for="prTh">Threshold (USD)</label><input class="input" id="prTh" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Empty: one rate" value="' + v(x.threshold) + '"></div></div>' +
      '<div class="row-2"><div class="field"><label for="prUnder" id="prUnderL">Commission per unit, under threshold</label><input class="input" id="prUnder" type="number" min="0" step="0.01" inputmode="decimal" value="' + v(x.commissionUnder) + '"></div>' +
      '<div class="field" id="prOverF"><label for="prOver">Commission per unit, at or over</label><input class="input" id="prOver" type="number" min="0" step="0.01" inputmode="decimal" value="' + v(x.commissionOver) + '"></div></div>' +
      '<p class="small muted">The threshold is the game\'s price. Leave it empty to pay the same commission on every unit.</p>';
  }
  function wirePromoterForm(box) {
    var th = box.querySelector('#prTh');
    var sync = function () {
      var flat = th.value === '';
      box.querySelector('#prOverF').style.display = flat ? 'none' : '';
      box.querySelector('#prUnderL').textContent = flat ? 'Commission per unit' : 'Commission per unit, under threshold';
    };
    th.oninput = sync; sync();
  }
  function readPromoterForm(box) {
    var n = function (sel) { var v = box.querySelector(sel).value; return v === '' ? '' : Number(v); };
    return { name: box.querySelector('#prName').value.trim(), hourlyRate: n('#prRate'), threshold: n('#prTh'), commissionUnder: n('#prUnder'), commissionOver: box.querySelector('#prTh').value === '' ? '' : n('#prOver') };
  }

  function tabTeam(el, p) {
    var list = p.promoters || [];
    el.innerHTML = '<div class="page-head" style="margin-bottom:10px"><h2 class="section-title" style="margin:0">Promoters</h2><button class="btn btn-accent btn-sm" id="addPr">+ Add promoter</button></div>' +
      (list.length ? '<div class="pr-list">' + list.map(function (x) {
        var link = promoLink(p.id, x.id);
        return '<div class="card pr-card' + (x.active ? '' : ' off') + '" data-id="' + S.esc(x.id) + '">' +
          '<div class="pr-top"><div><b>' + S.esc(x.name) + '</b> <span class="small muted">' + S.esc(x.id) + '</span>' +
          (x.active ? '' : ' <span class="pill pill-closed">Inactive</span>') +
          '<div class="small muted">' + S.esc(rateText(x)) + '</div></div>' +
          '<div class="pr-now">' + (x.onShift ? '<span class="pill pill-live">On shift since ' + S.esc(String(x.onShift.since).slice(11, 16)) + '</span><div class="small muted">' + S.esc(x.onShift.stores) + '</div>' : '<span class="small muted">Not clocked in</span>') +
          '<div class="small"><b>' + S.num(x.unitsToday) + '</b> units today</div></div></div>' +
          '<div class="pr-access"><div class="pr-code"><span class="small muted">Code</span><b>' + S.esc(x.code) + '</b></div>' +
          '<div class="share" style="flex:1"><code>' + S.esc(link) + '</code>' +
          '<button class="btn btn-ghost btn-sm" data-copy>Copy</button><button class="btn btn-ghost btn-sm" data-share>Share</button></div></div>' +
          '<div class="pr-actions"><button class="link-btn" data-edit>Edit pay</button><button class="link-btn" data-code>New code</button>' +
          '<button class="link-btn" data-active>' + (x.active ? 'Deactivate' : 'Activate') + '</button></div></div>';
      }).join('') + '</div>'
        : '<div class="card empty"><p class="muted">No promoters yet. Add one: each promoter gets a personal link and a 4-digit code.</p></div>') +
      '<p class="small muted" style="margin-top:14px">Send the link and the code separately. A new code signs the promoter out on their phone. Links work until the project is closed.</p>';
    document.getElementById('addPr').onclick = function () {
      var f = dialog('Add promoter', promoterForm(), 'Add promoter', function (box, done, fail) {
        var d = readPromoterForm(box);
        if (!d.name) return fail(new Error('Enter the name.'));
        S.api('savePromoter', { id: p.id, promoter: d }).then(function (res) { done(); refreshProject(res); S.toast(d.name + ' added.'); }).catch(fail);
      });
      wirePromoterForm(f);
    };
    Array.prototype.forEach.call(el.querySelectorAll('.pr-card'), function (card) {
      var x = list.filter(function (y) { return y.id === card.getAttribute('data-id'); })[0];
      var link = promoLink(p.id, x.id);
      card.querySelector('[data-copy]').onclick = function () { copy(link, 'Link copied.'); };
      card.querySelector('[data-share]').onclick = function () {
        share('SHN LEB · ' + p.name, 'SHN LEB · ' + p.name + ': your promoter link, ' + x.name + '. Your manager gives you the code.', link);
      };
      card.querySelector('[data-edit]').onclick = function () {
        var f = dialog('Edit ' + x.name, promoterForm(x), 'Save', function (box, done, fail) {
          var d = readPromoterForm(box);
          d.id = x.id;
          S.api('savePromoter', { id: p.id, promoter: d }).then(function (res) { done(); refreshProject(res); S.toast('Saved.'); }).catch(fail);
        });
        wirePromoterForm(f);
      };
      card.querySelector('[data-code]').onclick = function () {
        if (!window.confirm('Give ' + x.name + ' a new code? They are signed out and need the new code.')) return;
        S.api('savePromoter', { id: p.id, promoter: { id: x.id, newCode: true } }).then(function (res) { refreshProject(res); S.toast('New code made.'); }).catch(function (e) { S.toast(e.message, true); });
      };
      card.querySelector('[data-active]').onclick = function () {
        S.api('savePromoter', { id: p.id, promoter: { id: x.id, active: !x.active } }).then(refreshProject).catch(function (e) { S.toast(e.message, true); });
      };
    });
  }

  function storeForm(l) {
    l = l || {};
    return '<div class="field"><label for="lcStore">Store</label><input class="input" id="lcStore" maxlength="80" required placeholder="e.g. Spinneys" value="' + S.esc(l.store || '') + '"></div>' +
      '<div class="field"><label for="lcBranch">Location / branch</label><input class="input" id="lcBranch" maxlength="80" placeholder="e.g. Achrafieh" value="' + S.esc(l.branch || '') + '"></div>' +
      '<div class="field"><label for="lcLogo">Logo URL <span class="muted small">(optional)</span></label><input class="input" id="lcLogo" maxlength="500" placeholder="https://…" value="' + S.esc(l.logo || '') + '"></div>' +
      '<div class="field"><label for="lcNotes">Notes</label><input class="input" id="lcNotes" maxlength="300" value="' + S.esc(l.notes || '') + '"></div>';
  }
  function readStore(box) {
    return { store: box.querySelector('#lcStore').value.trim(), branch: box.querySelector('#lcBranch').value.trim(), logo: box.querySelector('#lcLogo').value.trim(), notes: box.querySelector('#lcNotes').value.trim() };
  }

  function tabStores(el, p) {
    var list = p.locations || [];
    el.innerHTML = '<div class="page-head" style="margin-bottom:10px"><h2 class="section-title" style="margin:0">Stores</h2><button class="btn btn-accent btn-sm" id="addLc">+ Add store</button></div>' +
      (list.length ? '<div class="card table-wrap"><table class="tbl"><thead><tr><th>ID</th><th>Store</th><th>Location / branch</th><th>Logo</th><th>Notes</th><th></th></tr></thead><tbody>' +
        list.map(function (l) {
          return '<tr><td class="muted">' + S.esc(l.id) + '</td><td><b>' + S.esc(l.store) + '</b></td><td>' + S.esc(l.branch) + '</td>' +
            '<td>' + (l.logo ? '<img class="lc-logo" src="' + S.esc(l.logo) + '" alt="">' : '<span class="muted">–</span>') + '</td><td class="small">' + S.esc(l.notes) + '</td>' +
            '<td><button class="link-btn" data-lc="' + S.esc(l.id) + '">Edit</button></td></tr>';
        }).join('') + '</tbody></table></div>'
        : '<div class="card empty"><p class="muted">No stores yet. Add the stores where promoters work: promoters pick them when they clock in.</p></div>') +
      '<p class="small muted" style="margin-top:12px">Stores can also be typed in the Locations tab of the project sheet.</p>';
    document.getElementById('addLc').onclick = function () {
      dialog('Add store', storeForm(), 'Add store', function (box, done, fail) {
        S.api('saveLocation', { id: p.id, location: readStore(box) }).then(function (res) { done(); refreshProject(res); }).catch(fail);
      });
    };
    Array.prototype.forEach.call(el.querySelectorAll('[data-lc]'), function (b) {
      var l = list.filter(function (x) { return x.id === b.getAttribute('data-lc'); })[0];
      b.onclick = function () {
        dialog('Edit store', storeForm(l), 'Save', function (box, done, fail) {
          var d = readStore(box); d.id = l.id;
          S.api('saveLocation', { id: p.id, location: d }).then(function (res) { done(); refreshProject(res); }).catch(fail);
        });
      };
    });
  }

  function tabGames(el, p) {
    var list = p.products || [];
    el.innerHTML = '<div class="note">Pick the games in the <b>Products</b> tab of the project sheet: choose each one from the dropdown in column A (Ref, price and category fill in by themselves). Then reload this page.</div>' +
      '<div style="margin:12px 0"><a class="btn btn-ghost btn-sm" href="' + S.esc(p.sheetUrl) + '" target="_blank" rel="noopener">Open Google Sheet</a> <button class="btn btn-ghost btn-sm" id="reloadG">Reload</button></div>' +
      (list.length ? '<div class="card table-wrap"><table class="tbl"><thead><tr><th>Game</th><th>Ref</th><th>Category</th><th class="num">Price</th></tr></thead><tbody>' +
        list.map(function (x) { return '<tr><td><b>' + S.esc(x.name) + '</b></td><td class="muted">' + S.esc(x.ref) + '</td><td>' + S.esc(x.category) + '</td><td class="num">' + S.money(x.price) + '</td></tr>'; }).join('') +
        '</tbody></table></div>' : '<div class="card empty"><p class="muted">No games picked yet.</p></div>');
    document.getElementById('reloadG').onclick = function () { st.project = null; viewProject(p.id, 'games'); };
  }

  function tabResults(el, p) {
    if (!st.report) {
      el.innerHTML = '<div class="loading"><div class="spinner"></div><div>Adding up results…</div></div>';
      S.api('projectReport', { id: p.id }).then(function (res) { st.report = res.report; if (document.getElementById('ptab') === el) tabResults(el, p); })
        .catch(function (e) { el.innerHTML = '<div class="card empty"><p class="neg">' + S.esc(e.message) + '</p></div>'; });
      return;
    }
    var r = st.report, t = r.totals;
    var tbl = function (head, rows) {
      return '<div class="card table-wrap"><table class="tbl"><thead><tr>' + head.map(function (h) { return '<th' + (h.charAt(0) === '#' ? ' class="num"' : '') + '>' + S.esc(h.replace(/^#/, '')) + '</th>'; }).join('') +
        '</tr></thead><tbody>' + (rows.length ? rows.join('') : '<tr><td colspan="' + head.length + '" class="muted">Nothing yet.</td></tr>') + '</tbody></table></div>';
    };
    el.innerHTML = '<div class="stats">' +
      [['Units sold', S.num(t.units)], ['People activated', S.num(t.activated)], ['Hours', S.num(t.hours)], ['Pay', S.money(t.pay)]].map(function (s) {
        return '<div class="card stat"><div class="k">' + s[0] + '</div><div class="v">' + s[1] + '</div></div>';
      }).join('') + '</div>' +
      '<div style="text-align:right;margin:-4px 0 6px"><button class="link-btn" id="reloadR">Refresh</button></div>' +
      '<h2 class="section-title">Promoters</h2>' +
      tbl(['Promoter', '#Days', '#Hours', '#Units', '#Activated', '#Hourly pay', '#Commission', '#Total pay'], r.promoters.map(function (x) {
        return '<tr><td><b>' + S.esc(x.name) + '</b></td><td class="num">' + x.dayCount + '</td><td class="num">' + S.num(x.hours) + '</td><td class="num">' + S.num(x.units) + '</td><td class="num">' + S.num(x.activated) + '</td>' +
          '<td class="num">' + S.money(x.hourlyPay) + '</td><td class="num">' + S.money(x.commission) + '</td><td class="num"><b>' + S.money(x.pay) + '</b></td></tr>';
      })) +
      '<h2 class="section-title">Stores</h2>' +
      tbl(['Store', '#Units', '#Activated'], r.stores.map(function (x) { return '<tr><td>' + S.esc(x.store) + '</td><td class="num">' + S.num(x.units) + '</td><td class="num">' + S.num(x.activated) + '</td></tr>'; })) +
      '<h2 class="section-title">Games</h2>' +
      tbl(['Game', '#Units'], r.games.map(function (x) { return '<tr><td>' + S.esc(x.name) + '</td><td class="num">' + S.num(x.units) + '</td></tr>'; })) +
      '<h2 class="section-title">Days</h2>' +
      tbl(['Date', '#Promoters', '#Units', '#Activated'], r.days.map(function (x) { return '<tr><td>' + S.esc(x.date) + '</td><td class="num">' + x.promoters + '</td><td class="num">' + S.num(x.units) + '</td><td class="num">' + S.num(x.activated) + '</td></tr>'; })) +
      '<h2 class="section-title">Shifts</h2>' +
      tbl(['Promoter', 'In', 'Out', '#Hours', 'Stores', 'Note'], r.shifts.map(function (x) {
        return '<tr><td>' + S.esc(x.promoter) + '</td><td>' + S.esc(x.clockIn) + '</td><td>' + (x.clockOut ? S.esc(x.clockOut.slice(11)) : '<span class="pill pill-live">On shift</span>') + '</td>' +
          '<td class="num">' + (x.hours == null ? '–' : S.num(x.hours)) + '</td><td class="small">' + S.esc(x.stores) + '</td><td class="small">' + S.esc(x.note) + '</td></tr>';
      }));
    document.getElementById('reloadR').onclick = function () { st.report = null; tabResults(el, p); };
  }

  /* ================================================================ PROMOTER LINK (phone) */
  var P = null; // the running promoter app
  var timers = [];

  function keys(pj, pr) {
    var k = pj + '-' + pr;
    return { tok: 'shn-promo-tok-' + k, data: 'shn-promo-data-' + k, shift: 'shn-promo-shift-' + k, fav: 'shn-promo-fav-' + k };
  }

  function promoter(projectId, promoterId) {
    S = window.SHN;
    document.body.classList.add('pos-mode', 'promo-mode');
    var nm = document.querySelector('.brand-name');
    if (nm) nm.textContent = 'LEB Promoters';
    if (P && P.projectId === projectId && P.promoterId === promoterId && S.app.contains(P.root)) return;
    var k = keys(projectId, promoterId);
    var t = load(k.tok, null);
    P = { projectId: projectId, promoterId: promoterId, k: k, token: t && t.expires > Date.now() ? t.token : null, root: null };
    if (!P.token) return codeScreen();
    start();
  }

  function api(action, data) {
    return S.api(action, Object.assign({ projectId: P.projectId }, data || {}), { token: P.token || 'none', quiet: true }).catch(function (err) {
      if (err.code === 'auth') signOut('Please enter your code again.');
      throw err;
    });
  }

  function signOut(msg) {
    drop(P.k.tok);
    P.token = null;
    stopTimers();
    codeScreen(msg);
  }
  function stopTimers() { timers.forEach(clearInterval); timers = []; }

  function topbar(name) {
    S.topbarRight.innerHTML = name ? '<span class="topbar-event">' + S.esc(name) + '</span>' : '';
  }

  function codeScreen(msg) {
    topbar('');
    var cached = load(P.k.data, null);
    var code = '';
    S.app.innerHTML = '<div class="login-wrap"><div class="card login-card pin-card">' +
      '<img class="login-logo" src="assets/logo-dark.png" alt="Superheated Neurons">' +
      '<h1 id="pcName">' + S.esc(cached ? 'Hi ' + cached.promoter.name : 'Promoter sign in') + '</h1>' +
      '<p class="muted" id="pcProj">' + S.esc(cached ? cached.project.name : '') + '</p>' +
      '<p class="muted">Enter your 4-digit code.</p><div id="pcErr">' + (msg ? '<div class="form-error">' + S.esc(msg) + '</div>' : '') + '</div>' +
      '<div class="pin-dots" id="pinDots"><span></span><span></span><span></span><span></span></div>' +
      '<div class="keypad">' + [1, 2, 3, 4, 5, 6, 7, 8, 9, '', 0, '⌫'].map(function (k) {
        return k === '' ? '<span></span>' : '<button type="button" class="key" data-k="' + k + '">' + k + '</button>';
      }).join('') + '</div></div></div>';
    S.api('promoterPublic', { projectId: P.projectId, promoterId: P.promoterId }, { quiet: true }).then(function (res) {
      var h = document.getElementById('pcName'), pj = document.getElementById('pcProj');
      if (h) h.textContent = 'Hi ' + res.info.name;
      if (pj) pj.textContent = res.info.project;
    }).catch(function (err) {
      if (err.code === 'closed' || err.code === 'not_found') {
        S.app.innerHTML = '<div class="card empty"><h2>' + S.esc(err.code === 'closed' ? 'This project is closed' : 'Link not active') + '</h2><p class="muted">Ask your manager.</p></div>';
      }
    });
    var busy = false;
    function draw() { Array.prototype.forEach.call(document.querySelectorAll('#pinDots span'), function (d, i) { d.className = i < code.length ? 'on' : ''; }); }
    function press(k) {
      if (busy) return;
      if (k === '⌫') code = code.slice(0, -1); else if (code.length < 4) code += k;
      draw();
      if (code.length === 4) submit();
    }
    function submit() {
      busy = true;
      document.getElementById('pcErr').innerHTML = '<div class="muted small" style="margin-bottom:10px">Checking…</div>';
      S.api('promoterLogin', { projectId: P.projectId, promoterId: P.promoterId, code: code }, { quiet: true }).then(function (res) {
        document.removeEventListener('keydown', onKey);
        save(P.k.tok, { token: res.token, expires: res.expires });
        P.token = res.token;
        start();
      }).catch(function (err) {
        busy = false; code = ''; draw();
        var b = document.getElementById('pcErr');
        if (b) b.innerHTML = '<div class="form-error">' + S.esc(err.message) + '</div>';
      });
    }
    function onKey(e) {
      if (!document.getElementById('pinDots')) { document.removeEventListener('keydown', onKey); return; }
      if (/^[0-9]$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('⌫');
    }
    document.addEventListener('keydown', onKey);
    Array.prototype.forEach.call(document.querySelectorAll('.key'), function (b) { b.onclick = function () { press(b.getAttribute('data-k')); }; });
  }

  /* shift kept on the phone: { id, date, clockIn, locations[], active, counts{loc:{ref:n,_act:n}}, segments[{loc,from}], sentIn, dirty, out } */
  function shift() { return load(P.k.shift, null); }
  function setShift(s) { if (s) save(P.k.shift, s); else drop(P.k.shift); }

  function start() {
    P.data = load(P.k.data, null);
    S.app.innerHTML = '<div class="promo" id="promo"></div>';
    P.root = document.getElementById('promo');
    if (P.data) { topbar(P.data.promoter.name); route(); } else P.root.innerHTML = '<div class="loading"><div class="spinner"></div><div>Loading…</div></div>';
    refresh();
    stopTimers();
    timers.push(setInterval(function () { flush(); }, 60000));
    timers.push(setInterval(function () { refresh(true); }, 15 * 60000));
    window.addEventListener('online', function () { if (P) flush(); });
    document.addEventListener('visibilitychange', function () { if (P && document.visibilityState === 'hidden') flush(); });
  }

  function refresh(quiet) {
    return api('promoterData').then(function (res) {
      P.data = res.data;
      save(P.k.data, P.data);
      topbar(P.data.promoter.name);
      var s = shift();
      var srv = P.data.openShift;
      if (srv && (!s || s.id !== srv.id)) {
        // open on the server but not on this phone (other phone, cleared data): take it over with the saved counts
        var locs = Object.keys(P.data.counts || {});
        s = { id: srv.id, date: srv.date, clockIn: srv.clockIn, locations: locs.length ? locs : [], active: locs[0] || '', counts: P.data.counts || {}, segments: [], sentIn: true, dirty: false };
        if (!s.locations.length) s.pickStores = true;
        setShift(s);
      } else if (!srv && s && s.sentIn && !s.out) {
        setShift(null); // clocked out elsewhere
      }
      if (!quiet || !P.root.querySelector('.pm-tile')) route();
      flush();
    }).catch(function (err) {
      if (!P.data && P.root) P.root.innerHTML = '<div class="card empty"><h2>Couldn\'t load</h2><p class="muted">' + S.esc(err.message) + '</p><button class="btn btn-primary" id="rt">Try again</button></div>';
      var b = document.getElementById('rt');
      if (b) b.onclick = function () { refresh(); };
    });
  }

  function route() {
    var s = shift();
    if (!s || s.out) return s && s.out ? screenDone(s) : screenClockIn();
    if (s.date !== today()) return screenForgot(s);
    if (s.pickStores || !s.locations.length) return screenClockIn(s);
    return screenMain(s);
  }

  /* ---------------- clock in: pick stores */
  function screenClockIn(existing) {
    var locs = P.data.locations || [];
    var picked = {};
    (existing ? existing.locations : []).forEach(function (id) { picked[id] = 1; });
    P.root.innerHTML = '<div class="co"><h2 class="pm-title">' + (existing ? 'Where are you working?' : 'Clock in') + '</h2>' +
      '<p class="muted center">' + (existing ? 'Pick your store(s), then press Done.' : 'Pick the store(s) you work at today, then press Done.') + '</p>' +
      (locs.length ? '<div class="pm-stores">' + locs.map(function (l, i) {
        return '<button class="pm-store' + (picked[l.id] ? ' picked' : '') + '" data-l="' + S.esc(l.id) + '" style="--tc:' + TAB_COLORS[i % TAB_COLORS.length] + ';--ti:' + TAB_INK[i % TAB_INK.length] + '">' +
          (l.logo ? '<img src="' + S.esc(l.logo) + '" alt="">' : '') + '<span><b>' + S.esc(l.store) + '</b>' + (l.branch ? '<br>' + S.esc(l.branch) : '') + '</span><i>✓</i></button>';
      }).join('') + '</div>' : '<div class="card empty"><p class="muted">No stores in this project yet. Ask your manager.</p></div>') +
      '<div id="ciErr"></div><button class="btn btn-accent btn-big btn-block" id="ciDone"' + (locs.length ? '' : ' disabled') + '>Done' + (existing ? '' : ': clock in') + '</button>' +
      '<p class="small muted center" style="margin-top:10px">' + S.esc(P.data.project.name) + '</p></div>';
    Array.prototype.forEach.call(P.root.querySelectorAll('.pm-store'), function (b) {
      b.onclick = function () { var id = b.getAttribute('data-l'); if (picked[id]) delete picked[id]; else picked[id] = 1; b.classList.toggle('picked', !!picked[id]); };
    });
    document.getElementById('ciDone').onclick = function () {
      var ids = locs.filter(function (l) { return picked[l.id]; }).map(function (l) { return l.id; });
      if (!ids.length) { document.getElementById('ciErr').innerHTML = '<div class="form-error">Pick at least one store.</div>'; return; }
      if (existing) {
        existing.locations = ids; existing.active = ids.indexOf(existing.active) >= 0 ? existing.active : ids[0]; existing.pickStores = false; existing.dirty = true;
        setShift(existing); flush(); return route();
      }
      var now = new Date().toISOString();
      setShift({ id: uid('pshift'), date: today(), clockIn: now, locations: ids, active: ids[0], counts: {}, segments: [], sentIn: false, dirty: false });
      S.toast('Clocked in at ' + hhmm(now) + '.');
      flush();
      route();
    };
  }

  /* ---------------- yesterday's shift was never closed */
  function screenForgot(s) {
    var d = new Date(s.clockIn);
    var def = s.date + 'T' + (d.getHours() < 20 ? '20:00' : String(Math.min(23, d.getHours() + 1)).padStart(2, '0') + ':00');
    P.root.innerHTML = '<div class="co"><h2 class="pm-title">You did not clock out</h2>' +
      '<section class="co-card"><p>Your shift from <b>' + S.esc(s.date) + '</b> (in at ' + hhmm(s.clockIn) + ') is still open. When did you finish?</p>' +
      '<div class="field"><label for="fgTime">Finished at</label><input class="input" id="fgTime" type="datetime-local" value="' + def + '" min="' + S.esc(new Date(new Date(s.clockIn).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)) + '"></div>' +
      '<div class="field"><label for="fgNote">Note</label><textarea class="input" id="fgNote" rows="2" placeholder="Optional"></textarea></div>' +
      '<div id="fgErr"></div><button class="btn btn-accent btn-big btn-block" id="fgGo">Clock out that shift</button></section></div>';
    document.getElementById('fgGo').onclick = function () {
      var v = document.getElementById('fgTime').value;
      var t = v ? new Date(v) : null;
      if (!t || isNaN(t) || t <= new Date(s.clockIn) || t > new Date()) { document.getElementById('fgErr').innerHTML = '<div class="form-error">Pick a time after you clocked in.</div>'; return; }
      s.out = { at: t.toISOString(), note: document.getElementById('fgNote').value.trim() };
      setShift(s);
      flush().then(function () { var n = shift(); if (!n || n.done) { setShift(null); route(); } else route(); });
      route();
    };
  }

  /* ---------------- main page: a tab per store */
  function counts(s, loc) { s.counts[loc] = s.counts[loc] || {}; return s.counts[loc]; }
  function favs() { return load(P.k.fav, {}); }

  function screenMain(s) {
    var locs = (P.data.locations || []).filter(function (l) { return s.locations.indexOf(l.id) >= 0; });
    if (!locs.length) { s.pickStores = true; setShift(s); return screenClockIn(s); }
    if (!locs.some(function (l) { return l.id === s.active; })) s.active = locs[0].id;
    var all = P.data.locations || [];
    var colorOf = function (id) { var i = all.map(function (l) { return l.id; }).indexOf(id); return i < 0 ? 0 : i % TAB_COLORS.length; };
    var ci = colorOf(s.active);
    var here = s.segments.length ? s.segments[s.segments.length - 1] : null;
    var c = counts(s, s.active);
    var fav = favs();
    var prods = (P.data.products || []).slice().sort(function (a, b) {
      var fa = fav[a.ref] ? 0 : 1, fb = fav[b.ref] ? 0 : 1;
      if (fa !== fb) return fa - fb;
      return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
    });
    var units = 0;
    Object.keys(c).forEach(function (r) { if (r !== '_act') units += c[r]; });
    var pend = s.dirty || !s.sentIn;
    P.root.innerHTML =
      '<div class="pm-bar"><div class="pm-since">In since <b>' + hhmm(s.clockIn) + '</b> <span class="sync ' + (pend ? 'warn' : 'good') + '" id="pmSync">' + (pend ? 'On phone' : 'Sent') + '</span></div>' +
      '<button class="btn btn-ghost btn-sm" id="pmOut">Clock out</button></div>' +
      '<div class="pm-tabs" role="tablist">' + locs.map(function (l) {
        var i = colorOf(l.id);
        return '<button class="pm-tab' + (l.id === s.active ? ' active' : '') + '" role="tab" data-t="' + S.esc(l.id) + '" style="--tc:' + TAB_COLORS[i] + ';--ti:' + TAB_INK[i] + '">' +
          (l.logo ? '<img src="' + S.esc(l.logo) + '" alt="" onerror="this.remove()">' : '') + '<span>' + S.esc(storeLabel(l)) + '</span></button>';
      }).join('') + '<button class="pm-tab pm-add" id="pmAdd" aria-label="Add a store">+</button></div>' +
      '<div class="pm-page" style="--tc:' + TAB_COLORS[ci] + ';--ti:' + TAB_INK[ci] + '">' +
      (locs.length > 1 ? '<div class="pm-here">' + (here && here.loc === s.active
        ? '<span class="small">Working here since <b>' + hhmm(here.from) + '</b></span>'
        : '<button class="btn btn-ghost btn-sm" id="pmHere">I\'m working here now</button><span class="small muted">optional: splits your time per store</span>') + '</div>' : '') +
      '<section class="co-card demo-cust"><div><b>People activated</b><div class="small muted">People who tried or heard about a game</div></div>' +
      '<div class="qty big-qty"><button id="actDec" aria-label="One less">−</button><span id="actN">' + (c._act || 0) + '</span><button id="actInc" aria-label="One more">+</button></div></section>' +
      '<div class="pm-sold"><b>Sold here today</b><span><b id="pmUnits">' + units + '</b> units</span></div>' +
      (prods.length ? '<div class="tiles demo-tiles pm-tiles">' + prods.map(function (p) {
        var pic = picUrl(p.picture), n = c[p.ref] || 0;
        return '<div class="tile demo-tile pm-tile' + (n ? ' in-cart' : '') + '" data-ref="' + S.esc(p.ref) + '" role="button" tabindex="0"><span class="tile-img">' + (pic
          ? '<img src="' + S.esc(pic) + '" alt="" loading="lazy" onerror="this.parentNode.querySelector(\'.ph\').hidden=false;this.remove()">' : '') +
          '<span class="ph"' + (pic ? ' hidden' : '') + '>' + S.esc(initials(p.name)) + '</span>' +
          (n ? '<span class="demo-n">' + n + '</span>' : '') +
          '<button class="pm-star' + (fav[p.ref] ? ' on' : '') + '" data-star="' + S.esc(p.ref) + '" aria-label="Favourite">★</button>' +
          (n ? '<button class="demo-dec pm-dec" data-dec="' + S.esc(p.ref) + '" aria-label="One less">−</button>' : '') + '</span>' +
          '<span class="tile-name">' + S.esc(p.name) + '</span></div>';
      }).join('') + '</div>' : '<div class="card empty"><p class="muted">No games in this project yet. Ask your manager.</p></div>') +
      '<p class="small muted center">Tap a game each time you sell one. ★ puts your favourites first.</p></div>';

    Array.prototype.forEach.call(P.root.querySelectorAll('.pm-tab[data-t]'), function (b) {
      b.onclick = function () { var n = shift(); n.active = b.getAttribute('data-t'); setShift(n); screenMain(n); };
    });
    var act = P.root.querySelector('.pm-tab.active');
    if (act && act.scrollIntoView) act.scrollIntoView({ block: 'nearest', inline: 'center' });
    document.getElementById('pmAdd').onclick = function () { addStore(); };
    document.getElementById('pmOut').onclick = function () { clockOut(); };
    var hb = document.getElementById('pmHere');
    if (hb) hb.onclick = function () {
      var n = shift();
      if (!n.segments.length) n.segments.push({ loc: n.locations[0] === n.active ? n.active : n.locations[0], from: n.clockIn });
      if (n.segments[n.segments.length - 1].loc !== n.active) n.segments.push({ loc: n.active, from: new Date().toISOString() });
      setShift(n); screenMain(n);
    };
    function bump(ref, d) {
      var n = shift();
      var m = counts(n, n.active);
      m[ref] = Math.max(0, (m[ref] || 0) + d);
      n.dirty = true;
      setShift(n);
      if (navigator.vibrate && d > 0) navigator.vibrate(25);
      return m[ref];
    }
    document.getElementById('actInc').onclick = function () { document.getElementById('actN').textContent = bump('_act', 1); markPending(); };
    document.getElementById('actDec').onclick = function () { document.getElementById('actN').textContent = bump('_act', -1); markPending(); };
    var grid = P.root.querySelector('.pm-tiles');
    if (grid) grid.onclick = function (e) {
      var star = e.target.closest('[data-star]');
      if (star) {
        var f = favs(), r = star.getAttribute('data-star');
        if (f[r]) delete f[r]; else f[r] = 1;
        save(P.k.fav, f);
        return screenMain(shift());
      }
      var dec = e.target.closest('[data-dec]');
      if (dec) { bump(dec.getAttribute('data-dec'), -1); screenMain(shift()); return markPending(); }
      var t = e.target.closest('.pm-tile');
      if (t) { bump(t.getAttribute('data-ref'), 1); screenMain(shift()); markPending(); }
    };
  }

  /* changes are sent 20 s after the last tap (and every minute anyway) */
  var soon = null;
  function markPending() {
    var el = document.getElementById('pmSync');
    if (el) { el.className = 'sync warn'; el.textContent = 'On phone'; }
    clearTimeout(soon);
    soon = setTimeout(function () { flush(); }, 20000);
  }

  function addStore() {
    var s = shift();
    var rest = (P.data.locations || []).filter(function (l) { return s.locations.indexOf(l.id) < 0; });
    if (!rest.length) { S.toast('All the stores are already open.'); return; }
    var wrap = document.createElement('div');
    wrap.className = 'dialog-backdrop';
    wrap.innerHTML = '<div class="card dialog"><h2>Add a store</h2><div class="pm-stores">' + rest.map(function (l) {
      return '<button class="pm-store" data-l="' + S.esc(l.id) + '"><span><b>' + S.esc(l.store) + '</b>' + (l.branch ? '<br>' + S.esc(l.branch) : '') + '</span></button>';
    }).join('') + '</div><div class="dialog-actions"><button class="btn btn-ghost" data-x>Cancel</button></div></div>';
    document.body.appendChild(wrap);
    var close = function () { wrap.remove(); };
    wrap.querySelector('[data-x]').onclick = close;
    wrap.addEventListener('click', function (e) { if (e.target === wrap) close(); });
    Array.prototype.forEach.call(wrap.querySelectorAll('[data-l]'), function (b) {
      b.onclick = function () {
        var n = shift(); var id = b.getAttribute('data-l');
        n.locations.push(id); n.active = id; n.dirty = true;
        setShift(n); close(); flush(); screenMain(n);
      };
    });
  }

  function clockOut() {
    var s = shift();
    var tot = 0, act = 0;
    Object.keys(s.counts).forEach(function (l) { Object.keys(s.counts[l]).forEach(function (r) { if (r === '_act') act += s.counts[l][r]; else tot += s.counts[l][r]; }); });
    var wrap = document.createElement('div');
    wrap.className = 'dialog-backdrop';
    wrap.innerHTML = '<div class="card dialog"><h2>Clock out</h2>' +
      '<p>In since <b>' + hhmm(s.clockIn) + '</b>. Today: <b>' + tot + '</b> units sold, <b>' + act + '</b> people activated.</p>' +
      '<div class="field"><label for="coNote">Comment</label><textarea class="input" id="coNote" rows="3" placeholder="How was the day? Stock issues, questions from customers…"></textarea></div>' +
      '<div class="dialog-actions"><button class="btn btn-ghost" data-x>Cancel</button><button class="btn btn-accent" data-ok>Submit and clock out</button></div></div>';
    document.body.appendChild(wrap);
    var close = function () { wrap.remove(); };
    wrap.querySelector('[data-x]').onclick = close;
    wrap.querySelector('[data-ok]').onclick = function () {
      var n = shift();
      n.out = { at: new Date().toISOString(), note: wrap.querySelector('#coNote').value.trim(), units: tot, act: act };
      setShift(n);
      close();
      route();
      flush();
    };
  }

  function screenDone(s) {
    var sent = s.done;
    P.root.innerHTML = '<div class="co"><h2 class="pm-title">' + (sent ? 'Clocked out' : 'Clocking out…') + '</h2><section class="co-card center">' +
      '<p>In ' + hhmm(s.clockIn) + ' · out ' + hhmm(s.out.at) + '</p>' +
      (s.out.units != null ? '<p><b>' + s.out.units + '</b> units sold · <b>' + s.out.act + '</b> people activated</p>' : '') +
      (sent ? '<p class="muted">Thank you! Everything is saved.</p><button class="btn btn-accent btn-big btn-block" id="again">Clock in again</button>'
        : '<p class="muted">Sending… keep this page open with internet. It is saved on this phone in the meantime.</p><button class="btn btn-ghost btn-block" id="retryOut">Try again now</button>') +
      '</section></div>';
    var a = document.getElementById('again');
    if (a) a.onclick = function () { setShift(null); route(); };
    var r = document.getElementById('retryOut');
    if (r) r.onclick = function () { flush(); };
  }

  /* send what's on the phone: clock in, counts (absolute totals), clock out. Safe to repeat. */
  var flushing = null;
  function flush() {
    if (flushing) return flushing;
    var s = shift();
    if (!s || s.done || !P.token) return Promise.resolve();
    var stamp = JSON.stringify(s.counts) + '|' + s.locations.join(',');
    flushing = Promise.resolve().then(function () {
      if (!s.sentIn) {
        return api('promoterClock', { clock: { action: 'in', id: s.id, locations: s.locations, clientTime: s.clockIn } }).then(function (res) {
          var n = shift();
          if (!n || n.id !== s.id) return;
          if (res.shift.id !== s.id) { // already open on the server (other phone): carry on with that shift
            n.id = res.shift.id;
          }
          n.sentIn = true; n.dirty = true;
          setShift(n); s = n;
        });
      }
    }).then(function () {
      if (s.dirty) {
        return api('promoterSync', { sync: { shiftId: s.id, counts: s.counts, locations: s.locations } }).then(function () {
          var n = shift();
          if (n && n.id === s.id && JSON.stringify(n.counts) + '|' + n.locations.join(',') === stamp) { n.dirty = false; setShift(n); s = n; }
        });
      }
    }).then(function () {
      if (s.out && !s.dirty) {
        return api('promoterClock', { clock: { action: 'out', shiftId: s.id, note: s.out.note, segments: s.segments.length > 1 ? s.segments : [], clientTime: s.out.at } }).then(function () {
          var n = shift();
          if (n) { n.done = true; setShift(n); }
        });
      }
    }).then(function () {
      var el = document.getElementById('pmSync');
      var n = shift();
      if (el && n && !n.dirty && n.sentIn) { el.className = 'sync good'; el.textContent = 'Sent'; }
      if (n && n.done && P.root && P.root.querySelector('#retryOut')) route();
    }, function (err) {
      var el = document.getElementById('pmSync');
      if (el) { el.className = 'sync ' + (err.offline ? 'warn' : 'bad'); el.textContent = err.offline ? 'Offline: saved on phone' : 'Not saved'; }
      if (!err.offline && S.reportError) S.reportError(err, { where: 'promoter sync' });
    }).then(function () { flushing = null; });
    return flushing;
  }

  window.SHN_PROMO = { admin: admin, promoter: promoter, reset: function () { st.projects = null; st.project = null; } };
})();
