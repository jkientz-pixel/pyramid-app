/* POST /api/hit — record one pageview in our own D1.

   There is no third-party analytics tag on this site and there isn't going to
   be one, so the counting happens here. The endpoint is deliberately dumb: it
   takes a path, a referrer host, and two random ids the browser minted for
   itself, and it writes a row. No IP, no full user-agent, no cookies.

   Platform is derived server-side rather than trusted from the body because
   it is the one field a decision actually rides on — whether enough iPhone
   traffic exists to justify building for iOS. */

const NO_CONTENT = () => new Response(null, { status: 204 });

const clip = (v, n) => {
  if (v == null) return null;
  const s = String(v).trim().slice(0, n);
  return s || null;
};

/* No word boundary before "bot": the substring is what matters, because the
   name that shows up in the wild is "Googlebot", not "bot". An anchored \bbot\b
   matched none of the real crawlers and they were being counted as visitors.
   Unfurlers (Slack, Discord, WhatsApp) belong here too — a link preview is not
   somebody reading the page. An empty user-agent is treated the same way; no
   real browser omits it. */
const BOT = new RegExp([
  'bot', 'crawl', 'spider', 'slurp', 'headless', 'lighthouse', 'pingdom',
  'uptime', 'monitor', 'scrapy', 'facebookexternalhit', 'embedly', 'preview',
  'curl/', 'wget', 'python-requests', 'okhttp', 'go-http-client', 'java/',
  'axios', 'whatsapp', 'telegram', 'discord', 'slack', 'yandex', 'duckduck',
  'applebot', 'petalbot', 'semrush', 'ahrefs', 'mj12',
].join('|').replace(/\//g, '\\/'), 'i');

/* Coarse buckets only. Nothing here narrows to a device, and the long tail of
   oddities collapses into 'other' rather than sprouting categories. */
const platformOf = (ua = '') => {
  if (!ua || BOT.test(ua)) return 'bot';
  if (/iPhone|iPod/i.test(ua)) return 'iphone';
  if (/iPad/i.test(ua)) return 'ipad';
  if (/Android/i.test(ua)) return 'android';
  if (/Macintosh/i.test(ua)) return 'mac';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Linux|CrOS/i.test(ua)) return 'linux';
  return 'other';
};

/* Referrers are reduced to a bare host. The full URL is where the privacy
   problems live (search terms, private group permalinks) and it answers no
   question we are asking. Our own host becomes null so internal navigation
   doesn't drown out real sources. */
const refHost = (raw, selfHost) => {
  const v = clip(raw, 300);
  if (!v) return null;
  let host;
  try {
    host = new URL(v).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
  if (!host || host === selfHost.replace(/^www\./, '')) return null;
  return host.slice(0, 80);
};

/* Accepts "/club/atlanta-united" and SPA routes like "#/wire". Anything with a
   query string is truncated at the '?' — tracking parameters are noise here and
   some of them carry campaign identifiers we have no reason to keep. */
const cleanPath = raw => {
  const v = clip(raw, 200);
  if (!v) return null;
  const p = v.split('?')[0].split('&')[0];
  if (!/^[/#][\w\-/#.]*$/.test(p)) return null;
  return p;
};

const ID_RE = /^[a-z0-9]{8,32}$/;

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NO_CONTENT();
  }

  const ua = request.headers.get('user-agent') || '';
  const plat = platformOf(ua);
  /* Crawlers are counted nowhere. They inflate every number that matters and
     Search Console is the right place to look at them anyway. */
  if (plat === 'bot') return NO_CONTENT();

  const path = cleanPath(body.p);
  const vid = clip(body.v, 32);
  const sid = clip(body.s, 32);
  if (!path || !vid || !sid || !ID_RE.test(vid) || !ID_RE.test(sid)) return NO_CONTENT();

  const now = new Date();

  try {
    await env.DB.prepare(
      `INSERT INTO hits (ts, d, path, ref, vid, sid, plat, ctry, fresh)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).bind(
      now.toISOString(),
      now.toISOString().slice(0, 10),
      path,
      refHost(body.r, new URL(request.url).hostname),
      vid,
      sid,
      plat,
      clip(request.headers.get('cf-ipcountry'), 2),
      body.n === true ? 1 : 0
    ).run();
  } catch {
    /* A dropped pageview is not worth surfacing to the visitor, and retrying
       would only double-count. Swallow it. */
  }

  return NO_CONTENT();
}
