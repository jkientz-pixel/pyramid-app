#!/usr/bin/env python3
"""Add the GCPL (Gulf Coast Premier League) layer — promotes the Tiers-page
"coming" chip to a real league (gcplsoccer.com itself is a bare "update coming
soon" WordPress shell, so the roster comes from two better sources).

Structure since 2025: the GCPL premier division plays as The League for Clubs'
Gulf Coast Conference (the app's `loc` layer), and the second division runs
under the GCPL banner as Gulf Coast League 2 (GCL2).

  * Premier / 2026 (10 clubs, East + West, season ended Jul 12): final
    standings scraped from Wikipedia "2026 The League for Clubs season".
    9 clubs migrate loc->gcpl in place and LAX FC migrates upsl->gcpl
    (same Callaway FL club — TLfC announced it replacing Legacy FC), keeping
    ids/coords/crests; all 10 get standings ratings rr=2.
  * GCL2 / 2026 (12 clubs, 3 conferences, kicked off May 16): roster from
    National Soccer Network "GCL2 Season Opens" (2026-05-16) — no published
    standings, so these land as unrated directory pins per the SWPL/MPL
    precedent. Hattiesburg FC's GCL2 side is the reserve of its USL2 first
    team (same name), so it is skipped per the Christos FC/APSL precedent.

Ratings are affine-mapped onto the same band as APSL (the other regional
layer with real standings): league mean pins to 1350 and the top regular-
season side to 1525, clamped to [1275, 1530]. Regular-season basis; the
playoff (Pensacola FC beat Union 10 FC 3-2 in the conference final) is
recorded in data/gcpl.json but does not move ratings.
"""
import json, os, re, sys, time, unicodedata, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _datajs import load_clubs, write_clubs
from bs4 import BeautifulSoup

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = {'User-Agent': 'RankXI/1.0 (jkientz@gmail.com; league ingest)'}
GEO_CACHE = os.path.join(ROOT, 'data', 'geocache.json')
WIKI = 'https://en.wikipedia.org/wiki/2026_The_League_for_Clubs_season'

STATE_NAMES = {'LA': 'Louisiana', 'MS': 'Mississippi', 'AL': 'Alabama',
               'FL': 'Florida', 'GA': 'Georgia'}

# premier club (standings name) -> (current league, current id) to migrate in
# place; precedent: APSL moved Foro SC loc->apsl + 2 clubs upsl->apsl.
MIGRATE = {
    'Pensacola FC':             ('loc',  'pensacola-fc'),
    'Tallahassee SC':           ('loc',  'tallahassee-sc'),
    'PSC Panama City Beach FC': ('loc',  'psc-panama-city-beach-fc'),
    'Valdosta FC':              ('loc',  'valdosta-fc'),
    'Union 10 FC':              ('loc',  'union-10-fc'),
    'Gaffa FC':                 ('loc',  'gaffa-fc'),
    'Pensacola FC Academy':     ('loc',  'pensacola-fc-academy'),
    'AFC Mobile':               ('loc',  'afc-mobile'),
    'NOLA Ramparts FC':         ('loc',  'nola-ramparts-fc-2026'),
    'LAX FC':                   ('upsl', 'lax-fc'),
}
# migrated club whose stored location is a stale approx -> league-stated city
CITY_FIX = {'lax-fc': ('Callaway', 'FL')}

# GCL2 2026 roster — National Soccer Network, "GCL2 Season Opens", 2026-05-16.
# (name, city, state, conference); Hattiesburg FC (Magnolia) intentionally
# absent: reserve of the USL2 first team already in the app.
GCL2 = [
    ('Gulf Coast United',     'Gulfport',     'MS', 'Magnolia'),
    ('Invictus FC',           'McComb',       'MS', 'Magnolia'),
    ('Mississippi Blues FC',  'Clinton',      'MS', 'Magnolia'),
    ('Central Louisiana FC',  'Alexandria',   'LA', 'Red River'),
    ('Red River FC',          'Bossier City', 'LA', 'Red River'),
    ('Shreveport United',     'Shreveport',   'LA', 'Red River'),
    ('Twin Cities FC',        'West Monroe',  'LA', 'Red River'),
    ('BRSC Capitals',         'Baton Rouge',  'LA', 'Bayou'),
    ('LA Krewe Rush',         'Lafayette',    'LA', 'Bayou'),
    ('Louisiana Fire FC',     'Kenner',       'LA', 'Bayou'),
    ('SWLA Hurricanes',       'Lake Charles', 'LA', 'Bayou'),
]
SKIP_RESERVE = {'Hattiesburg FC': 'reserve of USL2 first team (Christos precedent)'}
# same normalized name as an existing club that is genuinely a DIFFERENT club
# (apsl Invictus FC is in Massachusetts; this one is McComb MS) — bypass dedup
ALLOW_DUP = {'Invictus FC'}

