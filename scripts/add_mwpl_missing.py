#!/usr/bin/env python3
"""Append the MWPL members scrape_regionals.ingest_second_pass() skipped.

Why they were missed (2026-09-04): its NAME_NOISE dedupe strips league words
and digits before comparing, so "314 Soccer Club" / "1927 SC" normalise to ""
and are dropped, "United Capital City Athletic" collapses to "capital", and
any club with a side in another league (Oakland County FC in USL2, Union KC
in LOC, Berber City FC in UPSL ...) matched that entry and was skipped.

Dual-membership convention (usasa_elite batch): a club fielding a team in two
leagues gets one entry per league, slug suffixed "-mwpl" when the plain slug
is taken. Official links are copied only from SIBLINGS — same organisation
verified by city/state; a same-named club elsewhere (Steel City FC PA vs the
Joliet IL side) gets nothing.

Usage: add_mwpl_missing.py [--dry]
"""
import json, os, re, sys, unicodedata
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _datajs import load_clubs, write_clubs
from scrape_regionals import fetch_mwpl, geocode, crest_path, slugify, load_geo, GEO_CACHE

# new mwpl id -> existing id of the same organisation (links copied)
SIBLINGS = {
    'union-kc-mwpl': 'union-kc',
    'oakland-county-fc-mwpl': 'oakland-county-fc',
    'toledo-villa-fc-mwpl': 'toledo-villa-fc',
    'midwest-united-fc-u23-mwpl': 'midwest-united-fc',
    'edgewater-castle-fc-mwpl': 'edgewater-castle-fc',
    'berber-city-fc-mwpl': 'berber-city-fc',
    'river-light-fc-mwpl': 'river-light-fc',
    'rkc-third-coast-mwpl': 'rkc-third-coast',
}
LINK_KEYS = ('url', 'si', 'sx', 'sf')


def rawnorm(x):
    s = unicodedata.normalize('NFKD', x).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]', '', s)


def main():
    dry = '--dry' in sys.argv
    clubs = load_clubs()
    by_id = {c['id']: c for c in clubs}
    have = {rawnorm(c['n']) for c in clubs if c.get('g') == 'mwpl' and not c.get('h')}
    geo = load_geo()
    added, report = [], []
    rows = fetch_mwpl()
    print(f'league pages list {len(rows)} teams; app holds {len(have)} mwpl entries', file=sys.stderr)
    for div, name, logo, city, st in rows:
        if rawnorm(name) in have:
            continue
        if not (city and st):
            report.append(f'HELD OUT (no league-stated city): {name}')
            continue
        ll = geocode(city, [st], geo)
        if not ll:
            report.append(f'HELD OUT (geocode failed): {name} {city} {st}')
            continue
        cid = slugify(name)
        if cid in by_id:
            cid = f'{cid}-mwpl'
        if cid in by_id:
            report.append(f'SKIP (id taken): {name} {cid}')
            continue
        club = {'n': name, 'g': 'mwpl', 'x': 'm', 'la': ll[0], 'lo': ll[1],
                'st': st, 'ct': city.title(), 'id': cid, 'dv': div}
        img = crest_path('mwpl', cid, logo)
        if img:
            club['img'] = img
        else:
            report.append(f'NO CREST: {name} ({logo or "no logo on page"})')
        sib = by_id.get(SIBLINGS.get(cid, ''))
        if sib:
            for k in LINK_KEYS:
                if sib.get(k):
                    club[k] = sib[k]
        added.append(club)
        by_id[cid] = club
        have.add(rawnorm(name))
        print(f'  + {cid:28s} {name:30s} {city}, {st}  crest={"y" if img else "n"} links={"y" if sib else "-"}  [{div}]', file=sys.stderr)
    for r in report:
        print('  ' + r, file=sys.stderr)
    json.dump(geo, open(GEO_CACHE, 'w'))
    if dry:
        print(f'DRY RUN — {len(added)} would be added', file=sys.stderr)
        return
    clubs.extend(added)
    write_clubs(clubs)
    print(f'added {len(added)} mwpl clubs')


if __name__ == '__main__':
    main()
