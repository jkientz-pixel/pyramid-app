#!/usr/bin/env python3
"""Add USL League Two, USL W League, WPSL, and UWS club layers.
Teams+cities from main league articles; 2026 standings (rr=2 ratings)
from season/group-table templates where published. Geocodes via
Nominatim with an on-disk cache. Merges into js/data.js."""
from _datajs import load_clubs, write_clubs
import json, re, os, sys, time, urllib.request, urllib.parse, unicodedata
from bs4 import BeautifulSoup

UA = {'User-Agent': 'RankXI/1.0 (jkientz@gmail.com; league ingest)'}
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

STATE_AB = {s: a for s, a in [('Alabama','AL'),('Alaska','AK'),('Arizona','AZ'),('Arkansas','AR'),('California','CA'),('Colorado','CO'),('Connecticut','CT'),('Delaware','DE'),('Florida','FL'),('Georgia','GA'),('Hawaii','HI'),('Idaho','ID'),('Illinois','IL'),('Indiana','IN'),('Iowa','IA'),('Kansas','KS'),('Kentucky','KY'),('Louisiana','LA'),('Maine','ME'),('Maryland','MD'),('Massachusetts','MA'),('Michigan','MI'),('Minnesota','MN'),('Mississippi','MS'),('Missouri','MO'),('Montana','MT'),('Nebraska','NE'),('Nevada','NV'),('New Hampshire','NH'),('New Jersey','NJ'),('New Mexico','NM'),('New York','NY'),('North Carolina','NC'),('North Dakota','ND'),('Ohio','OH'),('Oklahoma','OK'),('Oregon','OR'),('Pennsylvania','PA'),('Rhode Island','RI'),('South Carolina','SC'),('South Dakota','SD'),('Tennessee','TN'),('Texas','TX'),('Utah','UT'),('Vermont','VT'),('Virginia','VA'),('Washington','WA'),('West Virginia','WV'),('Wisconsin','WI'),('Wyoming','WY'),('District of Columbia','DC'),('Washington, D.C.','DC')]}
EXCLUDE_ST = {'HI', 'AK'}  # CONUS projection; islands/inset later

def fetch_html(title):
    u = 'https://en.wikipedia.org/api/rest_v1/page/html/' + urllib.parse.quote(title.replace(' ', '_'), safe='')
    return urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=60).read().decode()

def wikitext(title):
    url = 'https://en.wikipedia.org/w/api.php?' + urllib.parse.urlencode(
        {'action': 'parse', 'page': title, 'prop': 'wikitext', 'redirects': 1, 'format': 'json'})
    for _ in range(3):
        try:
            r = json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30))
            if 'error' in r: return None
            return r['parse']['wikitext']['*']
        except Exception as e:
            if '429' in str(e): time.sleep(12); continue
            return None
    return None

def deacc(x): return unicodedata.normalize('NFKD', x).encode('ascii', 'ignore').decode()
def norm(n): return re.sub(r'\b(fc|sc|cf|afc|cd|club|the)\b', '', deacc(n).lower()).replace(' ', '').replace('.', '').replace("'", '')

def parse_grid(tb):
    """rowspan/colspan-aware table -> list of row dicts keyed by header."""
    grid = []
    pending = {}  # col -> (text, remaining)
    for tr in tb.find_all('tr'):
        row, col = [], 0
        cells = tr.find_all(['th', 'td'])
        ci = 0
        while ci < len(cells) or col in pending:
            if col in pending:
                txt, rem = pending[col]
                row.append(txt)
                if rem > 1: pending[col] = (txt, rem - 1)
                else: del pending[col]
                col += 1; continue
            if ci >= len(cells): break
            c = cells[ci]; ci += 1
            txt = c.get_text(' ', strip=True)
            rs = int(c.get('rowspan', 1) or 1); cs = int(c.get('colspan', 1) or 1)
            for k in range(cs):
                row.append(txt)
                if rs > 1: pending[col] = (txt, rs - 1)
                col += 1
        grid.append(row)
    if not grid: return []
    header = [re.sub(r'\[.*?\]', '', h).strip() for h in grid[0]]
    out = []
    for r in grid[1:]:
        if len(r) < 2: continue
        out.append({header[i]: r[i] for i in range(min(len(header), len(r)))})
    return out

def teams_from_article(title):
    doc = BeautifulSoup(fetch_html(title), 'html.parser')
    teams = []
    for tb in doc.find_all('table'):
        heads = [th.get_text(strip=True) for th in tb.find_all('th')[:10]]
        if not (any(h in ('Team', 'Club') for h in heads) and any(h in ('City', 'Location') for h in heads)):
            continue
        if any(h in ('Fate', 'Last season') or 'Former' in h or 'Departing' in h for h in heads): continue
        for row in parse_grid(tb):
            name = row.get('Team') or row.get('Club') or ''
            city = row.get('City') or row.get('Location') or ''
            name = re.sub(r'\[.*?\]', '', name).strip()
            city = re.sub(r'\[.*?\]', '', city).strip()
            if not name or not city or name in ('Team', 'Club'): continue
            st = ''
            parts = [p.strip() for p in city.split(',')]
            if len(parts) >= 2:
                st = STATE_AB.get(parts[-1], '') or (parts[-1] if parts[-1] in STATE_AB.values() else '')
            teams.append({'name': name, 'city': city, 'st': st})
        if teams: break  # first (current-season) table only
    # dedupe by normalized name
    seen, out = set(), []
    for t in teams:
        k = norm(t['name'])
        if k in seen: continue
        seen.add(k); out.append(t)
    return out

