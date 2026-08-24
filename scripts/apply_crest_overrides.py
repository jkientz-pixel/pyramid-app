#!/usr/bin/env python3
"""Apply data/crest_overrides.json to js/data.js.

For every entry with verified=1: stamp c['ck']=1 and, if `img` is given, make
that crest win over whatever a scraper wrote. Every club NOT in the file (or
with verified 0) loses `ck` — the file is the single source of truth for the
green crest check, so a re-scrape can never leave a stale "verified" behind.

Run after any crest pipeline step and before deploy. Bump CRESTV in app.js if
an override changes crest pixels under an existing filename.
"""
import json, os, pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from _datajs import load_clubs, write_clubs

ROOT = pathlib.Path(__file__).resolve().parent.parent

def main():
    ov = json.loads((ROOT / 'data' / 'crest_overrides.json').read_text())['clubs']
    clubs = load_clubs()
    byid = {c['id']: c for c in clubs}
    unknown = [k for k in ov if k not in byid]
    if unknown:
        sys.exit(f'unknown club ids in crest_overrides.json: {unknown}')
    stamped = imgs = cleared = 0
    for c in clubs:
        o = ov.get(c['id'])
        if o and o.get('verified'):
            if o.get('img'):
                if not (ROOT / o['img']).exists():
                    sys.exit(f"{c['id']}: override img missing on disk: {o['img']}")
                if c.get('img') != o['img']: imgs += 1
                c['img'] = o['img']
            if not c.get('img'):
                sys.exit(f"{c['id']}: verified but has no crest image")
            if not c.get('ck'): stamped += 1
            c['ck'] = 1
        elif 'ck' in c:
            del c['ck']; cleared += 1
    write_clubs(clubs)
    print(f'crest overrides: {sum(1 for c in clubs if c.get("ck"))} verified '
          f'({stamped} newly stamped, {imgs} img overrides, {cleared} cleared)')

if __name__ == '__main__':
    main()
