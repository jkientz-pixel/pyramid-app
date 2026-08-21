/* Build the club-outreach shortlist.
 *
 * The motion this feeds: send a club its own page — crest, rating, national
 * position, results — and ask them to share it or list a tryout. It is the only
 * channel where somebody else does the distribution, and it is deliberately
 * manual. This script decides who to send to first.
 *
 * Ranking principle: reach and responsiveness pull in opposite directions. An
 * MLS club has a huge following and will never share a link from an app it has
 * never heard of. A club three tiers down has a small following and will,
 * because nobody else covers them. The target is the band where a real local
 * audience meets an unmet need for coverage.
 *
 * What this cannot see: follower counts. There is no field for it and no free
 * API worth the trouble, so "reach" here is a proxy built from league tier and
 * whether the account is dedicated to the team rather than the whole
 * institution. Eyeballing the shortlist is a 30-second-per-club manual step.
 *
 * Usage: node scripts/outreach_list.mjs [count] > list.md
 */
import { CLUBS } from '../js/data.js';

const WANT = Number(process.argv[2]) || 50;

/* Season state as of late August. The whole argument for leading with college
   is that its season is starting right now — women's opened Aug 12, men's
   Aug 22 — while the summer leagues are finishing. In-season programs have
   news to share and someone whose job is sharing it. */
const SEASON = {
  ncaa1: 'starting', ncaa2: 'starting', ncaa3: 'starting',
  ncaa1w: 'started', ncaa2w: 'started', naia: 'starting',
  npsl: 'ending', usl2: 'ending', wpsl: 'ending',
  upsl: 'starting', uslc: 'mid', usl1: 'mid', mls: 'mid', nwsl: 'mid',
};

/* Higher = more likely to actually answer and share. Prominence is the enemy
   here, not the goal. */
const RESPONSIVENESS = {
  ncaa3: 10, naia: 10, ncaa2: 9, ncaa2w: 9, upsl: 9, npsl: 8, wpsl: 8,
  ncaa1w: 7, usl2: 7, ncaa1: 5, uslw: 6, uslwl: 6,
  uslc: 3, usl1: 3, mnp: 3, nisa: 4,
  mls: 0, nwsl: 0, /* will not reply; not worth a slot */
};

/* Rough local audience a share would reach. */
const REACH = {
  ncaa1: 5, ncaa1w: 4, ncaa2: 3, ncaa2w: 3, ncaa3: 2, naia: 2,
  uslc: 5, usl1: 4, npsl: 3, usl2: 3, upsl: 2, wpsl: 2, mnp: 3, nisa: 3,
};

const handle = c => c.si || c.sx || null;

/* Who actually receives the message matters more than whether an account
   exists. Three tiers:
     soccer-specific (@elmsblazersWSOC) — lands with the person who runs the
       soccer feed and has something to post about today
     department-wide (@RowanAthletics)  — lands with someone juggling 20 sports
     institution-wide (@uofsc)          — effectively undeliverable
   The first version of this scored "athletics" as a positive, which is exactly
   backwards: that string is the generic case, not the targeted one. */
const SOCCER = /soccer|wsoc|msoc|[-_.]sc$|[-_.]fc$|fc[-_.]|sc[-_.]/;
const DEPT = /athletic|sports|goathletics|[a-z]sports/;

const COLLEGE_LEAGUES = new Set(['ncaa1', 'ncaa2', 'ncaa3', 'ncaa1w', 'ncaa2w', 'naia']);

