/* The pick payload, and the two localStorage keys it is built from.

   Extracted from js/myxi.js when accounts arrived. The codec had been private
   to the My XI screen because the only thing that ever needed it was the share
   link; now the sync engine needs the identical format to send an XI to the
   server, and two copies of an encoder that has to round-trip against itself
   is how a share link and a synced account quietly stop agreeing.

   The format is unchanged and deliberately opaque: "c:id,id|p:club~idx|g:mls".
   The server stores it as a string and never parses it (see functions/api/
   picks.js), so adding a new pick type here needs no deploy on that side.

   Two keys, two owners, and the split is load-bearing:
     · pyr-favs  — clubs and players. Written by the star buttons on club and
                   player pages, which are the source of truth for those.
     · rxi-myxi  — leagues, states, national teams and the home-tab preference.
                   These have no page of their own, so My XI owns them.
   Nothing here migrates pyr-favs' legacy index-based ids; js/app.js does that
   on read and is the only place that should. */

export const FAVS_KEY = 'pyr-favs';
export const PICKS_KEY = 'rxi-myxi';

const readJson = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch { return d; } };
const writeJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };

export const rawFavs = () => {
  const f = readJson(FAVS_KEY, { clubs: [], players: [] });
  return { clubs: Array.isArray(f.clubs) ? f.clubs : [], players: Array.isArray(f.players) ? f.players : [] };
};
export const writeFavs = f => writeJson(FAVS_KEY, { ...readJson(FAVS_KEY, {}), clubs: f.clubs, players: f.players });

export const store = () => readJson(PICKS_KEY, {});
export const extras = () => { const p = store().picks; return Array.isArray(p) ? p : []; };
export const setExtras = picks => writeJson(PICKS_KEY, { ...store(), picks });
export const setHome = on => writeJson(PICKS_KEY, { ...store(), home: !!on });
export const isHome = () => store().home === true;

/* Player ids contain "/", which would split the hash route, so they travel
   re-joined on "~". */
export function encodePicks(f, ex) {
  const parts = [];
  if (f.clubs.length) parts.push('c:' + f.clubs.join(','));
  if (f.players.length) parts.push('p:' + f.players.map(x => x.replace('/', '~')).join(','));
  const of = t => ex.filter(p => p.t === t).map(p => p.id);
  for (const [tag, t] of [['g', 'league'], ['s', 'state'], ['n', 'nt']]) {
    const v = of(t); if (v.length) parts.push(tag + ':' + v.join(','));
  }
  return parts.join('|');
}

export function decodePicks(payload) {
  const out = { clubs: [], players: [], extras: [] };
  const clean = s => String(s || '').split(',').map(x => x.trim()).filter(x => /^[A-Za-z0-9_~-]+$/.test(x)).slice(0, 60);
  for (const seg of String(payload || '').split('|')) {
    const i = seg.indexOf(':'); if (i < 0) continue;
    const tag = seg.slice(0, i), vals = clean(seg.slice(i + 1));
    if (tag === 'c') out.clubs = vals;
    else if (tag === 'p') out.players = vals.map(v => v.replace('~', '/'));
    else if (tag === 'g') out.extras.push(...vals.map(id => ({ t: 'league', id })));
    else if (tag === 's') out.extras.push(...vals.map(id => ({ t: 'state', id })));
    else if (tag === 'n') out.extras.push(...vals.map(id => ({ t: 'nt', id })));
  }
  return out;
}

/* The current browser's XI as one payload string. */
export const localPayload = () => encodePicks(rawFavs(), extras());

/* Union, never replace.

   This is the single most important behavioural rule in the sync engine. A
   visitor who signs in on a second device has picks in both places, and the
   only outcome they will not forgive is arriving to find the phone's XI wiped
   by the desktop's. Merging can at worst resurrect something they removed --
   visible, and one tap to undo. Replacing loses work silently.

   It is also the same promise the share-link import already makes on screen:
   "nothing you already follow is removed". */
export function mergePayloads(a, b) {
  const A = decodePicks(a), B = decodePicks(b);
  const uniq = xs => [...new Set(xs)];
  const exKey = p => p.t + ':' + p.id;
  const seen = new Set();
  const ex = [...A.extras, ...B.extras].filter(p => {
    const k = exKey(p);
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
  return encodePicks(
    { clubs: uniq([...A.clubs, ...B.clubs]), players: uniq([...A.players, ...B.players]) },
    ex
  );
}

/* Write a payload into the two local keys, replacing what is there. Callers
   that mean "add to what I have" merge first -- this is the low-level write. */
export function applyPayload(payload) {
  const d = decodePicks(payload);
  writeFavs({ clubs: d.clubs, players: d.players });
  setExtras(d.extras);
}
