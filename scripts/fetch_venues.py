#!/usr/bin/env python3
"""Set exact stadium coordinates for pro clubs from Wikidata:
club item -> P115 (home venue) -> venue P625 (coordinates)."""
import json, re, urllib.request, urllib.parse, time, os

UA = {'User-Agent': 'RankXI/0.1 (jkientz@gmail.com; venue coordinates)'}
TITLES = {'LAFC': 'Los Angeles FC', 'DC United': 'D.C. United',
          'St. Louis City': 'St. Louis City SC', 'CF Montreal': 'CF Montréal',
          'NYCFC': 'New York City FC'}

def api(host, params):
    url = f'https://{host}/w/api.php?' + urllib.parse.urlencode(params)
    for _ in range(3):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=25))
        except Exception as e:
            if '429' in str(e): time.sleep(12); continue
            return None
    return None

def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    dpath = os.path.join(root, 'js', 'data.js')
    cur = open(dpath).read()
    clubs = json.loads(re.search(r'export const CLUBS=(\[.*?\]);', cur, re.S).group(1))
    targets = [c for c in clubs if c['g'] in ('mls', 'uslc', 'usl1', 'nwsl', 'uslw', 'nisa')]
    titles = {c['n']: TITLES.get(c['n'], c['n']) for c in targets}
    t2q = {}
    tl = list(titles.values())
    for i in range(0, len(tl), 50):
        r = api('en.wikipedia.org', {'action': 'query', 'titles': '|'.join(tl[i:i+50]),
                'prop': 'pageprops', 'ppprop': 'wikibase_item', 'redirects': 1, 'format': 'json'})
        if not r: continue
        redir = {x['to']: x['from'] for x in r['query'].get('redirects', [])}
        for pg in r['query']['pages'].values():
            t, q = pg.get('title'), pg.get('pageprops', {}).get('wikibase_item')
            if t and q: t2q[redir.get(t, t)] = q; t2q[t] = q
        time.sleep(0.8)
    club_q = {n: t2q.get(t) for n, t in titles.items() if t2q.get(t)}
    venues = {}
    ql = list(set(club_q.values()))
    for i in range(0, len(ql), 50):
        r = api('www.wikidata.org', {'action': 'wbgetentities', 'ids': '|'.join(ql[i:i+50]),
                'props': 'claims', 'format': 'json'})
        if not r: continue
        for q, ent in r.get('entities', {}).items():
            try:
                venues[q] = ent['claims']['P115'][0]['mainsnak']['datavalue']['value']['id']
            except (KeyError, TypeError, IndexError):
                pass
        time.sleep(0.8)
    coords = {}
    vl = list(set(venues.values()))
    for i in range(0, len(vl), 50):
        r = api('www.wikidata.org', {'action': 'wbgetentities', 'ids': '|'.join(vl[i:i+50]),
                'props': 'claims', 'format': 'json'})
        if not r: continue
        for q, ent in r.get('entities', {}).items():
            try:
                v = ent['claims']['P625'][0]['mainsnak']['datavalue']['value']
                coords[q] = (v['latitude'], v['longitude'])
            except (KeyError, TypeError, IndexError):
                pass
        time.sleep(0.8)
    fixed = 0
    for c in targets:
        q = club_q.get(c['n']); vq = venues.get(q) if q else None
        ll = coords.get(vq) if vq else None
        if ll and 20 < ll[0] < 55 and -130 < ll[1] < -60:
            c['la'] = round(ll[0], 4); c['lo'] = round(ll[1], 4); c['acc'] = 'v'
            fixed += 1
    print(f'stadium-exact coordinates set: {fixed} of {len(targets)}')
    cur = cur[:cur.index('export const CLUBS=')] + 'export const CLUBS=' + \
        json.dumps(clubs, ensure_ascii=False, separators=(',', ':')) + ';\n' + \
        cur[cur.index('export const REGIONS='):]
    open(dpath, 'w').write(cur)

if __name__ == '__main__':
    main()
