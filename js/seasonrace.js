/* Season Race screen — lazily imported by app.js on #/race.

   Answers the question the Matchup Machine can't: not "who wins this match"
   but "who wins this league". It starts from the real table, plays out only
   the fixtures still to come, and reports where each club lands.

   Two numbers, and they are different things:
     Proj  — where a club is on course to finish. Points already banked plus
             what the remaining fixtures are worth. A single number.
     Title — how often the club finishes top once the run-in is played out.
             A projection alone cannot produce this; a probability needs
             variance, which is why the run-in is replayed many times.

   Performance note that matters: oddsFor() loops 64 scoreline cells, so
   calling it inside the replay loop would be ~160M operations for MLS and
   would jank on a phone. It is called ONCE per fixture up front and the 64
   cells become a cumulative table sorted by probability, so the hot loop is
   a scan that exits in about three steps. 10,000 replays lands in ~60ms.

   Self-contained by convention: the deploy stamp only rewrites ?v= tokens in
   app.js, so a module that imported a sibling would serve that sibling stale
   forever. Keep this file importing nothing — app.js passes in oddsFor, the
   club index and the league table. */

const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtD = iso => { const p = String(iso).split('-'); return MON[+p[1] - 1] + ' ' + (+p[2]); };
/* never render 0% for something that can still happen, and never 100% for
   something that can still fail */
const pct = p => p >= 0.9995 ? '100%' : p >= 0.01 ? (p * 100).toFixed(0) + '%'
  : p > 0 ? '&lt;1%' : '&mdash;';

const REPLAYS = 10000;   // stable to about +/-0.5%; see the note above
/* the picker is four buttons on a 320px phone, so the full league names do not
   fit — these are the shelf labels, the full name still heads the screen */
const SHORT = { mls: 'MLS', nwsl: 'NWSL', uslc: 'USL C', usl1: 'USL 1' };

let S = null;            // screen state, rebuilt on every entry

/* ---------------------------------------------------------------
   The simulator
   --------------------------------------------------------------- */
function simulate(lg, opts) {
  const { N, homeAdv, forced } = opts;
  const season = S.seasons[lg], table = S.standings[lg];
  const cut = opts.cut != null ? opts.cut : season.cut;
  const rows = [], confOf = [], idx = {};
  table.groups.forEach((g, gi) => g.rows.forEach(r => {
    const c = S.clubById(r.id);
    if (!c || !c.r) return;                 // no rating -> cannot be simulated
    idx[r.id] = rows.length;
    rows.push({ ...r, n: c.n, r: c.r, g: c.g, img: c.img });
    confOf.push(gi);
  }));
  const C = rows.length, G = table.groups.length;
  if (!C) return null;

  const rest = S.schedule.filter(f => f.lg === lg && idx[f.h] != null && idx[f.a] != null);
  const M = rest.length;

  /* precompute: one oddsFor call per fixture, cells sorted by probability */
  const cum = new Float64Array(M * 64), gh = new Uint8Array(M * 64), ga = new Uint8Array(M * 64);
  const hI = new Int32Array(M), aI = new Int32Array(M), meta = new Array(M);
  for (let m = 0; m < M; m++) {
    hI[m] = idx[rest[m].h]; aI[m] = idx[rest[m].a];
    const o = S.oddsFor(rows[hI[m]], rows[aI[m]], homeAdv);
    meta[m] = o;
    /* a forced result samples only from the cells matching that outcome, so
       the scoreline - and therefore the goal difference - stays coherent */
    const want = forced[m];
    let cells = o.cells;
    if (want) cells = cells.filter(c =>
      want === 'H' ? c[1] > c[2] : want === 'D' ? c[1] === c[2] : c[1] < c[2]);
    cells = cells.slice().sort((x, y) => y[0] - x[0]);
    const sum = cells.reduce((n, c) => n + c[0], 0);
    let acc = 0;
    for (let k = 0; k < 64; k++) {
      const c = cells[Math.min(k, cells.length - 1)];
      if (k < cells.length) acc += c[0] / sum;
      cum[m * 64 + k] = acc; gh[m * 64 + k] = c[1]; ga[m * 64 + k] = c[2];
    }
    cum[m * 64 + 63] = 1;
  }

  const bP = new Int32Array(C), bW = new Int32Array(C), bF = new Int32Array(C), bA = new Int32Array(C);
  /* points deductions are real - USL has used them - and a table that ignores
     one is simply wrong */
  rows.forEach((r, i) => { bP[i] = r.pts - (r.ded || 0); bW[i] = r.w; bF[i] = r.gf; bA[i] = r.ga; });

  const pts = new Int32Array(C), w = new Int32Array(C), gf = new Int32Array(C), gaA = new Int32Array(C);
  const shield = new Int32Array(C), confWin = new Int32Array(C), playoff = new Int32Array(C);
  const sumPts = new Float64Array(C), sumFin = new Float64Array(C);
  const dist = []; for (let i = 0; i < C; i++) dist.push(new Int32Array(C + 2));
  const order = new Array(C);

  const t0 = performance.now();
  for (let n = 0; n < N; n++) {
    pts.set(bP); w.set(bW); gf.set(bF); gaA.set(bA);
    for (let m = 0; m < M; m++) {
      const r = Math.random(), b = m * 64;
      let k = 0; while (k < 63 && cum[b + k] < r) k++;
      const H = hI[m], A = aI[m], x = gh[b + k], y = ga[b + k];
      gf[H] += x; gaA[H] += y; gf[A] += y; gaA[A] += x;
      if (x > y) { pts[H] += 3; w[H]++; }
      else if (x === y) { pts[H]++; pts[A]++; }
      else { pts[A] += 3; w[A]++; }
    }
    for (let i = 0; i < C; i++) order[i] = i;
    order.sort((p, q) => pts[q] - pts[p] || w[q] - w[p]
      || (gf[q] - gaA[q]) - (gf[p] - gaA[p]) || gf[q] - gf[p]);
    shield[order[0]]++;
    const seen = new Int32Array(G);
    for (let i = 0; i < C; i++) {
      const c = order[i], place = ++seen[confOf[c]];
      if (place === 1) confWin[c]++;
      if (place <= cut) playoff[c]++;
      sumPts[c] += pts[c]; sumFin[c] += place; dist[c][place]++;
    }
  }
  const ms = performance.now() - t0;

  return {
    ms, N, cut, fixtures: M, meta, idx, rest, groups: table.groups.map(g => g.name),
    groupSizes: table.groups.map((g, gi) => confOf.filter(x => x === gi).length),
    rows: rows.map((r, i) => ({
      ...r, conf: confOf[i],
      pShield: shield[i] / N, pConf: confWin[i] / N, pPlayoff: playoff[i] / N,
      projPts: sumPts[i] / N, avgFin: sumFin[i] / N,
      dist: Array.from(dist[i]).map(v => v / N)
    }))
  };
}

