import { PROJ, PROJ_AK, PROJ_HI, USMAP, INSETS } from './usmap.js?v=20260809d';
import { CLUBS, REGIONS, LEAGUES, EURO_REFS, AFFIL, ROADMAP } from './data.js?v=20260809d';
/* rosters.js is ~79KB gzipped (a third of boot JS) but only club/player/roster
   views read it — imported on demand, idle-prefetched after first paint.
   On import failure the app still renders: empty ROSTERS degrades to the same
   "Roster unclaimed" state as clubs with no real roster. */
let ROSTERS = {}, COACHES = {}, HONOURS = {};
let _rostersReady = null;
const loadRosters = () => _rostersReady ||= import('./rosters.js?v=20260809d')
  .then(m => { ROSTERS = m.ROSTERS; COACHES = m.COACHES; HONOURS = m.HONOURS; })
  .catch(e => { _rostersReady = null; throw e; });

/* bump_version.py rewrites this token with every deploy, and every deploy
   ships freshly refreshed data — so the footer date derives from it instead
   of a hand-edited string that drifts stale */
const BUILDV = '20260809d';
const BUILD_DATE = new Date(+BUILDV.slice(0, 4), +BUILDV.slice(4, 6) - 1, +BUILDV.slice(6, 8))
  .toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

const view = document.getElementById('view');
const crumb = document.getElementById('crumb');
const PROV_NAME = { QC:'Quebec', ON:'Ontario', BC:'British Columbia' };
const REGION_LABEL = { northwest:'Northwest', southwest:'Southwest', midwest:'Midwest', south:'South', southeast:'Southeast', northeast:'Northeast' };
const STATE_NAME = { AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',DC:'Washington DC',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming' };

let sex = 'm';
const leaguesFor = s => Object.keys(LEAGUES).filter(k => LEAGUES[k].sex === s);
let leagueFilter = new Set(leaguesFor(sex));

function XY(lat, lon) {
  /* AK and HI live in inset boxes with their own Albers params */
  const P = (lat > 49.5 && lon < -129) ? PROJ_AK : (lat < 24.5 && lon < -154) ? PROJ_HI : PROJ;
  const f = lat * Math.PI / 180, l = lon * Math.PI / 180;
  const rho = Math.sqrt(P.C - 2 * P.n * Math.sin(f)) / P.n;
  const th = P.n * (l - P.l0);
  return [(rho * Math.sin(th) - P.minx) * P.s + P.ox,
          (P.maxy - (P.r0 - rho * Math.cos(th))) * P.s + P.oy];
}

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
// scraped urls (Wikidata P856, club socials) are third-party editable: only http(s) may reach an href
const safeHref = u => (/^https?:\/\//i.test(u || '') ? esc(u) : '#');
const CLUB_BY_ID = new Map(CLUBS.map((c, i) => [c.id, i]));
/* accepts a slug or a legacy numeric index; -1 when neither resolves */
const clubIdx = ref => CLUB_BY_ID.has(ref) ? CLUB_BY_ID.get(ref) : (/^\d+$/.test(String(ref)) && CLUBS[+ref] ? +ref : -1);
const clubHref = i => '#/club/' + (CLUBS[i] ? CLUBS[i].id : i);
/* one notice/report address, shared by legal, free-agent reporting, and claims */
const NOTICE_MAIL = 'hello@rankedxi.com';
const initials = n => n.split(/\s+/).filter(w => /^[A-Za-z]/.test(w)).slice(0, 2).map(w => w[0].toUpperCase()).join('') || 'FC';
const gsearch = (n, extra) => `https://www.google.com/search?q=${encodeURIComponent(n + ' soccer ' + extra)}`;
const dist2 = (a, b) => (a.la - b.la) ** 2 + (a.lo - b.lo) ** 2;
/* straight-line miles for Rivalry Radar tags — discovery framing, no dates */
const milesApart = (a, b) => {
  const dLat = a.la - b.la, dLon = (a.lo - b.lo) * Math.cos((a.la + b.la) / 2 * Math.PI / 180);
  return Math.max(1, Math.round(69 * Math.sqrt(dLat * dLat + dLon * dLon)));
};
const pool = () => CLUBS.filter(c => c.x === sex && !c.h);
const visible = clubs => clubs.filter(c => leagueFilter.has(c.g));

function reportLink(kind, what) {
  const subj = encodeURIComponent(`RankedXI ${kind}: ${what}`);
  const body = encodeURIComponent(`Page: ${location.hash}\nWhat's wrong / your suggestion:\n\n`);
  return `<a class="reportlink" href="mailto:hello@rankedxi.com?subject=${subj}&body=${body}">&#9873; See an error? Send us a note</a>
    <a class="reportlink" href="#/legal">Corrections &amp; removal requests</a>`;
}
/* crest-content generation: bump when crest PIXELS change under the same
   filename (e.g. a strip_crest_bg.py run) — crest URLs are cached immutable
   and cache-first, so only a new ?cv= reaches returning browsers */
const CRESTV = '2';
function crestHtml(c) {
  /* a failed crest load must degrade to the initials chip, never the
     browser's broken-image glyph with overflowing alt text */
  if (c.img) return `<img class="crest imgcrest" src="${c.img}?cv=${CRESTV}" alt="${esc(c.n)} crest" loading="lazy" onerror="this.outerHTML='<span class=&quot;crest&quot; style=&quot;background:${LEAGUES[c.g].color}&quot;>${initials(c.n)}</span>'">`;
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

function toggleLeague(k) {
  const all = new Set(leaguesFor(sex));
  if (leagueFilter.size === all.size) leagueFilter = new Set([k]);
  else if (leagueFilter.has(k) && leagueFilter.size === 1) leagueFilter = all;
  else {
    leagueFilter.has(k) ? leagueFilter.delete(k) : leagueFilter.add(k);
    if (!leagueFilter.size) leagueFilter = all;
  }
  route();
}
function leagueChips() {
  const groups = [['Professional', LEVELS.pro], ['Amateur', LEVELS.amateur], ['College', LEVELS.college], ['Youth', LEVELS.youth]];
  const chip = k => {
    const m = LEAGUES[k];
    return `<button class="chip" data-lg="${k}" aria-pressed="${leagueFilter.has(k)}">` +
      `<span class="dot" style="background:${m.color}"></span>${m.label}</button>`;
  };
  let html = `<div class="chips" id="lgchips">`;
  for (const [label, lgs] of groups) {
    const mine = leaguesFor(sex).filter(k => lgs.includes(k));
    if (!mine.length) continue;
    html += `<span class="chipgrp">${label}</span>` + mine.map(chip).join('');
  }
  return html + `</div>`;
}

function clubRow(c, rank) {
  const idx = CLUBS.indexOf(c);
  return `<li><a href="${clubHref(idx)}">` +
    (rank !== undefined ? `<span class="rk">${rank}</span>` : '') +
    crestHtml(c) +
    `<span class="cl-name"><b>${esc(c.n)}</b><span>${LEAGUES[c.g].label} · ${c.st}</span></span>` +
    (c.r ? `<span class="cl-rt">${c.r}</span>` : '<span class="cl-rt" style="color:var(--ink-dim)">—</span>') +
    `</a></li>`;
}

function renderMapSvg(clubs, useCrests) {
  const pins = clubs.map(c => {
    const [x, y] = XY(c.la, c.lo);
    const m = LEAGUES[c.g], idx = CLUBS.indexOf(c);
    if (useCrests && c.img) {
      return `<image class="pin" data-idx="${idx}" data-cx="${x.toFixed(1)}" data-cy="${y.toFixed(1)}" href="${c.img}?cv=${CRESTV}" x="${(x - 11).toFixed(1)}" y="${(y - 11).toFixed(1)}" width="22" height="22"></image>`;
    }
    const r0 = c.g === 'mls' ? 7 : (c.g === 'loc' || LEVELS.youth.includes(c.g)) ? 4.5 : 5.5;
    const base = `class="pin" data-idx="${idx}" data-r="${r0}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r0}"`;
    return m.hollow
      ? `<circle ${base} fill="none" stroke="${m.color}" stroke-width="1.6"></circle>`
      : `<circle ${base} fill="${m.color}" fill-opacity=".9"></circle>`;
  }).join('');
  return `<div class="mapbox"><svg class="usmap" viewBox="0 -20 980 580" role="img" aria-label="US and Canada soccer club map">${USMAP}${INSETS}<g id="pins">${pins}</g></svg>
    <div class="mapctl"><button data-z="in" aria-label="Zoom in">+</button><button data-z="out" aria-label="Zoom out">&minus;</button><button data-z="reset" aria-label="Reset zoom">&#8634;</button></div>
    <div class="maptip" hidden></div></div>`;
}

function zoomTo(svg, states) {
  const canada = svg.querySelector('.canada');
  if (canada) canada.classList.toggle('dim', !!states);
  if (!states) { svg.setAttribute('viewBox', '0 -20 980 580'); return; }
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
  let dragged = false;
  svg.addEventListener('click', e => {
    if (dragged) { dragged = false; return; }
    const pin = e.target.closest('.pin');
    if (pin) { location.hash = clubHref(+pin.dataset.idx); return; }
    const st = e.target.closest('.states path');
    if (st) location.hash = `#/state/${st.dataset.st}`;
  });
  if (scopeStates) zoomTo(svg, scopeStates);
  const homeVB = svg.getAttribute('viewBox').split(' ').map(Number);
  const getVB = () => svg.getAttribute('viewBox').split(' ').map(Number);
  function rescalePins(vbW) {
    const f = Math.max(0.12, vbW / 980);
    svg.querySelectorAll('circle.pin').forEach(c2 => c2.setAttribute('r', (+c2.dataset.r * f).toFixed(2)));
    svg.querySelectorAll('image.pin').forEach(im => {
      const sz = 22 * f;
      im.setAttribute('width', sz.toFixed(1)); im.setAttribute('height', sz.toFixed(1));
      im.setAttribute('x', (+im.dataset.cx - sz / 2).toFixed(1));
      im.setAttribute('y', (+im.dataset.cy - sz / 2).toFixed(1));
    });
  }
  /* every viewBox write clamps to the home extent so pan/pinch can never
     push the map out of the box — dragging past an edge stops at the edge */
  const clampAxis = (val, lo, hi) => hi < lo ? (lo + hi) / 2 : Math.min(Math.max(val, lo), hi);
  /* session view memory: returning to this screen restores the zoom/pan the
     user left instead of resetting to the screen's default framing */
  const memKey = 'rxi-vb:' + (location.hash || '#/map');
  const setVB = v => {
    const x = clampAxis(v[0], homeVB[0], homeVB[0] + homeVB[2] - v[2]);
    const y = clampAxis(v[1], homeVB[1], homeVB[1] + homeVB[3] - v[3]);
    svg.setAttribute('viewBox', [x, y, v[2], v[3]].map(n => n.toFixed(1)).join(' '));
    rescalePins(v[2]);
    try { sessionStorage.setItem(memKey, [x, y, v[2], v[3]].map(n => n.toFixed(1)).join(',')); } catch {}
  };
  rescalePins(homeVB[2]);
  try {
    const saved = (sessionStorage.getItem(memKey) || '').split(',').map(Number);
    if (saved.length === 4 && saved.every(isFinite) && saved[2] > 0 && saved[2] <= homeVB[2]) setVB(saved);
  } catch {}
  const tip = view.querySelector('.maptip');
  svg.addEventListener('pointerover', e => {
    const pin = e.target.closest('.pin'); if (!pin || !tip) return;
    const c2 = CLUBS[pin.dataset.idx]; if (!c2) return;
    tip.innerHTML = `<b>${esc(c2.n)}</b><span>${LEAGUES[c2.g].label}${c2.r ? ' · ' + c2.r : ''}${c2.acc === 'a' ? ' · ~approx location' : ''}</span>`;
    tip.hidden = false;
  });
  svg.addEventListener('pointermove', e => {
    if (!tip || tip.hidden) return;
    const wrap = svg.parentElement.getBoundingClientRect();
    tip.style.left = Math.min(e.clientX - wrap.left + 12, wrap.width - 170) + 'px';
    tip.style.top = (e.clientY - wrap.top - 8) + 'px';
  });
  svg.addEventListener('pointerout', e => { if (tip && !e.target.closest('.pin')) tip.hidden = true; });
  svg.addEventListener('pointerleave', () => { if (tip) tip.hidden = true; });
  /* on state/region screens, zooming out past the scoped extent exits to the
     national map (first zoom-out snaps to the scope frame, the next one leaves)
     so pinch/minus can always get back without the browser back button */
  function exitToNational() {
    try { sessionStorage.removeItem('rxi-vb:#/map'); } catch {}
    location.hash = '#/map';
  }
  function zoom(factor) {
    const [x, y, w, h] = getVB();
    const nw = w * factor, nh = h * factor;
    if (nw > homeVB[2]) {
      if (scopeStates && w >= homeVB[2] - 0.5) { exitToNational(); return; }
      setVB(homeVB); return;
    }
    if (nw < homeVB[2] / 24) return;
    setVB([x + (w - nw) / 2, y + (h - nh) / 2, nw, nh]);
  }
  const ctl = view.querySelector('.mapctl');
  if (ctl) ctl.addEventListener('click', e => {
    const b = e.target.closest('[data-z]'); if (!b) return;
    if (b.dataset.z === 'in') zoom(1 / 1.6);
    else if (b.dataset.z === 'out') zoom(1.6);
    else setVB(homeVB);
  });
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    zoom(e.deltaY > 0 ? 1.25 : 1 / 1.25);
  }, { passive: false });
  const ptrs = new Map();
  let gest = null;
  svg.addEventListener('pointerdown', e => {
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...ptrs.values()];
    if (pts.length === 1) gest = { mode: 'pan', x: e.clientX, y: e.clientY, vb: getVB() };
    else if (pts.length === 2) {
      const dx = pts[0].x - pts[1].x, dy = pts[0].y - pts[1].y;
      gest = { mode: 'pinch', d0: Math.hypot(dx, dy) || 1,
        mx: (pts[0].x + pts[1].x) / 2, my: (pts[0].y + pts[1].y) / 2, vb: getVB() };
    }
  });
  svg.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId) || !gest) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...ptrs.values()];
    const r = svg.getBoundingClientRect();
    if (gest.mode === 'pinch' && pts.length >= 2) {
      dragged = true;
      const dx = pts[0].x - pts[1].x, dy = pts[0].y - pts[1].y;
      /* exponent < 1 dampens pinch so a full-screen spread ≈ 2x, not 4x+ */
      let scale = Math.pow(gest.d0 / (Math.hypot(dx, dy) || 1), 0.55);
      let nw = gest.vb[2] * scale;
      if (nw > homeVB[2]) {
        /* pinch-out well past a scoped extent exits to the national map;
           1.15 threshold keeps an at-the-edge pinch from exiting by accident */
        if (scopeStates && !gest.exited && gest.vb[2] >= homeVB[2] - 0.5 && nw > homeVB[2] * 1.15) {
          gest.exited = true; exitToNational(); return;
        }
        scale = homeVB[2] / gest.vb[2];
      }
      if (nw < homeVB[2] / 24) scale = (homeVB[2] / 24) / gest.vb[2];
      nw = gest.vb[2] * scale;
      const nh = gest.vb[3] * scale;
      const fx = (gest.mx - r.left) / r.width, fy = (gest.my - r.top) / r.height;
      setVB([gest.vb[0] + gest.vb[2] * fx - nw * fx, gest.vb[1] + gest.vb[3] * fy - nh * fy, nw, nh]);
    } else if (gest.mode === 'pan' && pts.length === 1) {
      const dx = e.clientX - gest.x, dy = e.clientY - gest.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) dragged = true;
      if (!dragged) return;
      setVB([gest.vb[0] - dx * gest.vb[2] / r.width, gest.vb[1] - dy * gest.vb[3] / r.height, gest.vb[2], gest.vb[3]]);
    }
  });
  const endPtr = e => {
    ptrs.delete(e.pointerId);
    if (ptrs.size === 1) { const p1 = [...ptrs.values()][0]; gest = { mode: 'pan', x: p1.x, y: p1.y, vb: getVB() }; }
    else if (!ptrs.size) gest = null;
  };
  svg.addEventListener('pointerup', endPtr);
  svg.addEventListener('pointercancel', endPtr);
  const chips = view.querySelector('#lgchips');
  if (chips) chips.addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b) return;
    toggleLeague(b.dataset.lg);
  });
}

