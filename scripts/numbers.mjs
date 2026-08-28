/* Single source of truth for every public-facing count.
 *
 * Written because the site said 4,285 clubs while every social bio, store
 * listing and Reddit draft said 3,965 — the number moved when leagues were
 * added and the copy didn't. Any figure quoted anywhere should come from here.
 *
 * Usage:  node scripts/numbers.mjs          print the card
 *         node scripts/numbers.mjs --json   machine-readable
 */
import { CLUBS } from '../js/data.js';

const COLLEGE = new Set(['ncaa1', 'ncaa2', 'ncaa3', 'ncaa1w', 'ncaa2w', 'naia']);
const YOUTH = new Set(['ecrlb', 'ecrlg', 'ecnlb', 'ecnlg', 'pecnlb', 'pecnlg', 'mlsnext', 'ga', 'gaa', 'ea']);

/* h:1 is a tombstone — CLUBS is append-only, so rows are retired rather than
   deleted and a raw .length overcounts. */
const live = CLUBS.filter(c => !c.h);
const count = pred => live.filter(pred).length;

const n = {
  clubs: live.length,
  leagues: new Set(live.map(c => c.g)).size,
  states: new Set(live.map(c => c.st).filter(Boolean)).size,
  mens: count(c => c.x === 'm'),
  womens: count(c => c.x === 'w'),
  college: count(c => COLLEGE.has(c.g)),
  youth: count(c => YOUTH.has(c.g)),
  withCrest: count(c => c.img),
  withSocial: count(c => c.si || c.sx),
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(n, null, 2));
} else {
  const f = v => v.toLocaleString('en-US');
  console.log(`
CANONICAL NUMBERS — regenerate with: node scripts/numbers.mjs
────────────────────────────────────────────────────────────
  clubs .................. ${f(n.clubs)}      <- the headline number
  leagues ................ ${n.leagues}
  states + territories ... ${n.states}
  men's clubs ............ ${f(n.mens)}
  women's clubs .......... ${f(n.womens)}
  college programs ....... ${f(n.college)}
  youth clubs ............ ${f(n.youth)}
  clubs with a crest ..... ${f(n.withCrest)}
  clubs with a social acct ${f(n.withSocial)}

  One-liner:
  Every club in American soccer — all ${f(n.clubs)} of them — on one map, one table.

  Bio line:
  Free app mapping the whole US soccer pyramid — ${f(n.clubs)} clubs across ${n.leagues} leagues, MLS to grassroots, college and youth included. Real results, no invented ratings.
`);
}
