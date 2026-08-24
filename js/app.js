import { PROJ, PROJ_AK, PROJ_HI, USMAP, INSETS } from './usmap.js?v=__RXIV__';
import { CLUBS, REGIONS, LEAGUES, EURO_REFS, AFFIL, ROADMAP } from './data.js?v=__RXIV__';
/* rosters.js is ~79KB gzipped (a third of boot JS) but only club/player/roster
   views read it — imported on demand, idle-prefetched after first paint.
   On import failure the app still renders: empty ROSTERS degrades to the same
   "Roster unclaimed" state as clubs with no real roster. */
let ROSTERS = {}, COACHES = {}, HONOURS = {};
let _rostersReady = null;
const loadRosters = () => _rostersReady ||= import('./rosters.js?v=__RXIV__')
  .then(m => { ROSTERS = m.ROSTERS; COACHES = m.COACHES; HONOURS = m.HONOURS; })
  .catch(e => { _rostersReady = null; throw e; });

/* deploy.sh stamps this token with every deploy, and every deploy
   ships freshly refreshed data — so the footer date derives from it instead
   of a hand-edited string that drifts stale */
const BUILDV = '__RXIV__';
const BUILD_DATE = new Date(+BUILDV.slice(0, 4), +BUILDV.slice(4, 6) - 1, +BUILDV.slice(6, 8))
  .toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

const view = document.getElementById('view');
const crumb = document.getElementById('crumb');
const PROV_NAME = { QC:'Quebec', ON:'Ontario', BC:'British Columbia' };
const REGION_LABEL = { region1:'Region I · Northeast', region2:'Region II · Midwest', region3:'Region III · South', region4:'Region IV · West' };
/* pre-USASA region slugs from shared links keep resolving */
const LEGACY_REGION = { northeast:'region1', midwest:'region2', south:'region3', southeast:'region3', southwest:'region4', northwest:'region4' };
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
  return `<details class="fixform"><summary class="reportlink">&#9873; See an error? Suggest a fix</summary>
    <form onsubmit="return submitCorrection(event, this)" data-club="${esc(what)}">
      <select name="kind" aria-label="What kind of fix">
        <option value="">What needs fixing?</option>
        <option value="crest">Wrong or missing crest</option>
        <option value="location">Wrong location / venue</option>
        <option value="league">Wrong league or division</option>
        <option value="result">Missing or wrong result</option>
        <option value="other">Something else</option>
      </select>
      <textarea name="message" rows="3" maxlength="1000" required minlength="10"
        placeholder="What's wrong — wrong city, coach, league, crest? A sentence is plenty."></textarea>
      <input name="contact" maxlength="120" placeholder="Email or @handle (optional, for follow-up)">
      <input name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">
      <button type="submit">Send it in</button>
      <span class="note">or <a href="mailto:hello@rankedxi.com?subject=${subj}&body=${body}">email us</a></span>
    </form></details>
    <a class="reportlink" href="#/legal">Corrections &amp; removal requests</a>`;
}
window.submitCorrection = (ev, f) => {
  ev.preventDefault();
  const btn = f.querySelector('button');
  btn.disabled = true; btn.textContent = 'Sending\u2026';
  fetch('/api/correction', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ club: f.dataset.club, page: location.hash,
      message: (f.kind && f.kind.value ? `[${f.kind.value}] ` : '') + f.message.value, contact: f.contact.value, website: f.website.value })
  }).then(r => r.json()).then(d => {
    f.outerHTML = d.ok
      ? '<p class="note">&#10003; Got it — thank you. Fixes usually land within a few days.</p>'
      : `<p class="note">${d.error || 'Something went wrong — try the email link instead.'}</p>`;
  }).catch(() => { btn.disabled = false; btn.textContent = 'Send it in'; });
  return false;
};
/* Register-interest forms. These replaced the mailto: links that used to sit on
   every "claim this page" / "register interest" CTA.

   A mailto yields one bit — an email arrived, or it didn't — and no way to tell
   "nobody wants this" from "nobody found it". Every price came off the pricing
   page because there was no demand signal to justify one, so the CTAs that
   remain have to actually produce that signal. Rows land in D1 `interest` and
   are read with wrangler; see migrations/0005_interest.sql.

   Same shape as the corrections form deliberately: a <details> that stays shut
   until someone means it, a honeypot, and an inline result that replaces the
   form rather than bouncing anyone to a mail client that may not be set up. */
const INTEREST = {
  'player-claim': {
    open: 'Claim this page',
    intro: 'Add your photo, film and socials, and correct anything we got wrong. Free.',
    detail: 'Anything we should know — links to your film, socials, or what needs correcting.',
    button: 'Claim my page',
    done: 'Got it — we\u2019ll be in touch to verify it\u2019s you before anything changes.',
  },
  'club-add': {
    open: 'Run this club? Add to this page',
    intro: 'Send us what we\u2019re missing — crest, correct city, league and division, socials, tryout dates, or results we don\u2019t have. Free, always: better data makes the whole table better.',
    detail: 'What should we add or fix? Results and standings also feed the rating.',
    button: 'Send it in',
    done: 'Got it — thank you. Club updates usually land within a few days.',
    requireDetail: true,
  },
  'free-agent': {
    open: 'Join the waitlist',
    intro: 'The board opens when there are real players on it. Free to join, free to be listed, and no commissions — your deal is yours. Players 18 and older.',
    detail: 'Position, age, region, last club or level, and a link to your film.',
    button: 'Join the waitlist',
    done: 'You\u2019re on the list — we\u2019ll email you when the board opens.',
  },
  'club-tools': {
    open: 'Register interest',
    intro: 'Nothing to pay and nothing to commit to. Tell us what would actually help you fill a roster and it shapes what gets built.',
    detail: 'What would help most — saved-search alerts, shortlists, promoted tryouts, something else?',
    button: 'Register interest',
    done: 'Got it — thank you. We\u2019ll come back to you before any of this is priced.',
  },
};
function interestForm(kind, subject) {
  const cfg = INTEREST[kind];
  if (!cfg) return '';
  return `<details class="fixform interestform">
    <summary class="reportlink">${cfg.open}</summary>
    <p class="note" style="margin:6px 0 8px">${cfg.intro}</p>
    <form onsubmit="return submitInterest(event, this)" data-kind="${kind}" data-subject="${esc(subject || '')}">
      <input name="email" type="email" maxlength="254" required autocomplete="email" placeholder="Your email">
      <input name="name" maxlength="120" autocomplete="name" placeholder="Your name (optional)">
      <textarea name="detail" rows="3" maxlength="1200"${cfg.requireDetail ? ' required minlength="10"' : ''}
        placeholder="${esc(cfg.detail)}"></textarea>
      <label class="agecheck"><input name="age13" type="checkbox" required> I\u2019m 13 or older</label>
      <input name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">
      <button type="submit">${cfg.button}</button>
      <span class="note">We use this to reply. Nothing else, and no list you didn\u2019t ask for.</span>
    </form></details>`;
}
window.submitInterest = (ev, f) => {
  ev.preventDefault();
  const kind = f.dataset.kind;
  const cfg = INTEREST[kind] || {};
  const btn = f.querySelector('button');
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = 'Sending\u2026';
  let src = null;
  try { src = window.__rxiSrc || null; } catch (e) {}
  fetch('/api/interest', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind, subject: f.dataset.subject, page: location.hash,
      email: f.email.value, name: f.name.value, detail: f.detail.value,
      age13: f.age13.checked, src, website: f.website.value,
    })
  }).then(r => r.json()).then(d => {
    if (d.ok) f.parentElement.outerHTML = `<p class="note">&#10003; ${cfg.done || 'Got it — thank you.'}</p>`;
    else {
      btn.disabled = false; btn.textContent = label;
      let e = f.querySelector('.interr');
      if (!e) { e = document.createElement('p'); e.className = 'note interr'; f.appendChild(e); }
      e.textContent = d.error || 'Something went wrong — please try again.';
    }
  }).catch(() => {
    btn.disabled = false; btn.textContent = label;
  });
  return false;
};
/* crest-content generation: bump when crest PIXELS change under the same
   filename (e.g. a strip_crest_bg.py run) — crest URLs are cached immutable
   and cache-first, so only a new ?cv= reaches returning browsers */
const CRESTV = '11';
/* Venue line for the club header. `acc` is the location grade set by the data
   pipeline: 'v' = coordinates are the ground itself (Wikidata home-venue or a
   league portal venue), 'a' = approximate, unset = league-stated city only.
   Navigation links appear ONLY for 'v' — a directions link to a city centroid
   is worse than none. `cap` = stadium capacity where a source had it. */
function venueHtml(c) {
  if (c.acc === 'a') return '<span class="sub vnote">~approx location</span>';
  if (c.acc !== 'v' || c.la == null) return '';
  const ll = `${c.la},${c.lo}`, q = encodeURIComponent(c.n);
  /* Both links open the ground as a PLACE (pin + surroundings), not a
     directions route — the user picks directions from there if they want. */
  return `<span class="vdot" title="Venue verified — pin is on the ground itself" aria-label="Venue verified">&#10003; venue</span>` +
    (c.cap ? `<span class="sub vnote">Capacity ${Number(c.cap).toLocaleString()}</span>` : '') +
    `<span class="navlinks"><a href="https://maps.apple.com/?ll=${ll}&q=${q}&z=16" target="_blank" rel="noopener">Apple Maps &nearr;</a>` +
    `<a href="https://www.google.com/maps/search/?api=1&query=${ll}" target="_blank" rel="noopener">Google Maps &nearr;</a></span>`;
}
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

/* ranking comparator: clubs rated on real data (rr set) always sort above
   seed/illustrative ratings (no rr) — a no-results club sitting at the 1500
   seed must never outrank sides rated on real games (USL2 report, Aug 2026).
   Seed rows keep their rating, dimmed, and render without a rank number. */
const eloRank = (a, b) => ((b.rr ? 1 : 0) - (a.rr ? 1 : 0)) || (b.r - a.r);
const rankNo = (c, i) => c.rr ? i + 1 : undefined;
function clubRow(c, rank) {
  const idx = CLUBS.indexOf(c);
  return `<li><a href="${clubHref(idx)}">` +
    (rank !== undefined ? `<span class="rk">${rank}</span>` : '') +
    crestHtml(c) +
    `<span class="cl-name"><b>${esc(c.n)}</b><span>${LEAGUES[c.g].label} · ${c.st}</span></span>` +
    (c.r ? `<span class="cl-rt"${c.rr ? '' : ' style="color:var(--ink-dim)"'}>${c.r}</span>` : '<span class="cl-rt" style="color:var(--ink-dim)">—</span>') +
    `</a></li>`;
}

