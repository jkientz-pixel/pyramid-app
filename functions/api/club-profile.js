/* /api/club-profile — the intake form behind a verified claim.

   GET  ?club=<id>        -> the newest submission this account made for the
                             club (payload only, no logo bytes) so the form
                             can prefill on a resubmit.
   POST multipart/form-data -> one club_submissions row: every field the form
                             collected as JSON, plus the crest file base64'd
                             into the same row.

   Two things this endpoint refuses to do:
   - Publish. Nothing here touches the live data. A human runs
     scripts/review_claims.py, looks at the crest, and folds the row in.
   - Trust the browser about who is allowed in. The claim row is re-read and
     must be `verified` on every POST; the UI hiding the form is a courtesy.

   The crest is required on every submission — the whole point of the form
   is to collect clean, large logos — and it is checked by magic bytes and,
   for raster files, by pixel size, because "my logo" is very often a 96px
   favicon or a screenshot with a white box around it. */

import { currentUser, originOk } from '../../lib/auth.js';
import { json, clip, clubRecord } from '../../lib/claims.js';

const LOGO_MAX_BYTES = 700 * 1024;   /* base64 +33% must stay under D1's 1 MB row */
const LOGO_MIN_PX = 512;

/* Field whitelist. Anything not named here is dropped on the floor, which is
   what makes accepting a free-form JSON body safe. Lengths are generous for
   the prose fields and tight for the identifiers. */
const TEXT = {
  website: 300, contactEmail: 254, contactPhone: 40, nickname: 60, founded: 4,
  color1: 7, color2: 7, headCoach: 80, president: 80, gm: 80, mediaContact: 254,
  venueName: 120, venueAddress: 200, venueCity: 80, venueState: 40, venueZip: 12,
  venueParking: 200, kitSupplier: 60, reserveTeams: 300, affiliation: 200,
  ticketPriceMin: 8, ticketPriceMax: 8, avgAttendance: 8, seasonStart: 20,
  instagram: 200, x: 200, facebook: 200, tiktok: 200, youtube: 200,
  ticketsUrl: 300, streamingUrl: 300, tryoutsUrl: 300, rosterUrl: 300, scheduleUrl: 300, shopUrl: 300,
  notes: 2000,
};
const URLS = new Set(['website', 'instagram', 'x', 'facebook', 'tiktok', 'youtube',
  'ticketsUrl', 'streamingUrl', 'tryoutsUrl', 'rosterUrl', 'scheduleUrl', 'shopUrl']);
const INTS = { capacity: [0, 200000], founded: [1850, 2100], avgAttendance: [0, 200000],
  ticketPriceMin: [0, 10000], ticketPriceMax: [0, 10000] };
const ENUMS = {
  surface: ['grass', 'turf', 'hybrid'],
  venueSeating: ['stadium', 'bleachers', 'standing', 'mixed', 'none'],
  venueLights: ['yes', 'no'],
  venueOwnership: ['own', 'lease', 'municipal', 'school', 'shared'],
};
const REQUIRED = ['website', 'contactEmail', 'venueName', 'venueCity', 'venueState', 'surface', 'capacity'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function readFields(form) {
  const out = {};
  const problems = [];
  for (const [k, max] of Object.entries(TEXT)) {
    const v = clip(form.get(k), max);
    if (v == null) continue;
    if (URLS.has(k) && !/^https?:\/\//i.test(v)) { problems.push(`${k}: links must start with http:// or https://`); continue; }
    out[k] = v;
  }
  for (const [k, [lo, hi]] of Object.entries(INTS)) {
    const raw = clip(form.get(k), 10);
    if (raw == null) continue;
    const n = Number(String(raw).replace(/[,\s]/g, ''));
    if (!Number.isInteger(n) || n < lo || n > hi) { problems.push(`${k}: enter a whole number between ${lo} and ${hi}`); continue; }
    out[k] = n;
  }
  for (const [k, allowed] of Object.entries(ENUMS)) {
    const v = clip(form.get(k), 20);
    if (v == null) continue;
    if (!allowed.includes(v)) { problems.push(`${k}: not a valid choice`); continue; }
    out[k] = v;
  }
  for (const k of ['color1', 'color2']) {
    if (out[k] && !/^#[0-9a-f]{6}$/i.test(out[k])) { problems.push(`${k}: use a hex colour like #1a3d8f`); delete out[k]; }
  }
  if (out.contactEmail && !EMAIL_RE.test(out.contactEmail)) problems.push('contactEmail: not a valid email');
  for (const k of REQUIRED) if (out[k] == null) problems.push(`${k}: required`);
  return { fields: out, problems };
}

/* ---- crest -------------------------------------------------------------- */

const be32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;

function sniff(bytes) {
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { mime: 'image/png', w: be32(bytes, 16), h: be32(bytes, 20) };
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    /* walk JPEG segments to the first SOF marker for dimensions */
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) { i++; continue; }
      const marker = bytes[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { mime: 'image/jpeg', h: (bytes[i + 5] << 8) | bytes[i + 6], w: (bytes[i + 7] << 8) | bytes[i + 8] };
      }
      i += 2 + ((bytes[i + 2] << 8) | bytes[i + 3]);
    }
    return { mime: 'image/jpeg', w: 0, h: 0 };
  }
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, 1024)).trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(head)) {
    return { mime: 'image/svg+xml', w: null, h: null };
  }
  return null;
}

