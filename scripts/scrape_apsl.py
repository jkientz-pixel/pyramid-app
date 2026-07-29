#!/usr/bin/env python3
"""Add the APSL (American Premier Soccer League) layer — apslsoccer.com (Teampass).

Teams page gives conference -> clubs + logos + team ids; Tables page gives
2025/26 standings (server-rendered HTML). Mid-Atlantic runs Fall + Spring
splits, so standings aggregate per club across every table it appears in.

Ratings are affine-mapped onto the UPSL band: the Open Cup offset fit puts
the 'regional' bucket (where APSL cup entrants land) at -532.0 vs UPSL's
-536.1, i.e. the same stratum, so league mean pins to UPSL's mean and the
champion lands just under UPSL's ceiling. rr=2 (real standings); clubs with
<4 matches stay illustrative.

Locations: no city on the site, so settlement-geocode the place token in the
club name constrained to the conference's states; clubs that don't resolve
sit at the conference anchor city with acc='a' (~approx in tooltips).
"""
from _datajs import load_clubs, write_clubs
import json, os, re, sys, time, unicodedata, urllib.parse, urllib.request
from bs4 import BeautifulSoup

UA = {'User-Agent': 'RankXI/1.0 (jkientz@gmail.com; league ingest)'}
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = 'https://www.apslsoccer.com'
GEO_CACHE = os.path.join(ROOT, 'data', 'geocache.json')

STATE_NAMES = {'CT': 'Connecticut', 'NJ': 'New Jersey', 'PA': 'Pennsylvania', 'MA': 'Massachusetts',
               'NY': 'New York', 'MD': 'Maryland', 'VA': 'Virginia', 'DC': 'District of Columbia',
               'MI': 'Michigan', 'GA': 'Georgia', 'TX': 'Texas'}

# conference -> (candidate states in priority order, anchor city for unresolved clubs)
CONFS = {
    'Constitution':   (['CT'], ('Hartford', 'CT')),
    'Delaware River': (['PA', 'NJ'], ('Philadelphia', 'PA')),
    'Mayflower':      (['MA'], ('Boston', 'MA')),
    'Metropolitan':   (['NY', 'NJ'], ('New York', 'NY')),
    'Mid-Atlantic':   (['MD', 'VA', 'DC'], ('Washington', 'DC')),
    'Mitten':         (['MI'], ('Detroit', 'MI')),
    'Terminus':       (['GA'], ('Atlanta', 'GA')),
    'Trinity':        (['TX'], ('Dallas', 'TX')),
}

# clubs whose home city is known but not derivable from the name
CITY_OVERRIDES = {
    'NY Greek Americans': ('Astoria', 'NY'),
    'NY Pancyprian Freedoms': ('Queens', 'NY'),
    'Lansdowne Yonkers FC': ('Yonkers', 'NY'),
    'Christos FC': ('Baltimore', 'MD'),
    'Christos FC II': ('Baltimore', 'MD'),
    'WC Predators': ('West Chester', 'PA'),
    'SC Vistula Garfield': ('Garfield', 'NJ'),
    'Hoboken FC 1912': ('Hoboken', 'NJ'),
    'Oaklyn United FC': ('Oaklyn', 'NJ'),
    'Jersey Shore Boca': ('Toms River', 'NJ'),
    'Medford Strikers': ('Medford', 'NJ'),
    'Sewell Old Boys FC': ('Sewell', 'NJ'),
    'Real Central NJ Soccer': ('Trenton', 'NJ'),
    'Georgia United FC': ('Atlanta', 'GA'),
    'Delmarva Thunder': ('Salisbury', 'MD'),
    'PW Nova': ('Woodbridge', 'VA'),
    'Zum Schneider FC 03': ('Manhattan, New York', 'NY'),
}

# same club already in the app as an unrated placeholder in another layer ->
# move it to apsl in place (precedent: 'move 17 clubs to usl2', 6220d23)
MIGRATE = {'Foro SC': 'loc', 'Nova FC': 'upsl', 'Baltimore City FC': 'upsl'}
# first team genuinely plays elsewhere; APSL entry is not canonical
SKIP_CANON = {'Christos FC'}

NAME_NOISE = re.compile(r'\b(fc|sc|cf|afc|ac|cd|club|united|city|soccer|celtic|athletic|internationals?|'
                        r'elites?|academy|select|premier|old boyz|ii|1927|2000)\b', re.I)

def deacc(x): return unicodedata.normalize('NFKD', x).encode('ascii', 'ignore').decode()
def norm(n): return re.sub(r'\b(fc|sc|cf|afc|cd|club|the)\b', '', deacc(n).lower()).replace(' ', '').replace('.', '').replace("'", '')
def slug(n): return re.sub(r'[^a-z0-9]+', '-', deacc(n).lower()).strip('-')

