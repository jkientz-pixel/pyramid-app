#!/usr/bin/env python3
"""Regional league directory ingest — SWPL + Mountain Premier League.

Both run on sportzstudio. SWPL lists teams per conference subdomain
(<conf>.swplsoccer.com/teams: .sectionHeader division + .teamItem name/logo);
MPL exposes teams via its standings tables (mountainpremierleague.com/
standings) with logo imgs per row.

Directory ingest only: club name, division, league-site logo, and a location
per the APSL precedent — settlement-geocode the place token in the club name
constrained to the conference's states; unresolved clubs sit at the
conference anchor with acc='a' (~approx in tooltips). No ratings yet —
standings-based ratings are a follow-up (rr stays absent, clubs render
unrated like other directory clubs).

Clubs whose normalized name already exists in ANY layer are skipped and
logged (several SoCal sides also play UPSL) — no dupes, no migrations.

Outputs: clubs appended to js/data.js (g=swpl / g=mpl), crests to
crests/<g>-<id>.png, skip/fallback log to data/regionals_report.json.
"""
import json, os, re, sys, time, unicodedata, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _datajs import load_clubs, write_clubs
from bs4 import BeautifulSoup

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = {'User-Agent': 'RankXI/1.0 (jkientz@gmail.com; league ingest)'}
GEO_CACHE = os.path.join(ROOT, 'data', 'geocache.json')

# SWPL conference subdomain -> (states, anchor city)
SWPL_CONFS = {
    'arizona':      (['AZ'], ('Phoenix', 'AZ')),
    'centralvalley': (['CA'], ('Fresno', 'CA')),
    'nevada':       (['NV'], ('Las Vegas', 'NV')),
    'pacific':      (['CA'], ('San Jose', 'CA')),
    'sandiego':     (['CA'], ('San Diego', 'CA')),
    'socal':        (['CA'], ('Los Angeles', 'CA')),
}
MPL_STATES = (['CO', 'UT', 'ID', 'WY', 'NM'], ('Denver', 'CO'))

STATE_NAMES = {'AZ': 'Arizona', 'CA': 'California', 'NV': 'Nevada', 'CO': 'Colorado',
               'UT': 'Utah', 'ID': 'Idaho', 'WY': 'Wyoming', 'NM': 'New Mexico'}

NAME_NOISE = re.compile(
    r"\b(fc|sc|cf|afc|ac|cd|club|united|city|soccer|celtic|athletic|atletico|real|"
    r"deportivo|inter|internationals?|rovers|rangers|wanderers|dynamo|union|premier|"
    r"legends?|toros|pumas|dragons|men'?s?|women'?s?|reserves?|academy|ii|iii|u\d+|[0-9]+)\b", re.I)


def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30).read()


def deacc(x):
    return unicodedata.normalize('NFKD', x).encode('ascii', 'ignore').decode()


def norm(n):
    return re.sub(r'[^a-z0-9]', '', re.sub(NAME_NOISE, '', deacc(n).lower()))


def slugify(n):
    return re.sub(r'-+', '-', re.sub(r'[^a-z0-9]+', '-', deacc(n).lower())).strip('-')


def load_geo():
    try:
        return json.load(open(GEO_CACHE))
    except Exception:
        return {}


def geocode(place, states, cache):
    """Settlement-geocode a place name constrained to given states."""
    for st in states:
        key = f'{place}|{st}'
        if key in cache:
            return tuple(cache[key]) if cache[key] else None
        url = 'https://nominatim.openstreetmap.org/search?' + urllib.parse.urlencode(
            {'q': f'{place}, {STATE_NAMES[st]}, USA', 'format': 'json', 'limit': 1,
             'featureType': 'settlement'})
        try:
            r = json.loads(get(url))
        except Exception:
            r = []
        time.sleep(1.1)
        if r:
            ll = (round(float(r[0]['lat']), 3), round(float(r[0]['lon']), 3))
            cache[key] = ll
            return ll
        cache[key] = None
    return None


def place_token(name):
    """Leading place-ish words of a club name once noise words are stripped."""
    t = re.sub(NAME_NOISE, ' ', deacc(name))
    t = re.sub(r'\s+', ' ', t).strip()
    return t or None


