/* Ranked XI service worker — network-first with cache fallback.
   Keeps the app installable + resilient offline without ever serving
   stale data when the network is up. Bump VERSION with each deploy
   (use scripts/bump_version.py — it moves every file's token together). */
const VERSION = 'rankxi-v20260731j';
/* Crests live in a cache that survives deploys (re-downloading ~26 MB per
   deploy is not acceptable). They are NOT strictly immutable — pixel-level
   fixes (strip_crest_bg.py) change content under the same filename — so crest
   URLs carry a ?cv= generation (CRESTV in app.js) and cache matches respect
   the query. Bump this suffix only to nuke the whole asset cache. */
const ASSETS = 'rankxi-assets-v2';
/* The shell must include the code the app needs to boot, not just the HTML —
   precaching only the documents left an installed PWA blank offline. */
const SHELL = [
  '/app.html', '/index.html', '/manifest.webmanifest',
  '/icon-192.png', '/icon-512.png',
  '/js/app.js', '/js/data.js', '/js/rosters.js', '/js/usmap.js',
  '/css/app.css',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VERSION)
      // one bad URL must not fail the whole install; cache:'no-cache' forces
      // revalidation — SHELL urls carry no ?v= token, so the year-long
      // Cache-Control on /js/* would otherwise precache a stale build
      .then(c => Promise.allSettled(SHELL.map(u => c.add(new Request(u, { cache: 'no-cache' })))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== VERSION && k !== ASSETS).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  const isAsset = /\/crests\/|\.(png|jpg|jpeg|webp|svg|ico)$/i.test(new URL(e.request.url).pathname);

  if (isAsset) {
    // cache-first, keyed by full URL: the ?cv= generation token is the only
    // way changed pixels reach a browser that already cached the old file
    e.respondWith(
      caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(ASSETS).then(c => c.put(e.request, copy));
        }
        return res;
      }))
    );
    return;
  }

  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
