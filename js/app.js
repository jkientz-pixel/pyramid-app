import { PROJ, USMAP } from './usmap.js';
import { CLUBS, REGIONS, LEAGUES, EURO_REFS } from './data.js';

const view = document.getElementById('view');
const crumb = document.getElementById('crumb');
const REGION_LABEL = { northwest:'Northwest', southwest:'Southwest', midwest:'Midwest', south:'South', southeast:'Southeast', northeast:'Northeast' };
const STATE_NAME = { AL:'Alabama',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',DC:'Washington DC',FL:'Florida',GA:'Georgia',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming' };

let sex = 'm';
const leaguesFor = s => Object.keys(LEAGUES).filter(k => LEAGUES[k].sex === s);
let leagueFilter = new Set(leaguesFor(sex));

function XY(lat, lon) {
  const f = lat * Math.PI / 180, l = lon * Math.PI / 180;
  const rho = Math.sqrt(PROJ.C - 2 * PROJ.n * Math.sin(f)) / PROJ.n;
  const th = PROJ.n * (l - PROJ.l0);
  return [(rho * Math.sin(th) - PROJ.minx) * PROJ.s + PROJ.ox,
          (PROJ.maxy - (PROJ.r0 - rho * Math.cos(th))) * PROJ.s + PROJ.oy];
}

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const initials = n => n.split(/\s+/).filter(w => /^[A-Za-z]/.test(w)).slice(0, 2).map(w => w[0].toUpperCase()).join('') || 'FC';
const gsearch = (n, extra) => `https://www.google.com/search?q=${encodeURIComponent(n + ' soccer ' + extra)}`;
const dist2 = (a, b) => (a.la - b.la) ** 2 + (a.lo - b.lo) ** 2;
const pool = () => CLUBS.filter(c => c.x === sex);
const visible = clubs => clubs.filter(c => leagueFilter.has(c.g));

function crestHtml(c) {
  return `<span class="crest" style="background:${LEAGUES[c.g].color}">${initials(c.n)}</span>`;
}

function sexToggle() {
  return `<div class="chips seg" id="sexseg">
    <button class="chip solid" data-sex="m" aria-pressed="${sex === 'm'}">Men's game</button>
    <button class="chip solid" data-sex="w" aria-pressed="${sex === 'w'}">Women's game</button>
  </div>`;
}

function wireSexToggle() {
  const seg = view.querySelector('#sexseg');
  if (!seg) return;
  seg.addEventListener('click', e => {
    const b = e.target.closest('[data-sex]'); if (!b) return;
    if (b.dataset.sex === sex) return;
    sex = b.dataset.sex;
    leagueFilter = new Set(leaguesFor(sex));
    route();
  });
}

function leagueChips() {
  return `<div class="chips" id="lgchips">` + leaguesFor(sex).map(k => {
    const m = LEAGUES[k];
    return `<button class="chip" data-lg="${k}" aria-pressed="${leagueFilter.has(k)}">` +
      (m.hollow ? `<span class="dot" style="border:1.5px solid ${m.color};background:transparent"></span>` : `<span class="dot" style="background:${m.color}"></span>`) +
      `${m.label}</button>`;
  }).join('') + `</div>`;
}

function clubRow(c, rank) {
  const idx = CLUBS.indexOf(c);
  return `<li><a href="#/club/${idx}">` +
    (rank !== undefined ? `<span class="rk">${rank}</span>` : '') +
    crestHtml(c) +
    `<span class="cl-name"><b>${esc(c.n)}</b><span>${LEAGUES[c.g].label} · ${c.st}</span></span>` +
    (c.r ? `<span class="cl-rt">${c.r}</span>` : '<span class="cl-rt" style="color:var(--ink-dim)">—</span>') +
    `</a></li>`;
}

function renderMapSvg(clubs) {
  const pins = clubs.map(c => {
    const [x, y] = XY(c.la, c.lo);
    const m = LEAGUES[c.g], idx = CLUBS.indexOf(c);
    const base = `class="pin" data-idx="${idx}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${c.g === 'mls' ? 7 : c.g === 'loc' ? 4.5 : 5.5}"`;
    return m.hollow
      ? `<circle ${base} fill="none" stroke="${m.color}" stroke-width="1.6"><title>${esc(c.n)}</title></circle>`
      : `<circle ${base} fill="${m.color}" fill-opacity=".9"><title>${esc(c.n)}</title></circle>`;
  }).join('');
  return `<div class="mapbox"><svg class="usmap" viewBox="0 0 980 560" role="img" aria-label="US soccer club map">${USMAP}<g id="pins">${pins}</g></svg></div>`;
}

