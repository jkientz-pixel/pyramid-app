#!/usr/bin/env python3
"""Close the gaps between UPSL's Spring 2026 standings and the club list.

Found 2026-09-24 while reconciling UPSL's own Spring 2026 team list (sent by
Nick Webster) against data/upsl.json and js/data.js. Every standings row with
games played should join to a live UPSL club; these did not:

  * Five clubs field a UPSL side but only had an entry under another league
    (USL2, GCPL/WPSL), so their UPSL record had nowhere to land. Appended as
    separate `upsl` entries, the same pattern as emporia-fc / emporia-fc-2026.
  * TBD FC (Madison, WI) was tombstoned as a placeholder name. It is a real
    club: premier.upsl.com/teams/tbd-fc-734732/, 4-1-5 in Midwest Central.
  * Philadelphia Lone Star FC U23 was pinned in Macoupin County, IL (a county
    in `ct` is the guessed-pin tell). UPSL's Division 1 team list states
    Philadelphia, PA.

Locations are exactly what each club's UPSL team page states (read 2026-09-24),
geocoded through refresh_upsl_locations.geocode. Nothing is guessed.
Tennessee Tempo and Georgia Impact were unrated for a different reason (name
mismatch) and are fixed by ALIASES in rate_upsl_standings.py, not here.

Idempotent: re-running skips entries already present. Run
rate_upsl_standings.py afterwards so the new entries get their ratings.
"""
import json, sys, pathlib

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from _datajs import load_clubs, write_clubs  # noqa: E402
from refresh_upsl_locations import geocode, GEOCACHE  # noqa: E402

# (id, display name, city, state, source page)
NEW_UPSL = [
    ('brevard-sc-upsl', 'Brevard SC', 'Palm Bay', 'FL',
     'premier.upsl.com/teams/brevard-sc-762278/'),
    ('shark-coast-fc-upsl', 'Shark Coast FC', 'New Smyrna Beach', 'FL',
     'premier.upsl.com/teams/shark-coast-fc-842990/'),
    ('lakeland-united-upsl', 'Lakeland United', 'Lakeland', 'FL',
     'premier.upsl.com/teams/lakeland-united-83086/'),
    ('philadelphia-lone-star-fc-upsl', 'Philadelphia Lone Star FC', 'Philadelphia', 'PA',
     'premier.upsl.com/teams/philadelphia-lone-star-fc-53567/'),
    ('valdosta-fc-upsl', 'Valdosta FC', 'Valdosta', 'GA',
     'division1.upsl.com/teams/valdosta-fc-961929/'),
]
UNHIDE = ['tbd-fc']
REPIN = {'philadelphia-lone-star-fc-u23': ('Philadelphia', 'PA')}


def locate(cache, city, st):
    ll = geocode(cache, city, st)
    if not ll:
        sys.exit(f'FATAL: could not geocode {city}, {st}; nothing written')
    return ll


def main():
    clubs = load_clubs()
    cache = json.load(open(GEOCACHE))
    by_id = {c['id']: c for c in clubs}

    for cid in UNHIDE:
        by_id[cid].pop('h', None)
        print(f'unhid {cid}')

    for cid, (city, st) in REPIN.items():
        la, lo = locate(cache, city, st)
        by_id[cid].update(la=la, lo=lo, ct=city, st=st, acc='v')
        print(f'repinned {cid} -> {city}, {st}')

    for cid, name, city, st, src in NEW_UPSL:
        if cid in by_id:
            print(f'skip {cid}: already present')
            continue
        la, lo = locate(cache, city, st)
        clubs.append({'n': name, 'g': 'upsl', 'x': 'm', 'la': la, 'lo': lo,
                      'st': st, 'ct': city, 'id': cid, 'acc': 'v'})
        print(f'added {cid} ({city}, {st}) from {src}')

    write_clubs(clubs)


if __name__ == '__main__':
    main()
