/* Build the public "for modders" club export (CSV + JSON) from js/data.js.
   Usage: node scripts/build_modder_export.mjs 2026-08-14
   Rosters and crest files are deliberately excluded — see export/README.md. */
import { CLUBS, LEAGUES } from '../js/data.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SNAPSHOT = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}$/.test(SNAPSHOT || '')) {
  console.error('pass the snapshot date, e.g. node scripts/build_modder_export.mjs 2026-08-14');
  process.exit(1);
}

/* mirrors LEVELS in js/app.js — kept in sync by hand; unknown codes fall to "other" */
const LEVELS = {
  pro: ['mls', 'uslc', 'usl1', 'mnp', 'nisa', 'nwsl', 'uslw'],
  amateur: ['npsl', 'upsl', 'usl2', 'apsl', 'swpl', 'mpl', 'mwpl', 'cpl', 'cplw', 'gcpl', 'loc', 'uslwl', 'wpsl', 'uws', 'uws2'],
  college: ['ncaa1', 'ncaa2', 'ncaa3', 'naia', 'ncaa1w', 'ncaa2w'],
  youth: ['mlsnext', 'ecnlb', 'ga', 'ecnlg', 'ea', 'ecrlb', 'ecrlg', 'gaa'],
};
const levelOf = g => Object.keys(LEVELS).find(k => LEVELS[k].includes(g)) || 'other';

const BASIS = { 1: 'real_results', 2: 'standings', 3: 'results_model' };
const SITE = 'https://www.rankedxi.com';

const rows = CLUBS.filter(c => !c.h).map(c => ({
  id: c.id || '',
  name: c.n,
  league_code: c.g,
  league: LEAGUES[c.g]?.label || c.g,
  level: levelOf(c.g),
  gender: c.x === 'w' ? 'W' : 'M',
  city: c.ct || '',
  state: c.st || '',
  lat: c.la ?? '',
  lon: c.lo ?? '',
  location_accuracy: c.acc === 'a' ? 'approximate' : 'verified',
  rating: c.rr ? c.r : '',
  rating_basis: BASIS[c.rr] || '',
  website: c.url || '',
  crest_url: c.img ? `${SITE}/${c.img}` : '',
}));

const meta = {
  source: 'Ranked XI — rankedxi.com',
  license: 'CC BY 4.0 — attribution "Ranked XI (rankedxi.com)" required',
  snapshot: SNAPSHOT,
  clubs: rows.length,
  notes: 'Ratings are a dated snapshot, not a live feed. Blank rating = unrated (youth listings and clubs without a connected results feed). Rosters and crest image files are not part of this export.',
};

const csvCell = v => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const header = Object.keys(rows[0]);
const csv = [header.join(','), ...rows.map(r => header.map(k => csvCell(r[k])).join(','))].join('\n') + '\n';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'export');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'rankedxi-clubs.csv'), csv);
writeFileSync(join(out, 'rankedxi-clubs.json'), JSON.stringify({ meta, clubs: rows }, null, 1) + '\n');
console.log(`wrote ${rows.length} clubs (snapshot ${SNAPSHOT}) to export/`);
