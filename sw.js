/* SHN LEB Events — offline support: keeps the app and product pictures on the device. */
var CACHE = 'shn-leb-events-v6';
var SHELL = ['./', 'index.html', 'config.js', 'assets/app.css', 'assets/app.js', 'assets/pos.js', 'assets/vendor/qrcode.js', 'assets/whish.png',
  'assets/logo-white.png', 'assets/logo-dark.png', 'assets/icon-64.png', 'assets/icon-192.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (/script\.google(usercontent)?\.com$/.test(url.hostname)) return; // the back office: never cached

  // product pictures: from the device first, download once
  if (req.destination === 'image' || /cdn\.shopify\.com$/.test(url.hostname) || /\/cdn\/shop\//.test(url.pathname)) {
    e.respondWith(caches.open(CACHE).then(function (c) {
      return c.match(req).then(function (hit) {
        return hit || fetch(req).then(function (res) { c.put(req, res.clone()); return res; });
      });
    }));
    return;
  }

  // the app itself: newest version when online, saved copy when offline
  if (url.origin === location.origin) {
    e.respondWith(fetch(req).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); });
      return res;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (hit) { return hit || caches.match('index.html'); });
    }));
  }
});
