/* Player Simulator screen — lazily imported by app.js on #/player-sim.
   Was a standalone 427KB coach.html with its own dark-only palette; the model
   below is that page's logic unchanged, but the shell is gone: this renders
   into the app's view element and inherits the appbar, tab bar, theme toggle
   and css/app.css tokens. The 2,021-player payload it used to inline now
   arrives as data/coach_players.json, fetched (and version-tokened) by app.js
   so deploy.sh's staging grep still sees the path it needs to ship. */

/* ============================================================
   PURE LOGIC MODULE — unchanged from the standalone page
   ============================================================ */
const RatingModel = (() => {
  const STATS = ['xg96', 'xa96', 'kp96', 'sotp', 'off96', 'pas96', 'def96'];
  const LABELS = {
    xg96: 'Shot threat — xG per 96', xa96: 'Chance creation — xA per 96',
    kp96: 'Key passes per 96', sotp: 'Shot accuracy — on-target %',
    off96: 'Attacking value added (g+ /96)', pas96: 'Passing value added (g+ /96)',
    def96: 'Defensive value added (g+ /96)',
  };
  const WEIGHTS = {
    ST: { xg96: .35, sotp: .10, off96: .25, xa96: .10, kp96: .05, pas96: .10, def96: .05 },
    W:  { xg96: .20, xa96: .25, kp96: .15, off96: .20, pas96: .10, def96: .05, sotp: .05 },
    AM: { xg96: .20, xa96: .25, kp96: .15, off96: .20, pas96: .10, def96: .05, sotp: .05 },
    CM: { pas96: .30, xa96: .20, kp96: .15, off96: .10, def96: .15, xg96: .10 },
    DM: { def96: .35, pas96: .30, off96: .10, xg96: .05, xa96: .10, kp96: .10 },
    FB: { def96: .25, xa96: .20, kp96: .15, pas96: .20, off96: .15, xg96: .05 },
    CB: { def96: .45, pas96: .35, off96: .10, xg96: .05, kp96: .05 },
  };
  const group = p => p.pos.split('/')[0];
  const buildNorms = players => {
    const norms = {};
    for (const p of players) (norms[group(p)] ??= []).push(p);
    for (const g of Object.keys(norms)) {
      const ps = norms[g]; const out = {};
      for (const s of STATS) {
        const vals = ps.map(x => x[s]);
        const mu = vals.reduce((a, b) => a + b, 0) / vals.length;
        const sd = Math.sqrt(vals.reduce((a, v) => a + (v - mu) ** 2, 0) / vals.length) || 1;
        out[s] = { mu, sd, p95: vals.slice().sort((a, b) => a - b)[Math.floor(vals.length * .95)] };
      }
      norms[g] = out;
    }
    return norms;
  };
  const rate = (stats, g, norms) => {
    let z = 0;
    const w = WEIGHTS[g] || WEIGHTS.CM;
    for (const [s, wt] of Object.entries(w)) {
      const { mu, sd } = norms[g][s];
      z += wt * Math.max(-2.5, Math.min(2.5, (stats[s] - mu) / sd));
    }
    return Math.max(40, Math.min(99, Math.round(62 + 13 * z)));
  };
  const percentile = (players, g, s, v) => {
    const peers = players.filter(p => group(p) === g);
    return Math.round(100 * peers.filter(p => p[s] <= v).length / peers.length);
  };
  const rankAmong = (players, g, norms, rating, selfId) => {
    const peers = players.filter(p => group(p) === g && p.id !== selfId);
    return { rank: 1 + peers.filter(p => rate(p, g, norms) > rating).length, of: peers.length + 1,
      passed: peers.filter(p => rate(p, g, norms) < rating) };
  };
  const topLevers = (p, g, norms) => {
    const base = rate(p, g, norms);
    return Object.keys(WEIGHTS[g] || WEIGHTS.CM).map(s => {
      const bumped = { ...p, [s]: p[s] + 0.5 * norms[g][s].sd };
      return { stat: s, gain: rate(bumped, g, norms) - base };
    }).sort((a, b) => b.gain - a.gain);
  };
  const overperformance = p => p.g - p.xg96 * p.min / 96;
  return { STATS, LABELS, WEIGHTS, group, buildNorms, rate, percentile, rankAmong, topLevers, overperformance };
})();

