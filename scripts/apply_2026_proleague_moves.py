#!/usr/bin/env python3
"""2026 pro-league membership sync (one-off, idempotent).

Wikipedia's 2026 season pages (USL League One: 17 teams, MLS Next Pro: 30)
vs the app showed USL1 missing 5 clubs and carrying 4 that left after 2025,
and MLSNP missing 2. Cities are the season-page stated home cities; coords
via Nominatim on that city (club-level pin, per the no-guessed-locations
policy). Departed clubs get h=1 (hidden everywhere, slug kept so legacy
URLs resolve) — the CLUBS array is append-only.

Run apply: python3 scripts/apply_2026_proleague_moves.py
"""
import json, re, time, urllib.request, urllib.parse, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _datajs import load_clubs, write_clubs

UA = {'User-Agent': 'RankXI/0.1 (jkientz@gmail.com; 2026 membership sync)'}

DEPARTED_USL1 = ['Central Valley Fuego FC', 'Northern Colorado Hailstorm',
                 'South Georgia Tormenta', 'Texoma FC']
RENAMES = {'The Town FC': 'San Jose Earthquakes II'}
NEW = [
    ('Athletic Club Boise', 'usl1', 'Garden City', 'ID'),
    ('Corpus Christi FC', 'usl1', 'Corpus Christi', 'TX'),
    ('Fort Wayne FC', 'usl1', 'Fort Wayne', 'IN'),
    ('New York Cosmos', 'usl1', 'Paterson', 'NJ'),
    ('Sarasota Paradise', 'usl1', 'Lakewood Ranch', 'FL'),
    ('New York City FC II', 'mnp', 'Queens', 'NY'),
    ('St. Louis City 2', 'mnp', 'St. Louis', 'MO'),
]


def nominatim(city, st):
    url = 'https://nominatim.openstreetmap.org/search?' + urllib.parse.urlencode(
        {'q': f'{city}, {st}, USA', 'format': 'json', 'limit': 1})
    r = json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30))
    return (round(float(r[0]['lat']), 3), round(float(r[0]['lon']), 3)) if r else None


def slugify(n):
    return re.sub(r'-+', '-', re.sub(r'[^a-z0-9]+', '-', n.lower())).strip('-')


def main():
    clubs = load_clubs()
    by_n = {c['n']: c for c in clubs}
    for n in DEPARTED_USL1:
        if n in by_n and not by_n[n].get('h'):
            by_n[n]['h'] = 1
            print(f'hidden (departed): {n}')
    for old, new in RENAMES.items():
        if old in by_n:
            by_n[old]['n'] = new
            print(f'renamed: {old} -> {new} (id kept: {by_n[old]["id"]})')
    ids = {c['id'] for c in clubs}
    for n, g, ct, st in NEW:
        cid = slugify(n)
        if cid in ids:
            # same name, different league (Sarasota Paradise runs a UPSL side
            # AND the new USL1 franchise) -> league-qualified slug
            existing = next(c for c in clubs if c['id'] == cid)
            if existing['g'] == g:
                print(f'exists, skipped: {n}')
                continue
            cid = f'{cid}-{g}'
            if cid in ids:
                print(f'exists (league-qualified), skipped: {n}')
                continue
        ll = nominatim(ct, st)
        time.sleep(1.1)
        if not ll:
            print(f'NO COORDS, skipped: {n}')
            continue
        clubs.append({'n': n, 'g': g, 'x': 'm', 'la': ll[0], 'lo': ll[1],
                      'st': st, 'ct': ct, 'id': cid})
        ids.add(cid)
        print(f'added: {n} ({g}, {ct} {st})')
    write_clubs(clubs)


if __name__ == '__main__':
    main()