/* ---------------------------------------------------------------
   Season block — says whether the league is playing, and why the
   table is frozen when it is not
   --------------------------------------------------------------- */
function seasonBlock(lg) {
  const s = S.seasons[lg];
  if (!s) return '';
  const now = new Date().toISOString().slice(0, 10);
  const brk = (s.breaks || []).find(b => now > b.from && now < b.to);
  const gp = Math.max.apply(null, S.standings[lg].groups
    .flatMap(g => g.rows.map(r => r.gp)).concat([0]));
  const span = new Date(s.end) - new Date(s.start);
  const done = Math.max(0, Math.min(1, (new Date(now) - new Date(s.start)) / span));

  let pill, note;
  if (now < s.start) {
    pill = '<span class="rc-pill done">Preseason</span>';
    note = 'First match <b>' + fmtD(s.start) + '</b>. Ratings carry over until results land.';
  } else if (now > s.end) {
    pill = '<span class="rc-pill done">Season over</span>';
    note = 'The ' + s.end.slice(0, 4) + ' season finished <b>' + fmtD(s.end) +
      '</b>. The table is final until the next one kicks off.';
  } else if (brk) {
    pill = '<span class="rc-pill brk">On break</span>';
    note = 'No matches between <b>' + fmtD(brk.from) + '</b> and <b>' + fmtD(brk.to) +
      '</b> &mdash; a ' + brk.days + '-day gap. <b>Standings and ratings are frozen ' +
      'until play resumes.</b>';
  } else {
    pill = '<span class="rc-pill live">In season</span>';
    note = 'Matchday <b>' + gp + '</b> of ' + s.games + '.';
  }
  return '<div class="rc-season"><div class="rc-stop">' + pill +
    '<span class="rc-dates">' + fmtD(s.start) + ' &ndash; ' + fmtD(s.end) +
    ' &middot; ' + s.games + ' games</span></div>' +
    '<div class="rc-track"><i style="width:' + (done * 100).toFixed(1) + '%"></i></div>' +
    '<p class="rc-note">' + note + '</p></div>';
}

