#!/usr/bin/env python3
"""Extract official club social accounts ({{Twitter}}/{{Instagram}} templates)
from Wikipedia club articles into js/data.js (six/sx fields) for clubs with articles."""
import json, re, urllib.request, urllib.parse, time, os, sys

UA = {'User-Agent': 'RankXI/0.1 (jkientz@gmail.com; club socials)'}
TITLES = {'LAFC': 'Los Angeles FC', 'DC United': 'D.C. United',
          'St. Louis City': 'St. Louis City SC', 'CF Montreal': 'CF Montréal',
          'NYCFC': 'New York City FC'}

def wikitext(title):
    url = 'https://en.wikipedia.org/w/api.php?' + urllib.parse.urlencode(
        {'action': 'parse', 'page': title, 'prop': 'wikitext', 'redirects': 1, 'format': 'json'})
    for _ in range(3):
        try:
            r = json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20))
            if 'error' in r: return None
            return r['parse']['wikitext']['*']
        except Exception as e:
            if '429' in str(e): time.sleep(12); continue
            return None
    return None

def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    dpath = os.path.join(root, 'js', 'data.js')
    cur = open(dpath).read()
    clubs = json.loads(re.search(r'export const CLUBS=(\[.*?\]);', cur, re.S).group(1))
    got = 0
    for c in clubs:
        if c['g'] not in ('mls', 'uslc', 'usl1', 'nwsl', 'uslw', 'mnp'): continue
        if c.get('si') or c.get('sx'): continue
        text = wikitext(TITLES.get(c['n'], c['n']))
        time.sleep(1.0)
        if not text: continue
        tw = re.search(r'\{\{\s*Twitter\s*\|\s*(?:id\s*=\s*)?([^}|]+)', text, re.I)
        ig = re.search(r'\{\{\s*Instagram\s*\|\s*(?:id\s*=\s*)?([^}|]+)', text, re.I)
        if tw: c['sx'] = 'https://x.com/' + tw.group(1).strip()
        if ig: c['si'] = 'https://www.instagram.com/' + ig.group(1).strip()
        if tw or ig:
            got += 1
            print(f'{c["n"]}: {"IG " if ig else ""}{"X" if tw else ""}')
    cur = cur[:cur.index('export const CLUBS=')] + 'export const CLUBS=' + \
        json.dumps(clubs, ensure_ascii=False, separators=(',', ':')) + ';\n' + \
        cur[cur.index('export const REGIONS='):]
    open(dpath, 'w').write(cur)
    print(f'club socials found: {got}')

if __name__ == '__main__':
    main()
