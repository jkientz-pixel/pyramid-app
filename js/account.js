/* My XI accounts: session state, the sign-in panel, and the sync engine.

   Why this exists, in one line: localStorage is per-device and Safari deletes
   it after seven days of browser use without a visit, so "your picks live in
   this browser" meant a phone XI that vanished and a desktop XI that never
   reached the phone.

   Three rules this module is built on:

   1. Signing in is never required. Logged out, My XI behaves exactly as it did
      before this file existed -- every read and write still goes to
      localStorage first. The account is a durability layer over that, not a
      gate in front of it. If every endpoint here 500s, the app still works.
   2. Local is the working copy; the server is the backup. The UI never waits
      on the network to show a pick. A tap writes localStorage and re-renders
      immediately; the push happens afterwards and is allowed to fail.
   3. Sync merges, never replaces. See mergePayloads in js/picks.js for why.

   Version tokens: this file is listed in scripts/bump_version.py because it
   imports ./picks.js with a ?v= token, and /js/* is served immutable for a
   year. A token here that never gets rewritten would pin every visitor to the
   first build of picks.js forever. */

import { localPayload, mergePayloads, applyPayload, isHome, setHome } from './picks.js?v=20260822i';

const PUSH_DEBOUNCE = 1200;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const state = {
  ready: false,
  signedIn: false,
  email: null,
  rev: 0,
  /* a push that failed, waiting for a better moment */
  pending: false,
  /* 'idle' | 'email' | 'code' — which face the panel is showing */
  step: 'idle',
  codeEmail: null,
  busy: false,
  msg: '',
};

export const accountState = () => ({ ...state });

const listeners = new Set();
export const onAccountChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach(fn => { try { fn(accountState()); } catch { /* a bad listener must not break sync */ } });

const api = async (url, opts = {}) => {
  const r = await fetch(url, {
    credentials: 'same-origin',
    headers: opts.body ? { 'content-type': 'application/json' } : undefined,
    ...opts,
  });
  let d = {};
  try { d = await r.json(); } catch { /* non-JSON error page */ }
  return { status: r.status, ok: r.ok, ...d };
};

/* ---- sync ---------------------------------------------------------------- */

let pushTimer = null;

/* Send the browser's current XI to the server. Silent by design: this runs
   behind ordinary taps, and a toast every time somebody stars a club would be
   noise. A failure sets `pending` and the next opportunity retries. */
async function push() {
  if (!state.signedIn) return;
  try {
    const d = await api('/api/picks', {
      method: 'PUT',
      body: JSON.stringify({ picks: localPayload(), home: isHome() }),
    });
    if (d.ok) { state.rev = d.rev || state.rev; state.pending = false; }
    else if (d.status === 401) { state.signedIn = false; state.email = null; }
    else state.pending = true;
  } catch { state.pending = true; }
  emit();
}

/* Fold whatever the server holds into this browser, and vice versa. Returns
   true when the local XI actually changed, so the caller can re-render rather
   than repainting on every boot. */
async function reconcile(serverPicks, serverHome) {
  const before = localPayload();
  const merged = mergePayloads(before, serverPicks || '');
  const changedLocal = merged !== before;
  if (changedLocal) applyPayload(merged);
  /* home is a preference, not a pick, and OR is the union-consistent fold:
     switching My XI on as your home tab on one device should not be undone by
     a device where you never turned it on. */
  const home = isHome() || serverHome === true;
  if (home !== isHome()) setHome(home);
  if (merged !== (serverPicks || '') || home !== (serverHome === true)) await push();
  return changedLocal;
}

/* ---- lifecycle ----------------------------------------------------------- */

let booted = null;

/* Called once at app start. Never throws and never blocks first paint --
   callers await it only to learn whether to re-render. */
export function bootAccount() {
  return booted ||= (async () => {
    try {
      const d = await api('/api/auth/session');
      state.ready = true;
      if (d.ok && d.signedIn) {
        state.signedIn = true;
        state.email = d.email;
        state.rev = d.rev || 0;
        const changed = await reconcile(d.picks, d.home);
        emit();
        return { changed, signedIn: true };
      }
    } catch { /* offline, or the endpoint is not deployed yet — stay logged out */ }
    state.ready = true;
    emit();
    return { changed: false, signedIn: false };
  })();
}

/* Every pick change funnels through here. Debounced because starring four
   clubs in a row is four writes and should be one request. */
export function touchAccount() {
  /* Deliberately does NOT early-return on !state.signedIn. The session lookup
     runs after first paint, so the first seconds of a visit are a window where
     a signed-in visitor still looks logged out to this module -- and a pick
     made in that window was silently dropped. Schedule regardless and let
     push() decide once boot has settled; logged out, it is a cheap no-op. */
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    Promise.resolve(booted).then(push).catch(() => {});
  }, PUSH_DEBOUNCE);
}

