/* Giant-Killings (#/upsets) — lazily imported by app.js.

   data/opencup_matches.json holds 1,584 U.S. Open Cup matches from 2016-2026,
   scraped from Wikipedia. Until now the app only showed the Open Cup's finals,
   via cups.json — the winner and the runner-up. That threw away the part of the
   competition the rest of this app is actually about: the rounds where a
   fourth-tier side draws a first-tier one.

   A club's tier comes from the league label Wikipedia recorded for it in that
   season, mapped onto the same ladder screenPyramid() draws. The map below is
   deliberately incomplete: a match is only called an upset when BOTH sides map
   to a tier we can defend. Local-qualifying rounds, USASA regional play and the
   long tail of state leagues have no place on that ladder, so they are counted
   and disclosed rather than guessed at. */

/* Historical league codes as Wikipedia writes them, on the app's own ladder.
   Renames matter here: "USL" is what USL Championship was called through 2018,
   and "PDL" is what USL League Two was called through 2018 — treating either as
   a separate league would have scored a straight league match as an upset. */
const TIER = {
  MLS: 1,
  USLC: 2, USL: 2, NASL: 2,
  USL1: 3, MLSNP: 3, NISA: 3,
  NPSL: 4, USL2: 4, PDL: 4, UPSL: 4,
  APSL: 5, EPSL: 5, SWPL: 5, MPL: 5, MWPL: 5, CPL: 5, CSL: 5, SFSFL: 5,
  EPLWA: 5, LISFL: 5, GCPL: 5, NISAN: 5, NSL: 5,
};
const TIER_NAME = { 1: 'Division I', 2: 'Division II', 3: 'Division III',
  4: 'National amateur', 5: 'Regional' };
/* what the codes above stand for, for the tooltip on each badge */
const LEAGUE_NAME = {
  MLS: 'MLS', USLC: 'USL Championship', USL: 'USL (now USL Championship)',
  NASL: 'NASL', USL1: 'USL League One', MLSNP: 'MLS Next Pro', NISA: 'NISA',
  NPSL: 'NPSL', USL2: 'USL League Two', PDL: 'PDL (now USL League Two)',
  UPSL: 'UPSL', APSL: 'APSL', EPSL: 'EPSL (now APSL)',
  SWPL: 'Southwest Premier League', MPL: 'Mountain Premier League',
  MWPL: 'Midwest Premier League', CPL: 'Cascadia Premier League',
  CSL: 'Cosmopolitan Soccer League', SFSFL: 'San Francisco Soccer Football League',
  EPLWA: 'EPLWA', LISFL: 'LISFL', GCPL: 'Gulf Coast Premier League',
  NISAN: 'NISA Nation', NSL: 'National Soccer League',
};

/** One row of the source file, normalised into winner/loser terms. */
function normalise(m) {
  const t1 = TIER[m.l1], t2 = TIER[m.l2];
  const w = m.winner;
  if (!w || !t1 || !t2 || t1 === t2) return null;
  const winnerIsFirst = w === 1;
  const wt = winnerIsFirst ? t1 : t2;
  const lt = winnerIsFirst ? t2 : t1;
  if (wt <= lt) return null;                  // favourite won; not an upset
  const [s1, s2] = m.score || [];
  return {
    year: m.year, round: m.round, date: m.date, gap: wt - lt,
    winner: winnerIsFirst ? m.t1 : m.t2, winnerLg: winnerIsFirst ? m.l1 : m.l2, winnerTier: wt,
    loser:  winnerIsFirst ? m.t2 : m.t1, loserLg:  winnerIsFirst ? m.l2 : m.l1, loserTier: lt,
    /* the source records the 90-minute score; a level one with a declared
       winner went to extra time or penalties and must not read as "won 1-1" */
    score: winnerIsFirst ? `${s1}–${s2}` : `${s2}–${s1}`,
    shootout: s1 != null && s1 === s2,
    qualifying: m.comp === 'usoc-q',
  };
}