function zoomTo(svg, states) {
  if (!states) { svg.setAttribute('viewBox', '0 0 980 560'); return; }
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  svg.querySelectorAll('.states path').forEach(p => {
    const st = p.getAttribute('data-st');
    if (states.includes(st)) {
      const b = p.getBBox();
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + b.width); y1 = Math.max(y1, b.y + b.height);
      p.classList.remove('dim');
    } else p.classList.add('dim');
  });
  const pad = Math.max((x1 - x0), (y1 - y0)) * 0.08 + 6;
  svg.setAttribute('viewBox', `${(x0 - pad).toFixed(1)} ${(y0 - pad).toFixed(1)} ${(x1 - x0 + 2 * pad).toFixed(1)} ${(y1 - y0 + 2 * pad).toFixed(1)}`);
}

function wireMap(scopeStates) {
  const svg = view.querySelector('svg.usmap');
  if (!svg) return;
  svg.addEventListener('click', e => {
    const pin = e.target.closest('.pin');
    if (pin) { location.hash = `#/club/${pin.dataset.idx}`; return; }
    const st = e.target.closest('.states path');
    if (st && !st.classList.contains('dim')) location.hash = `#/state/${st.dataset.st}`;
  });
  if (scopeStates) zoomTo(svg, scopeStates);
  const chips = view.querySelector('#lgchips');
  if (chips) chips.addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b) return;
    const k = b.dataset.lg;
    leagueFilter.has(k) ? leagueFilter.delete(k) : leagueFilter.add(k);
    b.setAttribute('aria-pressed', leagueFilter.has(k));
    view.querySelectorAll('.pin').forEach(p => {
      p.style.display = leagueFilter.has(CLUBS[p.dataset.idx].g) ? '' : 'none';
    });
  });
}

/* ---- screens ---- */

function screenMap() {
  crumb.textContent = 'USA';
  const clubs = pool();
  view.innerHTML = `
    ${sexToggle()}
    <div class="kicker">National map · ${clubs.length} clubs</div>
    <div class="chips" id="regionchips">${['all', ...Object.keys(REGIONS)].map(r =>
      `<button class="chip solid" data-region="${r}" aria-pressed="${r === 'all'}">${r === 'all' ? 'All USA' : REGION_LABEL[r]}</button>`).join('')}</div>
    ${renderMapSvg(visible(clubs))}
    ${leagueChips()}
    <p class="note">Tap a state to zoom in. Tap a pin for the club. Hollow dots are expansion concepts.</p>`;
  wireSexToggle();
  wireMap(null);
  view.querySelector('#regionchips').addEventListener('click', e => {
    const b = e.target.closest('[data-region]'); if (!b) return;
    location.hash = b.dataset.region === 'all' ? '#/map' : `#/region/${b.dataset.region}`;
  });
}

function screenRegion(key) {
  const states = REGIONS[key];
  if (!states) return screenMap();
  crumb.textContent = REGION_LABEL[key];
  const clubs = pool().filter(c => states.includes(c.st));
  const ranked = visible(clubs).filter(c => c.r).sort((a, b) => b.r - a.r);
  view.innerHTML = `
    <button class="backbtn" onclick="location.hash='#/map'">&larr; All USA</button>
    ${sexToggle()}
    <div class="kicker">Region</div><h2 class="disp">${REGION_LABEL[key]}</h2>
    ${renderMapSvg(visible(clubs))}
    ${leagueChips()}
    <div class="kicker" style="margin-top:10px">Top clubs · ${clubs.length} in region</div>
    <ul class="clublist">${ranked.slice(0, 15).map((c, i) => clubRow(c, i + 1)).join('')}</ul>`;
  wireSexToggle();
  wireMap(states);
}

