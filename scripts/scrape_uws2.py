#!/usr/bin/env python3
"""UWS League Two directory ingest — uwssoccer.com's second division.

The main /page/show/9507290-teams page carries a "UWS 2 TEAMS" section of
heroPhotoElement links (team page + CDN logo). 2026 is a single-table,
Chicagoland-centric league — no conferences. Home cities were verified
against the league's expansion announcements, riverlightfc.com, and the
Ladies Steel City FC record (CITY_BOOK below); anything the page adds later
falls back to a settlement geocode of the place token in the club name
constrained to IL, else the Chicago anchor with acc='a'.

Directory ingest only, per the SWPL/MPL/Cascadia precedent: name, league
label, league-site logo, location. No ratings (rr absent — renders unrated).
II sides anchor at their parent club's coordinates (Michigan Jaguars II
precedent). Clubs whose exact normalized name already exists in any layer
are skipped and logged.

Outputs: clubs appended to js/data.js (g=uws2), crests to
crests/uws2-<id>.png, skip/fallback log to data/uws2_report.json.
"""
import json, os, re, subprocess, sys, time, unicodedata, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _datajs import load_clubs, write_clubs, ROOT

UA = {'User-Agent': 'RankXI/1.0 (jkientz@gmail.com; league ingest)'}
TEAMS_URL = 'https://www.uwssoccer.com/page/show/9507290-teams'
GEO_CACHE = os.path.join(ROOT, 'data', 'geocache.json')
REPORT = os.path.join(ROOT, 'data', 'uws2_report.json')
ANCHOR = ('Chicago', 'IL', 41.8781, -87.6298)

# slug -> (display name, city, parent-id to anchor II sides at or None)
CITY_BOOK = {
    'firebirds-sc':           ('Firebirds SC', 'Lombard', None),
    'force-fc-ii':            ('Force FC II', 'Crystal Lake', 'force-fc'),
    'river-light-fc':         ('River Light FC', 'Aurora', None),
    'rockford-raptors-fc-ii': ('Rockford Raptors FC II', 'Loves Park',
                               'rockford-raptors-soccer-club'),
    'steel-city-fc':          ('Steel City FC', 'Joliet', None),
    'team-chicago':           ('Team Chicago', 'Aurora', None),
    'wheaton-united-sc':      ('Wheaton United SC', 'Wheaton', None),
}

# Same-name-different-entry cases the name dedupe must NOT skip, with the
# league-suffixed id to use (precedent: steel-city-fc-uslwl). River Light FC
# here is the women's side of the Aurora club whose men are in usl2; Steel
# City FC is Joliet's Ladies Steel City FC, unrelated to Pittsburgh's
# Steel City FC (usl2/uslwl, Cheswick PA).
ALLOW_DUPE = {
    'river-light-fc': 'river-light-fc-uws2',
    'steel-city-fc':  'steel-city-fc-uws2',
}


def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30).read()


def deacc(x):
    return unicodedata.normalize('NFKD', x).encode('ascii', 'ignore').decode()


def norm(n):
    return re.sub(r'[^a-z0-9]', '', deacc(n).lower())


def slug_to_name(slug):
    words = slug.replace('-', ' ').split()
    caps = {'fc': 'FC', 'sc': 'SC', 'ii': 'II', 'afc': 'AFC', 'wfc': 'WFC'}
    return ' '.join(caps.get(w, w.capitalize()) for w in words)


def load_geo():
    try:
        return json.load(open(GEO_CACHE))
    except Exception:
        return {}


def geocode(place, cache):
    key = f'{place}|IL'
    if key in cache:
        return tuple(cache[key]) if cache[key] else None
    url = 'https://nominatim.openstreetmap.org/search?' + urllib.parse.urlencode(
        {'q': f'{place}, Illinois, USA', 'format': 'json', 'limit': 1,
         'featureType': 'settlement'})
    try:
        r = json.loads(get(url))
    except Exception:
        r = []
    time.sleep(1.1)
    ll = (round(float(r[0]['lat']), 3), round(float(r[0]['lon']), 3)) if r else None
    cache[key] = ll
    json.dump(cache, open(GEO_CACHE, 'w'))
    return ll