const audience = c => {
  const h = (handle(c) || '').toLowerCase().replace(/^https?:\/\/(www\.)?(x|twitter|instagram)\.com\//, '');
  if (!h) return 'none';
  if (SOCCER.test(h)) return 'soccer';
  if (DEPT.test(h)) return 'dept';
  /* The tiering only applies to colleges, where a bare institutional handle
     means the whole university. A standalone club's account IS the club — 
     @milwaukeetorrent has no "athletics" in it and is exactly the right
     target. */
  return COLLEGE_LEAGUES.has(c.g) ? 'institution' : 'club';
};

const scored = CLUBS
  .filter(c => !c.h)
  .filter(c => handle(c))          // no account, no way to reach them
  .filter(c => c.img)              // page must look finished
  .filter(c => c.r)                // page must have a rating to show
  .map(c => {
    const season = SEASON[c.g] || 'unknown';
    let s = 0;
    s += (RESPONSIVENESS[c.g] ?? 6) * 3;        // dominant term on purpose
    s += (REACH[c.g] ?? 2) * 2;
    if (season === 'starting') s += 12;          // timing is the thesis
    else if (season === 'started') s += 10;
    else if (season === 'mid') s += 4;
    else if (season === 'ending') s -= 4;
    const aud = audience(c);
    if (aud === 'soccer' || aud === 'club') s += 14;
    else if (aud === 'dept') s += 4;
    else s -= 8;              // messaging the whole university is not outreach
    if (c.si && c.sx) s += 3;                    // reachable two ways
    if (c.url) s += 2;
    if (c.ct) s += 1;
    if (c.rr) s += 1;
    return { c, s, season, aud: audience(c) };
  })
  .filter(x => x.s > 0)
  /* A whole-university account is not a route to the soccer program. With
     1,300+ clubs clearing the filters there is no reason to spend a slot. */
  .filter(x => x.aud !== 'institution')
  .sort((a, b) => b.s - a.s);

/* No more than three per state. Fifty clubs from California is one region's
   worth of distribution, not a national campaign. */
const perState = {};
const perLeague = {};
const seenHandle = new Set();
const picked = [];
for (const x of scored) {
  const st = x.c.st || '??';
  if ((perState[st] || 0) >= 3) continue;
  /* Without a league cap the responsiveness term alone produces 43 D3
     programs — a real answer to "who replies" and a bad answer to "who do we
     want in front of", since it tests exactly one audience. */
  if ((perLeague[x.c.g] || 0) >= 10) continue;
  const h = (handle(x.c) || '').toLowerCase();
  if (seenHandle.has(h)) continue;   // one message per account, not per team
  seenHandle.add(h);
  perState[st] = (perState[st] || 0) + 1;
  perLeague[x.c.g] = (perLeague[x.c.g] || 0) + 1;
  picked.push(x);
  if (picked.length >= WANT) break;
}

const LEAGUE_NAME = {
  ncaa1: 'NCAA D1 M', ncaa2: 'NCAA D2 M', ncaa3: 'NCAA D3', naia: 'NAIA',
  ncaa1w: 'NCAA D1 W', ncaa2w: 'NCAA D2 W', npsl: 'NPSL', upsl: 'UPSL',
  usl2: 'USL2', wpsl: 'WPSL', uslc: 'USL Champ', usl1: 'USL1',
};

console.log(`# Club outreach shortlist — top ${picked.length}\n`);
console.log(`Generated by \`scripts/outreach_list.mjs\`. Re-run to refresh.\n`);
console.log(`Ranked by: responsiveness (does this club answer email at all) × reach`);
console.log(`× whether their season is starting right now × whether the page we'd`);
console.log(`send them looks finished. Capped at 3 per state.\n`);
console.log(`**Not modelled: follower counts.** Check the handle before sending;`);
console.log(`drop anything under a few hundred followers and take the next one down.\n`);
console.log('| # | Club | League | City, ST | Season | Reaches | Handle | Page |');
console.log('|--:|---|---|---|---|---|---|---|');
picked.forEach((x, i) => {
  const c = x.c;
  const h = (handle(c) || '').replace(/^https?:\/\/(www\.)?/, '');
  console.log(`| ${i + 1} | ${c.n} | ${LEAGUE_NAME[c.g] || c.g} | ${c.ct || '—'}, ${c.st} | ${x.season} | ${x.aud} | ${h} | rankedxi.com/club/${c.id} |`);
});

const byLeague = {};
for (const x of picked) byLeague[x.c.g] = (byLeague[x.c.g] || 0) + 1;
console.log(`\n## Mix\n`);
Object.entries(byLeague).sort((a, b) => b[1] - a[1])
  .forEach(([g, n]) => console.log(`- ${LEAGUE_NAME[g] || g}: ${n}`));
console.log(`- states represented: ${Object.keys(perState).length}`);
console.log(`\n## Pool\n`);
console.log(`${scored.length} clubs clear the hard filters (reachable account, crest, rating).`);
console.log(`This is the top ${picked.length}; the same script gives the next tranche.`);