function renderMapSvg(clubs, useCrests, crestNear) {
  const pins = clubs.map(c => {
    const [x, y] = XY(c.la, c.lo);
    const m = LEAGUES[c.g], idx = CLUBS.indexOf(c);
    if (useCrests && c.img && (!crestNear || crestNear.has(c))) {
      return `<image class="pin" data-idx="${idx}" data-cx="${x.toFixed(1)}" data-cy="${y.toFixed(1)}" href="${c.img}?cv=${CRESTV}" x="${(x - 11).toFixed(1)}" y="${(y - 11).toFixed(1)}" width="22" height="22"></image>`;
    }
    const r0 = c.g === 'mls' ? 7 : (c.g === 'loc' || LEVELS.youth.includes(c.g)) ? 4.5 : 5.5;
    const base = `class="pin" data-idx="${idx}" data-r="${r0}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r0}"`;
    return m.hollow
      ? `<circle ${base} fill="none" stroke="${m.color}" stroke-width="1.6"></circle>`
      : `<circle ${base} fill="${m.color}" fill-opacity=".9"></circle>`;
  }).join('');
  return `<div class="mapbox" data-mode="art"><svg class="usmap" viewBox="0 -20 980 580" role="img" aria-label="US and Canada soccer club map">${USMAP}${INSETS}<g id="pins">${pins}</g></svg>
    <div class="leafmap" hidden aria-label="Street map of clubs"></div>
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

function wireMap(scopeStates, mapClubs, frameClubs) {
  const svg = view.querySelector('svg.usmap');
  if (!svg) return;
  wireBasemap(scopeStates, mapClubs || [], frameClubs || mapClubs || []);
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
    /* low floor: pins hold a near-constant screen size while zooming, instead
       of ballooning past ~8x and re-burying dense metros (Reddit launch
       feedback: "can't zoom in far enough to see all the clubs").

       The floor has to be relative to THIS screen's extent, not a constant.
       0.03 was calibrated against the national viewBox (980 units): there the
       zoom limit is 980/64 ≈ 15 units and the floor caps a crest at ~48px,
       which is what it was tuned for. A scoped screen carries its own home
       extent, and the Alaska inset is only 232 units wide — so its zoom limit
       is 232/64 ≈ 3.6 units, and the same constant floor rendered a single
       crest at ~150px, filling the box with one badge and no coastline
       (reported on #/state/AK). Scaling the floor by the screen's own extent
       gives every scope the same ~48px ceiling the national map already had. */
    const f = Math.max(0.03 * (homeVB[2] / 980), vbW / 980);
    svg.querySelectorAll('circle.pin').forEach(c2 => c2.setAttribute('r', (+c2.dataset.r * f).toFixed(2)));
    svg.querySelectorAll('image.pin').forEach(im => {
      const sz = 22 * f;
      im.setAttribute('width', sz.toFixed(1)); im.setAttribute('height', sz.toFixed(1));
      im.setAttribute('x', (+im.dataset.cx - sz / 2).toFixed(1));
      im.setAttribute('y', (+im.dataset.cy - sz / 2).toFixed(1));
    });
  }
  /* every viewBox write clamps to the NATIONAL extent so pan/pinch can never
     push the map out of the box — but on scoped screens the user can drag
     into neighboring states (their pins render too) instead of hitting the
     scope frame like a wall */
  const NATVB = [0, -20, 980, 580];
  const clampAxis = (val, lo, hi) => hi < lo ? (lo + hi) / 2 : Math.min(Math.max(val, lo), hi);
  /* session view memory: returning to this screen restores the zoom/pan the
     user left instead of resetting to the screen's default framing */
  const memKey = 'rxi-vb:' + (location.hash || '#/map');
  const setVB = v => {
    const x = clampAxis(v[0], NATVB[0], NATVB[0] + NATVB[2] - v[2]);
    const y = clampAxis(v[1], NATVB[1], NATVB[1] + NATVB[3] - v[3]);
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
    tip.innerHTML = `<b>${esc(c2.n)}</b><span>${LEAGUES[c2.g].label}${c2.r ? ' · ' + c2.r : ''}${c2.acc === 'a' ? ' · ~approx location' : c2.acc === 'v' ? ' · <i class="vdot-s">&#10003;</i> venue' : ''}</span>`;
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
  /* one rAF owner for button-zoom easing and pan glide; any new gesture or
     wheel tick takes the frame back so animation never fights fingers */
  let anim = null;
  const stopAnim = () => { if (anim) { cancelAnimationFrame(anim); anim = null; } };
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function animVB(target, ms = 200) {
    stopAnim();
    if (reducedMotion) { setVB(target); return; }
    const from = getVB(), t0 = performance.now();
    const step = now => {
      const t = Math.min(1, (now - t0) / ms), k = 1 - Math.pow(1 - t, 3);
      setVB(from.map((v, i) => v + (target[i] - v) * k));
      anim = t < 1 ? requestAnimationFrame(step) : null;
    };
    anim = requestAnimationFrame(step);
  }
  /* zoom anchored at a screen point (cx,cy): the map spot under the
     cursor/tap stays under it, matching embedded-map behavior */
  function zoom(factor, cx, cy, animate) {
    const [x, y, w, h] = getVB();
    const nw = w * factor, nh = h * factor;
    if (nw > homeVB[2]) {
      if (scopeStates && w >= homeVB[2] - 0.5) { exitToNational(); return; }
      animate ? animVB(homeVB) : setVB(homeVB); return;
    }
    if (nw < homeVB[2] / 64) return;
    const r = svg.getBoundingClientRect();
    const fx = cx == null ? 0.5 : (cx - r.left) / r.width;
    const fy = cy == null ? 0.5 : (cy - r.top) / r.height;
    const t = [x + (w - nw) * fx, y + (h - nh) * fy, nw, nh];
    animate ? animVB(t) : setVB(t);
  }
  const ctl = view.querySelector('.mapctl');
  if (ctl) ctl.addEventListener('click', e => {
    const b = e.target.closest('[data-z]'); if (!b) return;
    if (b.dataset.z === 'in') zoom(1 / 1.6, null, null, true);
    else if (b.dataset.z === 'out') zoom(1.6, null, null, true);
    else animVB(homeVB);
  });
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    stopAnim();
    /* ctrl+wheel is a trackpad pinch: continuous 1:1 scaling, not steps */
    const factor = e.ctrlKey ? Math.exp(e.deltaY * 0.01)
      : (e.deltaY > 0 ? 1.25 : 1 / 1.25);
    zoom(factor, e.clientX, e.clientY);
  }, { passive: false });
  const ptrs = new Map();
  let gest = null;
  svg.addEventListener('pointerdown', e => {
    stopAnim();
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...ptrs.values()];
    if (pts.length === 1) gest = { mode: 'pan', x: e.clientX, y: e.clientY, vb: getVB(), vx: 0, vy: 0, t: null };
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
      /* 1:1 pinch: the map tracks the fingers exactly */
      let scale = gest.d0 / (Math.hypot(dx, dy) || 1);
      let nw = gest.vb[2] * scale;
      if (nw > homeVB[2]) {
        /* pinch-out well past a scoped extent exits to the national map;
           1.15 threshold keeps an at-the-edge pinch from exiting by accident */
        if (scopeStates && !gest.exited && gest.vb[2] >= homeVB[2] - 0.5 && nw > homeVB[2] * 1.15) {
          gest.exited = true; exitToNational(); return;
        }
        scale = homeVB[2] / gest.vb[2];
      }
      if (nw < homeVB[2] / 64) scale = (homeVB[2] / 64) / gest.vb[2];
      nw = gest.vb[2] * scale;
      const nh = gest.vb[3] * scale;
      /* anchor the map spot that was under the initial midpoint to the CURRENT
         midpoint, so two fingers moving together pan while they zoom */
      const mx = (pts[0].x + pts[1].x) / 2, my = (pts[0].y + pts[1].y) / 2;
      const fx0 = (gest.mx - r.left) / r.width, fy0 = (gest.my - r.top) / r.height;
      const fx1 = (mx - r.left) / r.width, fy1 = (my - r.top) / r.height;
      setVB([gest.vb[0] + gest.vb[2] * fx0 - nw * fx1, gest.vb[1] + gest.vb[3] * fy0 - nh * fy1, nw, nh]);
    } else if (gest.mode === 'pan' && pts.length === 1) {
      const dx = e.clientX - gest.x, dy = e.clientY - gest.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) dragged = true;
      if (!dragged) return;
      const now = performance.now();
      if (gest.t != null) {
        const dt = Math.max(now - gest.t, 1);
        /* EMA smooths release velocity so glide direction matches the last flick */
        gest.vx = 0.75 * gest.vx + 0.25 * (e.clientX - gest.px) / dt;
        gest.vy = 0.75 * gest.vy + 0.25 * (e.clientY - gest.py) / dt;
      }
      gest.px = e.clientX; gest.py = e.clientY; gest.t = now;
      setVB([gest.vb[0] - dx * gest.vb[2] / r.width, gest.vb[1] - dy * gest.vb[3] / r.height, gest.vb[2], gest.vb[3]]);
    }
  });
  function glide(vx, vy) {
    stopAnim();
    if (reducedMotion) return;
    let last = performance.now();
    const step = now => {
      const dt = Math.min(now - last, 64); last = now;
      const vb = getVB(), r = svg.getBoundingClientRect();
      setVB([vb[0] - vx * dt * vb[2] / r.width, vb[1] - vy * dt * vb[3] / r.height, vb[2], vb[3]]);
      const decay = Math.pow(0.92, dt / 16);
      vx *= decay; vy *= decay;
      anim = Math.hypot(vx, vy) > 0.02 ? requestAnimationFrame(step) : null;
    };
    anim = requestAnimationFrame(step);
  }
  const endPtr = e => {
    ptrs.delete(e.pointerId);
    if (ptrs.size === 1) { const p1 = [...ptrs.values()][0]; gest = { mode: 'pan', x: p1.x, y: p1.y, vb: getVB(), vx: 0, vy: 0, t: null }; }
    else if (!ptrs.size) {
      if (gest && gest.mode === 'pan' && dragged && gest.t != null
          && performance.now() - gest.t < 90 && Math.hypot(gest.vx, gest.vy) > 0.25) {
        glide(gest.vx, gest.vy);
      }
      gest = null;
    }
  };
  svg.addEventListener('pointerup', endPtr);
  svg.addEventListener('pointercancel', endPtr);
  /* double-tap zoom (touch only): mouse gets the anchored wheel instead, and
     a first tap on a state already navigates, so this only fires where a
     second tap is reachable — scoped views and re-taps of the same state */
  let lastTap = null;
  svg.addEventListener('pointerup', e => {
    if (e.pointerType !== 'touch' || dragged) { lastTap = null; return; }
    const now = performance.now();
    if (lastTap && now - lastTap.t < 350 && !e.target.closest('.pin')
        && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
      zoom(0.5, e.clientX, e.clientY, true);
      lastTap = null;
    } else lastTap = { t: now, x: e.clientX, y: e.clientY };
  });
  const chips = view.querySelector('#lgchips');
  if (chips) chips.addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b) return;
    toggleLeague(b.dataset.lg);
  });
}

/* The map: real streets, towns and waterways via Leaflet + OSM tiles.
   There used to be a second, illustrated SVG map behind an Illustrated/Detailed
   toggle. It is gone as a choice (2026-08-23) — asking someone to pick a
   cartography style before they can look up a club is a question the product
   should answer for them, and the detailed map answers every question the
   illustrated one did. The SVG still ships and is still drawn underneath,
   because it is the only map that needs no network: if the vendored Leaflet or
   the tile hosts can't be reached, setMode falls back to it and an offline PWA
   shows a map instead of an empty box. Nothing surfaces it otherwise.

   The viewport survives re-renders. Changing league, level or sex rebuilds the
   whole screen, and so does routing to a club page and back; before this, every
   one of those threw the reader back to the national frame, so zooming to your
   town and then filtering to your division was impossible. _leafView remembers
   where the map was, keyed by geographic scope — a genuinely new scope (a state
   or region page) still gets framed to its own clubs. */
/* states the illustrated fallback map puts in inset boxes rather than in place */
const OFFSHORE_ST = new Set(['AK', 'HI', 'PR', 'VI', 'GU']);
/* Breathing room around the outermost club in the opening frame. It was 0.08,
   which together with zoomSnap 0.25 framed the lower 48 with 2-5 degrees of
   Canada above and Mexico below — "the whole of North America" rather than the
   country the table is about. The padding was only half of it: the snap floored
   an exact 4.596 fit down to 4.50, and how much it threw away depended on the
   window size (0.02 of a zoom level at 1600px wide, 0.22 at 1024px). That is
   why the frame appeared to change on its own between sittings. */
const FRAME_PAD = 0.03;
const MAPVIEW_KEY = 'rxi-mapview';
let _leafView = null;
try { _leafView = JSON.parse(sessionStorage.getItem(MAPVIEW_KEY) || 'null'); } catch {}
function wireBasemap(scopeStates, mapClubs, frameClubs) {
  const box = view.querySelector('.mapbox');
  const leafEl = box && box.querySelector('.leafmap');
  if (!leafEl) return;
  /* Scope, not filter: the saved view is reused when the reader is looking at
     the same patch of country. #/state/TX and the national map are different
     scopes; "all leagues" and "youth only" are the same scope. */
  const scopeKey = scopeStates && scopeStates.length
    ? [...scopeStates].sort().join(',') : 'national';
  let leafMap = null;
  const ensureLeaflet = () => window.L ? Promise.resolve() : new Promise((res, rej) => {
    if (!document.querySelector('link[data-leaf]')) {
      const l = document.createElement('link');
      l.rel = 'stylesheet'; l.href = 'css/vendor/leaflet.css'; l.dataset.leaf = '1';
      document.head.appendChild(l);
    }
    const s = document.createElement('script');
    s.src = 'js/vendor/leaflet.js'; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
  function buildLeaf() {
    const pts = mapClubs.filter(c => isFinite(c.la) && isFinite(c.lo));
    leafMap = L.map(leafEl, { zoomSnap: 0.05, wheelPxPerZoomLevel: 90, preferCanvas: true, zoomControl: false });
    L.control.zoom({ position: 'topright' }).addTo(leafMap);
    /* drop Leaflet's own courtesy prefix (BSD, not required in-UI) so the
       tile credits that ARE required fit on one line in the map box */
    leafMap.attributionControl.setPrefix('');
    /* test hook: the opening frame is a product decision (offshore clubs plot
       but don't widen it), and there is no other way to read it from outside */
    leafEl._rxiMap = leafMap;
    /* two-layer dark relief cartography: Esri hillshade gives the embossed
       charcoal terrain (the look Jeremy asked for), and a faint inverted OSM
       overlay adds state lines, roads, and town labels on top. CSS handles
       both restyles per tile (WebKit blanks filters on the layer container). */
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade_Dark/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, maxNativeZoom: 13, className: 'relieftiles',
      attribution: 'Esri, Maxar, Earthstar Geographics',
    }).addTo(leafMap);
    /* The street layer fades in with zoom instead of sitting at a flat 0.5.
       At national zoom an inverted OSM raster at half opacity over dark
       hillshade is mud — it buried the coastline and every state border, which
       is exactly what you need to see when you are looking at the whole
       country. Detail arrives when it becomes useful and legible, the way a
       real map app reveals streets on approach, rather than being a mode the
       viewer has to pick. */
    const streets = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, opacity: 0.18, className: 'basetiles',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(leafMap);
    /* z4 country -> z11 city. Tuned against the dark hillshade underneath:
       past ~0.62 the inversion washes the terrain out entirely. */
    const streetOpacity = z => Math.max(0.18, Math.min(0.62, 0.18 + (z - 4) * 0.063));
    /* frame the scoped clubs (state/region) but plot everything, so panning
       past a border reveals the neighbors instead of empty map */
    const frame = frameClubs.filter(c => isFinite(c.la) && isFinite(c.lo));
    /* ...and the offshore clubs don't get a vote on the opening frame. The
       illustrated map draws Alaska and Hawaii as insets, so the contiguous
       states fill the canvas; fitting Leaflet to every club instead spans
       19.7N-64.8N and shrinks the lower 48 to a strip. They still plot, and
       zooming out still finds them, which is where people look anyway.
       Falling back to the full frame keeps a scope that IS Alaska working. */
    const core = frame.filter(c => !OFFSHORE_ST.has(c.st));
    const fitSet = core.length ? core : frame;
    /* A saved view for THIS scope wins over the computed frame — that is the
       whole point of remembering it. Anything else and a league filter would
       still yank the reader back to the whole country. */
    const restore = _leafView && _leafView.key === scopeKey ? _leafView : null;
    const fitFrame = () => {
      if (restore) { leafMap.setView([restore.lat, restore.lng], restore.zoom); return; }
      if (fitSet.length) leafMap.fitBounds(L.latLngBounds(fitSet.map(c => [c.la, c.lo])).pad(FRAME_PAD));
      else if (pts.length) leafMap.fitBounds(L.latLngBounds(pts.map(c => [c.la, c.lo])).pad(FRAME_PAD));
      else leafMap.setView([39.5, -98.35], 4);
    };
    fitFrame();
    /* if the container had no layout size yet, fitBounds degenerates to
       max zoom at the bounds center (the Kansas bug) — re-fit next frame */
    requestAnimationFrame(() => { leafMap.invalidateSize(); fitFrame(); });
    /* city-centroid pinning gives every club in a city the identical
       coordinate, so stacked markers hide all but the top one (~850 clubs
       nationally). Fan each stack into a golden-angle spiral in pixel
       space: the best-ranked club keeps the true point, the rest spiral
       out around it, and spacing widens as you zoom in. Render-time only —
       stored coordinates are never touched. */
    const fanIdx = new Map();
    {
      const stacks = new Map();
      for (const c of pts) {
        const k = c.la + ',' + c.lo;
        const g = stacks.get(k);
        if (g) g.push(c); else stacks.set(k, [c]);
      }
      for (const g of stacks.values()) {
        if (g.length < 2) continue;
        g.sort((a, b) => (a.r || 1e9) - (b.r || 1e9));
        g.forEach((c, i) => fanIdx.set(c, i));
      }
    }
    const GOLDEN = 2.39996;
    const fanLatLng = (c) => {
      const i = fanIdx.get(c);
      if (!i) return [c.la, c.lo];
      const z = leafMap.getZoom();
      const spread = Math.max(4, Math.min(44, 6 + (z - 4) * 3));
      const p = leafMap.project([c.la, c.lo], z);
      const r = spread * Math.sqrt(i), a = i * GOLDEN;
      const ll = leafMap.unproject(L.point(p.x + r * Math.cos(a), p.y + r * Math.sin(a)), z);
      return [ll.lat, ll.lng];
    };
    /* Pin size tracks zoom. A flat radius of 6 meant ~3,000 markers each 14px
       across on a 400px-wide national view — the pins covered more area than
       the country did, so the map read as coloured soup and you could not see
       either the landmass or any individual club. Small dots at national zoom
       make the same data read as club DENSITY, which is the actual story of
       "every club in America"; they grow to a tappable target on the way in. */
    const pinRadius = z => Math.max(2.2, Math.min(7, 2.2 + (z - 4) * 0.72));
    const pinWeight = z => (z < 6 ? 0.8 : z < 8 ? 1.3 : 2);
    const markers = [];
    const fanned = [];
    pts.forEach(c => {
      const lg = LEAGUES[c.g];
      const z0 = leafMap.getZoom();
      const m = L.circleMarker(fanLatLng(c), {
        radius: pinRadius(z0), color: lg.color, weight: pinWeight(z0),
        fillColor: lg.color, fillOpacity: lg.hollow ? 0.15 : 0.75,
      }).addTo(leafMap).bindTooltip(c.n)
        .on('click', () => { location.hash = clubHref(CLUBS.indexOf(c)); });
      markers.push(m);
      if (fanIdx.get(c)) fanned.push([m, c]);
    });
    const rescale = () => {
      const z = leafMap.getZoom(), r = pinRadius(z), w = pinWeight(z);
      markers.forEach(m => m.setStyle({ radius: r, weight: w }));
      streets.setOpacity(streetOpacity(z));
    };
    rescale();
    leafMap.on('zoomend', () => { fanned.forEach(([m, c]) => m.setLatLng(fanLatLng(c))); rescale(); });
    /* crest icons appear zoomed-in only, viewport-scoped and capped: 4k DOM
       image markers at national zoom would jank mobile for no visual gain */
    const crestLayer = L.layerGroup().addTo(leafMap);
    const refreshCrests = () => {
      crestLayer.clearLayers();
      if (leafMap.getZoom() < 8) return;
      const b = leafMap.getBounds();
      let n = 0;
      for (const c of pts) {
        if (n >= 250) break;
        if (!c.img || !b.contains([c.la, c.lo])) continue;
        n++;
        /* refreshCrests reruns on zoomend, so fanned positions track zoom */
        L.marker(fanLatLng(c), {
          icon: L.icon({ iconUrl: `${c.img}?cv=${CRESTV}`, iconSize: [26, 26], iconAnchor: [13, 13] }),
          keyboard: false,
        }).addTo(crestLayer).bindTooltip(c.n)
          .on('click', () => { location.hash = clubHref(CLUBS.indexOf(c)); });
      }
    };
    leafMap.on('zoomend moveend', refreshCrests);
    refreshCrests();
    /* sessionStorage as well as the module variable: club routes are hash
       navigations so the variable survives them, but a hard reload or an
       external link back into the app would otherwise lose the reader's
       place. Session-scoped on purpose — a visit tomorrow starts fresh. */
    leafMap.on('moveend zoomend', () => {
      const c = leafMap.getCenter();
      _leafView = { key: scopeKey, lat: c.lat, lng: c.lng, zoom: leafMap.getZoom() };
      try { sessionStorage.setItem(MAPVIEW_KEY, JSON.stringify(_leafView)); } catch {}
    });
  }
  /* No mode argument any more: there is one map. If Leaflet or its stylesheet
     can't load we leave data-mode="art" alone, which keeps the SVG visible —
     the silent offline path, not a style the reader chose. */
  (async function showMap() {
    /* ?nobasemap=1 forces the offline path. The SVG fallback is not reachable
       through the UI any more, so this is the only way to prove it still
       renders — the tests that cover it use this, and nothing else does. */
    if (/[?&]nobasemap=1/.test(location.search)) return;
    try { await ensureLeaflet(); } catch { return; }
    box.dataset.mode = 'street';
    leafEl.hidden = false;
    if (!leafMap) buildLeaf(); else leafMap.invalidateSize();
  })();
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
  amateur: ['npsl', 'upsl', 'usl2', 'apsl', 'swpl', 'mpl', 'mwpl', 'cpl', 'cplw', 'gcpl', 'loc', 'csl', 'sfsfl', 'eplwa', 'lisfl', 'uslwl', 'wpsl', 'uws', 'uws2'],
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
    <a class="fa-card" href="#/wire" id="wirehook"><b>&#128240; The Wire</b><span>Upsets, rating swings, golden-boot races &mdash; generated live from real results.</span></a>
    <a class="fa-card" href="#/sim"><b>&#128200; Rank Simulator</b><span>Pick any club, invent a scoreline, and watch its rank move &mdash; powered by the real ratings.</span></a>
    <a class="fa-card" href="#/predict"><b>&#9876; Matchup Machine</b><span>Any club against any club &mdash; predicted score, three-way odds, and a confidence read.</span></a>
    <a class="fa-card" href="#/freeagents"><b>&#9733; Free Agents</b><span>No club right now? Get seen by every club on this map.</span></a>
    <p class="note">Tap a state to zoom in. Tap a pin for the club. Pinch, scroll, or use +/&minus; to zoom further.</p>
    <label class="sr-only" for="statejump">Jump to a state or province</label>
    <select id="statejump">
      <option value="">Jump to a state or province&hellip;</option>
      ${Object.entries({ ...STATE_NAME, ...PROV_NAME }).sort((a, b) => a[1].localeCompare(b[1])).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
    </select>`;
  wireSexToggle();
  wireLevelChips();
  wireMap(null, visible(clubs));
  hydrateWireHook();
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

/* crest pins for the scoped clubs plus everything within ~1.6x of their
   extent; farther clubs still render as league dots so panning past a
   border shows the neighbors (the Google-My-Maps behavior Jeremy expects) */
function nearScope(scoped, all) {
  if (!scoped.length) return new Set(all);
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  scoped.forEach(c => {
    const [x, y] = XY(c.la, c.lo);
    x0 = Math.min(x0, x); y0 = Math.min(y0, y);
    x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  });
  const mx = Math.max(x1 - x0, 40) * 0.8, my = Math.max(y1 - y0, 40) * 0.8;
  x0 -= mx; x1 += mx; y0 -= my; y1 += my;
  return new Set(all.filter(c => {
    const [x, y] = XY(c.la, c.lo);
    return x >= x0 && x <= x1 && y >= y0 && y <= y1;
  }));
}

function screenRegion(key) {
  if (LEGACY_REGION[key]) { location.hash = '#/region/' + LEGACY_REGION[key]; return; }
  const states = REGIONS[key];
  if (!states) return screenMap();
  crumb.textContent = REGION_LABEL[key];
  const clubs = pool().filter(c => states.includes(c.st));
  const ranked = visible(clubs).filter(c => c.r).sort(eloRank);
  const allVis = visible(pool()), nearBy = nearScope(visible(clubs), allVis);
  view.innerHTML = `
    <button class="backbtn" onclick="location.hash='#/map'">&larr; All USA</button>
    ${sexToggle()}
    <div class="kicker">Region</div><h2 class="disp">${REGION_LABEL[key]}</h2>
    ${renderMapSvg(allVis, true, nearBy)}
    ${leagueChips()}
    <div class="kicker" style="margin-top:10px">Top clubs · ${clubs.length} in region</div>
    <ul class="clublist">${ranked.slice(0, 15).map((c, i) => clubRow(c, rankNo(c, i))).join('')}</ul>`;
  wireSexToggle();
  wireMap(states, allVis, visible(clubs));
}

function screenState(st) {
  if (!STATE_NAME[st]) return screenMap();
  crumb.textContent = st;
  const clubs = pool().filter(c => c.st === st);
  const ranked = visible(clubs).filter(c => c.r).sort(eloRank);
  const allVis = visible(pool()), nearBy = nearScope(visible(clubs), allVis);
  const concepts = visible(clubs).filter(c => !c.r);
  const mappable = clubs.length > 0;
  view.innerHTML = `
    <button class="backbtn" onclick="history.length>1?history.back():location.hash='#/map'">&larr; Back</button>
    ${sexToggle()}
    <div class="kicker">State</div><h2 class="disp">${STATE_NAME[st]}</h2>
    ${mappable ? renderMapSvg(allVis, true, nearBy) : ''}
    ${clubs.length ? leagueChips() : ''}
    <div class="kicker" style="margin-top:10px">${clubs.length ? `Clubs · ${clubs.length}` : 'No clubs mapped yet'}</div>
    <ul class="clublist" id="statelist">${ranked.map((c, i) => clubRow(c, rankNo(c, i))).join('')}${concepts.map(c => clubRow(c)).join('')}</ul>
    ${clubs.length ? '' : '<p class="note">This is where league expansion starts — the dataset grows as leagues are added.</p>'}`;
  wireSexToggle();
  if (mappable) {
    wireMap([st], allVis, visible(clubs));
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
  const poolClubs = () => pool().filter(c => c.r && leagueFilter.has(c.g)).sort(eloRank);
  const poolPlayers = () => allPlayers(sex)
    .filter(p => leagueFilter.has(p.c.g) && (posFilter === 'all' || p.pos === posFilter))
    .sort((a, b) => b.pvr - a.pvr);
  const render = () => {
    const full = tableMode === 'clubs' ? poolClubs() : poolPlayers();
    const rows = full.slice(0, tableLimit).map((x, i) =>
      tableMode === 'clubs' ? clubRow(x, rankNo(x, i)) : playerRow(x, i + 1)).join('');
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
const AMATEUR_TIER = new Set(['npsl', 'upsl', 'usl2', 'apsl', 'gcpl', 'loc', 'csl', 'sfsfl', 'eplwa', 'lisfl', 'uslwl', 'wpsl', 'uws', 'nisa', 'ncaa1', 'ncaa2', 'ncaa3', 'naia', 'ncaa1w', 'ncaa2w']);
function oddsFor(h, a, homeAdv, wantCells) {
  const amateur = AMATEUR_TIER.has(h.g) && AMATEUR_TIER.has(a.g);
  const ha = homeAdv != null ? homeAdv : (amateur ? 30 : 65);
  const lam0 = amateur ? 1.45 : 1.35;
  const d = h.r + ha - a.r;
  const lamH = lam0 * Math.pow(10, d / 1000);
  const lamA = lam0 * Math.pow(10, -d / 1000);
  const pois = (l, k) => Math.exp(-l) * Math.pow(l, k) / FACT[k];
  let pH = 0, pD = 0, pA = 0, best = [1, 1], bestP = 0;
  /* Season Race needs the individual scoreline cells so it can draw a real
     score (and so a goal difference) from one random number. Every other
     caller wants three numbers, so the array is built only on request —
     matchCard() runs this per fixture row and must not pay for it. */
  const cells = wantCells ? [] : null;
  for (let i = 0; i <= 7; i++) for (let j = 0; j <= 7; j++) {
    const p = pois(lamH, i) * pois(lamA, j);
    if (cells) cells.push([p, i, j]);
    if (i > j) pH += p; else if (i === j) pD += p; else pA += p;
    if (p > bestP) { bestP = p; best = [i, j]; }
  }
  // truncating scorelines at 7 goals drops probability mass (3%+ on lopsided
  // matchups), so the three outcomes must renormalize to sum to exactly 1
  const tot = pH + pD + pA;
  return { pH: pH / tot, pD: pD / tot, pA: pA / tot, score: best, ha, cells };
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
/* add-to-calendar: builds an .ics client-side — Apple, Google and Outlook
   all import it, no backend involved. Renders only on real fixtures that
   haven't finished (same rule as watch links: never a calendar entry for a
   hypothetical or a played game). Time-TBA games become all-day events
   rather than inventing a kickoff. */
const icsEsc = s => String(s || '').replace(/\\/g, '\\\\').replace(/[,;]/g, m => '\\' + m).replace(/\r?\n/g, '\\n');
const icsStamp = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
window.dlIcs = btn => {
  const b = btn.dataset, dt = new Date(b.s);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Ranked XI//rankedxi.com//EN', 'BEGIN:VEVENT',
    'UID:' + b.s.replace(/\D/g, '') + '-' + b.t.replace(/[^A-Za-z0-9]/g, '').slice(0, 40) + '@rankedxi.com',
    'DTSTAMP:' + icsStamp(new Date())];
  if (b.tbd) lines.push('DTSTART;VALUE=DATE:' + b.s.slice(0, 10).replace(/-/g, ''));
  else lines.push('DTSTART:' + icsStamp(dt), 'DTEND:' + icsStamp(new Date(+dt + 2 * 36e5)));
  lines.push('SUMMARY:' + icsEsc(b.t));
  if (b.v) lines.push('LOCATION:' + icsEsc(b.v));
  lines.push('DESCRIPTION:' + icsEsc((b.d ? b.d + ' · ' : '') + 'via rankedxi.com'), 'END:VEVENT', 'END:VCALENDAR');
  const url = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: b.t.replace(/[^\w ]/g, '').trim().replace(/ +/g, '-') + '.ics' });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
};
const calBtn = (title, iso, venue, desc, tbd) => `<button type="button" class="calbtn" onclick="dlIcs(this)" data-t="${esc(title)}" data-s="${esc(iso)}" data-v="${esc(venue || '')}" data-d="${esc(desc || '')}"${tbd ? ' data-tbd="1"' : ''}>&#128197; Add to calendar</button>`;
/* Top-5 scorelines with probability bars. Reads the Poisson cells oddsFor()
   already builds; each bar is scaled to the best line so the shape of the
   distribution reads at a glance (a 25% favourite line v five lines at 12%
   is a different match from one at 40%). Percentages are of the full
   truncated grid, so they agree with the three-way odds above. */
function scorelinesHtml(o, h, a) {
  if (!o.cells) return '';
  const top = o.cells.slice().sort((x, y) => y[0] - x[0]).slice(0, 5);
  const max = top[0][0];
  return `<details class="slines"><summary>Most likely scorelines</summary><ul>${top.map(([p, i, j]) =>
    `<li><span class="sl">${i}–${j}</span><i class="slbar"><b style="width:${(p / max * 100).toFixed(0)}%;background:${i > j ? LEAGUES[h.g].color : i < j ? LEAGUES[a.g].color : 'var(--ink-dim)'}"></b></i><span class="slp">${(p * 100).toFixed(0)}%</span></li>`).join('')}</ul></details>`;
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
  const o = oddsFor(h, a, null, true);
  const cf = confidenceFor(o, h, a);
  return `<div class="match">
    ${head}
    <div class="scoreline">${o.score[0]}–${o.score[1]}</div>
    <div class="meta" style="justify-content:center;margin-top:0"><span>most likely score</span></div>
    ${scorelinesHtml(o, h, a)}
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
/* Upcoming fixtures for the six leagues ESPN carries, built by
   scripts/fetch_fixtures.py. Rows keep the {start,t1,t2,round,venue} shape the
   old two-row NPSL file had — My XI and The Wire read it unchanged — and add
   `lg` (our league key), `id1`/`id2` (club ids resolved at BUILD time, so the
   browser never guesses which club a name means) and `tv`. */
async function fixturesDb() {
  if (_fixtures) return _fixtures;
  try { _fixtures = await (await fetch('data/fixtures.json?v=__RXIV__')).json(); }
  catch { _fixtures = []; }
  return _fixtures;
}
let _wireFeed = null;
async function wireDb() {
  if (_wireFeed) return _wireFeed;
  const grab = u => fetch(u).then(r => r.json()).catch(() => []);
  const [npsl, asa, usl2] = await Promise.all([
    grab('data/wire_npsl.json?v=__RXIV__'), grab('data/wire_asa.json?v=__RXIV__'),
    grab('data/wire_usl2.json?v=__RXIV__')]);
  _wireFeed = npsl.map(w => ({ ...w, lg: 'npsl' }))
    .concat(asa, usl2.map(w => ({ ...w, lg: 'usl2' })))
    .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  return _wireFeed;
}
const isUpset = w => w.gp >= 3 && ((w.s1 > w.s2 && w.ph <= 0.35) || (w.s2 > w.s1 && w.ph >= 0.65));
/* map-screen hook: swap the static Wire card copy for the actual top story
   (latest upset, else biggest rating swing of the recent window) once the
   feed is in memory — the front door leads with live news, not a slogan */
async function hydrateWireHook() {
  const rows = (await wireDb()).slice(-60).reverse(); // newest first
  const card = document.getElementById('wirehook');
  if (!card) return;
  const lgs = new Set(sex === 'w' ? ['nwsl', 'uslw'] : ['mls', 'uslc', 'usl1', 'mnp', 'npsl']);
  const mine = rows.filter(w => lgs.has(w.lg));
  if (!mine.length) return;
  const top = mine.find(isUpset) || [...mine].sort((a, b) => Math.abs(b.dr) - Math.abs(a.dr))[0];
  const side = nm => { const i = clubIdxByName(nm); return `${i >= 0 ? mcrest(CLUBS[i]) : ''}<b class="whc">${esc(nm)}</b>`; };
  card.querySelector('span').innerHTML =
    `${isUpset(top) ? '<b class="wup">UPSET</b> · ' : ''}${side(top.t1)} ${top.s1}&ndash;${top.s2} ${side(top.t2)}` +
    ` · Elo &plusmn;${Math.abs(top.dr)} · ${fmtWireDay(top.d)} · <i class="whmore">more on the Wire &rarr;</i>`;
}
let _natTeams = null;
async function natTeamsDb() {
  if (_natTeams) return _natTeams;
  try { _natTeams = await (await fetch('data/national_teams.json?v=__RXIV__')).json(); }
  catch { _natTeams = { teams: [] }; }
  return _natTeams;
}
function fmtKick(iso) {
  const d = new Date(iso);
  const et = d.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const loc = d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return et === loc ? et + ' ET' : et + ' ET · ' + loc + ' local';
}
/* Matchup Machine — one renderer, two homes: inline on #/matches and the
   standalone #/predict screen (the feature is a headliner, not a footnote) */
function matchupMachineHtml(rated, preH) {
  const pickBox = (id, sel) => `<span class="pickwrap"><button type="button" class="pickq pickbtn" id="${id}" aria-haspopup="dialog" aria-label="${id === 'pickH' ? 'Home' : 'Away'} club &mdash; tap to change" data-idx="${CLUBS.indexOf(sel)}">${esc(sel.n)}</button></span>`;
  /* preH arrives as a club slug from My XI and as a numeric index from the
     older in-app links — clubIdx resolves both, -1 falls through to rated[0] */
  const preC = CLUBS[clubIdx(preH)];
  const home = preC && preC.r ? preC : rated[0];
  return `
    <div class="kicker">Predictor · any club v any club · model estimate</div>
    <h2 class="disp">Matchup Machine</h2>
    <p class="note" style="margin:2px 0 6px">Tap either club to swap it &mdash; search or browse all ${rated.length.toLocaleString()} rated clubs.</p>
    <div class="pickrow">
      ${pickBox('pickH', home)}
      <span class="vs">V</span>
      ${pickBox('pickA', rated[1])}
    </div>
    <div id="pickout">${matchCard(home, rated[1], 'HYPOTHETICAL')}</div>
    <p class="note"><a id="cmplink" href="#/compare/${home.id}/${rated[1].id}">Compare these two clubs side by side &rarr;</a></p>`;
}
function wireMatchupMachine(rated) {
  const redo = () => {
    const h = CLUBS[+view.querySelector('#pickH').dataset.idx];
    const a = CLUBS[+view.querySelector('#pickA').dataset.idx];
    if (h && a) view.querySelector('#pickout').innerHTML = matchCard(h, a, 'HYPOTHETICAL');
    const cl = view.querySelector('#cmplink'); if (cl && h && a) cl.href = `#/compare/${h.id}/${a.id}`;
  };
  /* both pickers open the same sheet the Rank Simulator and club-page
     Predict Result use — level chips, league browse, search and random —
     scoped to the current rated pool, minus the club in the other slot */
  const wirePick = id => {
    const btn = view.querySelector('#' + id);
    btn.addEventListener('click', () => {
      const other = CLUBS[+view.querySelector('#' + (id === 'pickH' ? 'pickA' : 'pickH')).dataset.idx];
      const ok = new Set(rated.map(c => c.id));
      simPickerSheet(id === 'pickH' ? 'Home club' : 'Away club',
        c => ok.has(c.id) && c !== other,
        c => { btn.dataset.idx = CLUBS.indexOf(c); btn.textContent = c.n; redo(); });
    });
  };
  wirePick('pickH'); wirePick('pickA');
}
/* The Tools hub. Four things that answer a question about a specific club,
   player, or match rather than about the pyramid as a whole. All four are app
   routes — Player Simulator and Shot Maps were standalone pages until they
   were ported in, which is why each still has a landing page of its own. */
const TOOLS = [
  { href: '#/predict', title: 'Matchup Machine', tag: 'Every rated club',
    blurb: 'Pick two clubs and get win odds, a likely scoreline, and the Elo gap behind them.',
    icon: '<path d="M4.5 4.5l15 15M19.5 4.5l-15 15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M14.5 4.5h5v5M4.5 14.5v5h5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>' },
  { href: '#/compare', title: 'Compare Clubs', tag: 'Every rated club',
    blurb: 'Two clubs side by side: rating, ranks, honours, home ground — and the odds if they met.',
    icon: '<rect x="3" y="5" width="7.5" height="14" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="13.5" y="5" width="7.5" height="14" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5.5 9h2.5M5.5 12h2.5M16 9h2.5M16 12h2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' },
  { href: '#/race', title: 'Season Race', tag: 'Four pro leagues',
    blurb: 'Where every club is on course to finish, and how often each one actually wins the league.',
    icon: '<path d="M6 20.5V9.5M12 20.5V4.5M18 20.5v-7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M3.5 20.5h17" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>' },
  { href: '#/sim', title: 'Rank Simulator', tag: 'Every rated club',
    blurb: 'Book results for your club one at a time and watch the rating and the national rank move.',
    icon: '<path d="M4 20.5h16" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M4.5 16l5-5 3.5 3 6.5-7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M14.5 7h5v5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>' },
  { href: '#/player-sim', title: 'Player Simulator', tag: 'Six pro leagues',
    blurb: "Rate a player on per-96 numbers weighted for their position, then simulate what improving one of them is worth.",
    icon: '<circle cx="12" cy="7.5" r="3.3" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M5 20.5c0-3.9 3.1-6.5 7-6.5s7 2.6 7 6.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>' },
  { href: '#/shots', title: 'Shot Maps', tag: 'Six pro leagues',
    blurb: 'Every shot in a match placed where it was struck and sized by expected goals. Filled circles are goals.',
    icon: '<rect x="3.5" y="5.5" width="17" height="13" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 5.5v13" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="10" r="1.5" fill="currentColor"/><circle cx="16.5" cy="14" r="1.5" fill="currentColor"/><circle cx="9.5" cy="15" r="1.2" fill="none" stroke="currentColor" stroke-width="1.3"/>' },
  { href: '#/radar', title: 'Player Radar', tag: 'Six pro leagues',
    blurb: 'Where a player\'s value comes from, as a percentile against the players they actually compete with.',
    icon: '<path d="M12 2.6l8.2 4.7v9.4L12 21.4 3.8 16.7V7.3z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 7l4.4 2.5v5L12 17l-4.4-2.5v-5z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" opacity=".55"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>' },
];
function screenTools() {
  crumb.textContent = 'Tools';
  view.innerHTML = `
    <div class="kicker">One club, one player, one match</div>
    <h2 class="disp">Tools</h2>
    <div class="toolgrid">
      ${TOOLS.map(t => `<a class="toolcard" href="${t.href}">
        <svg class="ti" viewBox="0 0 24 24" aria-hidden="true">${t.icon}</svg>
        <b>${t.title}${t.ext ? '<span class="tx" aria-label="opens its own page">&#8599;</span>' : ''}</b>
        <span class="tb">${t.blurb}</span>
        <span class="tt">${t.tag}</span>
      </a>`).join('')}
    </div>
    <p class="note">Player Simulator, Shot Maps and Player Radar cover MLS, NWSL, USL Championship, USL League One, MLS Next Pro and USL Super League, because those are the leagues that publish per-player and per-shot data.</p>`;
}
/* Player Simulator and Shot Maps live in their own modules: both are big enough to
   hurt first paint and neither is on the path most visitors take, so the route
   pulls them in on demand. The coach's 2,021-player payload is fetched here
   rather than inside the module for two reasons — the deploy stamp only rewrites
   ?v= tokens in this file, and deploy.sh decides which data/*.json to stage by
   grepping this file for the literal fetch call below. Keep it intact — and
   note the grep is blind to comments, so never write that pattern out in one
   here: a fake path lands in the staging list and the deploy dies on cp. */
let _coachData = null;
async function screenPlayerSim() {
  crumb.textContent = 'Player Simulator';
  view.innerHTML = '<button class="backbtn" onclick="location.hash=\'#/tools\'">&larr; Tools</button>'
    + '<p class="note">Loading player data&hellip;</p>';
  try {
    const [data, mod] = await Promise.all([
      _coachData || fetch('data/coach_players.json?v=__RXIV__').then(r => r.json()),
      import('./player-sim.js?v=__RXIV__'),
    ]);
    _coachData = data;
    if (!location.hash.startsWith('#/player-sim')) return;   // routed away mid-load
    mod.render(view, data);
  } catch (e) {
    if (!location.hash.startsWith('#/player-sim')) return;
    view.innerHTML = '<button class="backbtn" onclick="location.hash=\'#/tools\'">&larr; Tools</button>'
      + '<p class="note">Player Simulator could not load. Check your connection and try again.</p>';
  }
}
/* Season Race. Three small JSONs, all written by scripts/fetch_race.py, and a
   module that is only worth downloading if you asked for this screen. The
   fetch calls below must stay literal and on one line each: deploy.sh decides
   which data/*.json to stage by grepping this file for them. */
let _raceData = null;
async function screenSeasonRace() {
  crumb.textContent = 'Season Race';
  view.innerHTML = '<button class="backbtn" onclick="location.hash=\'#/tools\'">&larr; Tools</button>'
    + '<p class="note">Loading standings and fixtures&hellip;</p>';
  try {
    const grab = u => fetch(u).then(r => r.json());
    const [data, mod] = await Promise.all([
      _raceData || Promise.all([
        grab('data/seasons.json?v=__RXIV__'),
        grab('data/standings.json?v=__RXIV__'),
        grab('data/schedule_rest.json?v=__RXIV__'),
      ]).then(([seasons, standings, schedule]) => ({ seasons, standings, schedule })),
      import('./seasonrace.js?v=__RXIV__'),
    ]);
    _raceData = data;
    if (!location.hash.startsWith('#/race')) return;   // routed away mid-load
    mod.render(view, data, {
      oddsFor: (h, a, ha) => oddsFor(h, a, ha, true),
      club: id => CLUBS.find(c => c.id === id && !c.h),
      crest: (c, big) => big ? crestHtml(c) : mcrest(c),
      LEAGUES,
    });
  } catch (e) {
    if (!location.hash.startsWith('#/race')) return;
    view.innerHTML = '<button class="backbtn" onclick="location.hash=\'#/tools\'">&larr; Tools</button>'
      + '<p class="note">Season Race could not load. Check your connection and try again.</p>';
  }
}
let _radarData = null;
async function screenRadar() {
  crumb.textContent = 'Player Radar';
  view.innerHTML = '<button class="backbtn" onclick="location.hash=\'#/tools\'">&larr; Tools</button>'
    + '<p class="note">Loading player data&hellip;</p>';
  try {
    const [data, mod] = await Promise.all([
      _radarData || fetch('data/player_radar.json?v=__RXIV__').then(r => r.json()),
      import('./playerradar.js?v=__RXIV__'),
    ]);
    _radarData = data;
    if (!location.hash.startsWith('#/radar')) return;   // routed away mid-load
    mod.render(view, data);
  } catch (e) {
    if (!location.hash.startsWith('#/radar')) return;
    view.innerHTML = '<button class="backbtn" onclick="location.hash=\'#/tools\'">&larr; Tools</button>'
      + '<p class="note">Player Radar could not load. Check your connection and try again.</p>';
  }
}
async function screenShots() {
  crumb.textContent = 'Shot Maps';
  view.innerHTML = '<button class="backbtn" onclick="location.hash=\'#/tools\'">&larr; Tools</button>'
    + '<p class="note">Loading&hellip;</p>';
  try {
    const mod = await import('./shotmap.js?v=__RXIV__');
    if (!location.hash.startsWith('#/shots')) return;
    mod.render(view);
  } catch (e) {
    if (!location.hash.startsWith('#/shots')) return;
    view.innerHTML = '<button class="backbtn" onclick="location.hash=\'#/tools\'">&larr; Tools</button>'
      + '<p class="note">Shot Maps could not load. Check your connection and try again.</p>';
  }
}
/* ---- Compare two clubs ------------------------------------------------
   #/compare/<idA>/<idB>. Every row is a number the club page already shows,
   set side by side; the match card underneath is the Matchup Machine's.
   No radar, no invented "DNA" axes — only fields every rated club carries,
   so nothing here is padded for leagues that rank by standings alone. */
function screenCompare(idA, idB) {
  crumb.textContent = 'Compare';
  const rated = pool().filter(c => c.r && !c.h).sort((a, b) => b.r - a.r);
  if (rated.length < 2) return screenMap();
  const pick = id => { const i = clubIdx(id); const c = CLUBS[i]; return c && c.r && !c.h ? c : null; };
  const A = pick(idA) || rated[0];
  const B = pick(idB) && pick(idB) !== A ? pick(idB) : rated.find(c => c !== A);
  if (!location.hash.startsWith('#/compare/' + A.id + '/' + B.id)) {
    location.replace('#/compare/' + A.id + '/' + B.id); return;
  }
  const natl = CLUBS.filter(o => o.x === A.x && o.r && !o.h).sort(eloRank);
  const lgRank = c => { const peers = CLUBS.filter(o => o.g === c.g && o.r && !o.h).sort(eloRank); return c.rr ? peers.indexOf(c) + 1 : null; };
  const basis = c => c.rr === 1 ? 'real results' : c.rr === 2 ? 'standings' : c.rr === 3 ? 'results model' : 'illustrative';
  const honours = c => (HONOURS[rosterKey(c)] || []).reduce((n, h) => n + h.y.length, 0);
  const num = v => v == null ? '&mdash;' : v;
  const better = (x, y, hi = true) => x == null || y == null || x === y ? [0, 0] : (hi ? x > y : x < y) ? [1, 0] : [0, 1];
  const rows = [];
  const row = (label, va, vb, win, fmt = num) => {
    const [wa, wb] = win || [0, 0];
    rows.push(`<div class="cmp-row"><span class="cmp-a${wa ? ' win' : ''}">${fmt(va)}</span><span class="cmp-l">${label}</span><span class="cmp-b${wb ? ' win' : ''}">${fmt(vb)}</span></div>`);
  };
  row('Rating', A.r, B.r, better(A.r, B.r));
  row('Rating basis', basis(A), basis(B));
  row(`${A.g === B.g ? LEAGUES[A.g].label : 'League'} rank`, lgRank(A), lgRank(B), better(lgRank(A), lgRank(B), false), v => v ? '#' + v : 'NR');
  row(`National (${A.x === 'w' ? "women's" : "men's"})`, natl.indexOf(A) + 1, natl.indexOf(B) + 1, better(natl.indexOf(A), natl.indexOf(B), false), v => '#' + v);
  row('Honours', honours(A), honours(B), better(honours(A), honours(B)));
  row('Home', A.ct || A.st, B.ct || B.st, null, esc);
  if (A.cap || B.cap) row('Capacity', A.cap, B.cap, better(A.cap, B.cap), v => v ? Number(v).toLocaleString() : '&mdash;');
  const head = c => `<a class="cmp-club" href="#/club/${c.id}">${crestHtml(c)}<b>${esc(c.n)}</b><span class="lgchip" style="background:${LEAGUES[c.g].color}">${LEAGUES[c.g].label}</span></a>`;
  view.innerHTML = `
    <button class="backbtn" onclick="history.length>1?history.back():location.hash='#/tools'">&larr; Back</button>
    <div class="kicker">Compare · any two rated clubs</div>
    <h2 class="disp">Compare Clubs</h2>
    <p class="note" style="margin:2px 0 6px">Tap either club to swap it. Green marks the better number on each line.</p>
    <div class="pickrow">
      <span class="pickwrap"><button type="button" class="pickq pickbtn" id="cmpA" data-id="${A.id}" aria-haspopup="dialog" aria-label="First club — tap to change">${esc(A.n)}</button></span>
      <span class="vs">V</span>
      <span class="pickwrap"><button type="button" class="pickq pickbtn" id="cmpB" data-id="${B.id}" aria-haspopup="dialog" aria-label="Second club — tap to change">${esc(B.n)}</button></span>
    </div>
    <div class="cmp"><div class="cmp-head">${head(A)}${head(B)}</div>${rows.join('')}</div>
    <div class="btnrow" style="margin:10px 0"><button type="button" class="hdrlink" id="cmpSwap">&#8646; Swap home / away</button><button type="button" class="hdrlink sharebtn" id="cmpShare">Share</button></div>
    <div class="kicker" style="margin-top:8px">If they met · ${esc(A.n)} at home</div>
    ${matchCard(A, B, 'HYPOTHETICAL')}
    <p class="note">Odds from Elo gap via Poisson expected goals, home edge tuned per tier. Predictions, not betting advice.</p>`;
  const go = (a, b) => { location.hash = '#/compare/' + a.id + '/' + b.id; };
  const wire = (btnId, other, slot) => view.querySelector('#' + btnId).addEventListener('click', () => {
    const ok = new Set(rated.map(c => c.id));
    simPickerSheet(slot, c => ok.has(c.id) && c !== other, c => btnId === 'cmpA' ? go(c, other) : go(other, c));
  });
  wire('cmpA', B, 'First club'); wire('cmpB', A, 'Second club');
  view.querySelector('#cmpSwap').addEventListener('click', () => go(B, A));
  const sb = view.querySelector('#cmpShare');
  sb.addEventListener('click', async () => {
    const url = `https://www.rankedxi.com/app#/compare/${A.id}/${B.id}`;
    if (navigator.share) { try { await navigator.share({ title: `${A.n} v ${B.n} — Ranked XI`, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
    try { await navigator.clipboard.writeText(url); sb.textContent = 'Link copied ✓'; } catch { sb.textContent = url; }
    setTimeout(() => { sb.textContent = 'Share'; }, 1800);
  });
}
function screenPredict(preH) {
  crumb.textContent = 'Predict';
  const rated = pool().filter(c => c.r).sort((a, b) => b.r - a.r);
  if (rated.length < 2) return screenMap();
  view.innerHTML = `
    <button class="backbtn" onclick="history.length>1?history.back():location.hash='#/tools'">&larr; Back</button>
    ${sexToggle()}
    ${matchupMachineHtml(rated, preH)}
    <p class="note">Odds from Elo gap via Poisson expected goals, home edge tuned per tier (+30 amateur, +65 pro). Predictions, not betting advice.</p>
    <a class="fa-card" href="#/matches"><b>&#128197; Matches &amp; Rivalry Radar</b><span>Verified fixtures and the nearest-rival matchups the model finds on its own.</span></a>
    <p class="note">Every rated club page has a &#9876; Predict Result button that starts from that club.</p>`;
  wireSexToggle();
  wireMatchupMachine(rated);
}
/* ---- verified fixtures ----------------------------------------------------
   1,500-odd real games land in the next three weeks, most of them college. A
   matchCard each would be several thousand DOM nodes and a scroll nobody
   finishes, so the list is compact rows grouped by day, and the full odds card
   stays where it earns its place: the Matchup Machine and My XI. The row still
   carries the one number that makes this ours rather than a schedule anyone
   could copy — the model's home win probability, shown only when both clubs
   are rated. */
const fxDay = iso => new Date(iso).toLocaleDateString('en-US',
  { weekday: 'short', month: 'short', day: 'numeric' });
const fxTime = iso => new Date(iso).toLocaleTimeString('en-US',
  { hour: 'numeric', minute: '2-digit' });
/* build-time ids first. A name is only re-resolved in the browser when the
   fetcher could not map it, and even then clubIdxByName refuses an ambiguous
   match — an unresolved side renders as plain text, never as a guess. */
function fxClub(id, nm) {
  if (id) {
    const i = CLUBS.findIndex(c => c.id === id);
    if (i >= 0) return CLUBS[i];
  }
  const j = clubIdxByName(nm);
  return j >= 0 ? CLUBS[j] : null;
}
function fixtureRow(f) {
  const h = fxClub(f.id1, f.t1), a = fxClub(f.id2, f.t2);
  /* Label with the feed's name, not ours. Our college records carry the full
     legal name — "The University of Texas at Austin Longhorns" — which in a
     two-column row truncates to "University o..." and tells the reader
     nothing. ESPN uses the name the broadcast uses ("Texas", "UConn",
     "Stetson"), which is both shorter and what someone scanning a schedule is
     looking for. The crest and the link still come from the club we matched,
     so the row is short to read and correct to follow. */
  const side = (c, nm, cls) => c
    ? `<a class="side ${cls}" href="#/club/${c.id}">${mcrest(c)}<span class="sn">${esc(nm || c.n)}</span></a>`
    : `<span class="side ${cls}"><span class="sn">${esc(nm)}</span></span>`;
  let edge = '';
  if (h && a && h.r && a.r) {
    const o = oddsFor(h, a);
    edge = `<span class="fxodds" title="Model home win probability">${(o.pH * 100).toFixed(0)}%</span>`;
  }
  const bits = [fxTime(f.start)];
  if (f.venue) bits.push(esc(f.venue));
  if (f.tv) bits.push(esc(f.tv));
  return `<div class="match fxrow">
    <div class="mrow">${side(h, f.t1, '')}<span class="vs">${edge || 'v'}</span>${side(a, f.t2, 'away')}</div>
    <div class="meta"><span>${bits.join(' · ')}</span><span>${lgIcon(f.lg)}${LEAGUES[f.lg] ? LEAGUES[f.lg].label : ''}</span></div>
  </div>`;
}
let fxLg = 'all', fxLimit = 40;
/* Rendered into #realfx by screenMatches. Kept out of the screen function so a
   chip click or a Show-more re-renders just this block instead of rebuilding
   the Matchup Machine and losing whatever clubs the reader had picked. */
function renderFixtures(box, all, forSex) {
  const mine = all.filter(f => LEAGUES[f.lg] && LEAGUES[f.lg].sex === forSex);
  /* A stale feed must never present last month's games as upcoming — the
     window is enforced here as well as in the fetcher, because the JSON is
     cached and can outlive its own horizon. */
  const now = Date.now();
  const live = mine.filter(f => {
    const t = Date.parse(f.start);
    return t > now - 6 * 36e5 && t < now + 21 * 864e5;
  }).sort((x, y) => x.start < y.start ? -1 : 1);
  if (!live.length) {
    box.innerHTML = `<div class="kicker">Verified fixtures</div>
      <p class="note" style="margin:2px 0 14px">No verified fixtures in the next three weeks. Real fixtures land here straight from league feeds &mdash; nothing is ever invented to fill the space.</p>`;
    return;
  }
  const lgs = [...new Set(live.map(f => f.lg))];
  if (fxLg !== 'all' && !lgs.includes(fxLg)) fxLg = 'all';
  const shown = fxLg === 'all' ? live : live.filter(f => f.lg === fxLg);
  const page = shown.slice(0, fxLimit);
  let day = '', rows = '';
  for (const f of page) {
    const d = fxDay(f.start);
    if (d !== day) { day = d; rows += `<div class="fxday">${esc(d)}</div>`; }
    rows += fixtureRow(f);
  }
  box.innerHTML = `<div class="kicker">Verified fixtures &middot; next three weeks &middot; live from league feeds</div>
    <h2 class="disp">The Real Thing</h2>
    <div class="chips" id="fxchips">${['all', ...lgs].map(g =>
      `<button class="chip solid" data-fxlg="${g}" aria-pressed="${fxLg === g}">${g === 'all' ? `All (${live.length})` : `${LEAGUES[g].label} (${live.filter(f => f.lg === g).length})`}</button>`).join('')}</div>
    ${rows}
    ${shown.length > page.length ? `<button class="chip solid" id="fxmore" style="margin-top:8px">Show more (${shown.length - page.length} left)</button>` : ''}
    <p class="note">Times are your local time. The percentage is the model's home win probability, shown only where both clubs are rated. Fixtures come from ESPN's public scoreboard; a club shown as plain text is one we could not match to a club page with confidence, and we would rather print the name than link the wrong club.</p>`;
  box.querySelector('#fxchips').addEventListener('click', e => {
    const b = e.target.closest('[data-fxlg]'); if (!b) return;
    fxLg = b.dataset.fxlg; fxLimit = 40; renderFixtures(box, all, forSex);
  });
  box.querySelector('#fxmore')?.addEventListener('click', () => {
    fxLimit += 60; renderFixtures(box, all, forSex);
  });
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
  view.innerHTML = `
    ${sexToggle()}
    <a class="fa-card" href="#/wire"><b>&#128240; The Wire</b><span>This week's results, upsets and rating swings &mdash; generated from real data.</span></a>
    <a class="fa-card" href="#/nt"><b>&#127482;&#127480; National Teams</b><span>USA national teams, senior through U-15 &mdash; fixtures, how to watch, squad history and player bios back to 1930.</span></a>
    <div id="realfx"></div>
    ${matchupMachineHtml(rated, preH)}
    <div class="kicker" style="margin-top:18px">Rivalry Radar · nearest matchups by geography</div>
    <h2 class="disp">Rivalry Radar</h2>
    <p class="note" style="margin:2px 0 10px">Who's closest to whom — and how the model thinks it would go. A discovery feature, not a schedule: these games aren't scheduled, so there are no dates. The real ones are above.</p>
    ${pairs.map(([h, a]) => matchCard(h, a, `${milesApart(h, a)} MI APART`)).join('')}
    <p class="note">Odds from Elo gap via Poisson expected goals, home edge tuned per tier (+30 amateur, +65 pro). Predictions, not betting advice.</p>`;
  wireSexToggle();
  wireMatchupMachine(rated);
  /* Sex is captured before the await: a reader who toggles to the women's
     view while this is in flight must not get the men's fixtures pasted in
     underneath them. */
  const fxSex = sex;
  fixturesDb().then(all => {
    const box = view.querySelector('#realfx');
    if (!box || sex !== fxSex) return;
    renderFixtures(box, all, fxSex);
  });
}

/* USA national teams — senior and youth, men's and women's, with tournament
   fixtures, results and how to watch. National sides are not clubs: they stay
   out of CLUBS (the map, the table, the counts) and live in their own dataset.
   Teams whose year is camps and unpublished friendlies carry a note instead of
   match rows — no row ships without a verified date, opponent and venue.
   Watch links are per-match and render only on games that haven't finished —
   a played game must never advertise a broadcast (same rule as audit #7). */
/* country flags for national-team opponents — name-keyed emoji so match rows
   read "USA v 🇲🇽 Mexico" with zero image assets. Unknown names simply get no
   flag; extend as new opponents appear in the dataset. */
const NT_FLAG = { 'United States': '\u{1F1FA}\u{1F1F8}', Mexico: '\u{1F1F2}\u{1F1FD}', Canada: '\u{1F1E8}\u{1F1E6}', Peru: '\u{1F1F5}\u{1F1EA}', Chile: '\u{1F1E8}\u{1F1F1}', Spain: '\u{1F1EA}\u{1F1F8}', Italy: '\u{1F1EE}\u{1F1F9}', Japan: '\u{1F1EF}\u{1F1F5}', 'New Zealand': '\u{1F1F3}\u{1F1FF}', Haiti: '\u{1F1ED}\u{1F1F9}', 'El Salvador': '\u{1F1F8}\u{1F1FB}', Cuba: '\u{1F1E8}\u{1F1FA}', Guatemala: '\u{1F1EC}\u{1F1F9}', 'Costa Rica': '\u{1F1E8}\u{1F1F7}', 'St. Vincent and the Grenadines': '\u{1F1FB}\u{1F1E8}', 'Saint Vincent and the Grenadines': '\u{1F1FB}\u{1F1E8}', 'St. Kitts and Nevis': '\u{1F1F0}\u{1F1F3}', 'Dominican Republic': '\u{1F1E9}\u{1F1F4}', Honduras: '\u{1F1ED}\u{1F1F3}', Panama: '\u{1F1F5}\u{1F1E6}', Jamaica: '\u{1F1EF}\u{1F1F2}', 'Trinidad and Tobago': '\u{1F1F9}\u{1F1F9}', Nicaragua: '\u{1F1F3}\u{1F1EE}', Brazil: '\u{1F1E7}\u{1F1F7}', Argentina: '\u{1F1E6}\u{1F1F7}', Colombia: '\u{1F1E8}\u{1F1F4}', Ecuador: '\u{1F1EA}\u{1F1E8}', Uruguay: '\u{1F1FA}\u{1F1FE}', Venezuela: '\u{1F1FB}\u{1F1EA}', Germany: '\u{1F1E9}\u{1F1EA}', France: '\u{1F1EB}\u{1F1F7}', England: '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}', Netherlands: '\u{1F1F3}\u{1F1F1}', Portugal: '\u{1F1F5}\u{1F1F9}', Belgium: '\u{1F1E7}\u{1F1EA}', Poland: '\u{1F1F5}\u{1F1F1}', Morocco: '\u{1F1F2}\u{1F1E6}', Qatar: '\u{1F1F6}\u{1F1E6}', 'South Korea': '\u{1F1F0}\u{1F1F7}', Australia: '\u{1F1E6}\u{1F1FA}', Nigeria: '\u{1F1F3}\u{1F1EC}', Ghana: '\u{1F1EC}\u{1F1ED}', 'T\u00fcrkiye': '\u{1F1F9}\u{1F1F7}', 'Bosnia and Herzegovina': '\u{1F1E7}\u{1F1E6}', Paraguay: '\u{1F1F5}\u{1F1FE}', 'Puerto Rico': '\u{1F1F5}\u{1F1F7}' };
const ntFlag = name => NT_FLAG[name] ? NT_FLAG[name] + ' ' : '';
/* broadcaster chip: logo + label, hyperlinked out — the logo IS the credit.
   White pill so network wordmarks stay legible in both themes. */
const watchChip = w => `<a class="watchchip" href="${w.url}" target="_blank" rel="noopener">${w.img ? `<img src="${w.img}" alt="" loading="lazy" onerror="this.style.display='none'">` : '&#9655; '}<span>${esc(w.label)}</span></a>`;
const ntFmtDay = iso => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' });
/* teams with scraped tournament-squad history in data/nt_history.json — only
   these get a "Squad history" link (camp-cycle age groups have no FIFA/world
   tournament record to show) */
const NT_HISTORY_IDS = ['usmnt', 'uswnt', 'u20mnt', 'u17mnt', 'u20wnt', 'u17wnt'];
/* every match row names its team — "USMNT", "USA U-17W" — never a bare USA:
   the overview shows many teams' games on one page */
function ntTag(t) {
  const m = t && t.label ? t.label.match(/^U-(\d+)\s+(Men|Boys|Women|Girls)$/i) : null;
  if (m) return `USA U-${m[1]}${/^(women|girls)$/i.test(m[2]) ? 'W' : ''}`;
  return (t && t.label) || 'USA';
}
const ntTagFromId = tid => tid === 'usmnt' ? 'USMNT' : tid === 'uswnt' ? 'USWNT'
  : /^u\d+[mwbg]nt$/.test(tid) ? 'USA ' + tid.replace(/^u(\d+)([mwbg])nt$/, (s, n, g) => `U-${n}${(g === 'w' || g === 'g') ? 'W' : ''}`)
  : tid.toUpperCase();
function ntMatchRow(m, tag) {
  const ended = m.status === 'ENDED';
  const res = !ended ? '' : m.us > m.them ? 'W ' : m.us < m.them ? 'L ' : 'D ';
  const when = ended ? ntFmtDay(m.start) : m.timeTBD ? ntFmtDay(m.start) + ' · time TBA' : fmtKick(m.start);
  const watch = !ended && (m.tv || []).length
    ? `<div class="watchrow">${m.tv.map(watchChip).join('')}</div>`
    : '';
  const cal = ended ? '' : `<div class="calrow">${calBtn(`${tag || 'USA'} v ${m.opp}`, m.start, [m.venue, m.city].filter(Boolean).join(', '), m.round, m.timeTBD)}</div>`;
  return `<div class="match">
    <div class="mrow"><span class="side"><span class="sn">${NT_FLAG['United States']} ${esc(tag || 'USA')}</span></span><span class="vs">${ended ? res + m.us + '–' + m.them : 'V'}</span><span class="side away"><span class="sn">${ntFlag(m.opp)}${esc(m.opp)}</span></span></div>
    <div class="meta"><span>${esc(m.round)}</span><span>${when}</span></div>
    ${m.venue || m.city ? `<div class="meta"><span>${esc(m.venue || '')}</span><span>${esc(m.city || '')}</span></div>` : ''}
    ${watch}
    ${cal}
  </div>`;
}
function ntTeamBlock(t, withHistoryLink) {
  const tag = ntTag(t);
  const links = [
    withHistoryLink && NT_HISTORY_IDS.includes(t.id)
      ? `<a class="watchlink" href="#/nt/${esc(t.id)}">Squad history &amp; player bios &rarr;</a>` : '',
    (t.matches || []).length
      ? `<a class="watchlink" href="webcal://${location.host}/cal/${esc(t.id)}.ics" title="Subscribes in Apple/Outlook. Google Calendar: Settings &rarr; Add calendar &rarr; From URL with https://${location.host}/cal/${esc(t.id)}.ics">&#128197; Subscribe: full schedule</a>` : '',
    t.url ? `<a class="watchlink" href="${t.url}" target="_blank" rel="noopener">Official team site &#8599;</a>` : ''
  ].filter(Boolean).join('<span style="color:var(--ink-dim)"> &nbsp;·&nbsp; </span>');
  return `
    <div class="kicker" style="margin-top:22px">${esc(t.comp)}${t.compDates ? ' · ' + esc(t.compDates) : ''}</div>
    <h2 class="disp">${esc(t.name)}</h2>
    ${t.note ? `<p class="note" style="margin:2px 0 8px">${esc(t.note)}</p>` : ''}
    ${(t.achievements || []).map(a => `<span class="badge c" style="margin:0 6px 8px 0;display:inline-block">${esc(a)}</span>`).join('')}
    ${(t.matches || []).map(m => ntMatchRow(m, tag)).join('')}
    ${t.next ? `<p class="note" style="margin:6px 0 0">${esc(t.next)}</p>` : ''}
    ${links ? `<p style="margin:8px 0 0">${links}</p>` : ''}`;
}
let _ntHist = null;
async function ntHistoryDb() {
  if (_ntHist) return _ntHist;
  try { _ntHist = await (await fetch('data/nt_history.json?v=__RXIV__')).json(); }
  catch { _ntHist = { teams: {}, players: {} }; }
  return _ntHist;
}
/* A screen that awaits before it paints can be overtaken. The reader routes
   away — taps Back out of a club — while its data is still in flight, and the
   late paint then lands on top of whatever they navigated to, leaving the URL
   and the screen disagreeing: the address bar says #/map, the club page is
   what you are looking at. Every screen that awaits before painting captures
   the hash it was routed for and drops its paint if the reader has moved on.
   screenPlayer, screenLeague and screenTryouts each grew a private copy of
   this check; this is that check, once, for all of them. */
function routedAway(at) { return (location.hash || '#/map') !== at; }

async function screenNationalTeams(sub, sub2) {
  const at = location.hash || '#/map';
  if (sub === 'p') return screenNTPlayer(sub2);
  if (sub) return screenNationalTeam(sub);
  crumb.textContent = 'National Teams';
  const db = await natTeamsDb();
  const teams = db.teams || [];
  if (routedAway(at)) return;
  const section = (title, list) => list.length ? `
    <div class="kicker" style="margin-top:30px;font-size:1rem;letter-spacing:.08em">${title}</div>
    <hr style="border:none;border-top:1px solid var(--line,#24352C);margin:4px 0 0">
    ${list.map(t => ntTeamBlock(t, true)).join('')}` : '';
  view.innerHTML = `
    <div class="kicker">USA national teams · senior through U-15 · Concacaf &amp; FIFA competitions</div>
    <h2 class="disp">National Teams</h2>
    ${teams.length
      ? section('Men', teams.filter(t => t.g !== 'women')) + section('Women', teams.filter(t => t.g === 'women'))
      : '<p class="note">National-team fixtures are loading into the dataset.</p>'}
    <p class="note">Kickoffs shown in Eastern and your local time. Results, venues and broadcasts from U.S. Soccer, Concacaf and FIFA — nothing is invented. Teams shown without match rows are in camp-and-friendly cycles with no published fixture data. Watch links appear only on upcoming games.</p>`;
}

/* age at a June 15 midpoint of the tournament year — squads pages span
   spring and winter editions, so this is a display approximation */
const ntAgeAt = (dob, y) => Math.floor((Date.UTC(y, 5, 15) - new Date(dob + 'T00:00:00Z')) / 31557600000);

/* per-team page: current campaign plus every world-tournament squad the USA
   has fielded, browsable by year. Squad data is scraped from per-tournament
   Wikipedia squads pages (scripts/fetch_nt_history.py). Minors policy: a
   player who could still be under 18 shows name, position and club only —
   no birth date, no bio. */
async function screenNationalTeam(id) {
  const at = location.hash || '#/map';
  const [db, hist] = await Promise.all([natTeamsDb(), ntHistoryDb()]);
  /* ahead of the bounce below: a reader who left while this loaded must not be
     dragged to #/nt by a screen they are no longer on */
  if (routedAway(at)) return;
  const t = (db.teams || []).find(x => x.id === id);
  const h = (hist.teams || {})[id];
  if (!t && !h) { location.hash = '#/nt'; return; }
  crumb.textContent = (t && t.label) || 'National Team';
  const eds = (h && h.editions) || [];
  let year = eds.length ? eds[0].year : 0;
  const rosterHtml = ed => {
    const meta = [ed.host, ed.coach ? 'Head coach: ' + ed.coach : ''].filter(Boolean).join(' · ');
    return `
      <div class="kicker" style="margin-top:14px">${ed.year} ${esc(ed.comp)}${meta ? ' · ' + esc(meta) : ''}</div>
      <ul class="clublist ntroster">${ed.squad.map(p => {
        const club = p.club ? esc(p.club) + (p.clubnat && p.clubnat !== 'USA' ? ` (${esc(p.clubnat)})` : '') : '';
        const stats = [p.caps ? p.caps + ' caps' : '', p.goals ? p.goals + ' goals' : ''].filter(Boolean).join(' · ');
        const sub = [esc(p.pos), club, p.dob ? 'age ' + ntAgeAt(p.dob, ed.year) : '', stats].filter(Boolean).join(' · ');
        const inner = `<span class="rk">${p.no || ''}</span>
          <span class="cl-name"><b>${esc(p.name)}${p.captain ? ' <span class="ntcap" title="captain">&copy;</span>' : ''}</b><span>${sub}</span></span>`;
        return p.pid
          ? `<li><a class="ntrow" href="#/nt/p/${esc(p.pid)}">${inner}<span class="ntmore">Profile</span></a></li>`
          : `<li><div class="ntrow">${inner}</div></li>`;
      }).join('')}</ul>`;
  };
  const render = () => {
    const ed = eds.find(e => e.year === year);
    view.innerHTML = `
      <button class="backbtn" onclick="location.hash='#/nt'">&larr; National Teams</button>
      ${t ? ntTeamBlock(t, false) : `<h2 class="disp">${esc(h.name)}</h2>`}
      ${eds.length ? `
        <div class="kicker" style="margin-top:22px">Squad history · ${eds.length} world tournaments</div>
        <div class="chips" id="ntyears">${eds.map(e =>
          `<button class="chip solid" data-y="${e.year}" aria-pressed="${e.year === year}">${e.year}</button>`).join('')}</div>
        ${ed ? rosterHtml(ed) : ''}
        <p class="note">Squads as officially named for each tournament; clubs are each player's club at the time. Tap a player for their profile and bio (sourced from Wikipedia). Players who may be under 18 show name, position and club only.</p>`
        : '<p class="note">Historical squads land here as tournament data is added.</p>'}`;
    const yc = view.querySelector('#ntyears');
    if (yc) yc.addEventListener('click', e => {
      const b = e.target.closest('[data-y]'); if (!b) return;
      year = +b.dataset.y; render();
    });
  };
  render();
}

/* nt player profile: bio plus every world-tournament appearance across all
   national teams (a U-17 alum often reappears on the U-20s and seniors) */
async function screenNTPlayer(pid) {
  const at = location.hash || '#/map';
  const hist = await ntHistoryDb();
  if (routedAway(at)) return;          // before the #/nt bounce below
  const rows = [];
  for (const [tid, team] of Object.entries(hist.teams || {})) {
    for (const ed of team.editions || []) {
      for (const p of ed.squad || []) if (p.pid === pid) rows.push({ tid, ed, p });
    }
  }
  if (!rows.length) { location.hash = '#/nt'; return; }
  rows.sort((a, b) => b.ed.year - a.ed.year);
  const p0 = rows[0].p;
  const info = (hist.players || {})[pid] || {};
  crumb.textContent = p0.name;
  const dob = (rows.find(r => r.p.dob) || {}).p ? (rows.find(r => r.p.dob) || {}).p.dob : null;
  view.innerHTML = `
    <button class="backbtn" onclick="history.length>1?history.back():location.hash='#/nt'">&larr; Back</button>
    <div class="kicker">USA national teams · player</div>
    <h2 class="disp">${esc(p0.name)}</h2>
    <p class="note" style="margin:2px 0 8px">${[p0.pos, dob ? 'born ' + dob : ''].filter(Boolean).map(esc).join(' · ')}</p>
    ${info.bio ? `<p style="margin:6px 0 10px;line-height:1.55">${esc(info.bio)}</p>` : ''}
    <div class="kicker" style="margin-top:14px">World tournaments · ${rows.length}</div>
    <ul class="clublist ntroster">${rows.map(r => {
      const club = r.p.club ? esc(r.p.club) + (r.p.clubnat && r.p.clubnat !== 'USA' ? ` (${esc(r.p.clubnat)})` : '') : '';
      const sub = [club, r.p.dob ? 'age ' + ntAgeAt(r.p.dob, r.ed.year) : '', r.ed.host ? esc(r.ed.host) : ''].filter(Boolean).join(' · ');
      return `<li><a class="ntrow" href="#/nt/${esc(r.tid)}"><span class="rk">${r.p.no || ''}</span>
        <span class="cl-name"><b>${r.ed.year} ${esc(r.ed.comp)}</b><span>${sub}</span></span>
        <span class="ntmore">${esc(ntTagFromId(r.tid))}</span></a></li>`;
    }).join('')}</ul>
    <p class="note">Appearances from officially named tournament squads; clubs are as of each tournament. Bio from Wikipedia.</p>`;
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
    return { ...st, num: rp.num || '', name: rp.name, pos: rp.pos,
      nat: rp.nat ? rp.nat.toUpperCase() : null, wiki: rp.wiki, real: true, rs, age: null };
  });
}
function staffFor(c) {
  /* real coaches only — an invented name next to a real roster reads as a
     data error, not a demo (first Reddit feedback wave, Aug 2026) */
  const real = COACHES[rosterKey(c)];
  return real ? [{ tag: 'HC', name: real.name, role: real.role, age: '' }] : [];
}
/* Accounts load lazily like every other non-core module: the app must paint
   and be usable before anything auth-shaped is fetched, and a visitor who
   never signs in should never pay for the code that signs people in. */
let _acct;
const acctMod = () => _acct ||= import('./account.js?v=__RXIV__');

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
  localStorage.setItem('pyr-favs', JSON.stringify(f));
  /* localStorage is written first and the caller re-renders off it, so the
     star is already lit before this fires. The account push is a debounced
     backup that is allowed to fail — starring a club must never wait on, or
     be undone by, the network. Logged out this is a no-op. */
  acctMod().then(m => m.touchAccount()).catch(() => {});
  return i < 0;
}
const isFav = (type, id) => favs()[type].includes(id);
function favBtn(type, id) {
  return `<button class="favbtn${isFav(type, id) ? ' on' : ''}" data-ft="${type}" data-fi="${id}">${isFav(type, id) ? '&#9733; Following' : '&#9734; Follow'}</button>`;
}
/* Email capture at the one moment intent is highest — the visitor has just
   followed a club. Three things this deliberately does NOT do:
     · it does not gate the Follow. Tapping Follow still writes nothing but
       localStorage, which is what the privacy page promises. The prompt
       appears after the fact and the club is already followed either way.
     · it does not nag. Subscribe or dismiss once and it never returns.
     · it does not fire for players. Player follows are a different consent
       question and route through the claim flow instead.
   COPPA attaches to collecting personal information from under-13s, so the
   13-or-older confirmation is required here and re-checked server-side. */
const FOLLOWMAIL_KEY = 'rxi-followmail';
function followMailState() {
  try { return JSON.parse(localStorage.getItem(FOLLOWMAIL_KEY)) || {}; } catch { return {}; }
}
function followMailSet(patch) {
  try {
    localStorage.setItem(FOLLOWMAIL_KEY, JSON.stringify({ ...followMailState(), ...patch }));
  } catch { /* private mode — the prompt simply reappears next visit */ }
}

function followMailForm(clubId, clubName) {
  const el = document.createElement('div');
  el.className = 'followmail';
  el.innerHTML = `
    <b>Get ${esc(clubName)} results by email</b>
    <p>Their next result, rating move and rank change — nothing else. No sign-in needed, and we
       never pass your address on.</p>
    <form class="joinform fmform" novalidate>
      <input type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px">
      <label class="sr-only" for="fm-email">Email address</label>
      <input id="fm-email" type="email" name="email" placeholder="you@email.com" required autocomplete="email" maxlength="254">
      <label class="ck"><input type="checkbox" name="age13" value="1"> I'm 13 or older</label>
      <button type="submit" class="joinbtn">Email me their results</button>
    </form>
    <p class="join-msg fm-msg" role="status" aria-live="polite"></p>
    <button type="button" class="fm-no">No thanks</button>`;
  const msg = el.querySelector('.fm-msg');
  el.querySelector('.fm-no').addEventListener('click', () => {
    followMailSet({ dismissed: true });
    el.remove();
  });
  el.querySelector('.fmform').addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const email = String(f.get('email') || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      msg.textContent = 'A real email address is required.'; return;
    }
    if (!f.get('age13')) {
      msg.textContent = 'You need to be 13 or older to get emails.'; return;
    }
    msg.textContent = 'Saving\u2026';
    try {
      const r = await fetch('/api/follow', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, club: clubId, age13: true,
          source: 'follow-btn', website: f.get('website') })
      });
      const d = await r.json();
      if (d.ok) {
        followMailSet({ done: true });
        el.innerHTML = `<b>You're on the list for ${esc(clubName)}.</b>
          <p>First email goes out with the next Wire. Every one has an unsubscribe link.</p>`;
      } else {
        msg.textContent = d.error || 'Could not save right now — please try again.';
      }
    } catch { msg.textContent = 'Could not save right now — please try again.'; }
  });
  return el;
}

function wireFav() {
  view.querySelectorAll('.favbtn').forEach(b => b.addEventListener('click', () => {
    const on = favToggle(b.dataset.ft, b.dataset.fi);
    b.classList.toggle('on', on);
    b.innerHTML = on ? '&#9733; Following' : '&#9734; Follow';
    const st = followMailState();
    if (!on || b.dataset.ft !== 'clubs' || st.done || st.dismissed) return;
    if (b.parentNode.querySelector('.followmail')) return;
    const c = CLUBS[clubIdx(b.dataset.fi)];
    if (c) b.insertAdjacentElement('afterend', followMailForm(c.id, c.n));
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
  try { _mlshist = await (await fetch('data/mls_history.json?v=__RXIV__')).json(); }
  catch { _mlshist = {}; }
  return _mlshist;
}
let _cuprec = null;
async function cupDb() {
  if (_cuprec) return _cuprec;
  try { _cuprec = await (await fetch('data/cup_receipts.json?v=__RXIV__')).json(); }
  catch { _cuprec = {}; }
  return _cuprec;
}
let _legends = null;
async function legendsDb() {
  if (_legends) return _legends;
  try { _legends = await (await fetch('data/legends.json?v=__RXIV__')).json(); }
  catch { _legends = {}; }
  return _legends;
}
let _profiles = null;
async function profilesDb() {
  if (_profiles) return _profiles;
  try { _profiles = await (await fetch('data/players.json?v=__RXIV__')).json(); }
  catch { _profiles = {}; }
  return _profiles;
}
let _tryouts = null;
async function tryoutsDb() {
  if (_tryouts) return _tryouts;
  try { _tryouts = await (await fetch('data/tryouts.json?v=__RXIV__')).json(); }
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

/* USL2 squads from banked lineups: who actually played, and how often. Only
   fetched on a usl2 club page — 220KB nobody else needs. The file carries no
   birth years by construction (scripts/build_usl2_appearances.py), so nothing
   here has to think about the minors policy. */
let _usl2apps = null;
async function usl2Apps() {
  _usl2apps ??= fetch('data/usl2_appearances.json?v=__RXIV__')
    .then(r => r.json()).catch(() => ({}));
  return _usl2apps;
}
async function screenClub(ref) {
  const at = location.hash || '#/map';
  const idx = clubIdx(String(ref));
  if (idx < 0) return screenMap();
  const c = CLUBS[idx];
  if (String(ref) !== c.id) { location.replace('#/club/' + c.id); return; }
  if (c.h && c.dup != null) { location.replace('#/club/' + (CLUBS[c.dup] ? CLUBS[c.dup].id : c.dup)); return; }
  const hist = c.g === 'mls' ? (await mlsHistory()) : null;
  const hasLegends = c.g === 'mls' && !!((await legendsDb())[c.n] || []).length;
  const cupRec = (await cupDb())[c.id] || [];
  const apps = c.g === 'usl2' ? (await usl2Apps())[c.id] : null;
  /* board listings that belong to this club — moderation sets clubId; the
     name match catches listings posted before the id was attached */
  const tToday = new Date().toISOString().slice(0, 10);
  const clubTry = (await tryoutsDb()).filter(t => !t.sample && t.date >= tToday &&
    ((t.clubId && t.clubId === c.id) || (t.club || '').toLowerCase() === c.n.toLowerCase()));
  if (routedAway(at)) return;
  crumb.textContent = c.st;
  const m = LEAGUES[c.g];
  const peers = CLUBS.filter(o => o.g === c.g && o.r && !o.h).sort(eloRank);
  const rank = c.r && c.rr ? peers.indexOf(c) + 1 : null;
  const natl = CLUBS.filter(o => o.x === c.x && o.r && !o.h).sort(eloRank);
  /* same-league neighbors first; a club whose league has no nearby rated
     peers borrows the closest rated same-sex clubs so every rated club still
     gets fixtures and odds instead of an empty section */
  let opps = neighbors(c, 7);
  if (opps.length < 2 && c.r) opps = CLUBS.filter(o => o !== c && o.x === c.x && o.r && !o.h)
    .sort((a2, b2) => dist2(a2, c) - dist2(b2, c)).slice(0, 7);
  view.innerHTML = `
    <button class="backbtn" onclick="history.length>1?history.back():location.hash='#/map'">&larr; Back</button>
    <div class="clubhead">${crestHtml(c)}${c.ck ? '<span class="ckmark" title="Crest verified against the club\'s official source" aria-label="Crest verified">&#10003;</span>' : ''}
      <div><h2 class="disp" style="margin:0">${esc(c.n)}</h2>
      <a class="lgchip" href="#/league/${c.g}" style="background:${m.color}">${m.img ? `<img class="lgimg" src="${m.img}" alt="">` : ''}${m.label}</a>
      <span class="sub" style="margin-left:8px">${c.ct ? `${esc(c.ct)}, ${c.st}` : (STATE_NAME[c.st] || PROV_NAME[c.st] || c.st)}</span>${venueHtml(c)}${c.ia ? `<span class="sub" style="margin-left:8px;color:#C77F1E;border:1px solid #C77F1E;border-radius:6px;padding:1px 7px;font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap">Inactive &middot; not in current league listings</span>` : ''}</div>
    </div>
    <div class="btnrow">${favBtn('clubs', c.id)}${c.r ? `<button class="predictbtn2" data-predict="${idx}">&#9876; Predict Result</button>` : ''}${c.r ? `<button class="predictbtn2" data-sim="${c.id}">&#128200; Rank Simulator</button>` : ''}${c.r ? `<a class="hdrlink" href="#/compare/${c.id}">Compare</a>` : ''}<button class="hdrlink sharebtn" type="button">Share</button>${c.url ? `<a class="hdrlink" href="${safeHref(c.url)}" target="_blank" rel="noopener">Website &nearr;</a>` : `<a class="hdrlink dim" href="${gsearch(c.n, 'official site')}" target="_blank" rel="noopener">Find website</a>`}${c.si ? `<a class="hdrlink" href="${safeHref(c.si)}" target="_blank" rel="noopener">Instagram</a>` : ''}${c.sx ? `<a class="hdrlink" href="${safeHref(c.sx)}" target="_blank" rel="noopener">X</a>` : ''}${c.sf ? `<a class="hdrlink" href="${safeHref(c.sf)}" target="_blank" rel="noopener">Facebook</a>` : ''}</div>
    ${(HONOURS[rosterKey(c)] || []).length ? `<div class="kicker" style="margin-top:10px">Honours</div><ul class="honours">${(HONOURS[rosterKey(c)] || []).map(h2 => `<li><b>${esc(h2.t)}</b><span>${h2.y.join(', ')}</span></li>`).join('')}</ul>` : ''}
    ${c.r ? `<div class="statgrid">
      <div class="stat"><b>${c.r}</b><span>${c.rr === 1 ? 'Rating · real results' : c.rr === 2 ? 'Rating · standings' : c.rr === 3 ? 'Rating · results model' : DTAG + 'Rating'}${c.pv ? ' · provisional' : ''}</span></div>
      <div class="stat"><b>${rank ? '#' + rank : 'NR'}</b><span>${m.label}</span></div>
      <div class="stat"><b>${c.rr ? '#' + (natl.indexOf(c) + 1) : 'NR'}</b><span>National (${c.x === 'w' ? "women's" : "men's"})</span></div>
    </div>
    <div id="rhist" class="rhist" hidden></div>
    ${cupRec.length ? `<div class="kicker" style="margin-top:10px">U.S. Open Cup &middot; real results, ${Math.min(...cupRec.map(e => e.y))}&ndash;${Math.max(...cupRec.map(e => e.y))}</div>
    <div class="histwrap" tabindex="0" role="region" aria-label="U.S. Open Cup match history"><ul class="careerway">${cupRec.slice().reverse().map(e => {
      const wl = e.gf > e.ga ? 'W' : e.gf < e.ga ? 'L' : (e.pens ? (e.pens[0] > e.pens[1] ? 'W' : 'L') + ' pens' : 'D');
      return `<li><span class="cw-years">${e.y}</span><span class="cw-club">${e.ha === 'H' ? 'v' : 'at'} ${esc(e.opp)} &middot; ${e.gf}&ndash;${e.ga}${e.aet ? ' aet' : ''}${e.pens ? ` (${e.pens[0]}&ndash;${e.pens[1]}p)` : ''}</span><span class="cw-stat">${wl}${e.d ? ` &middot; ${e.d > 0 ? '+' : ''}${e.d}` : ''}</span></li>`;
    }).join('')}</ul></div>
    <p class="note">${c.g === 'mls' ? 'Shown for the record — MLS ranks by the official league table, so Cup results never move an MLS rating here.' : 'These matches move the rating. Cross-tier cup results are where the levels actually meet; extra-time and shootout wins count at reduced weight.'}${c.pv ? " Marked provisional: most of this club's cup movement came against opponents outside our database, valued at league average." : ''}</p>` : ''}
    ${/* One number per club. The experimental results-only Elo used to sit
          right under the headline rating, so the page showed two different
          ratings for the same team and told you one of them was experimental —
          which reliably reads as "these numbers don't mean anything". It still
          exists and is still published, but inside the methodology disclosure
          below rather than competing with the rating. */ ''}
    ${c.r ? `<div class="kicker">Rivalry Radar · nearest rated rivals</div>
    <p class="note" style="margin:2px 0 8px">Who's nearby, and how the model thinks it would go — a discovery feature, not a schedule. Verified fixtures appear when this league's feed connects.</p>
    ${opps.slice(0, 2).map((o, i) => matchCard(i === 0 ? c : o, i === 0 ? o : c, `${milesApart(c, o)} MI APART`)).join('') || '<p class="note">No rated opponents in the dataset yet.</p>'}
    <details class="how"><summary>How is this club's rating made?</summary><p>${c.rr === 1
      ? "From real results: Elo over this season's matches — everyone starts at 1500, winners take points from losers, weighted by upset size and goal margin, with a backtested tier-tuned home edge (+30 amateur, +65 pro)."
      : c.rr === 2
      ? 'From real league standings: points and goal difference set the rating band.'
      : c.rr === 3
      ? 'From Massey Ratings — an independent results-based power rating for college soccer — rescaled onto our Elo bands. Preseason values until fall results land; refreshed as the season runs.' + (c.re ? ' The smaller results-only Elo is experimental — same match-by-match walk we use everywhere else, shown for transparency but not used for ranks.' : '')
      : "Illustrative placeholder until this league's results feed is connected — the number demonstrates the product, not the club."}${c.re && c.rr !== 3 ? ` Results-only Elo for this club is <b>${c.re}</b> — the same match-by-match walk, published for transparency but not used for the rating or the ranks.` : ''}</p></details>` : `<div class="kicker">Matches</div><p class="note">Match history and fixtures appear when this league's results feed is connected — no invented games on real organizations.</p>`}
    ${squadFor(c).length ? `<div class="kicker" style="margin-top:14px">Squad</div>${verifyBadge(c)}
    <ul class="squad staff">${staffFor(c).map(st2 =>
      `<li><span class="sq-num">${st2.tag}</span><span class="sq-name">${esc(st2.name)}</span><span class="sq-pos">${st2.role}</span><span class="sq-age">${st2.age}</span><span class="sq-form"></span></li>`).join('')}</ul>
    <ul class="squad">${squadFor(c).map((pl, pi) =>
      `<li><a href="#/player/${c.id}/${pi}"><span class="sq-num">${pl.num}</span><span class="sq-name">${esc(pl.name)}</span><span class="sq-pos">${pl.pos}</span><span class="sq-age">${pl.real ? (pl.nat || '') : ''}</span><span class="sq-ga">${pl.pos === 'GK' ? pl.cs + ' CS' : pl.goals + 'g ' + pl.assists + 'a'}</span><span class="sq-form">${pl.pvr}</span></a></li>`).join('')}</ul>
    ` : apps && apps.players.length ? `<div class="kicker" style="margin-top:14px">Squad &middot; ${apps.players.length} players used</div>
    <ul class="apps-list">${apps.players.map(pl => `<li class="apps-row">
      <span class="apps-name">${esc(pl.n)}</span>
      <span class="apps-bar" aria-hidden="true"><i style="width:${Math.round(100 * pl.st / Math.max(1, apps.players[0].st + apps.players[0].sub))}%"></i></span>
      <span class="apps-n">${pl.st + pl.sub}<small>${pl.st} start${pl.st === 1 ? '' : 's'}${pl.sub ? ` &middot; ${pl.sub} sub` : ''}</small></span></li>`).join('')}</ul>
    <p class="note">Every player named in a matchday squad this season, most-used first, from banked USL League Two team sheets. Appearances count matchday squads, not minutes &mdash; the source lists the eleven and the reserves, not who came on. No ages: players under 18 keep their name and lose their birth year here, and an appearance count never needed one.</p>
    ${interestForm('club-add', c.n)}`
    : `<div class="kicker" style="margin-top:14px">Squad</div><p class="note">Roster unclaimed. Real rosters come from league feeds and claimed clubs — no placeholder players on real organizations.</p><a class="claim" href="mailto:hello@rankedxi.com?subject=${encodeURIComponent('Claim club: ' + c.n)}" style="margin-top:6px">Run this club? Add your roster</a>`}
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
    ${clubTry.length ? `<div class="kicker" style="margin-top:14px">Open tryouts &middot; from the Tryouts board</div>
    ${clubTry.map(t => `<div class="pricecard"><b>${new Date(t.date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}${t.time ? ' &middot; ' + esc(t.time) : ''}</b>
      <p>${[t.city && t.st ? `${esc(t.city)}, ${esc(t.st)}` : esc(t.st || t.city || ''), t.league ? esc(t.league) : '', t.details ? esc(t.details) : ''].filter(Boolean).join(' · ')}</p>
      ${t.link ? `<div class="linkrow"><a href="${safeHref(t.link)}" target="_blank" rel="noopener">Tryout details</a></div>` : ''}</div>`).join('')}
    <p class="note"><a href="#/tryouts" style="color:var(--accent)">All open tryouts &rarr;</a></p>` : ''}
    <p class="note">${(c.si || c.sx || c.sf || c.url) ? 'Official site and social links above come from Wikidata, league sources, and the club\'s own website — they go exactly where they say.' : 'Club website and socials appear at the top once the club claims its page — links always go exactly where they say.'}</p>
    ${interestForm('club-add', c.n)}
    <p class="note">Claimed clubs manage their crest, links, roster and schedule.</p>
    ${reportLink('Fix', c.n)}`;
  wireFav();
  const pb = view.querySelector('.predictbtn2');
  if (pb) pb.addEventListener('click', () => openPredict(pb.dataset.predict));
  const simb = view.querySelector('[data-sim]');
  if (simb) simb.addEventListener('click', () => { location.hash = '#/sim/' + simb.dataset.sim; });
  if (c.r) renderRatingHistory(c);
  const sb = view.querySelector('.sharebtn');
  if (sb) sb.addEventListener('click', async () => {
    /* rated clubs have a static /club/<id> page with a per-club share card —
       that's the link that unfurls properly everywhere; unrated (youth
       directory) clubs fall back to the app route */
    const url = (c.r && !c.h) ? `https://www.rankedxi.com/club/${c.id}` : `https://www.rankedxi.com/app#/club/${c.id}`;
    if (navigator.share) {
      try { await navigator.share({ title: `${c.n} — Ranked XI`, url }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(url); sb.textContent = 'Link copied ✓'; }
    catch { sb.textContent = url; }
    setTimeout(() => { sb.textContent = 'Share'; }, 1800);
  });
}

/* ---- rating history sparkline ------------------------------------------
   data/rank_history.json is appended by scripts/snapshot_ranks.py on each
   weekly rotation (see that file) — one column per rotation date, one row per
   rated club. Fetched lazily on the club page only. The chart draws once a
   club has three points; before that the block says when history began so a
   reader knows the line is coming rather than missing. */
let _rhist = null;
const loadRatingHistory = () => _rhist || (_rhist = fetch('data/rank_history.json?v=__RXIV__')
  .then(r => r.ok ? r.json() : null).catch(() => null));
async function renderRatingHistory(c) {
  const box = view.querySelector('#rhist'); if (!box) return;
  const hist = await loadRatingHistory();
  if (!hist || !hist.clubs[c.id] || !view.contains(box)) return;
  const pts = hist.dates.map((d, i) => [d, hist.clubs[c.id][i]]).filter(p => p[1] != null);
  box.hidden = false;
  const first = new Date(hist.dates[0] + 'T12:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  if (pts.length < 3) {
    box.innerHTML = `<span class="kicker">Rating over time</span><p class="note" style="margin:4px 0 0">History began ${first}; the chart draws after three weekly points (${pts.length} so far).</p>`;
    return;
  }
  const W = 320, H = 72, P = 6;
  const vs = pts.map(p => p[1]), lo = Math.min(...vs), hi = Math.max(...vs), span = Math.max(hi - lo, 20);
  const x = i => P + i * (W - 2 * P) / (pts.length - 1), y = v => H - P - (v - lo) / span * (H - 2 * P);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p[1]).toFixed(1)).join(' ');
  const delta = vs[vs.length - 1] - vs[0];
  box.innerHTML = `<span class="kicker">Rating over time · ${pts.length} weeks</span>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Rating from ${vs[0]} on ${first} to ${vs[vs.length - 1]} now"><path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${x(pts.length - 1).toFixed(1)}" cy="${y(vs[vs.length - 1]).toFixed(1)}" r="3" fill="var(--accent)"/></svg>
    <div class="meta"><span>${first}: ${vs[0]}</span><span>${delta > 0 ? '+' : ''}${delta} since</span></div>`;
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
    <p class="fine" style="font-size:.75rem">Data last refreshed: ${BUILD_DATE} (build v${BUILDV}) &middot; rosters and stats auto-refresh every 12 hours &middot; <a href="#/legal" style="color:var(--accent)">Terms &amp; Privacy</a> &middot; <a href="/methodology" style="color:var(--accent)">Methodology &amp; Disclaimer</a></p>
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
  const at = location.hash || '#/map';
  const cidx = clubIdx(String(ci));
  if (cidx < 0) return screenMap();
  if (String(ci) !== CLUBS[cidx].id) { location.replace('#/player/' + CLUBS[cidx].id + '/' + pi); return; }
  const c = CLUBS[cidx]; if (!c.r) return screenMap();
  const sq = squadFor(c); const pl = sq[+pi]; if (!pl) return screenClub(ci);
  const prof = pl.real ? ((await profilesDb())[pl.name] || {}) : {};
  if (routedAway(at)) return;
  crumb.textContent = c.st;
  const peers = allPlayers(c.x).filter(p => p.pos === pl.pos && (!pl.rs || p.rs)).sort((a, b) => b.pvr - a.pvr);
  const rank = peers.findIndex(p => p.c === c && p.i === +pi) + 1;
  view.innerHTML = `
    <button class="backbtn" onclick="history.length>1?history.back():location.hash='#/club/${ci}'">&larr; ${esc(c.n)}</button>
    <div class="clubhead">
      <img class="pphoto" src="${prof.photo || AVATAR}" alt="${esc(pl.name)}">
      <div><h2 class="disp" style="margin:0">${esc(pl.name)}</h2>
      <span class="sub">${pl.num ? '#' + pl.num + ' · ' : ''}${pl.pos}${pl.real ? (pl.nat ? ' · ' + pl.nat : '') : ' · ' + pl.age + ' yrs'} · ${esc(c.n)}</span></div>
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
  /* fallback listener, not an inline onerror attribute: AVATAR is a data URI
     full of single quotes, which terminated the attribute's JS string and
     threw "Unexpected identifier" on every failed headshot */
  const ph = view.querySelector('.pphoto');
  if (ph) ph.addEventListener('error', () => { if (ph.src !== AVATAR) ph.src = AVATAR; });
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
    { t: 'Regional & emerging', leagues: ['apsl', 'gcpl', 'loc', 'swpl', 'mpl', 'mwpl', 'cpl', 'csl', 'sfsfl', 'eplwa', 'lisfl'], coming: [
      /* The old Eastern Premier (EPSL) is NOT missing: it renamed to APSL in
         Feb 2025 and is already a rated layer above. */
      /* BDSL held out 8/2026: bdsl.org's own standings embed 403s site-wide,
         so no verifiable 2026 Premier roster exists — see usasa-elite-batch/bdsl.md. */
      'Buffalo & District SL', 'More regional leagues', 'State, city & rec leagues'] },
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
/* league page (#/league/:key): what the league is, where to watch it, and
   every club we map in it — the sticky in-app home for each league, with the
   official site one tap away. Profile text and watch links are hand-curated
   in data/leagues_info.json; watch URLs are verified before shipping. */
let _lgInfo = null;
async function leaguesInfoDb() {
  if (_lgInfo) return _lgInfo;
  try { _lgInfo = await (await fetch('data/leagues_info.json?v=__RXIV__')).json(); }
  catch { _lgInfo = { leagues: {} }; }
  return _lgInfo;
}
async function screenLeague(key) {
  const at = location.hash || '#/map';
  const m = LEAGUES[key];
  if (!m) return screenPyramid();
  crumb.textContent = m.label;
  const info = ((await leaguesInfoDb()).leagues || {})[key] || {};
  if (routedAway(at)) return;
  const clubs = CLUBS.filter(c => c.g === key && !c.h);
  const ranked = clubs.filter(c => c.r).sort(eloRank);
  const rest = clubs.filter(c => !c.r).sort((a, b) => a.n.localeCompare(b.n));
  const level = LEVELS.pro.includes(key) ? 'professional' : LEVELS.college.includes(key) ? 'college'
    : LEVELS.youth.includes(key) ? 'youth' : 'amateur';
  view.innerHTML = `
    <button class="backbtn" onclick="history.length>1?history.back():location.hash='#/tiers'">&larr; Back</button>
    <div class="clubhead">${m.img ? `<img class="crest imgcrest${m.inv ? ' inv-' + m.inv : ''}" src="${m.img}" alt="" onerror="this.style.display='none'">` : `<span class="crest" style="background:${m.color}">${esc(m.label[0])}</span>`}
      <div><h2 class="disp" style="margin:0">${esc(m.label)}</h2>
      <span class="sub">${clubs.length} clubs &middot; ${m.sex === 'w' ? "women's" : "men's"} ${level} soccer</span></div>
    </div>
    ${m.url ? `<div class="btnrow"><a class="hdrlink" href="${m.url}" target="_blank" rel="noopener">Official league site &nearr;</a></div>` : ''}
    ${info.about ? `<p style="margin:10px 0 4px;line-height:1.55">${esc(info.about)}</p>` : ''}
    ${(info.watch || []).length ? `
      <div class="kicker" style="margin-top:14px">Where to watch</div>
      <div class="watchrow">${info.watch.map(watchChip).join('')}</div>
      ${info.watchNote ? `<p class="note" style="margin:6px 0 0">${esc(info.watchNote)}</p>` : ''}` : ''}
    <div class="kicker" style="margin-top:16px">All clubs${ranked.length ? ' &middot; ranked by rating' : ''}</div>
    <ul class="clublist">${ranked.map((c, i) => clubRow(c, rankNo(c, i))).join('')}${rest.map(c => clubRow(c)).join('')}</ul>
    ${LEVELS.youth.includes(key) ? '<p class="note">Youth directory entries are name, league and league-stated location only — no ratings, fixtures or player data.</p>' : ''}`;
}

function screenPyramid() {
  crumb.textContent = 'Tiers';
  const count = g => CLUBS.filter(c => c.g === g && !c.h).length;
  view.innerHTML = `
    ${sexToggle()}
    <div class="kicker">The structure of American soccer</div>
    <h2 class="disp">The Pyramid</h2>
    <div class="tiers">${TIERS[sex].map((tier, i, all) => `
      <div class="tier" style="width:${100 - (all.length - 1 - i) * (52 / all.length)}%">
        <div class="tier-label">${tier.t}${tier.pro ? ' · pro' : ''}</div>
        <div class="tier-leagues">
          ${(tier.leagues || []).map(g => { const m = LEAGUES[g]; const inner = `${m.img ? `<img class="${m.inv ? 'inv-' + m.inv : ''}" src="${m.img}" alt="" onerror="this.style.display='none'">` : `<span class="dot" style="background:${m.color}"></span>`}<b>${m.label}</b><span>${count(g)} clubs</span>`; return `<a class="tierlg" href="#/league/${g}">${inner}</a>`; }).join('')}
          ${(tier.extra || []).map(g => { const m = LEAGUES[g]; const inner = `${m.img ? `<img class="${m.inv ? 'inv-' + m.inv : ''}" src="${m.img}" alt="" onerror="this.style.display='none'">` : ''}<b>${m.label}</b><span>${count(g)} clubs</span>`; return `<a class="tierlg dimmed" href="#/league/${g}">${inner}</a>`; }).join('')}
          ${(tier.coming || []).map(c => c.url
            ? `<a class="tierlg coming" href="${c.url}" target="_blank" rel="noopener">${c.img ? `<img src="${c.img}" alt="">` : ''}<b>${c.label}</b><span>league site</span></a>`
            : `<span class="tierlg coming"><b>${c.label || c}</b></span>`).join('')}
        </div>
        ${tier.note ? `<div class="tier-note">${tier.note}</div>` : ''}
      </div>`).join('')}
    </div>
    <a class="fa-card" href="#/cups"><b>&#127942; The Trophy Room</b><span>16 national trophies, every tier — MLS Cup to the NPSL, the College Cups, and the Open Cup back to 1914.</span></a>
    <a class="fa-card" href="#/nt"><b>&#127482;&#127480; National Teams</b><span>Above the pyramid — USA youth national teams in Concacaf and FIFA competition, with fixtures and how to watch.</span></a>
    <a class="gk-cta" href="#/college">College results, 2025 season &rarr;</a>
    <p class="note">Tiers are organizational, not sporting — US soccer has no promotion and relegation between most levels. The pathway runs through players, not clubs: youth to college to the amateur leagues to the pro game. Tap a league for its page &mdash; every club, where to watch, and the official site.</p>`;
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
    ${/* The board used to render three invented players named "Sample: …".
          A club owner arriving from the pricing page found fake people on a
          product with a price attached, which teaches them we market things we
          do not have. An empty board that says it is empty costs nothing. */ ''}
    <p class="note"><b>The board is not open yet.</b> No players are listed here — we would rather show you an empty board than invented ones. It opens when there are real players on it; the sample profile above shows exactly what a listing will contain. Listings are for players <b>18 and older</b>, arrive by email, and every one is human-reviewed before it publishes.</p>
    ${interestForm('free-agent', 'Free Agents board')}
    <p class="note">Free to join, free while the board is finding its feet, and no commissions ever: your deal is yours. Clubs: browsing will be free, and posting open-tryout dates is free right now — <a href="#/tryouts" style="color:var(--accent)">post on the Tryouts board</a>.</p>
    <p class="note"><a href="mailto:${NOTICE_MAIL}?subject=${encodeURIComponent('Report a free agent listing')}&body=${encodeURIComponent('Listing (name shown):\nWhat is wrong (impersonation, inaccurate, inappropriate, other):\n')}" style="color:var(--accent)">Report a listing</a> — reports are reviewed within days; a listing that misrepresents someone comes down first, questions after.</p>`;
}

/* Nothing on the free-agent path is priced while the board is closed. These
   two strings are the single source for that wording so the board, the sample
   listing and the pricing page can never contradict each other again — which
   they did, when two of them charged "$25 per season" and the third said the
   founding listings were free. */
const FA_PRICE_CTA = 'free';
const FA_PRICE_NOTE = 'Free to join and free to be listed. No commissions, no placement cuts: your deal is yours.';

let tryoutSex = 'all', tryoutSort = 'date';
async function screenTryouts() {
  const at = location.hash || '#/map';
  crumb.textContent = 'Tryouts';
  const all = await tryoutsDb();
  if (routedAway(at)) return;
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = all.filter(t => t.date >= today).sort((a, b) => a.date < b.date ? -1 : 1);
  let list = tryoutSex === 'all' ? upcoming : upcoming.filter(t => t.x === tryoutSex);
  /* secondary sorts keep date order inside each group — soonest first */
  if (tryoutSort === 'state') list = [...list].sort((a, b) => (a.st || 'zz').localeCompare(b.st || 'zz') || (a.date < b.date ? -1 : 1));
  else if (tryoutSort === 'league') list = [...list].sort((a, b) => (a.league || 'zz').localeCompare(b.league || 'zz') || (a.date < b.date ? -1 : 1));
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
    <div class="chips seg" id="tsort" role="group" aria-label="Sort tryouts">
      ${[['date', 'Soonest'], ['state', 'By state'], ['league', 'By league']].map(([k, lb]) =>
        `<button class="chip solid" data-tso="${k}" aria-pressed="${tryoutSort === k}">${lb}</button>`).join('')}
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
  view.querySelector('#tsort').addEventListener('click', e => {
    const b = e.target.closest('[data-tso]'); if (!b || b.dataset.tso === tryoutSort) return;
    tryoutSort = b.dataset.tso; screenTryouts();
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

function screenPricing() {
  crumb.textContent = 'Pricing';
  /* Prices are deliberately absent. Seven priced tiers with no checkout read as
     a business plan pinned to a wall, and several of them described products
     that do not exist yet. The page still earns its place: it tells a stranger
     what will always be free, what will eventually cost money, and lets them
     register interest — which is the only demand signal we can act on. Prices
     go back the day one of these has a customer and a checkout. */
  view.innerHTML = `
    <div class="kicker">What's free, what will cost money later — and why</div>
    <h2 class="disp">Pricing</h2>
    <p class="note" style="font-size:.88rem">Nothing on Ranked XI costs anything today. The list below is what we intend to charge for eventually and what we never will — published early so nobody is surprised later. When something does get a price, it will be because it demonstrably works, not because we need the revenue.</p>

    <div class="pricecard"><b>The app · Free, always</b>
      <p>Map, tables, every club and player page, predictions, history, My XI. The rankings are the point of the site, not the product — nothing behind the map or the table will ever move behind a paywall.</p></div>

    <div class="pricecard"><b>Open Tryouts board · Free, always</b>
      <p>Posting an open tryout is free for every club and always will be. Browsing is free for players.</p>
      <a class="claim" href="#/tryouts">Post a tryout</a></div>

    <div class="kicker" style="margin-top:16px">Not built yet — register interest, pay nothing</div>

    <div class="pricecard"><b>Free Agent listing</b>
      <p>A verified badge backed by league data we already hold, your film front and centre, and alerts to clubs in your region and level. Free to join the waitlist; free when it opens; priced only if and when players are actually getting contacted through it.</p>
      <a class="claim" href="#/freeagent/sample">See a complete player listing</a></div>

    <div class="pricecard"><b>Club recruiting tools</b>
      <p>Saved-search alerts, shortlists, and direct contact. Browsing free agents will be free for clubs, permanently. The paid tier, if it exists, is speed — not access.</p>
      <a class="claim" href="#/clubtools/sample">See the club recruiting tools</a></div>

    <div class="pricecard"><b>Claim your player page</b>
      <p>If you have a page here, you can claim it: add your photo, your film, your socials, and correct anything we got wrong. Free while we build it out — we would rather the pages be right than charge you to fix them.</p>
      ${interestForm('player-claim', 'Player page')}</div>

    <div class="pricecard"><b>Add to your club page</b>
      <p>Clubs can send us what we are missing — crest, correct city, league and division, socials, tryout dates, results we do not have. It goes on your page and, where it is results or standings, into your rating. Free, and it always will be: better data makes the whole table better.</p>
      ${interestForm('club-add', 'Club page')}</div>


    <p class="note">No commissions, ever: if a club signs a player they found here, that deal is yours and we take nothing from it. Registering interest costs nothing and commits you to nothing.</p>`;
}
/* My XI (#/myxi) — the personalized front page that replaced the Follow tab.
   The screen itself lives in js/myxi.js: it is the only view that needs the
   rank tables, the wire, the fixtures and the matchup engine at once, and
   app.js is already 3,000 lines. Loaded on demand, idle-prefetched after
   first paint so the tab feels instant for the people who live in it. */
let _myxi = null;
const myxiMod = () => _myxi ||= import('./myxi.js?v=__RXIV__')
  .catch(e => { _myxi = null; throw e; });

function screenMyXi(payload) {
  crumb.textContent = 'My XI';
  view.innerHTML = '<p class="note">Loading your XI&hellip;</p>';
  myxiMod().then(mod => {
    if (!location.hash.startsWith('#/myxi')) return;   /* routed away mid-load */
    mod.render(view, {
      esc, CLUBS, LEAGUES, STATE_NAME, clubIdx, clubIdxByName, crestHtml, mcrest,
      initials, eloRank, neighbors, milesApart, matchCard, squadFor, AVATAR,
      favs, favToggle, fixturesDb, wireDb, isUpset, fmtWireDay, fmtKick,
      importPayload: payload,
    });
  }).catch(() => {
    if (!location.hash.startsWith('#/myxi')) return;
    view.innerHTML = `<div class="kicker">My XI</div>
      <h2 class="disp">Couldn't load your XI</h2>
      <p class="note">Check your connection and try again &mdash; your picks are safe in this browser.</p>
      <a class="fa-card" href="#/map"><b>&#128205; The national map</b><span>Every club in American soccer.</span></a>`;
  });
}

let legendSort = 'apps';
async function screenLegends(ci) {
  const at = location.hash || '#/map';
  const cidx = clubIdx(String(ci)); if (cidx < 0) return screenMap();
  const c = CLUBS[cidx]; ci = c.id;
  crumb.textContent = c.st;
  const all = (await legendsDb())[c.n];
  if (routedAway(at)) return;          // before the #/club bounce below
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
  try { _cups = await (await fetch('data/cups.json?v=__RXIV__')).json(); }
  catch { _cups = {}; }
  return _cups;
}
/* Giant-Killings (#/upsets): the Open Cup rounds where the pyramid actually
   meets. cups.json only ever held finals, so the 1,584 match rows sat unused.
   Module is lazy — the file is 270KB and nobody lands here first. */
let _opencup = null;
async function screenUpsets() {
  crumb.textContent = 'Giant-killings';
  view.innerHTML = '<button class="backbtn" onclick="location.hash=\'#/cups\'">&larr; Trophy Room</button>'
    + '<p class="note">Loading Open Cup results&hellip;</p>';
  try {
    const [data, mod] = await Promise.all([
      _opencup || fetch('data/opencup_matches.json?v=__RXIV__').then(r => r.json()),
      import('./opencup.js?v=__RXIV__'),
    ]);
    _opencup = data;
    if (!location.hash.startsWith('#/upsets')) return;
    /* the cup rows are bare club names; only link one when it resolves to a
       single men's non-college club, the same rule the Trophy Room uses */
    const okMen = c => c.x === 'm' && !LEVELS.college.includes(c.g);
    const linkClub = nm => {
      const i = clubIdxByName(nm, okMen);
      return i >= 0 ? `<a href="#/club/${CLUBS[i].id}">${esc(nm)}</a>` : esc(nm);
    };
    mod.render(view, data, { esc, linkClub });
  } catch (e) {
    if (!location.hash.startsWith('#/upsets')) return;
    view.innerHTML = '<button class="backbtn" onclick="location.hash=\'#/cups\'">&larr; Trophy Room</button>'
      + '<p class="note">Open Cup results could not load. Check your connection and try again.</p>';
  }
}
/* College Results (#/college): the 2025 NCAA D1 seasons behind the Massey
   rating snapshots the college layers rank by. Two files — the results and the
   ESPN-name-to-club map — both lazy, both only needed on this route. */
let _college = null, _collegeMap = null;
async function screenCollege(team) {
  crumb.textContent = 'College results';
  view.innerHTML = '<p class="note">Loading college results&hellip;</p>';
  try {
    const [data, map, mod] = await Promise.all([
      _college || fetch('data/espn_college_2025.json?v=__RXIV__').then(r => r.json()),
      _collegeMap || fetch('data/espn_club_map.json?v=__RXIV__').then(r => r.json()),
      import('./college.js?v=__RXIV__'),
    ]);
    _college = data; _collegeMap = map;
    if (!location.hash.startsWith('#/college')) return;
    mod.render(view, data, map, { esc }, team);
  } catch (e) {
    if (!location.hash.startsWith('#/college')) return;
    view.innerHTML = '<p class="note">College results could not load. Check your connection and try again.</p>';
  }
}
async function screenCups() {
  const at = location.hash || '#/map';
  crumb.textContent = 'Trophies';
  const cups = await cupsDb();
  if (routedAway(at)) return;
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
    <a class="gk-cta" href="#/upsets">See the giant-killings &rarr;</a>
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
    ${interestForm('free-agent', 'Free agent listing')}
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

/* ---- Rank Simulator: book hypothetical results and watch the league rank
   move. Rating deltas mirror scripts/compute_elo.py exactly (K=64, +30 home
   edge, ln(margin+1) goal multiplier) so the simulator predicts what the real
   pipeline would do with those scores; the win-chance line reuses oddsFor()
   so odds always agree with the Predict sheet. Nothing is persisted. ---- */
const SIM_K = 64, SIM_HOME = 30;
function simDelta(us, them, venue, gf, ga) {
  const edge = venue === 'h' ? SIM_HOME : venue === 'a' ? -SIM_HOME : 0;
  const exp = 1 / (1 + Math.pow(10, (them - (us + edge)) / 400));
  const score = gf > ga ? 1 : gf < ga ? 0 : 0.5;
  const margin = Math.log(Math.abs(gf - ga) + 1) || 1;
  return SIM_K * margin * (score - exp);
}
const simTable = g => CLUBS.filter(c => c.g === g && !c.h && c.r).sort((a, b) => b.r - a.r);
const simRank = (r, table, selfId) => 1 + table.filter(c => c.id !== selfId && c.r > r).length;

let _sim = null; // { ci, oi, v, gf, ga, simR, log: [] } — survives route changes in-session

/* club picker sheet: the Predict sheet's level chips + search, plus a league
   dropdown that lists the WHOLE league ranked (for people who don't know club
   names and want to browse) and a dice button for a random pick */
function simPickerSheet(title, filter, onPick) {
  document.querySelector('.sheet')?.remove();
  let lvl = 'all';
  const base = CLUBS.map((c, i) => ({ c, i })).filter(o => o.c.r && !o.c.h && (!filter || filter(o.c)));
  const lgs = [...new Set(base.map(o => o.c.g))]
    .sort((a, b) => LEAGUES[a].label.localeCompare(LEAGUES[b].label));
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.innerHTML = `<div class="sheet-panel">
    <div class="sheet-head"><b>${title}</b><button class="sheet-x" aria-label="Close">&times;</button></div>
    <div class="chips" id="simlvl">${['all', 'pro', 'amateur', 'college'].map(k =>
      `<button class="chip solid" data-plvl="${k}" aria-pressed="${k === 'all'}">${k === 'all' ? 'All levels' : k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div>
    <div class="simpickrow">
      <select id="simlg" aria-label="League filter"><option value="">All leagues &mdash; or pick one to browse</option>${lgs.map(g =>
        `<option value="${g}">${esc(LEAGUES[g].label)}${LEAGUES[g].sex === 'w' ? ' (W)' : ''} &middot; ${base.filter(o => o.c.g === g).length}</option>`).join('')}</select>
      <button class="chip solid" id="simrand" aria-pressed="false">&#127922; Random</button>
    </div>
    <input id="simq" type="search" placeholder="Search any club" autocomplete="off">
    <div class="sheet-list" id="simlist"></div>
  </div>`;
  document.querySelector('.screen').appendChild(sheet);
  const list = sheet.querySelector('#simlist'), q = sheet.querySelector('#simq'), lg = sheet.querySelector('#simlg');
  const pool = () => {
    let cands = base;
    if (lg.value) cands = cands.filter(o => o.c.g === lg.value);
    else if (LEVELS[lvl]) cands = cands.filter(o => LEVELS[lvl].includes(o.c.g));
    const term = q.value.trim().toLowerCase();
    if (term) cands = cands.filter(o => o.c.n.toLowerCase().includes(term));
    return [...cands].sort((a, b) => b.c.r - a.c.r);
  };
  const renderList = () => {
    const rows = pool();
    // a chosen league lists every club in it (that's the browse case);
    // otherwise cap like the Predict sheet so the all-clubs list stays snappy
    const shown = lg.value ? rows : rows.slice(0, 40);
    list.innerHTML = shown.map(o =>
      `<a class="qrow" data-pick="${o.i}" href="javascript:void(0)">${crestHtml(o.c)}<span><b>${esc(o.c.n)}</b><i>#${simRank(o.c.r, simTable(o.c.g), o.c.id)} in ${LEAGUES[o.c.g].label} &middot; ${o.c.st} &middot; ${o.c.r}</i></span></a>`).join('')
      || '<div class="qrow qnone">No matches &mdash; try All leagues</div>';
  };
  renderList();
  q.addEventListener('input', renderList);
  lg.addEventListener('change', renderList);
  sheet.querySelector('#simlvl').addEventListener('click', e => {
    const b = e.target.closest('[data-plvl]'); if (!b) return;
    lvl = b.dataset.plvl; lg.value = '';
    sheet.querySelectorAll('#simlvl .chip').forEach(x => x.setAttribute('aria-pressed', x.dataset.plvl === lvl));
    renderList();
  });
  const done = c => { sheet.remove(); onPick(c); };
  sheet.querySelector('#simrand').addEventListener('click', () => {
    const rows = pool(); if (!rows.length) return;
    done(rows[Math.floor(Math.random() * rows.length)].c);
  });
  list.addEventListener('click', e => {
    const a = e.target.closest('[data-pick]'); if (!a) return;
    done(CLUBS[+a.dataset.pick]);
  });
  const close = () => sheet.remove();
  sheet.querySelector('.sheet-x').addEventListener('click', close);
  sheet.addEventListener('click', e => { if (e.target === sheet) close(); });
  addEventListener('hashchange', close, { once: true });
  q.focus();
}

function screenSimulator(ref) {
  crumb.textContent = 'Rank Simulator';
  if (ref != null) {
    const ci = clubIdx(ref);
    const c0 = CLUBS[ci];
    if (ci >= 0 && c0 && c0.r && !c0.h) {
      if (String(ref) !== c0.id) { location.replace('#/sim/' + c0.id); return; }
      if (!_sim || _sim.ci !== ci) _sim = { ci, oi: null, v: 'h', gf: 2, ga: 1, simR: c0.r, log: [] };
    }
  }
  const c = _sim && CLUBS[_sim.ci];
  if (!c) {
    /* no club yet: land straight in the simulator — the intro screen cost a
       tap. First followed club when one exists, else a random rated club;
       the club button on the sim header still swaps clubs */
    const favc = favs().clubs.map(id => CLUBS[CLUB_BY_ID.get(id)]).find(x => x && x.r && !x.h);
    const pool2 = CLUBS.filter(x => x.r && !x.h);
    const start = favc || pool2[Math.floor(Math.random() * pool2.length)];
    if (!start) return screenMap();
    location.replace('#/sim/' + start.id);
    return;
  }
  const table = simTable(c.g);
  if (_sim.oi == null) {
    // default opponent: the club one rank above — the one you're chasing
    const idx = table.findIndex(x => x.id === c.id);
    const def = idx > 0 ? table[idx - 1] : table[1];
    if (def) _sim.oi = CLUB_BY_ID.get(def.id);
  }
  const o = _sim.oi != null ? CLUBS[_sim.oi] : null;
  const rank0 = simRank(c.r, table, c.id), rank1 = simRank(_sim.simR, table, c.id);
  const dTot = _sim.simR - c.r;
  const passed = table.filter(x => x.id !== c.id && x.r <= _sim.simR && x.r > c.r).map(x => x.n);
  const dropped = table.filter(x => x.id !== c.id && x.r > _sim.simR && x.r <= c.r).length;
  let previewLine = '';
  if (o) {
    const mine = { ...c, r: Math.round(_sim.simR) };
    const odds = _sim.v === 'h' ? oddsFor(mine, o) : oddsFor(o, mine);
    const winP = _sim.v === 'h' ? odds.pH : odds.pA;
    const d = simDelta(_sim.simR, o.r, _sim.v, _sim.gf, _sim.ga);
    const word = _sim.gf > _sim.ga ? 'win' : _sim.gf === _sim.ga ? 'draw' : 'loss';
    previewLine = `About a <b>${Math.round(winP * 100)}%</b> chance of beating ${esc(o.n)} ${_sim.v === 'h' ? 'at home' : 'away'} &mdash; a ${_sim.gf}&ndash;${_sim.ga} ${word} would ${d >= 0 ? 'gain' : 'cost'} <b>${d >= 0 ? '+' : ''}${d.toFixed(1)} points</b>.`;
  }
  view.innerHTML = `
    <button class="backbtn" onclick="history.length>1?history.back():location.hash='#/club/${c.id}'">&larr; Back</button>
    <div class="kicker">Rank Simulator &middot; hypothetical &middot; nothing is saved</div>
    <h2 class="disp">${esc(c.n)}</h2>
    <div class="simclubrow">
      ${crestHtml(c)}<span><b>#${rank0} in ${LEAGUES[c.g].label}</b><i>${c.r} points &middot; ${table.length} rated clubs</i></span>
      <button class="chip solid" id="simswap" aria-pressed="false">Change club</button>
    </div>
    <div class="kicker" style="margin-top:14px">Predict a match</div>
    <div class="simclubrow">
      ${o ? crestHtml(o) : ''}<span>${o ? `<b>${esc(o.n)}</b><i>${LEAGUES[o.g].label} &middot; ${o.r} points</i>` : '<b>Choose an opponent</b><i>any league, any level</i>'}</span>
      <button class="chip solid" id="simopp" aria-pressed="false">${o ? 'Change opponent' : 'Choose'}</button>
    </div>
    <div class="chips seg" id="simvenue" style="margin-top:10px">
      <button class="chip solid" data-v="h" aria-pressed="${_sim.v === 'h'}">Home</button>
      <button class="chip solid" data-v="a" aria-pressed="${_sim.v === 'a'}">Away</button>
    </div>
    <div class="simgoals">
      <label>Your goals<input id="simgf" type="number" min="0" max="15" value="${_sim.gf}"></label>
      <label>Their goals<input id="simga" type="number" min="0" max="15" value="${_sim.ga}"></label>
      <button class="predictbtn2" id="simbook"${o ? '' : ' disabled'}>Add this result</button>
      <button class="chip solid" id="simreset" aria-pressed="false">Start over</button>
    </div>
    <p class="note" id="simprev">${previewLine}</p>
    <div class="kicker" style="margin-top:14px">Where you'd land</div>
    <div class="statgrid">
      <div class="stat"><b>${rank1 === rank0 ? '#' + rank1 : `#${rank0} <span class="simarrow">&rarr;</span> <span class="${rank1 < rank0 ? 'sim-up' : 'sim-down'}">#${rank1}</span>`}</b><span>League rank</span></div>
      <div class="stat"><b>${_sim.log.length ? `${c.r} <span class="simarrow">&rarr;</span> ${Math.round(_sim.simR)}` : c.r}</b><span>Points</span></div>
      <div class="stat"><b>${_sim.log.length ? `<span class="${dTot >= 0 ? 'sim-up' : 'sim-down'}">${dTot >= 0 ? '+' : ''}${Math.round(dTot)}</span>` : '&mdash;'}</b><span>Gained / lost</span></div>
    </div>
    ${passed.length ? `<p class="note sim-up">You'd pass: ${passed.slice(0, 5).map(esc).join(', ')}${passed.length > 5 ? ` +${passed.length - 5} more` : ''}</p>`
      : dropped ? `<p class="note sim-down">${dropped} club${dropped > 1 ? 's' : ''} would pass you.</p>`
      : _sim.log.length ? '' : `<p class="note">Add a result and these numbers move.</p>`}
    ${_sim.log.length ? `<ul class="simlog">${_sim.log.map(m =>
      `<li><span>${m.gf > m.ga ? '&#9989; Won' : m.gf === m.ga ? '&#10134; Drew' : '&#10060; Lost'} ${m.gf}&ndash;${m.ga} ${m.v === 'h' ? 'vs' : 'at'} ${esc(m.n)}${m.xlg ? ` <i>(${esc(m.xlg)})</i>` : ''}</span><span class="${m.d >= 0 ? 'sim-up' : 'sim-down'}">${m.d >= 0 ? '+' : ''}${m.d.toFixed(1)}</span></li>`).join('')}</ul>` : ''}
    <div class="kicker" style="margin-top:14px">What would it take?</div>
    <div class="simgoals">
      <label>Rank you want<input id="simtarget" type="number" min="1" value="${Math.max(1, rank0 - 5)}"></label>
      <button class="predictbtn2" id="simsolve">Show me</button>
    </div>
    <p class="note" id="simroad"></p>
    <p class="note" style="margin-top:14px">Hypothetical results only &mdash; the real rankings
    never move. Rating changes use the production Elo math (K=64, +30 home edge, goal-margin
    multiplier); win chances match the Predict sheet. Estimates for entertainment and analysis,
    not betting advice.</p>`;
  view.querySelector('#simswap').addEventListener('click', () =>
    simPickerSheet('Choose your club', null, c2 => {
      if (c2.id === c.id) return;
      _sim = null; location.hash = '#/sim/' + c2.id;
    }));
  view.querySelector('#simopp').addEventListener('click', () =>
    simPickerSheet('Choose an opponent', x => x.x === c.x && x.id !== c.id, o2 => {
      _sim.oi = CLUB_BY_ID.get(o2.id); screenSimulator();
    }));
  view.querySelector('#simvenue').addEventListener('click', e => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    _sim.v = b.dataset.v; screenSimulator();
  });
  const clampG = n => Math.max(0, Math.min(15, Math.round(+n || 0)));
  ['simgf', 'simga'].forEach(id => view.querySelector('#' + id).addEventListener('change', e => {
    _sim[id === 'simgf' ? 'gf' : 'ga'] = clampG(e.target.value); screenSimulator();
  }));
  view.querySelector('#simbook').addEventListener('click', () => {
    if (_sim.oi == null) return;
    const opp = CLUBS[_sim.oi];
    const d = simDelta(_sim.simR, opp.r, _sim.v, _sim.gf, _sim.ga);
    _sim.simR += d;
    _sim.log.push({ n: opp.n, v: _sim.v, gf: _sim.gf, ga: _sim.ga, d,
                    xlg: opp.g !== c.g ? LEAGUES[opp.g].label : null });
    screenSimulator();
  });
  view.querySelector('#simreset').addEventListener('click', () => {
    _sim.simR = c.r; _sim.log = []; screenSimulator();
  });
  view.querySelector('#simsolve').addEventListener('click', () => {
    const t = Math.max(1, Math.round(+view.querySelector('#simtarget').value || 1));
    const others = table.filter(x => x.id !== c.id).map(x => x.r).sort((a, b) => a - b);
    const median = others[Math.floor(others.length / 2)] ?? c.r;
    let r = c.r, wins = 0;
    while (simRank(r, table, c.id) > t && wins < 20) { r += simDelta(r, median, 'h', 1, 0); wins++; }
    const now = simRank(c.r, table, c.id);
    view.querySelector('#simroad').innerHTML = now <= t
      ? `Already there &mdash; ${esc(c.n)} sits at #${now}.`
      : simRank(r, table, c.id) <= t
        ? `From #${now} to <b>#${t}</b>: about <b class="sim-up">${wins === 1 ? 'one 1&ndash;0 home win' : wins + ' straight 1&ndash;0 home wins'}</b> over a typical ${LEAGUES[c.g].label} side (rated ${Math.round(median)}). Beating stronger clubs gets there in fewer games.`
        : `Even 20 straight wins over a typical side wouldn't reach #${t} &mdash; it would take results against the top of the table.`;
  });
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
    ${interestForm('club-tools', 'Club recruiting tools')}
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
    <p style="margin-top:14px"><b>Privacy.</b> No tracking cookies, no third-party trackers and no advertising pixels. We count pageviews on our own servers without recording who you are, and we honor Do Not Track. Your favorites live in your browser's local storage and following a club still sends us nothing; we hold a copy only if you choose to save your XI to an email address, which is optional, passwordless and off by default. The only address we hold is one you typed in yourself: a form, the club-results email, or that saved XI (13 and older, unsubscribe in every send). We never sell or share it. <a href="/privacy">Full privacy policy</a>.</p>
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
  const upset = isUpset(w);
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
    if (sc && sc.goals > 1) items.push({ tag: 'Golden Boot', href: link(sc), c: sc.c,
      head: `${sc.name} — ${sc.goals} goals`, sub: `${L} scoring leader · xG ${sc.xg ?? '—'} · ${sc.c.n}` });
    const as = [...lp].sort((a, b) => b.assists - a.assists || (b.xa || 0) - (a.xa || 0))[0];
    if (as && as.assists > 1) items.push({ tag: 'Playmaker', href: link(as), c: as.c,
      head: `${as.name} — ${as.assists} assists`, sub: `${L} assist leader${as.kp != null ? ' · ' + as.kp + ' key passes' : ''} · ${as.c.n}` });
    const gk = lp.filter(p => p.pos === 'GK' && p.gc != null && p.mins >= 900 && p.saves + p.gc > 0)
      .sort((a, b) => b.saves / (b.saves + b.gc) - a.saves / (a.saves + a.gc))[0];
    if (gk) items.push({ tag: 'The Wall', href: link(gk), c: gk.c,
      head: `${gk.name} — ${Math.round(100 * gk.saves / (gk.saves + gk.gc))}% save rate`,
      sub: `${L} keeper leader · ${gk.saves} saves, ${gk.gc} conceded · ${gk.c.n}` });
  }
  return items;
}
async function screenWire() {
  crumb.textContent = 'The Wire';
  const lgs = (sex === 'w' ? ['nwsl', 'uslw'] : ['mls', 'uslc', 'usl1', 'mnp', 'usl2', 'npsl']).filter(g => LEAGUES[g]);
  if (wireLg !== 'all' && !lgs.includes(wireLg)) wireLg = 'all';
  const active = wireLg === 'all' ? lgs : [wireLg];
  const leaders = wireLeaders(active).map(it => `
    <a class="match wirelink" href="${it.href}">
      <div class="mrow"><span class="side">${it.c ? mcrest(it.c) : ''}<span class="sn">${esc(it.head)}</span></span><span class="vs wtag">${it.tag.toUpperCase()}</span></div>
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
  /* The fixtures file used to hold two NPSL playoff games, so this block was
     hard-coded to NPSL and gated on that chip. It now carries six leagues, so
     it filters on the league the row states and follows whichever chip the
     reader is on. Capped: the wire is a results screen and the schedule lives
     on #/matches. */
  const nowW = Date.now();
  const upcoming = (await fixturesDb())
    .filter(f => activeSet.has(f.lg))
    .filter(f => { const t = Date.parse(f.start); return t > nowW - 6 * 36e5 && t < nowW + 14 * 864e5; })
    .sort((x, y) => x.start < y.start ? -1 : 1)
    .slice(0, 6);
  box.innerHTML =
    (upcoming.length ? `<div class="kicker" style="margin-top:12px">Coming up · next fixtures</div>` +
      upcoming.map(fixtureRow).join('') +
      `<p class="note"><a href="#/matches">All verified fixtures &rarr;</a></p>` : '') +
    (rows.length ? `<div class="kicker" style="margin-top:12px">The results wire · ${rows.length.toLocaleString()} rated matches</div>` +
      rows.slice(0, wireLimit).map(wireResultRow).join('') +
      (rows.length > wireLimit ? `<button class="chip solid" id="wiremore" style="margin-top:8px">Show more</button>` : '')
    : '<p class="note" style="margin-top:10px">No match results in this filter yet.</p>');
  box.querySelector('#wiremore')?.addEventListener('click', () => { wireLimit += 30; screenWire(); });
}

/* WCAG 2.4.2 page titles + SPA route announcement: title updates per route
   and focus moves to <main> after navigation so screen readers hear the new
   screen (first paint keeps browser default focus) */
const ROUTE_TITLES = { map: 'Map', tiers: 'Tiers', table: 'National Table', matches: 'Matches', predict: 'Matchup Machine', compare: 'Compare Clubs', tools: 'Tools', race: 'Season Race', 'player-sim': 'Player Simulator', shots: 'Shot Maps', radar: 'Player Radar', myxi: 'My XI', about: 'About', legal: 'Terms, Privacy & Notices', wire: 'The Wire', sim: 'Rank Simulator', freeagents: 'Free Agents', freeagent: 'Free Agent', tryouts: 'Open Tryouts', pricing: 'Pricing', cups: 'Cups', upsets: 'Giant-Killings', college: 'College Results', league: 'League', nt: 'National Teams', legends: 'Legends', clubtools: 'Club Tools', state: 'State', region: 'Region', club: 'Club', player: 'Player', notfound: 'Page not found' };
/* Hash routes people actually type or get sent. Every one of these was a
   plausible guess at a real screen that silently rendered the map instead —
   a stranger following a link from a DM concluded the site was broken rather
   than that the URL was wrong. Guesses redirect to the real screen; anything
   left over gets an honest not-found. */
const ROUTE_ALIAS = {
  'free-agents': 'freeagents', 'free-agent': 'freeagent', freeagency: 'freeagents',
  claim: 'clubtools', 'claim-club': 'clubtools', 'club-tools': 'clubtools',
  following: 'myxi', follow: 'myxi', favorites: 'myxi', favourites: 'myxi',
  'my-xi': 'myxi', myxi11: 'myxi', home: 'myxi',
  leagues: 'tiers', pyramid: 'tiers', 'national-table': 'table',
  rankings: 'table', standings: 'table', 'open-tryouts': 'tryouts',
  prices: 'pricing', plans: 'pricing', terms: 'legal', privacy: 'legal',
  'national-teams': 'nt', usmnt: 'nt', uswnt: 'nt',
};

function screenNotFound(hash) {
  crumb.textContent = 'Not found';
  view.innerHTML = `<div class="about">
    <div class="kicker">404</div>
    <h2 class="disp">That page isn't here</h2>
    <p>Nothing lives at <code>${esc(hash)}</code>. The link was probably mistyped, or
       pointed at a screen that has since moved.</p>
    <div class="linkrow">
      <a href="#/map"><b>The national map</b></a>
      <a href="#/table"><b>National table</b></a>
      <a href="#/tiers"><b>The pyramid</b></a>
      <a href="#/wire"><b>The Wire</b></a>
      <a href="#/tools"><b>Tools</b></a>
      <a href="#/freeagents"><b>Free agents</b></a>
    </div>
    <p style="margin-top:14px">Looking for a club? Every rated club has its own page —
       search the <a href="#/table">national table</a> or open the
       <a href="#/map">map</a>.</p>
  </div>`;
}

let routedOnce = false;
function route() {
  const h = location.hash || '#/map';
  const parts = h.slice(2).split('/');
  if (ROUTE_ALIAS[parts[0]]) {
    location.replace('#/' + [ROUTE_ALIAS[parts[0]], ...parts.slice(1)].join('/'));
    return;
  }
  /* the Tools tab is a hub: its own screens (predict, sim) keep it lit, and
     club/player detail routes stay under Map the way they always have */
  const TAB_OF = { state: 'map', region: 'map', club: 'map', player: 'map',
    predict: 'tools', sim: 'tools', race: 'tools', 'player-sim': 'tools', shots: 'tools', radar: 'tools', compare: 'tools' };
  document.querySelectorAll('.tabbar a').forEach(a => a.classList.toggle('active',
    a.dataset.tab === (TAB_OF[parts[0]] || parts[0])));
  view.scrollTop = 0;
  /* these views read ROSTERS synchronously; any view shows followed-player
     chips, so a user with player favorites also waits for the module */
  const needsRosters = ['club', 'player', 'myxi', 'table'].includes(parts[0])
    || favs().players.length > 0;
  /* rosters arrive async, so the reader can route away before they land —
     the same overtaking routedAway() guards inside a screen, one level up. */
  if (needsRosters) {
    const fresh = () => { if (!routedAway(h)) dispatch(); };
    loadRosters().then(fresh, fresh);
    return;
  }
  dispatch();
  function dispatch() {
  if (parts[0] === 'tiers') screenPyramid();
  else if (parts[0] === 'freeagents') screenFreeAgents();
  else if (parts[0] === 'tryouts') screenTryouts();
  else if (parts[0] === 'pricing') screenPricing();
  /* #/myxi/i/<payload> is a shared XI arriving from another device */
  else if (parts[0] === 'myxi') screenMyXi(parts[1] === 'i' ? decodeURIComponent(parts.slice(2).join('/')) : null);
  else if (parts[0] === 'legends') screenLegends(parts[1]);
  else if (parts[0] === 'cups') screenCups();
  else if (parts[0] === 'nt') screenNationalTeams(parts[1], parts[2]);
  else if (parts[0] === 'league') screenLeague(parts[1]);
  else if (parts[0] === 'freeagent') screenFASample();
  else if (parts[0] === 'clubtools') screenClubTools();
  else if (parts[0] === 'legal') screenLegal();
  else if (parts[0] === 'table') {
    if (parts[1] === 'players' || parts[1] === 'clubs') tableMode = parts[1];
    screenTable();
  }
  else if (parts[0] === 'matches') screenMatches(parts[1]);
  else if (parts[0] === 'tools') screenTools();
  else if (parts[0] === 'race') screenSeasonRace();
  else if (parts[0] === 'player-sim') screenPlayerSim();
  /* #/coach was the route while the tool was called Player Coach and it
     shipped to production under that name; keep the old hash working */
  else if (parts[0] === 'coach') { location.replace('#/player-sim'); return; }
  else if (parts[0] === 'upsets') screenUpsets();
  else if (parts[0] === 'college') screenCollege(parts[1] && decodeURIComponent(parts[1]));
  else if (parts[0] === 'shots') screenShots();
  else if (parts[0] === 'radar') screenRadar();
  else if (parts[0] === 'predict') screenPredict(parts[1]);
  else if (parts[0] === 'compare') screenCompare(parts[1], parts[2]);
  else if (parts[0] === 'wire') screenWire();
  else if (parts[0] === 'sim') screenSimulator(parts[1]);
  else if (parts[0] === 'about') screenAbout();
  else if (parts[0] === 'state') screenState(parts[1]);
  else if (parts[0] === 'region') screenRegion(parts[1]);
  else if (parts[0] === 'club') screenClub(parts[1]);
  else if (parts[0] === 'player') screenPlayer(parts[1], parts[2]);
  else if (parts[0] === 'map' || parts[0] === '') screenMap();
  else { screenNotFound(h); parts[0] = 'notfound'; }
  document.title = `${ROUTE_TITLES[parts[0]] || 'Map'} — Ranked XI`;
  if (routedOnce) view.focus({ preventScroll: true });
  routedOnce = true;
  }
}
/* the appbar wordmark is a home link; when already on the map, the hash
   doesn't change (no hashchange fires), so drop the remembered zoom and
   re-route by hand — "home" always means the default national framing */
document.querySelector('.appbar .brand')?.addEventListener('click', () => {
  try { sessionStorage.removeItem('rxi-vb:#/map'); } catch {}
  if ((location.hash || '#/map') === '#/map') route();
});
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
/* "Make this your home": browsers give no API to set a homepage, so the
   honest version is the app's own start screen. manifest start_url is /app
   with no hash, so an installed launch lands here with an empty hash and
   this is the only place the preference can apply. A typed or shared URL
   always carries its own hash and is never overridden. */
if (!location.hash) {
  let home = null;
  try { home = (JSON.parse(localStorage.getItem('rxi-myxi')) || {}).home === true ? '#/myxi' : null; } catch {}
  if (home) location.replace(home);
}
/* Chrome fires beforeinstallprompt once, early — My XI's install button
   renders long after, so the event is parked here for it to claim. */
addEventListener('beforeinstallprompt', e => { e.preventDefault(); window.__rxiInstall = e; });
addEventListener('appinstalled', () => { window.__rxiInstall = null; });

addEventListener('hashchange', route);
route();
wireSearch();
{ const cc = document.getElementById('clubcount'); if (cc) cc.textContent = CLUBS.filter(c => !c.h).length.toLocaleString(); }
/* prefetch rosters once the first view has painted so club taps are instant */
(self.requestIdleCallback || (f => setTimeout(f, 2000)))(() => {
  loadRosters().catch(() => {});
  myxiMod().catch(() => {});
});

/* Restore the signed-in session and pull down anything another device added.
   Deliberately after route(): first paint comes off localStorage and must not
   wait for a round trip. When the merge actually changed this browser's XI and
   the visitor is looking at My XI, re-route so they see it arrive rather than
   a stale list. Any failure here leaves the app exactly as it was logged out. */
acctMod()
  .then(m => m.bootAccount())
  .then(r => {
    /* Re-render My XI when the session lands, not only when the merge moved
       picks. An empty XI renders no account panel at all while the session is
       unknown, so a signed-in visitor with nothing picked yet would otherwise
       never see that they are signed in. */
    if (r && (r.changed || r.signedIn) && location.hash.startsWith('#/myxi')) route();
  })
  .catch(() => {});
