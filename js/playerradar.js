/* Player Radar screen — lazily imported by app.js on #/radar.

   The reference for this screen is driblab's physical radars, which are built
   on optical tracking data (high-speed runs, sprint distance). No US league
   sells that, so this uses the same chart grammar over the richest public
   per-player signal that exists here: American Soccer Analysis's goals-added,
   split into the six action types a player can add value through.

   Percentiles are computed here rather than baked into the JSON on purpose —
   the minutes floor is a live control, so the comparison pool has to be able
   to change underfoot. Everything downstream reads from poolFor().

   Self-contained by convention: bump_version.py only rewrites ?v= tokens in
   app.js, so a module that imported a sibling would serve that sibling stale
   forever. Keep this file importing nothing. */

const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* Position groups exist because the thin leagues cannot fill a pool on their
   own: NWSL fields 9 central midfielders over the minutes floor and USL Super
   League 4 attacking mids. A percentile against 4 peers is theatre. */
const GROUP = { CB: 'DEF', FB: 'DEF', DM: 'MID', CM: 'MID', AM: 'MID', W: 'ATT', ST: 'ATT' };
const POS_LABEL = {
  CB: 'centre-backs', FB: 'full-backs', DM: 'defensive mids', CM: 'central mids',
  AM: 'attacking mids', W: 'wingers', ST: 'strikers',
};
const GROUP_LABEL = { DEF: 'defenders', MID: 'midfielders', ATT: 'attackers' };
/* Singular forms: the bars caption reads "vs an average <one of these>", which
   the plural labels above turn into "an average centre-backs". */
const POS_ONE = {
  CB: 'centre-back', FB: 'full-back', DM: 'defensive mid', CM: 'central mid',
  AM: 'attacking mid', W: 'winger', ST: 'striker',
};
/* Below this many peers a percentile is noise, so the pool widens one step and
   the page says out loud that it did. */
const MIN_POOL = 20;

/* Metrics offered to the beeswarm and the scatter. The six g+ actions are
   added from the data file so the axis order stays defined in one place. */
const VOLUME = [
  { k: 'tot', label: 'Total g+ / 96', dp: 3 },
  { k: 'xg', label: 'xG / 96', dp: 3 },
  { k: 'xa', label: 'xA / 96', dp: 3 },
  { k: 'kp', label: 'Key passes / 96', dp: 2 },
  { k: 'shv', label: 'Shots / 96', dp: 2 },
  { k: 'gx', label: 'Goals − xG / 96', dp: 3 },
];

/* g+ above average is a season total in the file; per-96 happened at build
   time. 'tot' is the sum of the six actions. */
const valueOf = (p, k, acts) => k === 'tot' ? acts.reduce((a, x) => a + (p[x.key] || 0), 0) : (p[k] || 0);

/* Percentile with ties split down the middle, so a pool of identical zeroes
   lands everyone at 50 rather than at 0 or 100. */
function pctOf(sorted, v) {
  let below = 0, equal = 0;
  for (const x of sorted) { if (x < v) below++; else if (x === v) equal++; }
  return sorted.length ? ((below + equal / 2) / sorted.length) * 100 : 50;
}

/* ---- chart renderers ---------------------------------------------------- */

/* Radar: six axes, radius is percentile 0-100 against the pool. Rings at 25 /
   50 / 75 so "above the middle ring" reads as top quartile without counting. */
