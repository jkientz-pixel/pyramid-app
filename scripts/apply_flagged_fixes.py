#!/usr/bin/env python3
"""Apply the 75-flagged-club UPSL location audit resolutions to js/data.js.

Reads ~/Documents/rankedxi-launch-campaign/upsl-audit/resolutions.json (fix /
no_change / unresolved). For 'fix' entries, geocodes city+state through
data/geocache.json (Nominatim, 1.1s throttle, cached) and re-pins the club.
For 'no_change' entries, just stamps acc:'v' (league-confirmed in place).
'unresolved' entries are left completely untouched.
"""
from _datajs import load_clubs, write_clubs, ROOT
import json, os, sys, time, urllib.parse, urllib.request

RES = '/Users/jeremykientz/Documents/rankedxi-launch-campaign/upsl-audit/resolutions.json'
GEOCACHE = os.path.join(ROOT, 'data', 'geocache.json')
UA = {'User-Agent': 'RankXI/1.0 (jkientz@gmail.com)'}
ST_FULL = {'AL':'Alabama','AK':'Alaska','AZ':'Arizona','AR':'Arkansas','CA':'California','CO':'Colorado','CT':'Connecticut','DE':'Delaware','DC':'District of Columbia','FL':'Florida','GA':'Georgia','HI':'Hawaii','ID':'Idaho','IL':'Illinois','IN':'Indiana','IA':'Iowa','KS':'Kansas','KY':'Kentucky','LA':'Louisiana','ME':'Maine','MD':'Maryland','MA':'Massachusetts','MI':'Michigan','MN':'Minnesota','MS':'Mississippi','MO':'Missouri','MT':'Montana','NE':'Nebraska','NV':'Nevada','NH':'New Hampshire','NJ':'New Jersey','NM':'New Mexico','NY':'New York','NC':'North Carolina','ND':'North Dakota','OH':'Ohio','OK':'Oklahoma','OR':'Oregon','PA':'Pennsylvania','RI':'Rhode Island','SC':'South Carolina','SD':'South Dakota','TN':'Tennessee','TX':'Texas','UT':'Utah','VT':'Vermont','VA':'Virginia','WA':'Washington','WV':'West Virginia','WI':'Wisconsin','WY':'Wyoming'}


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
    res = json.load(open(RES))
    clubs = load_clubs()
    by_id = {c['id']: c for c in clubs}
    geocache = json.load(open(GEOCACHE)) if os.path.exists(GEOCACHE) else {}

    applied, skipped = [], []
    for item in res['fix']:
        c = by_id.get(item['id'])
        if not c:
            skipped.append((item['id'], 'not found in data.js'))
            continue
        if 'la' in item and 'lo' in item:
            la, lo = item['la'], item['lo']
        else:
            ll = geocode(geocache, item['city'], item['st'])
            if not ll:
                skipped.append((item['id'], f"geocode failed for {item['city']}, {item['st']}"))
                continue
            la, lo = ll
        before = f"{c.get('ct','?')}, {c.get('st','?')}"
        c['ct'], c['st'] = item['city'], item['st']
        c['la'], c['lo'] = la, lo
        c['acc'] = 'v'
        applied.append({'id': item['id'], 'name': c['n'], 'from': before,
                         'to': f"{item['city']}, {item['st']}"})
        print(f"  FIX {c['n']}: {before} -> {item['city']}, {item['st']}")

    confirmed = []
    for item in res['no_change']:
        c = by_id.get(item['id'])
        if not c:
            skipped.append((item['id'], 'not found in data.js'))
            continue
        if c.get('acc') != 'v':
            c['acc'] = 'v'
        confirmed.append({'id': item['id'], 'name': c['n'], 'loc': f"{c.get('ct','?')}, {c.get('st','?')}"})
        print(f"  CONFIRM {c['n']}: {c.get('ct','?')}, {c.get('st','?')} (already correct)")

    for item in res['unresolved']:
        print(f"  UNRESOLVED {item['id']}: left unchanged")

    write_clubs(clubs)
    print(f"\n{len(applied)} fixed, {len(confirmed)} confirmed-in-place, "
          f"{len(res['unresolved'])} left unresolved, {len(skipped)} skipped")
    if skipped:
        print("SKIPPED:", skipped)

    out = {'applied': applied, 'confirmed': confirmed, 'skipped': skipped,
           'ran_at': time.strftime('%Y-%m-%d %H:%M')}
    json.dump(out, open('/Users/jeremykientz/Documents/rankedxi-launch-campaign/upsl-audit/apply_log.json', 'w'), indent=1)


if __name__ == '__main__':
    main()
