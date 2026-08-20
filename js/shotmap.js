/* Shot Maps screen — lazily imported by app.js on #/shots.
   Ported from the standalone shots.html. The one substantive change: the old
   page read --home/--away out of getComputedStyle once at load and baked the
   hex into every SVG attribute, so it could never follow a theme change. Marks
   here carry classes instead and take their colour from css/app.css, which
   means the map re-themes with the rest of the app for free. */

const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* Pitch is drawn 115 x 75 yards at 10 units per yard. */
const L = 1150, W = 750, YD = 10;

function pitchMarkings() {
  const s = 'class="sh-line" fill="none"';
  let p = `<rect x="0" y="0" width="${L}" height="${W}" class="sh-line sh-edge" fill="none"/>`;
  p += `<line x1="${L / 2}" y1="0" x2="${L / 2}" y2="${W}" class="sh-line"/>`;
  p += `<circle cx="${L / 2}" cy="${W / 2}" r="${10 * YD}" ${s}/>`;
  p += `<circle cx="${L / 2}" cy="${W / 2}" r="4" class="sh-spot"/>`;
  for (const left of [true, false]) {
    const x0 = left ? 0 : L;
    const dir = left ? 1 : -1;
    /* penalty area 18 x 44, six-yard box 6 x 20, goal 8 wide */
    p += `<rect x="${left ? 0 : L - 18 * YD}" y="${(W - 44 * YD) / 2}" width="${18 * YD}" height="${44 * YD}" ${s}/>`;
    p += `<rect x="${left ? 0 : L - 6 * YD}" y="${(W - 20 * YD) / 2}" width="${6 * YD}" height="${20 * YD}" ${s}/>`;
    p += `<circle cx="${x0 + dir * 12 * YD}" cy="${W / 2}" r="4" class="sh-spot"/>`;
    /* drawn just inside the touchline: outside the viewBox they clipped away */
    p += `<rect x="${left ? 0 : L - 9}" y="${(W - 8 * YD) / 2}" width="9" height="${8 * YD}" class="sh-line sh-goalframe" fill="none"/>`;
    /* penalty arc: the part of the 10yd circle outside the box */
    const sweep = left ? 1 : 0;
    const ax = x0 + dir * 18 * YD;
    const dy = Math.sqrt((10 * YD) ** 2 - (6 * YD) ** 2);
    p += `<path d="M ${ax} ${W / 2 - dy} A ${10 * YD} ${10 * YD} 0 0 ${sweep} ${ax} ${W / 2 + dy}" ${s}/>`;
  }
  return p;
}

/* Radius encodes xG by area, with a floor so a 0.02 chance is still clickable. */
const rOf = xg => 10 + Math.sqrt(Math.max(xg, 0)) * 36;

