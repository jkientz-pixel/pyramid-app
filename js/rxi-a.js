/* First-party pageview ping — see functions/api/hit.js for what is stored —
   plus friction signals (rage/dead clicks, our own JS errors) — see
   functions/api/friction.js.

   Loaded on every page type (landing, app shell, generated club/league/state
   pages). Deliberately dependency-free and not a module: the generated SEO
   pages are flat HTML with no build step, and this has to work there too.

   Only production hostnames report. Preview deploys and localhost would
   otherwise bury real traffic under our own testing. */
(function () {
  var HOST_OK = /(^|\.)rankedxi\.com$/.test(location.hostname);
  if (!HOST_OK) return;

  try {
    if (navigator.doNotTrack === '1' || window.doNotTrack === '1' ||
        navigator.msDoNotTrack === '1' || navigator.globalPrivacyControl) return;
  } catch (e) { return; }

  /* 16 chars of base36. Long enough that collisions across our traffic volumes
     are not a thing, short enough to stay cheap in D1. */
  function mint() {
    var s = '';
    try {
      var a = new Uint8Array(16);
      crypto.getRandomValues(a);
      for (var i = 0; i < 16; i++) s += (a[i] % 36).toString(36);
      return s;
    } catch (e) {
      while (s.length < 16) s += Math.random().toString(36).slice(2);
      return s.slice(0, 16);
    }
  }

  /* Private-mode Safari throws on storage access rather than returning null,
     so every touch is guarded. A visitor whose storage is unavailable still
     gets counted — they just look like a new visitor every time, which is the
     honest reading of the situation anyway. */
  function stored(store, key, out) {
    try {
      var v = window[store].getItem(key);
      if (v) return v;
      v = mint();
      window[store].setItem(key, v);
      out.minted = true;
      return v;
    } catch (e) {
      out.minted = true;
      return mint();
    }
  }

  var first = { minted: false };
  var vid = stored('localStorage', 'rxi_v', first);
  var sid = stored('sessionStorage', 'rxi_s', { minted: false });
  var fresh = first.minted;

  /* The one query parameter we read, and the only one the server will store.
     Social platforms strip or rewrite referrers — an iPhone tapping a link
     inside the Facebook or Reddit app arrives looking like direct traffic — so
     without this there is no way to tell which channel produced a visit.

     Deliberately narrow: `utm_source` and nothing else. No utm_term, no
     utm_content, no arbitrary query string. The shape below is checked again
     server-side against a fixed list of our own channels, so a stray or
     hand-crafted parameter is dropped rather than recorded. This identifies a
     channel, never a person, and nothing here can follow anyone off the site. */
  var SRC_OK = /^[a-z][a-z0-9_-]{0,23}$/;
  var src = (function () {
    try {
      var m = /[?&]utm_source=([^&#]*)/.exec(location.search);
      if (!m) return null;
      var v = decodeURIComponent(m[1]).toLowerCase();
      return SRC_OK.test(v) ? v : null;
    } catch (e) { return null; }
  })();

  /* Kept for the session so a form submitted later in the visit can record the
     channel that produced it. Read-only to the rest of the app; `src` itself is
     nulled after the landing pageview so the tag is not stamped on every hit. */
  try { window.__rxiSrc = src; } catch (e) {}

  /* Installed-app pageview or browser-tab pageview. display-mode:standalone is
     true inside the Android TWA and an iOS/desktop PWA launched from the home
     screen; navigator.standalone is the legacy iOS Safari spelling. This one
     bit is what separates "has the app" from "visited the site" — the metric
     the store download count only pretends to be. */
  var pwa = (function () {
    try {
      return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) ||
             navigator.standalone === true;
    } catch (e) { return false; }
  })();

  var last = '';
  function send() {
    var path = location.pathname + (location.hash.indexOf('#/') === 0 ? location.hash : '');
    if (path === last) return;
    last = path;

    var payload = JSON.stringify({
      p: path,
      r: document.referrer || null,
      v: vid,
      s: sid,
      n: fresh,
      c: src,
      w: pwa
    });
    fresh = false; /* only the very first pageview of a new visitor counts as new */
    /* Only the landing pageview carries the source. Later hits in the same
       visit are tied to it by `sid`, so reporting attributes the whole session
       without stamping the campaign tag on every row. */
    src = null;

    try {
      if (navigator.sendBeacon &&
          navigator.sendBeacon('/api/hit', new Blob([payload], { type: 'application/json' }))) return;
    } catch (e) {}
    try {
      fetch('/api/hit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: payload,
        keepalive: true
      }).catch(function () {});
    } catch (e) {}
  }

  send();
  /* The app is a hash-routed SPA; without this every session reads as one
     pageview on /app and the per-feature question is unanswerable. */
  addEventListener('hashchange', send);

  /* ---- Friction signals → /api/friction --------------------------------
     Where a page got in someone's way, without a replay vendor: see
     migrations/0010_friction.sql for what is stored and what is not. The
     target is described by our own markup (tag, id, classes), never by the
     text on the page or anything typed into it. */
  var FR_MAX = 20;              /* per page load — a broken page must not flood D1 */
  var RAGE_CLICKS = 3, RAGE_MS = 800, RAGE_PX = 24;
  var DEAD_MS = 1000;
  var frSent = 0, frSeen = {};

  function here() {
    return location.pathname + (location.hash.indexOf('#/') === 0 ? location.hash : '');
  }

  function part(el) {
    var s = el.tagName.toLowerCase();
    if (el.id && /^[\w-]{1,40}$/.test(el.id)) return s + '#' + el.id;
    var cls = (typeof el.className === 'string' ? el.className : '').split(/\s+/);
    for (var i = 0, n = 0; i < cls.length && n < 2; i++) {
      if (/^[\w-]{1,30}$/.test(cls[i])) { s += '.' + cls[i]; n++; }
    }
    return s;
  }

  /* Element plus its nearest ancestor that has an id, which is usually enough
     to find it in the source: "section#radar > button.go". */
  function describe(el) {
    if (!el || el.nodeType !== 1) return null;
    var me = part(el);
    if (el.id) return me;
    for (var a = el.parentElement, k = 0; a && k < 6; a = a.parentElement, k++) {
      if (a.id && /^[\w-]{1,40}$/.test(a.id)) return part(a) + ' > ' + me;
    }
    return me;
  }

  function fr(kind, el, detail) {
    if (frSent >= FR_MAX) return;
    var t = describe(el);
    var key = kind + '|' + here() + '|' + t + '|' + (detail || '');
    if (frSeen[key]) return;       /* one report per thing per page load */
    frSeen[key] = 1;
    frSent++;
    var payload = JSON.stringify({ k: kind, p: here(), t: t, x: detail || null, v: vid, s: sid });
    try {
      if (navigator.sendBeacon &&
          navigator.sendBeacon('/api/friction', new Blob([payload], { type: 'application/json' }))) return;
    } catch (e) {}
    try {
      fetch('/api/friction', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: payload, keepalive: true
      }).catch(function () {});
    } catch (e) {}
  }

  /* Rage: RAGE_CLICKS clicks inside RAGE_MS, all within RAGE_PX of the first. */
  var burst = [];
  function rage(ev) {
    var now = Date.now();
    burst = burst.filter(function (c) { return now - c.t < RAGE_MS; });
    if (burst.length && (Math.abs(ev.clientX - burst[0].x) > RAGE_PX ||
                         Math.abs(ev.clientY - burst[0].y) > RAGE_PX)) burst = [];
    burst.push({ t: now, x: ev.clientX, y: ev.clientY });
    if (burst.length >= RAGE_CLICKS) { burst = []; fr('rage', ev.target); }
  }

  /* Dead: a click on a link or button after which nothing changed — no DOM
     mutation, no route change, no scroll, no navigation — within DEAD_MS.
     Form fields are excluded (focusing one changes nothing visible, by design),
     and so are links that open elsewhere. */
  var ACTIVE = 'a[href],button,[role="button"],[role="tab"],summary';
  /* Any link that is not an in-page hash route leaves the page; a slow load
     would read as "nothing happened", so those are not judged at all. */
  var ELSEWHERE = 'a[href]:not([href^="#"]),a[target="_blank"],a[download]';
  function dead(ev) {
    var el = ev.target && ev.target.closest && ev.target.closest(ACTIVE);
    if (!el || el.disabled || el.matches(ELSEWHERE) || !window.MutationObserver) return;
    var changed = false;
    var mark = function () { changed = true; };
    var mo = new MutationObserver(mark);
    mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
    addEventListener('hashchange', mark);
    addEventListener('scroll', mark, true);
    addEventListener('pagehide', mark);
    setTimeout(function () {
      mo.disconnect();
      removeEventListener('hashchange', mark);
      removeEventListener('scroll', mark, true);
      removeEventListener('pagehide', mark);
      if (!changed) fr('dead', el);
    }, DEAD_MS);
  }

  addEventListener('click', function (ev) {
    try { rage(ev); dead(ev); } catch (e) {}
  }, true);

  /* Errors from our own scripts only. Extensions and cross-origin scripts
     surface as foreign filenames or the opaque "Script error." — neither is
     ours to fix, so neither is recorded. */
  function errFrom(msg, file, line) {
    if (!msg || msg === 'Script error.') return;
    if (file && file.indexOf(location.origin) !== 0) return;
    var base = file ? file.split('?')[0].split('/').pop() : '';
    fr('err', null, String(msg).slice(0, 140) + (base ? ' @' + base + ':' + (line || 0) : ''));
  }
  addEventListener('error', function (ev) {
    try { if (ev instanceof ErrorEvent) errFrom(ev.message, ev.filename, ev.lineno); } catch (e) {}
  });
  addEventListener('unhandledrejection', function (ev) {
    try {
      var r = ev.reason;
      errFrom('Unhandled rejection: ' + (r && r.message ? r.message : String(r)));
    } catch (e) {}
  });
})();
