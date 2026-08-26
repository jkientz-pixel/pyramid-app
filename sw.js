/* Ranked XI service worker — network-first with cache fallback.
   Keeps the app installable + resilient offline without ever serving
   stale data when the network is up. Bump VERSION with each deploy
   stamped by deploy.sh from the placeholder; never hand-edit it. */
const VERSION = 'rankxi-v__RXIV__';
/* Crests live in a cache that survives deploys (re-downloading ~26 MB per
   deploy is not acceptable). They are NOT strictly immutable — pixel-level
   fixes (strip_crest_bg.py) change content under the same filename — so crest
   URLs carry a ?cv= generation (CRESTV in app.js) and cache matches respect
   the query. Bump this suffix only to nuke the whole asset cache.
   v3: v2 could hold responses cached mid-deploy that render as broken
   images forever (cache-first never revalidates) — flushed 2026-08-01. */
const ASSETS = 'rankxi-assets-v3';
/* The shell must include the code the app needs to boot, not just the HTML —
   precaching only the documents left an installed PWA blank offline. */
const SHELL = [
  // extensionless forms cached too: internal links now use / and /app, and an
  // offline navigation to /app would miss a cache that only holds /app.html
  '/', '/app', '/app.html', '/index.html', '/manifest.webmanifest',
  '/favicon.ico', '/icon-192.png', '/icon-512.png',
  '/js/app.js', '/js/data.js', '/js/rosters.js', '/js/usmap.js', '/js/rxi-a.js',
  '/js/myxi.js', '/js/a2hs.js', '/js/push.js', '/js/native.js',
  '/css/app.css', '/fonts/barlow-condensed-latin-700.woff2',
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
    // way changed pixels reach a browser that already cached the old file.
    // Only real image bodies get cached — an HTML error page or truncated
    // response stored here would render as a broken crest on every visit —
    // and a rejected fetch falls back to any cached generation of the file
    // instead of failing the request outright.
    e.respondWith(
      caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
        const type = (res.headers.get('content-type') || '');
        if (res.ok && (type.startsWith('image/') || type.includes('svg'))) {
          const copy = res.clone();
          caches.open(ASSETS).then(c => c.put(e.request, copy));
        }
        return res;
      }).catch(() => caches.match(e.request, { ignoreSearch: true })
        .then(alt => alt || Response.error())))
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

/* ---- match-alert push -----------------------------------------------------
   Payloads are built by scripts/push_alerts.py and are always JSON:
   { title, body, url, tag }. A payload that fails to parse still shows a
   generic notification — iOS treats a push event that shows nothing as a
   reason to revoke the subscription. */
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data.json(); } catch (err) { /* generic fallback below */ }
  e.waitUntil(self.registration.showNotification(d.title || 'Ranked XI', {
    body: d.body || 'Match day for one of your clubs.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: d.tag || 'rxi',           // same-day repeats replace, never stack
    data: { url: d.url || '/app#/myxi' },
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/app#/myxi';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
      for (const w of ws) {
        if ('focus' in w) { w.navigate(url); return w.focus(); }
      }
      return clients.openWindow(url);
    })
  );
});
