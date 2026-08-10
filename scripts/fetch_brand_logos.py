#!/usr/bin/env python3
"""Download broadcaster/brand logos (Wikipedia infobox images via the
pageimages API) into crests/brand-<key>.png for the where-to-watch chips.
Logos are used as nominative content identifiers linking out to each
broadcaster — the standard TV-guide use.

Usage: python3 scripts/fetch_brand_logos.py
"""
import json, pathlib, sys, time, urllib.parse, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
API = 'https://en.wikipedia.org/w/api.php'
UA = 'RankedXI-bot/1.0 (https://rankedxi.com; jkientz@gmail.com)'

# enwiki pageimages skips non-free lead images; these Commons files are the
# public-domain wordmarks used instead when the article route returns nothing
COMMONS = {
    'espn': 'File:ESPN wordmark.svg',
    'peacock': 'File:NBCUniversal Peacock Logo (2026).svg',
    'cbssports': 'File:CBS Sports logo.svg',
}

BRANDS = {
    'tnt': 'TNT (American TV network)',
    'tbs': 'TBS (American TV channel)',
    'trutv': 'TruTV',
    'hbomax': 'HBO Max',
    'telemundo': 'Telemundo',
    'universo': 'Universo (TV network)',
    'peacock': 'Peacock (streaming service)',
    'paramountplus': 'Paramount+',
    'foxsports': 'Fox Sports (United States)',
    'vix': 'ViX',
    'appletv': 'Apple TV (streaming service)',
    'espn': 'ESPN',
    'youtube': 'YouTube',
    'cbssports': 'CBS Sports',
}

def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()

def commons_thumb(file):
    q = urllib.parse.urlencode({'action': 'query', 'titles': file, 'prop': 'imageinfo',
                                'iiprop': 'url', 'iiurlwidth': 240, 'format': 'json'})
    d = json.loads(get(f'https://commons.wikimedia.org/w/api.php?{q}'))
    for p in d['query']['pages'].values():
        if p.get('imageinfo'):
            return p['imageinfo'][0].get('thumburl')
    return None

def thumb_url(title):
    q = urllib.parse.urlencode({'action': 'query', 'titles': title, 'prop': 'pageimages',
                                'pithumbsize': 240, 'redirects': 1, 'format': 'json'})
    d = json.loads(get(f'{API}?{q}'))
    for p in d['query']['pages'].values():
        t = p.get('thumbnail', {}).get('source')
        if t:
            return t
    return None

def main():
    missing = []
    for key, title in BRANDS.items():
        dst = ROOT / 'crests' / f'brand-{key}.png'
        url = thumb_url(title) or (commons_thumb(COMMONS[key]) if key in COMMONS else None)
        if not url:
            missing.append(key)
            print(f'  {key}: NO IMAGE for {title!r}', file=sys.stderr)
            continue
        data = get(url)
        dst.write_bytes(data)
        print(f'  {key}: {len(data)//1024}KB ← {title}')
        time.sleep(0.3)
    if missing:
        print(f'missing: {missing}', file=sys.stderr)

if __name__ == '__main__':
    main()
