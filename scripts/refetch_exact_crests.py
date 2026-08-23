#!/usr/bin/env python3
"""Repopulate crests blanked by audit_crest_dupes.py, using EXACT name matching
only.

Why a separate script: the misattribution this repairs was *caused* by fuzzy
matching. fetch_league_crests.py scores clubs against league-site assets with a
token-overlap heuristic, and on 2026-08-22 that heuristic handed Ocean City
Nor'easters' badge to seventeen other clubs whose names merely contain the word
"City". Re-running the same matcher would re-create the same eighteen-way
collision. So this pass will only accept an asset whose alt text is *character
for character* the club's name, and it refuses to write any image whose bytes
already appear under another club — the collision can't come back through here.

Sources: data/usl2_site_assets.json and data/uslwl_site_assets.json (the
sportngin CDN captures the league sites serve). Run audit_crest_dupes.py after.
"""
from _datajs import load_clubs, write_clubs, ROOT
import hashlib, json, os, re, subprocess, sys, unicodedata, urllib.request

UA = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) RankXI/1.0'}
SOURCES = [('usl2', 'usl2_site_assets.json'), ('uslwl', 'uslwl_site_assets.json')]
SIZE = '96'

def deacc(x): return unicodedata.normalize('NFKD', x).encode('ascii', 'ignore').decode()
def slugify(n): return re.sub(r'[^a-z0-9]+', '-', deacc(n).lower()).strip('-')

def norm(s):
    """Compare names with punctuation and case removed but every word kept —
    'Nor'easters' vs 'Noreasters' must still match, 'Hill City' vs 'Ocean
    City' must still not."""
    return re.sub(r'[^a-z0-9]+', '', deacc(s or '').lower())

def existing_hashes(clubs, skip_ids):
    """md5 -> club name, for every crest currently in use by a club we are not
    about to rewrite. A candidate colliding with one of these is the exact
    failure this script exists to prevent."""
    out = {}
    for c in clubs:
        if c.get('id') in skip_ids or not c.get('img'):
            continue
        p = os.path.join(ROOT, c['img'].split('?')[0])
        if os.path.exists(p):
            out.setdefault(hashlib.md5(open(p, 'rb').read()).hexdigest(), c['n'])
    return out

def main():
    clubs = load_clubs()
    todo = [c for c in clubs if c['g'] in dict(SOURCES) and not c.get('img') and not c.get('h')]
    print(f'{len(todo)} USL2/USL-W clubs missing a crest')
    seen = existing_hashes(clubs, {c.get('id') for c in todo})

    assets = {}
    for g, fname in SOURCES:
        p = os.path.join(ROOT, 'data', fname)
        if not os.path.exists(p):
            print(f'  (no {fname})'); continue
        for it in json.load(open(p))['pairs']:
            name = (it.get('alt') or it.get('name') or '').strip()
            src = it.get('src', '')
            if not name or not src:
                continue
            # A name appearing twice is normally the same club's badge
            # re-uploaded under a second CDN path (Port City, Steel City and
            # FC Miami City each appear twice for that reason), so keep the
            # first and let the byte-collision guard below do the policing —
            # that guard is what actually prevents a shared badge, and it does
            # not care which upload we picked.
            assets.setdefault((g, norm(name)), src)

    got = miss = clash = 0
    for c in todo:
        src = assets.get((c['g'], norm(c['n'])))
        if not src:
            miss += 1; print(f"  - {c['n']}: no exact-name asset"); continue
        fn = f"crests/{c['g']}-{slugify(c['n'])}.png"
        dest = os.path.join(ROOT, fn)
        tmp = dest + '.tmp'
        try:
            req = urllib.request.Request(src, headers=UA)
            data = urllib.request.urlopen(req, timeout=30).read()
            if len(data) < 500:
                raise Exception(f'tiny payload ({len(data)}b)')
            open(tmp, 'wb').write(data)
            subprocess.run(['sips', '-Z', SIZE, tmp, '--out', tmp],
                           check=True, capture_output=True)
            h = hashlib.md5(open(tmp, 'rb').read()).hexdigest()
            # One badge may legitimately serve two entries of the SAME club —
            # Steel City FC, Port City FC and FC Miami City each field a USL2
            # men's side and a USL W women's side under one crest. That is the
            # same exemption audit_crest_dupes.py makes, so mirror it exactly:
            # a byte match is only a fault when the names differ.
            if h in seen and norm(seen[h]) != norm(c['n']):
                clash += 1
                print(f"  ! {c['n']}: byte-identical to {seen[h]} — refused")
                os.remove(tmp); continue
            os.replace(tmp, dest)
            seen[h] = c['n']
            c['img'] = fn
            got += 1
            print(f"  + {c['n']}")
        except Exception as e:
            miss += 1
            if os.path.exists(tmp): os.remove(tmp)
            print(f"  - {c['n']}: {e}")
    print(f'got {got}, missed {miss}, refused-as-duplicate {clash}')
    if got:
        write_clubs(clubs)
        print('Bump CRESTV in js/app.js.')

if __name__ == '__main__':
    main()
