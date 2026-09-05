#!/usr/bin/env python3
"""Turn the UPSL standings we already hold into actual UPSL ratings.

The bug this replaces: compute_elo.py stamped rr=2 ("rating from real league
standings") on every UPSL club whose NAME appeared in data/upsl.json, but never
wrote `r`. The rating stayed at add_census_gap_clubs.py's DEFAULT_RATING of
1350, so 285 clubs shared one number while their standings rows sat right here
in the repo saying otherwise — Round Lake 6-0-4, 3 Cities 5-1-4, The Dreams
4-3-3, all rated identically. The flag asserted a provenance the number never
had.

Method. UPSL divisions are islands: 75 divisions, no cross-division play, so
there is no evidence that lets us compare a SoCal North side to a Georgia South
side. We therefore rank WITHIN the pool on record and deliberately keep the band
narrow — a wide spread here would be false precision, not more information.

  strength = points-per-game + 0.25 * clamp(goal-difference-per-game, -3, 3)
  z        = (strength - pool mean) / pool sd
  z       *= gp / (gp + K)        empirical-Bayes shrinkage: a 4-game record
                                   earns less displacement than a 14-game one
  rating   = 1350 + z * SPREAD

1350 is the UPSL anchor implied by the measured Open Cup offset (mls_mean
1886 + upsl offset -536). recalibrate2.py re-anchors the pool mean afterwards
anyway, so the constant here only has to be close.

Clubs with NO standings row get `r` and `rr` REMOVED. Unrated is a real state
the app already renders (dimmed dash, national rank "NR"); a placeholder that
claims to be a rating is not.
"""
import json, re, sys, pathlib, unicodedata

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from _datajs import load_clubs, write_clubs, stored_nudges, ROOT

ANCHOR = 1350.0   # UPSL mean implied by the fitted Open Cup offset
SPREAD = 55.0     # target sd — deliberately tight; divisions don't interplay
K = 6             # shrinkage constant, in games

# Clubs whose standings row doesn't normalise to the display name.
# club id -> norm() of the team name exactly as data/upsl.json spells it.
ALIASES = {
    'bellevue-athletic-fc': 'bellevueathletic',   # standings drop the "FC"
    'texas-havoc-fc': 'texashavocfc',             # rebranded Inter Nova Havoc FC
}


def norm(x):
    s = unicodedata.normalize('NFKD', x).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]', '', s)


def standings_rows():
    """{normalised team name: row} for every UPSL row with games actually played."""
    tables = json.load(open(ROOT / 'data' / 'upsl.json'))
    rows = {}
    for t in tables:
        for r in t.get('rows', []):
            gp = int(r.get('gp') or 0)
            if gp <= 0:
                continue            # a 0-game row is a fixture list, not a record
            rows[norm(r['team'])] = {
                'gp': gp,
                'pts': int(r.get('pts') or 0),
                'gd': int(r.get('gd') or 0),
                'div': t.get('label', ''),
            }
    return rows


def strength(row):
    ppg = row['pts'] / row['gp']
    gdpg = max(-3.0, min(3.0, row['gd'] / row['gp']))
    return ppg + 0.25 * gdpg


def main():
    dry = '--dry' in sys.argv
    rows = standings_rows()
    src = (ROOT / 'js' / 'data.js').read_text()
    clubs = load_clubs(src)
    upsl = [c for c in clubs
            if c.get('g') == 'upsl' and not c.get('h') and c.get('x') != 'w']

    matched = {}
    for c in upsl:
        key = ALIASES.get(c['id'], norm(c['n']))
        if key in rows:
            matched[c['id']] = rows[key]
    if not matched:
        sys.exit('FATAL: no UPSL club matched a standings row — refusing to write')

    raws = {cid: strength(r) for cid, r in matched.items()}
    mu = sum(raws.values()) / len(raws)
    var = sum((v - mu) ** 2 for v in raws.values()) / len(raws)
    sd = var ** 0.5 or 1.0

    # the table gives the cup-free number; recalibrate2 reads `r` as
    # table + stored cup nudge, so the nudge rides along (see stored_nudges)
    nudges = stored_nudges()
    rated = cleared = 0
    for c in upsl:
        row = matched.get(c['id'])
        if row:
            z = (raws[c['id']] - mu) / sd
            z *= row['gp'] / (row['gp'] + K)     # small samples move less
            c['r'] = round(ANCHOR + z * SPREAD + nudges.get(c['id'], 0.0))
            c['rr'] = 2                          # now genuinely standings-derived
            rated += 1
        else:
            # no standings row anywhere -> we do not know how good they are
            if c.pop('r', None) is not None or c.pop('rr', None) is not None:
                cleared += 1
            c.pop('rr', None)

    vals = sorted(c['r'] for c in upsl if c.get('r'))
    print(f'UPSL: {rated} rated from standings, {cleared} cleared to unrated '
          f'({len(upsl)} total)', file=sys.stderr)
    print(f'  range {vals[0]}–{vals[-1]}  distinct values {len(set(vals))}',
          file=sys.stderr)
    if dry:
        print('DRY RUN — nothing written', file=sys.stderr)
        return
    write_clubs(clubs, src)
    print(f'wrote js/data.js: {rated} UPSL ratings, {cleared} cleared')


if __name__ == '__main__':
    main()
