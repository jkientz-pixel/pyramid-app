/* College Results (#/college) — lazily imported by app.js.

   data/espn_college_2025.json has held 1,929 NCAA Division I men's results and
   3,347 women's since it was scraped, read by nothing but a backtest script.
   The app's college layers were rating snapshots with no matches behind them;
   this is the season those ratings came out of.

   Club links come from data/espn_club_map.json, built once by
   scripts/map_espn_college.py. ESPN's short names and the app's institutional
   ones share no key, so that join is inferred — and it refuses anything
   ambiguous, which is why a chunk of teams here are plain text. That is the
   intended outcome, not a gap to paper over: a wrong link would put another
   school's season on a club page. */

const FEEDS = {
  ncaa1:  { label: "Men's Division I",   sex: 'm' },
  ncaa1w: { label: "Women's Division I", sex: 'w' },
};

export function render(view, data, map, helpers, initialTeam) {
  const { esc } = helpers;
  let feed = initialTeam && (data.ncaa1w || []).some(r => r.t1 === initialTeam || r.t2 === initialTeam)
    && !(data.ncaa1 || []).some(r => r.t1 === initialTeam || r.t2 === initialTeam) ? 'ncaa1w' : 'ncaa1';

  /* index once per feed: every team's matches, newest first */
  const cache = {};
  const indexOf = f => cache[f] ??= (() => {
    const by = new Map();
    for (const r of data[f] || []) {
      for (const side of [0, 1]) {
        const me = side ? r.t2 : r.t1, them = side ? r.t1 : r.t2;
        const gf = side ? r.s2 : r.s1, ga = side ? r.s1 : r.s2;
        if (!by.has(me)) by.set(me, []);
        by.get(me).push({ d: r.d, them, gf, ga, home: side === 0 });
      }
    }
    for (const list of by.values()) list.sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0));
    return by;
  })();

  const linkTeam = (f, name) => {
    const id = (map[f] || {})[name];
    return id ? `<a href="#/club/${id}">${esc(name)}</a>` : esc(name);
  };

  let team = null;

  function record(list) {
    let w = 0, d = 0, l = 0, gf = 0, ga = 0;
    for (const m of list) {
      gf += m.gf; ga += m.ga;
      if (m.gf > m.ga) w++; else if (m.gf < m.ga) l++; else d++;
    }
    return { w, d, l, gf, ga, n: list.length };
  }

  function paint() {
    const idx = indexOf(feed);
    const teams = [...idx.keys()].sort((a, b) => a.localeCompare(b));
    /* Alphabetical first is a D3 side with one fixture — ESPN's D1 feed carries
       non-D1 opponents. Open on a team that actually played the season. */
    if (!team || !idx.has(team)) {
      team = [...idx.entries()].sort((a, b) => b[1].length - a[1].length ||
        a[0].localeCompare(b[0]))[0][0];
    }
    const list = idx.get(team) || [];
    const r = record(list);
    const mapped = Object.values(map[feed] || {}).filter(Boolean).length;

    view.querySelector('#col-body').innerHTML = `
      <div class="statgrid">
        <div class="stat"><b>${r.w}&ndash;${r.d}&ndash;${r.l}</b><span>Win / draw / loss</span></div>
        <div class="stat"><b>${r.gf}&ndash;${r.ga}</b><span>Goals for / against</span></div>
        <div class="stat"><b>${r.n}</b><span>Matches on record</span></div>
      </div>
      <ul class="col-list">${list.map(m => {
        const res = m.gf > m.ga ? 'w' : m.gf < m.ga ? 'l' : 'd';
        return `<li class="col-row">
          <span class="col-res col-${res}">${res.toUpperCase()}</span>
          <span class="col-body">
            <span class="col-line">${m.home ? '' : '<span class="col-at">at</span> '}${linkTeam(feed, m.them)}</span>
            <span class="col-meta">${esc(m.d)}${m.home ? ' &middot; home' : ''}</span>
          </span>
          <span class="col-score">${m.gf}&ndash;${m.ga}</span>
        </li>`;
      }).join('')}</ul>
      <p class="note">${mapped} of the ${Object.keys(map[feed] || {}).length} teams in this feed
        resolve to a club page; the rest are shown as plain text because their name did not land on
        exactly one club. Results are the 2025 season via ESPN. A team's record here counts only
        matches in this feed &mdash; ESPN's Division I schedule includes some Division II, III and
        NAIA opponents, but not those opponents' own seasons.</p>`;

    const sel = view.querySelector('#col-team');
    if (sel.dataset.loaded !== feed) {
      sel.innerHTML = teams.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
      sel.dataset.loaded = feed;
    }
    sel.value = team;
    view.querySelectorAll('.chips [data-feed]').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.feed === feed)));
  }

  view.innerHTML = `
    <div class="kicker">NCAA Division I &middot; 2025 season</div>
    <h2 class="disp">College Results</h2>
    <p class="note">The college layers rank by independent Massey ratings. These are the matches
      those ratings came out of &mdash; ${(data.ncaa1 || []).length.toLocaleString()} men's and
      ${(data.ncaa1w || []).length.toLocaleString()} women's results.</p>
    <div class="chips">
      ${Object.entries(FEEDS).map(([k, v]) =>
        `<button class="chip solid" data-feed="${k}" aria-pressed="false">${v.label}</button>`).join('')}
    </div>
    <div class="cch-pickers">
      <label class="cch-f cch-wide"><span>Team</span><select id="col-team"></select></label>
    </div>
    <div id="col-body"></div>`;

  view.querySelector('.chips').addEventListener('click', e => {
    const b = e.target.closest('[data-feed]'); if (!b) return;
    feed = b.dataset.feed; team = null; paint();
  });
  view.querySelector('#col-team').addEventListener('change', e => { team = e.target.value; paint(); });

  if (initialTeam) team = initialTeam;
  paint();
}
