/* POST /api/auth/request — send a six-digit sign-in code to an email address.

   Deliberately gives the same answer for every valid address, whether or not
   an account exists. The account is created at verify time, not here, so there
   is no branch to observe and this endpoint cannot be used to ask "is this
   person a Ranked XI user". That question has a real answer for a site that
   lists youth clubs and it is nobody's business.

   Throttling is per-address: one code a minute, five inside a code's ten-minute
   life. That bounds the harm that matters -- using this form to bury one
   person's inbox. It does not bound an attacker walking a list of addresses to
   send one message each; the provider's own monthly ceiling is what caps that,
   and the message contains nothing but a code. */

import {
  json, sha256, sixDigitCode, normalizeEmail, sendMail, originOk,
  CODE_TTL, RESEND_COOLDOWN, RESEND_MAX_PER_WINDOW,
} from '../../../lib/auth.js';

const body = (code) => ({
  subject: `${code} is your Ranked XI sign-in code`,
  text: `Your Ranked XI sign-in code is ${code}\n\n`
      + `Enter it on the sign-in screen to save your XI. The code expires in 10 minutes.\n\n`
      + `If you didn't ask for this, you can ignore this email — nothing has changed on your account.\n`,
  html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:16px;color:#111">
      <p style="margin:0 0 18px">Your Ranked XI sign-in code is</p>
      <p style="margin:0 0 18px;font-size:34px;font-weight:700;letter-spacing:6px">${code}</p>
      <p style="margin:0 0 18px">Enter it on the sign-in screen to save your XI. The code expires in 10&nbsp;minutes.</p>
      <p style="margin:0;color:#666;font-size:14px">If you didn't ask for this, you can ignore this email — nothing has changed on your account.</p>
    </div>`,
});

export async function onRequestPost({ request, env }) {
  if (!originOk(request)) return json({ ok: false, error: 'bad request' }, 403);

  let input;
  try { input = await request.json(); } catch { return json({ ok: false, error: 'bad request' }, 400); }

  /* honeypot, same shape as /api/follow and /api/signup */
  if (input.website) return json({ ok: true });

  const email = normalizeEmail(input.email);
  if (!email) return json({ ok: false, error: 'A real email address is required.' }, 400);

  /* COPPA attaches at collection, and an account collects more than the follow
     form does, so the gate is enforced here rather than trusted to the markup. */
  if (input.age13 !== true) {
    return json({ ok: false, error: 'You need to be 13 or older to save your XI.' }, 400);
  }

  const nowMs = Date.now();
  const existing = await env.DB.prepare(
    'SELECT sent, sent_count AS sentCount, expires FROM login_codes WHERE email = ?'
  ).bind(email).first();

  if (existing) {
    const live = Date.parse(existing.expires) > nowMs;
    if (live && nowMs - Date.parse(existing.sent) < RESEND_COOLDOWN) {
      return json({ ok: false, error: 'A code is already on its way — give it a minute.' }, 429);
    }
    if (live && existing.sentCount >= RESEND_MAX_PER_WINDOW) {
      return json({ ok: false, error: 'Too many codes requested. Try again in a few minutes.' }, 429);
    }
  }

  const code = sixDigitCode();
  const hash = await sha256(code);
  const sentIso = new Date(nowMs).toISOString();
  const expiresIso = new Date(nowMs + CODE_TTL).toISOString();
  /* a fresh code always resets tries; a resend inside the same window keeps
     counting sends so the ceiling above cannot be reset by asking again */
  const keepCount = existing && Date.parse(existing.expires) > nowMs;

  await env.DB.prepare(
    `INSERT INTO login_codes (email, hash, expires, tries, sent, sent_count)
     VALUES (?,?,?,0,?,?)
     ON CONFLICT(email) DO UPDATE SET
       hash=excluded.hash, expires=excluded.expires, tries=0, sent=excluded.sent,
       sent_count=${keepCount ? 'login_codes.sent_count + 1' : '1'}`
  ).bind(email, hash, expiresIso, sentIso, 1).run();

  try {
    await sendMail(env, { to: email, ...body(code) });
  } catch (e) {
    /* The row is already written, but reporting success for a mail that never
       left would strand the visitor on a code-entry screen forever. Clear it
       and say so. */
    await env.DB.prepare('DELETE FROM login_codes WHERE email = ?').bind(email).run();
    const unconfigured = String(e && e.message) === 'mail not configured';
    return json({
      ok: false,
      error: unconfigured
        ? 'Sign-in by email is not switched on yet. Your picks are still saved in this browser.'
        : 'Could not send the code right now — please try again.',
    }, 503);
  }

  return json({ ok: true });
}
