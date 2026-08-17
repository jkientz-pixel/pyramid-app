#!/usr/bin/env python3
"""Add the USASA elite-amateur batch: Cosmopolitan SL, SFSFL, EPLWA,
LISFL, BDSL (top divisions only).

Input is the hand-curated data/usasa_elite_batch.json — every club row
was verified against league/club sources before it got here. Cities are
league-stated ONLY (no name-token guessing, per the location policy);
clubs whose city could not be verified arrive with "city": null and are
HELD OUT (logged to the report, not added).

Geocodes via Nominatim settlement search through data/geocache.json,
fetches crests from the curated logo URLs, appends via _datajs.write_clubs.
"""
from _datajs import load_clubs, write_clubs
import json, os, re, sys, time, unicodedata, urllib.parse, urllib.request

UA = {'User-Agent': 'RankXI/1.0 (jkientz@gmail.com; league ingest)'}
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BATCH = os.path.join(ROOT, 'data', 'usasa_elite_batch.json')
GEO_CACHE = os.path.join(ROOT, 'data', 'geocache.json')
REPORT = os.path.join(ROOT, 'data', 'usasa_elite_report.json')

STATE_NAMES = {'NY': 'New York', 'CA': 'California', 'WA': 'Washington',
               'NJ': 'New Jersey', 'CT': 'Connecticut'}

NAME_NOISE = re.compile(
    r"\b(fc|sc|cf|afc|ac|bc|cd|club|city|united|athletic|sporting|soccer|"
    r"deportivo|inter|internationals?|rovers|rangers|wanderers|dynamo|union|premier|"
    r"legends?|men'?s?|women'?s?|academy|u\d+|[0-9]+)\b", re.I)
# NB: 'ii/iii/reserves' deliberately NOT noise here — CSL D1 fields true second
# teams (Hoboken FC 1912 II) whose first teams exist in other layers.


def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30).read()


def deacc(x):
    return unicodedata.normalize('NFKD', x).encode('ascii', 'ignore').decode()


def norm(n):
    return re.sub(r'[^a-z0-9]', '', re.sub(NAME_NOISE, '', deacc(n).lower()))


def slugify(n):
    return re.sub(r'-+', '-', re.sub(r'[^a-z0-9]+', '-', deacc(n).lower())).strip('-')


def geocode(place, st, cache):
    key = f'{place}|{st}'
    if key in cache:
        return tuple(cache[key]) if cache[key] else None
    url = 'https://nominatim.openstreetmap.org/search?' + urllib.parse.urlencode(
        {'q': f'{place}, {STATE_NAMES.get(st, st)}, USA', 'format': 'json', 'limit': 1,
         'featureType': 'settlement'})
    try:
        r = json.loads(get(url))
    except Exception:
        r = []
    time.sleep(1.1)
    if not r:
        # NYC neighborhoods (Astoria, Ridgewood...) aren't settlements; retry unrestricted
        url = 'https://nominatim.openstreetmap.org/search?' + urllib.parse.urlencode(
            {'q': f'{place}, {STATE_NAMES.get(st, st)}, USA', 'format': 'json', 'limit': 1})
        try:
            r = json.loads(get(url))
        except Exception:
            r = []
        time.sleep(1.1)
    ll = (round(float(r[0]['lat']), 4), round(float(r[0]['lon']), 4)) if r else None
    cache[key] = ll
    return ll


def crest_path(g, cid, url):
    if not url:
        return None
    dest = os.path.join(ROOT, 'crests', f'{g}-{cid}.png')
    rel = f'crests/{g}-{cid}.png'
    if os.path.exists(dest):
        return rel
    try:
        data = get(url)
        if len(data) < 200:
            return None
        open(dest, 'wb').write(data)
        os.system(f'sips -s format png "{dest}" --out "{dest}" >/dev/null 2>&1; '
                  f'sips -Z 256 "{dest}" >/dev/null 2>&1')
        # sips leaves non-PNG junk (html soft-404s) unconverted — verify magic
        with open(dest, 'rb') as f:
            if f.read(8) != b'\x89PNG\r\n\x1a\n':
                os.remove(dest)
                return None
        return rel
    except Exception:
        try:
            os.path.exists(dest) and os.remove(dest)
        except Exception:
            pass
        return None


def main():
    batch = json.load(open(BATCH))
    clubs = load_clubs()
    existing_norm = {(norm(c['n']), c['x']) for c in clubs}
    # (norm, league) pairs make force re-runnable: a forced dual-membership
    # entry must still not be added twice to the SAME league
    existing_norm_g = {(norm(c['n']), c['x'], c['g']) for c in clubs}
    ids = {c['id'] for c in clubs}
    geo = json.load(open(GEO_CACHE)) if os.path.exists(GEO_CACHE) else {}
    report = {'skipped_existing': [], 'held_no_city': [], 'geocode_failed': [],
              'no_crest': [], 'added': {}}

    for lg in batch['leagues']:
        g = lg['code']
        added = 0
        for t in lg['clubs']:
            name = t['name'].strip()
            nn = (norm(name), 'm')
            if (norm(name), 'm', g) in existing_norm_g:
                report['skipped_existing'].append(f"{g}: {name} (already in this league)")
                continue
            if nn in existing_norm and not t.get('force'):
                # 'force' = deliberate dual-membership entry (club fields squads
                # in two leagues, e.g. Bellingham United in both CPL and EPLWA)
                report['skipped_existing'].append(f"{g}: {name}")
                continue
            if not t.get('city'):
                report['held_no_city'].append(f"{g}: {name}")
                continue
            st = t['st']
            ll = geocode(t['city'], st, geo)
            if not ll:
                report['geocode_failed'].append(f"{g}: {name} ({t['city']}, {st})")
                continue
            cid = slugify(name)
            if cid in ids:
                cid = f'{cid}-{g}'
                if cid in ids:
                    report['skipped_existing'].append(f"{g}: {name} (slug collision)")
                    continue
            club = {'n': name, 'g': g, 'x': 'm', 'la': ll[0], 'lo': ll[1],
                    'st': st, 'ct': t['city'], 'id': cid,
                    'acc': 'a' if t.get('approx') else 'v'}
            if t.get('url'):
                club['url'] = t['url']
            img = crest_path(g, cid, t.get('logo'))
            if img:
                club['img'] = img
            else:
                report['no_crest'].append(f'{g}: {name}')
            clubs.append(club)
            ids.add(cid)
            existing_norm.add(nn)
            added += 1
        report['added'][g] = added
        print(f"{g}: +{added} of {len(lg['clubs'])}", file=sys.stderr)

    json.dump(geo, open(GEO_CACHE, 'w'))
    json.dump(report, open(REPORT, 'w'), indent=1)

    src = open(os.path.join(ROOT, 'js', 'data.js')).read()
    leagues = json.loads(re.search(r'export const LEAGUES=(\{.*?\});', src, re.S).group(1))
    for lg in batch['leagues']:
        if lg['code'] not in leagues:
            leagues[lg['code']] = {k: lg[k] for k in ('label', 'color', 'sex', 'url')}
            if lg.get('img'):
                leagues[lg['code']]['img'] = lg['img']
    body = 'export const LEAGUES=' + json.dumps(leagues, ensure_ascii=False, separators=(',', ':')) + ';'
    src = re.sub(r'export const LEAGUES=\{.*?\};', lambda m: body, src, count=1, flags=re.S)
    write_clubs(clubs, src)
    print(json.dumps({k: v for k, v in report.items() if k != 'added'}, indent=1)[:2000], file=sys.stderr)


if __name__ == '__main__':
    main()