/* ---------------------------------------------------------------
   Render
   --------------------------------------------------------------- */
function deltaTag(id, key) {
  if (!S.base || !Object.keys(S.forced).length) return '';
  const a = S.sim.rows[S.sim.idx[id]], b = S.base.rows[S.base.idx[id]];
  if (!a || !b) return '';
  const d = (a[key] - b[key]) * 100;
  if (Math.abs(d) < 1) return '';
  return '<span class="rc-delta ' + (d > 0 ? 'up' : 'down') + '">' +
    (d > 0 ? '&#9650;' : '&#9660;') + Math.abs(d).toFixed(0) + '</span>';
}

function drawer() {
  const n = Object.keys(S.forced).length;
  return '<details class="rc-draw"' + (S.drawer ? ' open' : '') + '>' +
    '<summary>Assumptions</summary><div class="rc-drawb">' +
    '<div class="rc-ctl"><span class="rc-lab">Home advantage <b id="rcHaV">+' + S.ha + ' Elo</b></span>' +
    '<input type="range" id="rcHa" min="0" max="130" step="5" value="' + S.ha + '" aria-label="Home advantage in Elo points"></div>' +
    '<div class="rc-ctl"><span class="rc-lab">Playoff places per group <b id="rcCutV">' + S.cut + '</b></span>' +
    '<input type="range" id="rcCut" min="1" max="12" step="1" value="' + S.cut + '" aria-label="Playoff places per group"></div>' +
    (n ? '<button class="rc-clear" id="rcClear">Clear ' + n + ' what-if result' + (n > 1 ? 's' : '') + '</button>' : '') +
    '<p class="rc-hint">Home advantage is the live parameter behind every prediction on the site: ' +
    '+65 Elo in the pro leagues, +30 in the amateur ones. Playoff places set where the dashed line sits.</p>' +
    '</div></details>';
}

