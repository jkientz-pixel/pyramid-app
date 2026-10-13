/* The Open Cup, one edition at a time (#/opencup, #/opencup/<year>) — lazily
   imported by app.js.

   The Trophy Room shows finals; Giant-Killings shows upsets; a club page shows
   its own Cup receipts. Nothing showed a whole edition, and the social lane
   was posting Cup previews and results with no page to land on. This is that
   page: every tie of one edition, round by round, latest round first, with the
   tier each side sat on, the rating each result moved, and — for the current
   edition — the next ties with kickoff, venue, broadcaster and the model's
   call. A run-log, not a bracket: ESPN and ussoccer.com already draw the
   bracket; what nobody else can show is what each tie meant on the ladder.

   Two sources, joined by round name. Wikipedia (data/opencup_matches.json,
   via bank_opencup.py) carries every edition since 2016 with league tags, and
   it is what the rating pipeline consumed — so its rows carry the receipts.
   ESPN (data/opencup_live.json, via fetch_opencup_live.py) carries only the
   current edition but knows kickoffs, venues, TV and scores within minutes.
   A round present in Wikipedia is rendered from Wikipedia; a round Wikipedia
   has not written up yet is rendered from ESPN. Nothing is shown twice.

   A third source covers the amateur QUALIFYING rounds, which ESPN does not
   carry: data/opencup_qual.json (fetch_opencup_qual.py, ussoccer.com's own
   schedule page). Qualifying for the 2027 Cup is played in autumn 2026, so it
   is its own edition (#/opencup/2027) while the 2026 final is still to come;
   the default view stays on the edition being played and links across. Venue
   and city are shown exactly as U.S. Soccer prints them. */
import { TIER, TIER_NAME, LEAGUE_NAME, normalise } from './opencup.js?v=__RXIV__';

/* the Cup's rounds in playing order; anything unrecognised sorts last */
const ORDER = ['First Qualifying Round', 'Second Qualifying Round', 'Third Qualifying Round',
  'Fourth Qualifying Round', 'Final Qualifying Round', 'Re-play', 'First round', 'Second round',
  'Third round', 'Fourth round', 'Round of 64', 'Round of 32', 'Round of 16', 'Quarterfinals',
  'Semifinals', 'Final'];
const roundRank = r => {
  const i = ORDER.findIndex(o => o.toLowerCase() === String(r || '').toLowerCase());
  return i < 0 ? ORDER.length : i;
};
const isQualifying = m => m.comp === 'usoc-q' || /qualif/i.test(m.round || '');

/* our league keys -> the codes Wikipedia's tags use, so a tie that arrives
   from ESPN (no league tag) still gets a tier badge from the club we matched */
const KEY2CODE = { mls: 'MLS', uslc: 'USLC', usl1: 'USL1', mnp: 'MLSNP', nisa: 'NISA',
  npsl: 'NPSL', usl2: 'USL2', upsl: 'UPSL', apsl: 'APSL', swpl: 'SWPL', mpl: 'MPL',
  mwpl: 'MWPL', cpl: 'CPL', csl: 'CSL', sfsfl: 'SFSFL', eplwa: 'EPLWA', lisfl: 'LISFL',
  gcpl: 'GCPL' };
/* the pyramid top-down, for breaking a dual-league name tie the same way the
   fetcher does: a club fielding sides in two leagues enters the Cup as the
   senior one */
const LEAGUE_RANK = Object.fromEntries(['mls', 'uslc', 'usl1', 'mnp', 'nisa', 'npsl', 'usl2',
  'upsl', 'apsl', 'mwpl', 'swpl', 'mpl', 'cpl', 'gcpl', 'eplwa', 'sfsfl', 'csl', 'lisfl', 'loc']
  .map((g, i) => [g, i]));