function toBase64(bytes) {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  return btoa(s);
}

async function readLogo(file) {
  if (!file || typeof file.arrayBuffer !== 'function' || !file.size) {
    return { error: 'A crest file is required — PNG or SVG, at least 512px wide, transparent background.' };
  }
  if (file.size > LOGO_MAX_BYTES) {
    return { error: `The crest is too big (${Math.round(file.size / 1024)} KB). Keep it under ${LOGO_MAX_BYTES / 1024} KB — a 1024px PNG or an SVG is ideal.` };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniff(bytes);
  if (!kind) return { error: 'That file is not a PNG, SVG or JPEG.' };
  if (kind.w != null && (kind.w < LOGO_MIN_PX || kind.h < LOGO_MIN_PX)) {
    return { error: `The crest is ${kind.w}×${kind.h}px — we need at least ${LOGO_MIN_PX}px on each side. SVG or a larger PNG export, please.` };
  }
  if (kind.mime === 'image/svg+xml' && /<script|onload=|javascript:/i.test(new TextDecoder().decode(bytes))) {
    return { error: 'That SVG contains script — export a plain graphic SVG.' };
  }
  return { mime: kind.mime, w: kind.w, h: kind.h, bytes: file.size, name: clip(file.name, 120), b64: toBase64(bytes) };
}

/* ---- handlers ----------------------------------------------------------- */

async function verifiedClaim(env, clubId, userId) {
  return env.DB.prepare(
    'SELECT id, status FROM club_claims WHERE club_id = ? AND user_id = ?'
  ).bind(clubId, userId).first();
}

export async function onRequestGet({ request, env }) {
  const club = clubRecord(new URL(request.url).searchParams.get('club'));
  if (!club) return json({ ok: false, error: 'No such club.' }, 404);
  const me = await currentUser(request, env);
  if (!me) return json({ ok: false, error: 'Sign in first.' }, 401);
  const claim = await verifiedClaim(env, club.id, me.userId);
  if (!claim || claim.status !== 'verified') return json({ ok: false, error: 'This claim is not verified yet.' }, 403);
  const row = await env.DB.prepare(
    `SELECT ts, payload, logo_name AS logoName, logo_w AS logoW, logo_h AS logoH, applied
       FROM club_submissions WHERE club_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1`
  ).bind(club.id, me.userId).first();
  return json({ ok: true, submission: row ? { ...row, payload: JSON.parse(row.payload) } : null });
}

export async function onRequestPost({ request, env }) {
  if (!originOk(request)) return json({ ok: false, error: 'bad request' }, 403);

  const me = await currentUser(request, env);
  if (!me) return json({ ok: false, error: 'Sign in first.' }, 401);

  let form;
  try { form = await request.formData(); } catch { return json({ ok: false, error: 'bad request' }, 400); }
  if (form.get('website_hp')) return json({ ok: true });   /* honeypot */

  const club = clubRecord(form.get('club'));
  if (!club) return json({ ok: false, error: 'No such club.' }, 404);

  const claim = await verifiedClaim(env, club.id, me.userId);
  if (!claim || claim.status !== 'verified') {
    return json({ ok: false, error: 'This claim has not been verified yet, so the form is closed.' }, 403);
  }

  const { fields, problems } = readFields(form);
  const logo = await readLogo(form.get('logo'));
  if (logo.error) problems.unshift(logo.error);
  if (problems.length) return json({ ok: false, error: problems[0], problems }, 400);

  try {
    await env.DB.prepare(
      `INSERT INTO club_submissions (ts, claim_id, club_id, user_id, payload, logo_mime, logo_name,
                                     logo_bytes, logo_w, logo_h, logo_b64, ua)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      new Date().toISOString(), claim.id, club.id, me.userId, JSON.stringify(fields),
      logo.mime, logo.name, logo.bytes, logo.w, logo.h, logo.b64,
      clip(request.headers.get('user-agent'), 200)
    ).run();
  } catch (e) {
    return json({ ok: false, error: 'Could not save right now — please try again.' }, 500);
  }
  return json({ ok: true, fields: Object.keys(fields).length, logo: { mime: logo.mime, w: logo.w, h: logo.h, bytes: logo.bytes } });
}
