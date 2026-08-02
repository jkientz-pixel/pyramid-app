/* Ranked XI service worker — network-first with cache fallback.
   Keeps the app installable + resilient offline without ever serving
   stale data when the network is up. Bump VERSION with each deploy
   (use scripts/bump_version.py — it moves every file's token together). */
const VERSION = 'rankxi-v20260801m';
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

/* --- Match alerts for followed clubs -----------------------------------
   Prefs live in IndexedDB, mirrored there by app.js — a service worker
   cannot read localStorage. The check runs when the page posts a message
   at boot and via periodic background sync where the platform offers it
   (installed Chromium PWAs). `baseline` marks everything current as read
   without notifying, so enabling alerts never replays season history.
   The kv helper and teamKey duplicate app.js on purpose: this file stays
   dependency-free so a broken import can never take down offline boot. */
const kv = op => new Promise((res, rej) => {
  const q = indexedDB.open('rankxi', 1);
  q.onupgradeneeded = () => q.result.createObjectStore('kv');
  q.onerror = () => rej(q.error);
  q.onsuccess = () => {
    const db = q.result, tx = db.transaction('kv', 'readwrite'), r = op(tx.objectStore('kv'));
    tx.oncomplete = () => { db.close(); res(r.result); };
    tx.onerror = () => { db.close(); rej(tx.error); };
  };
});
const teamKey = nm => nm.toLowerCase().replace(/\b(fc|sc|cf|afc|club|the)\b/g, '').replace(/\s+/g, '');
async function checkFollowUpdates(baseline) {
  const prefs = await kv(s => s.get('alerts')).catch(() => null);
  if (!prefs || !prefs.on || !(prefs.follows || []).length) return;
  const grab = u => fetch(u, { cache: 'no-store' }).then(r => r.json()).catch(() => []);
  const [npsl, asa] = await Promise.all([grab('/data/wire_npsl.json'), grab('/data/wire_asa.json')]);
  const rows = npsl.map(w => ({ ...w, lg: 'npsl' })).concat(asa)
    .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  if (!rows.length) return;
  const keys = new Set(prefs.follows.map(teamKey));
  const fresh = rows.filter(w => w.d > (prefs.last || '')
    && (keys.has(teamKey(w.t1)) || keys.has(teamKey(w.t2))));
  if (fresh.length && !baseline && prefs.last) {
    /* newest three as cards, the rest as one rollup — never forty pings */
    for (const w of fresh.slice(-3).reverse()) {
      await self.registration.showNotification(`${w.t1} ${w.s1}–${w.s2} ${w.t2}`, {
        body: `Full time · Elo swing ±${Math.abs(w.dr)} · tap for your feed`,
        tag: `rankxi-${w.d}-${teamKey(w.t1)}`, icon: '/icon-192.png', badge: '/icon-192.png',
        data: { url: '/app.html#/following' },
      }).catch(() => {});
    }
    if (fresh.length > 3) {
      await self.registration.showNotification(`${fresh.length - 3} more results from your clubs`, {
        body: 'Open the Following tab for the full list', tag: 'rankxi-more',
        icon: '/icon-192.png', badge: '/icon-192.png', data: { url: '/app.html#/following' },
      }).catch(() => {});
    }
  }
  await kv(s => s.put({ ...prefs, last: rows[rows.length - 1].d }, 'alerts')).catch(() => {});
}
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'rankxi-check') e.waitUntil(checkFollowUpdates(e.data.baseline));
});
self.addEventListener('periodicsync', e => {
  if (e.tag === 'rankxi-updates') e.waitUntil(checkFollowUpdates(false));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/app.html#/following';
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
    const w = ws.find(x => x.url.includes('/app.html'));
    return w ? w.focus().catch(() => {}) : clients.openWindow(url);
  }));
});
