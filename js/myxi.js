/* My XI — Ranked XI's personalized front page.

   Four design rules this screen is built on, in the order they were nearly
   broken while writing it:

   1. NOT a social profile. There is now an account (js/account.js), but it
      buys exactly one thing: the same XI on every device, surviving Safari's
      seven-day eviction of local storage. It is still not an identity — no
      public page, no profile, no password, nothing another visitor can see.
      Signing in remains optional and every pick is still written locally
      first, so this screen works logged out exactly as it always did.
   2. Never an empty room. A UPSL or USASA side — exactly the club nobody else
      covers, and the reason someone would come here daily — can go weeks with
      no fixture and no result. So every card must be computable from data
      already in the bundle (rank, nearest rival, a predicted scoreline).
      Live results are a layer on top, never the foundation.
   3. Zero configuration. No widget picker, no layout editor. The order is
      fixed; the only thing a visitor chooses is who is in the XI.
   4. Follow state stays in pyr-favs. The star buttons on club and player
      pages remain the source of truth. This module only owns the pick types
      that have no page of their own — leagues, states, national teams — and
      never deletes a follow the visitor made somewhere else.
*/

import {
  extras, setExtras, setHome, isHome, encodePicks, decodePicks,
} from './picks.js?v=20260822j';
import { accountBlock, wireAccount, accountState, touchAccount } from './account.js?v=20260822j';

/* Ranked XI's own accounts. Facebook is deliberately absent: the page exists
   but its canonical URL was never recorded, and a dead social link on the
   home tab is worse than one fewer icon. Add it here when the URL is known. */
const SOCIALS = [
  { id: 'x', label: 'X', handle: '@rankedxi', url: 'https://x.com/rankedxi' },
  { id: 'ig', label: 'Instagram', handle: '@rankedxi.app', url: 'https://www.instagram.com/rankedxi.app/' },
  { id: 'fb', label: 'Facebook', handle: 'Ranked XI', url: 'https://www.facebook.com/rankedxi' },
  { id: 'li', label: 'LinkedIn', handle: 'Ranked XI', url: 'https://www.linkedin.com/company/rankedxi/' },
];

/* Pick storage and the share-payload codec moved to js/picks.js when accounts
   arrived: the sync engine needs the identical encoder, and two copies of a
   format that has to round-trip against itself is how a share link and a
   synced account quietly stop agreeing. */
const SEEN_KEY = 'rxi-myxi-seen';
const XI = 11;
/* Deltas are "since your last visit", not "since the last render". Re-opening
   the tab inside this window keeps showing the same baseline instead of
   silently zeroing every number the moment it has been read once. */
const VISIT_MS = 6 * 36e5;

const readJson = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch { return d; } };
const writeJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

const hasExtra = (t, id) => extras().some(p => p.t === t && p.id === id);
const toggleExtra = (t, id) => setExtras(hasExtra(t, id)
  ? extras().filter(p => !(p.t === t && p.id === id))
  : extras().concat([{ t, id }]));

/* ---- movement snapshot ---------------------------------------------------
   The one card that makes this page worth reopening: what moved while you
   were away. Ratings and national ranks are snapshotted per club id. */
function snapshot(clubs, rankOf) {
  const r = {}, k = {};
  clubs.forEach(c => { r[c.id] = c.r || 0; const n = rankOf(c); if (n) k[c.id] = n; });
  return { ts: Date.now(), r, k };
}

const QUICK_LEAGUES = ['mls', 'nwsl', 'uslc', 'usl1', 'mnp', 'npsl', 'upsl', 'usl2'];
const QUICK_NT = [['usmnt', 'USMNT'], ['uswnt', 'USWNT'], ['u20mnt', 'USA U-20'], ['u17wnt', 'USA U-17 W']];

