import { PROJ, USMAP } from './usmap.js';
import { CLUBS, REGIONS, LEAGUES, EURO_REFS, AFFIL, ROADMAP } from './data.js';
import { ROSTERS, COACHES, HONOURS } from './rosters.js';

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
  if (c.img) return `<img class="crest imgcrest" src="${c.img}" alt="${esc(c.n)} crest" loading="lazy">`;
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
    ${(() => {
      const f = favs();
      if (!f.clubs.length && !f.players.length) return '';
      return `<div class="kicker" style="margin-top:10px">Following</div><div class="chips">` +
        f.clubs.map(i => CLUBS[+i] ? `<a class="chip" href="#/club/${i}" style="text-decoration:none">&#9733; ${esc(CLUBS[+i].n)}</a>` : '').join('') +
        f.players.map(id => { const parts2 = id.split('/'); const c2 = CLUBS[+parts2[0]]; if (!c2) return '';
          const p2 = squadFor(c2)[+parts2[1]]; return p2 ? `<a class="chip" href="#/player/${id}" style="text-decoration:none">&#9733; ${p2.name}</a>` : ''; }).join('') + `</div>`;
    })()}
    <p class="note">Tap a state to zoom in. Tap a pin for the club.</p>`;
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
    ${clubs.length ? renderMapSvg(visible(clubs)) : ''}
    ${clubs.length ? leagueChips() : ''}
    <div class="kicker" style="margin-top:10px">${clubs.length ? `Clubs · ${clubs.length}` : 'No clubs mapped yet'}</div>
    <ul class="clublist" id="statelist">${ranked.map((c, i) => clubRow(c, i + 1)).join('')}${concepts.map(c => clubRow(c)).join('')}</ul>
    ${clubs.length ? '' : '<p class="note">This is where league expansion starts — the dataset grows as leagues are added.</p>'}`;
  wireSexToggle();
  if (clubs.length) {
    wireMap([st]);
    const chips = view.querySelector('#lgchips');
    if (chips) chips.addEventListener('click', e => {
      if (!e.target.closest('.chip')) return;
      const r2 = clubs.filter(c => c.r && leagueFilter.has(c.g)).sort((a, b) => b.r - a.r);
      const c2 = clubs.filter(c => !c.r && leagueFilter.has(c.g));
      view.querySelector('#statelist').innerHTML = r2.map((c, i) => clubRow(c, i + 1)).join('') + c2.map(c => clubRow(c)).join('');
    });
  }
}