def fetch_swpl():
    """[(division, team, logo_url, conf_key)] across every conference site."""
    out = []
    for conf in SWPL_CONFS:
        try:
            soup = BeautifulSoup(get(f'https://{conf}.swplsoccer.com/teams'), 'html.parser')
        except Exception as e:
            print(f'swpl/{conf}: fetch failed ({e})', file=sys.stderr)
            continue
        for cont in soup.select('.conferenceContainer'):
            hdr = cont.select_one('.sectionHeader')
            div = hdr.get_text(strip=True) if hdr else conf
            for item in cont.select('.teamItem'):
                nm = item.select_one('.teamName')
                logo = item.select_one('.teamLogo')
                if not nm:
                    continue
                url = ''
                if logo and logo.get('style'):
                    m = re.search(r'url\((.*?)\)', logo['style'])
                    if m:
                        url = m.group(1).strip("'\"")
                        if url.startswith('//'):
                            url = 'https:' + url
                out.append((div, nm.get_text(strip=True), url, conf))
        time.sleep(0.7)
    return out


def fetch_mpl():
    """[(division, team, logo_url, 'mpl')] from the standings tables."""
    soup = BeautifulSoup(get('https://www.mountainpremierleague.com/standings'), 'html.parser')
    out = []
    div = 'Mountain Premier League'
    for el in soup.find_all(['h1', 'h2', 'h3', 'h4', 'tr']):
        if el.name != 'tr':
            t = el.get_text(strip=True)
            if t and len(t) < 60:
                div = t
            continue
        tds = el.find_all('td')
        if len(tds) < 4:
            continue
        name = tds[2].get_text(strip=True) if len(tds) > 2 else ''
        if not name or name.upper().startswith('TEAM'):
            continue
        img = el.find('img')
        url = img['src'] if img and img.get('src') else ''
        if url.startswith('//'):
            url = 'https:' + url
        out.append((div, name, url, 'mpl'))
    return out


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
        # normalize to png + sane size via sips (macOS) — best-effort
        os.system(f'sips -s format png "{dest}" --out "{dest}" >/dev/null 2>&1; '
                  f'sips -Z 256 "{dest}" >/dev/null 2>&1')
        return rel
    except Exception:
        return None


def main():
    clubs = load_clubs()
    existing_norm = {norm(c['n']) for c in clubs}
    ids = {c['id'] for c in clubs}
    geo = load_geo()
    report = {'skipped_existing': [], 'anchor_fallback': [], 'added': 0}

    jobs = [('swpl', fetch_swpl(), SWPL_CONFS), ('mpl', fetch_mpl(), None)]
    for g, rows, confs in jobs:
        seen = set()
        for div, name, logo, conf in rows:
            nn = norm(name)
            if not nn or nn in seen:
                continue
            seen.add(nn)
            if nn in existing_norm:
                report['skipped_existing'].append(f'{g}: {name}')
                continue
            states, anchor = (confs[conf] if confs else MPL_STATES)
            ll, ct, st, approx = None, None, None, False
            tok = place_token(name)
            if tok:
                words = tok.split()
                # try the longest leading run first: 'Santa Clara Sporting'
                # -> 'Santa Clara Sporting', 'Santa Clara', 'Santa'
                for k in range(len(words), 0, -1):
                    cand = ' '.join(words[:k])
                    ll = geocode(cand, states, geo)
                    if ll:
                        ct, st = cand, next(s for s in states if f'{cand}|{s}' in geo and geo[f'{cand}|{s}'])
                        break
            if not ll:
                ct, st = anchor
                ll = geocode(ct, [st], geo)
                approx = True
                report['anchor_fallback'].append(f'{g}: {name} -> {ct} {st}')
            if not ll:
                continue
            cid = slugify(name)
            if cid in ids:
                cid = f'{cid}-{g}'
                if cid in ids:
                    continue
            club = {'n': name, 'g': g, 'x': 'm', 'la': ll[0], 'lo': ll[1],
                    'st': st, 'ct': ct.title(), 'id': cid, 'dv': div}
            if approx:
                club['acc'] = 'a'
            img = crest_path(g, cid, logo)
            if img:
                club['img'] = img
            clubs.append(club)
            ids.add(cid)
            existing_norm.add(nn)
            report['added'] += 1
        print(f'{g}: rows {len(rows)}, total added so far {report["added"]}')

    json.dump(geo, open(GEO_CACHE, 'w'))
    json.dump(report, open(os.path.join(ROOT, 'data', 'regionals_report.json'), 'w'), indent=1)
    write_clubs(clubs)
    print(f"added {report['added']}, skipped-existing {len(report['skipped_existing'])}, "
          f"anchor-fallback {len(report['anchor_fallback'])}")


if __name__ == '__main__':
    main()