def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read()

def conf_key(label):
    for k in CONFS:
        if k.lower() in (label or '').lower(): return k
    return None

def parse_teams():
    doc = BeautifulSoup(get(BASE + '/APSL/Teams/').decode(), 'html.parser')
    out = []
    for div in doc.find_all('div', class_='division'):
        h2 = div.find('h2')
        ck = conf_key(h2.get_text(' ', strip=True) if h2 else '')
        if not ck: continue
        for btn in div.find_all('button'):
            m = re.search(r"/APSL/Team/(\d+)", btn.get('onclick') or '')
            nm_div = btn.find('div', title=True)
            name = (nm_div['title'] if nm_div else '').strip()
            if not name or not m: continue
            img = btn.find('img')
            out.append({'name': name, 'conf': ck, 'tid': m.group(1),
                        'logo': (img['src'] if img and img.get('src') else None)})
    seen, dedup = set(), []
    for t in out:
        if norm(t['name']) in seen: continue
        seen.add(norm(t['name'])); dedup.append(t)
    return dedup

def parse_tables():
    doc = BeautifulSoup(get(BASE + '/APSL/Tables/').decode(), 'html.parser')
    agg = {}
    for div in doc.find_all('div', class_='leagueAccordbox'):
        sib = div.find_previous_sibling()
        label = sib.get_text(' ', strip=True) if sib else ''
        if 'cup' in label.lower(): continue
        for tb in div.find_all('table'):
            hdr = None
            for tr in tb.find_all('tr'):
                cells = [td.get_text(' ', strip=True) for td in tr.find_all(['th', 'td'])]
                if not cells: continue
                if hdr is None and 'Team' in cells: hdr = cells; continue
                if not hdr or len(cells) < len(hdr) - 1: continue
                row = dict(zip(hdr, cells))
                try:
                    mp, w, d, l = int(row['MP']), int(row['W']), int(row['D']), int(row['L'])
                    gf, ga = int(row['GF']), int(row['GA'])
                except (KeyError, ValueError):
                    continue
                k = norm(row['Team'])
                a = agg.setdefault(k, {'name': row['Team'], 'mp': 0, 'w': 0, 'd': 0, 'l': 0, 'gf': 0, 'ga': 0})
                a['mp'] += mp; a['w'] += w; a['d'] += d; a['l'] += l; a['gf'] += gf; a['ga'] += ga
    return agg

def geocode(q, cache):
    if q in cache: return cache[q]
    url = 'https://nominatim.openstreetmap.org/search?' + urllib.parse.urlencode(
        {'q': q, 'format': 'json', 'limit': 1, 'featureType': 'settlement'})
    try:
        r = json.loads(get(url))
        cache[q] = [round(float(r[0]['lat']), 4), round(float(r[0]['lon']), 4)] if r else None
    except Exception:
        cache[q] = None
    time.sleep(1.1)
    return cache[q]