def scrape_teams():
    html = get(TEAMS_URL).decode('utf-8', 'replace')
    i = html.find('UWS 2 TEAMS')
    if i < 0:
        sys.exit('FATAL: "UWS 2 TEAMS" section not found on the teams page')
    seg = html[i:]
    pairs = re.findall(
        r'href="https://www\.uwssoccer\.com/page/show/(\d{7})-([a-z0-9-]+)"[^>]*>\s*<img[^>]*src="([^"]+)"',
        seg)
    seen, out = set(), []
    for pid, slug, img in pairs:
        if slug in seen:
            continue
        seen.add(slug)
        out.append((pid, slug, img))
    return out


def fetch_crest(img_url, dest):
    tmp = os.path.join(ROOT, 'crests', '_raw_tmp')
    open(tmp, 'wb').write(get(img_url))
    subprocess.run(['sips', '-s', 'format', 'png', '-Z', '128', tmp, '--out', dest],
                   capture_output=True)
    os.path.exists(tmp) and os.remove(tmp)
    return os.path.exists(dest) and os.path.getsize(dest) > 500


def main():
    teams = scrape_teams()
    print(f'{len(teams)} teams in the UWS 2 section')
    clubs = load_clubs()
    by_id = {c.get('id'): c for c in clubs}
    have = {norm(c['n']) for c in clubs}
    cache = load_geo()
    report = {'added': [], 'skipped': [], 'anchor_fallback': []}

    for pid, slug, img_url in teams:
        name, city, parent_id = CITY_BOOK.get(slug, (slug_to_name(slug), None, None))
        cid = ALLOW_DUPE.get(slug) or \
            re.sub(r'-+', '-', re.sub(r'[^a-z0-9]+', '-', deacc(name).lower())).strip('-')
        if cid in by_id or (slug not in ALLOW_DUPE and norm(name) in have):
            print(f'  - {name}: already present, skipped')
            report['skipped'].append(name)
            continue
        rec = {'n': name, 'g': 'uws2', 'x': 'w', 'st': 'IL', 'dv': 'UWS League Two',
               'ct': city or ANCHOR[0], 'id': cid}
        parent = by_id.get(parent_id)
        if parent:
            rec['la'], rec['lo'] = parent['la'], parent['lo']
            rec['ct'], rec['st'] = parent.get('ct', city), parent.get('st', 'IL')
        else:
            ll = geocode(city, cache) if city else None
            if not city:
                # place token from the club name, IL-constrained
                tok = re.sub(r'\b(fc|sc|united|city|team|ii)\b', '', slug.replace('-', ' '),
                             flags=re.I).strip()
                ll = geocode(tok.title(), cache) if tok else None
                rec['ct'] = tok.title() or ANCHOR[0]
            if ll:
                rec['la'], rec['lo'] = ll
            else:
                rec['la'], rec['lo'], rec['ct'] = ANCHOR[2], ANCHOR[3], ANCHOR[0]
                rec['acc'] = 'a'
                report['anchor_fallback'].append(name)
        fn = f'crests/uws2-{cid}.png'
        try:
            if fetch_crest(img_url, os.path.join(ROOT, fn)):
                rec['img'] = fn
            else:
                raise Exception('sips produced nothing')
        except Exception as e:
            print(f'  ! {name}: crest failed ({e})')
        clubs.append(rec)
        have.add(norm(name))
        report['added'].append(name)
        print(f"  + {name} — {rec['ct']}, {rec['st']}" + (' [anchor]' if rec.get('acc') else ''))
        time.sleep(0.6)

    json.dump(report, open(REPORT, 'w'), indent=1)
    if report['added']:
        write_clubs(clubs)
    print(f"{len(report['added'])} added, {len(report['skipped'])} skipped — report at data/uws2_report.json")


if __name__ == '__main__':
    main()