function screenState(st) {
  if (!STATE_NAME[st]) return screenMap();
  crumb.textContent = st;
  const clubs = pool().filter(c => c.st === st);
  const ranked = clubs.filter(c => c.r).sort((a, b) => b.r - a.r);
  const concepts = clubs.filter(c => !c.r);
  view.innerHTML = `
    <button class="backbtn" onclick="history.length>1?history.back():location.hash='#/map'">&larr; Back</button>
    ${sexToggle()}
    <div class="kicker">State</div><h2 class="disp">${STATE_NAME[st]}</h2>
    ${clubs.length ? renderMapSvg(clubs) : ''}
    <div class="kicker" style="margin-top:10px">${clubs.length ? `Clubs · ${clubs.length}` : 'No clubs mapped yet'}</div>
    <ul class="clublist">${ranked.map((c, i) => clubRow(c, i + 1)).join('')}${concepts.map(c => clubRow(c)).join('')}</ul>
    ${clubs.length ? '' : '<p class="note">This is where league expansion starts — the dataset grows as leagues are added.</p>'}`;
  wireSexToggle();
  if (clubs.length) wireMap([st]);
}

function screenTable() {
  crumb.textContent = 'Table';
  const render = () => pool().filter(c => c.r && leagueFilter.has(c.g)).sort((a, b) => b.r - a.r)
    .slice(0, 40).map((c, i) => clubRow(c, i + 1)).join('');
  view.innerHTML = `
    ${sexToggle()}
    <div class="kicker">Cross-league · demo ratings</div>
    <h2 class="disp">The National Table</h2>
    ${leagueChips()}
    <ul class="clublist" id="tablelist">${render()}</ul>
    <p class="note">Ratings are illustrative until the results pipeline is live. Men's and women's tables are ranked separately.</p>`;
  wireSexToggle();
  view.querySelector('#lgchips').addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b) return;
    const k = b.dataset.lg;
    leagueFilter.has(k) ? leagueFilter.delete(k) : leagueFilter.add(k);
    b.setAttribute('aria-pressed', leagueFilter.has(k));
    view.querySelector('#tablelist').innerHTML = render();
  });
}

function neighbors(c, count) {
  return CLUBS.filter(o => o !== c && o.g === c.g && o.r)
    .sort((a, b) => dist2(a, c) - dist2(b, c)).slice(0, count);
}

/* Elo gap -> Poisson expected goals -> scoreline + three-way odds */
const FACT = [1, 1, 2, 6, 24, 120, 720, 5040];
function oddsFor(h, a, homeAdv = 65) {
  const d = h.r + homeAdv - a.r;
  const lamH = 1.35 * Math.pow(10, d / 1000);
  const lamA = 1.35 * Math.pow(10, -d / 1000);
  const pois = (l, k) => Math.exp(-l) * Math.pow(l, k) / FACT[k];
  let pH = 0, pD = 0, pA = 0, best = [1, 1], bestP = 0;
  for (let i = 0; i <= 7; i++) for (let j = 0; j <= 7; j++) {
    const p = pois(lamH, i) * pois(lamA, j);
    if (i > j) pH += p; else if (i === j) pD += p; else pA += p;
    if (p > bestP) { bestP = p; best = [i, j]; }
  }
  return { pH, pD, pA, score: best };
}
const moneyline = p => p >= 0.5 ? '-' + Math.round(100 * p / (1 - p)) : '+' + Math.round(100 * (1 - p) / p);

function matchCard(h, a, when) {
  const o = oddsFor(h, a);
  return `<div class="match">
    <div class="mrow"><span class="side">${esc(h.n)}</span><span class="vs">${when || 'NEUTRAL'}</span><span class="side away">${esc(a.n)}</span></div>
    <div class="meta"><span>${LEAGUES[h.g].label}${h.g !== a.g ? ' v ' + LEAGUES[a.g].label : ''}</span><span>${h.st}${h.st !== a.st ? ' · ' + a.st : ''}</span></div>
    <div class="scoreline">${o.score[0]}–${o.score[1]}</div>
    <div class="meta" style="justify-content:center;margin-top:0"><span>most likely score</span></div>
    <div class="oddsrow">
      <div class="odds"><b>${(o.pH * 100).toFixed(0)}%</b><span>${esc(initials(h.n))} win · ${moneyline(o.pH)}</span></div>
      <div class="odds"><b>${(o.pD * 100).toFixed(0)}%</b><span>Draw · ${moneyline(o.pD)}</span></div>
      <div class="odds"><b>${(o.pA * 100).toFixed(0)}%</b><span>${esc(initials(a.n))} win · ${moneyline(o.pA)}</span></div>
    </div>
    <div class="prob"><i style="width:${(o.pH * 100).toFixed(0)}%;background:${LEAGUES[h.g].color}"></i><i style="width:${(o.pD * 100).toFixed(0)}%;background:var(--line)"></i><i style="flex:1;background:${LEAGUES[a.g].color};opacity:.55"></i></div>
    <div class="meta"><span>Elo ${h.r} v ${a.r}</span><span>home edge +65</span></div>
  </div>`;
}