export async function render(view, ctx) {
  const {
    esc, CLUBS, LEAGUES, STATE_NAME, clubIdx, clubIdxByName, crestHtml, mcrest, initials,
    eloRank, neighbors, milesApart, matchCard, squadFor, AVATAR, favs, favToggle,
    fixturesDb, wireDb, isUpset, fmtWireDay, fmtKick, importPayload,
  } = ctx;

  /* Picking is the one action taken from this page, and every pick changes
     what the page shows — so it has to re-render. Going back through the
     router reset the scroll to the top, which threw the visitor away from the
     chip they had just tapped. Re-render in place and put the scroll back:
     innerHTML is written synchronously below, so this lands before paint. */
  const refresh = () => {
    const y = view.scrollTop;
    render(view, { ...ctx, importPayload: null });
    view.scrollTop = y;
  };

  /* ---- resolve the XI --------------------------------------------------- */
  const f = favs();
  const ex = extras();
  const clubs = f.clubs.map(id => CLUBS[clubIdx(id)]).filter(Boolean);
  const players = f.players.map(id => {
    const [ci, pi] = id.split('/');
    const c = CLUBS[clubIdx(ci)]; if (!c) return null;
    const pl = squadFor(c)[+pi]; if (!pl) return null;
    return { id, c, pl };
  }).filter(Boolean);
  const picked = clubs.length + players.length + ex.length;

  /* national + league rank, computed over each club's own sex pool so a
     followed women's side is ranked among women's clubs, never against the
     men's table. Seed-rated clubs (no rr) get no rank, same rule as the
     national table. */
  const rankCache = new Map();
  const rankTable = key => {
    if (!rankCache.has(key)) {
      const [sx, g] = key.split('|');
      const rows = CLUBS.filter(c => c.x === sx && !c.h && c.r && (g === '*' || c.g === g)).sort(eloRank);
      const m = new Map(); rows.forEach((c, i) => { if (c.rr) m.set(c.id, i + 1); });
      rankCache.set(key, { m, n: rows.length });
    }
    return rankCache.get(key);
  };
  const natRank = c => rankTable(c.x + '|*').m.get(c.id);
  const lgRank = c => rankTable(c.x + '|' + c.g).m.get(c.id);

  /* ---- what moved since last visit -------------------------------------- */
  const seen = readJson(SEEN_KEY, null);
  const fresh = seen && (Date.now() - (seen.ts || 0)) < VISIT_MS;
  const baseline = seen && seen.r ? seen : null;
  const moves = !baseline ? [] : clubs.map(c => {
    const dr = (c.r || 0) - (baseline.r[c.id] ?? (c.r || 0));
    const nowRank = natRank(c), wasRank = baseline.k[c.id];
    const dk = (nowRank && wasRank) ? wasRank - nowRank : 0;   /* + = climbed */
    return { c, dr, dk, isNew: baseline.r[c.id] === undefined };
  }).filter(m => !m.isNew && (m.dr || m.dk));
  if (!fresh && clubs.length) writeJson(SEEN_KEY, snapshot(clubs, natRank));

  const delta = m => {
    if (!m.dr && !m.dk) return '';
    const bits = [];
    if (m.dk) bits.push(`<b class="${m.dk > 0 ? 'mx-up' : 'mx-dn'}">${m.dk > 0 ? '&uarr;' : '&darr;'} ${Math.abs(m.dk)} place${Math.abs(m.dk) === 1 ? '' : 's'}</b>`);
    if (m.dr) bits.push(`<span class="${m.dr > 0 ? 'mx-up' : 'mx-dn'}">${m.dr > 0 ? '+' : '&minus;'}${Math.abs(m.dr)} Elo</span>`);
    return bits.join(' · ');
  };

  /* ---- header ----------------------------------------------------------- */
  const meter = `<span class="mx-meter" role="img" aria-label="${picked} of ${XI} picked">${
    Array.from({ length: XI }, (_, i) => `<i${i < picked ? ' class="on"' : ''}></i>`).join('')}</span>`;

  const head = `
    <div class="kicker">Your eleven · nobody else can see this page</div>
    <h2 class="disp" style="margin:2px 0 6px">My XI</h2>
    <div class="mx-count">${meter}<span>${picked >= XI ? 'Your XI is full' : `${picked} of ${XI} picked`}</span></div>`;

  /* ---- import banner ---------------------------------------------------- */
  const inbound = importPayload ? decodePicks(importPayload) : null;
  const importBox = !inbound ? '' : `
    <div class="mx-import" id="mximport">
      <b>Someone shared an XI with you</b>
      <p>${inbound.clubs.length} club${inbound.clubs.length === 1 ? '' : 's'},
         ${inbound.players.length} player${inbound.players.length === 1 ? '' : 's'} and
         ${inbound.extras.length} other pick${inbound.extras.length === 1 ? '' : 's'}.
         Loading it adds them to your own XI — nothing you already follow is removed.</p>
      <div class="btnrow">
        <button type="button" class="joinbtn" id="mxload">Add these to my XI</button>
        <button type="button" class="chip solid" id="mxskip">No thanks</button>
      </div>
    </div>`;

  /* ---- empty state ------------------------------------------------------ */
  if (!picked) {
    view.innerHTML = head + importBox + `
      <div class="mx-empty">
        <p>Pick up to eleven things you actually care about — clubs, players, a league,
           your state, a national team — and this becomes the only page you need.
           Rank moves, next fixtures and the results that matter to <i>you</i>, in one place.
           The rest of the app stays exactly where it is.</p>
        <p class="note">No sign-up needed to start. Picks live in this browser — save them
           to an email when you want them on your phone too.</p>
      </div>
      <div class="kicker" style="margin-top:16px">Start here</div>
      <a class="fa-card" href="#/table"><b>&#9733; Follow a club</b><span>Open any club and tap Follow &mdash; the national table is the fastest way to find one.</span></a>
      <a class="fa-card" href="#/table/players"><b>&#9733; Follow a player</b><span>The player table, ranked across every league &mdash; open one and tap Follow.</span></a>
      <a class="fa-card" href="#/map"><b>&#128205; Find your local side</b><span>4,000+ clubs on the map. Somebody near you is on it.</span></a>
      ${addBlock()}
      ${accountState().signedIn ? accountBlock() : ''}
      ${socialBlock()}`;
    wire();
    return;
  }

  /* ---- assemble the page ------------------------------------------------ */
  const topClub = clubs.filter(c => c.r).sort(eloRank)[0] || clubs[0];

  view.innerHTML = head + importBox
    + addBlock()
    + `<div id="mx-move"></div>`
    + `<div id="mx-next"><div class="kicker" style="margin-top:16px">Next up</div><p class="note">Checking fixtures&hellip;</p></div>`
    + clubsBlock()
    + playersBlock()
    + extrasBlock()
    + `<div id="mx-wire"></div>`
    + homeBlock()
    + accountBlock()
    + shareBlock()
    + socialBlock()
    + `<p class="note" style="margin-top:16px">${accountState().signedIn
          ? 'My XI is saved to your email and synced to every device you sign in on. Still no profile, still nothing public.'
          : 'My XI is stored in this browser only &mdash; clearing site data clears your picks, and iPhones clear it for you after a week away. <b>Save my XI</b> above fixes both.'}
        <a href="#/about" style="color:var(--accent)">About &amp; methodology</a> &middot;
        <a href="#/legal" style="color:var(--accent)">Terms &amp; privacy</a></p>`;

  /* movement card renders only when something actually moved — a permanent
     "no change" panel at the top of the page trains people to scroll past it */
  if (moves.length) {
    view.querySelector('#mx-move').innerHTML = `
      <div class="kicker" style="margin-top:16px">Since your last visit</div>
      <ul class="mx-moves">${moves.map(m => `
        <li><a href="#/club/${m.c.id}">${mcrest(m.c)}<span class="mx-mname"><b>${esc(m.c.n)}</b>
          <span>${delta(m)}</span></span>
          <span class="cl-rt">${m.c.r}</span></a></li>`).join('')}</ul>`;
  }

  renderNext();
  renderWire();
  wire();

  /* ---- blocks ----------------------------------------------------------- */
  function clubsBlock() {
    if (!clubs.length) return '';
    const rows = clubs.map(c => {
      const nr = natRank(c), lr = lgRank(c);
      const rival = c.r ? neighbors(c, 1)[0] : null;
      const line = [
        nr ? `#${nr} in the ${c.x === 'w' ? "women's" : "men's"} table` : 'Unrated — no results in the dataset yet',
        lr ? `#${lr} in ${LEAGUES[c.g].label}` : LEAGUES[c.g].label,
        c.st,
      ].filter(Boolean).join(' · ');
      return `<li><a href="#/club/${c.id}">${crestHtml(c)}
        <span class="cl-name"><b>${esc(c.n)}</b><span>${esc(line)}</span></span>
        <span class="cl-rt"${c.rr ? '' : ' style="color:var(--ink-dim)"'}>${c.r || '&mdash;'}</span></a>
        ${rival ? `<a class="mx-rival" href="#/predict/${c.id}">Nearest rival: ${esc(rival.n)} &middot; ${milesApart(c, rival)} mi &middot; predict it &rarr;</a>` : ''}</li>`;
    }).join('');
    return `<div class="kicker" style="margin-top:18px">Your clubs · ${clubs.length}</div><ul class="clublist mx-clubs">${rows}</ul>`;
  }

  function playersBlock() {
    if (!players.length) {
      /* players have a Follow button of their own but no obvious route to one
         from here — without this the feature reads as missing entirely */
      return `<div class="kicker" style="margin-top:18px">Your players</div>
        <a class="fa-card" href="#/table/players"><b>&#9733; Follow a player</b><span>Every rated player, ranked across all six pro leagues &mdash; open one and tap Follow to pin them here.</span></a>
        <p class="note" style="margin:2px 0 0">You can also search any player by name at the top of the app, or open a club and tap a name in the squad.</p>`;
    }
    return `<div class="kicker" style="margin-top:18px">Your players · ${players.length}</div>
      <ul class="clublist">${players.map(({ id, c, pl }) => `
        <li><a href="#/player/${id}"><img class="crest imgcrest" src="${AVATAR}" alt="">
          <span class="cl-name"><b>${esc(pl.name)}</b><span>${pl.pos} · ${esc(c.n)}</span></span>
          <span class="cl-rt">${pl.pvr}</span></a></li>`).join('')}</ul>`;
  }

  function extrasBlock() {
    if (!ex.length) return '';
    const top5 = rows => rows.slice(0, 5).map((c, i) => `
      <li><a href="#/club/${c.id}"><span class="rk">${i + 1}</span>${mcrest(c)}
        <span class="cl-name"><b>${esc(c.n)}</b><span>${esc(LEAGUES[c.g].label)} · ${esc(c.st)}</span></span>
        <span class="cl-rt">${c.r || '&mdash;'}</span></a></li>`).join('');

    /* one heading per pick TYPE, not per pick — two leagues used to print
       "Your league" twice and read like the page had repeated itself */
    const section = (label, items) => items.length
      ? `<div class="kicker" style="margin-top:18px">${label}</div>${items.join('')}` : '';

    const leagues = ex.filter(p => p.t === 'league' && LEAGUES[p.id]).map(p => {
      const m = LEAGUES[p.id];
      const rows = CLUBS.filter(c => c.g === p.id && !c.h && c.r).sort(eloRank);
      return `<a class="mx-head" href="#/league/${p.id}"><b>${esc(m.label)}</b><span>${rows.length} rated clubs &middot; full league &rarr;</span></a>
        <ul class="clublist">${top5(rows)}</ul>`;
    });

    const states = ex.filter(p => p.t === 'state').map(p => {
      /* a state holds both games, and the two rating scales are not
         comparable — one merged list would rank an NWSL side against an MLS
         side on numbers that were never fitted against each other */
      const inState = sx => CLUBS.filter(c => c.st === p.id && c.x === sx && !c.h && c.r).sort(eloRank);
      const half = (rows, label) => rows.length
        ? `<div class="kicker" style="margin-top:8px">${label} &middot; ${rows.length} rated</div><ul class="clublist">${top5(rows)}</ul>`
        : '';
      return `<a class="mx-head" href="#/state/${p.id}"><b>${esc(STATE_NAME[p.id] || p.id)}</b><span>every club in the state &rarr;</span></a>
        ${half(inState('m'), "Men's")}${half(inState('w'), "Women's")}`;
    });

    const teams = ex.filter(p => p.t === 'nt').map(p => {
      const label = (QUICK_NT.find(q => q[0] === p.id) || [p.id, p.id.toUpperCase()])[1];
      return `<a class="fa-card" href="#/nt/${esc(p.id)}"><b>&#127482;&#127480; ${esc(label)}</b><span>Fixtures, how to watch, squad history and player bios &rarr;</span></a>`;
    });

    return section(leagues.length > 1 ? 'Your leagues' : 'Your league', leagues)
      + section(states.length > 1 ? 'Your states' : 'Your state', states)
      + section(teams.length > 1 ? 'Your national teams' : 'Your national team', teams);
  }

  function addBlock() {
    const chip = (t, id, label) => `<button class="chip solid" data-add="${t}" data-id="${esc(id)}" aria-pressed="${hasExtra(t, id)}">${hasExtra(t, id) ? '&#10003; ' : '+ '}${esc(label)}</button>`;
    const states = Object.keys(STATE_NAME).sort((a, b) => STATE_NAME[a].localeCompare(STATE_NAME[b]));
    const mine = extras().find(p => p.t === 'state');
    return `
      <div class="kicker" style="margin-top:20px">Add to your XI</div>
      <p class="note" style="margin:2px 0 8px">Leagues, a state and national teams have no Follow button of their own &mdash; pick them here.
         Clubs and players are followed from <a href="#/table" style="color:var(--accent)">their own pages</a>
         (<a href="#/table/players" style="color:var(--accent)">player table &rarr;</a>).</p>
      <div class="chips" id="mxadd">
        ${QUICK_LEAGUES.filter(g => LEAGUES[g]).map(g => chip('league', g, LEAGUES[g].label)).join('')}
        ${QUICK_NT.map(([id, label]) => chip('nt', id, label)).join('')}
      </div>
      <label class="mx-state"><span>Your state</span>
        <select id="mxstate">
          <option value="">Pick a state&hellip;</option>
          ${states.map(s => `<option value="${s}"${mine && mine.id === s ? ' selected' : ''}>${esc(STATE_NAME[s])}</option>`).join('')}
        </select></label>`;
  }

  function homeBlock() {
    return `
      <div class="kicker" style="margin-top:20px">Make this your home</div>
      <div class="mx-home">
        <label class="ck"><input type="checkbox" id="mxhome"${isHome() ? ' checked' : ''}> Open My XI when I launch Ranked XI</label>
        <p class="note" style="margin:6px 0 0">Browsers don't let a website set itself as your homepage &mdash; but you can
           install Ranked XI to your home screen and it will open straight here.</p>
        <button type="button" class="joinbtn" id="mxinstall" hidden>Add Ranked XI to my home screen</button>
        <p class="note" id="mxios" hidden style="margin:6px 0 0">On iPhone: tap the <b>Share</b> button in Safari, then
           <b>Add to Home Screen</b>. It opens full-screen, straight to this page.</p>
      </div>`;
  }

  function shareBlock() {
    return `
      <div class="kicker" style="margin-top:20px">Take it with you</div>
      <div class="mx-share">
        <p class="note" style="margin:0 0 8px">Your picks live in this browser. This link carries them to another
           device &mdash; it contains your picks and nothing about you.</p>
        <div class="btnrow">
          <button type="button" class="joinbtn" id="mxshare">Share my XI</button>
        </div>
        <p class="join-msg" id="mxsharemsg" role="status" aria-live="polite"></p>
      </div>`;
  }

  function socialBlock() {
    return `
      <div class="kicker" style="margin-top:20px">Follow Ranked XI</div>
      <p class="note" style="margin:2px 0 8px">Upsets, rating swings and new leagues as they land.</p>
      <div class="mx-social">
        ${SOCIALS.map(s => `<a href="${s.url}" target="_blank" rel="noopener me">
          <b>${esc(s.label)}</b><span>${esc(s.handle)}</span></a>`).join('')}
      </div>`;
  }

  /* ---- async cards ------------------------------------------------------ */
  async function renderNext() {
    const box = view.querySelector('#mx-next'); if (!box) return;
    const names = new Set(clubs.map(c => c.n));
    let fx = [];
    try {
      const all = await fixturesDb();
      const now = Date.now(), TWO_WEEKS = 14 * 864e5;
      fx = all.filter(x => {
        const t = Date.parse(x.start);
        return t > now - 6 * 36e5 && t < now + TWO_WEEKS && (names.has(x.t1) || names.has(x.t2));
      }).slice(0, 3);
    } catch { fx = []; }
    if (!view.querySelector('#mx-next')) return;   /* routed away mid-load */

    if (fx.length) {
      box.innerHTML = `<div class="kicker" style="margin-top:16px">Next up · verified fixtures</div>`
        + fx.map(x => {
          const h = CLUBS[clubIdxByName(x.t1)], a = CLUBS[clubIdxByName(x.t2)];
          if (!h || !a) return '';
          return matchCard(h, a, String(x.round || '').toUpperCase(), true)
            .replace('<div class="meta"><span>Elo', `<div class="meta"><span>${fmtKick(x.start)}</span><span>${esc(x.venue || '')}</span></div><div class="meta"><span>Elo`);
        }).join('');
      return;
    }

    /* rule 2: no scheduled game must never mean no page. The nearest-rival
       matchup is computed from ratings the bundle already carries, and is
       labelled as the hypothetical it is — same language as Rivalry Radar. */
    const h = topClub && topClub.r ? topClub : null;
    const a = h ? neighbors(h, 1)[0] : null;
    if (!h || !a) {
      box.innerHTML = `<div class="kicker" style="margin-top:16px">Next up</div>
        <p class="note">No verified fixture for your clubs in the next two weeks, and no rating yet to model one.
           Fixtures appear here straight from league feeds &mdash; nothing is invented to fill the space.</p>`;
      return;
    }
    box.innerHTML = `<div class="kicker" style="margin-top:16px">Next up</div>
      <p class="note" style="margin:2px 0 10px">No verified fixture for your clubs in the next two weeks. Here's the one
         the model would most like to see &mdash; ${esc(h.n)} against their nearest rival. Not a scheduled game.</p>`
      + matchCard(h, a, `${milesApart(h, a)} MI APART`);
  }

  async function renderWire() {
    const box = view.querySelector('#mx-wire'); if (!box) return;
    let rows = [];
    try {
      const names = new Set(clubs.map(c => c.n));
      const lgs = new Set(ex.filter(p => p.t === 'league').map(p => p.id));
      const all = await wireDb();
      rows = all.filter(w => names.has(w.t1) || names.has(w.t2) || lgs.has(w.lg)).slice(-8).reverse();
    } catch { rows = []; }
    if (!view.querySelector('#mx-wire')) return;
    if (!rows.length) { box.innerHTML = ''; return; }
    const side = nm => { const i = clubIdxByName(nm); return `${i >= 0 ? mcrest(CLUBS[i]) : ''}<b>${esc(nm)}</b>`; };
    box.innerHTML = `<div class="kicker" style="margin-top:18px">Your results</div>
      <ul class="mx-wire">${rows.map(w => `
        <li><a href="#/wire">
          <span class="mx-wl">${side(w.t1)} <i>${w.s1}&ndash;${w.s2}</i> ${side(w.t2)}</span>
          <span class="mx-wm">${isUpset(w) ? '<b class="wup">UPSET</b> · ' : ''}${fmtWireDay(w.d)} · Elo &plusmn;${Math.abs(w.dr)}</span>
        </a></li>`).join('')}</ul>
      <p class="note"><a href="#/wire" style="color:var(--accent)">Everything on the Wire &rarr;</a></p>`;
  }

  /* ---- events ----------------------------------------------------------- */
  function wire() {
    /* The account panel owns its own handlers and re-renders itself in place
       for anything that only changes the sign-in step, so typing an email does
       not repaint the whole screen underneath the cursor. It gets `refresh`
       for the one case that does change the page: a sign-in whose merge pulled
       picks in from another device. */
    wireAccount(view, refresh);

    view.querySelector('#mxadd')?.addEventListener('click', e => {
      const b = e.target.closest('[data-add]'); if (!b) return;
      toggleExtra(b.dataset.add, b.dataset.id);
      touchAccount();
      refresh();
    });
    view.querySelector('#mxstate')?.addEventListener('change', e => {
      const v = e.target.value;
      setExtras(extras().filter(p => p.t !== 'state').concat(v ? [{ t: 'state', id: v }] : []));
      touchAccount();
      refresh();
    });
    view.querySelector('#mxhome')?.addEventListener('change', e => { setHome(e.target.checked); touchAccount(); });

    view.querySelector('#mxshare')?.addEventListener('click', async () => {
      const msg = view.querySelector('#mxsharemsg');
      const url = location.origin + '/app#/myxi/i/' + encodeURIComponent(encodePicks(favs(), extras()));
      try {
        if (navigator.share) { await navigator.share({ title: 'My XI on Ranked XI', url }); return; }
        await navigator.clipboard.writeText(url);
        msg.textContent = 'Link copied — open it on your other device to load these picks.';
      } catch {
        /* clipboard denied (or share dismissed): show the link so it can be
           copied by hand rather than failing silently */
        if (msg) msg.innerHTML = `Copy this link:<br><code class="mx-url">${esc(url)}</code>`;
      }
    });

    view.querySelector('#mxskip')?.addEventListener('click', () => { location.replace('#/myxi'); });
    view.querySelector('#mxload')?.addEventListener('click', () => {
      const cur = favs();
      inbound.clubs.forEach(id => { if (clubIdx(id) >= 0 && !cur.clubs.includes(id)) favToggle('clubs', id); });
      inbound.players.forEach(id => {
        const [ci] = id.split('/');
        if (clubIdx(ci) >= 0 && !cur.players.includes(id)) favToggle('players', id);
      });
      const have = extras();
      const add = inbound.extras.filter(p => !have.some(q => q.t === p.t && q.id === p.id));
      if (add.length) setExtras(have.concat(add));
      touchAccount();
      location.replace('#/myxi');
    });

    /* install affordance, same contract as the landing page: Chrome fires
       beforeinstallprompt, iOS never does and gets instructions instead */
    const btn = view.querySelector('#mxinstall'), ios = view.querySelector('#mxios');
    if (!btn) return;
    if (matchMedia('(display-mode: standalone)').matches || navigator.standalone) return;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (isIOS) { btn.hidden = false; }
    else if (window.__rxiInstall) { btn.hidden = false; }
    btn.addEventListener('click', () => {
      if (window.__rxiInstall) { window.__rxiInstall.prompt(); window.__rxiInstall = null; btn.hidden = true; }
      else if (ios) ios.hidden = !ios.hidden;
    });
  }
}