function radarSvg(series, acts) {
  const S = 420, C = S / 2, R = 148;
  const n = acts.length;
  const at = (i, r) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [C + Math.cos(a) * r, C + Math.sin(a) * r];
  };
  let g = '';
  for (const ring of [25, 50, 75, 100]) {
    const pts = acts.map((_, i) => at(i, (ring / 100) * R).map(v => v.toFixed(1)).join(',')).join(' ');
    g += `<polygon points="${pts}" class="pr-ring${ring === 100 ? ' pr-ring-out' : ''}"/>`;
  }
  acts.forEach((_, i) => {
    const [x, y] = at(i, R);
    g += `<line x1="${C}" y1="${C}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" class="pr-spoke"/>`;
  });
  /* Axis labels sit just outside the outer ring, anchored by which side of the
     circle they fall on so long words never overprint the shape. */
  acts.forEach((a, i) => {
    const [x, y] = at(i, R + 20);
    const anchor = Math.abs(x - C) < 6 ? 'middle' : x > C ? 'start' : 'end';
    g += `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="${anchor}" class="pr-axis">${esc(a.label)}</text>`;
  });
  for (const s of series) {
    const pts = s.pcts.map((p, i) => at(i, (Math.max(p, 0) / 100) * R).map(v => v.toFixed(1)).join(',')).join(' ');
    g += `<polygon points="${pts}" class="pr-poly ${s.cls}"/>`;
    s.pcts.forEach((p, i) => {
      const [x, y] = at(i, (Math.max(p, 0) / 100) * R);
      g += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.5" class="pr-node ${s.cls}"/>`;
    });
  }
  const label = series.map(s => s.label).join(' vs ');
  return `<svg class="pr-radar" viewBox="0 0 ${S} ${S}" role="img"
    aria-label="Radar of percentile rank across six goals-added action types for ${esc(label)}">${g}</svg>`;
}

/* Diverging bars: the actual signed g+ per 96, not a percentile. The radar
   says where a player ranks; this says how much they are actually worth, and
   which way. Zero is the neutral midpoint, position carries the polarity, so
   the two hues are redundant encoding rather than the only signal. */
function barsSvg(player, acts, span, cls) {
  const W = 660, ROW = 34, PADL = 132, PADR = 74;
  const H = acts.length * ROW + 24;
  const mid = PADL + (W - PADL - PADR) / 2;
  const half = (W - PADL - PADR) / 2;
  const x = v => mid + Math.max(-1, Math.min(1, v / span)) * half;
  let g = `<line x1="${mid}" y1="6" x2="${mid}" y2="${H - 18}" class="pr-zero"/>`;
  acts.forEach((a, i) => {
    const v = player[a.key] || 0;
    const y = 10 + i * ROW;
    const x0 = Math.min(mid, x(v)), w = Math.abs(x(v) - mid);
    g += `<text x="${PADL - 12}" y="${y + 15}" text-anchor="end" class="pr-blabel">${esc(a.label)}</text>`;
    /* 4px rounded end on the data side only: a rect rounded at both ends reads
       as a pill floating free of the baseline it is measured from. */
    g += `<rect x="${x0.toFixed(1)}" y="${y}" width="${Math.max(w, 1.5).toFixed(1)}" height="20" rx="3"
      class="pr-bar ${v >= 0 ? 'pr-pos' : 'pr-neg'}"/>`;
    g += `<text x="${(v >= 0 ? x(v) + 8 : x(v) - 8).toFixed(1)}" y="${y + 15}"
      text-anchor="${v >= 0 ? 'start' : 'end'}" class="pr-bval">${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(3)}</text>`;
  });
  g += `<text x="${mid}" y="${H - 4}" text-anchor="middle" class="pr-axis">goals added per 96 min vs an average ${esc(POS_ONE[player.p] || 'player')}</text>`;
  return `<svg class="pr-bars ${cls}" viewBox="0 0 ${W} ${H}" role="img"
    aria-label="Goals added per 96 minutes by action type for ${esc(player.n)}">${g}</svg>`;
}

/* Beeswarm: every peer as a dot on one axis, the selected player pulled out.
   Dots are binned on x and stacked alternately above and below the line, which
   is the cheap beeswarm — good enough at these pool sizes and stable, where a
   force simulation would jitter on every re-render. */