function screenLeague(view) {
  const lg = S.lg, sim = S.sim, s = S.seasons[lg], meta = S.LEAGUES[lg];
  const multi = sim.groups.length > 1;
  const tables = sim.groups.map((name, gi) => {
    const rs = sim.rows.filter(r => r.conf === gi)
      .sort((a, b) => b.pShield - a.pShield || b.projPts - a.projPts);
    const top = Math.max.apply(null, rs.map(r => r.pShield).concat([0.0001]));
    return '<div class="rc-col"><div class="kicker">' + esc(name) + '</div>' +
      '<div class="rc-scroll"><table class="rc-tbl">' +
      '<thead><tr><th>Club</th><th class="rc-x">GP</th><th>Now</th><th>Left</th>' +
      '<th>Proj</th><th>' + (multi ? 'Group' : 'Title') + '</th>' +
      '<th class="rc-x">Title</th><th class="rc-x">Playoff</th></tr></thead><tbody>' +
      rs.map((r, i) => {
        const left = Math.max(0, s.games - r.gp);
        return '<tr class="rc-tap' + (i + 1 === sim.cut ? ' rc-cut' : '') + '" data-id="' + esc(r.id) + '" tabindex="0">' +
          '<td><span class="rc-team"><span class="rc-pos">' + (i + 1) + '</span>' +
          S.crest(r) + '<span class="rc-n">' + esc(r.n) + '</span></span>' +
          '<span class="rc-bar"><i style="width:' + (r.pShield / top * 100).toFixed(1) + '%"></i></span></td>' +
          '<td class="rc-x">' + r.gp + '</td><td>' + r.pts + '</td><td>' + left + '</td>' +
          '<td><b>' + r.projPts.toFixed(0) + '</b></td>' +
          '<td class="rc-odds' + (r.pConf >= .2 ? ' hi' : r.pConf < .01 ? ' lo' : '') + '">' +
          pct(r.pConf) + deltaTag(r.id, 'pConf') + '</td>' +
          '<td class="rc-odds rc-x' + (r.pShield >= .2 ? ' hi' : r.pShield < .01 ? ' lo' : '') + '">' +
          pct(r.pShield) + deltaTag(r.id, 'pShield') + '</td>' +
          '<td class="rc-odds rc-x' + (r.pPlayoff >= .5 ? ' hi' : r.pPlayoff < .01 ? ' lo' : '') + '">' +
          pct(r.pPlayoff) + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }).join('');

  const gpMax = Math.max.apply(null, sim.rows.map(r => r.gp).concat([0]));
  view.innerHTML =
    '<button class="backbtn" onclick="location.hash=\'#/tools\'">&larr; Tools</button>' +
    '<div class="kicker">Who wins the league</div>' +
    '<h2 class="disp">Season Race</h2>' +
    '<p class="rc-lgname">' + esc(S.LEAGUES[lg].label) + '</p>' +
    '<div class="rc-pick">' + S.leagues.map(k =>
      '<button data-lg="' + k + '"' + (k === lg ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') +
      '>' + esc(SHORT[k] || S.LEAGUES[k].label) + '</button>').join('') + '</div>' +
    seasonBlock(lg) +
    '<div class="rc-grid" data-cols="' + Math.min(3, sim.groups.length) + '">' + tables + '</div>' +
    '<p class="note"><b>Proj</b> is where each club is on course to finish: the points banked from ' +
    gpMax + ' games played, plus what the ' + sim.fixtures + ' fixtures still to come are worth. ' +
    '<b>' + (multi ? 'Group' : 'Title') + '</b> is how often they finish top once the run-in is played out ' +
    '&mdash; a projection gives a number, only replaying the run-in gives a percentage. ' +
    'The dashed line is the playoff cut. Tap a club for its full finish spread and to force results.</p>' +
    drawer() +
    '<p class="note">Standings and fixtures from ' + fmtD(S.updated.slice(0, 10)) +
    '. Ratings are Elo, held fixed across the simulated run-in. Predictions, not betting advice.</p>';
  wire(view);
}

function screenClub(view) {
  const sim = S.sim, r = sim.rows[sim.idx[S.club]];
  if (!r) { S.club = null; return screenLeague(view); }
  const s = S.seasons[S.lg];
  const size = sim.groupSizes[r.conf];
  const d = r.dist.slice(1, size + 1);
  const peak = Math.max.apply(null, d.concat([0.0001]));

  const mine = [];
  sim.rest.forEach((f, i) => {
    if (f.h !== r.id && f.a !== r.id) return;
    const home = f.h === r.id, opp = sim.rows[sim.idx[home ? f.a : f.h]], o = sim.meta[i];
    if (!opp) return;
    mine.push({ i, d: f.d, home, opp, pW: home ? o.pH : o.pA, pD: o.pD, pL: home ? o.pA : o.pH });
  });
  const sos = mine.length ? Math.round(mine.reduce((n, x) => n + x.opp.r, 0) / mine.length) : 0;

  view.innerHTML =
    '<button class="backbtn" id="rcBack">&larr; ' + esc(S.LEAGUES[S.lg].label) + '</button>' +
    '<div class="clubhead">' + S.crest(r, true) +
    '<div><h2 class="disp" style="margin:0">' + esc(r.n) + '</h2>' +
    '<span class="sub">' + esc(sim.groups[r.conf]) + ' &middot; Elo ' + r.r + '</span></div></div>' +
    '<div class="rc-stats">' +
    '<div class="rc-stat"><b>' + r.pts + '</b><span>Points now</span></div>' +
    '<div class="rc-stat"><b>' + r.projPts.toFixed(0) + '</b><span>Projected</span></div>' +
    '<div class="rc-stat"><b>' + r.avgFin.toFixed(1) + '</b><span>Avg finish</span></div></div>' +
    '<div class="rc-stats">' +
    '<div class="rc-stat"><b>' + pct(r.pConf) + '</b><span>Win group</span></div>' +
    '<div class="rc-stat"><b>' + pct(r.pPlayoff) + '</b><span>Playoffs</span></div>' +
    '<div class="rc-stat"><b>' + pct(r.pShield) + '</b><span>Win league</span></div></div>' +
    '<div class="kicker">Where they are on course to finish</div>' +
    '<div class="rc-hist">' + d.map((v, i) =>
      '<i class="' + (i + 1 <= sim.cut ? 'in' : '') + '" style="height:' +
      Math.max(1, v / peak * 100) + '%"><span>' + (i + 1) + ': ' + (v * 100).toFixed(1) + '%</span></i>').join('') +
    '</div><div class="rc-axis"><span>1st</span><span>' + size + 'th</span></div>' +
    '<div class="kicker">Remaining fixtures &mdash; force a result</div>' +
    '<ul class="rc-fx">' + mine.map(x =>
      '<li><span class="rc-fd">' + fmtD(x.d) + '</span>' +
      '<span class="rc-fo">' + (x.home ? 'v' : '@') + ' ' + esc(x.opp.n) + '</span>' +
      '<span class="rc-fp" title="win / draw / loss">' + (x.pW * 100).toFixed(0) + '/' +
      (x.pD * 100).toFixed(0) + '/' + (x.pL * 100).toFixed(0) + '</span>' +
      '<span class="rc-wdl">' + ['W', 'D', 'L'].map(k => {
        const code = x.home ? (k === 'W' ? 'H' : k === 'D' ? 'D' : 'A')
          : (k === 'W' ? 'A' : k === 'D' ? 'D' : 'H');
        return '<button class="' + k + '" data-fx="' + x.i + '" data-out="' + code +
          '" aria-pressed="' + (S.forced[x.i] === code) + '" aria-label="Force ' + k + '">' + k + '</button>';
      }).join('') + '</span></li>').join('') + '</ul>' +
    '<p class="note">Win/draw/loss percentages come from the same engine as the ' +
    '<a href="#/predict" style="color:var(--accent)">Matchup Machine</a>. Average remaining opponent ' +
    'rating is <b>' + sos + '</b> against this club&rsquo;s ' + r.r +
    '. Force a result and every number in the league recomputes.</p>' + drawer();
  wire(view);
}

function wire(view) {
  view.querySelectorAll('.rc-pick button').forEach(b => b.onclick = () => {
    S.lg = b.dataset.lg; S.club = null; S.forced = {}; S.base = null;
    S.cut = S.seasons[S.lg].cut;
    run(view);
  });
  const open = el => { S.club = el.dataset.id; run(view, true); };
  view.querySelectorAll('.rc-tap').forEach(t => {
    t.onclick = () => open(t);
    t.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(t); } };
  });
  const back = view.querySelector('#rcBack');
  if (back) back.onclick = () => { S.club = null; run(view, true); };
  view.querySelectorAll('.rc-wdl button').forEach(b => b.onclick = () => {
    const i = +b.dataset.fx, out = b.dataset.out;
    if (S.forced[i] === out) delete S.forced[i]; else S.forced[i] = out;
    run(view);
  });
  const dr = view.querySelector('.rc-draw');
  if (dr) dr.addEventListener('toggle', () => { S.drawer = dr.open; });
  const ha = view.querySelector('#rcHa'), cut = view.querySelector('#rcCut');
  if (ha) {
    ha.oninput = e => { S.ha = +e.target.value; view.querySelector('#rcHaV').textContent = '+' + S.ha + ' Elo'; };
    ha.onchange = () => { S.base = null; run(view); };
  }
  if (cut) {
    cut.oninput = e => { S.cut = +e.target.value; view.querySelector('#rcCutV').textContent = S.cut; };
    cut.onchange = () => { S.base = null; run(view); };
  }
  const cl = view.querySelector('#rcClear');
  if (cl) cl.onclick = () => { S.forced = {}; S.base = null; run(view); };
}

function run(view, skipSim) {
  if (!skipSim) {
    const o = { N: REPLAYS, homeAdv: S.ha, cut: S.cut, forced: S.forced };
    if (!S.base) S.base = simulate(S.lg, { ...o, forced: {} });
    S.sim = simulate(S.lg, o);
  }
  if (!S.sim) {
    view.innerHTML = '<button class="backbtn" onclick="location.hash=\'#/tools\'">&larr; Tools</button>' +
      '<p class="note">No rated clubs in this league yet, so there is nothing to project.</p>';
    return;
  }
  S.club ? screenClub(view) : screenLeague(view);
  view.scrollTop = 0;
}

export function render(view, data, ctx) {
  const seasons = (data.seasons || {}).leagues || {};
  const standings = (data.standings || {}).leagues || {};
  const schedule = (data.schedule || {}).fixtures || [];
  const leagues = Object.keys(standings).filter(k => seasons[k] && ctx.LEAGUES[k]);
  if (!leagues.length) {
    view.innerHTML = '<button class="backbtn" onclick="location.hash=\'#/tools\'">&larr; Tools</button>' +
      '<p class="note">Season Race has no league data right now. It returns as soon as ' +
      'the next standings refresh lands.</p>';
    return;
  }
  S = {
    seasons, standings, schedule, leagues,
    updated: (data.standings || {}).updated || new Date().toISOString(),
    oddsFor: ctx.oddsFor, clubById: ctx.club, crest: ctx.crest, LEAGUES: ctx.LEAGUES,
    lg: leagues.includes('mls') ? 'mls' : leagues[0],
    club: null, sim: null, base: null, forced: {}, drawer: false,
    ha: 65, cut: 0
  };
  S.cut = seasons[S.lg].cut;
  run(view);
}