function playerRow(p, rank) {
  return `<li><a href="#/player/${CLUBS.indexOf(p.c)}/${p.i}">
    <span class="rk">${rank}</span>${crestHtml(p.c)}
    <span class="cl-name"><b>${p.name}</b><span>${p.pos} · ${esc(p.c.n)}</span></span>
    <span class="cl-rt">${p.pvr}</span></a></li>`;
}
function screenTable() {
  crumb.textContent = 'Table';
  const renderClubs = () => pool().filter(c => c.r && leagueFilter.has(c.g)).sort((a, b) => b.r - a.r)
    .slice(0, 40).map((c, i) => clubRow(c, i + 1)).join('');
  const renderPlayers = () => allPlayers(sex)
    .filter(p => leagueFilter.has(p.c.g) && (posFilter === 'all' || p.pos === posFilter))
    .sort((a, b) => b.pvr - a.pvr).slice(0, 40).map((p, i) => playerRow(p, i + 1)).join('');
  const render = () => tableMode === 'clubs' ? renderClubs() : renderPlayers();
  view.innerHTML = `
    ${sexToggle()}
    <div class="kicker">Cross-league · demo ratings</div>
    <h2 class="disp">The National Table</h2>
    <div class="chips seg" id="modeseg">
      <button class="chip solid" data-mode="clubs" aria-pressed="${tableMode === 'clubs'}">Clubs</button>
      <button class="chip solid" data-mode="players" aria-pressed="${tableMode === 'players'}">Players</button>
    </div>
    <div class="chips" id="poschips" style="display:${tableMode === 'players' ? 'flex' : 'none'}">${['all', 'GK', 'DF', 'MF', 'FW'].map(pp =>
      `<button class="chip solid" data-pos="${pp}" aria-pressed="${posFilter === pp}">${pp === 'all' ? 'All positions' : pp}</button>`).join('')}</div>
    ${leagueChips()}
    <ul class="clublist" id="tablelist">${render()}</ul>
    <p class="note">${tableMode === 'players'
      ? 'Player value ratings weight production by opposition strength — demo stats until verified reporting is live.'
      : "Ratings are illustrative until the results pipeline is live. Men's and women's tables are ranked separately."}</p>`;
  wireSexToggle();
  view.querySelector('#modeseg').addEventListener('click', e => {
    const b = e.target.closest('[data-mode]'); if (!b || b.dataset.mode === tableMode) return;
    tableMode = b.dataset.mode; screenTable();
  });
  view.querySelector('#poschips').addEventListener('click', e => {
    const b = e.target.closest('[data-pos]'); if (!b) return;
    posFilter = b.dataset.pos;
    view.querySelectorAll('#poschips .chip').forEach(x => x.setAttribute('aria-pressed', x.dataset.pos === posFilter));
    view.querySelector('#tablelist').innerHTML = render();
  });
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
    <div class="mrow"><a class="side" href="#/club/${CLUBS.indexOf(h)}">${esc(h.n)}</a><span class="vs">${when || 'NEUTRAL'}</span><a class="side away" href="#/club/${CLUBS.indexOf(a)}">${esc(a.n)}</a></div>
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

const MNAMES = ['Marcus','Diego','Jalen','Mateo','Ethan','Luis','Andre','Caleb','Santiago','Noah','Tyler','Rafael','Owen','Bryan','Ali','Emeka','Kofi','Jordan','Devin','Hugo','Tomas','Wes','Nico','Sam','Alexis','Victor','Trey','Milan','Ibrahim','Cole'];
const WNAMES = ['Alex','Sofia','Maya','Jess','Camila','Riley','Morgan','Ashley','Taylor','Kelsey','Lena','Bri','Naomi','Val','Grace','Emma','Sydney','Rose','Mal','Kika','Ella','Ava','Tori','Jade','Dani','Reese','Skye','Nina','Paige','Zoe'];
const LNAMES = ['Rivera','Johnson','Smith','Garcia','Martinez','Brown','Lee','Nguyen','Walker','Hernandez','Silva','Jones','Diaz','Thompson','Castro','Okafor','Kim','Lopez','Wright','Mensah','Ortiz','Reed','Vargas','King','Ramos','Bell','Torres','Hayes','Moreno','Price'];
const POSNS = ['GK','GK','GK','DF','DF','DF','DF','DF','DF','DF','DF','MF','MF','MF','MF','MF','MF','MF','FW','FW','FW','FW','FW','FW'];
function clubSeed(c) { let x = 0; for (const ch of c.n) x = (x * 31 + ch.charCodeAt(0)) % 233; return x; }
function genSquad(c) {
  const seed = clubSeed(c);
  const first = c.x === 'w' ? WNAMES : MNAMES;
  return POSNS.map((pos, i) => {
    const apps = 8 + ((seed + i * 37) % 15);
    const goals = pos === 'FW' ? (seed + i * 19) % 14 : pos === 'MF' ? (seed + i * 19) % 8 : pos === 'DF' ? (seed + i * 19) % 4 : 0;
    const assists = pos === 'GK' ? 0 : (seed + i * 23) % (pos === 'MF' ? 10 : 7);
    const saves = pos === 'GK' ? apps * (2 + (seed + i) % 3) : 0;
    const cs = pos === 'GK' ? Math.round(apps * (20 + (seed * (i + 1)) % 30) / 100) : 0;
    const pvr = Math.round((goals * 4 + assists * 3 + apps * 0.6 + cs * 2.5 + saves * 0.06) * (c.r / 1800) * 10) / 10;
    return {
      num: pos === 'GK' ? (i === 0 ? 1 : i === 1 ? 25 : 31) : i + 1,
      name: first[(seed * 7 + i * 13) % 30] + ' ' + LNAMES[(seed * 11 + i * 17) % 30],
      pos, age: 19 + ((seed + i * 29) % 15),
      apps, goals, assists, saves, cs,
      yc: (seed + i * 7) % 6, rc: ((seed + i * 11) % 17) === 0 ? 1 : 0,
      mins: apps * (62 + (seed + i) % 29), pvr,
      form: ((62 + ((seed * 3 + i * 41) % 33)) / 10).toFixed(1)
    };
  });
}
function genStaff(c) {
  const seed = clubSeed(c);
  const pool = c.x === 'w' ? WNAMES.concat(MNAMES) : MNAMES;
  return {
    hc: { name: pool[(seed * 13 + 5) % pool.length] + ' ' + LNAMES[(seed * 17 + 3) % 30], age: 41 + (seed % 22) },
    ac: { name: pool[(seed * 19 + 11) % pool.length] + ' ' + LNAMES[(seed * 23 + 7) % 30], age: 34 + ((seed * 3) % 20) }
  };
}
function pseed(nm) { let x = 0; for (const ch of nm) x = (x * 131 + ch.charCodeAt(0)) % 1009; return x; }
function statLine(pos, sd, c) {
  const apps = 8 + (sd % 15);
  const goals = pos === 'FW' ? sd % 14 : pos === 'MF' ? sd % 8 : pos === 'DF' ? sd % 4 : 0;
  const assists = pos === 'GK' ? 0 : (sd * 3) % (pos === 'MF' ? 10 : 7);
  const saves = pos === 'GK' ? apps * (2 + sd % 3) : 0;
  const cs = pos === 'GK' ? Math.round(apps * (20 + sd % 30) / 100) : 0;
  const pvr = Math.round((goals * 4 + assists * 3 + apps * 0.6 + cs * 2.5 + saves * 0.06) * (c.r / 1800) * 10) / 10;
  return { apps, goals, assists, saves, cs, pvr,
    yc: sd % 6, rc: (sd % 17) === 0 ? 1 : 0, mins: apps * (62 + sd % 29),
    form: ((62 + (sd * 3) % 33) / 10).toFixed(1) };
}
function squadFor(c) {
  const real = ROSTERS[c.n];
  if (!real) return genSquad(c);
  return real.map((rp, i) => ({
    ...statLine(rp.pos, pseed(rp.name), c),
    num: rp.num || i + 1, name: rp.name, pos: rp.pos,
    nat: rp.nat ? rp.nat.toUpperCase() : null, wiki: rp.wiki, real: true, age: null
  }));
}
function staffFor(c) {
  const real = COACHES[c.n];
  if (real) return [{ tag: 'HC', name: real.name, role: real.role, age: '' }];
  const g = genStaff(c);
  return [{ tag: 'HC', name: g.hc.name, role: 'Head Coach', age: g.hc.age },
          { tag: 'AC', name: g.ac.name, role: 'Assistant', age: g.ac.age }];
}
const favs = () => { try { return JSON.parse(localStorage.getItem('pyr-favs')) || { clubs: [], players: [] }; } catch { return { clubs: [], players: [] }; } };
function favToggle(type, id) {
  const f = favs(); const arr = f[type]; const i = arr.indexOf(id);
  if (i >= 0) arr.splice(i, 1); else arr.push(id);
  localStorage.setItem('pyr-favs', JSON.stringify(f)); return i < 0;
}
const isFav = (type, id) => favs()[type].includes(id);
function favBtn(type, id) {
  return `<button class="favbtn${isFav(type, id) ? ' on' : ''}" data-ft="${type}" data-fi="${id}">${isFav(type, id) ? '&#9733; Following' : '&#9734; Follow'}</button>`;
}
function wireFav() {
  view.querySelectorAll('.favbtn').forEach(b => b.addEventListener('click', () => {
    const on = favToggle(b.dataset.ft, b.dataset.fi);
    b.classList.toggle('on', on);
    b.innerHTML = on ? '&#9733; Following' : '&#9734; Follow';
  }));
}
let _pcache = {};
function allPlayers(sx) {
  if (_pcache[sx]) return _pcache[sx];
  const out = [];
  CLUBS.forEach(c => { if (c.x !== sx || !c.r) return; squadFor(c).forEach((pl, i) => out.push({ ...pl, c, i })); });
  return _pcache[sx] = out;
}
const PRO = new Set(['mls', 'uslc', 'usl1', 'mnp', 'nwsl', 'uslw']);
function verifyBadge(c) {
  if (ROSTERS[c.n]) return '<span class="badge v">Roster: live from Wikipedia, refreshed every 2 days · stats demo</span>';
  return PRO.has(c.g)
    ? '<span class="badge v">Stats: league match reports (demo)</span>'
    : '<span class="badge c">Stats: club-submitted, email-verified (demo)</span>';
}

function screenClub(idx) {
  const c = CLUBS[+idx];
  if (!c) return screenMap();
  crumb.textContent = c.st;
  const m = LEAGUES[c.g];
  const peers = CLUBS.filter(o => o.g === c.g && o.r).sort((a, b) => b.r - a.r);
  const rank = c.r ? peers.indexOf(c) + 1 : null;
  const natl = CLUBS.filter(o => o.x === c.x && o.r).sort((a, b) => b.r - a.r);
  const opps = neighbors(c, 7);
  let seed = 0; for (const ch of c.n) seed = (seed * 31 + ch.charCodeAt(0)) % 233;
  const PAST = ['JUL 19', 'JUL 12', 'JUL 5', 'JUN 28', 'JUN 21', 'JUN 14', 'JUN 7', 'MAY 31'];
  const history = c.r ? PAST.map((date, i) => {
    const o = opps[i % Math.min(opps.length, 5)];
    if (!o) return null;
    const home = i % 2 === 0;
    const od = home ? oddsFor(c, o) : oddsFor(o, c);
    const pWin = home ? od.pH : od.pA;
    const r2 = ((seed * 7 + i * 61) % 100) / 100;
    const wl = r2 < pWin * 0.85 ? 'W' : r2 < pWin * 0.85 + 0.22 ? 'D' : 'L';
    const uw = wl === 'W' && pWin < 0.42, bl = wl === 'L' && pWin > 0.62;
    const score = wl === 'W' ? (pWin > 0.6 ? '3–1' : '2–1') : wl === 'L' ? (pWin > 0.5 ? '1–2' : '0–2') : '1–1';
    const delta = wl === 'W' ? '+' + Math.round(24 * (1 - pWin)) : wl === 'L' ? '-' + Math.round(24 * pWin) : (pWin < 0.5 ? '+' : '-') + Math.round(Math.abs(0.5 - pWin) * 20);
    return { o, home, wl, uw, bl, score, delta, date, pWin };
  }).filter(Boolean) : [];
  view.innerHTML = `
    <button class="backbtn" onclick="history.length>1?history.back():location.hash='#/map'">&larr; Back</button>
    <div class="clubhead">${crestHtml(c)}
      <div><h2 class="disp" style="margin:0">${esc(c.n)}</h2>
      ${m.url ? `<a class="lgchip" href="${m.url}" target="_blank" rel="noopener" style="background:${m.color}">${m.img ? `<img class="lgimg" src="${m.img}" alt="">` : ''}${m.label} &nearr;</a>` : `<span class="lgchip" style="background:${m.color}">${m.label}</span>`}
      <span class="sub" style="margin-left:8px">${STATE_NAME[c.st] || c.st}</span></div>
    </div>
    ${favBtn('clubs', String(CLUBS.indexOf(c)))}
    ${(HONOURS[c.n] || []).length ? `<div class="kicker" style="margin-top:10px">Honours</div><ul class="honours">${(HONOURS[c.n] || []).map(h2 => `<li><b>${h2.t}</b><span>${h2.y.join(', ')}</span></li>`).join('')}</ul>` : ''}
    ${c.r ? `<div class="statgrid">
      <div class="stat"><b>${c.r}</b><span>Rating (demo)</span></div>
      <div class="stat"><b>#${rank}</b><span>${m.label}</span></div>
      <div class="stat"><b>#${natl.indexOf(c) + 1}</b><span>National (${c.x === 'w' ? "women's" : "men's"})</span></div>
    </div>
    <div class="kicker">Upcoming · demo fixtures</div>
    ${opps.slice(5, 7).map((o, i) => matchCard(i === 0 ? c : o, i === 0 ? o : c, i === 0 ? 'SAT JUL 26' : 'SAT AUG 2')).join('') || '<p class="note">No nearby opponents in the dataset yet.</p>'}
    <div class="kicker" style="margin-top:14px">Results · demo</div>
    <ul class="results">${history.map(h =>
      `<li class="${h.uw ? 'uw' : ''}${h.bl ? 'bl' : ''}"><span class="wl ${h.wl}">${h.wl}</span>
       <span class="res-opp">${h.score} ${h.home ? 'v' : '@'} ${esc(h.o.n)}
       ${h.uw ? '<span class="res-tag tag-uw">upset win — ' + (h.pWin * 100).toFixed(0) + '% to win</span>' : ''}
       ${h.bl ? '<span class="res-tag tag-bl">bad loss — ' + (h.pWin * 100).toFixed(0) + '% to win</span>' : ''}</span>
       <span class="res-delta">${h.date} · ${h.delta} Elo</span></li>`).join('')}</ul>
    <p class="note">Green rows are wins as the underdog; red rows are losses as the favorite — form versus expectation, the number a straight table hides.</p>
    <div class="kicker" style="margin-top:14px">Squad · demo roster</div>
    ${verifyBadge(c)}
    <ul class="squad staff">${staffFor(c).map(st2 =>
      `<li><span class="sq-num">${st2.tag}</span><span class="sq-name">${st2.name}</span><span class="sq-pos">${st2.role}</span><span class="sq-age">${st2.age}</span><span class="sq-form"></span></li>`).join('')}</ul>
    <ul class="squad">${squadFor(c).map((pl, pi) =>
      `<li><a href="#/player/${CLUBS.indexOf(c)}/${pi}"><span class="sq-num">${pl.num}</span><span class="sq-name">${pl.name}</span><span class="sq-pos">${pl.pos}</span><span class="sq-age">${pl.real ? (pl.nat || '') : ''}</span><span class="sq-ga">${pl.pos === 'GK' ? pl.cs + ' CS' : pl.goals + 'g ' + pl.assists + 'a'}</span><span class="sq-form">${pl.pvr}</span></a></li>`).join('')}</ul>
    <p class="note">Placeholder players — real rosters come from claimed clubs and league feeds.</p>
    ${worldLadder(c)}` : `<p class="note" style="font-size:.9rem">Expansion concept — not yet an active club. It appears on the map as a hollow pin.</p>`}
    ${(() => {
      const kids = AFFIL[c.n] || [];
      const parent = Object.entries(AFFIL).find(([, v]) => v.some(a => a.split(' · ')[0] === c.n));
      if (!kids.length && !parent) return '';
      const linkify = nm => {
        const base = nm.split(' · ')[0];
        const idx = CLUBS.findIndex(o => o.n === base);
        return idx >= 0 ? `<a href="#/club/${idx}">${nm}</a>` : nm;
      };
      return `<div class="kicker">Pathway</div><ul class="pathway">` +
        (parent ? `<li><span>Parent club</span><b>${linkify(parent[0])}</b></li>` : '') +
        kids.map(k => `<li><span>Second team</span><b>${linkify(k)}</b></li>`).join('') +
        `</ul><p class="note">The route a player climbs: second team to first team, tier to tier.</p>`;
    })()}
    <div class="kicker">Follow</div>
    <div class="linkrow">
      ${c.url ? `<a href="${c.url}" target="_blank" rel="noopener"><b>Official site</b></a>` : `<a href="${gsearch(c.n, 'official site')}" target="_blank" rel="noopener">Find website</a>`}
      <a href="${gsearch(c.n, 'instagram')}" target="_blank" rel="noopener">Instagram</a>
      <a href="${gsearch(c.n, 'twitter x')}" target="_blank" rel="noopener">X</a>
      <a href="${gsearch(c.n, 'tickets')}" target="_blank" rel="noopener">Tickets</a>
    </div>
    <a class="claim" href="mailto:jkientz@gmail.com?subject=${encodeURIComponent('Claim club: ' + c.n)}">Run this club? Claim this page</a>
    <p class="note">Claimed clubs manage their crest, links, roster and schedule.</p>`;
  wireFav();
}

function screenAbout() {
  crumb.textContent = 'About';
  view.innerHTML = `<div class="about">
    <div class="kicker">Concept</div>
    <h2 class="disp">One pyramid, one table</h2>
    <p>American soccer has no single place to see every club, how they rank, and how the levels connect. <b>Rank XI</b> maps all of it: MLS to the grassroots, with men's and women's tables ranked separately.</p>
    <p><b>How rankings work.</b> League results feed a weekly Elo rating. Cup competitions — Open Cup qualifying, the National Amateur Cup — are where leagues actually meet, and those matches calibrate the cross-league scale. Every rating change is published with the match that caused it.</p>
    <p><b>World context.</b> Each club page projects the club onto a hypothetical global ladder against European reference sides — a conversation-starter, clearly labeled, never presented as measurement.</p>
    <p><b>What's real in this demo.</b> All ${CLUBS.length} clubs and locations come from the project dataset. Ratings, records and fixtures are illustrative until the results pipeline is live.</p>
    <p><b>Roadmap.</b> Amateur league layers (UPSL, NPSL, USL League Two) from live feeds · claimed club pages · player profiles · clean crest art · youth club directory layer.</p>
    <div class="kicker" style="margin-top:14px">The leagues</div>
    <ul class="lglist">${Object.entries(LEAGUES).filter(([k, m]) => m.url).map(([k, m]) =>
      `<li><a href="${m.url}" target="_blank" rel="noopener">${m.img ? `<img src="${m.img}" alt="" loading="lazy">` : `<span class="dot" style="background:${m.color};width:12px;height:12px;border-radius:50%"></span>`}<b>${m.label}</b><span>${m.url.replace('https://', '').replace('www.', '')}</span></a></li>`).join('')}</ul>
    <div class="kicker" style="margin-top:14px">Coming layers</div>
    <ul class="lglist">${ROADMAP.map(r =>
      `<li><a href="${r.url}" target="_blank" rel="noopener"><span class="dot" style="background:var(--ink-dim);width:12px;height:12px;border-radius:50%;opacity:.4"></span><b>${r.label}</b><span>~${r.teams} teams · ${r.sex === 'w' ? "women's" : "men's"}</span></a></li>`).join('')}</ul>
    <p class="note">NISA is currently unsanctioned by U.S. Soccer (Dec 2024); its clubs are shown for completeness. UPSL layer holds the clubs mapped so far — the full league is 400+ clubs.</p>
    <p class="fine" style="font-size:.75rem">Concept by Jeremy Kientz · 2026</p>
  </div>`;
}

function screenPlayer(ci, pi) {
  const c = CLUBS[+ci]; if (!c || !c.r) return screenMap();
  const sq = squadFor(c); const pl = sq[+pi]; if (!pl) return screenClub(ci);
  crumb.textContent = c.st;
  const peers = allPlayers(c.x).filter(p => p.pos === pl.pos).sort((a, b) => b.pvr - a.pvr);
  const rank = peers.findIndex(p => p.c === c && p.i === +pi) + 1;
  view.innerHTML = `
    <button class="backbtn" onclick="history.length>1?history.back():location.hash='#/club/${ci}'">&larr; ${esc(c.n)}</button>
    <div class="clubhead">${crestHtml(c)}
      <div><h2 class="disp" style="margin:0">${pl.name}</h2>
      <span class="sub">#${pl.num} · ${pl.pos}${pl.real ? (pl.nat ? ' · ' + pl.nat : '') : ' · ' + pl.age + ' yrs'} · ${esc(c.n)}</span></div>
    </div>
    ${verifyBadge(c)}
    <div class="statgrid">
      <div class="stat"><b>${pl.pvr}</b><span>Value rating</span></div>
      <div class="stat"><b>#${rank}</b><span>${pl.pos} · ${c.x === 'w' ? "women's" : "men's"} pool</span></div>
      <div class="stat"><b>${pl.apps}</b><span>Appearances</span></div>
      ${pl.pos === 'GK'
        ? `<div class="stat"><b>${pl.cs}</b><span>Clean sheets</span></div>
           <div class="stat"><b>${pl.saves}</b><span>Saves</span></div>`
        : `<div class="stat"><b>${pl.goals}</b><span>Goals</span></div>
           <div class="stat"><b>${pl.assists}</b><span>Assists</span></div>`}
      <div class="stat"><b>${pl.mins.toLocaleString()}</b><span>Minutes</span></div>
    </div>
    <p class="note">Value rating weights goals, assists, minutes and keeper actions by the strength of the team's opposition (demo formula on demo stats). Cards: ${pl.yc} yellow${pl.rc ? ', 1 red' : ''}.</p>
    ${favBtn('players', ci + '/' + pi)}
    <div class="kicker" style="margin-top:10px">International</div>
    <p class="note">${pl.real
      ? `Nationality: <b>${pl.nat || 'unlisted'}</b>. National-team caps are tracked separately from club stats — pulled per player in the roster pipeline's next phase.`
      : `Demo player — international caps shown only for real rosters.`}</p>
    <div class="kicker" style="margin-top:10px">Links</div>
    <div class="linkrow">
      ${pl.wiki ? `<a href="${pl.wiki}" target="_blank" rel="noopener"><b>Wikipedia bio</b></a>` : ''}
      <a href="${gsearch(pl.name + ' ' + c.n, 'instagram')}" target="_blank" rel="noopener">Instagram</a>
      <a href="${gsearch(pl.name + ' ' + c.n, 'transfermarkt')}" target="_blank" rel="noopener">Transfermarkt</a>
    </div>
    <div class="fifaid"><span>FIFA Connect ID</span><b>USA-${String(1000 + (clubSeed(c) * 7) % 9000)}-${String(10000 + (clubSeed(c) * 31 + +pi * 977) % 90000)}</b><i>demo format — real IDs come from US Soccer registration data</i></div>
    <a class="claim" href="mailto:jkientz@gmail.com?subject=${encodeURIComponent('Player profile: ' + pl.name + ' (' + c.n + ')')}">Is this you? Claim your profile</a>
    <p class="note">Claimed player profiles add film links, verified stats history, and recruiting visibility.</p>`;
  wireFav();
}

let tableMode = 'clubs', posFilter = 'all';
/* ---- router ---- */
function route() {
  const h = location.hash || '#/map';
  const parts = h.slice(2).split('/');
  document.querySelectorAll('.tabbar a').forEach(a => a.classList.toggle('active',
    a.dataset.tab === (['state', 'region', 'club', 'player'].includes(parts[0]) ? 'map' : parts[0])));
  view.scrollTop = 0;
  if (parts[0] === 'table') screenTable();
  else if (parts[0] === 'matches') screenMatches();
  else if (parts[0] === 'about') screenAbout();
  else if (parts[0] === 'state') screenState(parts[1]);
  else if (parts[0] === 'region') screenRegion(parts[1]);
  else if (parts[0] === 'club') screenClub(parts[1]);
  else if (parts[0] === 'player') screenPlayer(parts[1], parts[2]);
  else screenMap();
}
addEventListener('hashchange', route);
route();
