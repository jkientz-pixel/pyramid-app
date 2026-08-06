/* POST /api/tryouts — clubs submit open-tryout dates for the #/tryouts board.
   Same-origin only; honeypot field `website` silently accepted so bots think
   they won. Rows land as status='pending' — nothing publishes until a human
   reviews it and promotes it into data/tryouts.json. */

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
    return json({ ok: false, error: 'A real contact email is required.' }, 400);
  }
  const club = clip(body.club, 80);
  if (!club || club.length < 2) {
    return json({ ok: false, error: 'Club name is required.' }, 400);
  }
  const date = String(body.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return json({ ok: false, error: 'A tryout date is required.' }, 400);
  }
  const link = clip(body.link, 300);
  if (link && !/^https?:\/\//i.test(link)) {
    return json({ ok: false, error: 'Links must start with http:// or https://.' }, 400);
  }

  try {
    await env.DB.prepare(
      `INSERT INTO tryouts (ts, club, league, date, city, state, details, link, email, source, ua)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      new Date().toISOString(),
      club,
      clip(body.league, 60),
      date,
      clip(body.city, 60),
      clip(body.state, 40),
      clip(body.details, 500),
      link,
      email,
      clip(body.source, 40),
      clip(request.headers.get('user-agent'), 200)
    ).run();
  } catch (e) {
    return json({ ok: false, error: 'Could not save right now — please try again.' }, 500);
  }
  return json({ ok: true });
}