function swarmSvg(pool, sel, key, acts, label) {
  const W = 660, H = 132, PAD = 26, MIDY = 62, DOT = 4.2;
  const vals = pool.map(p => valueOf(p, key, acts));
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = (hi - lo) || 1;
  const x = v => PAD + ((v - lo) / span) * (W - PAD * 2);
  const bins = new Map();
  let g = `<line x1="${PAD}" y1="${MIDY}" x2="${W - PAD}" y2="${MIDY}" class="pr-zero"/>`;
  const selId = sel && sel.id;
  let selMark = '';
  pool.forEach(p => {
    const v = valueOf(p, key, acts);
    const px = x(v);
    const b = Math.round(px / (DOT * 2));
    const k = bins.get(b) || 0;
    bins.set(b, k + 1);
    /* 0, +1, -1, +2, -2 … so the swarm grows evenly around the axis */
    const step = Math.ceil(k / 2) * (k % 2 ? 1 : -1);
    const py = MIDY + step * (DOT * 2 + 0.6);
    if (p.id === selId) {
      selMark = `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="7.5" class="pr-swarm-sel" data-id="${esc(p.id)}"/>`;
    } else {
      g += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${DOT}" class="pr-swarm" data-id="${esc(p.id)}"/>`;
    }
  });
  g += selMark;
  g += `<text x="${PAD}" y="${H - 6}" class="pr-axis">${vals.length ? lo.toFixed(2) : ''}</text>`
     + `<text x="${W - PAD}" y="${H - 6}" text-anchor="end" class="pr-axis">${vals.length ? hi.toFixed(2) : ''}</text>`
     + `<text x="${W / 2}" y="${H - 6}" text-anchor="middle" class="pr-axis">${esc(label)} →</text>`;
  return `<svg class="pr-swarm-svg" viewBox="0 0 ${W} ${H}" role="img"
    aria-label="Distribution of ${esc(label)} across ${vals.length} comparable players, with the selected player highlighted">${g}</svg>`;
}

/* Scatter: two metrics at once, the pool as context and the selection pulled
   out. Quadrant lines sit at the pool medians, which is what makes a corner
   mean something. */
