/* Shared auth primitives for the My XI account endpoints.

   Lives outside functions/ on purpose. Cloudflare Pages routes every file
   under functions/ to a URL, and wrangler's bundler resolves relative imports
   from anywhere on disk — so a module here is reachable by the endpoints and
   reachable by nobody else. deploy.sh stages a fixed file list into
   .deploy-stage and lib/ is not on it, so this never ships as a static asset
   either. Both properties matter: this file decides who is signed in.

   Two rules the rest of the auth code depends on:

   1. Nothing here is stored in a form that can be replayed. Login codes and
      session tokens are written to D1 as SHA-256 hashes. The whole reason
      this design has no passwords is to avoid holding a credential worth
      stealing; storing a working six-digit code or a live session token in
      plaintext would quietly reintroduce exactly that.
   2. The session cookie is set by the server, never by script. That is not a
      style preference -- it is the mechanism. Safari deletes script-writable
      storage after seven days of browser use without interaction with the
      origin, and a document.cookie write counts as script-writable. A
      Set-Cookie header from the origin does not, so the session survives the
      eviction that erases localStorage. */

export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });

export const now = () => new Date();
export const iso = d => d.toISOString();
export const plus = (ms, from = Date.now()) => new Date(from + ms);

export const MINUTE = 60e3;
export const CODE_TTL = 10 * MINUTE;        /* long enough to fetch an email, short enough to matter */
export const CODE_MAX_TRIES = 5;            /* six digits is 1e6; five guesses is not a search */
export const RESEND_COOLDOWN = 60e3;        /* one code per minute per address */
export const RESEND_MAX_PER_WINDOW = 5;     /* ...and no more than five inside one code's life */
export const SESSION_TTL = 365 * 864e5;     /* the point of the feature is that it outlasts a week */
export const COOKIE = 'rxi_s';

const enc = new TextEncoder();

export async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(String(s)));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* Rejection sampling rather than % 1000000. A modulo over 2^32 leaves the low
   codes very slightly likelier, which is a real (if small) bias in something
   whose entire security budget is six digits. */
export function sixDigitCode() {
  const LIMIT = Math.floor(0xffffffff / 1e6) * 1e6;
  const a = new Uint32Array(1);
  do { crypto.getRandomValues(a); } while (a[0] >= LIMIT);
  return String(a[0] % 1e6).padStart(6, '0');
}

export function sessionToken() {
  const a = new Uint8Array(32);
  crypto.getRandomValues(a);
  return [...a].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* Constant-time compare. The codes are hashed before they reach here, so a
   timing leak would only reveal hash prefixes -- but this costs nothing and
   removes the need to reason about that at all. */
export function timingSafeEqual(a, b) {
  const x = String(a), y = String(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(v) {
  const s = String(v || '').trim().toLowerCase();
  return s.length <= 254 && EMAIL_RE.test(s) ? s : null;
}

/* ---- cookies ------------------------------------------------------------ */

export function cookieHeader(token) {
  /* SameSite=Lax, not Strict: the app is a hash-router single page, but a
     visitor arriving from a shared link or an emailed link is a top-level
     cross-site GET, and Strict would leave them looking at a logged-out page
     they are in fact logged into. Lax still blocks the cross-site POSTs that
     CSRF needs. */
  return `${COOKIE}=${token}; Path=/; Max-Age=${Math.floor(SESSION_TTL / 1000)}; HttpOnly; Secure; SameSite=Lax`;
}

export const clearCookieHeader = () =>
  `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

export function readCookie(request, name = COOKIE) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/* ---- session ------------------------------------------------------------ */

/* Returns { userId, email } or null. Expired rows are deleted on sight rather
   than left for a sweeper: this is the only code path that reliably runs, and
   an expired session row is the one piece of garbage worth collecting eagerly. */
export async function currentUser(request, env) {
  const token = readCookie(request);
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const hash = await sha256(token);
  const row = await env.DB.prepare(
    `SELECT s.user_id AS userId, s.expires AS expires, u.email AS email
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.hash = ?`
  ).bind(hash).first();
  if (!row) return null;
  if (Date.parse(row.expires) <= Date.now()) {
    await env.DB.prepare('DELETE FROM sessions WHERE hash = ?').bind(hash).run();
    return null;
  }
  return { userId: row.userId, email: row.email };
}

/* ---- CSRF --------------------------------------------------------------- */

/* The session cookie is SameSite=Lax, which already stops cross-site POSTs.
   This is the second lock: a state-changing request must also declare an Origin
   this site owns. Requests with no Origin header at all are allowed through
   because same-origin fetch() in some browsers omits it on same-origin POSTs;
   the Lax cookie is what covers that case. */
export function originOk(request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch { return false; }
}

/* ---- outbound mail ------------------------------------------------------ */

/* One function, one provider, deliberately thin. Cloudflare Workers cannot
   open an SMTP socket, so sending is an HTTPS POST to somebody's API either
   way; keeping that to a single call site means swapping Resend for
   Cloudflare Email Service (or anything else) is an edit here and nowhere
   else. Throws on failure so the caller can decide whether to surface it --
   a sign-in code that was never sent must never report success. */
export async function sendMail(env, { to, subject, text, html }) {
  const key = env.RESEND_API_KEY;
  if (!key) throw new Error('mail not configured');
  const from = env.MAIL_FROM || 'Ranked XI <no-reply@rankedxi.com>';
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, text, html }),
  });
  if (!r.ok) throw new Error(`mail send failed: ${r.status}`);
  return true;
}