const fmtDay = iso => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const fmtET = iso => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET';
/* Wikipedia writes "September 16, 2025"; the date column is four characters
   wide, so rows carry "Sep 16" and keep the parsed day for ordering */
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const parseDay = (txt, year) => {
  const m = /^([A-Za-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?/.exec(String(txt || '').trim());
  if (!m) return null;
  const mi = MONTHS.findIndex(x => x.startsWith(m[1].toLowerCase().slice(0, 3)));
  return mi < 0 ? null : new Date(Date.UTC(+(m[3] || year), mi, +m[2]));
};
const shortDay = (txt, year) => {
  const d = parseDay(txt, year);
  return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : String(txt || '');
};
const TZN = { ET: 'America/New_York', CT: 'America/Chicago', MT: 'America/Denver', PT: 'America/Los_Angeles' };
/* the kickoff in the zone U.S. Soccer printed it in ("3:30 PM ET") */
const fmtStated = t => t && t.start && TZN[t.tz]
  ? `${new Date(t.start).toLocaleTimeString('en-US', { timeZone: TZN[t.tz], hour: 'numeric', minute: '2-digit' })} ${t.tz}` : '';
const fmtScore = (s, m) => `${s[0]}–${s[1]}${m.forfeit ? '<small>forfeit</small>' : ''}${m.aet ? '<small>aet</small>' : ''}${
  m.pens ? `<small>${Array.isArray(m.pens) ? `${m.pens[0]}–${m.pens[1]} pens` : 'pens'}</small>` : ''}`;

export function render(view, { data, live, qual: qualFeed, receipts, finals, year }, h) {
  const { esc, CLUBS, LEAGUES, mcrest, oddsFor, oddsAllowed, fmtKick, calBtn, initials, clubIdx } = h;
  const all = data.matches || [];
  const editions = [...new Set(all.map(m => m.year))].sort((a, b) => b - a);
  const liveYear = live && live.year;
  if (liveYear && !editions.includes(liveYear)) editions.unshift(liveYear);
  const current = editions[0];
  /* qualifying for a not-yet-started edition is reachable and listed first,
     but never becomes the default view: #/opencup stays on the Cup in play */
  const qualYear = qualFeed && qualFeed.ties && qualFeed.ties.length ? qualFeed.year : null;
  if (qualYear && !editions.includes(qualYear)) editions.unshift(qualYear);
  const yr = year && editions.includes(year) ? year : year ? null : current;

  /* ---- club resolution -------------------------------------------------
     clubIdxByName refuses an ambiguous name; the one ambiguity the Cup meets
     constantly is a club that fields sides in two leagues (FC Motown in USL2
     and NPSL). Same tie-break as the fetcher: the senior record wins. */
  /* same key as the fetcher: suffix words out, punctuation out, so
     "D.C. United" (2019's spelling) meets "DC United" */
  const strip = s => String(s).toLowerCase().replace(/\b(fc|sc|cf|afc|club|the)\b/g, '').replace(/[^a-z0-9]/g, '');
  const okMen = c => !c.h && c.x === 'm' && LEAGUES[c.g] && !LEAGUES[c.g].hollow;
  const cache = new Map();
  const clubFor = (nm, id) => {
    if (id) { const c = CLUBS.find(o => o.id === id); if (c) return c; }
    if (!nm) return null;
    if (cache.has(nm)) return cache.get(nm);
    let c = null;
    const i = clubIdx(nm);
    if (i >= 0) c = CLUBS[i];
    else {
      const k = strip(nm);
      const hits = CLUBS.filter(o => okMen(o) && strip(o.n) === k)
        .sort((a, b) => (LEAGUE_RANK[a.g] ?? 99) - (LEAGUE_RANK[b.g] ?? 99));
      if (hits.length > 1 && (LEAGUE_RANK[hits[0].g] ?? 99) < (LEAGUE_RANK[hits[1].g] ?? 99)) c = hits[0];
    }
    cache.set(nm, c);
    return c;
  };
  const codeFor = (c, tag) => tag || (c && KEY2CODE[c.g]) || '';

  /* ---- rows for the chosen edition ------------------------------------- */
  const wiki = all.filter(m => m.year === yr);
  const wikiRounds = new Set(wiki.map(m => m.round));
  const liveTies = (live && live.year === yr ? live.ties : []) || [];
  /* qualifying ties: the date is the local calendar day U.S. Soccer prints, so
     it is formatted from the date string, never from the UTC kickoff (a 6 p.m.
     Pacific game is already tomorrow in UTC) */
  const longDay = iso => iso ? new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US',
    { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '';
  const fromQual = (qualFeed && qualFeed.year === yr ? qualFeed.ties : [])
    .filter(t => !wikiRounds.has(t.round)).map(t => ({
      year: yr, comp: 'usoc-q', round: t.round, date: longDay(t.date), t1: t.t1, t2: t.t2,
      id1: t.id1, id2: t.id2, l1: '', l2: '', score: t.score || null, winner: t.winner || 0,
      aet: !!t.aet, pens: t.pens || null, forfeit: !!t.forfeit, q: t,
      live: t.state === 'pre' ? t : null,
    }));
  const fromLive = liveTies.filter(t => !wikiRounds.has(t.round)).map(t => ({
    year: yr, comp: 'usoc', round: t.round, date: t.start ? fmtDay(t.start) : '',
    t1: t.t1, t2: t.t2, id1: t.id1, id2: t.id2, l1: '', l2: '',
    score: t.score || null, winner: t.winner || 0, aet: !!t.aet, pens: t.pens ? true : null,
    live: t,
  }));
  /* a past edition whose final never parsed still has its champion in the
     Trophy Room list; borrow it so no edition ends at the semifinals */
  /* copies: the Wikipedia rows are cached in app.js and shared with
     Giant-Killings, so the day/club/tier annotations below stay local */
  const rows = [...wiki.map(m => ({ ...m })), ...fromLive, ...fromQual];
  if (yr && !rows.some(m => /^final$/i.test(m.round)) && !liveTies.length) {
    const f = (finals || []).find(x => Number(x.y) === yr && x.ru && x.s);
    const sc = f && /^(\d+)\s*[–-]\s*(\d+)/.exec(f.s);
    if (sc) rows.push({ year: yr, comp: 'usoc', round: 'Final', date: '', t1: f.w, t2: f.ru,
      l1: '', l2: '', score: [+sc[1], +sc[2]], winner: 1, borrowed: true });
  }
  for (const m of rows) {
    const espn = !m.q && m.live && m.live.start;
    m.day = espn ? new Date(m.live.start) : parseDay(m.date, m.year);
    m.date = espn ? fmtDay(m.live.start) : shortDay(m.date, m.year);
    m.c1 = clubFor(m.t1, m.id1); m.c2 = clubFor(m.t2, m.id2);
    m.k1 = codeFor(m.c1, m.l1); m.k2 = codeFor(m.c2, m.l2);
    m.upset = m.winner && !m.forfeit ? normalise({ ...m, l1: m.k1, l2: m.k2 }) : null;
  }

  /* ---- receipts: the rating each side's own result moved --------------- */
  const deltaFor = (c, m, own) => {
    if (!c || !receipts || !m.score) return null;
    const opp = own === 1 ? m.t2 : m.t1;
    const gf = own === 1 ? m.score[0] : m.score[1], ga = own === 1 ? m.score[1] : m.score[0];
    const e = (receipts[c.id] || []).find(r => r.y === m.year && r.opp === opp && r.gf === gf && r.ga === ga);
    return e && e.d ? e.d : null;
  };

  /* ---- markup ----------------------------------------------------------- */
  const badge = code => {
    const t = TIER[code];
    return t ? `<span class="gk-tier gk-t${t}" title="${esc(LEAGUE_NAME[code] || code)} — ${TIER_NAME[t]}">${esc(code)}</span>` : '';
  };
  const delta = d => d == null ? '' :
    `<span class="oc-d ${d > 0 ? 'up' : 'down'}" title="Rating moved by this result">${d > 0 ? '+' : '−'}${Math.abs(d)}</span>`;
  const side = (c, nm, code, won, d, away) => {
    const name = c ? `<a href="#/club/${c.id}">${esc(nm)}</a>` : `<span>${esc(nm)}</span>`;
    return `<span class="oc-side${away ? ' away' : ''}${won ? ' won' : ''}">${c ? mcrest(c) : ''}<span class="oc-nm">${name} ${badge(code)}${delta(d)}</span></span>`;
  };
  /* one line under a qualifying tie: where (as printed by U.S. Soccer), when,
     and — before kickoff, where both clubs are rated — the model's pick */
  const pickLine = m => {
    const hc = m.c1, ac = m.c2;
    if (!hc || !ac || !hc.r || !ac.r) return '';
    const o = oddsFor(hc, ac);
    if (oddsAllowed(hc, ac)) {
      const fav = o.pH >= o.pA ? [hc, o.pH] : [ac, o.pA];
      return `Our pick <b>${esc(fav[0].n)} ${(fav[1] * 100).toFixed(0)}%</b> · Elo ${hc.r} v ${ac.r}`;
    }
    const fav = o.pH > o.pA ? hc : o.pA > o.pH ? ac : null;
    return `Our pick <b>${fav ? esc(fav.n) : 'a toss-up'}</b> · Elo ${hc.r} v ${ac.r}`;
  };
  const qsub = m => {
    if (!m.q) return '';
    const t = m.q;
    const where = [t.venue, t.city].filter(Boolean).map(esc).join(', ');
    const parts = [m.live && fmtStated(t) ? `<b>${esc(fmtStated(t))}</b>` : '', where,
      m.live ? pickLine(m) : ''].filter(Boolean);
    return parts.length ? `<span class="oc-sub">${parts.join(' · ')}</span>` : '';
  };
  const played = m => `
    <li class="oc-tie${m.upset ? ' oc-gk' : ''}">
      <span class="oc-date">${esc(m.date || '')}</span>
      ${side(m.c1, m.t1, m.k1, m.winner === 1, deltaFor(m.c1, m, 1), false)}
      <span class="oc-score">${m.score ? fmtScore(m.score, m) : '<small>v</small>'}</span>
      ${side(m.c2, m.t2, m.k2, m.winner === 2, deltaFor(m.c2, m, 2), true)}
      ${qsub(m)}
      ${m.upset ? `<span class="oc-gkmark">Giant-killing${m.upset.gap > 1 ? ` · ${m.upset.gap} tiers up` : ''}</span>` : ''}
    </li>`;
  const pending = m => {
    const t = m.live;
    return `<li class="oc-tie oc-pending">
      <span class="oc-date">${esc(m.date || '')}</span>
      ${side(m.c1, m.t1, m.k1, false, null, false)}
      <span class="oc-score"><small>${t.state === 'in' ? esc(t.clock || 'live') : 'v'}</small></span>
      ${side(m.c2, m.t2, m.k2, false, null, true)}
      ${qsub(m)}
    </li>`;
  };

  /* the next ties: cards with kickoff, venue, broadcaster, the model's call */
  const nextTies = rows.filter(m => m.live && m.live.state !== 'post')
    .sort((a, b) => a.live.start < b.live.start ? -1 : 1);
  const callFor = m => {
    const hc = m.c1, ac = m.c2;
    if (!hc || !ac || !hc.r || !ac.r) return '';
    const o = oddsFor(hc, ac);
    if (oddsAllowed(hc, ac)) {
      return `<div class="oc-call"><span class="kicker">Our call</span>
        <b>${esc(initials(hc.n))} ${(o.pH * 100).toFixed(0)}%</b> · draw ${(o.pD * 100).toFixed(0)}% · <b>${esc(initials(ac.n))} ${(o.pA * 100).toFixed(0)}%</b>
        <span class="oc-elo">Elo ${hc.r} v ${ac.r} · home edge +${o.ha}</span></div>`;
    }
    const fav = o.pH > o.pA ? hc.n : o.pA > o.pH ? ac.n : null;
    return `<div class="oc-call"><span class="kicker">Our call</span> ${fav ? `<b>${esc(fav)}</b> favoured` : 'Even'}
      <span class="oc-elo">Elo ${hc.r} v ${ac.r} · no percentages outside senior pro leagues</span></div>`;
  };
  /* qualifying has 32 ties a round; a card each would bury the page, so the
     cards are the closest rated calls and the full slate sits in the round
     block below */
  const isQualEdition = qualYear != null && yr === qualYear;
  const watch = isQualEdition ? nextTies.filter(m => m.c1 && m.c2 && m.c1.r && m.c2.r)
    .sort((a, b) => Math.abs(a.c1.r - a.c2.r) - Math.abs(b.c1.r - b.c2.r)).slice(0, 6) : [];
  const nextCard = m => {
    const t = m.live;
    const s = (c, nm, away) => c
      ? `<a class="side${away ? ' away' : ''}" href="#/club/${c.id}">${mcrest(c)}<span class="sn">${esc(nm)}</span></a>`
      : `<span class="side${away ? ' away' : ''}"><span class="sn">${esc(nm)}</span></span>`;
    const mid = t.state === 'in' && t.score
      ? `<span class="oc-livescore">${t.score[0]}–${t.score[1]}<small>${esc(t.clock || 'live')}</small></span>`
      : '<span class="vs">V</span>';
    const tv = (t.tv || []).map(x => `<span class="oc-tv">${esc(x)}</span>`).join('');
    return `<div class="match oc-next${t.state === 'in' ? ' oc-live' : ''}">
      <div class="mrow">${s(m.c1, m.t1, false)}${mid}${s(m.c2, m.t2, true)}</div>
      <div class="meta"><span>${esc(m.round)}${t.venue ? ' · ' + esc(t.venue) : ''}${m.q && t.city ? ', ' + esc(t.city) : ''}</span><span>${m.q ? esc(fmtStated(t)) : t.start ? fmtKick(t.start) : ''}</span></div>
      ${callFor(m)}
      <div class="oc-tvrow">${tv}${t.state === 'pre' && t.start ? calBtn(`${m.t1} v ${m.t2} · U.S. Open Cup ${m.round}`, t.start, [t.venue, m.q && t.city].filter(Boolean).join(', '), 'U.S. Open Cup', false) : ''}</div>
    </div>`;
  };

  /* ---- grouping ---------------------------------------------------------- */
  const proper = rows.filter(m => !isQualifying(m));
  const qual = rows.filter(isQualifying);
  const group = list => {
    const by = new Map();
    for (const m of list) { if (!by.has(m.round)) by.set(m.round, []); by.get(m.round).push(m); }
    return [...by.entries()].sort((a, b) => roundRank(b[0]) - roundRank(a[0]));
  };
  const roundBlock = ([name, ties]) => {
    const done = ties.filter(m => m.score && !(m.live && m.live.state !== 'post'));
    const todo = ties.filter(m => m.live && m.live.state !== 'post');
    const days = ties.map(m => m.day).filter(Boolean).sort((a, b) => a - b);
    const fd = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    const when = !days.length ? '' : fd(days[0]) === fd(days[days.length - 1]) ? fd(days[0]) : `${fd(days[0])} – ${fd(days[days.length - 1])}`;
    return `<section class="oc-round" aria-labelledby="oc-${esc(name).replace(/\W+/g, '-')}">
      <h3 class="disp" id="oc-${esc(name).replace(/\W+/g, '-')}">${esc(name)}</h3>
      <div class="oc-roundmeta">${ties.length} ${ties.length === 1 ? 'tie' : 'ties'}${when ? ' · ' + esc(when) : ''}${
        done.filter(m => m.upset).length ? ` · ${done.filter(m => m.upset).length} giant-killing${done.filter(m => m.upset).length === 1 ? '' : 's'}` : ''}</div>
      <ul class="oc-list">${todo.map(pending).join('')}${done.slice().sort((a, b) => (a.day || 0) - (b.day || 0)).map(played).join('')}</ul>
    </section>`;
  };

  /* ---- headline numbers -------------------------------------------------- */
  const entrants = new Set(); rows.forEach(m => { entrants.add(m.t1); entrants.add(m.t2); });
  const upsets = rows.filter(m => m.upset).length;
  const crossTier = rows.filter(m => TIER[m.k1] && TIER[m.k2] && TIER[m.k1] !== TIER[m.k2]).length;
  const finalRow = rows.find(m => /^final$/i.test(m.round) && m.winner);
  const champion = finalRow ? (finalRow.winner === 1 ? finalRow.t1 : finalRow.t2) : null;
  const champClub = champion ? clubFor(champion, finalRow.winner === 1 ? finalRow.id1 : finalRow.id2) : null;

  /* on the edition in play, point at the qualifying edition that is already
     under way — the amateur rounds ESPN's feed never carries */
  const banner = () => {
    if (!qualYear || yr === qualYear || yr !== current) return '';
    const qt = qualFeed.ties, open = qt.filter(t => t.state === 'pre');
    const rd = open.length ? open[0].round : qt[qt.length - 1].round;
    const n = open.length ? open.filter(t => t.round === rd).length : qt.filter(t => t.round === rd).length;
    return `<a class="oc-qbanner" href="#/opencup/${qualYear}"><b>${qualYear} qualifying is live.</b>
      ${esc(rd)}: ${n} amateur ${n === 1 ? 'tie' : 'ties'}${open.length ? ' still to play' : ''}, with our picks &rarr;</a>`;
  };
  const lead = () => {
    if (!yr) return '';
    if (isQualEdition) {
      if (!nextTies.length) return `<p class="oc-lead">The ${yr} qualifying rounds are under way: amateur clubs from every league playing for 16 places in the Tournament Proper.</p>`;
      const rd = nextTies[0].round, n = nextTies.filter(m => m.round === rd).length;
      return `<p class="oc-lead">Next: <b>${esc(rd)}</b> — ${n} ${n === 1 ? 'tie' : 'ties'}${nextTies[0].q && nextTies[0].q.date ? ', from ' + esc(shortDay(longDay(nextTies[0].q.date), yr)) : ''}. Sixteen clubs will reach the Tournament Proper.</p>`;
    }
    if (champion) return `<p class="oc-lead"><b>Champions: ${champClub ? `<a href="#/club/${champClub.id}">${esc(champion)}</a>` : esc(champion)}</b> — ${esc(finalRow.t1)} ${finalRow.score[0]}–${finalRow.score[1]} ${esc(finalRow.t2)} in the final.</p>`;
    if (nextTies.length) {
      const n = nextTies[0];
      return `<p class="oc-lead">Next: <b>${esc(n.round)}</b> — ${esc(n.t1)} v ${esc(n.t2)}${n.live.start ? ', ' + fmtET(n.live.start) : ''}${nextTies.length > 1 ? `, and ${nextTies.length - 1} more` : ''}.</p>`;
    }
    return '';
  };

  view.innerHTML = `
    <button class="backbtn" onclick="location.hash='#/cups'">&larr; Trophy Room</button>
    <div class="kicker">Lamar Hunt U.S. Open Cup${yr ? ` &middot; ${yr} edition` : ''}</div>
    <h2 class="disp">${yr ? `The ${yr} Open Cup` : 'The Open Cup'}</h2>
    <div class="chips" id="oc-years">${editions.map(y =>
      `<button class="chip solid" data-yr="${y}" aria-pressed="${y === yr}">${y}${y === liveYear && liveTies.some(t => t.state !== 'post') ? ' · live' : y === qualYear && y !== liveYear ? ' · qualifying' : ''}</button>`).join('')}</div>
    ${yr ? `
    ${lead()}
    <div class="statgrid">
      <div class="stat"><b>${entrants.size}</b><span>Clubs on record</span></div>
      <div class="stat"><b>${rows.length}</b><span>Ties</span></div>
      <div class="stat"><b>${upsets}</b><span>Giant-killings</span></div>
    </div>
    ${banner()}
    ${isQualEdition ? (watch.length ? `<div class="kicker" style="margin-top:14px">Closest calls &middot; both clubs rated</div>${watch.map(nextCard).join('')}` : '')
      : nextTies.length ? `<div class="kicker" style="margin-top:14px">Next up &middot; live from the feed</div>${nextTies.map(nextCard).join('')}` : ''}
    ${group(proper).map(roundBlock).join('')}
    ${qual.length && !proper.length ? group(qual).map(roundBlock).join('') : ''}
    ${qual.length && proper.length ? `<details class="how oc-qual"><summary>Qualifying rounds &middot; ${qual.length} ties</summary>${group(qual).map(roundBlock).join('')}</details>` : ''}
    ` : `<p class="note">No record of a ${esc(String(year))} edition. Editions on file: ${editions[editions.length - 1]}&ndash;${editions[0]}; the Cup was not played in 2020 or 2021.</p>`}
    <p class="note"><b>How to read it.</b> Latest round first.${crossTier ? ` ${crossTier} of this edition's ties crossed tiers.` : ''} The badge is the tier each club's league
      sat on that season, on the same ladder as the <a href="#/tiers">Tiers</a> view; a tie a
      lower-tier club won is marked as a giant-killing. <b>+</b> and <b>&minus;</b> are the rating
      points that result moved for that club, the same receipts itemized on its club page. MLS
      clubs rank by the league table, so their Cup results never move a rating here. Extra-time and
      shootout wins count at reduced weight. A club shown as plain text is one we could not match
      to a page with confidence. Historical ties from Wikipedia (CC BY-SA 4.0); this edition's
      kickoffs, venues, broadcasters and live scores from ESPN's public scoreboard.${qualYear ? ` Qualifying-round
      schedules, venues and results from U.S. Soccer (ussoccer.com); venues and cities are shown as U.S. Soccer
      prints them, and clubs we have not matched to a page confidently appear as plain text.` : ''}
      <a href="#/upsets">Every giant-killing since 2016 &rarr;</a></p>`;

  view.querySelector('#oc-years').addEventListener('click', e => {
    const b = e.target.closest('[data-yr]'); if (!b) return;
    location.hash = Number(b.dataset.yr) === current ? '#/opencup' : `#/opencup/${b.dataset.yr}`;
  });
}
