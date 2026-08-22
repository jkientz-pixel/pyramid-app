/* PUT /api/picks — store this account's XI.

   The payload is the same opaque string the share link already carries
   (encodePicks in js/myxi.js). The server never parses it. That is a real
   constraint, not laziness: club ids, player ids and national-team ids change
   shape as leagues are added, and an endpoint that validated their meaning
   would need redeploying every time the data did. What it does enforce is
   shape and size, because an unbounded string in a row is a storage bug
   waiting to happen.

   Writes are last-write-wins, and `rev` exists so a client can tell that
   another device wrote since it last read. It is not a lock: two phones
   editing the same XI within seconds of each other is not a scenario worth
   a conflict UI, and the client merges rather than replaces on sign-in, so
   the failure mode of losing the race is a pick reappearing, never one
   silently vanishing. */

import { json, currentUser, originOk } from '../../lib/auth.js';

/* Generous enough for a full XI many times over, small enough that the row
   cannot be used as free storage. encodePicks caps each list at 60 ids. */
const MAX_PAYLOAD = 4096;
const PAYLOAD_RE = /^[A-Za-z0-9_~,:|-]*$/;

export async function onRequestGet({ request, env }) {
  const me = await currentUser(request, env);
  if (!me) return json({ ok: false, error: 'not signed in' }, 401);
  const row = await env.DB.prepare(
    'SELECT payload, home, rev FROM user_picks WHERE user_id = ?'
  ).bind(me.userId).first();
  return json({
    ok: true,
    picks: row ? row.payload : '',
    home: row ? row.home === 1 : false,
    rev: row ? row.rev : 0,
  });
}

export async function onRequestPut({ request, env }) {
  if (!originOk(request)) return json({ ok: false, error: 'bad request' }, 403);
  const me = await currentUser(request, env);
  if (!me) return json({ ok: false, error: 'not signed in' }, 401);

  let input;
  try { input = await request.json(); } catch { return json({ ok: false, error: 'bad request' }, 400); }

  const payload = String(input.picks == null ? '' : input.picks);
  if (payload.length > MAX_PAYLOAD || !PAYLOAD_RE.test(payload)) {
    return json({ ok: false, error: 'bad request' }, 400);
  }
  const home = input.home === true ? 1 : 0;
  const nowIso = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO user_picks (user_id, payload, home, rev, updated) VALUES (?,?,?,1,?)
     ON CONFLICT(user_id) DO UPDATE SET
       payload = excluded.payload,
       home    = excluded.home,
       rev     = user_picks.rev + 1,
       updated = excluded.updated`
  ).bind(me.userId, payload, home, nowIso).run();

  const row = await env.DB.prepare('SELECT rev FROM user_picks WHERE user_id = ?').bind(me.userId).first();
  await env.DB.prepare('UPDATE users SET last_seen = ? WHERE id = ?').bind(nowIso, me.userId).run();

  return json({ ok: true, rev: row ? row.rev : 1 });
}

/* POST is a strict alias for PUT, and exists for one caller: navigator.sendBeacon
   during pagehide, which can only issue POST. A pick made in the last second
   before a tab closes is exactly the write most worth not losing, and every
   other transport gets cancelled at unload. */
export const onRequestPost = onRequestPut;

/* Deleting the account's stored XI. The local copy is untouched -- this
   removes what the server holds, which is the thing the visitor cannot see
   or clear themselves. */
export async function onRequestDelete({ request, env }) {
  if (!originOk(request)) return json({ ok: false, error: 'bad request' }, 403);
  const me = await currentUser(request, env);
  if (!me) return json({ ok: false, error: 'not signed in' }, 401);
  await env.DB.prepare('DELETE FROM user_picks WHERE user_id = ?').bind(me.userId).run();
  return json({ ok: true });
}