/* A pending push gets another chance whenever the tab comes back to life or
   the network returns. Both are cheap listeners and both are moments when a
   previously-failed write is likely to succeed. */
if (typeof document !== 'undefined') {
  const retry = () => { if (state.signedIn && state.pending) push(); };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) retry(); });
  addEventListener('online', retry);
  /* A push in flight when the tab closes would be dropped. This is the one
     place a synchronous-ish send is worth it. */
  addEventListener('pagehide', () => {
    if (!state.signedIn || !pushTimer) return;
    clearTimeout(pushTimer);
    try {
      const body = new Blob([JSON.stringify({ picks: localPayload(), home: isHome() })],
        { type: 'application/json' });
      /* sendBeacon cannot do PUT, so the POST alias exists for exactly this. */
      navigator.sendBeacon?.('/api/picks?beacon=1', body);
    } catch { /* nothing more to try at unload */ }
  });
}

/* ---- sign-in actions ------------------------------------------------------ */

export async function requestCode(email, age13) {
  const addr = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(addr)) return { ok: false, error: 'A real email address is required.' };
  if (!age13) return { ok: false, error: 'You need to be 13 or older to save your XI.' };
  state.busy = true; emit();
  let d;
  try { d = await api('/api/auth/request', { method: 'POST', body: JSON.stringify({ email: addr, age13: true }) }); }
  catch { d = { ok: false, error: 'Could not reach the server — check your connection.' }; }
  state.busy = false;
  if (d.ok) { state.step = 'code'; state.codeEmail = addr; state.msg = ''; }
  emit();
  return d;
}

export async function verifyCode(code) {
  const c = String(code || '').replace(/\D/g, '');
  if (c.length !== 6) return { ok: false, error: 'Enter the six digits from the email.' };
  state.busy = true; emit();
  let d;
  try { d = await api('/api/auth/verify', { method: 'POST', body: JSON.stringify({ email: state.codeEmail, code: c }) }); }
  catch { d = { ok: false, error: 'Could not reach the server — check your connection.' }; }
  state.busy = false;
  if (!d.ok) { emit(); return d; }
  state.signedIn = true;
  state.email = d.email;
  state.rev = d.rev || 0;
  state.step = 'idle';
  state.codeEmail = null;
  const changed = await reconcile(d.picks, d.home);
  emit();
  return { ok: true, changed };
}

export async function signOut() {
  try { await api('/api/auth/session', { method: 'DELETE' }); } catch { /* clearing locally regardless */ }
  state.signedIn = false;
  state.email = null;
  state.rev = 0;
  state.pending = false;
  state.step = 'idle';
  emit();
  /* Picks stay in this browser. Signing out is "stop syncing", not "delete my
     XI" -- wiping the visible page because somebody signed out of a shared
     laptop would read as data loss. */
}

export function startSignIn() { state.step = 'email'; state.msg = ''; emit(); }
export function cancelSignIn() { state.step = 'idle'; state.codeEmail = null; state.msg = ''; emit(); }

/* ---- the panel ------------------------------------------------------------
   Rendered inside the My XI screen. Kept here rather than in js/myxi.js so the
   state machine and the markup that reflects it cannot drift apart, and so
   myxi.js stays a screen that receives its dependencies rather than one that
   knows how sign-in works. */

