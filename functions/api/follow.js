/* POST /api/follow — capture an email against a club the visitor just followed.
   Same-origin only; honeypot field `website` silently accepted so bots think
   they won, mirroring /api/signup.

   The site's promise is that following a club is local-only and leaves no
   trace on a server. That promise holds: this endpoint fires only when a
   visitor explicitly types an email and submits the form. Tapping Follow
   still writes nothing but localStorage. */

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const clip = (v, n) => {
  if (v == null) return null;
  const s = String(v).trim().slice(0, n);
  return s || null;
};

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'bad request' }, 400);
  }

  if (body.website) return json({ ok: true });

  const email = String(body.email || '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return json({ ok: false, error: 'A real email address is required.' }, 400);
  }

  /* COPPA attaches at collection, so the gate is enforced here rather than
     trusted to the checkbox being present in the markup. */
  if (body.age13 !== true) {
    return json({ ok: false, error: 'You need to be 13 or older to get emails.' }, 400);
  }

  const club = clip(body.club, 80);
  if (!club || !/^[a-z0-9-]+$/.test(club)) {
    return json({ ok: false, error: 'bad request' }, 400);
  }

  try {
    await env.DB.prepare(
      `INSERT INTO follows (ts, email, club, age13, source, ua)
       VALUES (?,?,?,1,?,?)
       ON CONFLICT(email, club) DO UPDATE SET
         ts=excluded.ts,
         source=excluded.source,
         unsub=0`
    ).bind(
      new Date().toISOString(),
      email,
      club,
      clip(body.source, 40),
      clip(request.headers.get('user-agent'), 200)
    ).run();
  } catch (e) {
    return json({ ok: false, error: 'Could not save right now — please try again.' }, 500);
  }
  return json({ ok: true });
}
