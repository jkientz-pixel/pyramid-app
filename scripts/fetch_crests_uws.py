#!/usr/bin/env python3
"""UWS crest fetcher. uwssoccer.com's /teams tab is behind SportsEngine
sign-in, but the public page /page/show/9507290-teams lists every club with a
team page link (page/show/<id>-<slug>); each team page's first CDN photo
attachment is the club logo. Slug-token-matches to uws clubs, downloads,
sips-resizes to 128px.

Runs in two phases so it can't race another data.js writer: bare run downloads
crests and records the mapping in data/uws_crests.json; `--apply` merges that
mapping into js/data.js (run it when nothing else is writing data.js).
'Michigan Jaguars FC II' intentionally shares the first team's crest."""
from _datajs import load_clubs, write_clubs, ROOT
import json, os, re, subprocess, sys, time, unicodedata, urllib.request

UA = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 RankXI/1.0'}
TEAMS_URL = 'https://www.uwssoccer.com/page/show/9507290-teams'
SIDE = os.path.join(ROOT, 'data', 'uws_crests.json')
STOP = {'fc', 'sc', 'cf', 'afc', 'wfc', 'the', 'club', 'soccer', 'football', 'united'}

def deacc(x): return unicodedata.normalize('NFKD', x).encode('ascii', 'ignore').decode()
def slugify(n): return re.sub(r'[^a-z0-9]+', '-', deacc(n).lower()).strip('-')
def toks(s): return set(re.findall(r'[a-z0-9]+', deacc(s).lower())) - STOP

def get(url):
    req = urllib.request.Request(url, headers=UA)
    return urllib.request.urlopen(req, timeout=30).read()

def fetch_phase():
    html = get(TEAMS_URL).decode('utf-8', 'replace')
    pages = sorted(set(re.findall(r'page/show/(94\d{5})-([a-z0-9-]+)', html)))
    pages = [(i, s) for i, s in pages if s not in
             ('united-women-s-soccer-2026', 'uws-2')]
    clubs = load_clubs()
    todo = [c for c in clubs if c['g'] == 'uws' and not c.get('img')]
    print(f'{len(todo)} uws clubs missing crests; {len(pages)} team pages')
    side = json.load(open(SIDE)) if os.path.exists(SIDE) else {}
    for c in todo:
        if c['id'] in side: continue
        ct = toks(re.sub(r'\bII\b', '', c['n']))
        scored = []
        for pid, slug in pages:
            st = toks(slug.replace('-', ' '))
            if not st: continue
            ov = len(ct & st)
            if ov: scored.append((ov / max(len(ct), len(st)), pid, slug))
        scored.sort(key=lambda x: -x[0])
        if not scored or scored[0][0] < 0.5:
            print(f"  - {c['n']}: no page match"); continue
        _, pid, slug = scored[0]
        try:
            ph = get(f'https://www.uwssoccer.com/page/show/{pid}-{slug}').decode('utf-8', 'replace')
            # club logo renders as a CSS background: attachments/logo_graphic/<hash>/logo_small.png
            imgs = re.findall(r'(https://cdn\d\.sportngin\.com/attachments/logo_graphic/[^"\s)]+?/logo)_small(\.png)', ph)
            imgs = [a + '_large' + b for a, b in imgs] or \
                re.findall(r'(https://cdn\d\.sportngin\.com/attachments/photo/[^"\s]+?\.(?:png|jpe?g|PNG|JPE?G))', ph)
            if not imgs: raise Exception('no logo_graphic or photo attachment')
            tmp = os.path.join(ROOT, 'crests', '_raw_tmp')
            open(tmp, 'wb').write(get(imgs[0]))
            fn = f"crests/uws-{slugify(c['n'])}.png"
            dest = os.path.join(ROOT, fn)
            subprocess.run(['sips', '-s', 'format', 'png', '-Z', '128', tmp, '--out', dest],
                           capture_output=True)
            if not (os.path.exists(dest) and os.path.getsize(dest) > 500):
                raise Exception('sips produced nothing')
            side[c['id']] = fn
            json.dump(side, open(SIDE, 'w'), indent=0)
            print(f"  + {c['n']} <- {slug} ({imgs[0].rsplit('/', 1)[-1][:40]})")
        except Exception as e:
            print(f"  - {c['n']}: {e}")
        time.sleep(0.6)
    print(f'{len(side)} crests staged in data/uws_crests.json — run with --apply to merge')

def apply_phase():
    side = json.load(open(SIDE))
    clubs = load_clubs()
    n = 0
    for c in clubs:
        fn = side.get(c.get('id'))
        if fn and not c.get('img') and os.path.exists(os.path.join(ROOT, fn)):
            c['img'] = fn; n += 1
    print(f'applied {n} uws crests')
    if n: write_clubs(clubs)

if __name__ == '__main__':
    apply_phase() if '--apply' in sys.argv else fetch_phase()
