#!/usr/bin/env python3
"""Download club crests harvested from league sites (USL2/W League sportngin
CDN, WPSL webflow CDN) captured in data/*_site_assets.json / wpsl_cards_all.json.
Matches strictly to clubs, resizes to 96px via sips, sets img (and url when the
league site links out to the club's own site)."""
from _datajs import load_clubs, write_clubs
import json, re, os, sys, subprocess, unicodedata, urllib.request, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) RankXI/1.0'}

def deacc(x): return unicodedata.normalize('NFKD', x).encode('ascii', 'ignore').decode()
def toks(s): return set(re.findall(r'[a-z0-9]+', deacc(s).lower())) - {'fc', 'sc', 'the', 'club', 'soccer', 'football', 'futbol', 'cf'}
def slug(n): return re.sub(r'[^a-z0-9]+', '-', deacc(n).lower()).strip('-')

def match_score(a, b):
    ta, tb = toks(a), toks(b)
    if not ta or not tb: return 0
    if ta <= tb or tb <= ta: return 1.0
    ov = len(ta & tb)
    return min(ov / len(ta), ov / len(tb)) + 0.35 * (ov / max(len(ta), len(tb)))

def main():
    dpath = os.path.join(ROOT, 'js', 'data.js')
    cur = open(dpath).read()
    clubs = json.loads(re.search(r'export const CLUBS=(\[.*?\]);', cur, re.S).group(1))

    sources = []
    for g, fname, kind in [('usl2', 'usl2_site_assets.json', 'pairs'),
                           ('uslwl', 'uslwl_site_assets.json', 'pairs'),
                           ('wpsl', 'wpsl_cards_all.json', 'cards')]:
        p = os.path.join(ROOT, 'data', fname)
        if not os.path.exists(p): continue
        d = json.load(open(p))
        items = d['pairs'] if kind == 'pairs' else d
        assets = [{'name': (it.get('alt') or it.get('name') or '').strip(),
                   'src': it.get('src', ''), 'href': it.get('href', '')} for it in items]
        assets = [a for a in assets if a['name'] and a['src'] and 'sportsengine' not in a['name'].lower()]
        sources.append((g, assets))

    got = skipped_amb = 0
    for g, assets in sources:
        pool = [c for c in clubs if c['g'] == g]
        for c in pool:
            if c.get('img'): continue
            scored = sorted(((match_score(c['n'], a['name']), a) for a in assets), key=lambda x: -x[0])
            if not scored or scored[0][0] < 0.8: continue
            # ambiguity: does this asset match another club better?
            a = scored[0][1]
            rivals = [c2 for c2 in pool if c2 is not c and match_score(c2['n'], a['name']) > scored[0][0]]
            if rivals: skipped_amb += 1; continue
            fn = f"crests/{g}-{slug(c['n'])}.png"
            dest = os.path.join(ROOT, fn)
            try:
                raw = os.path.join(ROOT, 'crests', '_raw_tmp')
                urllib.request.urlretrieve(a['src'], raw)
                r = subprocess.run(['sips', '-s', 'format', 'png', '-Z', '96', raw, '--out', dest],
                                   capture_output=True)
                os.path.exists(dest) and os.path.getsize(dest) > 500 or (_ for _ in ()).throw(Exception('bad'))
                c['img'] = fn
                got += 1
                # external club site from the wrapping link
                href = a.get('href', '')
                if href and not c.get('url') and 'usl' not in href and 'wpslsoccer' not in href and href.startswith('http'):
                    c['url'] = href
            except Exception:
                pass
            time.sleep(0.25)
        print(f'{g}: crests so far {got}', file=sys.stderr)
    try: os.remove(os.path.join(ROOT, 'crests', '_raw_tmp'))
    except OSError: pass
    write_clubs(clubs, cur)
    print(f'done: {got} crests, {skipped_amb} ambiguous skipped', file=sys.stderr)
    print('with img now:', sum(1 for c in clubs if c.get('img')), '/', len(clubs), file=sys.stderr)

if __name__ == '__main__':
    main()