function scatterSvg(pool, sel, kx, ky, acts, lx, ly) {
  const W = 660, H = 420, L = 58, R = 18, T = 18, B = 46;
  const xs = pool.map(p => valueOf(p, kx, acts)), ys = pool.map(p => valueOf(p, ky, acts));
  const ext = a => { const lo = Math.min(...a), hi = Math.max(...a); const pad = ((hi - lo) || 1) * 0.06; return [lo - pad, hi + pad]; };
  const [x0, x1] = ext(xs), [y0, y1] = ext(ys);
  const X = v => L + ((v - x0) / (x1 - x0)) * (W - L - R);
  const Y = v => H - B - ((v - y0) / (y1 - y0)) * (H - T - B);
  const med = a => { const s = a.slice().sort((m, n) => m - n); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
  const mx = med(xs), my = med(ys);
  let g = `<rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" class="pr-plot"/>`
        + `<line x1="${X(mx).toFixed(1)}" y1="${T}" x2="${X(mx).toFixed(1)}" y2="${H - B}" class="pr-med"/>`
        + `<line x1="${L}" y1="${Y(my).toFixed(1)}" x2="${W - R}" y2="${Y(my).toFixed(1)}" class="pr-med"/>`;
  const selId = sel && sel.id;
  let selMark = '';
  pool.forEach(p => {
    const px = X(valueOf(p, kx, acts)), py = Y(valueOf(p, ky, acts));
    if (p.id === selId) {
      selMark = `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="7.5" class="pr-swarm-sel" data-id="${esc(p.id)}"/>`
        + `<text x="${px.toFixed(1)}" y="${(py - 13).toFixed(1)}" text-anchor="middle" class="pr-point-label">${esc(p.n)}</text>`;
    } else {
      g += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3.6" class="pr-swarm" data-id="${esc(p.id)}"/>`;
    }
  });
  g += selMark;
  g += `<text x="${(L + (W - L - R) / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="pr-axis">${esc(lx)} →</text>`
     + `<text transform="translate(15 ${(T + (H - T - B) / 2).toFixed(1)}) rotate(-90)" text-anchor="middle" class="pr-axis">${esc(ly)} →</text>`
     + `<text x="${L + 6}" y="${T + 14}" class="pr-quad">median lines split the pool in four</text>`;
  return `<svg class="pr-scatter" viewBox="0 0 ${W} ${H}" role="img"
    aria-label="Scatter of ${esc(lx)} against ${esc(ly)} for ${pool.length} comparable players">${g}</svg>`;
}

/* ---- screen ------------------------------------------------------------- */

export function render(view, data) {
  const acts = data.actions;                       // [{label, key}] × 6
  const METRICS = [VOLUME[0], ...acts.map(a => ({ k: a.key, label: a.label + ' g+ / 96', dp: 3 })), ...VOLUME.slice(1)];
  const lgKeys = Object.keys(data.leagues);
  const st = { lg: lgKeys[0], id: null, cmp: null, floor: data.min_minutes, scope: 'auto',
               swarm: 'tot', sx: 'xg', sy: 'xa' };

  const $ = id => view.querySelector('#pr-' + id);
  const league = () => data.leagues[st.lg];
  const players = () => league().players.slice().sort((a, b) => a.n.localeCompare(b.n));
  const find = id => league().players.find(p => p.id === id) || null;

  /* The pool every percentile on the page is measured against. Widening is
     one step at a time and always reported, never silent. */
  function poolFor(p) {
    const eligible = league().players.filter(q => q.m >= st.floor);
    const byPos = eligible.filter(q => q.p === p.p);
    const byGrp = eligible.filter(q => GROUP[q.p] === GROUP[p.p]);
    if (st.scope === 'lg') return { pool: eligible, label: `all ${eligible.length} outfielders in the league`, widened: false };
    if (st.scope === 'grp') return { pool: byGrp, label: `${byGrp.length} ${GROUP_LABEL[GROUP[p.p]]}`, widened: false };
    if (st.scope === 'pos') return { pool: byPos, label: `${byPos.length} ${POS_LABEL[p.p]}`, widened: false };
    if (byPos.length >= MIN_POOL) return { pool: byPos, label: `${byPos.length} ${POS_LABEL[p.p]}`, widened: false };
    if (byGrp.length >= MIN_POOL) return { pool: byGrp, label: `${byGrp.length} ${GROUP_LABEL[GROUP[p.p]]}`, widened: true };
    return { pool: eligible, label: `all ${eligible.length} outfielders in the league`, widened: true };
  }

  const pctsFor = (p, pool) => acts.map(a => {
    const sorted = pool.map(q => q[a.key] || 0).sort((m, n) => m - n);
    return pctOf(sorted, p[a.key] || 0);
  });

  view.innerHTML = `
    <button class="backbtn" onclick="location.hash='#/tools'">&larr; Tools</button>
    <div class="kicker">Six pro leagues &middot; 2,046 players</div>
    <h2 class="disp">Player Radar</h2>
    <p class="note">Where a player's value comes from, measured against the players they are
      actually competing with. Each axis is one of the six ways
      <b>goals added</b> credits a player &mdash; and the radar is a percentile, so 90 means
      better than 90% of the comparison pool, not a score out of 100.
      <b>Outfield only:</b> goalkeepers are modelled through a different set of actions
      entirely, so they are not on here.</p>

    <div class="sh-ctrls">
      <label class="cch-f"><span>League</span><select id="pr-lg">
        ${lgKeys.map(k => `<option value="${k}">${esc(data.leagues[k].label)}</option>`).join('')}
      </select></label>
      <label class="cch-f cch-wide"><span>Player</span><select id="pr-p"></select></label>
      <label class="cch-f cch-wide"><span>Compare with</span><select id="pr-cmp"></select></label>
      <label class="cch-f"><span>Compare against</span><select id="pr-scope">
        <option value="auto">Same position (auto-widen)</option>
        <option value="pos">Same position only</option>
        <option value="grp">Position group</option>
        <option value="lg">Whole league</option>
      </select></label>
      <label class="cch-f"><span>Minutes floor: <b id="pr-floorv"></b></span>
        <input id="pr-floor" type="range" min="${data.min_minutes}" max="1500" step="50"></label>
    </div>

    <div id="pr-card"></div>
    <div class="pr-charts">
      <figure class="pr-fig"><figcaption class="kicker">Percentile radar</figcaption>
        <div id="pr-radarwrap"></div>
        <div class="sh-legend" id="pr-legend"></div></figure>
      <figure class="pr-fig"><figcaption class="kicker">What they are actually worth</figcaption>
        <div class="pr-scroll" id="pr-barswrap"></div></figure>
    </div>

    <figure class="pr-fig"><figcaption class="kicker">Against the pool</figcaption>
      <label class="cch-f cch-inline"><span>Metric</span><select id="pr-swarmk">
        ${METRICS.map(m => `<option value="${m.k}">${esc(m.label)}</option>`).join('')}
      </select></label>
      <div class="pr-scroll" id="pr-swarmwrap"></div></figure>

    <figure class="pr-fig"><figcaption class="kicker">Two at once</figcaption>
      <div class="sh-ctrls">
        <label class="cch-f"><span>Across</span><select id="pr-sx">
          ${METRICS.map(m => `<option value="${m.k}">${esc(m.label)}</option>`).join('')}</select></label>
        <label class="cch-f"><span>Up</span><select id="pr-sy">
          ${METRICS.map(m => `<option value="${m.k}">${esc(m.label)}</option>`).join('')}</select></label>
      </div>
      <div class="pr-scroll" id="pr-scatterwrap"></div></figure>

    <details class="sh-details"><summary>The same numbers as a table</summary>
      <div class="sh-tablewrap" id="pr-table"></div></details>

    <p class="note">Goals added (g+) from
      <a href="https://www.americansocceranalysis.com/" rel="noopener">American Soccer Analysis</a>.
      It values every action a player takes by how much it moved their team's chance of scoring
      and conceding, then reports it against an average player in the same position. Everything
      here is per 96 minutes and season-to-date. Small pools make percentiles jumpy &mdash; the
      pool size is stated on every view for that reason.
      <b>This is a season snapshot, not a scouting verdict.</b></p>
    <div class="pr-tip" id="pr-tip" role="status" aria-live="polite"></div>`;

  function fillPlayers() {
    const ps = players();
    const opt = p => `<option value="${p.id}">${esc(p.n)} — ${esc(p.t)} · ${esc(p.p)}</option>`;
    $('p').innerHTML = ps.map(opt).join('');
    $('cmp').innerHTML = '<option value="">— nobody —</option>' + ps.map(opt).join('');
    if (!ps.some(p => p.id === st.id)) st.id = ps.length ? ps[0].id : null;
    if (!ps.some(p => p.id === st.cmp)) st.cmp = null;
    $('p').value = st.id || '';
    $('cmp').value = st.cmp || '';
  }

  function draw() {
    const p = find(st.id);
    if (!p) return;
    const { pool, label, widened } = poolFor(p);
    const cmp = st.cmp ? find(st.cmp) : null;
    const pcts = pctsFor(p, pool);
    const totSorted = pool.map(q => valueOf(q, 'tot', acts)).sort((m, n) => m - n);
    const totPct = pctOf(totSorted, valueOf(p, 'tot', acts));

    $('card').innerHTML = `
      <div class="pr-card">
        <div class="pr-who">
          <b>${esc(p.n)}</b>
          <span>${esc(p.t)} &middot; ${esc(POS_LABEL[p.p] || p.p)} &middot; ${p.m.toLocaleString()} min &middot; ${p.g}G ${p.a}A</span>
        </div>
        <div class="pr-hero">
          <b>${Math.round(totPct)}</b>
          <span>percentile<br>total g+ / 96</span>
        </div>
      </div>
      <p class="note${widened ? ' cch-warn' : ''}">Compared against ${esc(label)} with at least
        ${st.floor.toLocaleString()} minutes.${widened
          ? ` <b>Pool widened:</b> fewer than ${MIN_POOL} ${esc(POS_LABEL[p.p])} clear that floor in this
             league, so the comparison steps out one level rather than rank against a handful.`
          : ''}</p>`;

    const series = [{ label: p.n, cls: 'pr-a', pcts }];
    if (cmp) series.push({ label: cmp.n, cls: 'pr-b', pcts: pctsFor(cmp, poolFor(cmp).pool) });
    $('radarwrap').innerHTML = radarSvg(series, acts);
    /* One series needs no legend — the card above names them. Two always do. */
    $('legend').innerHTML = series.length < 2 ? '' : series.map(s =>
      `<span class="sh-grp"><span class="pr-swatch ${s.cls}"></span>${esc(s.label)}</span>`).join('');

    /* Bars share one symmetric scale across the pool so two players can be read
       against each other, and one loud action cannot flatten the other five. */
    const spread = pool.flatMap(q => acts.map(a => Math.abs(q[a.key] || 0))).sort((m, n) => m - n);
    const span = spread[Math.floor(spread.length * 0.98)] || 0.05;
    $('barswrap').innerHTML = barsSvg(p, acts, span, 'pr-a')
      + (cmp ? `<div class="pr-cmpbars"><div class="kicker">${esc(cmp.n)}</div>${barsSvg(cmp, acts, span, 'pr-b')}</div>` : '');

    const ml = k => (METRICS.find(m => m.k === k) || {}).label || k;
    $('swarmwrap').innerHTML = swarmSvg(pool, p, st.swarm, acts, ml(st.swarm));
    $('scatterwrap').innerHTML = scatterSvg(pool, p, st.sx, st.sy, acts, ml(st.sx), ml(st.sy));

    /* Table view: the accessible equivalent of the radar and the bars. */
    $('table').innerHTML = `<table class="sh-table"><thead><tr>
        <th>Action</th><th>g+ / 96</th><th>Percentile</th><th>Actions / 96</th>
        ${cmp ? `<th>${esc(cmp.n)} g+ / 96</th>` : ''}</tr></thead><tbody>`
      + acts.map((a, i) => `<tr><td>${esc(a.label)}</td>
          <td class="num">${(p[a.key] || 0) >= 0 ? '+' : '−'}${Math.abs(p[a.key] || 0).toFixed(3)}</td>
          <td class="num">${Math.round(pcts[i])}</td>
          <td class="num">${(p[a.key + 'c'] || 0).toFixed(1)}</td>
          ${cmp ? `<td class="num">${(cmp[a.key] || 0) >= 0 ? '+' : '−'}${Math.abs(cmp[a.key] || 0).toFixed(3)}</td>` : ''}</tr>`).join('')
      + `<tr><td><b>Total</b></td><td class="num"><b>${valueOf(p, 'tot', acts).toFixed(3)}</b></td>
          <td class="num"><b>${Math.round(totPct)}</b></td><td class="num">&mdash;</td>
          ${cmp ? `<td class="num"><b>${valueOf(cmp, 'tot', acts).toFixed(3)}</b></td>` : ''}</tr>`
      + `</tbody></table>`;

    hookTips(pool);
  }

  /* Hover/focus tooltips on the two cloud charts. Bound after each draw
     because the SVGs are replaced wholesale. */
  function hookTips(pool) {
    const byId = new Map(pool.map(q => [q.id, q]));
    view.querySelectorAll('#pr-swarmwrap circle[data-id], #pr-scatterwrap circle[data-id]').forEach(c => {
      const q = byId.get(c.dataset.id);
      if (!q) return;
      c.addEventListener('mousemove', e => tip(q, e));
      c.addEventListener('mouseleave', hideTip);
    });
  }
  function tip(q, e) {
    const t = $('tip');
    t.innerHTML = `<b>${esc(q.n)}</b><span class="k">${esc(q.t)} · ${esc(q.p)} · ${q.m} min</span>`;
    let x = e.clientX + 14, y = e.clientY + 14;
    if (x + 240 > innerWidth) x = e.clientX - 240;
    if (y + 90 > innerHeight) y = e.clientY - 90;
    t.style.left = x + 'px'; t.style.top = y + 'px'; t.style.opacity = 1;
  }
  const hideTip = () => { const t = $('tip'); if (t) t.style.opacity = 0; };

  const on = (id, ev, fn) => $(id).addEventListener(ev, fn);
  on('lg', 'change', e => { st.lg = e.target.value; fillPlayers(); draw(); });
  on('p', 'change', e => { st.id = e.target.value; draw(); });
  on('cmp', 'change', e => { st.cmp = e.target.value || null; draw(); });
  on('scope', 'change', e => { st.scope = e.target.value; draw(); });
  on('floor', 'input', e => { st.floor = +e.target.value; $('floorv').textContent = st.floor.toLocaleString(); draw(); });
  on('swarmk', 'change', e => { st.swarm = e.target.value; draw(); });
  on('sx', 'change', e => { st.sx = e.target.value; draw(); });
  on('sy', 'change', e => { st.sy = e.target.value; draw(); });

  $('floor').value = st.floor;
  $('floorv').textContent = st.floor.toLocaleString();
  $('swarmk').value = st.swarm; $('sx').value = st.sx; $('sy').value = st.sy;
  fillPlayers();
  draw();
}
