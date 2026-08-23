/* POST /api/interest — "register interest" capture into D1, replacing the
   mailto: links that used to sit on every such CTA.

   A mailto told us nothing: no way to separate "no demand" from "nobody found
   the page". Every price came off the pricing page because there was no demand
   signal to justify one, so this is the instrument that has to produce it.

   Same-origin only; honeypot field `website` silently accepted so bots think
   they won, mirroring /api/follow and /api/signup. Moderation is the tryouts
   flow: read with wrangler, action by hand, set handled=1. */

const KINDS = new Set(['player-claim', 'club-add', 'free-agent', 'club-tools']);

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

  const kind = String(body.kind || '').trim();
  if (!KINDS.has(kind)) return json({ ok: false, error: 'bad request' }, 400);

  const email = String(body.email || '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return json({ ok: false, error: 'A real email address is required.' }, 400);
  }

  /* COPPA attaches at collection, so the gate is enforced here rather than
     trusted to the checkbox being present in the markup. The free-agent board
     is 18+ by its own policy, but 13 is the legal line for holding an email —
     the age policy for the board itself is enforced at moderation. */
  if (body.age13 !== true) {
    return json({ ok: false, error: 'You need to be 13 or older to send this.' }, 400);
  }

  const detail = clip(body.detail, 1200);
  if (kind === 'club-add' && (!detail || detail.length < 10)) {
    return json({ ok: false, error: 'Tell us what to add or fix (a sentence or two).' }, 400);
  }

  try {
    await env.DB.prepare(
      `INSERT INTO interest (ts, kind, email, name, subject, page, detail, age13, src, ua)
       VALUES (?,?,?,?,?,?,?,1,?,?)`
    ).bind(
      new Date().toISOString(),
      kind,
      email,
      clip(body.name, 120),
      clip(body.subject, 160),
      clip(body.page, 160),
      detail,
      clip(body.src, 40),
      clip(request.headers.get('user-agent'), 200)
    ).run();
  } catch (e) {
    return json({ ok: false, error: 'Could not save right now — try again later.' }, 500);
  }
  return json({ ok: true });
}
