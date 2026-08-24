/* /api/claim — "I represent this club."

   GET  ?club=<id>  -> where this visitor stands with this club: signed in or
                       not, whether their email would self-verify, and the
                       state of any claim they already made. The club screen
                       calls this to decide which of three faces to show
                       (sign in / claim / intake form).
   POST {club, repName, repRole, note} -> record the claim.

   The gate, in one sentence: a signed-in account (the existing passwordless
   My XI login, which already proved control of the mailbox) whose email sits
   on the club's own website domain is verified on the spot; anything else is
   `pending` for a human. The domain the club is compared against comes from
   lib/club_domains.json, generated from CLUBS at deploy time — never from the
   request, which is the only way this check means anything.

   Rows never downgrade. A verified claim stays verified if the person clicks
   again; a rejected one stays rejected (they can email). Same-origin only. */

import { currentUser, originOk } from '../../lib/auth.js';
import { json, clip, clubRecord, domainMatches, emailDomain, REP_ROLES, FREE_MAIL } from '../../lib/claims.js';

const claimFor = (env, clubId, userId) => env.DB.prepare(
  `SELECT id, ts, status, domain_match AS domainMatch, rep_name AS repName, rep_role AS repRole
     FROM club_claims WHERE club_id = ? AND user_id = ?`
).bind(clubId, userId).first();

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const club = clubRecord(url.searchParams.get('club'));
  if (!club) return json({ ok: false, error: 'No such club.' }, 404);

  const me = await currentUser(request, env);
  const base = { ok: true, club: { id: club.id, name: club.name, domain: club.domain } };
  if (!me) return json({ ...base, signedIn: false });

  const claim = await claimFor(env, club.id, me.userId);
  return json({
    ...base,
    signedIn: true,
    email: me.email,
    emailDomain: emailDomain(me.email),
    freeMail: FREE_MAIL.has(emailDomain(me.email)),
    selfVerifies: domainMatches(me.email, club.domain),
    claim: claim || null,
  });
}

export async function onRequestPost({ request, env }) {
  if (!originOk(request)) return json({ ok: false, error: 'bad request' }, 403);

  let input;
  try { input = await request.json(); } catch { return json({ ok: false, error: 'bad request' }, 400); }
  if (input.website) return json({ ok: true, status: 'pending' });   /* honeypot */

  const me = await currentUser(request, env);
  if (!me) return json({ ok: false, error: 'Sign in first — the claim is tied to your email.' }, 401);

  const club = clubRecord(input.club);
  if (!club) return json({ ok: false, error: 'No such club.' }, 404);

  const repName = clip(input.repName, 80);
  if (!repName || repName.length < 2) return json({ ok: false, error: 'Your name is required.' }, 400);
  const repRole = String(input.repRole || '').trim().toLowerCase();
  if (!REP_ROLES.has(repRole)) return json({ ok: false, error: 'Pick your role at the club.' }, 400);
  const note = clip(input.note, 500);

  const match = domainMatches(me.email, club.domain);
  const existing = await claimFor(env, club.id, me.userId);
  const nowIso = new Date().toISOString();

  if (existing) {
    /* Re-claiming refreshes who they are but never moves status downward.
       A pending claim can still be promoted here if the account's email
       now matches (the person signed out of gmail and back in on the club
       domain is the case this serves). */
    const status = existing.status === 'rejected' ? 'rejected'
      : existing.status === 'verified' ? 'verified'
      : match ? 'verified' : 'pending';
    await env.DB.prepare(
      `UPDATE club_claims SET rep_name = ?, rep_role = ?, note = COALESCE(?, note),
              domain_match = ?, status = ?, email = ?
        WHERE id = ?`
    ).bind(repName, repRole, note, match ? 1 : 0, status, me.email, existing.id).run();
    return json({ ok: true, status, domainMatch: match });
  }

  const status = match ? 'verified' : 'pending';
  try {
    await env.DB.prepare(
      `INSERT INTO club_claims (ts, club_id, club_name, user_id, email, club_domain, domain_match,
                                status, rep_name, rep_role, note, ua)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      nowIso, club.id, club.name, me.userId, me.email, club.domain, match ? 1 : 0,
      status, repName, repRole, note, clip(request.headers.get('user-agent'), 200)
    ).run();
  } catch (e) {
    return json({ ok: false, error: 'Could not save the claim right now — please try again.' }, 500);
  }
  return json({ ok: true, status, domainMatch: match });
}
