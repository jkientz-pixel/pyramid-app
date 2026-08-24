/* Shared primitives for the club-claim endpoints (/api/claim, /api/club-profile).

   Lives in lib/ for the same reason lib/auth.js does: reachable by the
   functions bundle, never shipped as a static asset (see that file's header).

   The one decision that matters here is `domainMatches`: does the signed-in
   email belong to the club's own website domain. That is the whole basis for
   verifying a claim without a human, so it is deliberately strict —
   exact host or a subdomain of it, never a substring, never a lookalike — and
   free-mail providers can never satisfy it even if a club's listed website
   were somehow one of them. */

import CLUB_DOMAINS from './club_domains.json';

export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });

export const clip = (v, n) => {
  if (v == null) return null;
  const s = String(v).trim().slice(0, n);
  return s || null;
};

export const CLAIM_STATUS = new Set(['pending', 'verified', 'rejected']);
export const REP_ROLES = new Set(['owner', 'president', 'gm', 'coach', 'media', 'staff', 'other']);

/* Addresses anyone can register. A club whose only website is a Facebook
   page will legitimately claim from one of these; that claim is simply not
   self-verifying and goes to the human queue. */
export const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'hotmail.com', 'outlook.com', 'live.com',
  'msn.com', 'aol.com', 'icloud.com', 'me.com', 'mac.com', 'protonmail.com', 'proton.me', 'pm.me',
  'zoho.com', 'gmx.com', 'gmx.net', 'mail.com', 'yandex.com', 'fastmail.com', 'hey.com', 'comcast.net',
  'att.net', 'sbcglobal.net', 'verizon.net', 'cox.net', 'charter.net', 'earthlink.net',
]);

/* Web hosts a club record can carry that identify a platform, not the club.
   Matching an @facebook.com address against a club whose "website" is its
   Facebook page would be wrong in both directions. */
const PLATFORM_HOSTS = new Set([
  'facebook.com', 'instagram.com', 'x.com', 'twitter.com', 'tiktok.com', 'youtube.com', 'linktr.ee',
  'sites.google.com', 'wixsite.com', 'weebly.com', 'squarespace.com', 'godaddysites.com',
  'leagueapps.com', 'teamsnap.com', 'gotsport.com', 'sportsengine.com', 'playmetrics.com',
]);

export function clubRecord(id) {
  const rec = CLUB_DOMAINS[String(id || '')];
  return rec ? { id: String(id), name: rec.n, domain: rec.d || null } : null;
}

export const emailDomain = email => {
  const at = String(email || '').lastIndexOf('@');
  return at < 0 ? null : String(email).slice(at + 1).toLowerCase();
};

const isPlatform = host => [...PLATFORM_HOSTS].some(p => host === p || host.endsWith('.' + p));

/* True when `email` is on the club's own domain: identical host, or a
   subdomain of it (staff.club.org vs club.org). Never the reverse — an email
   on club.org must not verify a club whose site is a.club.org, because that
   is the shape shared-hosting and league-hosted sites take. */
export function domainMatches(email, clubDomain) {
  const ed = emailDomain(email);
  const cd = String(clubDomain || '').toLowerCase().replace(/^www\./, '');
  if (!ed || !cd) return false;
  if (FREE_MAIL.has(ed) || isPlatform(cd)) return false;
  return ed === cd || ed.endsWith('.' + cd);
}