NAME_NOISE = re.compile(r'\b(fc|sc|cf|afc|ac|cd|club|the)\b', re.I)


def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read()


def deacc(x):
    return unicodedata.normalize('NFKD', x).encode('ascii', 'ignore').decode()


def norm(n):
    return re.sub(r'[^a-z0-9]', '', NAME_NOISE.sub('', deacc(n).lower()))


def slugify(n):
    return re.sub(r'-+', '-', re.sub(r'[^a-z0-9]+', '-', deacc(n).lower())).strip('-')


def clean_team(cell):
    """Standings cell text -> plain club name (drop (C)/(P) marks, footnotes)."""
    t = re.sub(r'\[[^\]]*\]', '', cell)
    t = re.sub(r'\(\s*[A-Z]{1,3}(?:\s*,\s*[A-Z]{1,3})*\s*\)', '', t)
    return re.sub(r'\s+', ' ', t).strip()


def parse_premier():
    """Gulf Coast East/West final tables from the Wikipedia season page ->
    {team name: {div, mp, w, d, l, gf, ga, pts}}."""
    doc = BeautifulSoup(get(WIKI).decode(), 'html.parser')
    out = {}
    for tb in doc.find_all('table', class_='wikitable'):
        conf = tb.find_previous('h5')          # conference heading
        if conf is None or 'Gulf Coast' not in conf.get_text():
            continue
        dh = tb.find_previous('h6')            # division heading inside the conf
        if dh is None or dh.find_previous('h5') is not conf:
            continue
        txt = dh.get_text(' ', strip=True)
        div = 'East' if 'East' in txt else 'West' if 'West' in txt else None
        if div is None:
            continue
        hdr = [th.get_text(' ', strip=True) for th in tb.find_all('tr')[0].find_all('th')]
        if 'Pts' not in hdr or not any('Team' in c for c in hdr):
            continue
        for tr in tb.find_all('tr')[1:]:
            cells = [td.get_text(' ', strip=True) for td in tr.find_all(['th', 'td'])]
            if len(cells) < len(hdr) - 1:   # Qualification cell may be rowspan'd
                continue
            row = dict(zip(hdr, cells))
            tk = next((k for k in row if 'Team' in k), 'Team')
            name = clean_team(row[tk])
            try:
                out[name] = {'div': div,
                             'mp': int(row['Pld']), 'w': int(row['W']), 'd': int(row['D']),
                             'l': int(row['L']), 'gf': int(row['GF']), 'ga': int(row['GA']),
                             'pts': int(row['Pts'])}
            except (KeyError, ValueError):
                continue
    return out


def geocode(city, st, cache):
    key = f'{city}|{st}'
    if key in cache:
        return tuple(cache[key]) if cache[key] else None
    url = 'https://nominatim.openstreetmap.org/search?' + urllib.parse.urlencode(
        {'q': f'{city}, {STATE_NAMES[st]}, USA', 'format': 'json', 'limit': 1,
         'featureType': 'settlement'})
    try:
        r = json.loads(get(url))
    except Exception:
        r = []
    time.sleep(1.1)
    cache[key] = [round(float(r[0]['lat']), 3), round(float(r[0]['lon']), 3)] if r else None
    return tuple(cache[key]) if cache[key] else None


