#!/usr/bin/env python3
"""Backfill MLS season standings 1996-2026 from Wikipedia season articles /
conference-table templates into data/mls_history.json, canonicalized to
current franchise names."""
import json, re, urllib.request, urllib.parse, time, os, sys, unicodedata

UA = {'User-Agent': 'RankXI/0.1 (jkientz@gmail.com; MLS history backfill)'}
ALIAS = {
    'kansascitywiz': 'Sporting Kansas City', 'kansascitywizards': 'Sporting Kansas City',
    'metrostars': 'New York Red Bulls', 'newyork/newjerseymetrostars': 'New York Red Bulls',
    'ny/njmetrostars': 'New York Red Bulls',
    'losangelesgalaxy': 'LA Galaxy', 'dallasburn': 'FC Dallas',
    'sanjoseclash': 'San Jose Earthquakes', 'montrealimpact': 'CF Montreal',
    'columbuscrewsc': 'Columbus Crew', 'chicagofirefc': 'Chicago Fire',
    'losangelesfc': 'LAFC', 'losangelesfootballclub': 'LAFC',
    'newyorkcityfc': 'NYCFC', 'atlantaunitedfc': 'Atlanta United',
    'minnesotaunitedfc': 'Minnesota United', 'seattlesoundersfc': 'Seattle Sounders',
    'vancouverwhitecapsfc': 'Vancouver Whitecaps', 'portlandtimbers': 'Portland Timbers',
    'realsaltlake': 'Real Salt Lake', 'd.c.united': 'DC United', 'dcunited': 'DC United',
    'st.louiscitysc': 'St. Louis City', 'charlottefc': 'Charlotte FC',
    'austinfc': 'Austin FC', 'nashvillesc': 'Nashville SC', 'intermiamicf': 'Inter Miami',
    'houstondynamofc': 'Houston Dynamo', 'houstondynamo': 'Houston Dynamo',
    'newenglandrevolution': 'New England Revolution', 'coloradorapids': 'Colorado Rapids',
    'fccincinnati': 'FC Cincinnati', 'orlandocitysc': 'Orlando City',
    'philadelphiaunion': 'Philadelphia Union', 'torontofc': 'Toronto FC',
    'sandiegofc': 'San Diego FC', 'sportingkansascity': 'Sporting Kansas City',
    'cfmontréal': 'CF Montreal',
}

def deacc(x): return unicodedata.normalize('NFKD', x).encode('ascii', 'ignore').decode()
def norm(n): return re.sub(r'[^a-z./]', '', deacc(n).lower())

def api_text(title):
    url = 'https://en.wikipedia.org/w/api.php?' + urllib.parse.urlencode(
        {'action': 'parse', 'page': title, 'prop': 'wikitext', 'redirects': 1, 'format': 'json'})
    for _ in range(3):
        try:
            r = json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20))
            return r['parse']['wikitext']['*']
        except Exception as e:
            if '429' in str(e): time.sleep(12); continue
            return None
    return None

def rows_from(text):
    codes = set(re.findall(r'\|\s*win_([A-Za-z0-9]{2,6})\s*=', text))
    out = []
    for c in codes:
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
        d = d or 0
        out.append({'name': nm, 'w': w, 'd': d, 'l': l,
                    'gf': gf, 'ga': ga, 'pts': 3 * w + d,
                    'gd': (gf - ga) if (gf is not None and ga is not None) else 0})
    return out

def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    hist = {}
    for year in range(1996, 2027):
        rows = []
        for tpl in (f'Template:{year} Major League Soccer Eastern Conference table',
                    f'Template:{year} Major League Soccer Western Conference table'):
            t = api_text(tpl)
            if t: rows += rows_from(t)
            time.sleep(0.8)
        if not rows:
            t = api_text(f'{year} Major League Soccer season')
            if t: rows = rows_from(t)
            time.sleep(0.8)
        if not rows:
            print(f'{year}: NO DATA', file=sys.stderr); continue
        seen = {}
        for r in rows: seen[r['name']] = r
        rows = list(seen.values())
        rows.sort(key=lambda r: (-r['pts'], -r['gd']))
        for i, r in enumerate(rows):
            r['pos'] = i + 1
            r['canon'] = ALIAS.get(norm(r['name']), r['name'])
        hist[year] = rows
        print(f'{year}: {len(rows)} teams, top: {rows[0]["canon"]} ({rows[0]["pts"]} pts)')
    json.dump(hist, open(os.path.join(root, 'data', 'mls_history.json'), 'w'),
              ensure_ascii=False, separators=(',', ':'))
    print(f'wrote data/mls_history.json: {len(hist)} seasons')

if __name__ == '__main__':
    main()