function wireSearch() {
  const q = document.querySelector('#q'), res = document.querySelector('#qres');
  if (!q) return;
  /* combobox semantics + roving arrow-key focus + polite result count so
     the picker works eyes-free (WCAG 4.1.2 / 2.1.1) */
  q.setAttribute('role', 'combobox');
  q.setAttribute('aria-expanded', 'false');
  q.setAttribute('aria-controls', 'qres');
  q.setAttribute('aria-autocomplete', 'list');
  const live = document.createElement('div');
  live.className = 'sr-only'; live.setAttribute('aria-live', 'polite');
  q.parentNode.appendChild(live);
  const setOpen = open => q.setAttribute('aria-expanded', String(open));
  q.addEventListener('input', () => {
    const term = q.value.trim().toLowerCase();
    if (term.length < 2) { res.hidden = true; setOpen(false); live.textContent = ''; return; }
    const clubs = CLUBS.map((c, i) => ({ c, i })).filter(o => !o.c.h)
      .filter(o => o.c.n.toLowerCase().includes(term)).slice(0, 7);
    const players = allPlayers('m').concat(allPlayers('w'))
      .filter(p => p.real && p.name.toLowerCase().includes(term)).slice(0, 5);
    if (!clubs.length && !players.length) { res.innerHTML = '<div class="qrow qnone">No matches</div>'; res.hidden = false; setOpen(true); live.textContent = 'No matches'; return; }
    res.innerHTML =
      clubs.map(o => `<a class="qrow" href="${clubHref(o.i)}">${crestHtml(o.c)}<span><b>${esc(o.c.n)}</b><i>${LEAGUES[o.c.g].label} · ${o.c.st}</i></span></a>`).join('') +
      players.map(p => `<a class="qrow" href="#/player/${p.c.id}/${p.i}"><img class="crest imgcrest" src="${AVATAR}" alt=""><span><b>${esc(p.name)}</b><i>${p.pos} · ${esc(p.c.n)}</i></span></a>`).join('');
    res.hidden = false; setOpen(true);
    const n = clubs.length + players.length;
    live.textContent = `${n} result${n === 1 ? '' : 's'} — press down arrow to browse`;
  });
  res.addEventListener('click', () => { res.hidden = true; setOpen(false); q.value = ''; });
  q.addEventListener('keydown', e => {
    if (e.key === 'Escape') { res.hidden = true; setOpen(false); q.blur(); }
    else if (e.key === 'ArrowDown' && !res.hidden) { const first = res.querySelector('a.qrow'); if (first) { e.preventDefault(); first.focus(); } }
  });
  res.addEventListener('keydown', e => {
    const rows = [...res.querySelectorAll('a.qrow')];
    const i = rows.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' && i > -1 && i < rows.length - 1) { e.preventDefault(); rows[i + 1].focus(); }
    else if (e.key === 'ArrowUp' && i > 0) { e.preventDefault(); rows[i - 1].focus(); }
    else if (e.key === 'ArrowUp' && i === 0) { e.preventDefault(); q.focus(); }
    else if (e.key === 'Escape') { res.hidden = true; setOpen(false); q.focus(); }
  });
}

/* ---- screens ---- */

const LEVELS = {
  all: null,
  pro: ['mls', 'uslc', 'usl1', 'mnp', 'nisa', 'nwsl', 'uslw'],
  amateur: ['npsl', 'upsl', 'usl2', 'apsl', 'swpl', 'mpl', 'mwpl', 'cpl', 'cplw', 'gcpl', 'loc', 'uslwl', 'wpsl', 'uws', 'uws2'],
  college: ['ncaa1', 'ncaa2', 'ncaa3', 'naia', 'ncaa1w', 'ncaa2w'],
  youth: ['mlsnext', 'ecnlb', 'ga', 'ecnlg', 'ea', 'ecrlb', 'ecrlg', 'gaa']
};
let level = 'all';
/* illustrative-data quarantine chip — pair with .badge.d so nothing
   illustrative ever renders in the verified green */