def main():
    dry = '--dry-run' in sys.argv
    standings = parse_premier()
    missing = [n for n in MIGRATE if n not in standings]
    extra = [n for n in standings if n not in MIGRATE]
    if missing or extra:
        sys.exit(f'FATAL: standings/roster mismatch — missing {missing}, unexpected {extra}')
    print(f'{len(standings)} premier clubs with final 2026 standings', file=sys.stderr)

    # affine map onto the APSL band: mean -> 1350, top -> 1525
    raws = {n: (3 * s['w'] + s['d']) / s['mp'] * 100 + (s['gf'] - s['ga']) / s['mp'] * 12
            for n, s in standings.items()}
    mean_raw = sum(raws.values()) / len(raws)
    top_raw = max(raws.values())
    scale = (1525 - 1350) / (top_raw - mean_raw) if top_raw > mean_raw else 1.0
    rating = {n: int(max(1275, min(1530, round(1350 + (r - mean_raw) * scale))))
              for n, r in raws.items()}

    src = open(os.path.join(ROOT, 'js', 'data.js')).read()
    clubs = load_clubs(src)
    by_id = {c['id']: c for c in clubs}
    existing = {norm(c['n']) + ':' + c.get('x', 'm') for c in clubs}
    ids = {c['id'] for c in clubs}
    cache = json.load(open(GEO_CACHE)) if os.path.exists(GEO_CACHE) else {}
    report = {'migrated': [], 'added': [], 'skipped': [], 'renamed': []}

    for name, (g, cid) in MIGRATE.items():
        c = by_id.get(cid)
        if c is None:
            sys.exit(f'FATAL: migration target {cid} not found')
        if c['g'] == 'gcpl':
            report['skipped'].append(f'{name}: already gcpl')
        elif c['g'] != g:
            sys.exit(f'FATAL: {cid} expected in {g!r}, found {c["g"]!r}')
        else:
            c['g'] = 'gcpl'
            report['migrated'].append(f'{name} ({g}->gcpl)')
        if c['n'] != name:
            report['renamed'].append(f'{c["n"]} -> {name}')
            c['n'] = name
        s = standings[name]
        c['r'] = rating[name]
        c['rr'] = 2
        c['dv'] = f'Premier · TLfC Gulf Coast {s["div"]}'
        fix = CITY_FIX.get(cid)
        if fix:
            ll = geocode(fix[0], fix[1], cache)
            if ll:
                c['la'], c['lo'] = ll
                c['ct'], c['st'] = fix
                c.pop('acc', None)

    # no GCL2 standings published, so these get seeded illustrative ratings
    # (APSL precedent for standings-less members) — the alternative, no r at
    # all, renders active clubs as "expansion concept" on the club page.
    by_norm_gcpl = {norm(c['n']): c for c in clubs if c['g'] == 'gcpl'}
    for name, city, st, conf in GCL2:
        prior = by_norm_gcpl.get(norm(name))
        if prior is not None:                  # rerun: refresh in place
            seed = sum(ord(ch) * (i + 7) for i, ch in enumerate(name))
            prior.setdefault('r', 1310 + seed % 70)
            report['skipped'].append(f'{name}: already gcpl')
            continue
        if norm(name) + ':m' in existing and name not in ALLOW_DUP:
            report['skipped'].append(f'{name}: name already in app')
            continue
        ll = geocode(city, st, cache)
        if not ll:
            report['skipped'].append(f'{name}: no coords for {city} {st}')
            continue
        cid = slugify(name)
        if cid in ids:
            cid = f'{cid}-gcpl'
            if cid in ids:
                report['skipped'].append(f'{name}: slug taken twice')
                continue
        seed = sum(ord(ch) * (i + 7) for i, ch in enumerate(name))
        clubs.append({'n': name, 'g': 'gcpl', 'x': 'm', 'la': ll[0], 'lo': ll[1],
                      'st': st, 'ct': city, 'id': cid, 'dv': f'GCL2 · {conf}',
                      'r': 1310 + seed % 70})
        ids.add(cid)
        existing.add(norm(name) + ':m')
        report['added'].append(name)
    for name, why in SKIP_RESERVE.items():
        report['skipped'].append(f'{name}: {why}')

    json.dump(cache, open(GEO_CACHE, 'w'))
    json.dump({'fetched': '2026-08-01', 'season': 2026,
               'sources': {'premier': WIKI,
                           'gcl2': 'https://www.nationalsoccernetwork.com/post/gcl2-season-opens'},
               'premier_standings': standings, 'ratings': rating,
               'playoffs': {'semis': ['Union 10 FC 4-1 Gaffa FC', 'Pensacola FC 1-0 Tallahassee SC'],
                            'final': 'Pensacola FC 3-2 Union 10 FC'},
               'gcl2': [{'n': n, 'ct': ct, 'st': st, 'conf': cf} for n, ct, st, cf in GCL2],
               'report': report},
              open(os.path.join(ROOT, 'data', 'gcpl.json'), 'w'), indent=1)

    print(f"migrated {len(report['migrated'])}, added {len(report['added'])}, "
          f"skipped {report['skipped']}", file=sys.stderr)
    if dry:
        print(json.dumps({n: rating[n] for n in sorted(rating, key=rating.get, reverse=True)},
                         indent=1))
        return

    leagues = json.loads(re.search(r'export const LEAGUES=(\{.*?\});', src, re.S).group(1))
    leagues.setdefault('gcpl', {'label': 'Gulf Coast Premier League', 'color': '#3B8E62',
                                'sex': 'm', 'img': 'crests/league-gcpl.png',
                                'url': 'https://www.gcplsoccer.com'})
    body = 'export const LEAGUES=' + json.dumps(leagues, ensure_ascii=False, separators=(',', ':')) + ';'
    src2, n = re.subn(r'export const LEAGUES=\{.*?\};', lambda m: body, src, count=1, flags=re.S)
    if n != 1:
        sys.exit('FATAL: LEAGUES marker not replaced')
    write_clubs(clubs, src2)


if __name__ == '__main__':
    main()
