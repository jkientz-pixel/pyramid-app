#!/usr/bin/env python3
"""Harvest school Twitter/Facebook handles from ncaa.com school pages for
college clubs that have NO web presence (no url, no si, no sx). Stages to
data/socials_ncaa.json keyed by club name (sidecar; applied by
apply_completeness_batch.py). One fetch per distinct school slug — men's and
women's programs share it. Resumable: staged slugs are skipped."""
from fetch_crests_ncaa import crawl_index, toks, UA
from _datajs import load_clubs, ROOT
import json, os, re, sys, time, urllib.request

OUT = os.path.join(ROOT, 'data', 'socials_ncaa.json')
GROUPS = ('ncaa1', 'ncaa2', 'ncaa3', 'ncaa1w', 'ncaa2w')


def best(club, schools):
    ct = toks(club['n'])
    scored = []
    for s in schools:
        if not s['_toks']: continue
        ov = len(s['_toks'] & ct)
        if ov == 0 or ov < len(s['_toks']) - 1: continue
        scored.append((ov, s))
    scored.sort(key=lambda x: -x[0])
    if not scored or (len(scored) > 1 and scored[0][0] == scored[1][0]):
        return None
    return scored[0][1]


def main():
    schools = crawl_index()
    for s in schools:
        s['_toks'] = toks(s['name'])
    clubs = load_clubs()
    staged = json.load(open(OUT)) if os.path.exists(OUT) else {}
    todo = {}
    for c in clubs:
        if c['g'] not in GROUPS or c.get('h'): continue
        if c.get('url') or c.get('si') or c.get('sx'): continue
        if c['n'] in staged: continue
        m = best(c, schools)
        if m: todo.setdefault(m['slug'], []).append(c['n'])
    print(f'{sum(len(v) for v in todo.values())} clubs across {len(todo)} school pages')
    cache = {}
    n = 0
    for i, (slug_, names) in enumerate(todo.items()):
        if slug_ not in cache:
            try:
                req = urllib.request.Request(f'https://www.ncaa.com/schools/{slug_}', headers=UA)
                html = urllib.request.urlopen(req, timeout=30).read().decode('utf-8', 'replace')
                rec = {}
                tw = re.search(r'href="https?://(?:www\.)?(?:twitter|x)\.com/@?([A-Za-z0-9_]{1,15})"', html)
                if tw: rec['sx'] = 'https://x.com/' + tw.group(1)
                fb = re.search(r'href="(https?://(?:www\.)?facebook\.com/[A-Za-z0-9_.-]{2,60})"', html)
                if fb: rec['fb'] = fb.group(1)
                cache[slug_] = rec
            except Exception as e:
                print(f'  ! {slug_}: {e}', file=sys.stderr)
                cache[slug_] = {}
            time.sleep(0.5)
        rec = cache[slug_]
        if rec.get('sx'):
            for name in names:
                staged[name] = {'sx': rec['sx']}
                n += 1
        if i % 40 == 39:
            json.dump(staged, open(OUT, 'w'), indent=0)
            print(f'  {i+1}/{len(todo)} schools ({n} clubs staged)', flush=True)
    json.dump(staged, open(OUT, 'w'), indent=0)
    print(f'staged {n} clubs with school twitter -> data/socials_ncaa.json')


if __name__ == '__main__':
    main()
