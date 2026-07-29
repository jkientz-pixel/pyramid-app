#!/usr/bin/env python3
"""Merge data/tail_crests.json (club id -> crest path staged by the pass-3
tail sweeps: derivative copies, harvest re-mine, club-site icons) into
js/data.js. Kept separate from the staging passes so nothing races the UPSL
wayback scraper's periodic data.js checkpoints."""
from _datajs import load_clubs, write_clubs, ROOT
import json, os

def main():
    side = json.load(open(os.path.join(ROOT, 'data', 'tail_crests.json')))
    clubs = load_clubs()
    n = 0
    for c in clubs:
        fn = side.get(c.get('id'))
        if fn and not c.get('img') and os.path.exists(os.path.join(ROOT, fn)):
            c['img'] = fn; n += 1
    unknown = set(side) - {c.get('id') for c in clubs}
    if unknown:
        print('sidecar ids matching no club:', sorted(unknown))
    print(f'applied {n} tail crests')
    if n:
        write_clubs(clubs)

if __name__ == '__main__':
    main()
