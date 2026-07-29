#!/usr/bin/env python3
"""Fetch club crests from Wikipedia for a league group (usage:
fetch_crests_wiki.py <group> [more groups...]).

Two-step per club: pageimages thumbnail first; when that misses (en.wiki
excludes most non-free logos from pageimages) fall back to the article's file
list and pick the logo/crest/badge file, thumbnailed via imageinfo. Resizes to
128px via sips. Only fills clubs with no img; idempotent/rerunnable."""
from _datajs import load_clubs, write_clubs, ROOT
import json, re, os, subprocess, sys, time, unicodedata, urllib.parse, urllib.request

API = 'https://en.wikipedia.org/w/api.php'
UA = {'User-Agent': 'RankXI/1.0 (https://rank-xi.pages.dev; crest pipeline) python-urllib'}

# club name -> article title, where the plain name doesn't resolve
OVERRIDES = {
    'Timbers2': 'Portland Timbers 2',
    'Sporting KC II': 'Sporting Kansas City II',
    'Whitecaps FC 2': 'Vancouver Whitecaps FC 2',
    'LAFC2': 'Los Angeles FC 2',
    'MNUFC2': 'Minnesota United FC 2',
    'The Town FC': 'San Jose Earthquakes II',
}

def deacc(x): return unicodedata.normalize('NFKD', x).encode('ascii', 'ignore').decode()
def slug(n): return re.sub(r'[^a-z0-9]+', '-', deacc(n).lower()).strip('-')

def api(params):
    q = urllib.parse.urlencode({**params, 'format': 'json', 'redirects': 1})
    req = urllib.request.Request(f'{API}?{q}', headers=UA)
    time.sleep(0.8)  # stay under Wikipedia's anonymous rate limit (saw 429s at full speed)
    return json.load(urllib.request.urlopen(req, timeout=30))

def file_thumb(filename):
    """Thumb URL for a File:... title via imageinfo."""
    if not filename.lower().startswith('file:'):
        filename = 'File:' + filename
    d = api({'action': 'query', 'titles': filename, 'prop': 'imageinfo',
             'iiprop': 'url', 'iiurlwidth': 256})
    for p in d.get('query', {}).get('pages', {}).values():
        ii = p.get('imageinfo', [])
        if ii: return ii[0].get('thumburl') or ii[0].get('url')
    return None

def infobox_thumb(title):
    """Infobox image/logo param from section-0 wikitext -> thumb URL."""
    d = api({'action': 'parse', 'page': title, 'prop': 'wikitext', 'section': 0})
    if 'parse' not in d:
        return None
    wt = d['parse']['wikitext']['*']
    m = re.search(r'\|\s*(?:image|logo)\s*=\s*(?:\[\[)?(?:File:|Image:)?([^\|\]\n{}]+)', wt)
    if not m:
        return None
    fn = m.group(1).strip()
    if not re.search(r'\.(svg|png|jpe?g|gif)$', fn, re.I):
        return None
    return file_thumb(fn)

def page_thumb(title):
    """pageimages thumbnail URL, or None."""
    d = api({'action': 'query', 'titles': title, 'prop': 'pageimages',
             'piprop': 'thumbnail', 'pithumbsize': 256})
    for p in d.get('query', {}).get('pages', {}).values():
        t = p.get('thumbnail', {}).get('source')
        if t: return t
    return None

def logo_file_thumb(title):
    """Scan the article's files for a logo/crest/badge; thumb via imageinfo."""
    d = api({'action': 'query', 'titles': title, 'prop': 'images', 'imlimit': 50})
    files = []
    for p in d.get('query', {}).get('pages', {}).values():
        for im in p.get('images', []):
            files.append(im['title'])
    pat = re.compile(r'logo|crest|badge', re.I)
    cands = [f for f in files if pat.search(f) and re.search(r'\.(svg|png)$', f, re.I)]
    if not cands:
        return None
    # prefer file names sharing tokens with the article title
    tt = set(re.findall(r'[a-z0-9]+', deacc(title).lower()))
    cands.sort(key=lambda f: -len(tt & set(re.findall(r'[a-z0-9]+', deacc(f).lower()))))
    d = api({'action': 'query', 'titles': cands[0], 'prop': 'imageinfo',
             'iiprop': 'url', 'iiurlwidth': 256})
    for p in d.get('query', {}).get('pages', {}).values():
        ii = p.get('imageinfo', [])
        if ii: return ii[0].get('thumburl') or ii[0].get('url')
    return None

def fetch(url, dest):
    tmp = os.path.join(ROOT, 'crests', '_raw_tmp')
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r, open(tmp, 'wb') as f:
        f.write(r.read())
    subprocess.run(['sips', '-s', 'format', 'png', '-Z', '128', tmp, '--out', dest],
                   capture_output=True)
    ok = os.path.exists(dest) and os.path.getsize(dest) > 500
    os.path.exists(tmp) and os.remove(tmp)
    return ok

def main():
    groups = sys.argv[1:] or ['mnp']
    clubs = load_clubs()
    got = miss = 0
    for c in clubs:
        if c['g'] not in groups or c.get('img'):
            continue
        title = OVERRIDES.get(c['n'], c['n'])
        url = None
        try:
            url = page_thumb(title) or logo_file_thumb(title) or infobox_thumb(title)
        except Exception as e:
            print(f"  ! {c['n']}: {e}")
        fn = f"crests/{c['g']}-{slug(c['n'])}.png"
        if url and fetch(url, os.path.join(ROOT, fn)):
            c['img'] = fn
            got += 1
            print(f"  + {c['n']} <- {url.rsplit('/', 1)[-1][:60]}")
        else:
            miss += 1
            print(f"  - {c['n']}: no usable image")
        time.sleep(0.4)
    print(f"got {got}, missed {miss}")
    if got:
        write_clubs(clubs)

if __name__ == '__main__':
    main()
