/* POST /api/correction — community data corrections ("this club's city/coach/league
   is wrong") into D1. Same-origin only; honeypot field `website` silently accepted
   so bots think they won. Moderation = read via wrangler, apply by hand (same flow
   as tryouts). */

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

  const message = clip(body.message, 1000);
  if (!message || message.length < 10) {
    return json({ ok: false, error: 'Tell us what needs fixing (a sentence or two).' }, 400);
  }

  try {
    await env.DB.prepare(
      `INSERT INTO corrections (ts, club, page, message, contact, ua)
       VALUES (?,?,?,?,?,?)`
    ).bind(
      new Date().toISOString(),
      clip(body.club, 120),
      clip(body.page, 160),
      message,
      clip(body.contact, 120),
      clip(request.headers.get('user-agent'), 200)
    ).run();
  } catch (e) {
    return json({ ok: false, error: 'Could not save right now — try again later.' }, 500);
  }
  return json({ ok: true });
}
