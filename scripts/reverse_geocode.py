#!/usr/bin/env python3
"""Derive a city for every club pin.

Pass 1: exact-coordinate match back to data/geocache.json (city was the
geocode query, so the match is authoritative).
Pass 2: Nominatim reverse-geocode the rest, cached in data/revgeo.json so
re-runs are free. Clubs listed in SKIP_IDX were hand-placed at metro level
during the 2026-07-27 wrong-state cleanup -- their coords are placement
guesses, not sourced locations, so no city may be derived from them.

Also writes data/state_audit.json: clubs whose st disagrees with the
reverse-geocoded state (candidate bad geocodes with no name signal).
"""
import json, re, time, urllib.request, urllib.parse, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SKIP_IDX = {202,534,208,548,220,337,354,362,408,415,514,519,521,533,554,645,690,691,1074,425}
UA = {'User-Agent': 'RankXI/1.0 (jkientz@gmail.com)'}
ST_ABBR = {'Alabama':'AL','Alaska':'AK','Arizona':'AZ','Arkansas':'AR','California':'CA','Colorado':'CO','Connecticut':'CT','Delaware':'DE','District of Columbia':'DC','Florida':'FL','Georgia':'GA','Hawaii':'HI','Idaho':'ID','Illinois':'IL','Indiana':'IN','Iowa':'IA','Kansas':'KS','Kentucky':'KY','Louisiana':'LA','Maine':'ME','Maryland':'MD','Massachusetts':'MA','Michigan':'MI','Minnesota':'MN','Mississippi':'MS','Missouri':'MO','Montana':'MT','Nebraska':'NE','Nevada':'NV','New Hampshire':'NH','New Jersey':'NJ','New Mexico':'NM','New York':'NY','North Carolina':'NC','North Dakota':'ND','Ohio':'OH','Oklahoma':'OK','Oregon':'OR','Pennsylvania':'PA','Rhode Island':'RI','South Carolina':'SC','South Dakota':'SD','Tennessee':'TN','Texas':'TX','Utah':'UT','Vermont':'VT','Virginia':'VA','Washington':'WA','West Virginia':'WV','Wisconsin':'WI','Wyoming':'WY','Quebec':'QC','Ontario':'ON','British Columbia':'BC'}

src = (ROOT / 'js' / 'data.js').read_text()
clubs = json.loads(re.search(r'export const CLUBS=(\[.*?\]);', src, re.S).group(1))

geocache = json.loads((ROOT / 'data' / 'geocache.json').read_text())
coord2city = {}
for key, val in geocache.items():
    if not val: continue
    la, lo = val
    city = key.rsplit(',', 1)[0].strip()
    st_full = key.rsplit(',', 1)[1].strip() if ',' in key else ''
    coord2city[(round(la, 4), round(lo, 4))] = (city, ST_ABBR.get(st_full, ''))

rev_path = ROOT / 'data' / 'revgeo.json'
rev = json.loads(rev_path.read_text()) if rev_path.exists() else {}

def nominatim(la, lo):
    key = f'{la:.4f},{lo:.4f}'
    if key in rev:
        return rev[key]
    url = ('https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&lat=%s&lon=%s'
           % (la, lo))
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20) as r:
            a = json.load(r).get('address', {})
    except Exception as e:
        print('ERR', la, lo, e, file=sys.stderr)
        return None
    city = a.get('city') or a.get('town') or a.get('village') or a.get('municipality') or a.get('hamlet') or a.get('county') or ''
    city = re.sub(r'^(City of|Town of|Village of|Township of)\s+', '', city)
    city = re.sub(r'\s+(Township|County)$', '', city)
    st = ST_ABBR.get(a.get('state', ''), '')
    rev[key] = {'ct': city, 'st': st}
    time.sleep(1.05)
    return rev[key]

out, audit = {}, []
pending = [(i, c) for i, c in enumerate(clubs)
           if i not in SKIP_IDX and not c.get('ct') and c.get('la') is not None]
print(f'{len(pending)} clubs need a city', flush=True)
for n, (i, c) in enumerate(pending):
    hit = coord2city.get((round(c['la'], 4), round(c['lo'], 4)))
    if hit:
        out[i] = {'ct': hit[0], 'st': hit[1] or c.get('st')}
    else:
        r = nominatim(c['la'], c['lo'])
        if r and r['ct']:
            out[i] = r
    got = out.get(i)
    if got and got.get('st') and got['st'] != c.get('st'):
        audit.append({'i': i, 'n': c['n'], 'g': c['g'], 'st': c.get('st'), 'rev_st': got['st'], 'ct': got['ct']})
    if n % 25 == 24:
        rev_path.write_text(json.dumps(rev))
        (ROOT / 'data' / 'derived_cities.json').write_text(json.dumps(out))
        print(f'{n+1}/{len(pending)} done, {len(out)} cities, {len(audit)} audit flags', flush=True)

rev_path.write_text(json.dumps(rev))
(ROOT / 'data' / 'derived_cities.json').write_text(json.dumps(out))
(ROOT / 'data' / 'state_audit.json').write_text(json.dumps(audit, indent=1))
print(f'FINISHED: {len(out)} cities for {len(pending)} clubs; {len(audit)} state-audit flags', flush=True)
