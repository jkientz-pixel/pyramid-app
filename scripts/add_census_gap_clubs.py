#!/usr/bin/env python3
"""UPSL census gap: add clubs found on upsl.com's own team-page listings
(premier/division1/division2 /teams/ crawl, already cached in
data/upsl_locations.json) that don't match any existing club in data.js.
Candidates were pre-filtered (deduped by name+loc, dropped unusable/blank
locations) into
~/Documents/rankedxi-launch-campaign/upsl-audit/census_candidates.json.
League-stated city/division = qualifying source per task scale guidance
(don't chase individual socials for hundreds of clubs).
"""
from _datajs import load_clubs, write_clubs, ROOT
import json, os, re, sys, time, unicodedata, urllib.parse, urllib.request

CAND = '/Users/jeremykientz/Documents/rankedxi-launch-campaign/upsl-audit/census_candidates.json'
GEOCACHE = os.path.join(ROOT, 'data', 'geocache.json')
UA = {'User-Agent': 'RankXI/1.0 (jkientz@gmail.com)'}
ST_FULL = {'AL':'Alabama','AK':'Alaska','AZ':'Arizona','AR':'Arkansas','CA':'California','CO':'Colorado','CT':'Connecticut','DE':'Delaware','DC':'District of Columbia','FL':'Florida','GA':'Georgia','HI':'Hawaii','ID':'Idaho','IL':'Illinois','IN':'Indiana','IA':'Iowa','KS':'Kansas','KY':'Kentucky','LA':'Louisiana','ME':'Maine','MD':'Maryland','MA':'Massachusetts','MI':'Michigan','MN':'Minnesota','MS':'Mississippi','MO':'Missouri','MT':'Montana','NE':'Nebraska','NV':'Nevada','NH':'New Hampshire','NJ':'New Jersey','NM':'New Mexico','NY':'New York','NC':'North Carolina','ND':'North Dakota','OH':'Ohio','OK':'Oklahoma','OR':'Oregon','PA':'Pennsylvania','RI':'Rhode Island','SC':'South Carolina','SD':'South Dakota','TN':'Tennessee','TX':'Texas','UT':'Utah','VT':'Vermont','VA':'Virginia','WA':'Washington','WV':'West Virginia','WI':'Wisconsin','WY':'Wyoming'}
LOC_RE = re.compile(r'^(.*),\s*([A-Z]{2})$')
DEFAULT_RATING = 1350

def deacc(x): return unicodedata.normalize('NFKD', x).encode('ascii', 'ignore').decode()
def slugify(n): return re.sub(r'[^a-z0-9]+', '-', deacc(n).lower()).strip('-')

def geocode(cache, city, st):
    key = f'{city}, {ST_FULL[st]}'
    if key in cache:
        return cache[key]
    url = 'https://nominatim.openstreetmap.org/search?' + urllib.parse.urlencode(
        {'q': key + ', USA', 'format': 'json', 'limit': 1})
    try:
        r = json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30))
        cache[key] = [round(float(r[0]['lat']), 4), round(float(r[0]['lon']), 4)] if r else None
    except Exception as e:
        print(f'  geocode ERR {key}: {e}', file=sys.stderr)
        return None
    json.dump(cache, open(GEOCACHE, 'w'))
    time.sleep(1.1)
    return cache[key]

def main():
    cands = json.load(open(CAND))
    clubs = load_clubs()
    existing_ids = {c['id'] for c in clubs if c.get('id')}
    geocache = json.load(open(GEOCACHE)) if os.path.exists(GEOCACHE) else {}

    added, skipped = [], []
    for t in cands:
        m = LOC_RE.match((t.get('loc') or '').strip())
        if not m or m.group(2) not in ST_FULL:
            skipped.append((t['name'], 'unusable loc: ' + repr(t.get('loc'))))
            continue
        city, st = m.group(1).strip(), m.group(2)
        slug = slugify(t['name'])
        cid = f'{slug}-upsl' if slug in existing_ids else slug
        if cid in existing_ids:
            skipped.append((t['name'], f'id collision even with suffix: {cid}'))
            continue
        ll = geocode(geocache, city, st)
        if not ll:
            skipped.append((t['name'], f'geocode failed for {city}, {st}'))
            continue
        rec = {'n': t['name'], 'g': 'upsl', 'x': 'm', 'la': ll[0], 'lo': ll[1],
               'r': DEFAULT_RATING, 'st': st, 'ct': city, 'id': cid, 'acc': 'v'}
        clubs.append(rec)
        existing_ids.add(cid)
        added.append({'id': cid, 'name': t['name'], 'loc': f'{city}, {st}', 'division': t.get('division')})
        print(f"  ADD {t['name']} ({city}, {st}) -> id={cid}")

    write_clubs(clubs)
    print(f'\n{len(added)} new UPSL clubs added, {len(skipped)} skipped')
    if skipped:
        print('SKIPPED:')
        for s in skipped:
            print('  ', s)

    out = {'added': added, 'skipped': skipped, 'ran_at': time.strftime('%Y-%m-%d %H:%M')}
    json.dump(out, open('/Users/jeremykientz/Documents/rankedxi-launch-campaign/upsl-audit/census_add_log.json', 'w'), indent=1)

if __name__ == '__main__':
    main()
