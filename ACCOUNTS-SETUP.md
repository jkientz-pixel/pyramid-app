# My XI accounts — setup runbook

Everything in this branch is written and tested, but the feature stays dark
until four things exist that only you can create: a database schema, an email
sender, two secrets, and a deploy. Until then the code is inert and harmless —
`/api/auth/session` answers "not signed in", the panel shows the signed-out
pitch, and a visitor who tries to sign in is told sign-in isn't switched on yet.
My XI keeps working on localStorage exactly as it does today.

## Just run the wizard

```sh
./scripts/setup-accounts.sh
```

It walks all of it — opens each page, tells you exactly what to click, captures
the values, sets the Cloudflare secrets, and deploys at the end. It confirms
before anything irreversible, remembers values if you stop and re-run, and
prints whatever you skipped with the exact command to finish it later.

The rest of this document is the same procedure by hand, and the reference for
when something goes wrong.

---

Run steps 1–4 in order. Total time is about fifteen minutes, most of it waiting
on DNS.

---

## 1. Create the tables

The accounts tables go in the existing `rankxi-signups` D1 database alongside
`follows` and `hits` — no new database.

```sh
cd ~/pyramid-app
npx -y wrangler@4.114.0 d1 execute rankxi-signups --remote \
  --file=migrations/0003_accounts.sql
```

Verify:

```sh
npx -y wrangler@4.114.0 d1 execute rankxi-signups --remote \
  --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```

You should see `follows`, `hits`, `login_codes`, `sessions`, `user_picks`,
`users`.

## 2. Set up the email sender

Sign-in codes go out over HTTPS because Cloudflare Workers cannot open an SMTP
socket. This is written against [Resend](https://resend.com) — free below 3,000
emails a month, which is far more sign-ins than the site will see this year.

1. Create a Resend account and add **rankedxi.com** as a domain.
2. Resend gives you three DNS records (a DKIM `TXT`, an SPF-ish `MX`/`TXT` for
   the sending subdomain, and usually a DMARC `TXT`). Add them in **Cloudflare**
   — DNS moved there on 2026-08-20, so GoDaddy is no longer the place.
   - Add them exactly as given, and set each to **DNS only** (grey cloud), not
     proxied. A proxied record breaks verification.
   - Resend will use a subdomain like `send.rankedxi.com`. That does **not**
     touch the M365 records that deliver `jeremy@rankedxi.com` — leave those
     alone.
3. Wait for Resend to show the domain **Verified** (usually minutes).
4. Create an API key with **Sending access** only.

> Swapping providers later is a single function: `sendMail` in `lib/auth.js`.
> Nothing else in the codebase knows Resend exists.

## 3. Add the two secrets

```sh
cd ~/pyramid-app
npx -y wrangler@4.114.0 pages secret put RESEND_API_KEY --project-name rank-xi
# paste the key when prompted

npx -y wrangler@4.114.0 pages secret put MAIL_FROM --project-name rank-xi
# paste, including the display name:
# Ranked XI <no-reply@send.rankedxi.com>
```

`MAIL_FROM` must be an address on the domain you verified in step 2, or Resend
rejects the send. If you skip `MAIL_FROM` the code falls back to
`Ranked XI <no-reply@rankedxi.com>`, which only works if you verified the apex
rather than a subdomain.

Confirm both are set:

```sh
npx -y wrangler@4.114.0 pages secret list --project-name rank-xi
```

## 4. Deploy

```sh
cd ~/pyramid-app
./deploy.sh
```

`deploy.sh` runs `bump_version.py`, which now also stamps `js/myxi.js` and
`js/account.js`. Do not hand-edit those tokens.

---

## Checking it works

1. Open the site, go to **My XI**, follow a club.
2. The panel says *"Right now your XI only exists in this browser."* Tap
   **Save my XI**, enter your address, tick 13+, submit.
3. The code should land within a few seconds. Enter it. The panel flips to
   *"Saved to you@…"*.
4. Open the site on your phone, sign in with the same address, and the club
   should appear there.

Then confirm the merge did not eat anything — the whole point:

```sh
npx -y wrangler@4.114.0 d1 execute rankxi-signups --remote \
  --command="SELECT u.email, p.payload, p.rev, p.updated
             FROM users u LEFT JOIN user_picks p ON p.user_id = u.id"
```

`payload` is the same opaque format the share link uses
(`c:club,club|p:club~idx|g:league|s:state|n:team`).

## If a code never arrives

- **"Sign-in by email is not switched on yet"** — `RESEND_API_KEY` is missing.
  Step 3.
- **"Could not send the code right now"** — the key is set but Resend rejected
  the send. Almost always `MAIL_FROM` on an unverified domain. Check the Resend
  dashboard's log; it shows the rejection reason.
- **Nothing at all, no error** — check spam, then Resend's log. If the send
  succeeded and the mail vanished, the DNS records in step 2 are incomplete.

## Housekeeping worth doing later

None of this blocks launch.

- **Expired rows.** `login_codes` self-cleans (a code is deleted when used,
  expired, or exhausted) and `sessions` deletes expired rows when they are next
  presented. A session that is never used again sits there until its year is up.
  Harmless at this scale; a monthly `DELETE FROM sessions WHERE expires < ...`
  is the fix if the table ever gets big.
- **Rate limiting is per-address**, not per-IP: one code a minute and five per
  ten-minute window for any given email. That stops someone burying one person's
  inbox. It does not stop someone walking a list of addresses to send one
  message each — Resend's own monthly ceiling is what caps that today. If the
  site gets big enough to be worth abusing, add an IP throttle in
  `functions/api/auth/request.js`.
- **Account deletion is by email** (`hello@rankedxi.com`), as the privacy page
  says. A self-serve delete button is the obvious next thing to build; the
  endpoint for the picks half already exists (`DELETE /api/picks`).

## Local development

`scripts/dev_server.py` stubs `/api/auth/session` as "not signed in" so the
static test server does not 404 on every page load. It cannot run the real
endpoints. To exercise sign-in locally you need the actual functions:

```sh
npx -y wrangler@4.114.0 pages dev . --d1 DB=rankxi-signups
```

and a `.dev.vars` file (gitignored) holding `RESEND_API_KEY` and `MAIL_FROM`.