const DTAG = '<span class="dtag">Illustrative</span>';
function levelChips() {
  return `<div class="chips" id="lvlchips">${Object.keys(LEVELS).map(k =>
    `<button class="chip solid" data-lvl="${k}" aria-pressed="${level === k}">${k === 'all' ? 'All levels' : k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div>`;
}
function wireLevelChips() {
  const el = view.querySelector('#lvlchips');
  if (!el) return;
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-lvl]'); if (!b) return;
    level = b.dataset.lvl;
    leagueFilter = new Set(LEVELS[level] ? leaguesFor(sex).filter(k => LEVELS[level].includes(k)) : leaguesFor(sex));
    route();
  });
}
/* Direct-sold sponsor slots — no ad networks, no tracking scripts, ever: a
   filled slot is a static creative + link. Sold nationally or per region:
   a slot resolves regional sponsor (for the region in view) -> national
   sponsor -> placeholder, so local sponsors show only inside their region
   and national coverage fills everywhere else.
   Fill: SPONSORS.map.national = {name, url, img}
         SPONSORS.region.regions.southwest = {name, url, img} */
const SPONSORS = {
  map: { national: null, regions: {} },        // national map — every session starts here
  tiers: { national: null, regions: {} },      // the pyramid
  wire: { national: null, regions: {} },       // the wire
  freeagents: { national: null, regions: {} }, // recruiting audience
  region: { national: null, regions: {} },     // region + state screens (local inventory)
};
function adRegion() {
  const parts = (location.hash || '').slice(2).split('/');
  if (parts[0] === 'region') return REGIONS[parts[1]] ? parts[1] : null;
  if (parts[0] === 'state') return Object.keys(REGIONS).find(r => REGIONS[r].includes(parts[1])) || null;
  return null;
}
function adSlot(key, label) {
  const cfg = SPONSORS[key] || {};
  const reg = adRegion();
  const s = (reg && cfg.regions && cfg.regions[reg]) || cfg.national;
  if (s) return `<a class="adslot filled" href="${s.url}" target="_blank" rel="noopener sponsored">${s.img ? `<img src="${s.img}" alt="${esc(s.name)}">` : ''}<span><i>${label} · presented by</i><b>${esc(s.name)}</b></span></a>`;
  const scope = reg ? `${REGION_LABEL[reg]} regional` : 'national';
  return `<a class="adslot" href="#/advertise"><span><i>Sponsor slot · ${label} · ${scope}</i><b>Your brand, in front of American soccer</b></span><span class="adcta">Ad space &rarr;</span></a>`;
}

function screenMap() {
  crumb.textContent = 'USA';
  const clubs = pool();
  view.innerHTML = `
    ${sexToggle()}
    ${levelChips()}
    <div class="kicker">National map · ${visible(clubs).length} of ${clubs.length} ${sex === 'w' ? "women's" : "men's"} clubs</div>
    <div class="chips" id="regionchips">${['all', ...Object.keys(REGIONS)].map(r =>
      `<button class="chip solid" data-region="${r}" aria-pressed="${r === 'all'}">${r === 'all' ? 'All USA' : REGION_LABEL[r]}</button>`).join('')}</div>
    ${renderMapSvg(visible(clubs))}
    ${leagueChips()}
    ${(() => {
      const f = favs();
      if (!f.clubs.length && !f.players.length) return '';
      return `<div class="kicker" style="margin-top:10px">Following</div><div class="chips">` +
        f.clubs.map(fid => { const i2 = clubIdx(fid); return i2 >= 0 ? `<a class="chip" href="${clubHref(i2)}" style="text-decoration:none">&#9733; ${esc(CLUBS[i2].n)}</a>` : ''; }).join('') +
        f.players.map(id => { const parts2 = id.split('/'); const c2 = CLUBS[clubIdx(parts2[0])]; if (!c2) return '';
          const p2 = squadFor(c2)[+parts2[1]]; return p2 ? `<a class="chip" href="#/player/${id}" style="text-decoration:none">&#9733; ${esc(p2.name)}</a>` : ''; }).join('') + `</div>`;
    })()}
    <a class="fa-card" href="#/wire"><b>&#128240; The Wire</b><span>Upsets, rating swings, golden-boot races &mdash; generated live from real results.</span></a>
    <a class="fa-card" href="#/freeagents"><b>&#9733; Free Agents</b><span>No club right now? Get seen by every club on this map.</span></a>
    ${adSlot('map', 'National map')}
    <p class="note">Tap a state to zoom in. Tap a pin for the club. Pinch, scroll, or use +/&minus; to zoom further.</p>
    <label class="sr-only" for="statejump">Jump to a state or province</label>
    <select id="statejump">
      <option value="">Jump to a state or province&hellip;</option>
      ${Object.entries({ ...STATE_NAME, ...PROV_NAME }).sort((a, b) => a[1].localeCompare(b[1])).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
    </select>`;
  wireSexToggle();
  wireLevelChips();
  wireMap(null);
  view.querySelector('#regionchips').addEventListener('click', e => {
    const b = e.target.closest('[data-region]'); if (!b) return;
    location.hash = b.dataset.region === 'all' ? '#/map' : `#/region/${b.dataset.region}`;
  });
  /* keyboard-equivalent path to state zoom — the SVG map is presented as an
     image (role=img), so state navigation must not require a pointer */
  view.querySelector('#statejump').addEventListener('change', e => {
    if (e.target.value) location.hash = '#/state/' + e.target.value;
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
    ${renderMapSvg(visible(clubs), true)}
    ${leagueChips()}
    <div class="kicker" style="margin-top:10px">Top clubs · ${clubs.length} in region</div>
    <ul class="clublist">${ranked.slice(0, 15).map((c, i) => clubRow(c, i + 1)).join('')}</ul>
    ${adSlot('region', REGION_LABEL[key])}`;
  wireSexToggle();
  wireMap(states);
}

function screenState(st) {
  if (!STATE_NAME[st]) return screenMap();
  crumb.textContent = st;
  const clubs = pool().filter(c => c.st === st);
  const ranked = visible(clubs).filter(c => c.r).sort((a, b) => b.r - a.r);
  const concepts = visible(clubs).filter(c => !c.r);
  const mappable = clubs.length > 0;
  view.innerHTML = `
    <button class="backbtn" onclick="history.length>1?history.back():location.hash='#/map'">&larr; Back</button>
    ${sexToggle()}
    <div class="kicker">State</div><h2 class="disp">${STATE_NAME[st]}</h2>
    ${mappable ? renderMapSvg(visible(clubs), true) : ''}
    ${clubs.length ? leagueChips() : ''}
    <div class="kicker" style="margin-top:10px">${clubs.length ? `Clubs · ${clubs.length}` : 'No clubs mapped yet'}</div>
    <ul class="clublist" id="statelist">${ranked.map((c, i) => clubRow(c, i + 1)).join('')}${concepts.map(c => clubRow(c)).join('')}</ul>
    ${adSlot('region', STATE_NAME[st])}
    ${clubs.length ? '' : '<p class="note">This is where league expansion starts — the dataset grows as leagues are added.</p>'}`;
  wireSexToggle();
  if (mappable) {
    wireMap([st]);
  }
}

function playerRow(p, rank) {
  return `<li><a href="#/player/${p.c.id}/${p.i}">
    <span class="rk">${rank}</span>${crestHtml(p.c)}
    <span class="cl-name"><b>${esc(p.name)}</b><span>${p.pos} · ${esc(p.c.n)}</span></span>
    <span class="cl-rt">${p.pvr}</span></a></li>`;
}
function screenTable() {
  crumb.textContent = 'Table';
  const poolClubs = () => pool().filter(c => c.r && leagueFilter.has(c.g)).sort((a, b) => b.r - a.r);
  const poolPlayers = () => allPlayers(sex)
    .filter(p => leagueFilter.has(p.c.g) && (posFilter === 'all' || p.pos === posFilter))
    .sort((a, b) => b.pvr - a.pvr);
  const render = () => {
    const full = tableMode === 'clubs' ? poolClubs() : poolPlayers();
    const rows = full.slice(0, tableLimit).map((x, i) =>
      tableMode === 'clubs' ? clubRow(x, i + 1) : playerRow(x, i + 1)).join('');
    const rest = full.length - Math.min(tableLimit, full.length);
    return rows + (rest > 0 ? `<li><button class="morebtn" id="morebtn">Show more &middot; ${rest.toLocaleString()} remaining</button></li>` : '');
  };
  view.innerHTML = `
    ${sexToggle()}
    <div class="kicker">${tableMode === 'players' ? DTAG + 'Cross-league · illustrative stats' : 'Cross-league · Elo where results exist, illustrative elsewhere'}</div>
    <h2 class="disp">The National Table</h2>
    <div class="chips seg" id="modeseg">
      <button class="chip solid" data-mode="clubs" aria-pressed="${tableMode === 'clubs'}">Clubs</button>
      <button class="chip solid" data-mode="players" aria-pressed="${tableMode === 'players'}">Players</button>
    </div>
    <div class="chips" id="poschips" style="display:${tableMode === 'players' ? 'flex' : 'none'}">${['all', 'GK', 'DF', 'MF', 'FW'].map(pp =>
      `<button class="chip solid" data-pos="${pp}" aria-pressed="${posFilter === pp}">${pp === 'all' ? 'All positions' : pp}</button>`).join('')}</div>
    ${leagueChips()}
    <details class="how"><summary>How are these numbers made?</summary>
      <p><b>Clubs.</b> Where we hold real results — USL Championship, USL League One, MLS Next Pro, NWSL, USL Super League (via American Soccer Analysis) and NPSL (league match reports), 1,470+ matches — ratings are Elo: everyone starts at 1500, winners take points from losers, more for upsets and big margins (log goal-margin; tier-tuned K and home edge — K=64/+30 amateur, K=32/+65 pro, set by backtest, not taste), each league anchored to its tier band. MLS ranks by the official league table, with an experimental results-Elo published on each club page. Where we hold standings but not results (UPSL), ratings derive from points and goal difference. Everywhere else the rating is an illustrative placeholder and says so.</p>
      <p><b>Calibration — the receipts.</b> Backtested walk-forward on 1,377 real 2026 matches (310 NPSL + 1,067 pro): weighted Brier 0.600 vs 0.667 uniform. On NPSL the tuned engine scores 0.531 and the buckets are honest — teams we called 40&ndash;49% won 52%, 50&ndash;59% won 67%, 60&ndash;69% won 69%, 70&ndash;79% won 71%, 80&ndash;89% won 86%. Pro parity leagues carry a thinner edge (that's real, we publish it anyway). Calibration re-runs as every league's results land.</p>
      <p><b>Across leagues.</b> Within a league, ratings are evidence. Between leagues, they're measured: league anchors come from ~600 cross-league U.S. Open Cup results across the last five editions (extra-time wins weighted 0.75, shootout wins 0.6, home edge fitted at +31 Elo). On top of that anchor, a club's own Cup results move its rating — beat a side from a higher tier and the points are yours, itemized on your club page. MLS ranks stay with the official league table.</p>
      <p><b>Players.</b> The value rating weights production — goals ×4, assists ×3, appearances ×0.6, keeper clean sheets and saves — scaled by the strength of the club's opposition. Player stats are illustrative until verified reporting is live; each profile's badge says which.</p>
    </details>
    <ul class="clublist" id="tablelist">${render()}</ul>
    <p class="note">${tableMode === 'players'
      ? 'Player value ratings weight production by opposition strength — illustrative until verified reporting is live.'
      : "USLC, USL1, MLS Next Pro, NWSL, USL Super League and NPSL ratings come from real results (Elo). MLS and UPSL rank by real 2026 standings — MLS club pages also show an experimental results-Elo. Other leagues remain illustrative until their feeds land. Men's and women's ranked separately."}</p>`;
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
    tableLimit = 40;
    toggleLeague(b.dataset.lg);
  });
  view.querySelector('#tablelist').addEventListener('click', e => {
    if (!e.target.closest('#morebtn')) return;
    tableLimit += 100;
    view.querySelector('#tablelist').innerHTML = render();
  });
}

function neighbors(c, count) {
  return CLUBS.filter(o => o !== c && o.g === c.g && o.r && !o.h)
    .sort((a, b) => dist2(a, c) - dist2(b, c)).slice(0, count);
}

/* Elo gap -> Poisson expected goals -> scoreline + three-way odds */
const FACT = [1, 1, 2, 6, 24, 120, 720, 5040];
/* Tier-tuned engine — backtested 2026-07-27 on 1,377 real matches (310 NPSL
   + 1,067 pro): amateur football wants a bigger K and smaller home edge than
   pro parity leagues, so params split by tier instead of one-size-fits-all. */
const AMATEUR_TIER = new Set(['npsl', 'upsl', 'usl2', 'apsl', 'gcpl', 'loc', 'uslwl', 'wpsl', 'uws', 'nisa', 'ncaa1', 'ncaa2', 'ncaa3', 'naia', 'ncaa1w', 'ncaa2w']);
function oddsFor(h, a, homeAdv) {
  const amateur = AMATEUR_TIER.has(h.g) && AMATEUR_TIER.has(a.g);
  const ha = homeAdv != null ? homeAdv : (amateur ? 30 : 65);
  const lam0 = amateur ? 1.45 : 1.35;
  const d = h.r + ha - a.r;
  const lamH = lam0 * Math.pow(10, d / 1000);
  const lamA = lam0 * Math.pow(10, -d / 1000);
  const pois = (l, k) => Math.exp(-l) * Math.pow(l, k) / FACT[k];
  let pH = 0, pD = 0, pA = 0, best = [1, 1], bestP = 0;
  for (let i = 0; i <= 7; i++) for (let j = 0; j <= 7; j++) {
    const p = pois(lamH, i) * pois(lamA, j);
    if (i > j) pH += p; else if (i === j) pD += p; else pA += p;
    if (p > bestP) { bestP = p; best = [i, j]; }
  }
  // truncating scorelines at 7 goals drops probability mass (3%+ on lopsided
  // matchups), so the three outcomes must renormalize to sum to exactly 1
  const tot = pH + pD + pA;
  return { pH: pH / tot, pD: pD / tot, pA: pA / tot, score: best, ha };
}

/* ico = crests/platform-<ico>.svg; 'inv' logos are dark-on-transparent
   wordmarks that invert under the dark theme */
const WATCH = {
  mls: { label: 'MLS Season Pass · Apple TV', url: 'https://tv.apple.com/us/channel/mls-season-pass/tvs.sbd.7000', ico: 'appletv', inv: true },
  mnp: { label: 'MLS Next Pro · free on Apple TV', url: 'https://www.mlsnextpro.com/schedule', ico: 'appletv', inv: true },
  uslc: { label: 'USL Championship · broadcast guide', url: 'https://www.uslchampionship.com/watch' },
  usl1: { label: 'USL League One · broadcast guide', url: 'https://www.uslleagueone.com/watch' },
  nwsl: { label: 'NWSL · how to watch', url: 'https://www.nwslsoccer.com/how-to-watch' },
  uslw: { label: 'USL Super League · Peacock', url: 'https://www.uslsuperleague.com', ico: 'peacock', inv: true },
  npsl: { label: 'NPSL · league YouTube', url: 'https://www.youtube.com/@NPSLSoccer', ico: 'youtube' },
  upsl: { label: 'UPSL · league YouTube', url: 'https://www.youtube.com/@UPSLsoccer', ico: 'youtube' }
};
function watchRow(h, a) {
  const w = WATCH[h.g];
  if (!w) return '';
  const ico = w.ico ? `<img class="pico${w.inv ? ' inv' : ''}" src="crests/platform-${w.ico}.svg" alt="" loading="lazy">` : '&#9655; ';
  return `<div class="meta" style="margin-top:6px"><a class="watchlink" href="${w.url}" target="_blank" rel="noopener">${ico}Watch: ${w.label}</a></div>`;
}
/* Confidence buckets over the strongest single outcome — the meter under the
   odds row. Thresholds line up with how bettors read a three-way market. */
function confidenceFor(o, h, a) {
  const top = Math.max(o.pH, o.pD, o.pA);
  const fav = top === o.pH ? esc(initials(h.n)) + ' win' : top === o.pA ? esc(initials(a.n)) + ' win' : 'Draw';
  const [tag, n] = top >= 0.7 ? ['Strong pick', 4] : top >= 0.55 ? ['Likely', 3] : top >= 0.45 ? ['Lean', 2] : ['Toss-up', 1];
  return { top, fav, tag, n };
}
/* small crest + league-logo marks for match rows — the 34px crestHtml chip
   overwhelms a one-line fixture, so match rows get a 20px variant */
const mcrest = c => c.img
  ? `<img class="mcrest" src="${c.img}?cv=${CRESTV}" alt="" loading="lazy" onerror="this.style.display='none'">`
  : `<span class="mcrest ini" style="background:${LEAGUES[c.g].color}">${initials(c.n)}</span>`;
/* inv: 'd' = dark-art mark, invert under dark theme; 'l' = white mark,
   invert under light theme — one asset serves both themes either way */
const lgIcon = g => { const m = LEAGUES[g]; return m.img ? `<img class="lgico${m.inv ? ' inv-' + m.inv : ''}" src="${m.img}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''; };
/* real=true only for verified fixtures — a watch link on a hypothetical
   matchup advertised a broadcast for a game that doesn't exist (audit #7) */
function matchCard(h, a, when, real) {
  const head = `<div class="mrow"><a class="side" href="#/club/${h.id}">${mcrest(h)}<span class="sn">${esc(h.n)}</span></a><span class="vs">${when || 'NEUTRAL'}</span><a class="side away" href="#/club/${a.id}">${mcrest(a)}<span class="sn">${esc(a.n)}</span></a></div>
    <div class="meta"><span>${lgIcon(h.g)}${LEAGUES[h.g].label}${h.g !== a.g ? ' v ' + LEAGUES[a.g].label : ''}</span><span>${h.st}${h.st !== a.st ? ' · ' + a.st : ''}</span></div>`;
  // a club with no Elo yet must never reach the Poisson math — that path is NaN
  if (!h.r || !a.r) return `<div class="match">${head}
    <p class="note" style="margin:8px 0 0">Odds unavailable — ${esc(!h.r ? h.n : a.n)} has no rating yet. Ratings arrive once results land in the dataset.</p>
  </div>`;
  const o = oddsFor(h, a);
  const cf = confidenceFor(o, h, a);
  return `<div class="match">
    ${head}
    <div class="scoreline">${o.score[0]}–${o.score[1]}</div>
    <div class="meta" style="justify-content:center;margin-top:0"><span>most likely score</span></div>
    <div class="oddsrow">
      <div class="odds"><b>${(o.pH * 100).toFixed(1)}%</b><span>${esc(initials(h.n))} win</span></div>
      <div class="odds"><b>${(o.pD * 100).toFixed(1)}%</b><span>Draw</span></div>
      <div class="odds"><b>${(o.pA * 100).toFixed(1)}%</b><span>${esc(initials(a.n))} win</span></div>
    </div>
    <div class="confmeter l${cf.n}" role="img" aria-label="Confidence: ${cf.tag} — ${cf.fav} at ${(cf.top * 100).toFixed(1)} percent">
      <span class="conf-label">Confidence</span>
      <span class="conf-segs">${[1, 2, 3, 4].map(i => `<i${i <= cf.n ? ' class="on"' : ''}></i>`).join('')}</span>
      <span class="conf-read"><b>${cf.tag}</b> · ${cf.fav}</span>
    </div>
    <div class="prob"><i style="width:${(o.pH * 100).toFixed(1)}%;background:${LEAGUES[h.g].color}"></i><i style="width:${(o.pD * 100).toFixed(1)}%;background:var(--line)"></i><i style="flex:1;background:${LEAGUES[a.g].color};opacity:.55"></i></div>
    <div class="meta"><span>Elo ${h.r} v ${a.r}</span><span>home edge +${o.ha}</span></div>
    ${real ? watchRow(h, a) : ''}
  </div>`;
}

let _fixtures = null;
async function fixturesDb() {
  if (_fixtures) return _fixtures;
  try { _fixtures = await (await fetch('data/npsl_fixtures.json?v=20260809d')).json(); }
  catch { _fixtures = []; }
  return _fixtures;
}
let _wireFeed = null;
async function wireDb() {
  if (_wireFeed) return _wireFeed;
  const grab = u => fetch(u).then(r => r.json()).catch(() => []);
  const [npsl, asa] = await Promise.all([
    grab('data/wire_npsl.json?v=20260809d'), grab('data/wire_asa.json?v=20260809d')]);
  _wireFeed = npsl.map(w => ({ ...w, lg: 'npsl' })).concat(asa)
    .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  return _wireFeed;
}
let _natTeams = null;
async function natTeamsDb() {
  if (_natTeams) return _natTeams;
  try { _natTeams = await (await fetch('data/national_teams.json?v=20260809d')).json(); }
  catch { _natTeams = { teams: [] }; }
  return _natTeams;
}
function fmtKick(iso) {
  const d = new Date(iso);
  const et = d.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const loc = d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return et === loc ? et + ' ET' : et + ' ET · ' + loc + ' local';
}
function screenMatches(preH) {
  crumb.textContent = 'Matches';
  const rated = pool().filter(c => c.r).sort((a, b) => b.r - a.r);
  const groups = leaguesFor(sex).filter(k => !LEAGUES[k].hollow && k !== 'mnp');
  const used = new Set(); const pairs = [];
  groups.forEach(g => {
    const p = rated.filter(c => c.g === g);
    for (const home of p) {
      if (used.has(home) || pairs.length >= 12) break;
      /* vary which neighbor each club draws — always pairing nearest-with-
         nearest gives every card the same tiny Elo gap and near-identical
         odds; a deterministic spread across the 6 closest keeps the radar
         varied */
      const cand = neighbors(home, 6).filter(o => !used.has(o));
      if (!cand.length) continue;
      const opp = cand[(home.n.length * 7 + pairs.length * 3) % cand.length];
      used.add(home); used.add(opp);
      pairs.push([home, opp]);
    }
  });
  const opts = sel => rated.map(c => `<option value="${CLUBS.indexOf(c)}" ${c === sel ? 'selected' : ''}>${esc(c.n)} (${c.r})</option>`).join('');
  view.innerHTML = `
    ${sexToggle()}
    <a class="fa-card" href="#/wire"><b>&#128240; The Wire</b><span>This week's results, upsets and rating swings &mdash; generated from real data.</span></a>
    <a class="fa-card" href="#/nt"><b>&#127482;&#127480; National Teams</b><span>USA youth national teams &mdash; Concacaf championship fixtures, where they play, how to watch.</span></a>
    <div id="realfx"></div>
    <div class="kicker">Predictor · any club v any club · model estimate</div>
    <h2 class="disp">Matchup Machine</h2>
    <div class="pickrow">
      <select id="pickH" aria-label="Home club">${opts(CLUBS[+preH] && CLUBS[+preH].r ? CLUBS[+preH] : rated[0])}</select>
      <span class="vs">V</span>
      <select id="pickA" aria-label="Away club">${opts(rated[1])}</select>
    </div>
    <div id="pickout">${matchCard(CLUBS[+preH] && CLUBS[+preH].r ? CLUBS[+preH] : rated[0], rated[1], 'HYPOTHETICAL')}</div>
    <div class="kicker" style="margin-top:18px">Rivalry Radar · nearest matchups by geography</div>
    <h2 class="disp">Rivalry Radar</h2>
    <p class="note" style="margin:2px 0 10px">Who's closest to whom — and how the model thinks it would go. A discovery feature, not a schedule: these games aren't scheduled, so there are no dates. Verified fixtures appear above as league feeds connect.</p>
    ${pairs.map(([h, a]) => matchCard(h, a, `${milesApart(h, a)} MI APART`)).join('')}
    <p class="note">Odds from Elo gap via Poisson expected goals, home edge tuned per tier (+30 amateur, +65 pro). Predictions, not betting advice.</p>`;
  wireSexToggle();
  const redo = () => {
    const h = CLUBS[+view.querySelector('#pickH').value];
    const a = CLUBS[+view.querySelector('#pickA').value];
    view.querySelector('#pickout').innerHTML = matchCard(h, a, 'HYPOTHETICAL');
  };
  view.querySelector('#pickH').addEventListener('change', redo);
  view.querySelector('#pickA').addEventListener('change', redo);
  /* NPSL is a men's league: its fixtures never render into the women's
     view, including late async resolution after the user toggles sex —
     the women's view gets the honest empty state instead */
  const fxSex = sex;
  fixturesDb().then(all => {
    const box = view.querySelector('#realfx');
    if (!box || sex !== fxSex) return;
    /* verified fixtures only, and only inside a two-week window — a stale
       feed must never present last month's games as upcoming */
    const now = Date.now(), TWO_WEEKS = 14 * 864e5;
    const fx = (sex === 'm' ? all : []).filter(f => {
      const t = Date.parse(f.start);
      return t > now - 6 * 36e5 && t < now + TWO_WEEKS;
    });
    if (!fx.length) {
      box.innerHTML = `<div class="kicker">Verified fixtures · next two weeks</div>
        <p class="note" style="margin:2px 0 14px">No verified fixtures in the next two weeks. Real fixtures land here straight from league feeds — nothing is ever invented to fill the space.</p>`;
      return;
    }
    box.innerHTML = `<div class="kicker">Verified fixtures · NPSL · live from the league</div>
      <h2 class="disp">The Real Thing</h2>` + fx.map(f => {
        const hi = clubIdxByName(f.t1), ai = clubIdxByName(f.t2);
        const h = CLUBS[hi], a = CLUBS[ai];
        const when = fmtKick(f.start);
        if (!h || !a) return `<div class="match"><div class="mrow"><span class="side"><span class="sn">${esc(f.t1)}</span></span><span class="vs">v</span><span class="side away"><span class="sn">${esc(f.t2)}</span></span></div>
          <div class="meta"><span>${when}</span><span>${esc(f.round)} · ${esc(f.venue || 'Venue TBD')}</span></div>
          <p class="note" style="margin:6px 0 0">Pairing set once the semifinals finish.</p></div>`;
        return matchCard(h, a, f.round.toUpperCase(), true) .replace('<div class="meta"><span>Elo', `<div class="meta"><span>${when} · ${esc(f.venue || '')}</span><span></span></div><div class="meta"><span>Elo`);
      }).join('') + `<p class="note">Times shown in Eastern and your local time. Odds from real-results Elo.</p>`;
  });
}

/* USA national teams — senior and youth, men's and women's, with tournament
   fixtures, results and how to watch. National sides are not clubs: they stay
   out of CLUBS (the map, the table, the counts) and live in their own dataset.
   Teams whose year is camps and unpublished friendlies carry a note instead of
   match rows — no row ships without a verified date, opponent and venue.
   Watch links are per-match and render only on games that haven't finished —
   a played game must never advertise a broadcast (same rule as audit #7). */
async function screenNationalTeams() {
  crumb.textContent = 'National Teams';
  const db = await natTeamsDb();
  const teams = db.teams || [];
  const fmtDay = iso => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' });
  const row = m => {
    const ended = m.status === 'ENDED';
    const res = !ended ? '' : m.us > m.them ? 'W ' : m.us < m.them ? 'L ' : 'D ';
    const when = ended ? fmtDay(m.start) : m.timeTBD ? fmtDay(m.start) + ' · time TBA' : fmtKick(m.start);
    const watch = !ended && (m.tv || []).length
      ? `<div class="meta" style="margin-top:6px">${m.tv.map(t =>
          `<a class="watchlink" href="${t.url}" target="_blank" rel="noopener">&#9655; Watch: ${esc(t.label)}</a>`).join('')}</div>`
      : '';
    return `<div class="match">
      <div class="mrow"><span class="side"><span class="sn">USA</span></span><span class="vs">${ended ? res + m.us + '–' + m.them : 'V'}</span><span class="side away"><span class="sn">${esc(m.opp)}</span></span></div>
      <div class="meta"><span>${esc(m.round)}</span><span>${when}</span></div>
      ${m.venue || m.city ? `<div class="meta"><span>${esc(m.venue || '')}</span><span>${esc(m.city || '')}</span></div>` : ''}
      ${watch}
    </div>`;
  };
  const block = t => `
    <div class="kicker" style="margin-top:22px">${esc(t.comp)}${t.compDates ? ' · ' + esc(t.compDates) : ''}</div>
    <h2 class="disp">${esc(t.name)}</h2>
    ${t.note ? `<p class="note" style="margin:2px 0 8px">${esc(t.note)}</p>` : ''}
    ${(t.achievements || []).map(a => `<span class="badge c" style="margin:0 6px 8px 0;display:inline-block">${esc(a)}</span>`).join('')}
    ${(t.matches || []).map(row).join('')}
    ${t.next ? `<p class="note" style="margin:6px 0 0">${esc(t.next)}</p>` : ''}`;
  const section = (title, list) => list.length ? `
    <div class="kicker" style="margin-top:30px;font-size:1rem;letter-spacing:.08em">${title}</div>
    <hr style="border:none;border-top:1px solid var(--line,#24352C);margin:4px 0 0">
    ${list.map(block).join('')}` : '';
  view.innerHTML = `
    <div class="kicker">USA national teams · senior through U-15 · Concacaf &amp; FIFA competitions</div>
    <h2 class="disp">National Teams</h2>
    ${teams.length
      ? section('Men', teams.filter(t => t.g !== 'women')) + section('Women', teams.filter(t => t.g === 'women'))
      : '<p class="note">National-team fixtures are loading into the dataset.</p>'}
    <p class="note">Kickoffs shown in Eastern and your local time. Results, venues and broadcasts from U.S. Soccer, Concacaf and FIFA — nothing is invented. Teams shown without match rows are in camp-and-friendly cycles with no published fixture data. Watch links appear only on upcoming games.</p>`;
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
// clubs sharing a name across leagues (e.g. Lexington SC in USLC and USL Super League)
// use league-qualified keys in ROSTERS/COACHES/HONOURS so the squads never collide
const DUP_NAMES = (() => {
  const seen = new Set(), dup = new Set();
  for (const c of CLUBS) { if (seen.has(c.n)) dup.add(c.n); seen.add(c.n); }
  return dup;
})();
const rosterKey = c => DUP_NAMES.has(c.n) ? c.g + ':' + c.n : c.n;
function squadFor(c) {
  const real = ROSTERS[rosterKey(c)];
  if (!real) return [];
  return real.map((rp, i) => {
    const base = statLine(rp.pos, pseed(rp.name), c);
    let st = base, rs = false;
    if (rp.st) {
      rs = true;
      const apps = Math.max(1, Math.round(rp.st.min / 90));
      st = { apps, goals: rp.st.g, assists: rp.st.a, saves: rp.st.sv || 0, cs: 0,
        yc: null, rc: 0, mins: rp.st.min, xg: rp.st.xg, kp: rp.st.kp,
        sh: rp.st.sh, sot: rp.st.sot, xa: rp.st.xa, gc: rp.st.gc, sf: rp.st.sf,
        pvr: Math.round((rp.st.g * 4 + rp.st.a * 3 + apps * 0.6 + (rp.st.sv || 0) * 0.06) * (c.r / 1800) * 10) / 10,
        form: null };
    }
    return { ...st, num: rp.num || i + 1, name: rp.name, pos: rp.pos,
      nat: rp.nat ? rp.nat.toUpperCase() : null, wiki: rp.wiki, real: true, rs, age: null };
  });
}
function staffFor(c) {
  const real = COACHES[rosterKey(c)];
  if (real) return [{ tag: 'HC', name: real.name, role: real.role, age: '' }];
  const g = genStaff(c);
  return [{ tag: 'HC', name: g.hc.name, role: 'Head Coach', age: g.hc.age },
          { tag: 'AC', name: g.ac.name, role: 'Assistant', age: g.ac.age }];
}
const favs = () => { try {
  const raw = localStorage.getItem('pyr-favs');
  const f = JSON.parse(raw) || { clubs: [], players: [] };
  /* migrate pre-slug favorites saved as array indexes */
  f.clubs = (f.clubs || []).map(x => /^\d+$/.test(x) && CLUBS[+x] ? CLUBS[+x].id : x);
  f.players = (f.players || []).map(x => { const s2 = String(x).split('/'); return /^\d+$/.test(s2[0]) && CLUBS[+s2[0]] ? CLUBS[+s2[0]].id + '/' + s2[1] : x; });
  const migrated = JSON.stringify(f);
  if (raw && migrated !== raw) localStorage.setItem('pyr-favs', migrated);
  return f;
} catch { return { clubs: [], players: [] }; } };
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
  CLUBS.forEach(c => { if (c.x !== sx || !c.r || c.h) return; squadFor(c).forEach((pl, i) => out.push({ ...pl, c, i })); });
  return _pcache[sx] = out;
}
function rankChart(rows, color) {
  const data = [...rows].sort((a, b) => a.yr - b.yr);
  if (data.length < 3) return '';
  const W = 320, H = 130, padL = 26, padR = 12, padT = 10, padB = 20;
  const maxPos = Math.max(...data.map(r => r.of));
  const x = i => padL + (W - padL - padR) * (i / (data.length - 1));
  const y = pos => padT + (H - padT - padB) * ((pos - 1) / Math.max(1, maxPos - 1));
  const pts = data.map((r, i) => [x(i), y(r.pos)]);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
  const area = line + `L${pts[pts.length - 1][0].toFixed(1)} ${H - padB}L${pts[0][0].toFixed(1)} ${H - padB}Z`;
  const last = pts[pts.length - 1];
  const midYr = data[Math.floor(data.length / 2)].yr;
  const bands = data.map((r, i) => {
    const bx = i ? (pts[i - 1][0] + pts[i][0]) / 2 : padL;
    const bw = (i < data.length - 1 ? (pts[i][0] + pts[i + 1][0]) / 2 : W - padR) - bx;
    return `<rect x="${bx.toFixed(1)}" y="0" width="${bw.toFixed(1)}" height="${H}" fill="transparent" data-ci="${i}"><title>${r.yr} · ${r.w}-${r.d}-${r.l} · finished ${ord(r.pos)} of ${r.of}</title></rect>`;
  }).join('');
  return `<div class="rankchart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="League finish by season, 1 at top">
    <line x1="${padL}" y1="${padT}" x2="${W - padR}" y2="${padT}" stroke="var(--line)" stroke-dasharray="2 4"/>
    <line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" stroke="var(--line)" stroke-dasharray="2 4"/>
    <text x="${padL - 5}" y="${padT + 4}" class="ax" text-anchor="end">1</text>
    <text x="${padL - 5}" y="${H - padB + 4}" class="ax" text-anchor="end">${maxPos}</text>
    <text x="${padL}" y="${H - 5}" class="ax">${data[0].yr}</text>
    <text x="${(W + padL - padR) / 2}" y="${H - 5}" class="ax" text-anchor="middle">${midYr}</text>
    <text x="${W - padR}" y="${H - 5}" class="ax" text-anchor="end">${data[data.length - 1].yr}</text>
    <path d="${area}" fill="${color}" fill-opacity=".12"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="4" fill="${color}" stroke="var(--raise)" stroke-width="2"/>
    ${bands}
  </svg></div>`;
}
function ord(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return n + 'th';
  return n + ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
}
let _mlshist = null;
async function mlsHistory() {
  if (_mlshist) return _mlshist;
  try { _mlshist = await (await fetch('data/mls_history.json?v=20260809d')).json(); }
  catch { _mlshist = {}; }
  return _mlshist;
}
let _cuprec = null;
async function cupDb() {
  if (_cuprec) return _cuprec;
  try { _cuprec = await (await fetch('data/cup_receipts.json?v=20260809d')).json(); }
  catch { _cuprec = {}; }
  return _cuprec;
}
let _legends = null;
async function legendsDb() {
  if (_legends) return _legends;
  try { _legends = await (await fetch('data/legends.json?v=20260809d')).json(); }
  catch { _legends = {}; }
  return _legends;
}
let _profiles = null;
async function profilesDb() {
  if (_profiles) return _profiles;
  try { _profiles = await (await fetch('data/players.json?v=20260809d')).json(); }
  catch { _profiles = {}; }
  return _profiles;
}
let _tryouts = null;
async function tryoutsDb() {
  if (_tryouts) return _tryouts;
  try { _tryouts = await (await fetch('data/tryouts.json?v=20260809d')).json(); }
  catch { _tryouts = []; }
  return _tryouts;
}
const AVATAR = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' fill='%23EFF2EC'/%3E%3Ccircle cx='50' cy='38' r='19' fill='%23AAB8A8'/%3E%3Cpath d='M14 94c5-24 19-32 36-32s31 8 36 32z' fill='%23AAB8A8'/%3E%3C/svg%3E";
/* names Wikipedia uses that differ from the dataset's canonical short names */
const CLUB_NAME_ALIASES = {
  'los angeles fc': 'LAFC',
  'los angeles galaxy': 'LA Galaxy',
};
function clubIdxByName(nm, ok) {
  /* exact name first — suffix-stripping folds "Los Angeles FC" and
     "Los Angeles SC" (a different club, different sex) onto the same key,
     so the fuzzy pass only stands when it is unambiguous; two candidates =
     no link, because a missing link beats a wrong club. `ok` narrows the
     candidate pool (sex, tier) when the caller knows the context. */
  nm = CLUB_NAME_ALIASES[nm.toLowerCase()] || nm;
  const pass = c => !c.h && (!ok || ok(c));
  const lower = nm.toLowerCase();
  const exact = CLUBS.findIndex(c => pass(c) && c.n.toLowerCase() === lower);
  if (exact >= 0) return exact;
  const strip = s => s.toLowerCase().replace(/\b(fc|sc|cf|afc|club|the)\b/g, '').replace(/\s+/g, '');
  const k = strip(nm);
  let found = -1;
  for (let i = 0; i < CLUBS.length; i++) {
    if (!pass(CLUBS[i]) || strip(CLUBS[i].n) !== k) continue;
    if (found >= 0) return -1;
    found = i;
  }
  return found;
}
function careerRow(step) {
  const idx = clubIdxByName(step.club);
  const nm = idx >= 0 ? `<a href="${clubHref(idx)}">${esc(step.club)}</a>` : esc(step.club);
  const stat = step.apps ? `${step.apps} apps${step.goals ? ' · ' + step.goals + ' gls' : ''}` : '';
  return `<li><span class="cw-years">${esc(step.years || '')}</span><span class="cw-club">${nm}</span><span class="cw-stat">${stat}</span></li>`;
}
const PRO = new Set(['mls', 'uslc', 'usl1', 'mnp', 'nwsl', 'uslw']);
function verifyBadge(c) {
  const ro = ROSTERS[rosterKey(c)];
  if (ro && ro.some(p => p.st)) return `<span class="badge v">Real ${c.g === 'uslw' ? '2025-26' : '2026'} stats · American Soccer Analysis · roster via Wikipedia/ASA</span>`;
  if (ro) return '<span class="badge v">Roster: live from Wikipedia, refreshed every 2 days</span> <span class="badge d">Stats: illustrative</span>';
  return PRO.has(c.g)
    ? '<span class="badge d">Stats: illustrative · league match reports coming</span>'
    : '<span class="badge d">Stats: illustrative · club-submitted reporting planned</span>';
}

async function screenClub(ref) {
  const idx = clubIdx(String(ref));
  if (idx < 0) return screenMap();
  const c = CLUBS[idx];
  if (String(ref) !== c.id) { location.replace('#/club/' + c.id); return; }
  if (c.h && c.dup != null) { location.replace('#/club/' + (CLUBS[c.dup] ? CLUBS[c.dup].id : c.dup)); return; }
  const hist = c.g === 'mls' ? (await mlsHistory()) : null;
  const hasLegends = c.g === 'mls' && !!((await legendsDb())[c.n] || []).length;
  const cupRec = (await cupDb())[c.id] || [];
  crumb.textContent = c.st;
  const m = LEAGUES[c.g];
  const peers = CLUBS.filter(o => o.g === c.g && o.r && !o.h).sort((a, b) => b.r - a.r);
  const rank = c.r ? peers.indexOf(c) + 1 : null;
  const natl = CLUBS.filter(o => o.x === c.x && o.r && !o.h).sort((a, b) => b.r - a.r);
  /* same-league neighbors first; a club whose league has no nearby rated
     peers borrows the closest rated same-sex clubs so every rated club still
     gets fixtures and odds instead of an empty section */
  let opps = neighbors(c, 7);
  if (opps.length < 2 && c.r) opps = CLUBS.filter(o => o !== c && o.x === c.x && o.r && !o.h)
    .sort((a2, b2) => dist2(a2, c) - dist2(b2, c)).slice(0, 7);
  view.innerHTML = `
    <button class="backbtn" onclick="history.length>1?history.back():location.hash='#/map'">&larr; Back</button>
    <div class="clubhead">${crestHtml(c)}
      <div><h2 class="disp" style="margin:0">${esc(c.n)}</h2>
      ${m.url ? `<a class="lgchip" href="${m.url}" target="_blank" rel="noopener" style="background:${m.color}">${m.img ? `<img class="lgimg" src="${m.img}" alt="">` : ''}${m.label} &nearr;</a>` : `<span class="lgchip" style="background:${m.color}">${m.label}</span>`}
      <span class="sub" style="margin-left:8px">${c.ct ? `${esc(c.ct)}, ${c.st}` : (STATE_NAME[c.st] || PROV_NAME[c.st] || c.st)}</span></div>
    </div>
    <div class="btnrow">${favBtn('clubs', c.id)}${c.r ? `<button class="predictbtn2" data-predict="${idx}">&#9876; Predict Result</button>` : ''}${c.url ? `<a class="hdrlink" href="${safeHref(c.url)}" target="_blank" rel="noopener">Website &nearr;</a>` : `<a class="hdrlink dim" href="${gsearch(c.n, 'official site')}" target="_blank" rel="noopener">Find website</a>`}${c.si ? `<a class="hdrlink" href="${safeHref(c.si)}" target="_blank" rel="noopener">Instagram</a>` : ''}${c.sx ? `<a class="hdrlink" href="${safeHref(c.sx)}" target="_blank" rel="noopener">X</a>` : ''}</div>
    ${(HONOURS[rosterKey(c)] || []).length ? `<div class="kicker" style="margin-top:10px">Honours</div><ul class="honours">${(HONOURS[rosterKey(c)] || []).map(h2 => `<li><b>${esc(h2.t)}</b><span>${h2.y.join(', ')}</span></li>`).join('')}</ul>` : ''}
    ${c.r ? `<div class="statgrid">
      <div class="stat"><b>${c.r}</b><span>${c.rr === 1 ? 'Rating · real results' : c.rr === 2 ? 'Rating · standings' : c.rr === 3 ? 'Rating · results model' : DTAG + 'Rating'}${c.pv ? ' · provisional' : ''}</span></div>
      <div class="stat"><b>#${rank}</b><span>${m.label}</span></div>
      <div class="stat"><b>#${natl.indexOf(c) + 1}</b><span>National (${c.x === 'w' ? "women's" : "men's"})</span></div>
    </div>
    ${cupRec.length ? `<div class="kicker" style="margin-top:10px">U.S. Open Cup &middot; real results, ${Math.min(...cupRec.map(e => e.y))}&ndash;${Math.max(...cupRec.map(e => e.y))}</div>
    <div class="histwrap" tabindex="0" role="region" aria-label="U.S. Open Cup match history"><ul class="careerway">${cupRec.slice().reverse().map(e => {
      const wl = e.gf > e.ga ? 'W' : e.gf < e.ga ? 'L' : (e.pens ? (e.pens[0] > e.pens[1] ? 'W' : 'L') + ' pens' : 'D');
      return `<li><span class="cw-years">${e.y}</span><span class="cw-club">${e.ha === 'H' ? 'v' : 'at'} ${esc(e.opp)} &middot; ${e.gf}&ndash;${e.ga}${e.aet ? ' aet' : ''}${e.pens ? ` (${e.pens[0]}&ndash;${e.pens[1]}p)` : ''}</span><span class="cw-stat">${wl}${e.d ? ` &middot; ${e.d > 0 ? '+' : ''}${e.d}` : ''}</span></li>`;
    }).join('')}</ul></div>
    <p class="note">${c.g === 'mls' ? 'Shown for the record — MLS ranks by the official league table, so Cup results never move an MLS rating here.' : 'These matches move the rating. Cross-tier cup results are where the levels actually meet; extra-time and shootout wins count at reduced weight.'}${c.pv ? " Marked provisional: most of this club's cup movement came against opponents outside our database, valued at league average." : ''}</p>` : ''}
    ${c.re ? `<p class="note" style="margin:2px 0 10px;font-size:.78rem">Results-only Elo: <b>${c.re}</b> · experimental — computed from every 2026 match and published for transparency; the headline rating and ranks above stay with the official league table.</p>` : ''}
    ${c.r ? `<div class="kicker">Rivalry Radar · nearest rated rivals</div>
    <p class="note" style="margin:2px 0 8px">Who's nearby, and how the model thinks it would go — a discovery feature, not a schedule. Verified fixtures appear when this league's feed connects.</p>
    ${(opps.length > 6 ? opps.slice(5, 7) : opps.slice(0, 2)).map((o, i) => matchCard(i === 0 ? c : o, i === 0 ? o : c, `${milesApart(c, o)} MI APART`)).join('') || '<p class="note">No rated opponents in the dataset yet.</p>'}
    <details class="how"><summary>How is this club's rating made?</summary><p>${c.rr === 1
      ? "From real results: Elo over this season's matches — everyone starts at 1500, winners take points from losers, weighted by upset size and goal margin, with a backtested tier-tuned home edge (+30 amateur, +65 pro)."
      : c.rr === 2
      ? 'From real league standings: points and goal difference set the rating band.'
      : c.rr === 3
      ? 'From Massey Ratings — an independent results-based power rating for college soccer — rescaled onto our Elo bands. Preseason values until fall results land; refreshed as the season runs.' + (c.re ? ' The smaller results-only Elo is experimental — same match-by-match walk we use everywhere else, shown for transparency but not used for ranks.' : '')
      : "Illustrative placeholder until this league's results feed is connected — the number demonstrates the product, not the club."}</p></details>` : `<div class="kicker">Matches</div><p class="note">Match history and fixtures appear when this league's results feed is connected — no invented games on real organizations.</p>`}
    ${squadFor(c).length ? `<div class="kicker" style="margin-top:14px">Squad</div>${verifyBadge(c)}
    <ul class="squad staff">${staffFor(c).map(st2 =>
      `<li><span class="sq-num">${st2.tag}</span><span class="sq-name">${esc(st2.name)}</span><span class="sq-pos">${st2.role}</span><span class="sq-age">${st2.age}</span><span class="sq-form"></span></li>`).join('')}</ul>
    <ul class="squad">${squadFor(c).map((pl, pi) =>
      `<li><a href="#/player/${c.id}/${pi}"><span class="sq-num">${pl.num}</span><span class="sq-name">${esc(pl.name)}</span><span class="sq-pos">${pl.pos}</span><span class="sq-age">${pl.real ? (pl.nat || '') : ''}</span><span class="sq-ga">${pl.pos === 'GK' ? pl.cs + ' CS' : pl.goals + 'g ' + pl.assists + 'a'}</span><span class="sq-form">${pl.pvr}</span></a></li>`).join('')}</ul>
    ` : `<div class="kicker" style="margin-top:14px">Squad</div><p class="note">Roster unclaimed. Real rosters come from league feeds and claimed clubs — no placeholder players on real organizations.</p><a class="claim" href="mailto:hello@rankedxi.com?subject=${encodeURIComponent('Claim club: ' + c.n)}" style="margin-top:6px">Run this club? Add your roster</a>`}
    ${worldLadder(c)}` : LEVELS.youth.includes(c.g) ? `<p class="note" style="font-size:.9rem">Youth directory listing — an active ${LEAGUES[c.g].label} member club. Youth organizations carry no ratings, fixtures, or player data here; the entry is name, league, and league-stated location only.</p>` : `<p class="note" style="font-size:.9rem">Expansion concept — not yet an active club. It appears on the map as a hollow pin.</p>`}
    ${(() => {
      if (!hist) return '';
      const rows = [];
      for (const [yr, teams] of Object.entries(hist)) {
        const r = teams.find(t => t.canon === c.n);
        if (r) rows.push({ yr, ...r, of: teams.length });
      }
      if (!rows.length) return '';
      rows.sort((a, b) => b.yr - a.yr);
      return `<div class="kicker" style="margin-top:14px">League finish by season · since ${rows[rows.length - 1].yr}</div>
      ${rankChart(rows, LEAGUES[c.g].color)}
      <div class="histwrap" tabindex="0" role="region" aria-label="League finish by season"><ul class="careerway">${rows.map(r =>
        `<li><span class="cw-years">${r.yr}</span><span class="cw-club">${r.w}-${r.d}-${r.l} · ${r.pts} pts</span><span class="cw-stat">${ord(r.pos)} of ${r.of}</span></li>`).join('')}</ul></div>
      <p class="note">Overall league finish by points, from Wikipedia season records back to the club's first season${rows.some(r => +r.yr < 2000) ? ' (shootout-era seasons scored as modern 3-1-0)' : ''}.</p>`;
    })()}
    ${hasLegends ? `<a class="fa-card" href="#/legends/${c.id}"><b>&#127942; All-Time Players</b><span>Every player who wore the shirt — the club's history in people.</span></a>` : ''}
    ${(() => {
      const kids = AFFIL[c.n] || [];
      const parent = Object.entries(AFFIL).find(([, v]) => v.some(a => a.split(' · ')[0] === c.n));
      if (!kids.length && !parent) return '';
      const linkify = nm => {
        const base = nm.split(' · ')[0];
        const idx = CLUBS.findIndex(o => o.n === base);
        return idx >= 0 ? `<a href="${clubHref(idx)}">${nm}</a>` : nm;
      };
      return `<div class="kicker">Pathway</div><ul class="pathway">` +
        (parent ? `<li><span>Parent club</span><b>${linkify(parent[0])}</b></li>` : '') +
        kids.map(k => `<li><span>Second team</span><b>${linkify(k)}</b></li>`).join('') +
        `</ul><p class="note">The route a player climbs: second team to first team, tier to tier.</p>`;
    })()}
    <p class="note">${(c.si || c.sx || c.url) ? 'Official site and social links above come from Wikidata and league sources — they go exactly where they say.' : 'Club website and socials appear at the top once the club claims its page — links always go exactly where they say.'}</p>
    <a class="claim" href="mailto:hello@rankedxi.com?subject=${encodeURIComponent('Claim club: ' + c.n)}">Run this club? Claim this page</a>
    <p class="note">Claimed clubs manage their crest, links, roster and schedule.</p>
    ${reportLink('Fix', c.n)}`;
  wireFav();
  const pb = view.querySelector('.predictbtn2');
  if (pb) pb.addEventListener('click', () => openPredict(pb.dataset.predict));
}

function screenAbout() {
  crumb.textContent = 'About';
  view.innerHTML = `<div class="about">
    <div class="kicker">About</div>
    <h2 class="disp">One pyramid, one table</h2>
    <p>American soccer has no single place to see every club, how they rank, and how the levels connect. <b>Ranked XI</b> maps all of it: MLS to the grassroots, with men's and women's tables ranked separately.</p>
    <p><b>How rankings work.</b> League results feed a weekly Elo rating. Cup competitions — Open Cup qualifying, the National Amateur Cup — are where leagues actually meet, and those matches calibrate the cross-league scale. Every rating change is published with the match that caused it. College teams don't play in the Cups, so their layers are ordered by independent Massey ratings and placed in calibrated bands — men's capped below the pro leagues, women's higher (college is the women's development tier) — see <a href="/methodology" style="color:var(--accent)">Methodology</a>.</p>
    <p><b>World context.</b> Each club page projects the club onto a hypothetical global ladder against European reference sides — a conversation-starter, clearly labeled, never presented as measurement.</p>
    <p><b>What's real.</b> All ${CLUBS.filter(c => !c.h).length.toLocaleString()} clubs and locations come from what the leagues publish. Ratings label their basis on every page — real results, real standings, an independent results model, or an illustrative placeholder until that league's feed connects. Fixtures and results are never invented: match data appears only where a real feed provides it.</p>
    <p><b>Pricing.</b> The app is free; paid extras are listed plainly at <a href="#/pricing" style="color:var(--accent)">Pricing</a>.</p>
    <p><b>Roadmap.</b> Amateur league layers (UPSL, NPSL, USL League Two) from live feeds · claimed club pages · player profiles · clean crest art · youth club directory layer.</p>
    <div class="kicker" style="margin-top:14px">The leagues</div>
    <ul class="lglist">${Object.entries(LEAGUES).filter(([k, m]) => m.url).map(([k, m]) =>
      `<li><a href="${m.url}" target="_blank" rel="noopener">${m.img ? `<img src="${m.img}" alt="" loading="lazy">` : `<span class="dot" style="background:${m.color};width:12px;height:12px;border-radius:50%"></span>`}<b>${m.label}</b><span>${m.url.replace('https://', '').replace('www.', '')}</span></a></li>`).join('')}</ul>
    <div class="kicker" style="margin-top:14px">Get launch updates</div>
    <form class="joinform" novalidate>
      <input type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px">
      <input type="text" name="name" placeholder="Name (optional)" autocomplete="name" maxlength="80">
      <input type="email" name="email" placeholder="Email" required autocomplete="email" maxlength="254">
      <select name="role" aria-label="I am a"><option value="">I'm a&hellip;</option><option value="fan">Fan</option><option value="player">Player</option><option value="club">Club / coach</option><option value="league">League staff</option><option value="other">Other</option></select>
      <input type="text" name="state" placeholder="State (optional)" maxlength="40">
      <button type="submit" class="joinbtn">Join the list</button>
    </form>
    <p class="join-msg" role="status" aria-live="polite"></p>
    <div class="kicker" style="margin-top:14px">Help us get it right</div>
    <div class="linkrow">
      <a href="mailto:hello@rankedxi.com?subject=${encodeURIComponent('RankedXI Fix: ')}&body=${encodeURIComponent('Page or club:\nWhat is wrong:\n')}"><b>Report an error</b></a>
      <a href="mailto:hello@rankedxi.com?subject=${encodeURIComponent('RankedXI Suggest: league or team')}&body=${encodeURIComponent('League or team name:\nLevel and region:\nWebsite if known:\n')}">Suggest a league or team</a>
    </div>
    <p class="note">Reports route straight into the fix queue — most data corrections ship within a couple of days.</p>
    <div class="kicker" style="margin-top:14px">Fair questions</div>
    <details class="how"><summary>Why would a club use this?</summary><p>Because nowhere else puts your club in national context. A rank next to every level of American soccer is a recruiting tool — "#356 in the country" means something to a player choosing where to sign. And for clubs whose whole web presence is an Instagram, a claimed page here is a free, permanent home: crest, roster, schedule, links.</p></details>
    <details class="how"><summary>What does a player get?</summary><p>A record that travels: real stats where league data exists, a page you can link anywhere, and the pathway between levels made visible. Players without a club can list on the free-agent board — clubs browse free, and verified badges mark only what we can actually check.</p></details>
    <details class="how"><summary>Why would a league share its data?</summary><p>Standings are already public — the choice isn't privacy, it's accuracy. Leagues that work with us get their clubs shown correctly and refreshed automatically, with crests, watch links, and traffic routed back to the league's own site. The alternative is being represented by whatever we can piece together from public pages.</p></details>
    <details class="how"><summary>Could an amateur club really rank next to MLS?</summary><p>Only by earning it. Every league is anchored to the level it demonstrates where the levels actually meet — we measured ~600 cross-league U.S. Open Cup results from the last five editions to set the gaps. A club that beats professional sides in the Cup climbs match by match, and every rating point gained is listed on the club's page next to the result that caused it. No club reaches the MLS band on league form alone — the only way up is the honest one: beat clubs above you in a real match.</p></details>
    <details class="how"><summary>How is this free? Will it stay free?</summary><p>The rankings cost almost nothing to serve and they will stay free — they're the point of the site, not the product. Paid extras are optional recruiting tools for clubs and players, listed plainly at <a href="#/pricing" style="color:var(--accent)">Pricing</a>. Nothing behind the map or the table will ever move behind a paywall.</p></details>
    <details class="how"><summary>Are players ranked too?</summary><p>Professionals are — position rankings built from real published stats, and only players with real stats rank against each other. Amateur players are never auto-ranked: a national number attached to your name should be something you opted into. Verified, claimed profiles will enter the ranked pool by choice — get ranked, get seen — and that pool grows as clubs and players claim their pages.</p></details>
    <div class="kicker" style="margin-top:14px">Coming layers</div>
    <ul class="lglist">${ROADMAP.map(r =>
      `<li><a href="${r.url}" target="_blank" rel="noopener"><span class="dot" style="background:var(--ink-dim);width:12px;height:12px;border-radius:50%;opacity:.4"></span><b>${r.label}</b><span>~${r.teams} teams · ${r.sex === 'w' ? "women's" : "men's"}</span></a></li>`).join('')}</ul>
    <p class="note">NISA is currently unsanctioned by U.S. Soccer (Dec 2024); its clubs are shown for completeness. UPSL layer holds the clubs mapped so far — the full league is 400+ clubs.</p>
    <p class="fine" style="font-size:.75rem">Data last refreshed: ${BUILD_DATE} &middot; rosters and stats auto-refresh every 12 hours &middot; <a href="#/legal" style="color:var(--accent)">Terms &amp; Privacy</a> &middot; <a href="/methodology" style="color:var(--accent)">Methodology &amp; Disclaimer</a></p>
    <p class="fine" style="font-size:.75rem">Data: Wikipedia (CC BY-SA — rosters, profiles, photos, crests), league sites and public feeds (NPSL/Squadi, UPSL), OpenStreetMap Nominatim geocoding. Club and league marks belong to their owners.</p>
    <p class="fine" style="font-size:.75rem">Built by Jeremy Kientz · 2026</p>
  </div>`;
  wireJoinForm();
}

function wireJoinForm() {
  const form = view.querySelector('.joinform');
  if (!form) return;
  const msg = view.querySelector('.join-msg');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(form);
    const email = (f.get('email') || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { msg.textContent = 'A real email address is required.'; return; }
    msg.textContent = 'Saving…';
    try {
      const r = await fetch('/api/signup', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'updates', source: 'app-about', email,
          name: f.get('name'), role: f.get('role'), state: f.get('state'), website: f.get('website') })
      });
      const d = await r.json();
      if (d.ok) { form.reset(); msg.textContent = "You're on the list — see you at launch."; }
      else msg.textContent = d.error || 'Could not save right now — please try again.';
    } catch { msg.textContent = 'Could not save right now — please try again.'; }
  });
}

function playerLadder(pl, c) {
  if (!pl.rs) return '';
  const peers = allPlayers(c.x).filter(p => p.pos === pl.pos && p.rs).sort((a, b) => b.pvr - a.pvr);
  if (peers.length < 5) return '';
  const top = peers[0], med = peers[Math.floor(peers.length / 2)];
  const rows = [
    { n: "Elite Europe (Ballon d'Or tier)", v: Math.round(top.pvr * 1.6), ref: true },
    { n: 'Top-5 European league starter', v: Math.round(top.pvr * 1.05), ref: true },
    { n: `${top.name} — best US ${pl.pos} (real)`, v: top.pvr, ref: true },
    { n: 'European second-tier starter', v: Math.round(top.pvr * 0.55), ref: true },
    { n: `US pro median ${pl.pos} (real)`, v: med.pvr, ref: true },
    { n: pl.name, v: pl.pvr, ref: false }
  ].sort((a, b) => b.v - a.v);
  return `<div class="kicker" style="margin-top:12px">Position context &middot; domestic real, world hypothetical</div>
    <ul class="ladder">${rows.map(r =>
      `<li class="${r.ref ? '' : 'me'}"><span class="ln">${esc(r.n)}</span><span class="lr">${r.v}</span></li>`).join('')}</ul>
    <p class="note">Domestic anchors are real 2026 value ratings. European tiers are transparent projections (multiples of the US pool's best) &mdash; a conversation, not a measurement.</p>`;
}
async function screenPlayer(ci, pi) {
  const cidx = clubIdx(String(ci));
  if (cidx < 0) return screenMap();
  if (String(ci) !== CLUBS[cidx].id) { location.replace('#/player/' + CLUBS[cidx].id + '/' + pi); return; }
  const c = CLUBS[cidx]; if (!c.r) return screenMap();
  const sq = squadFor(c); const pl = sq[+pi]; if (!pl) return screenClub(ci);
  const prof = pl.real ? ((await profilesDb())[pl.name] || {}) : {};
  if (crumb.textContent !== c.st && location.hash !== `#/player/${ci}/${pi}`) return;
  crumb.textContent = c.st;
  const peers = allPlayers(c.x).filter(p => p.pos === pl.pos && (!pl.rs || p.rs)).sort((a, b) => b.pvr - a.pvr);
  const rank = peers.findIndex(p => p.c === c && p.i === +pi) + 1;
  view.innerHTML = `
    <button class="backbtn" onclick="history.length>1?history.back():location.hash='#/club/${ci}'">&larr; ${esc(c.n)}</button>
    <div class="clubhead">
      <img class="pphoto" src="${prof.photo || AVATAR}" alt="${esc(pl.name)}" onerror="this.src='${AVATAR}'">
      <div><h2 class="disp" style="margin:0">${esc(pl.name)}</h2>
      <span class="sub">#${pl.num} · ${pl.pos}${pl.real ? (pl.nat ? ' · ' + pl.nat : '') : ' · ' + pl.age + ' yrs'} · ${esc(c.n)}</span></div>
    </div>
    ${verifyBadge(c)}
    ${prof.claimed ? '<span class="badge v">&#10003; Claimed profile</span> ' : ''}${prof.fa ? '<span class="badge c">Free agent &middot; available</span>' : ''}
    <div class="statgrid">
      <div class="stat"><b>${pl.pvr}</b><span>Value rating</span></div>
      <div class="stat"><b>#${rank}</b><span>${pl.pos} · ${pl.rs ? 'pro pool (real stats)' : (c.x === 'w' ? "women's" : "men's") + ' pool'}</span></div>
      <div class="stat"><b>${pl.apps}</b><span>Appearances</span></div>
      ${pl.pos === 'GK'
        ? (pl.rs
          ? `<div class="stat"><b>${pl.saves}</b><span>Saves (real)</span></div>
             ${pl.gc != null ? `<div class="stat"><b>${pl.gc}</b><span>Goals conceded</span></div>` : ''}
             ${pl.gc != null && pl.saves + pl.gc > 0 ? `<div class="stat"><b>${Math.round(100 * pl.saves / (pl.saves + pl.gc))}%</b><span>Save rate</span></div>` : ''}
             <div class="stat"><b>${pl.mins.toLocaleString()}</b><span>Minutes (real)</span></div>`
          : `<div class="stat"><b>${pl.cs}</b><span>Clean sheets</span></div>
             <div class="stat"><b>${pl.saves}</b><span>Saves</span></div>
             <div class="stat"><b>${pl.mins.toLocaleString()}</b><span>Minutes</span></div>`)
        : (pl.rs
          ? `<div class="stat"><b>${pl.goals}</b><span>Goals (real)</span></div>
             <div class="stat"><b>${pl.assists}</b><span>Assists (real)</span></div>
             ${pl.xg != null ? `<div class="stat"><b>${pl.xg}</b><span>xG (real)</span></div>` : ''}
             ${pl.sh != null ? `<div class="stat"><b>${pl.sh}</b><span>Shots · ${pl.sot || 0} on target</span></div>` : ''}
             ${pl.xa != null ? `<div class="stat"><b>${pl.xa}</b><span>xA (real)</span></div>` : ''}
             ${pl.kp != null ? `<div class="stat"><b>${pl.kp}</b><span>Key passes</span></div>` : ''}`
          : `<div class="stat"><b>${pl.goals}</b><span>Goals</span></div>
             <div class="stat"><b>${pl.assists}</b><span>Assists</span></div>
             <div class="stat"><b>${pl.mins.toLocaleString()}</b><span>Minutes</span></div>`)}
    </div>
    <p class="note">Value rating weights goals, assists, minutes and keeper actions by the strength of the team's opposition (model formula over illustrative stats). ${pl.yc == null ? '' : `Cards: ${pl.yc} yellow${pl.rc ? ', 1 red' : ''}.`}</p>
    ${pl.rs && rank ? `<p class="pheadline">${ord(rank)}-best ${({GK:'goalkeeper',DF:'defender',MF:'midfielder',FW:'forward'})[pl.pos]} in the nation <span>real 2026 stats · pro pool</span></p>` : ''}
    ${favBtn('players', ci + '/' + pi)}
    ${playerLadder(pl, c)}
    ${(prof.career || prof.youth || prof.college) ? `<div class="kicker" style="margin-top:10px">Career pathway</div>
    <ul class="careerway">
      ${(prof.youth || []).map(y => `<li><span class="cw-years">youth</span><span class="cw-club">${esc(y)}</span><span class="cw-stat"></span></li>`).join('')}
      ${prof.college ? `<li><span class="cw-years">college</span><span class="cw-club">${esc(prof.college)}</span><span class="cw-stat"></span></li>` : ''}
      ${(prof.career || []).map(careerRow).join('')}
    </ul>` : ''}
    <div class="kicker" style="margin-top:10px">International</div>
    ${(() => { if (prof.nat) prof.nat = prof.nat.filter(n2 => n2.team && !/[|={}]/.test(n2.team)); if (prof.career) prof.career = prof.career.filter(s2 => s2.club && !/[|={}]/.test(s2.club)); return ''; })()}
    ${(prof.nat && prof.nat.length) ? `<ul class="careerway">${prof.nat.map(n2 =>
      `<li><span class="cw-years">${esc(n2.years || '')}</span><span class="cw-club">${esc(n2.team)}</span><span class="cw-stat">${n2.caps ? n2.caps + ' caps' + (n2.goals ? ' · ' + n2.goals + ' gls' : '') : ''}</span></li>`).join('')}</ul>`
    : `<p class="note">${pl.real
      ? `Nationality: <b>${pl.nat || 'unlisted'}</b>. No national-team record listed.`
      : `Illustrative player — international records shown only for real rosters.`}</p>`}
    ${(prof.honours && prof.honours.length) ? `<div class="kicker" style="margin-top:10px">Honours</div>
    <ul class="honours">${prof.honours.map(h2 => `<li><b>${esc(h2.t)}</b><span>${h2.y.join(', ')}</span></li>`).join('')}</ul>`
    : (pl.real && pl.wiki ? `<div class="kicker" style="margin-top:10px">Honours</div>
    <p class="note">Full honours and records on <a href="${pl.wiki}#Honours" target="_blank" rel="noopener" style="color:var(--accent)">the player's Wikipedia page</a> — structured list lands with the next profile refresh.</p>` : '')}
    <div class="kicker" style="margin-top:10px">Links</div>
    <div class="linkrow">
      ${prof.site ? `<a href="${safeHref(prof.site)}" target="_blank" rel="noopener"><b>Official site</b></a>` : ''}
      ${prof.ig ? `<a href="${safeHref(prof.ig)}" target="_blank" rel="noopener">Instagram</a>` : ''}
      ${prof.x ? `<a href="${safeHref(prof.x)}" target="_blank" rel="noopener">X</a>` : ''}
      ${pl.wiki ? `<a href="${safeHref(pl.wiki)}" target="_blank" rel="noopener">Wikipedia bio</a>` : ''}
      <a href="https://www.transfermarkt.us/schnellsuche/ergebnis/schnellsuche?query=${encodeURIComponent(pl.name)}" target="_blank" rel="noopener">Transfermarkt</a>
    </div>
    ${(prof.ig || prof.x || prof.site) ? '' : '<p class="note">Socials appear when listed on the player\'s Wikipedia article or once the player claims the profile — no guessed links.</p>'}
    ${pl.real ? `<details class="how" style="margin-top:14px"><summary><b>Is this you? Claim your profile — free</b></summary>
      <p class="note">Claimed profiles add film links, socials, corrected history, and recruiting visibility — and claiming is how you join the <a href="#/freeagents" style="color:var(--accent)">Free Agents board</a>. Every claim is verified with the club or league before anything changes; nothing publishes automatically.</p>
      <form class="joinform claimform" novalidate>
        <input type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px">
        <input type="text" name="name" placeholder="Your name" autocomplete="name" maxlength="80">
        <input type="email" name="email" placeholder="Email" required autocomplete="email" maxlength="254">
        <select name="role" aria-label="I am"><option value="player">I'm this player</option><option value="agent">Agent / representative</option><option value="club">Club officer</option></select>
        <input type="text" name="note" placeholder="Anything to add? Film link, correction… (optional)" maxlength="200">
        <label class="ck"><input type="checkbox" name="fa" value="1"> Also list me on the Free Agents board — I confirm I'm 18 or older</label>
        <button type="submit" class="joinbtn">Claim this profile</button>
      </form>
      <p class="join-msg claim-msg" role="status" aria-live="polite"></p>
    </details>` : ''}
    ${reportLink('Fix', pl.name)}`;
  wireFav();
  wireClaimForm(pl, c);
}

function wireClaimForm(pl, c) {
  const form = view.querySelector('.claimform');
  if (!form) return;
  const msg = view.querySelector('.claim-msg');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(form);
    const email = (f.get('email') || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { msg.textContent = 'A real email address is required.'; return; }
    msg.textContent = 'Saving…';
    const note = String(f.get('note') || '').slice(0, 200);
    const message = `claim: ${pl.name} @ ${c.n} [${c.id}] · fa:${f.get('fa') ? 'yes' : 'no'}${note ? ' · ' + note : ''}`;
    try {
      const r = await fetch('/api/signup', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'claim', source: 'player-page', email,
          name: f.get('name'), role: f.get('role'), message, website: f.get('website') })
      });
      const d = await r.json();
      if (d.ok) { form.reset(); msg.textContent = 'Claim received — we verify with the club or league and reply within a few days.'; }
      else msg.textContent = d.error || 'Could not save right now — please try again.';
    } catch { msg.textContent = 'Could not save right now — please try again.'; }
  });
}

let tableMode = 'clubs', posFilter = 'all', tableLimit = 40;
const TIERS = {
  m: [
    { t: 'Division I', pro: true, leagues: ['mls'] },
    { t: 'Division II', pro: true, leagues: ['uslc'] },
    { t: 'Division III', pro: true, leagues: ['usl1', 'mnp'], extra: ['nisa'], note: 'NISA: professional sanctioning not awarded — unsanctioned since Dec 2024' },
    { t: 'National amateur', leagues: ['npsl', 'usl2', 'upsl'] },
    { t: 'Regional & emerging', leagues: ['apsl', 'gcpl', 'loc', 'swpl', 'mpl', 'mwpl', 'cpl'], coming: [
      /* The old Eastern Premier (EPSL) is NOT missing: it renamed to APSL in
         Feb 2025 and is already a rated layer above. */
      'More regional leagues', 'State, city & rec leagues'] },
    { t: 'College', leagues: ['ncaa1', 'ncaa2', 'ncaa3', 'naia'] },
    { t: 'Youth', leagues: ['mlsnext', 'ecnlb', 'ecrlb', 'ea'] }
  ],
  w: [
    { t: 'Division I', pro: true, leagues: ['nwsl', 'uslw'] },
    { t: 'Division II', pro: true, coming: ['WPSL Pro · launching 2026-27'] },
    { t: 'National amateur', leagues: ['uslwl', 'wpsl', 'uws'] },
    { t: 'Regional & emerging', leagues: ['uws2', 'cplw'], coming: ['More regional leagues'] },
    { t: 'College', leagues: ['ncaa1w', 'ncaa2w'], coming: ['D3 / NAIA women · next'] },
    { t: 'Youth', leagues: ['ga', 'ecnlg', 'ecrlg', 'gaa'] }
  ]
};
function screenPyramid() {
  crumb.textContent = 'Tiers';
  const count = g => CLUBS.filter(c => c.g === g && !c.h).length;
  view.innerHTML = `
    ${sexToggle()}
    <div class="kicker">The structure of American soccer</div>
    <h2 class="disp">The Pyramid</h2>
    <div class="tiers">${TIERS[sex].map((tier, i) => `
      <div class="tier" style="width:${100 - i * (52 / TIERS[sex].length)}%">
        <div class="tier-label">${tier.t}${tier.pro ? ' · pro' : ''}</div>
        <div class="tier-leagues">
          ${(tier.leagues || []).map(g => { const m = LEAGUES[g]; const inner = `${m.img ? `<img class="${m.inv ? 'inv-' + m.inv : ''}" src="${m.img}" alt="" onerror="this.style.display='none'">` : `<span class="dot" style="background:${m.color}"></span>`}<b>${m.label}</b><span>${count(g)} clubs</span>`; return m.url ? `<a class="tierlg" href="${m.url}" target="_blank" rel="noopener">${inner}</a>` : `<span class="tierlg">${inner}</span>`; }).join('')}
          ${(tier.extra || []).map(g => { const m = LEAGUES[g]; const inner = `${m.img ? `<img class="${m.inv ? 'inv-' + m.inv : ''}" src="${m.img}" alt="" onerror="this.style.display='none'">` : ''}<b>${m.label}</b><span>${count(g)} clubs</span>`; return m.url ? `<a class="tierlg dimmed" href="${m.url}" target="_blank" rel="noopener">${inner}</a>` : `<span class="tierlg dimmed">${inner}</span>`; }).join('')}
          ${(tier.coming || []).map(c => c.url
            ? `<a class="tierlg coming" href="${c.url}" target="_blank" rel="noopener">${c.img ? `<img src="${c.img}" alt="">` : ''}<b>${c.label}</b><span>league site</span></a>`
            : `<span class="tierlg coming"><b>${c.label || c}</b></span>`).join('')}
        </div>
        ${tier.note ? `<div class="tier-note">${tier.note}</div>` : ''}
      </div>`).join('')}
    </div>
    <a class="fa-card" href="#/cups"><b>&#127942; The Trophy Room</b><span>16 national trophies, every tier — MLS Cup to the NPSL, the College Cups, and the Open Cup back to 1914.</span></a>
    <a class="fa-card" href="#/nt"><b>&#127482;&#127480; National Teams</b><span>Above the pyramid — USA youth national teams in Concacaf and FIFA competition, with fixtures and how to watch.</span></a>
    ${adSlot('tiers', 'The Pyramid')}
    <p class="note">Tiers are organizational, not sporting — US soccer has no promotion and relegation between most levels. The pathway runs through players, not clubs: youth to college to the amateur leagues to the pro game. Tap a league to visit its official site.</p>`;
  wireSexToggle();
}

const FREE_AGENTS = [
  { name: 'Sample: J. Alvarez', pos: 'FW', age: 23, region: 'SoCal', last: 'UPSL Premier', seeks: 'USL2 / NPSL trial', video: true },
  { name: 'Sample: M. Okoye', pos: 'DF', age: 21, region: 'DFW, Texas', last: 'NCAA D2', seeks: 'UPSL Premier+', video: true },
  { name: 'Sample: T. Nguyen', pos: 'GK', age: 25, region: 'Pacific NW', last: 'NPSL', seeks: 'Open tryouts', video: false },
  { name: 'Sample: D. Carter', pos: 'MF', age: 22, region: 'Southeast', last: 'NCAA D1', seeks: 'MLS Next Pro / USL1', video: true }
];
function screenFreeAgents() {
  crumb.textContent = 'Free agents';
  view.innerHTML = `
    <div class="kicker">Get seen by ${CLUBS.filter(c => !c.h).length.toLocaleString()} clubs</div>
    <h2 class="disp">Free Agents</h2>
    <p class="note" style="font-size:.88rem">Players without a club list themselves here: position, region, level sought, film. Clubs browse free and reach out directly — Ranked XI never sits in the middle of a deal. Listings are self-reported; players with match history in our data carry a verified badge.</p>
    <a class="fa-card" href="#/freeagent/sample"><b>See a complete profile &rarr;</b><span>Film, physicals, verified history, awards, references — the full page a listing buys.</span></a>
    <a class="fa-card" href="#/tryouts"><b>&#128197; Open Tryouts board &rarr;</b><span>Every posted tryout date, one calendar — free for clubs to post, free for players to browse.</span></a>
    <ul class="clublist">${FREE_AGENTS.map(f => `
      <li><a href="#/freeagent/sample">
        <img class="crest imgcrest" src="${AVATAR}" alt="">
        <span class="cl-name"><b>${f.name}</b><span>${f.pos} · ${f.age} · ${f.region} · last: ${f.last}</span></span>
        <span class="cl-rt" style="font-size:.7rem;color:var(--ink-dim)">${f.seeks}${f.video ? ' · film' : ''}</span></a></li>`).join('')}</ul>
    <p class="note">Sample listings — the real board opens with player claims. Listings are for players <b>18 and older</b>, arrive by email, and every one is human-reviewed before it publishes — nothing posts to this board automatically.</p>
    ${adSlot('freeagents', 'Free Agents board')}
    <a class="claim" href="mailto:hello@rankedxi.com?subject=${encodeURIComponent('Free agent listing request')}&body=${encodeURIComponent('I confirm I am 18 or older: \nName:\nPosition:\nAge:\nRegion:\nLast club/level:\nLevel seeking:\nHighlight film link:\n')}">List yourself — $25 per season</a>
    <p class="note">Flat listing fee. No commissions, no placement cuts — your deal is yours. Clubs: browsing is free, and posting open-tryout dates is free too — <a href="#/tryouts" style="color:var(--accent)">post on the Tryouts board</a>. <a href="#/pricing" style="color:var(--accent)">See all pricing &rarr;</a></p>
    <p class="note"><a href="mailto:${NOTICE_MAIL}?subject=${encodeURIComponent('Report a free agent listing')}&body=${encodeURIComponent('Listing (name shown):\nWhat is wrong (impersonation, inaccurate, inappropriate, other):\n')}" style="color:var(--accent)">Report a listing</a> — reports are reviewed within days; a listing that misrepresents someone comes down first, questions after.</p>`;
}

let tryoutSex = 'all';
async function screenTryouts() {
  crumb.textContent = 'Tryouts';
  const all = await tryoutsDb();
  if (location.hash !== '#/tryouts') return;
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = all.filter(t => t.date >= today).sort((a, b) => a.date < b.date ? -1 : 1);
  const list = tryoutSex === 'all' ? upcoming : upcoming.filter(t => t.x === tryoutSex);
  const fmtDay = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const card = t => {
    /* clubId is never submitted — it's added by hand during moderation when
       the club already exists in CLUBS, so the card can link its page */
    const ci = t.clubId ? clubIdx(t.clubId) : -1;
    const meta = [t.city && t.st ? `${esc(t.city)}, ${esc(t.st)}` : esc(t.st || t.city || ''), t.league ? esc(t.league) : '', t.details ? esc(t.details) : ''].filter(Boolean).join(' · ');
    return `<div class="pricecard"><b>${esc(t.club)} · ${fmtDay(t.date)}${t.time ? ' · ' + esc(t.time) : ''}</b>${t.sample ? ' <span class="badge d">Sample</span>' : ''}
      <p>${meta}</p>
      ${(ci >= 0 || t.link) ? `<div class="linkrow">${ci >= 0 ? `<a href="#/club/${CLUBS[ci].id}"><b>Club page</b></a>` : ''}${t.link ? `<a href="${safeHref(t.link)}" target="_blank" rel="noopener">Tryout details</a>` : ''}</div>` : ''}
    </div>`;
  };
  view.innerHTML = `
    <div class="kicker">Fill your roster · find your club</div>
    <h2 class="disp">Open Tryouts</h2>
    <p class="note" style="font-size:.88rem">Every open tryout in one place — the amateur leagues, one calendar. Posting is <b>free for every club</b>, and every listing is human-reviewed before it publishes. Players: tryouts listed here are for players <b>18 and older</b> unless the club's own page says otherwise.</p>
    <div class="chips seg" id="tsex">
      ${[['all', 'All'], ['m', "Men's"], ['w', "Women's"]].map(([k, lb]) =>
        `<button class="chip solid" data-tsx="${k}" aria-pressed="${tryoutSex === k}">${lb}</button>`).join('')}
    </div>
    ${list.length ? list.map(card).join('') : '<p class="note">No upcoming tryouts in this filter yet — check back, or post the first one below.</p>'}
    ${list.some(t => t.sample) ? '<p class="note">Sample listings show the format — they clear out as real dates land. The board is new: clubs, the first posts are yours.</p>' : ''}
    <div class="kicker" style="margin-top:16px">Post a tryout · free</div>
    <form class="joinform tryform" novalidate>
      <input type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px">
      <input type="text" name="club" placeholder="Club name" required maxlength="80">
      <input type="text" name="league" placeholder="League / level" maxlength="60">
      <input type="date" name="date" required aria-label="Tryout date">
      <input type="text" name="city" placeholder="City" maxlength="60">
      <input type="text" name="state" placeholder="State" maxlength="40">
      <input type="url" name="link" placeholder="Details link (optional)" maxlength="300">
      <input type="text" name="details" placeholder="Fee, ages, what to bring (optional)" maxlength="200">
      <input type="email" name="email" placeholder="Contact email (not published)" required maxlength="254">
      <button type="submit" class="joinbtn">Submit for review</button>
    </form>
    <p class="join-msg try-msg" role="status" aria-live="polite"></p>
    <p class="note">Your contact email is for verification only — it is never published. Free agents: <a href="#/freeagents" style="color:var(--accent)">list yourself</a> so clubs can find you between tryout dates.</p>
    <p class="note"><a href="mailto:${NOTICE_MAIL}?subject=${encodeURIComponent('Report a tryout listing')}&body=${encodeURIComponent('Listing (club and date shown):\nWhat is wrong (fake, outdated, inappropriate, other):\n')}" style="color:var(--accent)">Report a listing</a> — outdated or fake tryouts come down first, questions after.</p>`;
  view.querySelector('#tsex').addEventListener('click', e => {
    const b = e.target.closest('[data-tsx]'); if (!b || b.dataset.tsx === tryoutSex) return;
    tryoutSex = b.dataset.tsx; screenTryouts();
  });
  wireTryoutForm();
}

function wireTryoutForm() {
  const form = view.querySelector('.tryform');
  if (!form) return;
  const msg = view.querySelector('.try-msg');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(form);
    const email = (f.get('email') || '').trim();
    if (!(f.get('club') || '').trim()) { msg.textContent = 'Club name is required.'; return; }
    if (!f.get('date')) { msg.textContent = 'A tryout date is required.'; return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { msg.textContent = 'A real contact email is required.'; return; }
    msg.textContent = 'Saving…';
    try {
      const r = await fetch('/api/tryouts', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: 'app-tryouts', email,
          club: f.get('club'), league: f.get('league'), date: f.get('date'), city: f.get('city'),
          state: f.get('state'), link: f.get('link'), details: f.get('details'), website: f.get('website') })
      });
      const d = await r.json();
      if (d.ok) { form.reset(); msg.textContent = 'Got it — your tryout goes live after a quick human review, usually within a day.'; }
      else msg.textContent = d.error || 'Could not save right now — please try again.';
    } catch { msg.textContent = 'Could not save right now — please try again.'; }
  });
}

function screenAdvertise() {
  crumb.textContent = 'Advertise';
  const mail = s => `mailto:hello@rankedxi.com?subject=${encodeURIComponent('Ad space inquiry — ' + s)}`;
  const SLOTS = [
    ['National map', '$299/mo', 'The home surface. Every session starts on the map — your creative sits directly beneath it, on every visit.', 'National map'],
    ['Free Agents board', '$149/mo', 'The recruiting audience: players looking for clubs and the clubs scouting them. Boots, fitness, training — this is your buyer.', 'Free Agents board'],
    ['The Pyramid', '$149/mo', 'The structure-of-American-soccer page — the screen leagues, media, and diehards share and screenshot.', 'The Pyramid'],
    ['The Wire', '$99/mo', 'Live results, rating swings, golden-boot races. The screen that gets checked after every matchday.', 'The Wire'],
  ];
  view.innerHTML = `
    <div class="kicker">Direct-sold · no ad networks · no tracking</div>
    <h2 class="disp">Advertise on Ranked XI</h2>
    <p class="note" style="font-size:.88rem">Four placements, sold directly. A sponsorship is a static creative and a link — we never add ad-network scripts or trackers, so your brand sits on a fast page next to real data, clearly labeled. Founding rates below are flat, month-to-month, and locked for 12 months once you're in.</p>
    ${SLOTS.map(([t, price, blurb, subj]) => `
    <div class="pricecard paid"><b>${t} · ${price}</b>
      <p>${blurb}</p>
      <a class="claim" href="${mail(subj)}">Ask about this placement</a></div>`).join('')}
    <div class="kicker" style="margin-top:16px">Regional — your market only</div>
    <div class="pricecard paid"><b>Regional sponsorship · $79/mo per region</b>
      <p>Your creative on every region and state screen inside <b>one region</b> — Northwest, Southwest, Midwest, South, Southeast, or Northeast. A San Diego shop sponsors the Southwest; fans in Ohio never see it, and that space stays sellable to someone in Ohio. Local rates for local reach; the national slots above stay independent.</p>
      <a class="claim" href="${mail('Regional sponsorship')}">Claim a region</a></div>
    <div class="pricecard"><b>Tier sponsorship · custom</b>
      <p>Exclusive "presented by" on a whole tier row of the Pyramid — one sponsor per tier, priced by tier. Leagues: sponsoring your own tier row comes with your data layer.</p>
      <a class="claim" href="${mail('Tier sponsorship')}">Talk to us</a></div>
    <p class="note">Honesty policy, same as everything here: we share real traffic numbers on request before you commit — no inflated reach claims. Sponsorships are labeled as such. If a placement underperforms, walk away month-to-month; founding rates exist because early sponsors take the early-traffic risk with us.</p>`;
}

function screenPricing() {
  crumb.textContent = 'Pricing';
  view.innerHTML = `
    <div class="kicker">What's free, what's paid — and why</div>
    <h2 class="disp">Ranked XI Pricing</h2>
    <div class="pricecard"><b>The app · Free, always</b>
      <p>Map, tables, every club and player page, predictions, history. Rankings stay free — that's the point.</p></div>
    <div class="pricecard"><b>Founding Free Agent listing · Free now, $25/season later</b>
      <p>Not "exposure" — proof and delivery: a <b>verified badge</b> backed by league data we already hold, your film front and center, <b>alerts sent to clubs in your region and level</b>, and a receipt: how many clubs viewed you. Founding listings are free while the market proves itself; the price turns on only when players are getting contacted.</p>
      <a class="claim" href="#/freeagent/sample">See a complete player listing</a></div>
    <div class="pricecard paid"><b>Free Agent Pro · $50/season</b>
      <p>Everything in the listing, plus <b>you make the first move</b>: send direct intro requests to clubs from inside Ranked XI — your verified profile and film attached — with <b>5 intros a month</b> and priority placement in club searches. Privacy holds both ways: no emails or numbers exposed until both sides accept the intro.</p>
      <a class="claim" href="#/freeagent/sample">See how intros work</a></div>
    <div class="pricecard paid"><b>Club Recruiting · Free browse for all clubs · Pro tools $99/season</b>
      <p>Browsing free agents costs nothing, ever — and so is <a href="#/tryouts" style="color:var(--accent)">posting open tryouts</a>. The paid tier is speed: <b>saved-search alerts</b> ("verified GK within 50 miles"), <b>unlimited direct contact</b>, <b>shortlists</b>, and <b>promoted tryout listings</b>. Fill your roster in a week, not a month.</p>
      <a class="claim" href="#/clubtools/sample">See the club recruiting tools</a></div>
    <div class="pricecard paid"><b>Claimed player profile · $30/year</b>
      <p>Verify your page: photo, film, socials, corrected history — and recruiting visibility.</p>
      <a class="claim" href="mailto:hello@rankedxi.com?subject=${encodeURIComponent('Claim my player profile')}">Claim yours</a></div>
    <div class="pricecard paid"><b>Sponsorships · from $99/mo</b>
      <p>Four direct-sold placements — map, free-agent board, pyramid, wire. Static creative + link, no ad networks, no trackers.</p>
      <a class="claim" href="#/advertise">See placements &amp; rates</a></div>
    <div class="pricecard paid"><b>Youth club directory placement · $99/year</b>
      <p>Your youth club on the national map with a pathway line to the pros above you.</p>
      <a class="claim" href="mailto:hello@rankedxi.com?subject=${encodeURIComponent('Youth club directory interest')}">Join the waitlist</a></div>
    <p class="note">Honesty policy: paid tiers switch on only after the marketplace demonstrably works — players getting contacted, clubs filling spots. Reserving is free and locks founding rates. No commissions, ever: your deals are yours.</p>`;
}
function screenFollowing() {
  crumb.textContent = 'Following';
  const f = favs();
  const clubRows = f.clubs.map(fid => { const i2 = clubIdx(fid); return i2 >= 0 ? clubRow(CLUBS[i2]) : ''; }).join('');
  const playerRows = f.players.map(id => {
    const [ci, pi] = id.split('/'); const c = CLUBS[clubIdx(ci)]; if (!c) return '';
    const pl = squadFor(c)[+pi]; if (!pl) return '';
    return `<li><a href="#/player/${id}"><img class="crest imgcrest" src="${AVATAR}" alt="">
      <span class="cl-name"><b>${esc(pl.name)}</b><span>${pl.pos} · ${esc(c.n)}</span></span>
      <span class="cl-rt">${pl.pvr}</span></a></li>`;
  }).join('');
  view.innerHTML = `
    <div class="kicker">Your clubs and players</div>
    <h2 class="disp">Following</h2>
    ${(!f.clubs.length && !f.players.length) ? `<p class="note" style="font-size:.9rem">Nothing yet. Tap <b>&#9734; Follow</b> on any club or player page and they'll live here — quick access from every visit, and match alerts once notifications land.</p>` : ''}
    ${f.clubs.length ? `<div class="kicker" style="margin-top:8px">Clubs · ${f.clubs.length}</div><ul class="clublist">${clubRows}</ul>` : ''}
    ${f.players.length ? `<div class="kicker" style="margin-top:12px">Players · ${f.players.length}</div><ul class="clublist">${playerRows}</ul>` : ''}
    ${(f.clubs.length || f.players.length) ? '<p class="note">To unfollow, open the page and tap the star again.</p>' : ''}`;
}

let legendSort = 'apps';
async function screenLegends(ci) {
  const cidx = clubIdx(String(ci)); if (cidx < 0) return screenMap();
  const c = CLUBS[cidx]; ci = c.id;
  crumb.textContent = c.st;
  const all = (await legendsDb())[c.n];
  if (!all || !all.length) { location.hash = '#/club/' + ci; return; }
  const topApps = all[0];
  const topGoals = [...all].sort((a, b) => b.goals - a.goals)[0];
  const sorted = legendSort === 'apps' ? all : [...all].sort((a, b) => b.goals - a.goals);
  view.innerHTML = `
    <button class="backbtn" onclick="location.hash='#/club/${ci}'">&larr; ${esc(c.n)}</button>
    <div class="clubhead">${crestHtml(c)}
      <div><h2 class="disp" style="margin:0">All-Time Players</h2>
      <span class="sub">${esc(c.n)} · ${all.length} players who wore the shirt</span></div>
    </div>
    <div class="statgrid" style="grid-template-columns:1fr 1fr">
      <div class="stat"><b>${esc(topApps.n)}</b><span>Most appearances · ${topApps.apps}</span></div>
      <div class="stat"><b>${esc(topGoals.n)}</b><span>Most goals · ${topGoals.goals}</span></div>
    </div>
    <div class="chips seg" id="lsort">
      <button class="chip solid" data-ls="apps" aria-pressed="${legendSort === 'apps'}">By appearances</button>
      <button class="chip solid" data-ls="goals" aria-pressed="${legendSort === 'goals'}">By goals</button>
    </div>
    <ul class="clublist">${sorted.slice(0, 100).map((pl, i) => `
      <li><a href="${pl.wiki || '#/legends/' + ci}" ${pl.wiki ? 'target="_blank" rel="noopener"' : ''}>
        <span class="rk">${i < 3 ? ['&#129351;', '&#129352;', '&#129353;'][i] : i + 1}</span>
        <span class="cl-name"><b>${esc(pl.n)}</b><span>${pl.pos}${pl.yrs ? ' · ' + pl.yrs : ''}</span></span>
        <span class="cl-rt">${legendSort === 'apps' ? pl.apps + ' apps' : pl.goals + ' gls'}</span></a></li>`).join('')}
    </ul>
    ${all.length > 100 ? `<p class="note">Showing the top 100 of ${all.length}.</p>` : ''}
    <p class="note">All-time records from Wikipedia (CC BY-SA) — league appearances and goals. Tap a player for their full story.</p>`;
  const seg = view.querySelector('#lsort');
  seg.addEventListener('click', e => {
    const b = e.target.closest('[data-ls]'); if (!b || b.dataset.ls === legendSort) return;
    legendSort = b.dataset.ls; screenLegends(ci);
  });
}

let _cups = null;
async function cupsDb() {
  if (_cups) return _cups;
  try { _cups = await (await fetch('data/cups.json?v=20260809d')).json(); }
  catch { _cups = {}; }
  return _cups;
}
async function screenCups() {
  crumb.textContent = 'Trophies';
  const cups = await cupsDb();
  const keys = Object.keys(cups);
  /* each trophy knows who can hold it: a men's cup must never link a
     women's club, and a college cup's short names ("North Carolina",
     "San Diego") must never resolve to pro or amateur sides */
  const WOMENS_CUPS = new Set(['nwsl', 'nwslshield', 'uslsuper', 'wpsl', 'uws', 'ncaaw']);
  const COLLEGE_CUPS = new Set(['ncaam', 'ncaaw']);
  const okFor = k => c =>
    c.x === (WOMENS_CUPS.has(k) ? 'w' : 'm') &&
    (COLLEGE_CUPS.has(k) ? LEVELS.college.includes(c.g) : !LEVELS.college.includes(c.g));
  const linkClub = (nm, k) => {
    const i = clubIdxByName(nm, okFor(k));
    return i >= 0 ? `<a href="#/club/${CLUBS[i].id}">${esc(nm)}</a>` : esc(nm);
  };
  /* winner line: score + opponent when the source table records a final;
     champions-list trophies (regular-season shields, older league lists)
     carry the winner alone rather than inventing a beaten finalist */
  const stat = f => f.s ? f.s + (f.ru ? ' v ' + esc(f.ru) : '') : f.ru ? 'def. ' + esc(f.ru) : '';
  const SECTIONS = [
    ['open', 'The open cups · any tier can enter'],
    ['pro', 'Professional titles'],
    ['am', 'Amateur national titles'],
    ['college', 'The College Cups'],
  ];
  const cupBlock = k => { const cup = cups[k]; return `
      <details class="how" ${k === 'opencup' ? 'open' : ''}><summary>${cup.label} · ${cup.finals.length} editions${cup.kind === 'open' ? ' · open to the whole pyramid' : ''}</summary>
      <ul class="careerway" style="max-height:320px;overflow-y:auto">${cup.finals.map(f =>
        `<li><span class="cw-years">${f.y}</span><span class="cw-club">${linkClub(f.w, k)}</span><span class="cw-stat">${stat(f)}</span></li>`).join('')}</ul></details>`; };
  view.innerHTML = `
    <div class="kicker">Every national trophy · pro, amateur, college & open</div>
    <h2 class="disp">The Trophy Room</h2>
    ${!keys.length ? '<p class="note">Tournament histories are loading into the dataset.</p>' : ''}
    ${SECTIONS.map(([kind, label]) => {
      const ks = keys.filter(k => cups[k].kind === kind);
      return ks.length ? `<div class="kicker" style="margin-top:14px">${label}</div>` + ks.map(cupBlock).join('') : '';
    }).join('')}
    <p class="note">The U.S. Open Cup is the pyramid's connective tissue — the one competition where any tier can play any other. Its results are what let cross-league ratings be measured instead of assumed. A finished season's champion appears once the result lands on the record — never before the final is played. UPSL histories are omitted until a reliable source exists. Histories from Wikipedia (CC BY-SA).</p>`;
}

function screenFASample() {
  crumb.textContent = 'Free agent';
  view.innerHTML = `
    <button class="backbtn" onclick="location.hash='#/freeagents'">&larr; Free Agents</button>
    <span class="badge c">Sample profile — this is what a listed free agent looks like</span>
    <div class="clubhead">
      <img class="pphoto" src="${AVATAR}" alt="">
      <div><h2 class="disp" style="margin:0">Jordan Alvarez</h2>
      <span class="sub">FW · 23 · Santa Ana, CA · open to relocate</span></div>
    </div>
    <div class="statgrid">
      <div class="stat"><b>5'11"</b><span>Height</span></div>
      <div class="stat"><b>165 lb</b><span>Weight</span></div>
      <div class="stat"><b>Right</b><span>Preferred foot</span></div>
      <div class="stat"><b>FW / RW</b><span>Positions</span></div>
      <div class="stat"><b>USL2 / NPSL</b><span>Level seeking</span></div>
      <div class="stat"><b>Now</b><span>Available</span></div>
    </div>
    <div class="kicker">Highlight reel</div>
    <a class="fa-card" href="#/freeagent/sample"><b>&#9654; 2026 Highlights · 4:12</b><span>Your film, front and center — the first thing a coach taps.</span></a>
    <div class="kicker" style="margin-top:12px">Verified history</div>
    <ul class="careerway">
      <li><span class="cw-years">2025–26</span><span class="cw-club">La Máquina FC · UPSL Premier</span><span class="cw-stat">22 apps · 9 gls &#10003;</span></li>
      <li><span class="cw-years">2023–25</span><span class="cw-club">Orange Coast College</span><span class="cw-stat">31 apps · 14 gls</span></li>
      <li><span class="cw-years">2019–23</span><span class="cw-club">Santa Ana United (youth)</span><span class="cw-stat"></span></li>
    </ul>
    <p class="note">&#10003; = seasons verified against league data already in Ranked XI — coaches trust numbers they can check.</p>
    <div class="kicker">Awards</div>
    <ul class="honours">
      <li><b>UPSL SoCal Golden Boot</b><span>2026 Spring</span></li>
      <li><b>All-Conference First Team (OEC)</b><span>2024</span></li>
    </ul>
    <div class="kicker">References</div>
    <ul class="careerway">
      <li><span class="cw-years">Coach</span><span class="cw-club">"Best pressing forward I've had in ten years. Motor never stops." — M. Reyes, La Máquina FC</span><span class="cw-stat"></span></li>
      <li><span class="cw-years">College</span><span class="cw-club">"Coachable, professional, trains like it's a final." — D. Whitman, OCC</span><span class="cw-stat"></span></li>
    </ul>
    <div class="kicker">Intro requests <span class="badge c" style="margin-left:6px">Pro</span></div>
    <ul class="careerway">
      <li><span class="cw-years">Sent 7/22</span><span class="cw-club">&rarr; Orange County SC &middot; "Available for trial, film attached"</span><span class="cw-stat" style="color:var(--accent)">Accepted &#10003;</span></li>
      <li><span class="cw-years">Sent 7/24</span><span class="cw-club">&rarr; La M&aacute;quina FC</span><span class="cw-stat">Pending</span></li>
      <li><span class="cw-years">3 left</span><span class="cw-club">this month &middot; contact details stay private until a club accepts</span><span class="cw-stat"></span></li>
    </ul>
    <div class="kicker">Contact & socials</div>
    <div class="linkrow">
      <a href="#/freeagent/sample"><b>Message via Ranked XI</b></a>
      <a href="#/freeagent/sample">Instagram</a>
      <a href="#/freeagent/sample">Hudl</a>
    </div>
    <a class="claim" href="mailto:hello@rankedxi.com?subject=${encodeURIComponent('Free agent listing request')}">Get your page — $25 per season</a>
    <p class="note">Every element above is included: film slot, physicals, verified season history, awards, coach references, direct contact. Clubs browse free. Listings are for players 18+, submitted by email and human-reviewed before publication.</p>
    <p class="note"><a href="mailto:${NOTICE_MAIL}?subject=${encodeURIComponent('Report a free agent listing')}" style="color:var(--accent)">Report this listing</a></p>`;
}

function openPredict(ci) {
  const home = CLUBS[+ci];
  if (!home || !home.r) return;
  document.querySelector('.sheet')?.remove();
  let lvl = 'all';
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.innerHTML = `<div class="sheet-panel">
    <div class="sheet-head"><b>Predict Result</b><button class="sheet-x" aria-label="Close">&times;</button></div>
    <div class="sheet-sub">${crestHtml(home)}<span><b>${esc(home.n)}</b><i>vs. choose an opponent</i></span></div>
    <div class="chips" id="predlvl">${['all', 'pro', 'amateur', 'college'].map(k =>
      `<button class="chip solid" data-plvl="${k}" aria-pressed="${k === 'all'}">${k === 'all' ? 'All levels' : k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div>
    <input id="predq" type="search" placeholder="Search opponent" autocomplete="off">
    <div class="sheet-list" id="predlist"></div>
    <div id="predout" hidden></div>
  </div>`;
  document.querySelector('.screen').appendChild(sheet);
  const list = sheet.querySelector('#predlist'), q = sheet.querySelector('#predq'), out = sheet.querySelector('#predout');
  const pool2 = () => {
    const lvls = LEVELS[lvl];
    let cands = CLUBS.map((c, i) => ({ c, i })).filter(o => o.c.r && o.c.x === home.x && o.i !== +ci && !o.c.h);
    if (lvls) cands = cands.filter(o => lvls.includes(o.c.g));
    const term = q.value.trim().toLowerCase();
    if (term) cands = cands.filter(o => o.c.n.toLowerCase().includes(term));
    return cands.sort((a, b) => b.c.r - a.c.r).slice(0, 40);
  };
  const renderList = () => {
    list.innerHTML = pool2().map(o =>
      `<a class="qrow" data-opp="${o.i}" href="javascript:void(0)">${crestHtml(o.c)}<span><b>${esc(o.c.n)}</b><i>${LEAGUES[o.c.g].label} · ${o.c.st} · ${o.c.r}</i></span></a>`).join('') || '<div class="qrow qnone">No matches</div>';
  };
  renderList();
  q.addEventListener('input', renderList);
  sheet.querySelector('#predlvl').addEventListener('click', e => {
    const b = e.target.closest('[data-plvl]'); if (!b) return;
    lvl = b.dataset.plvl;
    sheet.querySelectorAll('#predlvl .chip').forEach(x => x.setAttribute('aria-pressed', x.dataset.plvl === lvl));
    out.hidden = true; list.hidden = false; q.parentElement && (q.hidden = false);
    renderList();
  });
  list.addEventListener('click', e => {
    const a = e.target.closest('[data-opp]'); if (!a) return;
    const opp = CLUBS[+a.dataset.opp];
    out.innerHTML = matchCard(home, opp, 'HYPOTHETICAL') +
      `<button class="morebtn" id="predagain">Choose a different opponent</button>`;
    out.hidden = false; list.hidden = true; q.hidden = true;
    out.querySelector('#predagain').addEventListener('click', () => {
      out.hidden = true; list.hidden = false; q.hidden = false; q.focus();
    });
  });
  const close = () => sheet.remove();
  sheet.querySelector('.sheet-x').addEventListener('click', close);
  sheet.addEventListener('click', e => { if (e.target === sheet) close(); });
  addEventListener('hashchange', close, { once: true });
}

function screenClubTools() {
  crumb.textContent = 'Club tools';
  view.innerHTML = `
    <button class="backbtn" onclick="location.hash='#/pricing'">&larr; Pricing</button>
    <span class="badge c">Sample dashboard — what Club Recruiting Pro looks like</span>
    <h2 class="disp">Riverheim FC — Recruiting</h2>
    <div class="statgrid">
      <div class="stat"><b>3</b><span>Open roster spots</span></div>
      <div class="stat"><b>12</b><span>New matches this week</span></div>
      <div class="stat"><b>241</b><span>Tryout page views</span></div>
    </div>
    <div class="kicker">Intro requests from players &middot; free for every club</div>
    <ul class="clublist">
      <li><a href="#/freeagent/sample"><img class="crest imgcrest" src="${AVATAR}" alt=""><span class="cl-name"><b>Jordan Alvarez wants a trial</b><span>FW &middot; verified UPSL history &#10003; &middot; film attached</span></span><span class="cl-rt" style="font-size:.7rem;color:var(--accent)">Accept &middot; Pass</span></a></li>
    </ul>
    <div class="kicker">Saved searches · alerts on</div>
    <ul class="careerway">
      <li><span class="cw-years">&#128276; ON</span><span class="cw-club">Verified GK · within 50 mi · UPSL level+</span><span class="cw-stat">2 new</span></li>
      <li><span class="cw-years">&#128276; ON</span><span class="cw-club">FW · college experience · open to relocate</span><span class="cw-stat">7 new</span></li>
      <li><span class="cw-years">&#128277; off</span><span class="cw-club">DF · left-footed · SoCal</span><span class="cw-stat"></span></li>
    </ul>
    <div class="kicker">Shortlist</div>
    <ul class="clublist">
      <li><a href="#/freeagent/sample"><img class="crest imgcrest" src="${AVATAR}" alt=""><span class="cl-name"><b>Jordan Alvarez</b><span>FW · 23 · verified UPSL history &#10003;</span></span><span class="cl-rt" style="font-size:.7rem;color:var(--accent)">Contacted</span></a></li>
      <li><a href="#/freeagent/sample"><img class="crest imgcrest" src="${AVATAR}" alt=""><span class="cl-name"><b>Sample: T. Nguyen</b><span>GK · 25 · NPSL history &#10003;</span></span><span class="cl-rt" style="font-size:.7rem;color:var(--ink-dim)">New</span></a></li>
    </ul>
    <div class="kicker">Your tryout listing</div>
    <div class="pricecard"><b>Open tryout · Aug 15 · 6 PM</b><p>Promoted to every free agent within 75 miles — 241 views, 19 RSVPs so far.</p>
      <a class="claim" href="#/tryouts">Post your real tryout — free</a></div>
    <a class="claim" href="mailto:hello@rankedxi.com?subject=${encodeURIComponent('Club Recruiting Pro — founding interest')}">Reserve founding club pricing — $99/season</a>
    <p class="note">Everything above is included: alerts, unlimited contact, shortlists, promoted tryouts. Browsing free agents stays free for every club, forever.</p>`;
}

function screenLegal() {
  crumb.textContent = 'Legal';
  const rmClub = `mailto:${NOTICE_MAIL}?subject=${encodeURIComponent('RankedXI Removal: club / crest')}&body=${encodeURIComponent('Club:\nYour role (owner / club officer / league staff):\nWhat should come down (crest / the whole club page / something specific):\n')}`;
  const rmPlayer = `mailto:${NOTICE_MAIL}?subject=${encodeURIComponent('RankedXI Removal: player')}&body=${encodeURIComponent('Player:\nClub:\nI am (the player / a parent or guardian / a club officer):\nWhat should come down (the whole profile / something specific):\n')}`;
  const fixNotice = `mailto:${NOTICE_MAIL}?subject=${encodeURIComponent('RankedXI Notice: correction')}&body=${encodeURIComponent("Page or club:\nWhat's missing or incorrect:\nA source we can check (league page, match report):\n")}`;
  view.innerHTML = `<div class="about">
    <div class="kicker">The plain-language version</div>
    <h2 class="disp">Terms, Privacy &amp; Notices</h2>
    <p><b>What this is.</b> Ranked XI is an independent guide to American soccer. It is not affiliated with, endorsed by, or sponsored by any league, club, or federation shown.</p>
    <p><b>Where the data comes from.</b> We gather club, roster, and historical data from what the leagues themselves publish — league websites and public feeds — plus Wikipedia (CC BY-SA), American Soccer Analysis, and OpenStreetMap. We organize that information; we don't control it at the source. If a league's published table is wrong, ours will be too until someone tells us. Ratings label their basis — real results, real standings, or illustrative.</p>
    <div class="kicker" style="margin-top:14px">Removal requests</div>
    <p>Club and league names and crests belong to their owners and appear here for identification only — shown small, next to the club's own public information, never as a claim of affiliation or endorsement. If you'd rather your club, crest, or player info not appear on Ranked XI, one email does it. We confirm the request actually comes from the club or the player — a reply from an official club account or league contact is enough — then take it down, usually within the week. Crests and images come down first.</p>
    <div class="linkrow">
      <a href="${rmClub}"><b>Remove my club or crest</b></a>
      <a href="${rmPlayer}"><b>Remove my player info</b></a>
    </div>
    <div class="kicker" style="margin-top:14px">Corrections &amp; missing info</div>
    <p>See something wrong, or something that should be here and isn't? File a notice. A person reads every one, and most data corrections ship within a couple of days. A link to a source we can check speeds it up.</p>
    <div class="linkrow">
      <a href="${fixNotice}"><b>File a correction notice</b></a>
    </div>
    <p style="margin-top:14px"><b>Privacy.</b> No accounts, no tracking cookies, no analytics identifiers. Your favorites live in your browser's local storage and never leave your device. Email us and we see your email — that's it.</p>
    <p><b>Predictions.</b> Probabilities are statistical estimates for entertainment and analysis. They are not betting advice, and Ranked XI takes no wagers and no commissions on anything. Ratings and probabilities describe teams and organizations, never individual athletes.</p>
    <p><b>Illustrative data.</b> Anything wearing the dashed <span class="dtag">Illustrative</span> tag demonstrates the product, not the club. Real results, standings, and stats always say what they're based on.</p>
    <p><b>Youth clubs.</b> Youth league entries are organization listings only — name, league, and location from what the league publishes. Youth clubs carry no ratings, no fixtures, and no player data, and we never publish personal information about minors.</p>
    <p><b>Free agents &amp; claims.</b> Listings are self-reported by players; verified badges mark only what we can check against league data. Clubs contact players directly — Ranked XI is never party to any deal. Listings are restricted to players 18 and older, are submitted by email, and are human-reviewed before publication. Any listing can be reported from its page; reported listings come down pending review.</p>
    <div class="kicker" style="margin-top:14px">Accessibility</div>
    <p>Ranked XI aims for WCAG 2.1 AA. The app is built to work with keyboards and screen readers: every club is reachable through search, the National Table, and the Tiers pages — never only through the map — and anything the map does has a text equivalent. If you hit a barrier, tell us the page and what got in the way; accessibility reports get fixed like any other correction, usually within days.</p>
    <div class="linkrow">
      <a href="mailto:${NOTICE_MAIL}?subject=${encodeURIComponent('RankedXI Accessibility barrier')}&body=${encodeURIComponent('Page or screen:\nWhat got in the way (keyboard, screen reader, contrast, motion):\nAssistive tech used, if any:\n')}"><b>Report an accessibility barrier</b></a>
    </div>
    <p class="fine" style="font-size:.75rem">Independent project by Jeremy Kientz &middot; 2026. This page and <a href="/methodology" style="color:var(--accent)">Methodology &amp; Disclaimer</a> are the policy; material changes are dated there.</p>
  </div>`;
}

/* ---- router ---- */
/* ---- The Wire: feed generated from our own results + stats, never stale ---- */
const fmtWireDay = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
let wireLg = 'all', wireLimit = 20;
function wireResultRow(w) {
  const hi = clubIdxByName(w.t1), ai = clubIdxByName(w.t2);
  const upset = w.gp >= 3 && ((w.s1 > w.s2 && w.ph <= 0.35) || (w.s2 > w.s1 && w.ph >= 0.65));
  const side = (i2, n2, cls) => i2 >= 0
    ? `<a class="side ${cls}" href="#/club/${i2}">${mcrest(CLUBS[i2])}<span class="sn">${esc(n2)}</span></a>`
    : `<span class="side ${cls}"><span class="sn">${esc(n2)}</span></span>`;
  return `<div class="match">
    <div class="mrow">${side(hi, w.t1, '')}<span class="vs">${w.s1}&ndash;${w.s2}</span>${side(ai, w.t2, 'away')}</div>
    <div class="meta"><span>${LEAGUES[w.lg] ? lgIcon(w.lg) : ''}${fmtWireDay(w.d)} · ${LEAGUES[w.lg] ? LEAGUES[w.lg].label : 'NPSL'}</span><span>${upset ? '<b class="wup">UPSET</b> · ' : ''}Elo swing &plusmn;${Math.abs(w.dr)} · home ${Math.round(w.ph * 100)}% pre-match</span></div>
  </div>`;
}
function wireLeaders(lgs) {
  const players = allPlayers(sex).filter(p => p.rs);
  const items = [];
  for (const lg of lgs) {
    const lp = players.filter(p => p.c.g === lg);
    if (!lp.length) continue;
    const L = LEAGUES[lg].label;
    const link = p => `#/player/${CLUBS.indexOf(p.c)}/${p.i}`;
    const sc = [...lp].sort((a, b) => b.goals - a.goals || (b.xg || 0) - (a.xg || 0))[0];
    if (sc && sc.goals > 1) items.push({ tag: 'Golden Boot', href: link(sc),
      head: `${sc.name} — ${sc.goals} goals`, sub: `${L} scoring leader · xG ${sc.xg ?? '—'} · ${sc.c.n}` });
    const as = [...lp].sort((a, b) => b.assists - a.assists || (b.xa || 0) - (a.xa || 0))[0];
    if (as && as.assists > 1) items.push({ tag: 'Playmaker', href: link(as),
      head: `${as.name} — ${as.assists} assists`, sub: `${L} assist leader${as.kp != null ? ' · ' + as.kp + ' key passes' : ''} · ${as.c.n}` });
    const gk = lp.filter(p => p.pos === 'GK' && p.gc != null && p.mins >= 900 && p.saves + p.gc > 0)
      .sort((a, b) => b.saves / (b.saves + b.gc) - a.saves / (a.saves + a.gc))[0];
    if (gk) items.push({ tag: 'The Wall', href: link(gk),
      head: `${gk.name} — ${Math.round(100 * gk.saves / (gk.saves + gk.gc))}% save rate`,
      sub: `${L} keeper leader · ${gk.saves} saves, ${gk.gc} conceded · ${gk.c.n}` });
  }
  return items;
}
async function screenWire() {
  crumb.textContent = 'The Wire';
  const lgs = (sex === 'w' ? ['nwsl', 'uslw'] : ['mls', 'uslc', 'usl1', 'mnp', 'npsl']).filter(g => LEAGUES[g]);
  if (wireLg !== 'all' && !lgs.includes(wireLg)) wireLg = 'all';
  const active = wireLg === 'all' ? lgs : [wireLg];
  const leaders = wireLeaders(active).map(it => `
    <a class="match wirelink" href="${it.href}">
      <div class="mrow"><span class="side">${esc(it.head)}</span><span class="vs wtag">${it.tag.toUpperCase()}</span></div>
      <div class="meta"><span>${esc(it.sub)}</span><span></span></div></a>`).join('');
  view.innerHTML = `
    ${sexToggle()}
    <div class="kicker">Generated live from real results and real stats</div>
    <h2 class="disp">The Wire</h2>
    <div class="chips" id="wirechips">${['all', ...lgs].map(g =>
      `<button class="chip solid" data-wlg="${g}" aria-pressed="${wireLg === g}">${g === 'all' ? 'All leagues' : LEAGUES[g].label}</button>`).join('')}</div>
    ${leaders ? `<div class="kicker" style="margin-top:12px">The leaders · real stats</div>` + leaders
      : (sex === 'm' && (wireLg === 'all' || wireLg === 'npsl') ? '' : '<p class="note" style="margin-top:10px">No real-stat leagues in this filter yet.</p>')}
    <div id="wireresults"></div>
    ${adSlot('wire', 'The Wire')}
    <p class="note">No aggregation, no editors: every item is computed from the results and stat lines already in Ranked XI, so the wire is exactly as fresh as the data. Rating swings are the actual Elo changes from the same walk that produces club ratings &mdash; except MLS, which ranks by the official league table (its results-Elo appears on club pages as an experimental number), and UPSL, which stays standings-derived.</p>`;
  wireSexToggle();
  view.querySelector('#wirechips').addEventListener('click', e => {
    const b = e.target.closest('[data-wlg]'); if (!b) return;
    wireLg = b.dataset.wlg; wireLimit = 20; screenWire();
  });
  const box = view.querySelector('#wireresults');
  const activeSet = new Set(active);
  const rows = (await wireDb()).filter(w => activeSet.has(w.lg)).reverse();
  if (!box || !location.hash.startsWith('#/wire')) return;
  const upcoming = activeSet.has('npsl') ? await fixturesDb() : [];
  box.innerHTML =
    (upcoming.length ? `<div class="kicker" style="margin-top:12px">Coming up · NPSL playoffs</div>` +
      upcoming.map(f => `<div class="match"><div class="mrow"><span class="side">${esc(f.t1)}</span><span class="vs">${esc(f.round)}</span><span class="side away">${esc(f.t2)}</span></div>
      <div class="meta"><span>${fmtKick(f.start)}</span><span>${esc(f.venue || '')}</span></div></div>`).join('') : '') +
    (rows.length ? `<div class="kicker" style="margin-top:12px">The results wire · ${rows.length.toLocaleString()} rated matches</div>` +
      rows.slice(0, wireLimit).map(wireResultRow).join('') +
      (rows.length > wireLimit ? `<button class="chip solid" id="wiremore" style="margin-top:8px">Show more</button>` : '')
    : '<p class="note" style="margin-top:10px">No match results in this filter yet.</p>');
  box.querySelector('#wiremore')?.addEventListener('click', () => { wireLimit += 30; screenWire(); });
}

/* WCAG 2.4.2 page titles + SPA route announcement: title updates per route
   and focus moves to <main> after navigation so screen readers hear the new
   screen (first paint keeps browser default focus) */
const ROUTE_TITLES = { map: 'Map', tiers: 'Tiers', table: 'National Table', matches: 'Matches', following: 'Following', about: 'About', legal: 'Terms, Privacy & Notices', wire: 'The Wire', freeagents: 'Free Agents', freeagent: 'Free Agent', tryouts: 'Open Tryouts', pricing: 'Pricing', advertise: 'Advertise', cups: 'Cups', nt: 'National Teams', legends: 'Legends', clubtools: 'Club Tools', state: 'State', region: 'Region', club: 'Club', player: 'Player' };
let routedOnce = false;
function route() {
  const h = location.hash || '#/map';
  const parts = h.slice(2).split('/');
  document.querySelectorAll('.tabbar a').forEach(a => a.classList.toggle('active',
    a.dataset.tab === (['state', 'region', 'club', 'player'].includes(parts[0]) ? 'map' : parts[0])));
  view.scrollTop = 0;
  /* these views read ROSTERS synchronously; any view shows followed-player
     chips, so a user with player favorites also waits for the module */
  const needsRosters = ['club', 'player', 'following', 'table'].includes(parts[0])
    || favs().players.length > 0;
  if (needsRosters) { loadRosters().then(dispatch, dispatch); return; }
  dispatch();
  function dispatch() {
  if (parts[0] === 'tiers') screenPyramid();
  else if (parts[0] === 'freeagents') screenFreeAgents();
  else if (parts[0] === 'tryouts') screenTryouts();
  else if (parts[0] === 'pricing') screenPricing();
  else if (parts[0] === 'advertise') screenAdvertise();
  else if (parts[0] === 'following') screenFollowing();
  else if (parts[0] === 'legends') screenLegends(parts[1]);
  else if (parts[0] === 'cups') screenCups();
  else if (parts[0] === 'nt') screenNationalTeams();
  else if (parts[0] === 'freeagent') screenFASample();
  else if (parts[0] === 'clubtools') screenClubTools();
  else if (parts[0] === 'legal') screenLegal();
  else if (parts[0] === 'table') screenTable();
  else if (parts[0] === 'matches') screenMatches(parts[1]);
  else if (parts[0] === 'wire') screenWire();
  else if (parts[0] === 'about') screenAbout();
  else if (parts[0] === 'state') screenState(parts[1]);
  else if (parts[0] === 'region') screenRegion(parts[1]);
  else if (parts[0] === 'club') screenClub(parts[1]);
  else if (parts[0] === 'player') screenPlayer(parts[1], parts[2]);
  else screenMap();
  document.title = `${ROUTE_TITLES[parts[0]] || 'Map'} — Ranked XI`;
  if (routedOnce) view.focus({ preventScroll: true });
  routedOnce = true;
  }
}
document.documentElement.dataset.theme = localStorage.getItem('pyr-theme') || 'dark';
document.getElementById('themebtn')?.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('pyr-theme', next);
});
/* ≥1160px layout toggle (button hidden below that width). The default is the
   full-browser layout; the phone bezel is the opt-in presentation. The
   attribute itself is set pre-paint in app.html — this only wires the switch. */
{
  const lb = document.getElementById('layoutbtn');
  const paint = () => { if (lb) lb.textContent = document.documentElement.dataset.layout === 'phone' ? 'Full view' : 'Phone view'; };
  paint();
  lb?.addEventListener('click', () => {
    const next = document.documentElement.dataset.layout === 'phone' ? 'wide' : 'phone';
    document.documentElement.dataset.layout = next;
    localStorage.setItem('rxi-layout', next);
    paint();
  });
}
addEventListener('hashchange', route);
route();
wireSearch();
{ const cc = document.getElementById('clubcount'); if (cc) cc.textContent = CLUBS.filter(c => !c.h).length.toLocaleString(); }
/* prefetch rosters once the first view has painted so club taps are instant */
(self.requestIdleCallback || (f => setTimeout(f, 2000)))(() => loadRosters().catch(() => {}));
