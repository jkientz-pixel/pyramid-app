/* Post-match panel — the analytics under every final score.

   Three tiers, chosen by what data actually exists for the match:
     shots  — ASA logs every shot (six pro leagues): shot map, xG race, toggles
     box    — ESPN publishes a two-team box score (four pro leagues)
     result — score + Elo swing only (the rest of the pyramid)
   The result tier is the floor, not an error state: every rated match has an
   Elo movement, and that is the one number nobody else shows.

   Loaded on demand by app.js (results on #/matches and club pages, rows on
   #/wire) and by shotmap.js (#/shots), which shares the drawing code below so
   the standalone screen and the inline panel are the same map. */

export const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* app league key -> ASA league slug the /api/shots proxy allowlists */
export const ASA_SLUG = { mls: 'mls', uslc: 'uslc', usl1: 'usl1', mnp: 'mlsnp', nwsl: 'nwsl', uslw: 'usls' };
const SLUG_TO_LG = Object.fromEntries(Object.entries(ASA_SLUG).map(([k, v]) => [v, k]));
export const slugToLg = s => SLUG_TO_LG[s] || s;

/* ---- shot classification + filters -------------------------------------
   Every toggle group is a set of keys; a shot passes a group when its key for
   that group is not switched off. Groups are independent, so "away, headers,
   second half" is just three keys left on. `off` is the only state — a fresh
   panel has nothing off, and the URL form is the list of what's off. */
export const GROUPS = [
  { id: 'team', label: 'Team', keys: [['home', 'Home'], ['away', 'Away']] },
  { id: 'out', label: 'Outcome', keys: [['goal', 'Goal'], ['on', 'On target'], ['off', 'Off target'], ['blocked', 'Blocked']] },
  { id: 'half', label: 'Half', keys: [['h1', '1st'], ['h2', '2nd'], ['et', 'ET']] },
  { id: 'type', label: 'Play', keys: [['open', 'Open play'], ['set', 'Set piece'], ['fast', 'Fast break'], ['pen', 'Penalty']] },
  { id: 'body', label: 'Struck', keys: [['head', 'Header'], ['foot', 'Foot']] },
  { id: 'ast', label: 'Assist', keys: [['cross', 'Cross'], ['through', 'Through ball'], ['other', 'Other / none']] },
];
export const SIZES = [['xg', 'xG'], ['psxg', 'Post-shot xG']];

export function outcomeOf(s) {
  if (s.goal || s.ownGoal) return 'goal';
  if (s.blocked) return 'blocked';
  return s.psxg > 0 ? 'on' : 'off';
}
export function outcomeLabel(s) {
  return s.ownGoal ? 'Own goal' : { goal: 'Goal', blocked: 'Blocked', on: 'On target', off: 'Off target' }[outcomeOf(s)];
}
const halfOf = s => s.period > 2 ? 'et' : s.period === 2 ? 'h2' : s.period === 1 ? 'h1' : (s.minute > 45 ? 'h2' : 'h1');
const typeOf = s => {
  const p = String(s.pattern || 'Regular').toLowerCase();
  if (p === 'regular') return 'open';
  if (p === 'penalty') return 'pen';
  if (p === 'fastbreak' || p === 'fast break') return 'fast';
  return 'set';
};
const astOf = s => s.cross ? 'cross' : s.through ? 'through' : 'other';

export function keysOf(s, homeId) {
  return {
    team: s.team === homeId ? 'home' : 'away',
    out: outcomeOf(s), half: halfOf(s), type: typeOf(s),
    body: s.head ? 'head' : 'foot', ast: astOf(s),
  };
}
export function applyFilters(shots, off, homeId) {
  if (!off || !off.size) return shots.slice();
  return shots.filter(s => {
    const k = keysOf(s, homeId);
    return GROUPS.every(g => !off.has(k[g.id]));
  });
}
/* URL form: off=away,blocked,h1&size=psxg — short, readable, order-free */
export function encodeFilters(f) {
  const q = [];
  if (f.off && f.off.size) q.push('off=' + [...f.off].sort().join(','));
  if (f.size && f.size !== 'xg') q.push('size=' + f.size);
  return q.join('&');
}
export function decodeFilters(q) {
  const p = new URLSearchParams(q || '');
  const valid = new Set(GROUPS.flatMap(g => g.keys.map(k => k[0])));
  const off = new Set((p.get('off') || '').split(',').filter(k => valid.has(k)));
  const size = SIZES.some(s => s[0] === p.get('size')) ? p.get('size') : 'xg';
  return { off, size };
}

