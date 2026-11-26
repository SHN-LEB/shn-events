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
  function promoLink(projectId) { return base() + '?p=' + encodeURIComponent(projectId); }
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

  /* show the copy saved on this device at once, then the fresh one from the sheet when it arrives */
  function swr(key, action, data, apply, redraw, stillHere) {
    var cached = load(key, null);
    var fetch = S.api(action, data).then(function (res) {
      var fresh = JSON.stringify(res);
      save(key, res);
      if (!cached || JSON.stringify(cached) !== fresh) { apply(res); if (stillHere()) redraw(); }
    });
    if (cached) { apply(cached); redraw(); fetch.catch(function (e) { S.toast('Could not refresh: ' + e.message, true); }); }
    else return fetch;
  }

  function viewProjects() {
    if (!st.projects) {
      S.loading('Loading projects…');
      var p = swr('shn-cache-projects', 'listProjects', {}, function (res) { st.projects = res.projects || []; }, viewProjects,
        function () { return location.hash === '#/promoters'; });
      if (p) p.catch(function (e) { S.showError(e); });
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
        (list.length ? '<div class="field"><label for="pjFrom">Start from</label><select class="input" id="pjFrom"><option value="">Empty project</option>' +
          list.map(function (x) { return '<option value="' + S.esc(x.id) + '">Copy games and stores from ' + S.esc(x.name) + '</option>'; }).join('') + '</select>' +
          '<div class="small muted">Promoters are not copied: add the new team.</div></div>' : '') +
        '<p class="muted small">Creates the project\'s Google Sheet in the promoters folder.</p>', 'Create project',
      function (box, done, fail) {
        var from = box.querySelector('#pjFrom');
        box.querySelector('[data-ok]').textContent = 'Creating the Google Sheet… (about 20–30 s)';
        S.api('createProject', { name: box.querySelector('#pjName').value.trim(), copyFrom: from ? from.value : '' }).then(function (res) {
          done();
          st.projects.push(res.project);
          st.project = res.project;
          S.go('#/project/' + encodeURIComponent(res.project.id) + '/team');
          if (res.skipped && res.skipped.length) {
            window.alert('Not copied (no longer in the SHN Catalogue, so they have no Ref code):\n\n• ' + res.skipped.join('\n• ') +
              '\n\nIf they were renamed, pick the new names in the Products tab of the new project sheet.');
          }
        }).catch(function (e) { box.querySelector('[data-ok]').textContent = 'Create project'; fail(e); });
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

  var PTABS = [{ id: 'team', label: 'Promoters' }, { id: 'stores', label: 'Stores' }, { id: 'games', label: 'Games' }, { id: 'day', label: 'Day summary' }, { id: 'payslips', label: 'Payslips' }];

  function viewProject(id, tab) {
    if (!st.project || st.project.id !== id || !st.project.promoters) {
      S.loading('Loading project…');
      var pr = swr('shn-cache-proj-' + id, 'getProject', { id: id }, function (res) { st.project = res.project; st.report = null; },
        function () { viewProject(id, (location.hash.split('/')[3] || tab)); },
        function () { return location.hash.indexOf('#/project/' + encodeURIComponent(id)) === 0 && !document.querySelector('.dialog-backdrop'); });
      if (pr) pr.catch(function (e) { S.showError(e, true); });
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
    if (tab === 'day' || tab === 'results') return tabDay(el, p);
    if (tab === 'payslips') return tabPayslips(el, p);
    return tabTeam(el, p);
  }

  function refreshProject(res) { st.project = res.project; save('shn-cache-proj-' + res.project.id, { project: res.project }); viewProject(st.project.id, (location.hash.split('/')[3] || 'team')); }

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
    var link = promoLink(p.id);
    el.innerHTML = '<div class="card pr-link"><div><b>Promoter link</b> <span class="small muted">the same for everyone: each promoter signs in with their own code</span></div>' +
      '<div class="share"><code>' + S.esc(link) + '</code><button class="btn btn-ghost btn-sm" id="lkCopy">Copy</button><button class="btn btn-ghost btn-sm" id="lkShare">Share</button></div></div>' +
      '<div class="page-head" style="margin:16px 0 10px"><h2 class="section-title" style="margin:0">Promoters</h2><button class="btn btn-accent btn-sm" id="addPr">+ Add promoter</button></div>' +
      (list.length ? '<div class="pr-list">' + list.map(function (x) {
        return '<div class="card pr-card' + (x.active ? '' : ' off') + '" data-id="' + S.esc(x.id) + '">' +
          '<div class="pr-top"><div class="pr-who"><div class="pr-code"><span class="small muted">Code</span><b>' + S.esc(x.code) + '</b></div><div><b>' + S.esc(x.name) + '</b> <span class="small muted">' + S.esc(x.id) + '</span>' +
          (x.active ? '' : ' <span class="pill pill-closed">Inactive</span>') +
          '<div class="small muted">' + S.esc(rateText(x)) + '</div></div></div>' +
          '<div class="pr-now">' + (x.onShift ? '<span class="pill pill-live">On shift since ' + S.esc(String(x.onShift.since).slice(11, 16)) + '</span><div class="small muted">' + S.esc(x.onShift.stores) + '</div>' : '<span class="small muted">Not clocked in</span>') +
          '<div class="small"><b>' + S.num(x.unitsToday) + '</b> units today</div></div></div>' +
          '<div class="pr-actions"><button class="btn btn-ghost btn-sm" data-share>Share link + code</button><button class="link-btn" data-edit>Edit pay</button><button class="link-btn" data-code>New code</button>' +
          '<button class="link-btn" data-active>' + (x.active ? 'Deactivate' : 'Activate') + '</button></div></div>';
      }).join('') + '</div>'
        : '<div class="card empty"><p class="muted">No promoters yet. Add one here, or type them in the Promoters tab of the project sheet (from the Name column) and press ↻ at the top.</p></div>') +
      '<p class="small muted" style="margin-top:14px">A new code signs that promoter out on their phone. The link works until the project is closed. After 5 wrong codes in a row it rests for 5 minutes.</p>';
    document.getElementById('lkCopy').onclick = function () { copy(link, 'Link copied.'); };
    document.getElementById('lkShare').onclick = function () { share('SHN LEB · ' + p.name, 'SHN LEB · ' + p.name + ': promoter link. Sign in with your code.', link); };
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
      card.querySelector('[data-share]').onclick = function () {
        share('SHN LEB · ' + p.name, 'Hi ' + x.name + ', here is your SHN LEB promoter link for ' + p.name + '.\nYour code: ' + x.code, link);
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

  /* a picture from the phone or computer, made small (max 400 px) before it is sent */
  function shrinkImage(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type)) return reject(new Error('Pick a picture (PNG or JPG).'));
      var url = URL.createObjectURL(file);
      var im = new Image();
      im.onload = function () {
        var k = Math.min(1, 400 / Math.max(im.width, im.height));
        var c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(im.width * k)); c.height = Math.max(1, Math.round(im.height * k));
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        var out = c.toDataURL('image/png');
        if (out.length > 900000) out = c.toDataURL('image/jpeg', 0.85);
        resolve(out);
      };
      im.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Could not read that picture.')); };
      im.src = url;
    });
  }

  function storeForm(l) {
    l = l || {};
    return '<div class="field"><label for="lcStore">Store</label><input class="input" id="lcStore" maxlength="80" required placeholder="e.g. Spinneys" value="' + S.esc(l.store || '') + '"></div>' +
      '<div class="field"><label for="lcBranch">Location / branch</label><input class="input" id="lcBranch" maxlength="80" placeholder="e.g. Achrafieh" value="' + S.esc(l.branch || '') + '"></div>' +
      '<div class="field"><label>Logo <span class="muted small">(optional)</span></label><div class="lc-up"><span class="lc-prev" id="lcPrev">' + (l.logo ? '<img src="' + S.esc(l.logo) + '" alt="">' : '') + '</span>' +
      '<label class="btn btn-ghost btn-sm">Upload logo<input type="file" id="lcFile" accept="image/png,image/jpeg,image/webp" hidden></label></div>' +
      '<div class="small muted">Used for every branch with the same store name.</div>' +
      '<input class="input" id="lcLogo" maxlength="500" placeholder="or paste a picture link https://…" value="' + S.esc(l.logo || '') + '" style="margin-top:6px"></div>' +
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
    // the picture chosen in the dialog is uploaded after the store is saved
    function wireLogo(box) {
      var picked = { data: null };
      box.querySelector('#lcFile').onchange = function () {
        var f = this.files && this.files[0];
        shrinkImage(f).then(function (d) {
          picked.data = d;
          box.querySelector('#lcPrev').innerHTML = '<img src="' + d + '" alt="">';
          box.querySelector('#lcLogo').value = '';
        }).catch(function (e) { S.toast(e.message, true); });
      };
      return picked;
    }
    function saveStore(box, d, picked, before, done, fail) {
      S.api('saveLocation', { id: p.id, location: d }).then(function (res) {
        if (!picked.data) { done(); return refreshProject(res); }
        var lid = d.id || ((res.project.locations || []).filter(function (x) { return before.indexOf(x.id) < 0; }).pop() || {}).id;
        if (!lid) { done(); return refreshProject(res); }
        box.querySelector('[data-ok]').textContent = 'Uploading logo…';
        return S.api('uploadLogo', { id: p.id, locationId: lid, image: picked.data }).then(function (r2) { done(); refreshProject(r2); S.toast('Logo saved for every ' + d.store + '.'); });
      }).catch(fail);
    }
    var before = list.map(function (x) { return x.id; });
    document.getElementById('addLc').onclick = function () {
      var picked;
      var f = dialog('Add store', storeForm(), 'Add store', function (box, done, fail) {
        var d = readStore(box);
        if (picked.data) delete d.logo;
        saveStore(box, d, picked, before, done, fail);
      });
      picked = wireLogo(f);
    };
    Array.prototype.forEach.call(el.querySelectorAll('[data-lc]'), function (b) {
      var l = list.filter(function (x) { return x.id === b.getAttribute('data-lc'); })[0];
      b.onclick = function () {
        var picked;
        var f = dialog('Edit store', storeForm(l), 'Save', function (box, done, fail) {
          var d = readStore(box); d.id = l.id;
          if (picked.data) d.logo = l.logo;
          saveStore(box, d, picked, before, done, fail);
        });
        picked = wireLogo(f);
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

  /* today at a glance, sized for a phone: promoter, in/out, people activated, games sold */
  function tabDay(el, p) {
    var list = (p.promoters || []).filter(function (x) { return x.active || x.workedToday || x.unitsToday || x.activatedToday; })
      .sort(function (a, b) {
        var ra = a.onShift ? 0 : (a.workedToday ? 1 : 2), rb = b.onShift ? 0 : (b.workedToday ? 1 : 2);
        return ra !== rb ? ra - rb : (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1);
      });
    var tu = 0, ta = 0, ti = 0;
    list.forEach(function (x) { tu += x.unitsToday || 0; ta += x.activatedToday || 0; if (x.onShift) ti++; });
    var d = new Date();
    el.innerHTML = '<div class="ds-head"><b>' + S.esc(d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })) + '</b>' +
      '<button class="link-btn" id="dsRefresh">Refresh</button></div>' +
      (list.length ? '<div class="card ds-card"><table class="ds"><thead><tr><th>Promoter</th><th>Status</th><th class="num">People activated</th><th class="num">Games sold</th></tr></thead><tbody>' +
        list.map(function (x) {
          var since = x.onShift ? String(x.onShift.since).slice(11, 16) : '';
          return '<tr><td><b>' + S.esc(x.name) + '</b>' + (since ? '<div class="small muted">since ' + S.esc(since) + '</div>' : '') + '</td>' +
            '<td>' + (x.onShift ? '<span class="ds-st in">● In</span>' : '<span class="ds-st out">● Out</span>') + '</td>' +
            '<td class="num">' + S.num(x.activatedToday || 0) + '</td><td class="num">' + S.num(x.unitsToday || 0) + '</td></tr>';
        }).join('') + '</tbody><tfoot><tr><td>Total</td><td>' + ti + ' in</td><td class="num">' + S.num(ta) + '</td><td class="num">' + S.num(tu) + '</td></tr></tfoot></table></div>'
        : '<div class="card empty"><p class="muted">No promoters yet.</p></div>') +
      '<div id="dsMore"></div>';
    document.getElementById('dsRefresh').onclick = function () { st.project = null; st.report = null; viewProject(p.id, 'day'); };
    breakdowns(document.getElementById('dsMore'), p);
  }

  /* whole-project totals by store, game and day, under the day summary */
  function breakdowns(el, p) {
    if (!st.report || st.report.pid !== p.id) {
      el.innerHTML = '<div class="loading"><div class="spinner"></div><div>Adding up the project…</div></div>';
      S.api('projectReport', { id: p.id }).then(function (res) {
        st.report = res.report; st.report.pid = p.id;
        if (document.body.contains(el)) breakdowns(el, p);
      }).catch(function (e) { el.innerHTML = '<p class="neg small">' + S.esc(e.message) + '</p>'; });
      return;
    }
    var r = st.report;
    var tbl = function (head, rows) {
      return '<div class="card ds-card"><table class="ds ds-b"><thead><tr>' + head.map(function (h) { return '<th' + (h.charAt(0) === '#' ? ' class="num"' : '') + '>' + S.esc(h.replace(/^#/, '')) + '</th>'; }).join('') +
        '</tr></thead><tbody>' + (rows.length ? rows.join('') : '<tr><td colspan="' + head.length + '" class="muted">Nothing yet.</td></tr>') + '</tbody></table></div>';
    };
    var n = function (v) { return '<td class="num">' + S.num(v) + '</td>'; };
    var tbl4 = function (head, rows) { return tbl(head, rows).replace('ds ds-b', 'ds ds-b ds-b4'); };
    el.innerHTML = '<p class="small muted" style="margin:18px 2px 0">Since the project started</p>' +
      '<h2 class="section-title">By store</h2>' +
      tbl(['Store', '#People activated', '#Games sold'], r.stores.map(function (x) { return '<tr><td>' + S.esc(x.store) + '</td>' + n(x.activated) + n(x.units) + '</tr>'; })) +
      '<h2 class="section-title">By game</h2>' +
      tbl(['Game', '#Games sold'], r.games.map(function (x) { return '<tr><td>' + S.esc(x.name) + '</td>' + n(x.units) + '</tr>'; })) +
      '<h2 class="section-title">By day</h2>' +
      tbl4(['Day', '#Promoters', '#People activated', '#Games sold'], r.days.map(function (x) { return '<tr><td>' + S.esc(fmtDate(x.date)) + '</td>' + n(x.promoters) + n(x.activated) + n(x.units) + '</tr>'; }));
  }

  /* payslip per promoter: a row per day, totals at the bottom; Shifts edited in the sheet show here */
  function tabPayslips(el, p) {
    var list = (p.promoters || []).slice().sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; });
    if (!list.length) { el.innerHTML = '<div class="card empty"><p class="muted">No promoters yet.</p></div>'; return; }
    var sel = st.slip || { pid: list[0].id, from: '', to: '' };
    if (!list.some(function (x) { return x.id === sel.pid; })) sel.pid = list[0].id;
    st.slip = sel;
    el.innerHTML = '<div class="card ps-filters"><div class="field"><label for="psWho">Promoter</label><select class="input" id="psWho">' +
      list.map(function (x) { return '<option value="' + S.esc(x.id) + '"' + (x.id === sel.pid ? ' selected' : '') + '>' + S.esc(x.name) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="psFrom">From</label><input class="input" type="date" id="psFrom" value="' + S.esc(sel.from) + '"></div>' +
      '<div class="field"><label for="psTo">To</label><input class="input" type="date" id="psTo" value="' + S.esc(sel.to) + '"></div></div>' +
      '<div id="psBody"><div class="loading"><div class="spinner"></div><div>Adding up…</div></div></div>' +
      '<p class="small muted" style="margin-top:12px">To fix a forgotten clock-in or clock-out, change the time in the Shifts tab of the project sheet (or add a row with the promoter\'s name, date, clock in and clock out), then come back here.</p>';
    var load = function () {
      sel.pid = el.querySelector('#psWho').value; sel.from = el.querySelector('#psFrom').value; sel.to = el.querySelector('#psTo').value;
      var body = el.querySelector('#psBody');
      body.innerHTML = '<div class="loading"><div class="spinner"></div><div>Adding up…</div></div>';
      S.api('payslip', { id: p.id, promoterId: sel.pid, from: sel.from, to: sel.to }).then(function (res) {
        if (!document.body.contains(body)) return;
        var ps = res.payslip;
        st.slipData = ps;
        body.innerHTML = '<div class="ps-top"><div class="small muted">' + S.esc(rateText(ps.promoter)) + '</div>' +
          '<div class="head-actions"><button class="btn btn-ghost btn-sm" id="psPdf"' + (ps.rows.length ? '' : ' disabled') + '>PDF</button>' +
          '<button class="btn btn-accent btn-sm" id="psShare"' + (ps.rows.length ? '' : ' disabled') + '>Share picture</button></div></div>' +
          '<div class="card table-wrap">' + slipTable(ps, false) + '</div>';
        body.querySelector('#psPdf').onclick = function () { slipPdf(ps); };
        body.querySelector('#psShare').onclick = function () { slipShare(ps); };
      }).catch(function (e) { body.innerHTML = '<div class="card empty"><p class="neg">' + S.esc(e.message) + '</p></div>'; });
    };
    ['#psWho', '#psFrom', '#psTo'].forEach(function (q) { el.querySelector(q).onchange = load; });
    load();
  }

  function fmtDate(d) {
    var x = new Date(d + 'T12:00:00');
    return isNaN(x) ? d : x.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  }
  function slipTable(ps, print) {
    var m = print ? function (v) { return '$' + Number(v).toFixed(2); } : S.money;
    var h = function (v) { return Number(v).toFixed(2); };
    var cls = print ? 'slip' : 'tbl ps-tbl';
    return '<table class="' + cls + '"><thead><tr><th>Day</th><th>Time in</th><th>Time out</th><th class="num">Hours</th><th class="num">Day cost</th>' +
      '<th class="num">Games sold</th><th class="num">Commission</th><th class="num">Total</th></tr></thead><tbody>' +
      (ps.rows.length ? ps.rows.map(function (d) {
        return '<tr><td>' + S.esc(fmtDate(d.date)) + '</td><td>' + S.esc(d.timeIn || '–') + '</td><td>' + (d.timeOut ? S.esc(d.timeOut) : (d.open ? '<span class="' + (print ? '' : 'neg') + '">Not clocked out</span>' : '–')) + '</td>' +
          '<td class="num">' + h(d.hours) + '</td><td class="num">' + m(d.hourCost) + '</td><td class="num">' + S.num(d.units) + '</td>' +
          '<td class="num">' + m(d.commission) + '</td><td class="num"><b>' + m(d.total) + '</b></td></tr>';
      }).join('') : '<tr><td colspan="8" class="muted">No days worked in this period.</td></tr>') +
      '</tbody><tfoot><tr><td>Total (' + ps.totals.days + (ps.totals.days === 1 ? ' day' : ' days') + ')</td><td></td><td></td><td class="num">' + h(ps.totals.hours) + '</td>' +
      '<td class="num">' + m(ps.totals.hourCost) + '</td><td class="num">' + S.num(ps.totals.units) + '</td><td class="num">' + m(ps.totals.commission) + '</td>' +
      '<td class="num">' + m(ps.totals.total) + '</td></tr></tfoot></table>';
  }

  function slipPeriod(ps) {
    return ps.from || ps.to ? (ps.from ? fmtDate(ps.from) : 'Start') + ' – ' + (ps.to ? fmtDate(ps.to) : 'today')
      : (ps.rows.length ? fmtDate(ps.rows[0].date) + ' – ' + fmtDate(ps.rows[ps.rows.length - 1].date) : '');
  }

  /* the payslip as a picture, shared to WhatsApp (or any app) from the phone's share menu */
  function slipShare(ps) {
    var btn = document.getElementById('psShare');
    if (btn) btn.disabled = true;
    drawSlip(ps).then(function (blob) {
      var name = 'SHN LEB payslip - ' + ps.promoter.name + '.png';
      var text = 'SHN LEB · ' + ps.project + '\nPayslip ' + ps.promoter.name + (slipPeriod(ps) ? ' · ' + slipPeriod(ps) : '') + '\nTotal pay: $' + ps.totals.total.toFixed(2);
      var file = null;
      try { file = new File([blob], name, { type: 'image/png' }); } catch (e) { file = null; }
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        return navigator.share({ files: [file], text: text }).catch(function (err) { if (err && err.name !== 'AbortError') showSlipImage(blob, name, text); });
      }
      showSlipImage(blob, name, text);
    }).catch(function () { S.toast('Could not make the picture.', true); })
      .then(function () { if (btn) btn.disabled = false; });
  }

  function showSlipImage(blob, name, text) {
    var url = URL.createObjectURL(blob);
    var wrap = document.createElement('div');
    wrap.className = 'dialog-backdrop';
    wrap.innerHTML = '<div class="card dialog ps-img-dlg"><h2>Payslip picture</h2><img class="summary-img" src="' + url + '" alt="Payslip">' +
      '<p class="small muted">This device can\'t share pictures straight to WhatsApp: save the picture, then attach it in WhatsApp.</p>' +
      '<div class="dialog-actions"><button class="btn btn-ghost" data-x>Close</button><a class="btn btn-ghost" href="https://wa.me/?text=' + encodeURIComponent(text) + '" target="_blank" rel="noopener">Open WhatsApp</a>' +
      '<a class="btn btn-accent" href="' + url + '" download="' + S.esc(name) + '">Save picture</a></div></div>';
    document.body.appendChild(wrap);
    var close = function () { wrap.remove(); URL.revokeObjectURL(url); };
    wrap.querySelector('[data-x]').onclick = close;
    wrap.addEventListener('click', function (e) { if (e.target === wrap) close(); });
  }

  var slipLogo = null;
  function drawSlip(ps) {
    var logoP = slipLogo ? Promise.resolve(slipLogo) : new Promise(function (res) {
      var im = new Image(); im.onload = function () { slipLogo = im; res(im); }; im.onerror = function () { res(null); }; im.src = 'assets/logo-white.png';
    });
    return logoP.then(function (logo) {
      var W = 1240, pad = 50, rowH = 58;
      var F = '-apple-system, Segoe UI, Roboto, Arial, sans-serif';
      var cols = [['Day', 190, 'l'], ['In', 100, 'l'], ['Out', 140, 'l'], ['Hours', 110, 'r'], ['Day cost', 150, 'r'], ['Games', 120, 'r'], ['Commission', 170, 'r'], ['Total', 160, 'r']];
      var H = 330 + (ps.rows.length + 2) * rowH + 130;
      var c = document.createElement('canvas'); c.width = W; c.height = H;
      var x = c.getContext('2d');
      x.fillStyle = '#f7f2ec'; x.fillRect(0, 0, W, H);
      x.fillStyle = '#231F20'; x.fillRect(0, 0, W, 190);
      if (logo) { var lh = 64; x.drawImage(logo, pad, 34, logo.width * lh / logo.height, lh); }
      x.fillStyle = '#EB5C24'; x.fillRect(0, 186, W, 8);
      x.fillStyle = '#fff'; x.font = '700 42px ' + F; x.fillText(ps.promoter.name, pad, 158);
      x.textAlign = 'right'; x.fillStyle = '#c9c3bd'; x.font = '26px ' + F;
      x.fillText('Payslip · ' + ps.project, W - pad, 66); x.fillText(slipPeriod(ps), W - pad, 104); x.textAlign = 'left';
      x.fillStyle = '#7a736d'; x.font = '24px ' + F; x.fillText('Pay: ' + rateText(ps.promoter), pad, 244);
      var y = 280;
      var money2 = function (v) { return '$' + Number(v).toFixed(2); };
      var drawRow = function (vals, opts) {
        var cx = pad;
        if (opts.bg) { x.fillStyle = opts.bg; x.fillRect(pad - 12, y, W - 2 * pad + 24, rowH); }
        cols.forEach(function (col, i) {
          x.fillStyle = opts.colors && opts.colors[i] || opts.color || '#231F20';
          x.font = (opts.bold || (opts.boldLast && i === cols.length - 1) ? '700 ' : '') + (opts.size || 26) + 'px ' + F;
          x.textAlign = col[2] === 'r' ? 'right' : 'left';
          x.fillText(String(vals[i]), col[2] === 'r' ? cx + col[1] - 12 : cx, y + rowH / 2 + 9);
          cx += col[1];
        });
        x.textAlign = 'left';
        y += rowH;
        x.fillStyle = '#e3ddd5'; x.fillRect(pad - 12, y - 1, W - 2 * pad + 24, 1);
      };
      drawRow(cols.map(function (cc) { return cc[0]; }), { bg: '#ece5db', color: '#5e5852', size: 22, bold: true });
      ps.rows.forEach(function (d, i) {
        drawRow([fmtDate(d.date), d.timeIn || '–', d.timeOut || (d.open ? 'not out' : '–'), d.hours.toFixed(2), money2(d.hourCost), d.units, money2(d.commission), money2(d.total)],
          { bg: i % 2 ? '#fbf8f4' : '#fff', boldLast: true, colors: { 2: d.timeOut ? null : '#b42318' } });
      });
      x.fillStyle = '#231F20'; x.fillRect(pad - 12, y, W - 2 * pad + 24, 3);
      var t = ps.totals;
      drawRow(['Total · ' + t.days + (t.days === 1 ? ' day' : ' days'), '', '', t.hours.toFixed(2), money2(t.hourCost), t.units, money2(t.commission), money2(t.total)],
        { bg: '#fff', bold: true, colors: { 7: '#EB5C24' } });
      y += 50;
      x.fillStyle = '#231F20'; x.font = '30px ' + F; x.fillText('Total pay', pad, y);
      x.fillStyle = '#EB5C24'; x.font = '700 44px ' + F; x.fillText(money2(t.total), pad + 150, y + 2);
      x.fillStyle = '#9a938d'; x.font = '20px ' + F; x.textAlign = 'right';
      x.fillText((ps.footer || 'SHN LEB Promoters') + ' · ' + new Date().toLocaleDateString('en-GB'), W - pad, y); x.textAlign = 'left';
      return new Promise(function (res, rej) { c.toBlob(function (b) { b ? res(b) : rej(new Error('no picture')); }, 'image/png'); });
    });
  }

  function slipPdf(ps) {
    var w = window.open('', '_blank');
    if (!w) { S.toast('Allow pop-ups for this site to make the PDF.', true); return; }
    var period = slipPeriod(ps);
    var logo = base() + 'assets/logo-dark.png';
    var html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + S.esc('Payslip - ' + ps.promoter.name + ' - ' + ps.project) + '</title><style>' +
      'body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#231F20;margin:28px;font-size:12px}h1{font-size:22px;margin:4px 0}' +
      '.head{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #EB5C24;padding-bottom:10px;margin-bottom:14px}.head img{height:42px}.sub{color:#666}' +
      'table{border-collapse:collapse;width:100%}td,th{padding:6px 8px;border-bottom:1px solid #e6e1da;text-align:left;white-space:nowrap}th{background:#f6f1ea;font-size:11px}' +
      '.num{text-align:right}tfoot td{font-weight:700;border-top:2px solid #231F20;font-size:13px}tfoot td:last-child{color:#EB5C24;font-size:15px}' +
      '.pay{margin-top:16px;font-size:15px}.pay b{font-size:20px;color:#EB5C24}@media print{body{margin:12mm}button{display:none}}</style></head><body>' +
      '<div class="head"><div><div class="sub">SHN LEB · ' + (ps.footer === 'SHN LEB Events' ? 'Staff' : 'Promoter') + ' payslip</div><h1>' + S.esc(ps.promoter.name) + '</h1><div class="sub">' + S.esc(ps.project) + (period ? ' · ' + S.esc(period) : '') + '</div></div><img src="' + logo + '" alt="SHN"></div>' +
      '<p class="sub">Pay: ' + S.esc(rateText(ps.promoter)) + '</p>' + slipTable(ps, true) +
      '<p class="pay">Total pay: <b>$' + ps.totals.total.toFixed(2) + '</b></p>' +
      '<p class="sub" style="margin-top:24px">Made ' + S.esc(new Date().toLocaleString('en-GB')) + '</p>' +
      '<button onclick="print()" style="margin-top:10px;padding:10px 16px">Print / save as PDF</button></body></html>';
    w.document.open(); w.document.write(html); w.document.close();
  }

  /* ================================================================ PROMOTER LINK (phone) */
  var P = null; // the running promoter app
  var timers = [];

  function keys(pj, pr) {
    var k = pj + '-' + pr;
    return { tok: 'shn-promo-tok-' + k, data: 'shn-promo-data-' + k, shift: 'shn-promo-shift-' + k, fav: 'shn-promo-fav-' + k };
  }

  /* one link per project (?p=): the code says who signs in. Older personal links (?p=&u=) still work. */
  function promoter(projectId, linkPromoter) {
    S = window.SHN;
    document.body.classList.add('pos-mode', 'promo-mode');
    var nm = document.querySelector('.brand-name');
    if (nm) nm.textContent = 'LEB Promoters';
    if (P && P.projectId === projectId && P.link === linkPromoter && P.root && S.app.contains(P.root)) return;
    var tokKey = linkPromoter ? keys(projectId, linkPromoter).tok : 'shn-promo-tok-' + projectId;
    var t = load(tokKey, null);
    var ok = t && t.expires > Date.now();
    var pid = linkPromoter || (ok ? t.pid : '');
    P = { projectId: projectId, link: linkPromoter, tokKey: tokKey, promoterId: pid, k: pid ? keys(projectId, pid) : null, token: ok ? t.token : null, root: null };
    if (!P.token || !P.promoterId) return codeScreen();
    start();
  }

  function api(action, data) {
    return S.api(action, Object.assign({ projectId: P.projectId }, data || {}), { token: P.token || 'none', quiet: true }).catch(function (err) {
      if (err.code === 'auth') signOut('Please enter your code again.');
      throw err;
    });
  }

  function signOut(msg) {
    drop(P.tokKey);
    P.token = null;
    if (!P.link) { P.promoterId = ''; P.k = null; }
    stopTimers();
    codeScreen(msg);
  }
  function stopTimers() { timers.forEach(clearInterval); timers = []; }

  function topbar(name) {
    S.topbarRight.innerHTML = name ? '<span class="topbar-event">' + S.esc(name) + '</span><button class="link-btn pm-signout" id="pmSignOut">Sign out</button>' : '';
    var b = document.getElementById('pmSignOut');
    if (b) b.onclick = function () {
      var s = shift();
      var unsent = s && !s.done && (s.dirty || !s.sentIn || s.out);
      if (unsent && !window.confirm('Some of your counts are not sent yet. They stay on this phone and are sent when you sign in again. Sign out?')) return;
      if (!unsent && s && !s.out && !window.confirm('You are still clocked in. Sign out anyway? (Clock out first if you are leaving.)')) return;
      signOut();
    };
  }

  function codeScreen(msg) {
    topbar('');
    var cached = P.k ? load(P.k.data, null) : null;
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
    S.api('promoterPublic', { projectId: P.projectId, promoterId: P.link }, { quiet: true }).then(function (res) {
      var h = document.getElementById('pcName'), pj = document.getElementById('pcProj');
      if (h && res.info.name) h.textContent = 'Hi ' + res.info.name;
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
      S.api('promoterLogin', { projectId: P.projectId, promoterId: P.link, code: code }, { quiet: true }).then(function (res) {
        document.removeEventListener('keydown', onKey);
        save(P.tokKey, { token: res.token, expires: res.expires, pid: res.promoterId });
        P.token = res.token;
        P.promoterId = res.promoterId;
        P.k = keys(P.projectId, res.promoterId);
        start(res.data);
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
  function shift() { return P.k ? load(P.k.shift, null) : null; }
  function setShift(s) { if (s) save(P.k.shift, s); else drop(P.k.shift); }

  /* shows what is saved on the phone straight away, then checks the sheet in the background */
  function start(fresh) {
    P.data = load(P.k.data, null);
    S.app.innerHTML = '<div class="promo" id="promo"></div>';
    P.root = document.getElementById('promo');
    if (fresh) { applyData(fresh); route(); flush(); }
    else if (P.data) { topbar(P.data.promoter.name); route(); refresh(true); }
    else { P.root.innerHTML = '<div class="loading"><div class="spinner"></div><div>Loading…</div></div>'; refresh(); }
    stopTimers();
    timers.push(setInterval(function () { flush(); }, 60000));
    timers.push(setInterval(function () { refresh(true); }, 15 * 60000));
    window.addEventListener('online', function () { if (P) flush(); });
    document.addEventListener('visibilitychange', function () { if (P && document.visibilityState === 'hidden') flush(); });
  }

  function refresh(quiet) {
    return api('promoterData').then(function (res) {
      var before = P.screen;
      applyData(res.data);
      // a quiet refresh only redraws when the page itself changes (so a half-made choice is not lost)
      if (!quiet || before !== routeKey()) route();
      flush();
    }).catch(function (err) {
      if (!P.data && P.root) P.root.innerHTML = '<div class="card empty"><h2>Couldn\'t load</h2><p class="muted">' + S.esc(err.message) + '</p><button class="btn btn-primary" id="rt">Try again</button></div>';
      var b = document.getElementById('rt');
      if (b) b.onclick = function () { refresh(); };
    });
  }

  function applyData(data) {
      P.data = data;
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
  }

  function routeKey() {
    var s = shift();
    if (!s || s.out) return s && s.out ? 'done' : 'in';
    if (s.date !== today()) return 'forgot';
    if (s.pickStores || !s.locations.length) return 'in';
    return 'main';
  }

  function route() {
    P.screen = routeKey();
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
    // "Same as yesterday": the stores of the last shift (read from the project sheet)
    var last = !existing && P.data.lastStores ? P.data.lastStores : null;
    var lastLocs = last ? locs.filter(function (l) { return last.locations.indexOf(l.id) >= 0; }) : [];
    var y = new Date(); y.setDate(y.getDate() - 1);
    var yIso = y.getFullYear() + '-' + String(y.getMonth() + 1).padStart(2, '0') + '-' + String(y.getDate()).padStart(2, '0');
    var lastLabel = last ? (last.date === yIso ? 'Same as yesterday' : last.date === today() ? 'Same as earlier today' : 'Same as last time (' + fmtDate(last.date) + ')') : '';
    P.root.innerHTML = '<div class="co"><h2 class="pm-title">' + (existing ? 'Where are you working?' : 'Clock in') + '</h2>' +
      (lastLocs.length ? '<button class="pm-same" id="ciSame"><b>' + S.esc(lastLabel) + '</b><span>' + lastLocs.map(function (l) { return S.esc(storeLabel(l)); }).join(' · ') + '</span><i>Clock in ›</i></button>' +
        '<p class="muted center small pm-or">or pick below to change</p>'
        : '<p class="muted center">' + (existing ? 'Pick your store(s), then press Done.' : 'Pick the store(s) you work at today, then press Done.') + '</p>') +
      '<div id="ciErr"></div><button class="btn btn-accent btn-big btn-block" id="ciDone"' + (locs.length ? '' : ' disabled') + '>Done' + (existing ? '' : ': clock in') + '</button>' +
      (locs.length ? '<div class="pm-stores">' + locs.map(function (l, i) {
        return '<button class="pm-store' + (picked[l.id] ? ' picked' : '') + '" data-l="' + S.esc(l.id) + '" style="--tc:' + TAB_COLORS[i % TAB_COLORS.length] + ';--ti:' + TAB_INK[i % TAB_INK.length] + '">' +
          (l.logo ? '<img src="' + S.esc(l.logo) + '" alt="">' : '') + '<span><b>' + S.esc(l.store) + '</b>' + (l.branch ? '<br>' + S.esc(l.branch) : '') + '</span><i>✓</i></button>';
      }).join('') + '</div>' : '<div class="card empty"><p class="muted">No stores in this project yet. Ask your manager.</p></div>') +
      '<p class="small muted center" style="margin-top:10px">' + S.esc(P.data.project.name) + '</p></div>';
    Array.prototype.forEach.call(P.root.querySelectorAll('.pm-store'), function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-l'); if (picked[id]) delete picked[id]; else picked[id] = 1; b.classList.toggle('picked', !!picked[id]);
        document.getElementById('ciErr').innerHTML = '';
      };
    });
    function go(ids) {
      if (existing) {
        existing.locations = ids; existing.active = ids.indexOf(existing.active) >= 0 ? existing.active : ids[0]; existing.pickStores = false; existing.dirty = true;
        setShift(existing); flush(); return route();
      }
      var now = new Date().toISOString();
      setShift({ id: uid('pshift'), date: today(), clockIn: now, locations: ids, active: ids[0], counts: {}, segments: [], sentIn: false, dirty: false });
      S.toast('Clocked in at ' + hhmm(now) + '.');
      flush();
      route();
    }
    var same = document.getElementById('ciSame');
    if (same) same.onclick = function () { go(lastLocs.map(function (l) { return l.id; })); };
    document.getElementById('ciDone').onclick = function () {
      var ids = locs.filter(function (l) { return picked[l.id]; }).map(function (l) { return l.id; });
      if (!ids.length) { document.getElementById('ciErr').innerHTML = '<div class="form-error">Pick at least one store below.</div>'; return; }
      go(ids);
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
      (prods.length > 4 ? '<div class="pm-search"><input class="input" id="pmFind" type="search" placeholder="Search games" autocomplete="off" value="' + S.esc(P.search || '') + '">' +
        '<button type="button" id="pmFindX" aria-label="Clear search"' + (P.search ? '' : ' hidden') + '>×</button></div>' : '') +
      (prods.length ? '<div class="tiles demo-tiles pm-tiles">' + prods.map(function (p) {
        var pic = picUrl(p.picture), n = c[p.ref] || 0;
        var hide = P.search && p.name.toLowerCase().indexOf(P.search.toLowerCase()) < 0;
        return '<div class="tile demo-tile pm-tile' + (n ? ' in-cart' : '') + '" data-ref="' + S.esc(p.ref) + '" data-name="' + S.esc(p.name.toLowerCase()) + '" role="button" tabindex="0"' + (hide ? ' hidden' : '') + '><span class="tile-img">' + (pic
          ? '<img src="' + S.esc(pic) + '" alt="" loading="lazy" onerror="this.parentNode.querySelector(\'.ph\').hidden=false;this.remove()">' : '') +
          '<span class="ph"' + (pic ? ' hidden' : '') + '>' + S.esc(initials(p.name)) + '</span>' +
          '<button class="pm-star' + (fav[p.ref] ? ' on' : '') + '" data-star="' + S.esc(p.ref) + '" aria-label="Favourite">★</button>' +
          (n ? '<span class="pm-qty"><button data-dec="' + S.esc(p.ref) + '" aria-label="One less">−</button><b>' + n + '</b><button data-inc="' + S.esc(p.ref) + '" aria-label="One more">+</button></span>' : '') + '</span>' +
          '<span class="tile-name">' + S.esc(p.name) + '</span></div>';
      }).join('') + '</div><p class="small muted center" id="pmNone" hidden>No game matches your search.</p>' : '<div class="card empty"><p class="muted">No games in this project yet. Ask your manager.</p></div>') +
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
    var find = document.getElementById('pmFind');
    var filter = function () {
      var q = (P.search || '').toLowerCase().trim(), shown = 0;
      Array.prototype.forEach.call(grid.querySelectorAll('.pm-tile'), function (t) {
        var ok = !q || t.getAttribute('data-name').indexOf(q) >= 0;
        t.hidden = !ok; if (ok) shown++;
      });
      document.getElementById('pmNone').hidden = shown > 0;
      document.getElementById('pmFindX').hidden = !q;
    };
    if (find) {
      find.oninput = function () { P.search = find.value; filter(); };
      document.getElementById('pmFindX').onclick = function () { P.search = ''; find.value = ''; filter(); find.focus(); };
      filter();
    }
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
      var inc = e.target.closest('[data-inc]');
      if (inc) { bump(inc.getAttribute('data-inc'), 1); screenMain(shift()); return markPending(); }
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

  window.SHN_PROMO = {
    admin: admin, promoter: promoter, reset: function () { st.projects = null; st.project = null; st.report = null; },
    slip: { table: function (ps, pr) { S = S || window.SHN; return slipTable(ps, pr); }, pdf: function (ps) { S = S || window.SHN; slipPdf(ps); },
      share: function (ps) { S = S || window.SHN; slipShare(ps); }, rateText: function (p) { S = S || window.SHN; return rateText(p); } }
  };
})();
