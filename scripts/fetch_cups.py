#!/usr/bin/env python3
"""Fetch historical champions for professional/open US tournaments from
Wikipedia into data/cups.json: US Open Cup, MLS Cup, Supporters' Shield,
NWSL Championship."""
import json, re, urllib.request, urllib.parse, time, os, sys, html

UA = {'User-Agent': 'RankXI/0.1 (jkientz@gmail.com; tournament history)'}
CUPS = [
    {'key': 'opencup', 'title': 'List of U.S. Open Cup finals', 'label': 'U.S. Open Cup', 'kind': 'open'},
    {'key': 'mlscup', 'title': 'MLS Cup', 'label': 'MLS Cup', 'kind': 'pro'},
    {'key': 'shield', 'title': "Supporters' Shield", 'label': "Supporters' Shield", 'kind': 'pro'},
    {'key': 'nwsl', 'title': 'NWSL Championship', 'label': 'NWSL Championship', 'kind': 'pro'},
]

def api_html(title):
    url = 'https://en.wikipedia.org/w/api.php?' + urllib.parse.urlencode(
        {'action': 'parse', 'page': title, 'prop': 'text', 'redirects': 1, 'format': 'json'})
    for _ in range(3):
        try:
            r = json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=25))
            if 'error' in r: return None
            return r['parse']['text']['*']
        except Exception as e:
            if '429' in str(e): time.sleep(12); continue
            return None
    return None

def clean(c): return html.unescape(re.sub(r'<[^>]+>', '', c)).strip()

def parse_finals(page):
    rows_out = []
    for tbl in re.findall(r'<table[^>]*wikitable[^>]*>(.*?)</table>', page, re.S):
        h = None
        for tr in re.findall(r'<tr[^>]*>(.*?)</tr>', tbl, re.S)[:3]:
            cand = [clean(x).lower() for x in re.findall(r'<th[^>]*>(.*?)</th>', tr, re.S)]
            if len(cand) >= 3: h = cand; break
        if not h or not any(k in x for x in h for k in ('year', 'season', 'edition', 'date')): continue
        if not any('winn' in x or 'champion' in x for x in h): continue
        for row in re.findall(r'<tr[^>]*>(.*?)</tr>', tbl, re.S)[1:]:
            cells = re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', row, re.S)
            if len(cells) < 2: continue
            ym = None
            for c2 in cells[:3]:
                ym = re.search(r'(19|20)\d\d', clean(c2))
                if ym: break
            if not ym: continue
            year = ym.group(0)
            links = re.findall(r'<a href="/wiki/[^"#]+"[^>]*>([^<]+)</a>', row)
            links = [l for l in links if not re.match(r'^\d', l) and len(l) > 3 and 'final' not in l.lower()]
            if not links: continue
            winner = links[0]
            runner = links[1] if len(links) > 1 else None
            score = next((clean(c2) for c2 in cells if re.match(r'^\d+[–\-]\d+', clean(c2))), None)
            rows_out.append({'y': year, 'w': winner, 'ru': runner, 's': score})
    dedup = {}
    for r in rows_out:
        if r['y'] not in dedup: dedup[r['y']] = r
    return sorted(dedup.values(), key=lambda r: -int(r['y']))

def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = {}
    for cup in CUPS:
        page = api_html(cup['title'])
        time.sleep(1.2)
        if not page:
            print(f"{cup['label']}: page missing", file=sys.stderr); continue
        finals = parse_finals(page)
        if len(finals) >= 5:
            out[cup['key']] = {'label': cup['label'], 'kind': cup['kind'], 'finals': finals}
            print(f"{cup['label']}: {len(finals)} editions, latest {finals[0]['y']}: {finals[0]['w']}")
        else:
            print(f"{cup['label']}: only {len(finals)} parsed", file=sys.stderr)
    json.dump(out, open(os.path.join(root, 'data', 'cups.json'), 'w'),
              ensure_ascii=False, separators=(',', ':'))
    print(f"wrote data/cups.json: {len(out)} tournaments")

if __name__ == '__main__':
    main()