/* ============================================================
   SCREEN
   ============================================================ */
const M = RatingModel;
const POS_NAMES = { ST: 'Strikers', W: 'Wingers', AM: 'Attacking mids', CM: 'Central mids',
  DM: 'Defensive mids', FB: 'Fullbacks', CB: 'Center backs' };
const POS_ONE = { ST: 'striker', W: 'winger', AM: 'attacking mid', CM: 'central mid',
  DM: 'defensive mid', FB: 'fullback', CB: 'center back' };
const ADVICE = {
  xg96: 'Get on the end of more good chances — box touches, near-post runs, earlier shots.',
  xa96: 'Deliver the final ball more often — cutbacks and through balls into the danger zone.',
  kp96: 'Find the pass that leads to a shot more often.',
  sotp: 'Work the keeper — placement over power in finishing drills.',
  off96: 'Make dribbles, carries and shots add real scoring chance, not just highlights.',
  pas96: 'Progress the ball — passes that move your team closer to a goal.',
  def96: 'Win the ball back more — tackles, interceptions and recoveries in the right spots.',
};
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* Render the screen. `view` is the app's content element, `LEAGUES` the parsed
   data/coach_players.json. Every lookup is scoped to `view` and every id is
   cch-prefixed, so nothing here can collide with the rest of the app. */
