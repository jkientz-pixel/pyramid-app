/* /api/push — store or drop a web-push subscription for match alerts.

   POST   upserts the browser's subscription plus the club slugs it follows.
          Called on enable and re-called on later visits so the club list
          tracks the visitor's follows without any per-follow chatter.
   DELETE removes the subscription by endpoint. Turning alerts off must leave
          nothing behind — same promise the rest of the site makes.

   What is deliberately NOT here: any identity. The endpoint is minted by the
   browser's push service and names a browser install, not a person. Sending
   happens elsewhere (scripts/push_alerts.py) with the VAPID private key,
   which this Function never holds. */

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const clip = (v, n) => {
  if (v == null) return null;
  const s = String(v).trim().slice(0, n);
  return s || null;
};

/* Same coarse buckets as /api/hit — the only question this answers is which
   platforms alerts actually reach. */
const platformOf = (ua = '') => {
  if (/iPhone|iPod/i.test(ua)) return 'iphone';
  if (/iPad/i.test(ua)) return 'ipad';
  if (/Android/i.test(ua)) return 'android';
  if (/Macintosh/i.test(ua)) return 'mac';
  if (/Windows/i.test(ua)) return 'windows';
  return 'other';
};

/* Push endpoints are HTTPS URLs at the browser vendor's push service. A row
   that isn't one can never be delivered to and has no business being stored. */
const okEndpoint = e =>
  typeof e === 'string' && e.length <= 1024 && /^https:\/\/[^\s]+$/.test(e);

/* APNs device tokens from the native iOS app (~/rankedxi-ios): 64 hex chars.
   Stored as the pseudo-endpoint apns://<token> so one table and one DELETE
   path cover both channels; the web-push sender skips these rows and the
   APNs sender selects only them. */
const okApns = t => typeof t === 'string' && /^[0-9a-f]{64}$/i.test(t);
const okAnyEndpoint = e => okEndpoint(e) || (typeof e === 'string' && okApns(e.replace(/^apns:\/\//, '')) && e.startsWith('apns://'));

/* base64url, as PushSubscription.toJSON() emits its keys */
const okKey = (k, max) =>
  typeof k === 'string' && k.length > 0 && k.length <= max && /^[A-Za-z0-9_-]+=*$/.test(k);

const SLUG = /^[a-z0-9-]{1,80}$/;

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false }, 400);
  }

  let endpoint, p256dh, auth, plat;
  if (body.apns !== undefined) {
    if (!okApns(body.apns)) return json({ ok: false }, 400);
    endpoint = 'apns://' + String(body.apns).toLowerCase();
    p256dh = '-'; auth = '-'; plat = 'ios-app';
  } else {
    const sub = body.sub || {};
    const keys = sub.keys || {};
    if (!okEndpoint(sub.endpoint) || !okKey(keys.p256dh, 256) || !okKey(keys.auth, 64)) {
      return json({ ok: false }, 400);
    }
    endpoint = sub.endpoint; p256dh = keys.p256dh; auth = keys.auth;
    plat = platformOf(request.headers.get('user-agent') || '');
  }

  /* The club list is capped and slug-checked, not trusted: it is the one
     free-ish field, and 50 follows is far past the 11-pick design anyway. */
  const clubs = Array.isArray(body.clubs)
    ? body.clubs.filter(c => typeof c === 'string' && SLUG.test(c)).slice(0, 50)
    : [];

  try {
    await env.DB.prepare(
      `INSERT INTO push_subs (ts, endpoint, p256dh, auth, clubs, plat)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(endpoint) DO UPDATE SET
         ts=excluded.ts, p256dh=excluded.p256dh, auth=excluded.auth,
         clubs=excluded.clubs`
    ).bind(
      new Date().toISOString(),
      endpoint,
      p256dh,
      auth,
      JSON.stringify(clubs),
      plat
    ).run();
  } catch (e) {
    return json({ ok: false }, 500);
  }

  return json({ ok: true });
}

export async function onRequestDelete({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false }, 400);
  }
  const endpoint = clip(body.endpoint, 1024);
  if (!okAnyEndpoint(endpoint)) return json({ ok: false }, 400);

  try {
    await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(endpoint).run();
  } catch (e) {
    return json({ ok: false }, 500);
  }
  return json({ ok: true });
}