export function render(view) {
  const $ = id => view.querySelector('#sh-' + id);
  let SHOTS = [], TEAMS = [], GAMES = [];

  view.innerHTML = `
    <button class="backbtn" onclick="location.hash='#/tools'">&larr; Tools</button>
    <div class="kicker">Six pro leagues &middot; real shot data</div>
    <h2 class="disp">Where the chances actually came from</h2>
    <p class="note">Every shot in the match, placed where it was struck and sized by
      <b>expected goals</b> &mdash; the chance an average finisher scores from that spot.
      Filled circles are goals. A team can win the shot count and lose the map.
      <b>Pro leagues only:</b> these are real logged shot locations, so the amateur and youth
      pyramid isn't here &mdash; we don't have shot data for those, and we'd rather show nothing
      than draw something we guessed.</p>

    <div class="sh-ctrls">
      <label class="cch-f"><span>League</span><select id="sh-lg">
        <option value="mls">MLS</option><option value="nwsl">NWSL</option>
        <option value="uslc">USL Championship</option><option value="usl1">USL League One</option>
        <option value="mlsnp">MLS Next Pro</option><option value="usls">USL Super League</option>
      </select></label>
      <label class="cch-f cch-wide"><span>Match</span><select id="sh-gm"><option>Loading&hellip;</option></select></label>
    </div>

    <div class="sh-score" id="sh-score"></div>
    <div class="sh-pitchwrap"><svg class="sh-pitch" id="sh-pitch" viewBox="0 0 ${L} ${W}" role="img"
      aria-label="Shot map: every shot placed on the pitch, sized by expected goals"></svg></div>
    <div class="sh-legend" id="sh-legend"></div>

    <div class="kicker" style="margin-top:14px">Totals</div>
    <div class="sh-tablewrap" id="sh-totals"></div>
    <details class="sh-details"><summary>Every shot as a table</summary>
      <div class="sh-tablewrap" id="sh-table"></div></details>

    <p class="note">Shot locations, expected goals and post-shot expected goals from American Soccer
      Analysis. Expected goals estimates the scoring chance of a shot from its location and type.
      Post-shot xG additionally accounts for where the shot ended up, so it only exists for shots
      on target.</p>
    <div class="sh-tip" id="sh-tip" role="status" aria-live="polite"></div>`;

  function draw() {
    const svg = $('pitch');
    if (!SHOTS.length) { svg.innerHTML = pitchMarkings(); return; }
    /* Home attacks right, away attacks left — so the two teams' chances sit at
       opposite ends, the way you'd watch the match. ASA normalises every shot to
       attacking-right, so the away side is rotated 180°. */
    const rows = SHOTS.map((s, i) => {
      const isHome = s.team === TEAMS[0].id;
      const x = isHome ? (s.x / 100) * L : L - (s.x / 100) * L;
      const y = isHome ? (s.y / 100) * W : W - (s.y / 100) * W;
      const side = isHome ? 'sh-home' : 'sh-away';
      const r = rOf(s.xg);
      const goal = s.goal && !s.ownGoal;
      const cls = `${side} ${goal ? 'sh-goal' : 'sh-shot'}${s.blocked ? ' sh-blocked' : ''}`;
      const label = `${s.player}, ${s.minute}' — ${goal ? 'goal' : 'shot'}, ${s.xg.toFixed(2)} expected goals`;
      return `<g class="sh-mark" tabindex="0" role="listitem" data-i="${i}" aria-label="${esc(label)}">`
           + `<circle cx="${x}" cy="${y}" r="${r + 3}" fill="transparent"/>`
           + `<circle cx="${x}" cy="${y}" r="${r}" class="${cls}"/></g>`;
    }).join('');
    svg.innerHTML = pitchMarkings() + `<g role="list">` + rows + `</g>`;
    svg.querySelectorAll('.sh-mark').forEach(g => {
      g.addEventListener('mouseenter', e => tip(SHOTS[+g.dataset.i], e));
      g.addEventListener('mousemove', e => tip(SHOTS[+g.dataset.i], e));
      g.addEventListener('mouseleave', hideTip);
      g.addEventListener('focus', () => {
        const b = g.getBoundingClientRect();
        tip(SHOTS[+g.dataset.i], { clientX: b.left + b.width / 2, clientY: b.top });
      });
      g.addEventListener('blur', hideTip);
    });
  }

  function tip(s, e) {
    const t = $('tip');
    const kind = s.ownGoal ? 'Own goal' : s.goal ? 'Goal' : s.blocked ? 'Blocked' : s.psxg > 0 ? 'On target' : 'Off target';
    t.innerHTML = `<b>${esc(s.player)}</b>`
      + `<span class="k">${esc(s.teamName)} · ${s.minute}'</span><br>`
      + `${kind}${s.yards ? ' · ' + s.yards.toFixed(0) + ' yds' : ''}<br>`
      + `<span class="k">xG</span> ${s.xg.toFixed(2)}`
      + (s.psxg ? ` · <span class="k">PSxG</span> ${s.psxg.toFixed(2)}` : '')
      + (s.head ? '<br><span class="k">Header</span>' : '')
      + (s.pattern && s.pattern !== 'Regular' ? `<br><span class="k">${esc(s.pattern)}</span>` : '')
      + (s.assist ? `<br><span class="k">Assist</span> ${esc(s.assist)}` : '');
    const pad = 14;
    let x = e.clientX + pad, y = e.clientY + pad;
    if (x + 240 > innerWidth) x = e.clientX - 240;
    if (y + 130 > innerHeight) y = e.clientY - 130;
    t.style.left = x + 'px'; t.style.top = y + 'px'; t.style.opacity = 1;
  }
  const hideTip = () => { const t = $('tip'); if (t) t.style.opacity = 0; };

  function legend() {
    if (!TEAMS.length) { $('legend').innerHTML = ''; return; }
    const dot = c => `<span class="sh-swatch ${c}"></span>`;
    const ball = cls => `<svg width="20" height="20" aria-hidden="true"><circle cx="10" cy="10" r="7" class="sh-home ${cls}"/></svg>`;
    $('legend').innerHTML =
        `<span class="sh-grp">${dot('sh-home')} ${esc(TEAMS[0].name)} <span class="cch-dim">attacking right</span></span>`
      + `<span class="sh-grp">${dot('sh-away')} ${esc(TEAMS[1].name)} <span class="cch-dim">attacking left</span></span>`
      + `<span class="sh-grp">${ball('sh-goal')} Goal</span>`
      + `<span class="sh-grp">${ball('sh-shot')} Shot</span>`
      + `<span class="sh-grp">${ball('sh-shot sh-blocked')} Blocked</span>`
      + `<span class="sh-grp">`
        + [0.05, 0.25, 0.75].map(v => {
            const r = rOf(v) / 3;
            return `<svg width="${r * 2 + 4}" height="30" aria-hidden="true"><circle cx="${r + 2}" cy="15" r="${r}" class="sh-ramp"/></svg>`;
          }).join('')
        + `&nbsp;low &rarr; high xG</span>`;
  }

  function totals() {
    if (!TEAMS.length) { $('totals').innerHTML = ''; $('table').innerHTML = ''; return; }
    const agg = TEAMS.map((t, i) => {
      const s = SHOTS.filter(x => x.team === t.id);
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

    /* Full table view — the accessible equivalent of the map. */
    const rows = SHOTS.slice().sort((a, b) => a.minute - b.minute).map(s => `<tr>`
      + `<td class="num">${s.minute}'</td><td>${esc(s.player)}</td><td>${esc(s.teamName)}</td>`
      + `<td>${s.ownGoal ? 'Own goal' : s.goal ? 'Goal' : s.blocked ? 'Blocked' : s.psxg > 0 ? 'On target' : 'Off target'}</td>`
      + `<td class="num">${s.yards ? s.yards.toFixed(0) : '—'}</td>`
      + `<td class="num">${s.xg.toFixed(2)}</td></tr>`).join('');
    $('table').innerHTML = `<table class="sh-table"><thead><tr><th>Min</th><th>Player</th><th>Team</th>`
      + `<th>Outcome</th><th>Yards</th><th>xG</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  /* Every fetch re-checks the hash before painting: the API is slow enough that
     a user can route away mid-request, and a late response must not overwrite
     whatever screen they landed on. */
  const stillHere = () => location.hash.startsWith('#/shots');

  async function loadGames() {
    const lg = $('lg').value;
    $('gm').innerHTML = '<option>Loading…</option>';
    SHOTS = []; TEAMS = []; draw(); legend(); totals();
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
      /* ASA gives team ids on shots but not which side was home; match on name. */
      const ids = [...new Set(SHOTS.map(s => s.team))];
      const byName = {};
      SHOTS.forEach(s => byName[s.team] = s.teamName);
      const homeId = ids.find(i => byName[i] === g.home) ?? ids[0];
      const awayId = ids.find(i => i !== homeId) ?? ids[1];
      TEAMS = [
        { id: homeId, name: byName[homeId] || g.home },
        { id: awayId, name: byName[awayId] || g.away },
      ];
      $('score').innerHTML =
          `<span class="sh-side"><span class="sh-swatch sh-home"></span>${esc(g.home)}</span>`
        + `<span class="sh-nums">${g.hs}–${g.as}</span>`
        + `<span class="sh-side"><span class="sh-swatch sh-away"></span>${esc(g.away)}</span>`
        + `<span class="cch-dim">${esc(g.date.slice(0, 10))} · ${SHOTS.length} shots</span>`;
      draw(); legend(); totals();
    } catch (e) {
      if (!stillHere()) return;
      $('score').innerHTML = '<span class="cch-dim">Shot data is unavailable for this match.</span>';
      SHOTS = []; TEAMS = []; draw(); legend(); totals();
    }
  }

  $('lg').addEventListener('change', loadGames);
  $('gm').addEventListener('change', loadShots);
  draw();
  loadGames();
}
