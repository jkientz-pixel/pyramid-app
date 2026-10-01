/* POST /api/friction — record one moment where a page got in someone's way.

   Companion to /api/hit, and held to the same rules: our own D1, no IP, no
   full user-agent, no cookies. See migrations/0010_friction.sql for what each
   kind means and what is deliberately left out.

   Everything the browser sends is re-validated here. The client is ours, but
   the endpoint is public, so the shapes below are the only ones that can ever
   reach the table. */

import { platformOf, cleanPath, ID_RE } from './hit.js';

const NO_CONTENT = () => new Response(null, { status: 204 });

/* A real event is well under 1 KB. Anything bigger is not ours. */
const MAX_BODY = 2048;

const KINDS = new Set(['rage', 'dead', 'err']);

/* Selectors come from our own markup — tag, #id, .class — so anything outside
   that alphabet is either a bug or someone writing to the table by hand. */
const TGT_RE = /^[a-z0-9]+([#.][\w-]+)*( > [a-z0-9]+([#.][\w-]+)*)*$/i;
const tgtOf = raw => {
  if (raw == null) return null;
  const s = String(raw).slice(0, 120);
  return TGT_RE.test(s) ? s : null;
};

/* Error messages are the one free-text field, so they are scrubbed before
   storage: anything e-mail-shaped and every query string goes, and the result
   is clipped. A message is about our code, never about the visitor. */
export const scrubDetail = raw => {
  if (raw == null) return null;
  const s = String(raw)
    .replace(/[^\x20-\x7e]/g, ' ')
    .replace(/\S+@\S+/g, '[email]')
    .replace(/\?\S*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
  return s || null;
};

export async function onRequestPost({ request, env }) {
  const raw = await request.text().catch(() => '');
  if (!raw || raw.length > MAX_BODY) return NO_CONTENT();

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return NO_CONTENT();
  }

  const plat = platformOf(request.headers.get('user-agent') || '');
  if (plat === 'bot') return NO_CONTENT();

  const kind = KINDS.has(body.k) ? body.k : null;
  const path = cleanPath(body.p);
  const vid = typeof body.v === 'string' ? body.v : '';
  const sid = typeof body.s === 'string' ? body.s : '';
  if (!kind || !path || !ID_RE.test(vid) || !ID_RE.test(sid)) return NO_CONTENT();

  const now = new Date();
  try {
    await env.DB.prepare(
      `INSERT INTO friction (ts, d, path, kind, tgt, detail, vid, sid, plat)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).bind(
      now.toISOString(),
      now.toISOString().slice(0, 10),
      path,
      kind,
      tgtOf(body.t),
      kind === 'err' ? scrubDetail(body.x) : null,
      vid,
      sid,
      plat
    ).run();
  } catch {
    /* Same reasoning as /api/hit: a dropped event is not worth surfacing,
       and a retry would double-count. */
  }

  return NO_CONTENT();
}
