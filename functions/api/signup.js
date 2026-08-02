/* POST /api/signup — capture list signups + requests with contact details into D1.
   Same-origin only; honeypot field `website` silently accepted so bots think they won. */

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

  const kind = clip(body.kind, 32) || 'updates';
  try {
    await env.DB.prepare(
      `INSERT INTO signups (ts, kind, name, email, role, state, message, source, ua)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(email, kind) DO UPDATE SET
         ts=excluded.ts,
         name=COALESCE(excluded.name, name),
         role=COALESCE(excluded.role, role),
         state=COALESCE(excluded.state, state),
         message=COALESCE(excluded.message, message),
         source=excluded.source`
    ).bind(
      new Date().toISOString(),
      kind,
      clip(body.name, 80),
      email,
      clip(body.role, 40),
      clip(body.state, 40),
      clip(body.message, 500),
      clip(body.source, 40),
      clip(request.headers.get('user-agent'), 200)
    ).run();
  } catch (e) {
    return json({ ok: false, error: 'Could not save right now — please try again.' }, 500);
  }
  return json({ ok: true });
}
