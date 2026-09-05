#!/usr/bin/env python3
"""Rate a regional (USASA-tier) league from its published standings table.

Same method as rate_upsl_standings.py, generalised to any league whose table
we hold as data/<league>_standings.json:

  strength = points-per-game + 0.25 * clamp(goal-difference-per-game, -3, 3)
  z        = (strength - pool mean) / pool sd
  z       *= gp / (gp + K)        empirical-Bayes shrinkage on short records
  rating   = ANCHOR + z * SPREAD

Divisions are islands (no cross-division play), so the band is kept
deliberately narrow: within-pool order is evidence, a wide spread would be
false precision. ANCHOR is the league mean implied by the measured Open Cup
offset for the "regional" bucket in data/opencup_offsets.json (MWPL, MPL,
SWPL, ... are all fitted together there) on top of the MLS mean the UPSL
script documents (1886). recalibrate2.py leaves regional leagues un-anchored,
so this constant is the only place the league mean is set.

Clubs with NO standings row have `r`/`rr` REMOVED: unrated is a real state the
app renders ("Active member club, not yet rated"), a placeholder is not.

Usage: rate_regional_standings.py <league-code> [--dry]
"""
import json, re, sys, pathlib, unicodedata

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from _datajs import load_clubs, write_clubs, stored_nudges, ROOT

MLS_MEAN = 1886.0     # same constant rate_upsl_standings.py derives its 1350 from
SPREAD = 55.0
K = 6

# league -> {club id: norm() of the team name exactly as the standings spell it}
ALIASES = {
    'mwpl': {
        'michigan-jaguars': 'michiganjaguarsfc',
        'holland-struikrovers': 'hollandrovers',        # PlayMetrics keeps the old name
        'bavarian-united': 'bavarianunitedsc',
        'st-louis-stars-sc': 'stlouisstars',
        'ehtar-belleville': 'ehtarbellevillefc',
        'stl-development-academy': 'stlouisdevelopmentacademy',
        'st-louis-fusion-fc': 'stlouisfusion',
        'midwest-united-fc-u23-mwpl': 'midwestunitedfc',  # table drops the U23
    },
}


def norm(x):
    s = unicodedata.normalize('NFKD', x).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]', '', s)


def standings_rows(league):
    doc = json.load(open(ROOT / 'data' / f'{league}_standings.json'))
    rows = {}
    for t in doc['tables']:
        for r in t['rows']:
            if int(r.get('gp') or 0) <= 0:
                continue
            rows[norm(r['team'])] = {'gp': int(r['gp']), 'pts': int(r['pts']),
                                     'gd': int(r.get('gd') or 0), 'div': t['label'],
                                     'team': r['team']}
    return doc, rows


def strength(row):
    ppg = row['pts'] / row['gp']
    gdpg = max(-3.0, min(3.0, row['gd'] / row['gp']))
    return ppg + 0.25 * gdpg


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if len(args) != 1:
        sys.exit(__doc__)
    league = args[0]
    dry = '--dry' in sys.argv
    offsets = json.load(open(ROOT / 'data' / 'opencup_offsets.json'))['modern']['offsets']
    anchor = MLS_MEAN + offsets['regional']

    doc, rows = standings_rows(league)
    src = (ROOT / 'js' / 'data.js').read_text()
    clubs = load_clubs(src)
    pool = [c for c in clubs if c.get('g') == league and not c.get('h') and c.get('x') != 'w']
    aliases = ALIASES.get(league, {})

    matched, used = {}, set()
    for c in pool:
        key = aliases.get(c['id'], norm(c['n']))
        if key in rows:
            matched[c['id']] = rows[key]
            used.add(key)
    if not matched:
        sys.exit(f'FATAL: no {league} club matched a standings row — refusing to write')

    raws = {cid: strength(r) for cid, r in matched.items()}
    mu = sum(raws.values()) / len(raws)
    sd = (sum((v - mu) ** 2 for v in raws.values()) / len(raws)) ** 0.5 or 1.0

    # the table gives the cup-free number; recalibrate2 reads `r` as
    # table + stored cup nudge, so the nudge rides along (see stored_nudges)
    nudges = stored_nudges()
    rated = cleared = 0
    for c in pool:
        row = matched.get(c['id'])
        if row:
            z = (raws[c['id']] - mu) / sd * (row['gp'] / (row['gp'] + K))
            c['r'] = round(anchor + z * SPREAD + nudges.get(c['id'], 0.0))
            c['rr'] = 2
            rated += 1
        else:
            if c.pop('r', None) is not None:
                cleared += 1
            c.pop('rr', None)

    vals = sorted(c['r'] for c in pool if c.get('r'))
    err = sys.stderr
    print(f'{league}: season {doc.get("season")} — {rated} rated from standings, '
          f'{cleared} cleared to unrated ({len(pool)} clubs, {len(rows)} table rows)', file=err)
    print(f'  anchor {anchor:.0f}  range {vals[0]}–{vals[-1]}  distinct {len(set(vals))}', file=err)
    unmatched_clubs = [c['n'] for c in pool if c['id'] not in matched]
    unmatched_rows = [r['team'] for k, r in rows.items() if k not in used]
    if unmatched_clubs:
        print(f'  clubs with no row ({len(unmatched_clubs)}): {", ".join(unmatched_clubs)}', file=err)
    if unmatched_rows:
        print(f'  rows with no club ({len(unmatched_rows)}): {", ".join(unmatched_rows)}', file=err)
    if dry:
        for c in sorted((c for c in pool if c.get('r')), key=lambda c: -c['r']):
            print(f'  {c["r"]}  {c["n"]:32s} {matched[c["id"]]["div"]}', file=err)
        print('DRY RUN — nothing written', file=err)
        return
    write_clubs(clubs, src)
    print(f'wrote js/data.js: {rated} {league} ratings, {cleared} cleared')


if __name__ == '__main__':
    main()