/* ---- pitch drawing (115 x 75 yards at 10 units per yard) ---------------- */
const L = 1150, W = 750, YD = 10;
export function pitchMarkings() {
  const s = 'class="sh-line" fill="none"';
  let p = `<rect x="0" y="0" width="${L}" height="${W}" class="sh-line sh-edge" fill="none"/>`;
  p += `<line x1="${L / 2}" y1="0" x2="${L / 2}" y2="${W}" class="sh-line"/>`;
  p += `<circle cx="${L / 2}" cy="${W / 2}" r="${10 * YD}" ${s}/>`;
  p += `<circle cx="${L / 2}" cy="${W / 2}" r="4" class="sh-spot"/>`;
  for (const left of [true, false]) {
    const x0 = left ? 0 : L;
    const dir = left ? 1 : -1;
    p += `<rect x="${left ? 0 : L - 18 * YD}" y="${(W - 44 * YD) / 2}" width="${18 * YD}" height="${44 * YD}" ${s}/>`;
    p += `<rect x="${left ? 0 : L - 6 * YD}" y="${(W - 20 * YD) / 2}" width="${6 * YD}" height="${20 * YD}" ${s}/>`;
    p += `<circle cx="${x0 + dir * 12 * YD}" cy="${W / 2}" r="4" class="sh-spot"/>`;
    p += `<rect x="${left ? 0 : L - 9}" y="${(W - 8 * YD) / 2}" width="9" height="${8 * YD}" class="sh-line sh-goalframe" fill="none"/>`;
    const sweep = left ? 1 : 0;
    const ax = x0 + dir * 18 * YD;
    const dy = Math.sqrt((10 * YD) ** 2 - (6 * YD) ** 2);
    p += `<path d="M ${ax} ${W / 2 - dy} A ${10 * YD} ${10 * YD} 0 0 ${sweep} ${ax} ${W / 2 + dy}" ${s}/>`;
  }
  return p;
}
/* Radius encodes the chosen measure by area, floored so a 0.02 is still clickable. */
export const rOf = v => 10 + Math.sqrt(Math.max(v || 0, 0)) * 36;
const measure = (s, size) => size === 'psxg' ? (s.psxg || 0) : s.xg;

/* ---- the shot panel: toggles + map + xG race + totals + table ------------
   `ids` is a prefix so several panels can live on one screen (a results list
   opens more than one). shotmap.js passes 'sh' to keep its historic ids. */