def locate(team, cache):
    states, anchor = CONFS[team['conf']]
    ov = CITY_OVERRIDES.get(team['name'])
    if ov:
        ll = geocode(f'{ov[0]}, {STATE_NAMES[ov[1]]}, USA', cache)
        if ll: return ll, ov[1], None
    place = NAME_NOISE.sub(' ', deacc(team['name']))
    place = re.sub(r'\s+', ' ', place).strip()
    if len(place) >= 3:
        for st in states:
            ll = geocode(f'{place}, {STATE_NAMES[st]}, USA', cache)
            if ll: return ll, st, None
    ll = geocode(f'{anchor[0]}, {STATE_NAMES[anchor[1]]}, USA', cache)
    if not ll: return None, None, None
    j = sum(ord(c) * (i + 3) for i, c in enumerate(team['name']))
    return [round(ll[0] + ((j % 9) - 4) * .01, 4), round(ll[1] + ((j // 9 % 9) - 4) * .01, 4)], anchor[1], 'a'

def fetch_crest(team, sl):
    if not team['logo']: return None
    fn = f'crests/apsl-{sl}.png'
    path = os.path.join(ROOT, fn)
    if os.path.exists(path): return fn
    try:
        blob = get(BASE + urllib.parse.quote(team['logo']) if team['logo'].startswith('/') else team['logo'])
        if not blob: return None
        tmp = os.path.join(ROOT, 'crests', '_raw_tmp')
        open(tmp, 'wb').write(blob)
        import subprocess
        subprocess.run(['sips', '-s', 'format', 'png', '-Z', '128', tmp, '--out', path], capture_output=True)
        os.remove(tmp)
        return fn if os.path.exists(path) and os.path.getsize(path) > 500 else None
    except Exception:
        return None

def main():
    dry = '--dry-run' in sys.argv
    teams = parse_teams()
    standings = parse_tables()
    print(f'{len(teams)} clubs on Teams page, {len(standings)} standings rows (aggregated)', file=sys.stderr)
    os.makedirs(os.path.join(ROOT, 'data'), exist_ok=True)
    json.dump({'fetched': '2026-07-28', 'season': '2025/26', 'teams': teams,
               'standings': {k: v for k, v in sorted(standings.items())}},
              open(os.path.join(ROOT, 'data', 'apsl.json'), 'w'), indent=1)

    src = open(os.path.join(ROOT, 'js', 'data.js')).read()
    clubs = load_clubs(src)
    existing_names = {(norm(c['n']), c['x']) for c in clubs}
    existing_ids = {c.get('id') for c in clubs}

    rated = []
    for t in teams:
        s = standings.get(norm(t['name']))
        if s and s['mp'] >= 4:
            ppg = 3 * s['w'] + s['d']; ppg /= s['mp']
            gdpg = (s['gf'] - s['ga']) / s['mp']
            t['raw'] = ppg * 100 + gdpg * 12
            rated.append(t['raw'])
    mean_raw = sum(rated) / len(rated)
    top_raw = max(rated)
    scale = (1525 - 1350) / (top_raw - mean_raw) if top_raw > mean_raw else 1.0

    cache = json.load(open(GEO_CACHE)) if os.path.exists(GEO_CACHE) else {}
    by_norm_league = {(norm(c['n']), c['g']): c for c in clubs}
    new, skipped, migrated = [], [], []
    for t in teams:
        if t['name'] in SKIP_CANON or (norm(t['name']), 'apsl') in by_norm_league:
            skipped.append(t['name']); continue
        if t['name'] in MIGRATE:
            c = by_norm_league.get((norm(t['name']), MIGRATE[t['name']]))
            if c:
                c['g'] = 'apsl'; c['url'] = f'{BASE}/APSL/Team/{t["tid"]}'
                if 'raw' in t:
                    c['r'] = int(max(1275, min(1530, round(1350 + (t['raw'] - mean_raw) * scale))))
                    c['rr'] = 2
                if not dry:
                    crest = fetch_crest(t, slug(t['name']))
                    if crest and not c.get('img'): c['img'] = crest
                migrated.append(c['n']); continue
        ll, st, acc = locate(t, cache)
        json.dump(cache, open(GEO_CACHE, 'w'))
        if not ll:
            skipped.append(t['name'] + ' (no coords)'); continue
        sl = slug(t['name'])
        if sl in existing_ids: sl += '-apsl'
        c = {'n': t['name'], 'g': 'apsl', 'x': 'm', 'la': ll[0], 'lo': ll[1], 'st': st,
             'id': sl, 'url': f'{BASE}/APSL/Team/{t["tid"]}'}
        if acc: c['acc'] = acc
        if 'raw' in t:
            c['r'] = int(max(1275, min(1530, round(1350 + (t['raw'] - mean_raw) * scale))))
            c['rr'] = 2
        else:
            seed = sum(ord(ch) * (i + 7) for i, ch in enumerate(t['name']))
            c['r'] = 1310 + seed % 70
        crest = None if dry else fetch_crest(t, sl)
        if crest: c['img'] = crest
        existing_ids.add(sl)
        new.append(c)

    n_rated = sum(1 for c in new if c.get('rr'))
    n_approx = sum(1 for c in new if c.get('acc') == 'a')
    print(f'+{len(new)} clubs ({n_rated} standings-rated, {n_approx} approx-located); '
          f'migrated to apsl: {migrated}; skipped: {skipped}', file=sys.stderr)
    if dry:
        for c in new: print(c)
        return

    clubs.extend(new)
    leagues = json.loads(re.search(r'export const LEAGUES=(\{.*?\});', src, re.S).group(1))
    leagues.setdefault('apsl', {'label': 'APSL', 'color': '#8E3B46', 'sex': 'm', 'url': BASE})
    body = 'export const LEAGUES=' + json.dumps(leagues, ensure_ascii=False, separators=(',', ':')) + ';'
    src2, n = re.subn(r'export const LEAGUES=\{.*?\};', lambda m: body, src, count=1, flags=re.S)
    if n != 1: sys.exit('FATAL: LEAGUES marker not replaced')
    write_clubs(clubs, src2)

if __name__ == '__main__':
    main()