function screenMatches() {
  crumb.textContent = 'Matches';
  const rated = pool().filter(c => c.r).sort((a, b) => b.r - a.r);
  const groups = leaguesFor(sex).filter(k => !LEAGUES[k].hollow && k !== 'mnp');
  const used = new Set(); const fixtures = [];
  groups.forEach(g => {
    const p = rated.filter(c => c.g === g);
    for (const home of p) {
      if (used.has(home) || fixtures.length >= 12) break;
      const opp = neighbors(home, 3).find(o => !used.has(o));
      if (!opp) continue;
      used.add(home); used.add(opp);
      fixtures.push([home, opp]);
    }
  });
  const opts = sel => rated.map(c => `<option value="${CLUBS.indexOf(c)}" ${c === sel ? 'selected' : ''}>${esc(c.n)} (${c.r})</option>`).join('');
  view.innerHTML = `
    ${sexToggle()}
    <div class="kicker">Any club v any club · demo odds</div>
    <h2 class="disp">Matchup Machine</h2>
    <div class="pickrow">
      <select id="pickH" aria-label="Home club">${opts(rated[0])}</select>
      <span class="vs">V</span>
      <select id="pickA" aria-label="Away club">${opts(rated[1])}</select>
    </div>
    <div id="pickout">${matchCard(rated[0], rated[1], 'HYPOTHETICAL')}</div>
    <div class="kicker" style="margin-top:18px">Demo fixtures · generated from geography</div>
    <h2 class="disp">This Weekend</h2>
    ${fixtures.map(([h, a], i) => matchCard(h, a, `SAT ${i % 2 ? '5:00' : '7:30'} PM`)).join('')}
    <p class="note">Odds from Elo gap via Poisson expected goals, home edge +65. Demo ratings — production uses live results. Predictions, not betting advice.</p>`;
  wireSexToggle();
  const redo = () => {
    const h = CLUBS[+view.querySelector('#pickH').value];
    const a = CLUBS[+view.querySelector('#pickA').value];
    view.querySelector('#pickout').innerHTML = matchCard(h, a, 'HYPOTHETICAL');
  };
  view.querySelector('#pickH').addEventListener('change', redo);
  view.querySelector('#pickA').addEventListener('change', redo);
}

function worldLadder(c) {
  const refs = EURO_REFS[c.x];
  const rows = [...refs.map(([n, r]) => ({ n, r, ref: true })), { n: c.n, r: c.r, ref: false }]
    .sort((a, b) => b.r - a.r);
  const nearest = refs.reduce((best, cur) => Math.abs(cur[1] - c.r) < Math.abs(best[1] - c.r) ? cur : best);
  return `
    <div class="kicker" style="margin-top:14px">World context · hypothetical</div>
    <p class="note" style="margin:4px 0 8px">If the ratings shared one global scale, ${esc(c.n)} would rate around <b>${esc(nearest[0])}</b>.</p>
    <ul class="ladder">${rows.map(r =>
      `<li class="${r.ref ? '' : 'me'}"><span class="ln">${esc(r.n)}</span><span class="lr">${r.r}</span></li>`).join('')}</ul>
    <p class="note">Reference ratings are illustrative anchors, not measured values. Cross-continent comparison is a projection — nobody plays these games.</p>`;
}

