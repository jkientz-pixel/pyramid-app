/* Account deletion statements, shared by functions/api/auth/account.js and
   its test. Lives in lib/ for the same reason as lib/auth.js: not routable,
   not shipped as a static asset. Order matters only for readability -- the
   caller runs these as one D1 batch (one transaction). */

export const CONFIRM_WORD = 'delete';

export function deleteStatements(db, { userId, email }) {
  const byId = sql => db.prepare(sql).bind(userId);
  const byEmail = sql => db.prepare(sql).bind(email);
  return [
    byId('DELETE FROM club_submissions WHERE user_id = ?'),
    byId('DELETE FROM club_claims WHERE user_id = ?'),
    byId('DELETE FROM user_picks WHERE user_id = ?'),
    byId('DELETE FROM sessions WHERE user_id = ?'),
    byEmail('DELETE FROM login_codes WHERE email = ?'),
    byEmail('DELETE FROM follows WHERE email = ?'),
    byEmail('DELETE FROM interest WHERE email = ?'),
    byId('DELETE FROM users WHERE id = ?'),
  ];
}
