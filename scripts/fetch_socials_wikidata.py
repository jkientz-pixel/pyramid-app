#!/usr/bin/env python3
"""Enrich players (data/players.json) and pro clubs (js/data.js) with official
social accounts from Wikidata (P2002 X, P2003 Instagram, P856 website)."""
import json, re, urllib.request, urllib.parse, time, os, sys

UA = {'User-Agent': 'RankXI/0.1 (jkientz@gmail.com; socials via Wikidata)'}
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

def qids_for(titles):
    out = {}
    for i in range(0, len(titles), 50):
        batch = titles[i:i+50]
        r = api('en.wikipedia.org', {'action': 'query', 'titles': '|'.join(batch),
                'prop': 'pageprops', 'ppprop': 'wikibase_item', 'redirects': 1, 'format': 'json'})
        if not r: continue
        redir = {x['to']: x['from'] for x in r['query'].get('redirects', [])}
        for pg in r['query']['pages'].values():
            t = pg.get('title'); q = pg.get('pageprops', {}).get('wikibase_item')
            if t and q:
                out[redir.get(t, t)] = q
                out[t] = q
        time.sleep(0.8)
    return out

def claims_for(qids):
    out = {}
    ql = list(set(qids))
    for i in range(0, len(ql), 50):
        batch = ql[i:i+50]
        r = api('www.wikidata.org', {'action': 'wbgetentities', 'ids': '|'.join(batch),
                'props': 'claims', 'format': 'json'})
        if not r: continue
        for q, ent in r.get('entities', {}).items():
            cl = ent.get('claims', {})
            def val(pid):
                arr = cl.get(pid)
                if not arr: return None
                try: return arr[0]['mainsnak']['datavalue']['value']
                except (KeyError, TypeError): return None
            out[q] = {'x': val('P2002'), 'ig': val('P2003'), 'site': val('P856')}
        time.sleep(0.8)
    return out

def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    # players
    profiles = json.load(open(os.path.join(root, 'data', 'players.json')))
    rosters = json.loads(re.search(r'export const ROSTERS=(\{.*?\});',
        open(os.path.join(root, 'js', 'rosters.js')).read(), re.S).group(1))
    ptitles = {}
    for club, players in rosters.items():
        for pl in players:
            if pl.get('wiki') and pl['name'] in profiles:
                ptitles[pl['name']] = urllib.parse.unquote(pl['wiki'].split('/wiki/')[-1]).replace('_', ' ')
    t2q = qids_for(list(ptitles.values()))
    claims = claims_for([q for q in t2q.values()])
    en = 0
    for nm, title in ptitles.items():
        q = t2q.get(title)
        c = claims.get(q) if q else None
        if not c: continue
        p = profiles[nm]
        if c['ig'] and not p.get('ig'): p['ig'] = 'https://www.instagram.com/' + c['ig']
        if c['x'] and not p.get('x'): p['x'] = 'https://x.com/' + c['x']
        if c['site'] and not p.get('site'): p['site'] = c['site']
        if c['ig'] or c['x']: en += 1
    json.dump(profiles, open(os.path.join(root, 'data', 'players.json'), 'w'),
              ensure_ascii=False, separators=(',', ':'))
    print(f'players with socials now: {en} of {len(ptitles)}')
    # clubs
    dpath = os.path.join(root, 'js', 'data.js')
    cur = open(dpath).read()
    clubs = json.loads(re.search(r'export const CLUBS=(\[.*?\]);', cur, re.S).group(1))
    targets = [c for c in clubs if c['g'] in ('mls', 'uslc', 'usl1', 'nwsl', 'uslw', 'mnp', 'nisa')]
    ctitles = {c['n']: TITLES.get(c['n'], c['n']) for c in targets}
    t2q2 = qids_for(list(ctitles.values()))
    claims2 = claims_for([q for q in t2q2.values()])
    cn = 0
    for c in targets:
        q = t2q2.get(ctitles[c['n']])
        cc = claims2.get(q) if q else None
        if not cc: continue
        if cc['ig']: c['si'] = 'https://www.instagram.com/' + cc['ig']
        if cc['x']: c['sx'] = 'https://x.com/' + cc['x']
        if (cc['ig'] or cc['x']): cn += 1
        if cc['site'] and not c.get('url'): c['url'] = cc['site']
    cur = cur[:cur.index('export const CLUBS=')] + 'export const CLUBS=' + \
        json.dumps(clubs, ensure_ascii=False, separators=(',', ':')) + ';\n' + \
        cur[cur.index('export const REGIONS='):]
    open(dpath, 'w').write(cur)
    print(f'clubs with socials now: {cn} of {len(targets)}')

if __name__ == '__main__':
    main()
