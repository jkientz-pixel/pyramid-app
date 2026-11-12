/* DELETE /api/auth/account — permanently delete the signed-in account.

   Why this exists: App Store Review Guideline 5.1.1(v) requires any app that
   lets people create an account to let them delete it from inside the app,
   and "email us" does not count. It is also simply the promise privacy.html
   makes. The button lives in the My XI account panel (js/account.js), which
   renders the same on the web and in the iOS shell.

   What "delete" means here: every row that names this person, by user id or
   by email, goes in ONE D1 batch. A batch is a single transaction, so a
   failure part-way leaves the account intact rather than half-erased with a
   working session pointing at a missing user.

     users, sessions, user_picks        the account itself
     login_codes                        a sign-in that may be in flight
     follows, interest                  email captured by the club follow and
                                        interest forms under the same address
     club_claims, club_submissions      "I speak for club X" + what they sent.
                                        Submissions already applied by
                                        review_claims.py live on in the site
                                        data as club facts, not as this row.

   NOT touched: push_subs. A push endpoint names an app install, not a
   person (migrations/0007), and the client drops its own subscription when
   the visitor turns alerts off. Analytics rows (hits, friction) carry no
   identity at all.

   The request must carry {"confirm":"delete"}: a stray DELETE (a prefetcher,
   a replayed request in a dev tool) must not be able to erase an account. */

import { json, currentUser, clearCookieHeader, originOk } from '../../../lib/auth.js';
import { CONFIRM_WORD, deleteStatements } from '../../../lib/account.js';


export async function onRequestDelete({ request, env }) {
  if (!originOk(request)) return json({ ok: false, error: 'bad request' }, 403);

  const me = await currentUser(request, env);
  if (!me) return json({ ok: false, error: 'You are not signed in.' }, 401);

  let input;
  try { input = await request.json(); } catch { input = {}; }
  if (!input || input.confirm !== CONFIRM_WORD) {
    return json({ ok: false, error: 'Deleting your account needs confirming.' }, 400);
  }

  try {
    await env.DB.batch(deleteStatements(env.DB, me));
  } catch (e) {
    console.error('account delete failed', me.userId, e && e.message);
    return json({ ok: false, error: 'Could not delete your account right now — nothing was removed. Please try again.' }, 500);
  }

  return json({ ok: true, deleted: true, signedIn: false }, 200, { 'set-cookie': clearCookieHeader() });
}
