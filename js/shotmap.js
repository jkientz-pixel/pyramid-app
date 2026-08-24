/* Shot Maps screen — lazily imported by app.js on #/shots.
   The drawing lives in postmatch.js now, shared with the post-match panel
   under every result, so the standalone screen and the inline panel are the
   same map with the same toggles. This file is the league/match picker plus
   the deep link: #/shots/<league>/<game_id>?off=away,blocked&size=psxg opens
   one match with a filter state, which is what "share this view" produces. */
import { shotPanel, pairTeams, esc, decodeFilters, encodeFilters, ASA_SLUG } from './postmatch.js?v=__RXIV__';

const LEAGUES = [['mls', 'MLS'], ['nwsl', 'NWSL'], ['uslc', 'USL Championship'], ['usl1', 'USL League One'],
  ['mlsnp', 'MLS Next Pro'], ['usls', 'USL Super League']];
const SLUGS = new Set(LEAGUES.map(l => l[0]));
const ID_RE = /^[A-Za-z0-9]{1,24}$/;

/* parts = hash segments after "shots": [league, game_id?query] */
function parseDeepLink(parts) {
  const [lgRaw, rest] = parts || [];
  const lg = ASA_SLUG[lgRaw] || lgRaw;
  if (!SLUGS.has(lg)) return null;
  const [gid, q] = String(rest || '').split('?');
  return { lg, gid: ID_RE.test(gid || '') ? gid : null, filters: decodeFilters(q) };
}

export function render(view, parts) {
  const $ = id => view.querySelector('#sh-' + id);
  let SHOTS = [], GAMES = [];
  const deep = parseDeepLink(parts);
  let filters = deep?.filters || { off: new Set(), size: 'xg' };
  let wantGid = deep?.gid || null;

  view.innerHTML = `
    <button class="backbtn" onclick="location.hash='#/tools'">&larr; Tools</button>
    <div class="kicker">Six pro leagues &middot; real shot data</div>
    <h2 class="disp">Where the chances actually came from</h2>
    <p class="note">Every shot in the match, placed where it was struck and sized by
      <b>expected goals</b> &mdash; the chance an average finisher scores from that spot.
      Filled circles are goals. Switch sets of shots off to isolate what you want to see.
      <b>Pro leagues only:</b> these are real logged shot locations, so the amateur and youth
      pyramid isn't here &mdash; we don't have shot data for those, and we'd rather show nothing
      than draw something we guessed.</p>

    <div class="sh-ctrls">
      <label class="cch-f"><span>League</span><select id="sh-lg">
        ${LEAGUES.map(([v, l]) => `<option value="${v}"${deep && deep.lg === v ? ' selected' : ''}>${l}</option>`).join('')}
      </select></label>
      <label class="cch-f cch-wide"><span>Match</span><select id="sh-gm"><option>Loading&hellip;</option></select></label>
    </div>

    <div class="sh-score" id="sh-score"></div>
    <div id="sh-panel"><div class="sh-pitchwrap"><svg class="sh-pitch" id="sh-pitch" viewBox="0 0 1150 750" role="img"
      aria-label="Shot map"></svg></div><div class="sh-legend" id="sh-legend"></div>
      <div class="sh-tablewrap" id="sh-totals"></div><div class="sh-tablewrap" id="sh-table"></div></div>`;

  const stillHere = () => location.hash.startsWith('#/shots');
  const empty = () => { const p = view.querySelector('#sh-panel'); if (p) p.innerHTML = ''; };

  /* keep the address bar in step with the picked match + filters so the URL
     is always the shareable form of what is on screen */
  function syncHash(g) {
    const q = encodeFilters(filters);
    const h = `#/shots/${$('lg').value}/${g.id}${q ? '?' + q : ''}`;
    if (location.hash !== h) history.replaceState(null, '', h);
  }

  async function loadGames() {
    const lg = $('lg').value;
    $('gm').innerHTML = '<option>Loading…</option>';
    SHOTS = []; empty();
    $('score').innerHTML = '<span class="cch-dim">Loading matches…</span>';
    try {
      const r = await fetch(`/api/shots?league=${lg}&season=2026`);
      if (!r.ok) throw new Error();
      const d = await r.json();
      if (!stillHere()) return;
      if (!d.games.length) {
        $('gm').innerHTML = '<option>No completed matches yet</option>';
        $('score').innerHTML = '<span class="cch-dim">No completed matches in this league yet.</span>';
        return;
      }
      $('gm').innerHTML = d.games.map(g =>
        `<option value="${esc(g.id)}">${esc(g.date.slice(0, 10))} — ${esc(g.home)} ${g.hs}–${g.as} ${esc(g.away)}</option>`
      ).join('');
      GAMES = d.games;
      if (wantGid && GAMES.some(g => g.id === wantGid)) $('gm').value = wantGid;
      wantGid = null;
      loadShots();
    } catch (e) {
      if (!stillHere()) return;
      $('gm').innerHTML = '<option>Unavailable</option>';
      $('score').innerHTML = '<span class="cch-dim">Match data is unavailable right now.</span>';
    }
  }

  async function loadShots() {
    const id = $('gm').value, lg = $('lg').value;
    const g = GAMES.find(x => x.id === id);
    if (!g) return;
    $('score').innerHTML = '<span class="cch-dim">Loading shots…</span>';
    try {
      const r = await fetch(`/api/shots?league=${lg}&game_id=${encodeURIComponent(id)}`);
      if (!r.ok) throw new Error();
      const d = await r.json();
      if (!stillHere()) return;
      SHOTS = d.shots;
      const { home, away } = pairTeams(SHOTS, g.home, g.away);
      $('score').innerHTML =
          `<span class="sh-side"><span class="sh-swatch sh-home"></span>${esc(g.home)}</span>`
        + `<span class="sh-nums">${g.hs}–${g.as}</span>`
        + `<span class="sh-side"><span class="sh-swatch sh-away"></span>${esc(g.away)}</span>`
        + `<span class="cch-dim">${esc(g.date.slice(0, 10))} · ${SHOTS.length} shots</span>`;
      shotPanel(view.querySelector('#sh-panel'), {
        shots: SHOTS, home, away, ids: 'sh', filters,
        onFilter: f => { filters = f; syncHash(g); },
      });
      syncHash(g);
    } catch (e) {
      if (!stillHere()) return;
      $('score').innerHTML = '<span class="cch-dim">Shot data is unavailable for this match.</span>';
      SHOTS = []; empty();
    }
  }

  $('lg').addEventListener('change', () => { filters = { off: new Set(), size: 'xg' }; loadGames(); });
  $('gm').addEventListener('change', loadShots);
  loadGames();
}
