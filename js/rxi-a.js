/* First-party pageview ping — see functions/api/hit.js for what is stored.

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
      c: src
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
})();
