#!/usr/bin/env python3
"""Fetch all-time player lists for MLS clubs from Wikipedia into
data/legends.json. Resolves article titles via search; handles both
single-row headers (Apps/Goals columns) and two-row colspan headers
(Player | Total | per-competition)."""
import json, re, urllib.request, urllib.parse, time, os, sys, html

UA = {'User-Agent': 'RankXI/0.1 (jkientz@gmail.com; club legends)'}
TITLES = {
    'LAFC': 'Los Angeles FC', 'DC United': 'D.C. United',
    'St. Louis City': 'St. Louis City SC', 'CF Montreal': 'CF Montreal',
    'NYCFC': 'New York City FC',
}

def api(params):
    url = 'https://en.wikipedia.org/w/api.php?' + urllib.parse.urlencode(params)
    for _ in range(3):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=25))
        except Exception as e:
            if '429' in str(e): time.sleep(12); continue
            return None
    return None

def page_html(title):
    r = api({'action': 'parse', 'page': title, 'prop': 'text', 'redirects': 1, 'format': 'json'})
    if not r or 'error' in r: return None
    return r['parse']['text']['*']

def clean(c): return html.unescape(re.sub(r'<[^>]+>', '', c)).strip()

def flat_header(trs):
    r1 = re.findall(r'<th([^>]*)>(.*?)</th>', trs[0], re.S)
    if not r1: return None, False
    sub = re.findall(r'<th[^>]*>(.*?)</th>', trs[1], re.S) if len(trs) > 1 else []
    flat, si = [], 0
    for attrs, label in r1:
        lab = clean(label).lower()
        cm = re.search(r'colspan="?(\d+)', attrs)
        span = int(cm.group(1)) if cm else 1
        if span == 1:
            flat.append(lab)
        else:
            for _ in range(span):
                sl = clean(sub[si]).lower() if si < len(sub) else ''
                flat.append(lab + '/' + sl)
                si += 1
    return flat, si > 0

def parse_players(page):
    out = []
    for tbl in re.findall(r'<table[^>]*wikitable[^>]*>(.*?)</table>', page, re.S):
        trs = re.findall(r'<tr[^>]*>(.*?)</tr>', tbl, re.S)
        if len(trs) < 3: continue
        flat, two_row = flat_header(trs)
        if not flat: continue
        def find(word, prefer_total):
            idxs = [i for i, hh in enumerate(flat) if word in hh]
            if not idxs: return None
            if prefer_total:
                tot = [i for i in idxs if 'total' in flat[i]]
                if tot: return tot[0]
            return idxs[0]
        iapp = find('app', True)
        if iapp is None: iapp = find('game', True)
        igoal = find('goal', True)
        if iapp is None or igoal is None: continue
        ipos = find('pos', False)
        iyrs = find('year', False)
        if iyrs is None: iyrs = find('career', False)
        body = trs[2:] if two_row else trs[1:]
        for row in body:
            cells = re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', row, re.S)
            if len(cells) <= max(iapp, igoal): continue
            lm = re.search(r'<a href="/wiki/([^"#]+)"[^>]*>([^<]+)</a>', cells[0])
            nm = lm.group(2).strip() if lm else clean(cells[0])
            nm = re.sub(r'\[.*?\]', '', nm).strip()
            if not nm or len(nm) < 5 or nm[0].isdigit() or ' ' not in nm: continue
            wiki = ('https://en.wikipedia.org/wiki/' + lm.group(1)) if lm else None
            def num(i2):
                if i2 is None or i2 >= len(cells): return None
                m2 = re.search(r'\d+', clean(cells[i2]).replace(',', ''))
                return int(m2.group(0)) if m2 else None
            apps, goals = num(iapp), num(igoal)
            if apps is None or apps > 460: continue
            yrs = clean(cells[iyrs]) if iyrs is not None and iyrs < len(cells) else ''
            yrs = re.sub(r'[^0-9,–\- ]', '', yrs).strip()[:20]
            pos = clean(cells[ipos])[:3].upper() if ipos is not None and ipos < len(cells) else ''
            out.append({'n': nm, 'pos': pos, 'yrs': yrs, 'apps': apps, 'goals': goals or 0, 'wiki': wiki})
    seen = {}
    for p2 in out:
        if p2['n'] not in seen or p2['apps'] > seen[p2['n']]['apps']:
            seen[p2['n']] = p2
    return sorted(seen.values(), key=lambda x: -x['apps'])

def resolve_title(base):
    direct = 'List of ' + base + ' players'
    if page_html(direct): return direct
    time.sleep(1.0)
    q = api({'action': 'query', 'list': 'search',
             'srsearch': 'intitle:players ' + base, 'srlimit': 4, 'format': 'json'})
    if not q: return None
    toks = [w.lower() for w in base.split()[:2]]
    for hit in q['query']['search']:
        t2 = hit['title']
        if 'players' in t2.lower() and all(w in t2.lower() for w in toks[:1]):
            return t2
    return None

def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    data = open(os.path.join(root, 'js', 'data.js')).read()
    clubs = json.loads(re.search(r'export const CLUBS=(\[.*?\]);', data, re.S).group(1))
    legends = {}
    for c in [x for x in clubs if x['g'] == 'mls']:
        base = TITLES.get(c['n'], c['n'])
        title = resolve_title(base)
        time.sleep(1.0)
        if not title:
            print(f'{c["n"]}: no article found', file=sys.stderr); continue
        page = page_html(title)
        time.sleep(1.0)
        if not page: continue
        players = parse_players(page)
        if len(players) >= 10:
            legends[c['n']] = players[:400]
            print(f'{c["n"]}: {len(players)} players via "{title}", top: {players[0]["n"]} ({players[0]["apps"]})')
        else:
            print(f'{c["n"]}: {len(players)} parsed from "{title}" - skipped', file=sys.stderr)
    json.dump(legends, open(os.path.join(root, 'data', 'legends.json'), 'w'),
              ensure_ascii=False, separators=(',', ':'))
    print(f'wrote data/legends.json: {len(legends)} clubs')

if __name__ == '__main__':
    main()
