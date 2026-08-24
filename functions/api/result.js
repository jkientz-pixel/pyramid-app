/* POST /api/result — a reader reports a final score for a match we have no
   feed for. Same-origin only; honeypot field `website` silently accepted so
   bots think they won. Rows land as status='pending'. Nothing here is shown
   anywhere or fed to a rating until scripts/review_results.py promotes it. */

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const clip = (v, n) => {
  if (v == null) return null;
  const s = String(v).trim().slice(0, n);
  return s || null;
};
const ID_RE = /^[a-z0-9-]{2,80}$/;
const COMPS = new Set(['league', 'cup', 'playoff', 'friendly']);

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'bad request' }, 400);
  }

  if (body.website) return json({ ok: true });

  const homeId = clip(body.home_id, 80), awayId = clip(body.away_id, 80);
  if (!homeId || !awayId || !ID_RE.test(homeId) || !ID_RE.test(awayId) || homeId === awayId) {
    return json({ ok: false, error: 'Pick both clubs.' }, 400);
  }
  const home = clip(body.home, 120), away = clip(body.away, 120);
  if (!home || !away) return json({ ok: false, error: 'Pick both clubs.' }, 400);

  const date = String(body.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
    return json({ ok: false, error: 'A match date is required.' }, 400);
  }
  const ageDays = (Date.now() - Date.parse(date)) / 864e5;
  if (ageDays < -1 || ageDays > 400) {
    return json({ ok: false, error: 'Match date must be in the past year.' }, 400);
  }

  const hg = Number(body.hg), ag = Number(body.ag);
  const goalOk = n => Number.isInteger(n) && n >= 0 && n <= 30;
  if (!goalOk(hg) || !goalOk(ag)) return json({ ok: false, error: 'Enter both scores (0–30).' }, 400);

  const comp = COMPS.has(body.comp) ? body.comp : null;
  const src = clip(body.src, 300);
  if (src && !/^https?:\/\//i.test(src)) {
    return json({ ok: false, error: 'Source links must start with http:// or https://.' }, 400);
  }

  try {
    await env.DB.prepare(
      `INSERT INTO results (ts, date, home_id, away_id, home, away, hg, ag, comp, src, note, contact, page, ua)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      new Date().toISOString(), date, homeId, awayId, home, away, hg, ag, comp, src,
      clip(body.note, 300), clip(body.contact, 120), clip(body.page, 160),
      clip(request.headers.get('user-agent'), 200)
    ).run();
  } catch (e) {
    return json({ ok: false, error: 'Could not save right now — try again later.' }, 500);
  }
  return json({ ok: true });
}
