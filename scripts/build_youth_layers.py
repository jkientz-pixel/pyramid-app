#!/usr/bin/env python3
"""Seed the youth directory layer: MLS NEXT member clubs (boys).

Source: the Wikipedia 'MLS Next' Clubs table (club name, 'City, State'
location, join season) — the league's own site has no machine-readable
member list. Locations are settlement-geocoded through the shared
data/geocache.json (Nominatim, 1.1s courtesy delay on misses); a club whose
city won't resolve is skipped and logged rather than pinned wrong.

Girls' side note: neither Girls Academy nor ECNL publishes a scrapeable
member directory (GA /members/ is a JS shell, theecnl.com/clubs 404s, no
Wikipedia list). The girls' youth layer stays a coming-chip until one of
those publishes a list or we enter it manually.

Clubs whose normalized name already exists in ANY layer are skipped and
logged (MLS academy sides collide with their first teams by design).

Outputs: clubs appended to js/data.js (g=mlsnext, x=m, unrated),
         skip/geo log to data/youth_report.json.
Idempotent: existing mlsnext clubs are rebuilt from scratch each run.
"""
import json, os, re, sys, time, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _datajs import write_clubs
from build_college_layers import api, unwiki, deacc, STATES

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = {'User-Agent': 'RankXI/1.0 (jkientz@gmail.com; youth layer ingest)'}
GEO_CACHE = os.path.join(ROOT, 'data', 'geocache.json')

# strip only organizational suffixes — location/identity words (united, city,
# academy, SA) are what distinguish real youth orgs from same-token adult clubs
NAME_NOISE = re.compile(r"\b(fc|sc|cf|afc|ac|club|soccer)\b", re.I)


def norm(n):
    # trailing 'Academy' folds into the parent club name so MLS academy
    # sides ('Atlanta United FC Academy') collide with their first team
    n = re.sub(r'\s+academy\s*$', '', deacc(n).lower())
    return ' '.join(NAME_NOISE.sub(' ', n).split())


def slugify(n):
    return re.sub(r'-+', '-', re.sub(r'[^a-z0-9]+', '-', deacc(n).lower())).strip('-')


def parse_mlsnext():
    text = api({'action': 'parse', 'page': 'MLS Next', 'prop': 'wikitext',
                'redirects': 1, 'format': 'json'})['parse']['wikitext']['*']
    i = text.find('== Clubs ==')
    if i < 0:
        i = text.find('==Clubs==')
    table = text[i:]
    out = []
    for block in re.split(r'\n\|-\s*', table):
        lines = [l for l in block.split('\n') if l.startswith('|') and not l.startswith('|}')]
        if len(lines) < 2 or lines[0].startswith('|+'):
            continue
        name, loc = unwiki(lines[0][1:]).strip(), unwiki(lines[1][1:]).strip()
        m = re.match(r'(.+?),\s*([A-Za-z .]+)$', loc)
        if not (name and m):
            continue
        city, state_name = m.group(1).strip(), m.group(2).strip()
        st = STATES.get(state_name.lower())
        if st:
            out.append({'name': name, 'city': city, 'st': st})
    return out


def geocode(city, st, cache):
    key = f'{city}|{st}'
    if key in cache:
        return tuple(cache[key]) if cache[key] else None
    url = 'https://nominatim.openstreetmap.org/search?' + urllib.parse.urlencode(
        {'q': f'{city}, {st}, USA', 'format': 'json', 'limit': 1})
    ll = None
    try:
        r = json.load(urllib.request.urlopen(
            urllib.request.Request(url, headers=UA), timeout=30))
        if r:
            ll = (round(float(r[0]['lat']), 3), round(float(r[0]['lon']), 3))
    except Exception:
        pass
    cache[key] = list(ll) if ll else None
    time.sleep(1.1)
    return ll


def main():
    dpath = os.path.join(ROOT, 'js', 'data.js')
    cur = open(dpath).read()
    clubs = json.loads(re.search(r'export const CLUBS=(\[.*?\]);', cur, re.S).group(1))
    clubs = [c for c in clubs if c['g'] != 'mlsnext']
    taken_ids = {c['id'] for c in clubs}
    taken_names = {norm(c['n']) for c in clubs}
    cache = json.load(open(GEO_CACHE)) if os.path.exists(GEO_CACHE) else {}

    rows = parse_mlsnext()
    print(f'mlsnext: {len(rows)} clubs in the member table')
    new_clubs, skipped, nogeo = [], [], []
    for r in rows:
        if norm(r['name']) in taken_names:
            skipped.append(r['name'])
            continue
        cid = slugify(r['name'])
        if cid in taken_ids:
            skipped.append(r['name'] + ' (slug)')
            continue
        ll = geocode(r['city'], r['st'], cache)
        if not ll:
            nogeo.append(f"{r['name']} ({r['city']}, {r['st']})")
            continue
        taken_ids.add(cid)
        taken_names.add(norm(r['name']))
        new_clubs.append({'n': r['name'], 'g': 'mlsnext', 'x': 'm',
                          'la': ll[0], 'lo': ll[1], 'st': r['st'],
                          'ct': r['city'], 'id': cid})
    json.dump(cache, open(GEO_CACHE, 'w'))
    clubs.extend(new_clubs)
    write_clubs(clubs, cur)
    json.dump({'skipped_collisions': skipped, 'no_geocode': nogeo},
              open(os.path.join(ROOT, 'data', 'youth_report.json'), 'w'), indent=1)
    print(f'built {len(new_clubs)} mlsnext clubs; '
          f'{len(skipped)} name collisions skipped, {len(nogeo)} no-geocode')


if __name__ == '__main__':
    main()