const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function accountBlock() {
  const head = `<div class="kicker" style="margin-top:20px">Save your XI</div>`;

  if (state.signedIn) {
    return head + `
      <div class="mx-acct saved" id="mxacct">
        <b>&#10003; Saved to ${esc(state.email)}</b>
        <p class="note" style="margin:.35em 0 .6em">Your XI syncs to every device you sign in on.
           ${state.pending ? 'One change is still waiting to save &mdash; it will retry on its own.' : 'Everything is backed up.'}</p>
        <button type="button" class="mx-linkbtn" id="mxsignout">Sign out on this device</button>
      </div>`;
  }

  if (state.step === 'code') {
    return head + `
      <div class="mx-acct" id="mxacct">
        <b>Check your email</b>
        <p class="note" style="margin:.35em 0 .6em">We sent a six-digit code to <b>${esc(state.codeEmail)}</b>.
           It expires in 10 minutes.</p>
        <form class="joinform" id="mxcodeform" novalidate>
          <label class="sr-only" for="mx-code">Six-digit code</label>
          <input id="mx-code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code"
                 pattern="[0-9]*" maxlength="6" placeholder="123456" required
                 style="flex:2 1 140px;letter-spacing:.3em;font-weight:700">
          <button type="submit" class="joinbtn"${state.busy ? ' disabled' : ''}>Save my XI</button>
        </form>
        <p class="join-msg" id="mxacctmsg" role="status" aria-live="polite">${esc(state.msg)}</p>
        <button type="button" class="mx-linkbtn" id="mxresend">Send another code</button>
        <button type="button" class="mx-linkbtn" id="mxcancel">Use a different email</button>
      </div>`;
  }

  if (state.step === 'email') {
    return head + `
      <div class="mx-acct" id="mxacct">
        <b>Where should we save it?</b>
        <p class="note" style="margin:.35em 0 .6em">We'll email you a six-digit code. No password to make,
           none to forget.</p>
        <form class="joinform" id="mxemailform" novalidate>
          <input type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true"
                 style="position:absolute;left:-9999px">
          <label class="sr-only" for="mx-email">Email address</label>
          <input id="mx-email" name="email" type="email" placeholder="you@email.com" required
                 autocomplete="email" maxlength="254">
          <label class="ck"><input type="checkbox" name="age13" value="1"> I'm 13 or older</label>
          <button type="submit" class="joinbtn"${state.busy ? ' disabled' : ''}>Email me a code</button>
        </form>
        <p class="join-msg" id="mxacctmsg" role="status" aria-live="polite">${esc(state.msg)}</p>
        <button type="button" class="mx-linkbtn" id="mxcancel">Not now</button>
      </div>`;
  }

  /* The resting state. It names the two failures the account actually fixes,
     because "create an account" with no reason attached is a cost with no
     visible benefit -- and one of these two has already happened to anyone
     who has used the site on a phone for more than a week. */
  return head + `
    <div class="mx-acct" id="mxacct">
      <b>Right now your XI only exists in this browser</b>
      <p class="note" style="margin:.35em 0 .6em">Open Ranked XI on your phone and it starts empty.
         And iPhones clear this kind of storage after a week away, which takes your picks with it.
         Save your XI and it follows you to every device &mdash; and survives.</p>
      <button type="button" class="joinbtn" id="mxsignin">Save my XI</button>
      <p class="note" style="margin:.5em 0 0;font-size:.78rem">Email only. No password, no profile,
         nothing public &mdash; your XI stays as private as it is now.</p>
    </div>`;
}

/* Handlers for whichever face is on screen. `refresh` re-renders the My XI
   view in place; the panel re-renders itself for anything that only changes
   the sign-in step, so the whole screen is not repainted mid-typing. */
let unwirePanel = null;

export function wireAccount(root, refresh) {
  /* Only one panel is ever on screen. Dropping the previous subscription here
     rather than on teardown is what keeps re-rendering My XI — which happens
     on every pick — from stacking a listener per render. */
  unwirePanel?.();
  unwirePanel = null;

  const panel = root.querySelector('#mxacct');
  if (!panel) return;

  const repaint = () => {
    const host = root.querySelector('#mxacct');
    if (!host) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = accountBlock();
    const next = wrap.querySelector('#mxacct');
    if (next) { host.replaceWith(next); wireAccount(root, refresh); }
  };

  /* The session lookup is a round trip and the screen paints before it lands,
     so a signed-in visitor's first render of this panel says "save your XI" to
     someone who already has. Repaint when the answer arrives.

     Only on a change of *identity*, though. emit() also fires for `busy` and
     for step changes, and repainting on those tore the form out from under the
     visitor mid-submit -- the first version of this listener repainted on
     every emit and broke ten tests that had been passing. Everything except
     signing in or out is driven explicitly by the handlers below, which own
     their own markup and know when it is safe to replace. */
  let renderedFor = state.signedIn ? state.email : null;
  unwirePanel = onAccountChange(next => {
    if (!root.isConnected || !root.querySelector('#mxacct')) { unwirePanel?.(); unwirePanel = null; return; }
    const identity = next.signedIn ? next.email : null;
    if (identity === renderedFor) return;
    renderedFor = identity;
    repaint();
  });

  const say = text => {
    const m = root.querySelector('#mxacctmsg');
    if (m) m.textContent = text;
  };

  panel.querySelector('#mxsignin')?.addEventListener('click', () => { startSignIn(); repaint(); });
  panel.querySelector('#mxcancel')?.addEventListener('click', () => { cancelSignIn(); repaint(); });

  panel.querySelector('#mxsignout')?.addEventListener('click', async () => {
    await signOut();
    repaint();
  });

  panel.querySelector('#mxemailform')?.addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    if (f.get('website')) return;                     /* honeypot */
    say('Sending…');
    const d = await requestCode(f.get('email'), !!f.get('age13'));
    if (d.ok) repaint(); else say(d.error || 'Could not send the code — please try again.');
  });

  panel.querySelector('#mxresend')?.addEventListener('click', async () => {
    say('Sending…');
    const d = await requestCode(state.codeEmail, true);
    say(d.ok ? 'Another code is on its way.' : (d.error || 'Could not send the code — please try again.'));
  });

  panel.querySelector('#mxcodeform')?.addEventListener('submit', async e => {
    e.preventDefault();
    say('Checking…');
    const d = await verifyCode(new FormData(e.target).get('code'));
    if (!d.ok) { say(d.error || 'That code is wrong or has expired.'); return; }
    /* A merge that pulled picks in from another device changes the whole
       screen, not just this panel. */
    if (d.changed) refresh(); else repaint();
  });
}