def standings_rows(text):
    out = []
    if not text: return out
    for c in set(re.findall(r'\|\s*win_([A-Za-z0-9]{2,8})\s*=', text)):
        def g(k):
            m = re.search(r'\|\s*' + k + '_' + c + r'\s*=\s*([\-\d]+)', text)
            return int(m.group(1)) if m else None
        m = re.search(r'\|\s*name_' + c + r'\s*=\s*(.+)', text)
        if not m: continue
        lm = re.search(r'\[\[([^\]|]+)(?:\|([^\]]+))?\]\]', m.group(1))
        nm = (lm.group(2) or lm.group(1)).strip() if lm else m.group(1).strip()
        w, d, l = g('win'), g('draw'), g('loss')
        gf, ga = g('gf'), g('ga')
        if w is None or l is None: continue
        out.append({'name': nm, 'pts': 3 * w + (d or 0),
                    'gd': (gf - ga) if (gf is not None and ga is not None) else 0})
    return out

GEO_CACHE = os.path.join(ROOT, 'data', 'geocache.json')
def geocode_all(queries):
    cache = json.load(open(GEO_CACHE)) if os.path.exists(GEO_CACHE) else {}
    todo = [q for q in queries if q not in cache]
    print(f'geocoding {len(todo)} new of {len(queries)} places', file=sys.stderr)
    for i, q in enumerate(todo):
        url = 'https://nominatim.openstreetmap.org/search?' + urllib.parse.urlencode(
            {'q': q + ', USA', 'format': 'json', 'limit': 1})
        try:
            r = json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30))
            cache[q] = [round(float(r[0]['lat']), 4), round(float(r[0]['lon']), 4)] if r else None
        except Exception:
            cache[q] = None
        if i % 25 == 0:
            json.dump(cache, open(GEO_CACHE, 'w'))
            print(f'  {i}/{len(todo)}', file=sys.stderr)
        time.sleep(1.1)
    json.dump(cache, open(GEO_CACHE, 'w'))
    return cache

LEAGUE_DEFS = {
    'usl2':  {'label': 'USL League Two', 'color': '#4FA3A5', 'sex': 'm', 'url': 'https://www.uslleaguetwo.com'},
    'uslwl': {'label': 'USL W League', 'color': '#D98BA6', 'sex': 'w', 'url': 'https://www.uslwleague.com'},
    'wpsl':  {'label': 'WPSL', 'color': '#A64D79', 'sex': 'w', 'url': 'https://wpsl.soccer'},
    'uws':   {'label': 'United Women’s Soccer', 'color': '#8A6FC9', 'sex': 'w', 'url': 'https://uwssoccer.com'},
}
SOURCES = {
    'usl2':  {'article': 'USL League Two', 'standings': 'Template:2026 USL League Two group tables', 'base': 1500, 'mult': 3.2},
    'uslwl': {'article': 'USL W League', 'standings': 'Template:2026 USL W League group tables', 'base': 1500, 'mult': 3.2},
    'wpsl':  {'article': "Women's Premier Soccer League", 'standings': '2026 WPSL season', 'base': 1490, 'mult': 3.2},
    'uws':   {'article': "United Women's Soccer", 'standings': None, 'base': 1500, 'mult': 3.2},
}

def main():
    dpath = os.path.join(ROOT, 'js', 'data.js')
    cur = open(dpath).read()
    clubs = json.loads(re.search(r'export const CLUBS=(\[.*?\]);', cur, re.S).group(1))
    existing = {(norm(c['n']), c['x']) for c in clubs}

    all_new, report = [], {}
    import sys as _sys
    only = set(_sys.argv[1].split(',')) if len(_sys.argv) > 1 else None
    for g, srcmeta in SOURCES.items():
        if only and g not in only: continue
        teams = teams_from_article(srcmeta['article'])
        time.sleep(1)
        st_rows = standings_rows(wikitext(srcmeta['standings'])) if srcmeta['standings'] else []
        time.sleep(1)
        by_norm = {norm(r['name']): r for r in st_rows}
        sex = LEAGUE_DEFS[g]['sex']
        added = rated = skipped = 0
        for t in teams:
            if t['st'] in EXCLUDE_ST: skipped += 1; continue
            key = (norm(t['name']), sex)
            if key in existing: skipped += 1; continue
            row = by_norm.get(norm(t['name']))
            club = {'n': t['name'], 'g': g, 'x': sex, 'st': t['st'] or '??', 'city': t['city']}
            if row:
                r = srcmeta['base'] + row['pts'] * srcmeta['mult'] + row['gd']
                club['r'] = int(max(1420, min(1780, r))); club['rr'] = 2
                rated += 1
            else:
                seed = sum(ord(ch) * (i + 7) for i, ch in enumerate(t['name']))
                club['r'] = 1470 + seed % 160
            all_new.append(club); existing.add(key); added += 1
        report[g] = (added, rated, skipped, len(st_rows))
        print(f'{g}: +{added} clubs ({rated} standings-rated of {len(st_rows)} standings rows; {skipped} skipped)', file=sys.stderr)

    # geocode
    queries = sorted({c['city'] for c in all_new})
    cache = geocode_all(queries)
    dropped = 0
    final = []
    for c in all_new:
        ll = cache.get(c.pop('city'))
        if not ll: dropped += 1; continue
        c['la'], c['lo'] = ll
        if c['st'] == '??': c['st'] = ''
        final.append(c)
    print(f'geocoded {len(final)}, dropped {dropped} (no coords)', file=sys.stderr)

    clubs.extend(final)
    leagues = json.loads(re.search(r'export const LEAGUES=(\{.*?\});', cur, re.S).group(1))
    for g, d in LEAGUE_DEFS.items():
        if g not in leagues: leagues[g] = d
    write_clubs(clubs, cur)
    print(f'data.js: now {len(clubs)} clubs', file=sys.stderr)

if __name__ == '__main__':
    main()