export function render(view, data, helpers) {
  const { esc, linkClub } = helpers;
  const all = data.matches || [];
  const upsets = all.map(normalise).filter(Boolean)
    .sort((a, b) => b.year - a.year || b.gap - a.gap);

  /* everything the headline claim rests on, counted rather than asserted */
  const tiered = all.filter(m => TIER[m.l1] && TIER[m.l2]);
  const crossTier = tiered.filter(m => TIER[m.l1] !== TIER[m.l2]);
  const unplaceable = all.length - tiered.length;
  const years = [...new Set(upsets.map(u => u.year))].sort((a, b) => b - a);

  let year = 'all', gapOnly = false;

  const badge = (lg, tier) =>
    `<span class="gk-tier gk-t${tier}" title="${esc(LEAGUE_NAME[lg] || lg)} — ${TIER_NAME[tier]}">${esc(lg)}</span>`;

  const rowHtml = u => `
    <li class="gk-row">
      <span class="gk-yr">${u.year}</span>
      <span class="gk-body">
        <span class="gk-line"><b>${linkClub(u.winner)}</b> ${badge(u.winnerLg, u.winnerTier)}
          <span class="gk-beat">beat</span> ${linkClub(u.loser)} ${badge(u.loserLg, u.loserTier)}</span>
        <span class="gk-meta">${esc(u.round)}${u.qualifying ? ' · qualifying' : ''}${u.gap > 1 ? ` · ${u.gap} tiers up` : ''}</span>
      </span>
      <span class="gk-score">${u.score}${u.shootout ? '<small>after level</small>' : ''}</span>
    </li>`;

  function paint() {
    const shown = upsets.filter(u =>
      (year === 'all' || u.year === year) && (!gapOnly || u.gap > 1));
    const list = view.querySelector('#gk-list');
    list.innerHTML = shown.length
      ? shown.map(rowHtml).join('')
      : '<li class="gk-row"><span class="gk-body">No giant-killings on record for that filter.</span></li>';
    view.querySelector('#gk-count').textContent =
      `${shown.length} ${shown.length === 1 ? 'result' : 'results'}`;
    view.querySelectorAll('[data-yr]').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.yr === String(year))));
    view.querySelector('#gk-gap').setAttribute('aria-pressed', String(gapOnly));
  }

  view.innerHTML = `
    <button class="backbtn" onclick="location.hash='#/cups'">&larr; Trophy Room</button>
    <div class="kicker">U.S. Open Cup &middot; ${data.years[0]}&ndash;${data.years[data.years.length - 1]}</div>
    <h2 class="disp">Giant-Killings</h2>
    <p class="note">The Open Cup is the one competition where any tier can draw any other, which
      makes it the only place the pyramid is settled on the field instead of on paper. These are
      the matches a lower-tier club won.</p>

    <div class="statgrid">
      <div class="stat"><b>${upsets.length}</b><span>Giant-killings</span></div>
      <div class="stat"><b>${crossTier.length}</b><span>Cross-tier matches</span></div>
      <div class="stat"><b>${Math.round(100 * upsets.length / (crossTier.length || 1))}%</b><span>Won by the underdog</span></div>
    </div>

    <div class="chips" id="gk-years">
      <button class="chip solid" data-yr="all" aria-pressed="true">All years</button>
      ${years.map(y => `<button class="chip solid" data-yr="${y}" aria-pressed="false">${y}</button>`).join('')}
    </div>
    <div class="chips">
      <button class="chip solid" id="gk-gap" aria-pressed="false">Two tiers or more</button>
      <span class="cch-dim" id="gk-count"></span>
    </div>

    <ul class="gk-list" id="gk-list"></ul>

    <p class="note"><b>What is counted.</b> A club's tier is the one its league sat on in that
      season, using the same ladder as the <a href="#/tiers">Tiers</a> view. Renamed leagues are
      followed, not double-counted: USL Championship appears as &ldquo;USL&rdquo; before 2019 and
      USL League Two as &ldquo;PDL&rdquo;.
      ${unplaceable} of the ${all.length} matches on file &mdash; local qualifying rounds, USASA
      regional play and state leagues &mdash; sit on no national tier, so they are left out of
      these totals rather than guessed at. A score marked <i>after level</i> was decided in extra
      time or on penalties; the figure shown is the 90-minute score the source records.
      Match data from Wikipedia (CC BY-SA 4.0).</p>`;

  view.querySelector('#gk-years').addEventListener('click', e => {
    const b = e.target.closest('[data-yr]'); if (!b) return;
    year = b.dataset.yr === 'all' ? 'all' : Number(b.dataset.yr);
    paint();
  });
  view.querySelector('#gk-gap').addEventListener('click', () => { gapOnly = !gapOnly; paint(); });
  paint();
}
