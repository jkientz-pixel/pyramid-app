/* POST /api/auth/verify — trade a six-digit code for a session cookie.

   Success creates the account if it does not exist yet. Putting creation here
   rather than in /api/auth/request is what makes that endpoint unable to leak
   whether an address is registered: nothing is written for an address until
   somebody proves they can read its mail.

   The response carries the account's stored picks so the client can merge them
   with whatever is in this browser. The server does not do the merging: the
   pick payload is an opaque string here by design (see migrations/0003), and
   the code that knows how to union two of them already exists in js/myxi.js. */

import {
  json, sha256, sessionToken, timingSafeEqual, normalizeEmail, currentUser,
  cookieHeader, originOk, CODE_MAX_TRIES, SESSION_TTL,
} from '../../../lib/auth.js';

export async function onRequestPost({ request, env }) {
  if (!originOk(request)) return json({ ok: false, error: 'bad request' }, 403);

  let input;
  try { input = await request.json(); } catch { return json({ ok: false, error: 'bad request' }, 400); }

  const email = normalizeEmail(input.email);
  const code = String(input.code || '').replace(/\D/g, '');
  if (!email || code.length !== 6) {
    return json({ ok: false, error: 'That code is not right.' }, 400);
  }

  const row = await env.DB.prepare(
    'SELECT hash, expires, tries FROM login_codes WHERE email = ?'
  ).bind(email).first();

  /* One message for "no code was requested", "the code expired" and "the code
     is wrong". Distinguishing them tells an attacker which addresses have a
     sign-in in flight. */
  const reject = () => json({ ok: false, error: 'That code is wrong or has expired. Ask for a new one.' }, 400);

  if (!row) return reject();
  if (Date.parse(row.expires) <= Date.now()) {
    await env.DB.prepare('DELETE FROM login_codes WHERE email = ?').bind(email).run();
    return reject();
  }
  if (row.tries >= CODE_MAX_TRIES) {
    await env.DB.prepare('DELETE FROM login_codes WHERE email = ?').bind(email).run();
    return reject();
  }

  if (!timingSafeEqual(await sha256(code), row.hash)) {
    await env.DB.prepare('UPDATE login_codes SET tries = tries + 1 WHERE email = ?').bind(email).run();
    return reject();
  }

  /* Single use: the code is spent the moment it works, so a code sitting in a
     mailbox (or a mail provider's link scanner) cannot be replayed later. */
  await env.DB.prepare('DELETE FROM login_codes WHERE email = ?').bind(email).run();

  const nowIso = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO users (email, created, last_seen, age13) VALUES (?,?,?,1)
     ON CONFLICT(email) DO UPDATE SET last_seen = excluded.last_seen`
  ).bind(email, nowIso, nowIso).run();

  const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (!user) return json({ ok: false, error: 'Could not sign you in right now — please try again.' }, 500);

  const token = sessionToken();
  await env.DB.prepare(
    'INSERT INTO sessions (hash, user_id, created, expires, ua) VALUES (?,?,?,?,?)'
  ).bind(
    await sha256(token), user.id, nowIso,
    new Date(Date.now() + SESSION_TTL).toISOString(),
    String(request.headers.get('user-agent') || '').slice(0, 200)
  ).run();

  const picks = await env.DB.prepare(
    'SELECT payload, home, rev FROM user_picks WHERE user_id = ?'
  ).bind(user.id).first();

  return json(
    {
      ok: true,
      email,
      picks: picks ? picks.payload : '',
      home: picks ? picks.home === 1 : false,
      rev: picks ? picks.rev : 0,
    },
    200,
    { 'set-cookie': cookieHeader(token) }
  );
}

/* Signing in on a device that already has a session is not an error worth a
   round trip -- report the existing one. */
export async function onRequestGet({ request, env }) {
  const me = await currentUser(request, env);
  return json({ ok: true, signedIn: !!me, email: me ? me.email : null });
}
