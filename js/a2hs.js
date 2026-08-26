/* iOS add-to-home-screen prompt.

   Why this exists: iPhone is the site's largest platform (41% of visitors in
   the first analytics window) and Apple offers no install banner and no TWA
   route — the only way an iPhone gets the app icon is the visitor doing
   Share → Add to Home Screen by hand. Safari never suggests it. This sheet
   does, once.

   The rules, in the same spirit as the follow-mail prompt in app.js:
     · Safari on iPhone/iPad only. Chrome/Firefox/Edge on iOS bury the action
       differently, and showing instructions that don't match the visitor's
       browser is worse than showing nothing.
     · Never inside the installed app (display-mode: standalone) — the whole
       point is already achieved.
     · It does not nag. Dismissing it writes a flag and it never returns.
     · It waits for engagement (second SPA route in the session), not a timer.
       Someone bouncing off one page was never going to install; someone on
       their second view has seen the thing work.

   Deliberately dependency-free and not a module, like rxi-a.js: it must not
   delay app boot and has no build step. */
(function () {
  'use strict';

  var KEY = 'rxi-a2hs'; /* set = never show again (dismissed or acted on) */

  function standalone() {
    try {
      return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) ||
             navigator.standalone === true;
    } catch (e) { return false; }
  }

  var ua = navigator.userAgent || '';
  /* iPadOS 13+ masquerades as Macintosh; the touch check unmasks it. */
  var isIOS = /iPhone|iPad|iPod/.test(ua) ||
              (/Macintosh/.test(ua) && 'ontouchend' in document);
  /* Third-party iOS browsers announce themselves in the UA; plain Safari
     doesn't. Instructions below are Safari's, so only Safari qualifies. */
  var isSafari = !/CriOS|FxiOS|EdgiOS|OPT\/|Brave/i.test(ua);

  /* Inside the native iOS app (Capacitor shell) the icon already exists. */
  var isNativeApp = false;
  try { isNativeApp = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); } catch (e) {}
  /* Belt and braces: the shell also stamps its user agent (capacitor.config
     ios.appendUserAgent), so the bail-out holds even if the bridge object
     is ever absent. */
  if (/RankedXI-iOS/.test(ua)) isNativeApp = true;
  if (isNativeApp || !isIOS || !isSafari || standalone()) return;
  try { if (localStorage.getItem(KEY)) return; } catch (e) { return; }

  var shown = false;

  function show() {
    if (shown) return;
    shown = true;

    /* The sheet sits ABOVE the tab bar, never over it: covering the app's
       only navigation reads as the app breaking (it did — "the map is super
       glitchy"). The bar is measured rather than hardcoded, and only counts
       when it is actually anchored to the viewport bottom (wide layout moves
       it to the top, where no offset is wanted). z-index stays below the
       bar's 30 so no stacking surprise can ever block a tab. */
    var bar = document.querySelector('.tabbar');
    var r = bar && bar.getBoundingClientRect();
    var lift = (r && r.bottom > innerHeight - 5) ? Math.ceil(r.height) : 0;

    var css =
      '#rxi-a2hs{position:fixed;left:0;right:0;bottom:' + lift + 'px;z-index:20;' +
        'background:var(--raise,#fff);color:var(--ink,#16211B);' +
        'border-top:1px solid var(--line,#DCE2D8);border-radius:16px 16px 0 0;' +
        'box-shadow:0 -8px 30px rgba(22,33,27,.18);' +
        'padding:18px 18px ' + (lift ? '18px' : 'calc(18px + env(safe-area-inset-bottom))') + ';' +
        'font:15px/1.45 -apple-system,"Segoe UI",Roboto,sans-serif;' +
        'transform:translateY(100%);transition:transform .35s cubic-bezier(.16,1,.3,1)}' +
      '#rxi-a2hs.on{transform:none}' +
      '#rxi-a2hs h3{margin:0 0 6px;font-family:var(--font-disp,"Barlow Condensed",sans-serif);' +
        'text-transform:uppercase;letter-spacing:.03em;font-size:1.25rem}' +
      '#rxi-a2hs p{margin:0 0 12px;color:var(--ink-dim,#61705F)}' +
      '#rxi-a2hs ol{margin:0 0 14px;padding-left:2px;list-style:none}' +
      '#rxi-a2hs li{margin:7px 0;display:flex;align-items:center;gap:9px}' +
      '#rxi-a2hs .n{flex:none;width:22px;height:22px;border-radius:50%;' +
        'background:var(--accent,#C77F1E);color:#fff;font-weight:700;font-size:.8rem;' +
        'display:inline-flex;align-items:center;justify-content:center}' +
      '#rxi-a2hs .share{display:inline-block;width:17px;height:17px;vertical-align:-3px}' +
      '#rxi-a2hs button{width:100%;border:1px solid var(--line,#DCE2D8);border-radius:10px;' +
        'background:none;color:var(--ink-dim,#61705F);font:inherit;font-weight:600;' +
        'padding:10px;cursor:pointer}' +
      '@media (prefers-reduced-motion: reduce){#rxi-a2hs{transition:none}}';

    /* Safari's share glyph, drawn inline so the instruction points at the
       exact icon the visitor is about to tap. */
    var shareSvg =
      '<svg class="share" viewBox="0 0 20 26" aria-hidden="true">' +
      '<g fill="none" stroke="#0A84FF" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M10 1.5v14"/><path d="M5.5 6 10 1.5 14.5 6"/>' +
      '<path d="M6 10H3.5v14h13V10H14"/></g></svg>';

    var el = document.createElement('div');
    el.id = 'rxi-a2hs';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Add Ranked XI to your home screen');
    el.innerHTML =
      '<h3>Put Ranked XI on your home screen</h3>' +
      '<p>Full-screen app, works offline &mdash; no App Store needed.</p>' +
      '<ol>' +
      '<li><span class="n">1</span><span>Tap ' + shareSvg + ' <b>Share</b> in the toolbar</span></li>' +
      '<li><span class="n">2</span><span>Scroll down, tap <b>Add to Home Screen</b></span></li>' +
      '</ol>' +
      '<button type="button">Got it</button>';

    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    document.body.appendChild(el);
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      el.classList.add('on');
    }); });

    el.querySelector('button').addEventListener('click', function () {
      try { localStorage.setItem(KEY, String(Date.now())); } catch (e) {}
      el.classList.remove('on');
      setTimeout(function () { el.remove(); style.remove(); }, 400);
    });
  }

  /* Engagement gate: the second hash route of the session — but never while
     the visitor is on the map. The map is a full-bleed pan/zoom surface, and
     a sheet sliding over it mid-gesture reads as the app glitching. Wait for
     whichever later route isn't the map. */
  function maybeShow() {
    if (location.hash.indexOf('#/map') === 0) return;   /* keep waiting */
    removeEventListener('hashchange', maybeShow);
    show();
  }
  addEventListener('hashchange', maybeShow);
})();
