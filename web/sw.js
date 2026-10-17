/* Fii La — service worker minimal.
   - Garde la coquille de l'application (HTML, CSS, JS, polices, icônes) pour qu'elle s'ouvre
     même sur une connexion instable, et rend l'application installable.
   - Réseau d'abord : une nouvelle version déployée est servie dès qu'elle est joignable.
   - Ne touche jamais aux appels à l'API (autre origine, ou /rest/ en local), ni aux tuiles de carte,
     ni à aucune requête autre que GET : aucun contenu de fiche n'est mis en cache. */
var CACHE = 'fiila-shell-v5';
var SHELL = [
  './', 'index.html', 'theme.js', 'styles.css', 'app.js', 'config.js', 'manifest.webmanifest',
  'fonts/montserrat-latin-400-normal.woff2', 'fonts/montserrat-latin-600-normal.woff2', 'fonts/montserrat-latin-800-normal.woff2',
  'icons/icon-192.png', 'icons/icon-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).catch(function () { /* hors ligne au premier passage */ })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (/\/(rest|auth|functions)\//.test(url.pathname)) return;
  event.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok && res.type === 'basic') {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
      }
      return res;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (hit) {
        if (hit) return hit;
        if (req.mode === 'navigate') return caches.match('index.html');
        return Response.error();
      });
    })
  );
});
