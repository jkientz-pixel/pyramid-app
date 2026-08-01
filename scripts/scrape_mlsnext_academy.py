#!/usr/bin/env python3
"""MLS NEXT Academy Division roster -> data/mlsnext_academy_2026.json.

mlssoccer.com/mlsnext/academy-division/members publishes the member list
as bare <p>Club Name</p> blocks — names only, no city/state anywhere on
the page (checked 2026-08-01; no links, no per-club pages). Under the
no-guessed-locations policy nothing here can be pinned directly: this
scraper records the roster and splits it into

  * already_on_map — normalized name matches exactly ONE existing club in
    js/data.js (org already pinned via another layer; membership noted)
  * needs_location — no unambiguous match; queued for a location-audit
    pass (club-site lookups) before any pin is possible

Ambiguous names (same normalized name in 2+ states) go to needs_location
rather than risking a wrong-org fold.
"""
import json, os, re, sys, urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_youth_layers import norm

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = 'https://www.mlssoccer.com/mlsnext/academy-division/members'
UA = {'User-Agent': 'RankXI/1.0 (jkientz@gmail.com; youth layer ingest)'}
HEADER = '2025-26 MLS NEXT Academy Division Member Clubs'
FOOTER = 'Social Media'


def fetch_names():
    html = urllib.request.urlopen(
        urllib.request.Request(URL, headers=UA), timeout=30
    ).read().decode('utf-8', 'replace')
    text = re.sub(r'<script.*?</script>|<style.*?</style>', '', html, flags=re.S)
    lines = [l.strip().replace('&amp;', '&')
             for l in re.sub(r'<[^>]+>', '\n', text).split('\n') if l.strip()]
    if HEADER not in lines or FOOTER not in lines:
        sys.exit('FATAL: page layout changed — header/footer markers missing')
    start, end = lines.index(HEADER), lines.index(FOOTER)
    # header renders twice (mobile+desktop nav duplicate the body heading)
    names = [l for l in lines[start + 1:end] if l != HEADER]
    if len(names) < 100:
        sys.exit(f'FATAL: only {len(names)} names parsed — expected 200+')
    return names


def main():
    cur = open(os.path.join(ROOT, 'js', 'data.js')).read()
    clubs = json.loads(re.search(r'export const CLUBS=(\[.*?\]);', cur, re.S).group(1))
    by_norm = {}
    for c in clubs:
        by_norm.setdefault(norm(c['n']), []).append(c)

    names = fetch_names()
    on_map, needs_loc = [], []
    for n in names:
        hits = by_norm.get(norm(n), [])
        if len(hits) == 1:
            on_map.append({'n': n, 'club_id': hits[0]['id'], 'st': hits[0].get('st')})
        else:
            needs_loc.append(n)
    out = {'_source': URL + ' (fetched 2026-08-01; names only, no locations '
                            'published — needs_location clubs await a location '
                            'audit before pinning)',
           'season': '2025-26',
           'already_on_map': on_map, 'needs_location': needs_loc}
    json.dump(out, open(os.path.join(ROOT, 'data', 'mlsnext_academy_2026.json'), 'w'),
              indent=1)
    print(f'{len(names)} member clubs: {len(on_map)} already on the map, '
          f'{len(needs_loc)} need a location audit')


if __name__ == '__main__':
    main()