export function shotPanel(root, { shots, home, away, ids = 'sh', filters, onFilter, fullLink }) {
  const $ = id => root.querySelector('#' + ids + '-' + id);
  const f = { off: new Set(filters?.off || []), size: filters?.size || 'xg' };
  const pressed = k => !f.off.has(k);

  root.innerHTML = `
    <div class="sh-pitchwrap"><svg class="sh-pitch" id="${ids}-pitch" viewBox="0 0 ${L} ${W}" role="img"
      aria-label="Shot map: every shot placed on the pitch, sized by expected goals"></svg></div>
    <div class="sh-legend" id="${ids}-legend"></div>
    <div class="kicker" style="margin-top:12px">Filter the shots <span class="pm-count" id="${ids}-count"></span></div>
    <div class="pm-toggles" id="${ids}-toggles" role="group" aria-label="Filter the shots">
      ${GROUPS.map(g => `<div class="pm-tg"><span class="pm-tglabel">${g.label}</span>${g.keys.map(([k, label]) =>
        `<button type="button" class="chip pm-chip" data-key="${k}" aria-pressed="${pressed(k)}">${label}</button>`).join('')}</div>`).join('')}
      <div class="pm-tg"><span class="pm-tglabel">Size by</span>${SIZES.map(([k, label]) =>
        `<button type="button" class="chip pm-chip pm-size" data-size="${k}" aria-pressed="${f.size === k}">${label}</button>`).join('')}</div>
      <button type="button" class="chip pm-reset" id="${ids}-reset" hidden>Show all shots</button>
    </div>
    <div class="kicker" style="margin-top:14px">xG race</div>
    <div class="pm-racewrap"><svg class="pm-race" id="${ids}-race" viewBox="0 0 600 170" role="img"
      aria-label="Cumulative expected goals for each team through the match"></svg></div>
    <div class="kicker" style="margin-top:14px">Totals</div>
    <div class="sh-tablewrap" id="${ids}-totals"></div>
    <details class="sh-details"><summary>Every shot as a table</summary>
      <div class="sh-tablewrap" id="${ids}-table"></div></details>
    ${fullLink ? `<p class="note"><a class="pm-full" id="${ids}-full" href="${esc(fullLink)}">Open the full map &rarr;</a></p>` : ''}
    <p class="note">Shot locations, expected goals and post-shot expected goals from American Soccer
      Analysis. Expected goals estimates the scoring chance of a shot from its location and type. Post-shot
      xG additionally accounts for where the shot ended up, so it only exists for shots on target.</p>
    <div class="sh-tip" id="${ids}-tip" role="status" aria-live="polite"></div>`;

  let shown = [];
  const recompute = () => { shown = applyFilters(shots, f.off, home.id); };

  function draw() {
    const svg = $('pitch');
    if (!shots.length) { svg.innerHTML = pitchMarkings(); return; }
    const rows = shown.map(s => {
      const i = shots.indexOf(s);
      const isHome = s.team === home.id;
      const x = isHome ? (s.x / 100) * L : L - (s.x / 100) * L;
      const y = isHome ? (s.y / 100) * W : W - (s.y / 100) * W;
      const side = isHome ? 'sh-home' : 'sh-away';
      const r = rOf(measure(s, f.size));
      const goal = s.goal && !s.ownGoal;
      const cls = `${side} ${goal ? 'sh-goal' : 'sh-shot'}${s.blocked ? ' sh-blocked' : ''}`;
      const label = `${s.player}, ${s.minute}' — ${outcomeLabel(s).toLowerCase()}, ${s.xg.toFixed(2)} expected goals`;
      return `<g class="sh-mark" tabindex="0" role="listitem" data-i="${i}" aria-label="${esc(label)}">`
           + `<circle cx="${x}" cy="${y}" r="${r + 3}" fill="transparent"/>`
           + `<circle cx="${x}" cy="${y}" r="${r}" class="${cls}"/></g>`;
    }).join('');
    svg.innerHTML = pitchMarkings() + `<g role="list">${rows}</g>`;
    svg.querySelectorAll('.sh-mark').forEach(g => {
      const s = shots[+g.dataset.i];
      g.addEventListener('mouseenter', e => tip(s, e));
      g.addEventListener('mousemove', e => tip(s, e));
      g.addEventListener('mouseleave', hideTip);
      g.addEventListener('focus', () => {
        const b = g.getBoundingClientRect();
        tip(s, { clientX: b.left + b.width / 2, clientY: b.top });
      });
      g.addEventListener('blur', hideTip);
    });
  }

  function tip(s, e) {
    const t = $('tip');
    t.innerHTML = `<b>${esc(s.player)}</b>`
      + `<span class="k">${esc(s.teamName)} · ${s.minute}'</span><br>`
      + `${outcomeLabel(s)}${s.yards ? ' · ' + s.yards.toFixed(0) + ' yds' : ''}<br>`
      + `<span class="k">xG</span> ${s.xg.toFixed(2)}`
      + (s.psxg ? ` · <span class="k">PSxG</span> ${s.psxg.toFixed(2)}` : '')
      + (s.head ? '<br><span class="k">Header</span>' : '')
      + (s.pattern && s.pattern !== 'Regular' ? `<br><span class="k">${esc(s.pattern)}</span>` : '')
      + (s.assist ? `<br><span class="k">Assist</span> ${esc(s.assist)}${s.cross ? ' (cross)' : s.through ? ' (through ball)' : ''}` : '');
    const pad = 14;
    let x = e.clientX + pad, y = e.clientY + pad;
    if (x + 240 > innerWidth) x = e.clientX - 240;
    if (y + 130 > innerHeight) y = e.clientY - 130;
    t.style.left = x + 'px'; t.style.top = y + 'px'; t.style.opacity = 1;
  }
  const hideTip = () => { const t = $('tip'); if (t) t.style.opacity = 0; };

  function legend() {
    const dot = c => `<span class="sh-swatch ${c}"></span>`;
    const ball = cls => `<svg width="20" height="20" aria-hidden="true"><circle cx="10" cy="10" r="7" class="sh-home ${cls}"/></svg>`;
    $('legend').innerHTML =
        `<span class="sh-grp">${dot('sh-home')} ${esc(home.name)} <span class="cch-dim">attacking right</span></span>`
      + `<span class="sh-grp">${dot('sh-away')} ${esc(away.name)} <span class="cch-dim">attacking left</span></span>`
      + `<span class="sh-grp">${ball('sh-goal')} Goal</span>`
      + `<span class="sh-grp">${ball('sh-shot')} Shot</span>`
      + `<span class="sh-grp">${ball('sh-shot sh-blocked')} Blocked</span>`
      + `<span class="sh-grp">`
        + [0.05, 0.25, 0.75].map(v => {
            const r = rOf(v) / 3;
            return `<svg width="${r * 2 + 4}" height="30" aria-hidden="true"><circle cx="${r + 2}" cy="15" r="${r}" class="sh-ramp"/></svg>`;
          }).join('')
        + `&nbsp;low &rarr; high ${f.size === 'psxg' ? 'post-shot xG' : 'xG'}</span>`;
  }

  /* Cumulative xG by minute for each side, goals marked. Follows the filters,
     so "second half, away only" shows exactly that team's second-half build. */
  function race() {
    const svg = $('race');
    if (!shots.length) { svg.innerHTML = ''; return; }
    const maxMin = Math.max(90, ...shots.map(s => s.minute || 0)) + 1;
    const padL = 34, padR = 12, padT = 10, padB = 24, w = 600, h = 170;
    const series = [home, away].map((t, i) => {
      const mine = shown.filter(s => (s.team === home.id) === (i === 0)).sort((a, b) => a.minute - b.minute);
      let acc = 0;
      const pts = [{ m: 0, v: 0 }];
      mine.forEach(s => { acc += measure(s, f.size); pts.push({ m: s.minute, v: acc, goal: s.goal && !s.ownGoal, who: s.player }); });
      pts.push({ m: maxMin, v: acc });
      return { side: i === 0 ? 'sh-home' : 'sh-away', name: t.name, pts, total: acc };
    });
    const vmax = Math.max(0.5, ...series.map(s => s.total)) * 1.08;
    const X = m => padL + (m / maxMin) * (w - padL - padR);
    const Y = v => h - padB - (v / vmax) * (h - padT - padB);
    let out = '';
    /* grid: half-time + full-time + one mid y tick */
    for (const m of [45, 90]) out += `<line x1="${X(m)}" y1="${padT}" x2="${X(m)}" y2="${h - padB}" class="pm-grid"/>`;
    for (const v of [vmax / 2]) out += `<line x1="${padL}" y1="${Y(v)}" x2="${w - padR}" y2="${Y(v)}" class="pm-grid"/>`
      + `<text x="${padL - 6}" y="${Y(v) + 4}" class="pm-axis" text-anchor="end">${v.toFixed(1)}</text>`;
    out += `<text x="${padL - 6}" y="${Y(0) + 4}" class="pm-axis" text-anchor="end">0</text>`;
    out += `<text x="${X(45)}" y="${h - 6}" class="pm-axis" text-anchor="middle">HT</text>`
         + `<text x="${X(90)}" y="${h - 6}" class="pm-axis" text-anchor="middle">FT</text>`;
    series.forEach(s => {
      /* step line: xG arrives at the moment of the shot */
      let d = '';
      s.pts.forEach((p, i) => {
        if (i === 0) d += `M ${X(p.m)} ${Y(p.v)}`;
        else d += ` H ${X(p.m)} V ${Y(p.v)}`;
      });
      out += `<path d="${d}" class="pm-line ${s.side}" fill="none"/>`;
      s.pts.filter(p => p.goal).forEach(p =>
        out += `<circle cx="${X(p.m)}" cy="${Y(p.v)}" r="5" class="pm-goal ${s.side}"><title>${esc(p.who)} ${p.m}'</title></circle>`);
      out += `<text x="${w - padR}" y="${Y(s.total) - 4}" class="pm-lbl ${s.side}" text-anchor="end">${s.total.toFixed(2)}</text>`;
    });
    svg.innerHTML = out;
  }

  function totals() {
    const agg = [home, away].map((t, i) => {
      const s = shown.filter(x => x.team === t.id);
      const xg = s.reduce((a, b) => a + b.xg, 0);
      return {
        name: t.name, side: i === 0 ? 'sh-home' : 'sh-away',
        shots: s.length,
        goals: s.filter(x => x.goal && !x.ownGoal).length,
        ontarget: s.filter(x => x.psxg > 0).length,
        xg, per: s.length ? xg / s.length : 0,
        psxg: s.reduce((a, b) => a + (b.psxg || 0), 0),
      };
    });
    const row = (label, pick, dp) => `<tr><td>${label}</td>`
      + agg.map(a => `<td class="num">${dp === null ? pick(a) : pick(a).toFixed(dp)}</td>`).join('') + `</tr>`;
    $('totals').innerHTML = `<table class="sh-table"><thead><tr><th>Metric</th>`
      + agg.map(a => `<th><span class="sh-swatch ${a.side}"></span>${esc(a.name)}</th>`).join('')
      + `</tr></thead><tbody>`
      + row('Shots', a => a.shots, null)
      + row('On target', a => a.ontarget, null)
      + row('Goals', a => a.goals, null)
      + row('xG', a => a.xg, 2)
      + row('xG per shot', a => a.per, 2)
      + row('Post-shot xG', a => a.psxg, 2)
      + `</tbody></table>`;
    $('count').textContent = shown.length === shots.length
      ? `· ${shots.length} shots` : `· ${shown.length} of ${shots.length} shots`;
    const rows = shown.slice().sort((a, b) => a.minute - b.minute).map(s => `<tr>`
      + `<td class="num">${s.minute}'</td><td>${esc(s.player)}</td><td>${esc(s.teamName)}</td>`
      + `<td>${outcomeLabel(s)}</td>`
      + `<td class="num">${s.yards ? s.yards.toFixed(0) : '—'}</td>`
      + `<td class="num">${s.xg.toFixed(2)}</td></tr>`).join('');
    $('table').innerHTML = `<table class="sh-table"><thead><tr><th>Min</th><th>Player</th><th>Team</th>`
      + `<th>Outcome</th><th>Yards</th><th>xG</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function paint() {
    recompute();
    draw(); legend(); race(); totals();
    const reset = $('reset');
    if (reset) reset.hidden = !f.off.size && f.size === 'xg';
    const full = $('full');
    if (full && fullLink) { const q = encodeFilters(f); full.href = fullLink + (q ? '?' + q : ''); }
    if (onFilter) onFilter({ off: new Set(f.off), size: f.size });
  }

  $('toggles').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.key) {
      const k = b.dataset.key;
      if (f.off.has(k)) f.off.delete(k); else f.off.add(k);
      b.setAttribute('aria-pressed', String(!f.off.has(k)));
    } else if (b.dataset.size) {
      f.size = b.dataset.size;
      root.querySelectorAll('.pm-size').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.size === f.size)));
    } else if (b.id === ids + '-reset') {
      f.off.clear(); f.size = 'xg';
      root.querySelectorAll('.pm-chip[data-key]').forEach(x => x.setAttribute('aria-pressed', 'true'));
      root.querySelectorAll('.pm-size').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.size === 'xg')));
    } else return;
    paint();
  });

  paint();
  return { filters: () => ({ off: new Set(f.off), size: f.size }) };
}

/* ---- fetch + team pairing ------------------------------------------------
   ASA gives team ids on shots but not which side was home; pair on name
   against the names the caller already knows from the wire / box score. */
const normName = n => String(n || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/\b(fc|sc|cf|afc|cd|club|the)\b/g, '').replace(/[^a-z0-9]/g, '');
export async function fetchShots(lg, gid) {
  const slug = ASA_SLUG[lg] || lg;
  const r = await fetch(`/api/shots?league=${encodeURIComponent(slug)}&game_id=${encodeURIComponent(gid)}`);
  if (!r.ok) throw new Error('shots ' + r.status);
  const d = await r.json();
  return d.shots || [];
}
export function pairTeams(shots, homeName, awayName) {
  const ids = [...new Set(shots.map(s => s.team))];
  const byName = {};
  shots.forEach(s => byName[s.team] = s.teamName);
  const hn = normName(homeName), an = normName(awayName);
  const score = (id, n) => { const t = normName(byName[id]); return t === n ? 3 : (t && n && (t.includes(n) || n.includes(t))) ? 2 : (t.slice(0, 6) === n.slice(0, 6) ? 1 : 0); };
  let homeId = ids.find(i => score(i, hn) === 3) ?? ids.find(i => score(i, hn) >= 2) ?? ids.find(i => score(i, hn) >= 1);
  if (homeId == null) {
    const awayGuess = ids.find(i => score(i, an) >= 2);
    homeId = ids.find(i => i !== awayGuess) ?? ids[0];
  }
  const awayId = ids.find(i => i !== homeId) ?? ids[1];
  return {
    home: { id: homeId, name: byName[homeId] || homeName },
    away: { id: awayId, name: byName[awayId] || awayName },
  };
}

/* ---- the tiered panel ----------------------------------------------------
   ctx: { lg, date, t1, t2, s1, s2, gid?, dr?, ph?, gp?, box? }
     gid — ASA game id (wire_asa rows carry it)      -> shots tier
     box — ESPN box score row from match_stats.json  -> box tier
     dr  — home Elo delta from the results walk; ph — pre-match home expectancy
   `showBox` is false when the caller already drew the ESPN comparison above
   the panel (resultRow does), so the bars are not repeated. */
export const tierOf = ctx => ctx.gid ? 'shots' : ctx.box ? 'box' : 'result';
const TIER_LABEL = { shots: 'Shot map · xG · box score', box: 'Box score', result: 'Result · Elo' };

export function eloSwingHtml(ctx) {
  if (ctx.dr == null) return '';
  const dr = Math.round(ctx.dr);
  const ph = ctx.ph != null ? Math.round(ctx.ph * 100) : null;
  const sign = v => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v);
  const upset = ctx.gp >= 3 && ph != null && ((ctx.s1 > ctx.s2 && ph <= 35) || (ctx.s2 > ctx.s1 && ph >= 65));
  const w = Math.min(100, Math.abs(dr) * 4);
  return `<div class="pm-elo">
    <div class="pm-elorow"><span class="pm-eloside">${esc(ctx.t1)}</span>
      <b class="pm-elodelta ${dr > 0 ? 'up' : dr < 0 ? 'down' : ''}">${sign(dr)}</b>
      <span class="pm-elobar" aria-hidden="true"><i class="${dr >= 0 ? 'h' : 'a'}" style="width:${w}%"></i></span>
      <b class="pm-elodelta ${dr < 0 ? 'up' : dr > 0 ? 'down' : ''}">${sign(-dr)}</b>
      <span class="pm-eloside away">${esc(ctx.t2)}</span></div>
    <p class="note pm-elonote">${upset ? '<b class="wup">UPSET</b> · ' : ''}${ph != null
      ? `Before kick-off the model gave ${esc(ctx.t1)} a ${ph}% expectancy${ctx.lg === 'mls' ? ' (results-Elo, shown alongside the standings rating)' : ''}. `
      : ''}The score moved each side's rating by ${Math.abs(dr)} Elo${ctx.gp != null && ctx.gp < 3 ? ' — early-season, low weight' : ''}.</p>
  </div>`;
}

const STAT_ROWS = [['pos', 'Possession', '%'], ['sh', 'Shots'], ['sot', 'On target'], ['ck', 'Corners'],
  ['pa', 'Passes completed'], ['fl', 'Fouls'], ['off', 'Offsides'], ['yc', 'Yellow cards'], ['rc', 'Red cards'], ['sv', 'Saves']];
export function boxHtml(m, color) {
  const hs = m?.h?.s || {}, as = m?.a?.s || {};
  if (!Object.keys(hs).length || !Object.keys(as).length) return '';
  const rows = STAT_ROWS.filter(([k]) => hs[k] != null && as[k] != null).map(([k, label, unit]) => {
    const x = hs[k], y = as[k], tot = x + y || 1;
    const c = color || 'var(--accent)';
    const hc = x > y ? c : 'var(--line)', ac = y > x ? c : 'var(--line)';
    const fmt = v => `${v}${unit || ''}`;
    return `<div class="srow"><span class="sv-h${x > y ? ' lead' : ''}">${fmt(x)}</span><span class="sbar"><i style="width:${(x / tot * 100).toFixed(0)}%;background:${hc}"></i><i style="width:${(y / tot * 100).toFixed(0)}%;background:${ac}"></i></span><span class="sv-a${y > x ? ' lead' : ''}">${fmt(y)}</span><span class="slab">${label}</span></div>`;
  }).join('');
  return rows ? `<div class="statcmp">${rows}</div>` : '';
}

let _seq = 0;
export async function mountPostMatch(el, ctx, { showBox = true, color, stillHere, deferShots = false } = {}) {
  const tier = tierOf(ctx);
  const ids = 'pm' + (++_seq);
  const fullLink = ctx.gid ? `#/shots/${ASA_SLUG[ctx.lg] || ctx.lg}/${ctx.gid}` : '';
  el.innerHTML = `<div class="pm" data-tier="${tier}">
    <div class="pm-head"><span class="pm-tier pm-${tier}">${TIER_LABEL[tier]}</span>
      ${tier !== 'shots' ? `<span class="note pm-why">${tier === 'box'
        ? 'No shot-location data is logged for this league.'
        : 'Nobody logs shots or box scores for this league — the score and the rating move are the record.'}</span>` : ''}</div>
    ${eloSwingHtml(ctx)}
    ${showBox && ctx.box ? `<div class="kicker">Box score</div>${boxHtml(ctx.box, color)}` : ''}
    ${tier === 'shots' ? `<div class="pm-shots" id="${ids}-wrap"><p class="note">Loading shots&hellip;</p></div>` : ''}
  </div>`;
  if (tier !== 'shots') return;
  const wrap = el.querySelector('#' + ids + '-wrap');
  /* A row the screen opened by itself (a club page leads with its latest
     result) must not fire a network call the reader never asked for; the
     map is one tap away instead. Rows the reader opened load straight away. */
  if (deferShots) {
    wrap.innerHTML = `<button type="button" class="chip solid pm-load" aria-pressed="false">Load the shot map &amp; xG race</button>`;
    await new Promise(res => wrap.querySelector('.pm-load').addEventListener('click', res, { once: true }));
    if (stillHere && !stillHere()) return;
    wrap.innerHTML = '<p class="note">Loading shots&hellip;</p>';
  }
  try {
    const shots = await fetchShots(ctx.lg, ctx.gid);
    if (stillHere && !stillHere()) return;
    if (!shots.length) { wrap.innerHTML = '<p class="note">Shot data has not landed for this match yet — ASA posts it about a day after full time.</p>'; return; }
    const { home, away } = pairTeams(shots, ctx.t1, ctx.t2);
    shotPanel(wrap, { shots, home, away, ids, fullLink });
  } catch (e) {
    if (stillHere && !stillHere()) return;
    wrap.innerHTML = '<p class="note">Shot data is unavailable right now.</p>';
  }
}
