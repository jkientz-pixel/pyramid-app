#!/usr/bin/env python3
"""Write MLS ratings from the current official table.

The bug this fixes: MLS is displayed as "ranked by the official league table"
(rr=2), but no script ever wrote the table into `r`. fetch_asa_games.py puts
the results walk in the secondary `re` field and recalibrate2.py treats MLS as
the fixed anchor, so MLS ratings sat on a May snapshot from Aug 1 onward while
the site claimed otherwise (audit 2026-09-23).

Input is data/standings.json, which fetch_race.py refreshes from ESPN in the
scheduled job just before this runs.

Method, same shape as rate_upsl_standings.py:

  strength = points-per-game + 0.25 * goal-difference-per-game
  z        = (strength - league mean) / league sd
  rating   = current MLS mean + z * current MLS sd

The MLS mean and spread are held EXACTLY at their current values. mls_mean is
the anchor every other league is measured from in recalibrate2.py, so moving it
would shift the entire pyramid; this script only reorders clubs within MLS.
"""
import json, sys, pathlib

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from _datajs import load_clubs, write_clubs, ROOT

GD_WEIGHT = 0.25
MIN_GP = 5  # below this the table is noise (season opener week)

# ESPN-derived standings ids that don't equal our club id
ALIASES = {}


def table_rows():
    path = ROOT / 'data' / 'standings.json'
    lg = json.load(open(path))['leagues'].get('mls')
    if not lg:
        sys.exit('FATAL: no MLS table in data/standings.json')
    return {r['id']: r for g in lg['groups'] for r in g['rows']}


def strength(row):
    return (row['pts'] - row.get('ded', 0)) / row['gp'] + GD_WEIGHT * row['gd'] / row['gp']


def main():
    dry = '--dry' in sys.argv
    rows = table_rows()
    src = (ROOT / 'js' / 'data.js').read_text()
    clubs = load_clubs(src)
    mls = [c for c in clubs if c.get('g') == 'mls' and not c.get('h')]

    matched = {c['id']: rows[ALIASES.get(c['id'], c['id'])] for c in mls
               if ALIASES.get(c['id'], c['id']) in rows}
    missing = [c['n'] for c in mls if c['id'] not in matched]
    if missing:
        sys.exit(f'FATAL: MLS clubs missing from the table: {missing} — refusing to write')
    if min(r['gp'] for r in matched.values()) < MIN_GP:
        print(f'MLS: fewer than {MIN_GP} games played, keeping current ratings', file=sys.stderr)
        return

    cur = [c['r'] for c in mls]
    mu_r = sum(cur) / len(cur)
    sd_r = (sum((v - mu_r) ** 2 for v in cur) / len(cur)) ** 0.5

    raws = {cid: strength(r) for cid, r in matched.items()}
    mu = sum(raws.values()) / len(raws)
    sd = (sum((v - mu) ** 2 for v in raws.values()) / len(raws)) ** 0.5 or 1.0

    new = {cid: mu_r + (v - mu) / sd * sd_r for cid, v in raws.items()}
    # rounding can nudge the mean by a fraction of a point; correct it so the
    # anchor recalibrate2 reads is unchanged
    drift = sum(round(v) for v in new.values()) / len(new) - mu_r
    moved = 0
    for c in mls:
        r = round(new[c['id']] - drift)
        moved += r != c['r']
        c['r'], c['rr'] = r, 2
    after = sum(c['r'] for c in mls) / len(mls)
    print(f'MLS: {moved}/{len(mls)} ratings moved; mean {mu_r:.1f} -> {after:.1f}, sd {sd_r:.1f}',
          file=sys.stderr)
    top = sorted(mls, key=lambda c: -c['r'])[:5]
    print('  top: ' + ', '.join(f"{c['n']} {c['r']}" for c in top), file=sys.stderr)
    if dry:
        print('DRY RUN — nothing written', file=sys.stderr)
        return
    write_clubs(clubs, src)


if __name__ == '__main__':
    main()
