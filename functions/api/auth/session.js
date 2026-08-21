/* /api/auth/session — who am I (GET), and sign out (DELETE).

   GET is what every page load calls to decide whether to show "Sign in" or the
   account's email. It is deliberately cheap and deliberately unauthenticated-
   safe: no session simply returns signedIn:false, never an error, because a
   logged-out visitor is the normal case and not a failure. */

import { json, sha256, readCookie, currentUser, clearCookieHeader, originOk } from '../../../lib/auth.js';

export async function onRequestGet({ request, env }) {
  const me = await currentUser(request, env);
  if (!me) return json({ ok: true, signedIn: false });

  const picks = await env.DB.prepare(
    'SELECT payload, home, rev FROM user_picks WHERE user_id = ?'
  ).bind(me.userId).first();

  return json({
    ok: true,
    signedIn: true,
    email: me.email,
    picks: picks ? picks.payload : '',
    home: picks ? picks.home === 1 : false,
    rev: picks ? picks.rev : 0,
  });
}

/* Sign out drops this one session, not every session for the account. Signing
   out of a shared computer must not knock the same person off their phone. */
export async function onRequestDelete({ request, env }) {
  if (!originOk(request)) return json({ ok: false, error: 'bad request' }, 403);
  const token = readCookie(request);
  if (token && /^[0-9a-f]{64}$/.test(token)) {
    await env.DB.prepare('DELETE FROM sessions WHERE hash = ?').bind(await sha256(token)).run();
  }
  /* The cookie is cleared whether or not a row matched: a stale or forged
     cookie should still leave the browser on the way out. */
  return json({ ok: true, signedIn: false }, 200, { 'set-cookie': clearCookieHeader() });
}
