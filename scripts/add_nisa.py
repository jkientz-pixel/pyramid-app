#!/usr/bin/env python3
"""Bring the NISA layer up to the league's 2026 roster (8 clubs, per
https://nisasoccer.com/standings). Idempotent: updates existing entries by id,
adds missing ones. Coordinates reuse the clubs' existing loc/usl2/uslwl entries
(same organizations); Sin City FC is new (Las Vegas). Ratings illustrative
(rr absent) pending a NISA results source. Crests: nisa.sportzstudio.com via
scripts-side download (crests/nisa-*.png). Also fixes the 'Arkansa Wolves'
name typo in loc and LA Force's wrong url (was a French town site)."""
import json, re, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _datajs import write_clubs

NISA = [
    dict(n='Arkansas Wolves', la=34.7555, lo=-92.2726, st='AR', ct='North Little Rock',
         url='https://arkansaswolves.com/', id='arkansas-wolves-nisa', r=1497),
    dict(n='Capo FC', la=33.5017, lo=-117.6626, st='CA', ct='San Juan Capistrano',
         url='https://fccapistrano.org/', id='capo-fc-nisa', r=1503),
    dict(n='DC Hyper', la=39.1526, lo=-77.3114, st='MD', ct='Montgomery',
         url='https://fchyper.com/', id='dc-hyper-nisa', r=1488),
    dict(n='Georgia FC', la=33.8854, lo=-84.2484, st='GA', ct='DeKalb',
         url='https://www.gafcpro.com', id='georgia-fc-nisa', r=1492),
    dict(n='NOCO Hailstorm', la=40.4679, lo=-104.88, st='CO', ct='Windsor',
         url='https://www.hailstormfc.com/', id='noco-hailstorm-nisa', r=1506),
    dict(n='Peak Eleven FC', la=39.9528, lo=-105.1686, st='CO', ct='Superior',
         url='https://www.peakxifc.com/', id='peak-eleven-fc-nisa', r=1485),
    dict(n='Sin City FC', la=36.1699, lo=-115.1398, st='NV', ct='Las Vegas',
         url='https://nisanation.com/teams/sin-city-fc-nn', id='sin-city-fc-nisa', r=1494),
]
CREST = {'arkansas-wolves-nisa': 'nisa-arkansas-wolves', 'capo-fc-nisa': 'nisa-capo-fc',
         'dc-hyper-nisa': 'nisa-dc-hyper', 'georgia-fc-nisa': 'nisa-georgia-fc',
         'noco-hailstorm-nisa': 'nisa-noco-hailstorm', 'peak-eleven-fc-nisa': 'nisa-peak-eleven-fc',
         'sin-city-fc-nisa': 'nisa-sin-city-fc'}


def main():
    cur = open(os.path.join(ROOT, 'js', 'data.js')).read()
    clubs = json.loads(re.search(r'export const CLUBS=(\[.*?\]);', cur, re.S).group(1))
    byid = {c['id']: c for c in clubs}

    for spec in NISA:
        img = f"crests/{CREST[spec['id']]}.png"
        assert os.path.exists(os.path.join(ROOT, img)), f"missing {img}"
        entry = byid.get(spec['id'])
        if entry is None:
            entry = {'n': spec['n'], 'g': 'nisa', 'x': 'm'}
            clubs.append(entry)
            byid[spec['id']] = entry
        entry.update(la=spec['la'], lo=spec['lo'], r=spec['r'], st=spec['st'],
                     ct=spec['ct'], url=spec['url'], img=img, id=spec['id'])
        entry['g'] = 'nisa'
        entry['x'] = 'm'

    la = byid.get('la-force')
    if la:
        la['url'] = 'https://www.losangelesforce.com'
        la['img'] = 'crests/nisa-la-force.png'

    ark = byid.get('arkansa-wolves')
    if ark and ark['n'] == 'Arkansa Wolves':
        ark['n'] = 'Arkansas Wolves'

    write_clubs(clubs, cur)
    nisa = [c for c in clubs if c['g'] == 'nisa']
    print(f'nisa: {len(nisa)} clubs', file=sys.stderr)
    for c in nisa:
        print(f"  {c['n']} ({c['ct']}, {c['st']}) img={c['img']}", file=sys.stderr)


if __name__ == '__main__':
    main()