export function render(view, LEAGUES) {
  const $ = id => view.querySelector('#cch-' + id);
  const SEARCH_INDEX = [];
  for (const [lg, d] of Object.entries(LEAGUES))
    for (const p of d.players) SEARCH_INDEX.push({ lg, p, tag: `${p.name} (${d.teams[p.team] || p.team})` });

  let LG = 'mls', OUTFIELD = [], NORMS = null, cur = null, sim = null;
  const NORMS_CACHE = {};

  const fmt = (s, v) => {
    if (s === 'sotp') return Math.round(v * 100) + '%';
    const t = (+v).toFixed(2);
    return t === '-0.00' ? '0.00' : t;
  };
  const target = (g, s) => {
    const t = cur[s] + 0.5 * NORMS[g][s].sd;
    return s === 'sotp' ? Math.min(1, t) : t;
  };
  const ratingOf = p => M.rate(p, M.group(p), NORMS);
  const teamName = t => LEAGUES[LG].teams[t] || t;
  const leagueLabel = () => LEAGUES[LG].label;

  view.innerHTML = `
    <button class="backbtn" onclick="location.hash='#/tools'">&larr; Tools</button>
    <div class="kicker">Six pro leagues &middot; real stats</div>
    <h2 class="disp">What gets you up the rankings?</h2>
    <p class="note">Pick yourself &mdash; any player with 450+ minutes in MLS, NWSL, USL Championship,
      USL League One, MLS Next Pro or USL Super League. Your rating is built from per-96 numbers,
      weighted for your position and compared against your league. Below it: the training plan &mdash;
      drag a scroller to simulate improvement, or tap a target to apply the realistic half-step,
      and watch the names you'd pass.
      <b>Pro leagues only for now.</b> Amateur and youth players don't publish per-player match
      stats, so they can't be rated yet &mdash; that changes when clubs connect their own data.</p>

    <div class="cch-pickers">
      <label class="cch-f"><span>League</span><select id="cch-lg"></select></label>
      <label class="cch-f"><span>Team</span><select id="cch-team"></select></label>
      <label class="cch-f"><span>Position</span><select id="cch-pos"></select></label>
      <label class="cch-f cch-wide"><span>Roster &mdash; top-rated first</span><select id="cch-player"></select></label>
      <label class="cch-f cch-wide"><span>Know the name? Search</span>
        <input type="text" id="cch-search" list="cch-all" placeholder="Type a name&hellip;" autocomplete="off">
        <datalist id="cch-all"></datalist></label>
    </div>

    <div class="cch-hero">
      <div class="cch-rating"><span id="cch-rating">&mdash;</span><small>RXI rating</small></div>
      <div class="cch-who">
        <b id="cch-pname">&mdash;</b>
        <div class="cch-meta" id="cch-pmeta"></div>
        <div class="cch-rankline" id="cch-prank"></div>
        <div class="chips"><span id="cch-chip" class="chip flat">current form</span></div>
      </div>
    </div>

    <div class="cch-head"><div class="kicker">Your training plan</div>
      <button class="chip" id="cch-reset">Reset to real stats</button></div>
    <div id="cch-plan"></div>
    <p class="note" id="cch-context"></p>

    <div id="cch-payoff" hidden>
      <div class="kicker">What that buys you</div>
      <div class="cch-payline" id="cch-payhead"></div>
      <div class="cch-passes" id="cch-passes"></div>
      <div class="note" id="cch-next"></div>
    </div>

    <p class="note cch-warn" id="cch-warn" hidden></p>

    <p class="note">Data: American Soccer Analysis public API &mdash; MLS, NWSL, USL Championship,
      USL League One, MLS Next Pro (2026) and USL Super League (2025&ndash;26), players with 450+
      minutes, goalkeepers excluded (their levers are save data we don't ingest yet). Ratings and
      percentiles compare you to position peers in your own league. The 0&ndash;99 rating is
      experimental: position-weighted z-scores over per-96 stats including goals-added (g+) value.
      Amateur and youth leagues aren't covered &mdash; no public per-player stats exist for them yet.
      Nothing you simulate here is saved.</p>`;

  function setLeague(lg) {
    LG = lg;
    OUTFIELD = LEAGUES[lg].players;
    NORMS = NORMS_CACHE[lg] ??= M.buildNorms(OUTFIELD);
    $('lg').value = lg;
    const keepPos = $('pos').value;
    const groups = [...new Set(OUTFIELD.map(M.group))].sort();
    $('pos').innerHTML = '<option value="">All positions</option>' +
      groups.map(g => `<option value="${g}">${POS_NAMES[g] || g}</option>`).join('');
    $('pos').value = groups.includes(keepPos) ? keepPos : '';
    const teams = [...new Set(OUTFIELD.map(p => p.team))]
      .sort((a, b) => teamName(a).localeCompare(teamName(b)));
    $('team').innerHTML = '<option value="">All teams</option>' +
      teams.map(t => `<option value="${t}">${esc(teamName(t))}</option>`).join('');
  }

  function filteredPlayers() {
    const g = $('pos').value, t = $('team').value;
    return OUTFIELD.filter(p => (!g || M.group(p) === g) && (!t || p.team === t));
  }
  function refreshRoster() {
    const list = filteredPlayers().sort((a, b) => ratingOf(b) - ratingOf(a));
    $('player').innerHTML = list.map(p =>
      `<option value="${p.id}">${ratingOf(p)}  ${esc(p.name)} (${esc(teamName(p.team))})</option>`).join('');
    return list;
  }
  function loadPlayer(p) {
    cur = p;
    sim = { ...p };
    $('search').value = '';
    refreshRoster();
    $('player').value = p.id;
    buildPlan();
    render2();
  }
  function onFilterChange(e) {
    let list = refreshRoster();
    if (!list.length) {
      /* empty combo: relax the filter the user didn't just touch */
      if (e && e.target.id === 'cch-team') $('pos').value = '';
      else $('team').value = '';
      list = refreshRoster();
    }
    if (!list.length) return;
    if (list.some(p => p.id === cur.id)) $('player').value = cur.id;
    else loadPlayer(list[0]);
  }
  function onSearch() {
    const v = $('search').value.trim().toLowerCase();
    if (!v) return;
    const hit = SEARCH_INDEX.find(e => e.lg === LG && e.tag.toLowerCase() === v) ||
                SEARCH_INDEX.find(e => e.lg === LG && e.p.name.toLowerCase() === v) ||
                SEARCH_INDEX.find(e => e.tag.toLowerCase() === v) ||
                SEARCH_INDEX.find(e => e.p.name.toLowerCase() === v);
    if (!hit) return;
    if (hit.lg !== LG) setLeague(hit.lg);
    if ($('pos').value && M.group(hit.p) !== $('pos').value) $('pos').value = M.group(hit.p);
    if ($('team').value && hit.p.team !== $('team').value) $('team').value = hit.p.team;
    loadPlayer(hit.p);
  }

  function buildPlan() {
    const g = M.group(cur);
    const levers = M.topLevers(cur, g, NORMS);   // every weighted stat, best payoff first
    $('plan').innerHTML = levers.map(l => {
      const s = l.stat;
      const max = Math.max(NORMS[g][s].p95 * 1.25, cur[s] * 1.1, target(g, s)) || 1;
      const min = s === 'def96' || s === 'pas96' || s === 'off96' ? -Math.abs(max) * 0.4 : 0;
      return `<div class="cch-lever" data-s="${s}">
        <div class="cch-lhead">
          <span class="cch-stat">${M.LABELS[s]}</span>
          <button class="cch-gain${l.gain > 0 ? '' : ' zero'}" data-s="${s}"
            title="Apply the realistic half-step target">target ${l.gain > 0 ? '+' + l.gain : '±0'}</button>
        </div>
        <div class="cch-advice">${ADVICE[s]}</div>
        <input type="range" data-s="${s}" min="${min}" max="${max}"
               step="${(max - min) / 200}" value="${sim[s]}" list="cch-ticks-${s}"
               aria-label="${M.LABELS[s]}">
        <datalist id="cch-ticks-${s}">
          <option value="${cur[s]}"></option><option value="${target(g, s)}"></option>
        </datalist>
        <div class="cch-nums" id="cch-nums-${s}"></div>
      </div>`;
    }).join('');
    const one = POS_ONE[g] || g;
    $('context').textContent =
      `Weighted for ${/^[aeiou]/i.test(one) ? 'an' : 'a'} ${one}. Context (not levers): ` +
      `${cur.g} goal${cur.g === 1 ? '' : 's'}, ${cur.a} assist${cur.a === 1 ? '' : 's'}, ${cur.min} minutes this season.`;
    $('plan').querySelectorAll('input[type=range]').forEach(el =>
      el.addEventListener('input', e => { sim[e.target.dataset.s] = +e.target.value; render2(); }));
    $('plan').querySelectorAll('button.cch-gain').forEach(el =>
      el.addEventListener('click', e => {
        const s = e.currentTarget.dataset.s;
        const t = target(M.group(cur), s);
        sim[s] = Math.abs(sim[s] - t) < 1e-9 ? cur[s] : t;
        const sl = $('plan').querySelector(`input[data-s="${s}"]`);
        if (sl) sl.value = sim[s];
        render2();
      }));
  }

  /* named render2 so it can't shadow the exported render() above */
  function render2() {
    const g = M.group(cur);
    const r0 = M.rate(cur, g, NORMS);
    const r1 = M.rate(sim, g, NORMS);
    const d = r1 - r0;
    $('rating').textContent = r1;
    $('pname').textContent = cur.name;
    $('pmeta').textContent = `${teamName(cur.team)} · ${cur.pos} · ${leagueLabel()}`;
    const { rank, of, passed } = M.rankAmong(OUTFIELD, g, NORMS, r1, cur.id);
    const base = M.rankAmong(OUTFIELD, g, NORMS, r0, cur.id);
    $('chip').className = 'chip ' + (d > 0 ? 'up' : d < 0 ? 'down' : 'flat');
    $('chip').textContent = d === 0 ? 'current form' : `${d > 0 ? '+' : ''}${d} vs real rating ${r0}`;

    for (const s of M.STATS) {
      const el = $('nums-' + s);
      if (!el) continue;
      const marginal = M.rate({ ...cur, [s]: sim[s] }, g, NORMS) - r0;
      const moved = Math.abs(sim[s] - cur[s]) > 1e-9;
      el.innerHTML =
        `<span>now <b>${fmt(s, cur[s])}</b> (P${M.percentile(OUTFIELD, g, s, cur[s])})</span>` +
        `<span>sim <b>${fmt(s, sim[s])}</b> (P${M.percentile(OUTFIELD, g, s, sim[s])})` +
        (moved ? ` · <span class="cch-delta ${marginal >= 0 ? 'up' : 'down'}">${marginal >= 0 ? '+' : ''}${marginal} rating</span>` : '') +
        `</span>`;
      const card = $('plan').querySelector(`.cch-lever[data-s="${s}"]`);
      if (card) card.classList.toggle('on', moved);
      const btn = $('plan').querySelector(`button.cch-gain[data-s="${s}"]`);
      if (btn) btn.classList.toggle('applied', Math.abs(sim[s] - target(g, s)) < 1e-9);
    }

    const newlyPassed = d > 0 ? passed
      .filter(p => M.rate(p, g, NORMS) >= r0)
      .sort((a, b) => M.rate(b, g, NORMS) - M.rate(a, g, NORMS)) : [];
    const climbed = base.rank - rank;
    if (d > 0 && (newlyPassed.length || climbed > 0)) {
      $('payoff').hidden = false;
      $('payhead').innerHTML = climbed > 0
        ? `You'd climb to <b>#${rank}</b> of ${of} — up ${climbed} spot${climbed === 1 ? '' : 's'}.`
        : `You'd pull clear at <b>#${rank}</b> of ${of}.`;
      $('passes').innerHTML = newlyPassed.slice(0, 12).map(p =>
        `<span class="cch-pass"><b>${esc(p.name)}</b> · ${esc(teamName(p.team))}<span class="r">${M.rate(p, g, NORMS)}</span></span>`).join('') +
        (newlyPassed.length > 12 ? `<span class="cch-pass">+${newlyPassed.length - 12} more</span>` : '');
    } else {
      $('payoff').hidden = true;
    }

    const above = OUTFIELD.filter(p => M.group(p) === g && p.id !== cur.id)
      .map(p => ({ p, r: M.rate(p, g, NORMS) }))
      .filter(x => x.r > r1)
      .sort((a, b) => a.r - b.r);
    const nt = above[0];
    const ntText = nt
      ? `Next up: <b>${esc(nt.p.name)}</b> (${esc(teamName(nt.p.team))}, ${nt.r}) — ${nt.r - r1 + 1} more point${nt.r - r1 + 1 === 1 ? '' : 's'} to pass them.`
      : `Nobody left above you — top-rated ${POS_ONE[g] || g} in ${leagueLabel().replace(/ \d{4}(-\d{2})?$/, '')}.`;
    if (!$('payoff').hidden) {
      $('next').innerHTML = ntText;
      $('prank').textContent = `#${rank} of ${of} ${(POS_NAMES[g] || g).toLowerCase()}`;
    } else {
      $('prank').innerHTML = `#${rank} of ${of} ${(POS_NAMES[g] || g).toLowerCase()}` +
        (nt ? ` <span class="cch-dim">· ${nt.r - r1 + 1} pts behind ${esc(nt.p.name)}</span>` : '');
    }

    /* honesty warning: a hot finishing run is not a better player */
    const over = M.overperformance(cur);
    if (over > 2.5) {
      $('warn').hidden = false;
      $('warn').innerHTML = `<b>Heads up:</b> ${esc(cur.name)} has scored ${cur.g} goals from ` +
        `${(cur.xg96 * cur.min / 96).toFixed(1)} expected — ${over.toFixed(1)} above. That usually regresses, ` +
        `so the rating leans on xG, not goals. Keep the chances coming and the goals take care of themselves.`;
    } else $('warn').hidden = true;
  }

  $('lg').addEventListener('change', () => { setLeague($('lg').value); $('team').value = ''; onFilterChange(); });
  $('pos').addEventListener('change', onFilterChange);
  $('team').addEventListener('change', onFilterChange);
  $('player').addEventListener('change', () => {
    const p = OUTFIELD.find(x => x.id === $('player').value);
    if (p) loadPlayer(p);
  });
  $('search').addEventListener('change', onSearch);
  $('search').addEventListener('focus', e => e.target.select());
  $('reset').addEventListener('click', () => {
    sim = { ...cur };
    $('plan').querySelectorAll('input[type=range]').forEach(el => { el.value = cur[el.dataset.s]; });
    render2();
  });

  /* first paint: MLS, a mid-pack winger — a recognisable, unremarkable starting point */
  $('lg').innerHTML = Object.entries(LEAGUES)
    .map(([lg, d]) => `<option value="${lg}">${esc(d.label)}</option>`).join('');
  view.querySelector('#cch-all').innerHTML = SEARCH_INDEX.slice()
    .sort((a, b) => a.p.name.localeCompare(b.p.name))
    .map(e => `<option value="${esc(e.tag)}">${POS_ONE[M.group(e.p)] || e.p.pos} · ${esc(LEAGUES[e.lg].label)}</option>`)
    .join('');
  setLeague('mls');
  $('pos').value = 'W';
  const ws = OUTFIELD.filter(p => M.group(p) === 'W').sort((a, b) => ratingOf(b) - ratingOf(a));
  loadPlayer(ws[Math.floor(ws.length / 2)]);
}