function screenClub(idx) {
  const c = CLUBS[+idx];
  if (!c) return screenMap();
  crumb.textContent = c.st;
  const m = LEAGUES[c.g];
  const peers = CLUBS.filter(o => o.g === c.g && o.r).sort((a, b) => b.r - a.r);
  const rank = c.r ? peers.indexOf(c) + 1 : null;
  const natl = CLUBS.filter(o => o.x === c.x && o.r).sort((a, b) => b.r - a.r);
  const opps = neighbors(c, 5);
  let seed = 0; for (const ch of c.n) seed = (seed * 31 + ch.charCodeAt(0)) % 233;
  view.innerHTML = `
    <button class="backbtn" onclick="history.length>1?history.back():location.hash='#/map'">&larr; Back</button>
    <div class="clubhead">${crestHtml(c)}
      <div><h2 class="disp" style="margin:0">${esc(c.n)}</h2>
      <span class="lgchip" style="background:${m.color}">${m.label}</span>
      <span class="sub" style="margin-left:8px">${STATE_NAME[c.st] || c.st}</span></div>
    </div>
    ${c.r ? `<div class="statgrid">
      <div class="stat"><b>${c.r}</b><span>Rating (demo)</span></div>
      <div class="stat"><b>#${rank}</b><span>${m.label}</span></div>
      <div class="stat"><b>#${natl.indexOf(c) + 1}</b><span>National (${c.x === 'w' ? "women's" : "men's"})</span></div>
    </div>
    <div class="kicker">Last 5 · demo</div>
    <ul class="results">${opps.map((o, i) => {
      const roll = (seed + i * 47) % 10;
      const wl = roll < 5 ? 'W' : roll < 8 ? 'L' : 'D';
      const delta = wl === 'W' ? '+' + (8 + (seed + i) % 14) : wl === 'L' ? '-' + (6 + (seed + i) % 12) : '+2';
      return `<li><span class="wl ${wl}">${wl}</span><span class="res-opp">${wl === 'W' ? '2–1' : wl === 'L' ? '0–1' : '1–1'} v ${esc(o.n)}</span><span class="res-delta">${delta} Elo</span></li>`;
    }).join('')}</ul>
    ${worldLadder(c)}` : `<p class="note" style="font-size:.9rem">Expansion concept — not yet an active club. It appears on the map as a hollow pin.</p>`}
    <div class="kicker">Follow</div>
    <div class="linkrow">
      <a href="${gsearch(c.n, 'official site')}" target="_blank" rel="noopener">Website</a>
      <a href="${gsearch(c.n, 'instagram')}" target="_blank" rel="noopener">Instagram</a>
      <a href="${gsearch(c.n, 'twitter x')}" target="_blank" rel="noopener">X</a>
      <a href="${gsearch(c.n, 'tickets')}" target="_blank" rel="noopener">Tickets</a>
    </div>
    <a class="claim" href="mailto:jkientz@gmail.com?subject=${encodeURIComponent('Claim club: ' + c.n)}">Run this club? Claim this page</a>
    <p class="note">Claimed clubs manage their crest, links, roster and schedule.</p>`;
}

function screenAbout() {
  crumb.textContent = 'About';
  view.innerHTML = `<div class="about">
    <div class="kicker">Concept</div>
    <h2 class="disp">One pyramid, one table</h2>
    <p>American soccer has no single place to see every club, how they rank, and how the levels connect. <b>The Pyramid</b> maps all of it: MLS to the grassroots, with men's and women's tables ranked separately.</p>
    <p><b>How rankings work.</b> League results feed a weekly Elo rating. Cup competitions — Open Cup qualifying, the National Amateur Cup — are where leagues actually meet, and those matches calibrate the cross-league scale. Every rating change is published with the match that caused it.</p>
    <p><b>World context.</b> Each club page projects the club onto a hypothetical global ladder against European reference sides — a conversation-starter, clearly labeled, never presented as measurement.</p>
    <p><b>What's real in this demo.</b> All ${CLUBS.length} clubs and locations come from the project dataset. Ratings, records and fixtures are illustrative until the results pipeline is live.</p>
    <p><b>Roadmap.</b> Amateur league layers (UPSL, NPSL, USL League Two) from live feeds · claimed club pages · player profiles · clean crest art · youth club directory layer.</p>
    <p class="fine" style="font-size:.75rem">Concept by Jeremy Kientz · 2026</p>
  </div>`;
}

/* ---- router ---- */
function route() {
  const h = location.hash || '#/map';
  const parts = h.slice(2).split('/');
  document.querySelectorAll('.tabbar a').forEach(a => a.classList.toggle('active',
    a.dataset.tab === (['state', 'region', 'club'].includes(parts[0]) ? 'map' : parts[0])));
  view.scrollTop = 0;
  if (parts[0] === 'table') screenTable();
  else if (parts[0] === 'matches') screenMatches();
  else if (parts[0] === 'about') screenAbout();
  else if (parts[0] === 'state') screenState(parts[1]);
  else if (parts[0] === 'region') screenRegion(parts[1]);
  else if (parts[0] === 'club') screenClub(parts[1]);
  else screenMap();
}
addEventListener('hashchange', route);
route();
