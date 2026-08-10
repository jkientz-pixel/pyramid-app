#!/usr/bin/env python3
"""Mop-up pass for fetch_crests_ncaa.py: the main sweep leaves two remainders —
AMBIG ties (two schools share the club's name tokens, e.g. anderson-in vs
anderson-sc) and transient fetch failures. This pass re-matches every still-
crestless college club with two extra signals the main matcher ignores:

  * the club's own st field vs a state hinted in the school slug/name suffix
    (-in/-sc/-tx..., "(NY)", "Ill.", full state names);
  * college-vs-university identity: 'college'/'university' tokens break ties
    when both candidates survive (Cornell College vs Cornell University).

A candidate is accepted only when it is strictly better than every rival —
never first-of-equals; unresolved ties stay crestless rather than risk the
wrong school's crest (the main sweep pinned SUNY Brockport to suny-morrisville
on token overlap; only a 403 kept the wrong crest out).
Idempotent: only fills clubs with no img."""
from fetch_crests_ncaa import crawl_index, toks, slugify, LOGO, UA, deacc
from _datajs import load_clubs, write_clubs, ROOT
import os, re, sys, time, urllib.request

ST_NAMES = {'alabama':'AL','alaska':'AK','arizona':'AZ','arkansas':'AR','california':'CA',
 'colorado':'CO','connecticut':'CT','delaware':'DE','florida':'FL','georgia':'GA','hawaii':'HI',
 'idaho':'ID','illinois':'IL','indiana':'IN','iowa':'IA','kansas':'KS','kentucky':'KY',
 'louisiana':'LA','maine':'ME','maryland':'MD','massachusetts':'MA','michigan':'MI',
 'minnesota':'MN','mississippi':'MS','missouri':'MO','montana':'MT','nebraska':'NE','nevada':'NV',
 'ohio':'OH','oklahoma':'OK','oregon':'OR','pennsylvania':'PA','tennessee':'TN','texas':'TX',
 'utah':'UT','vermont':'VT','virginia':'VA','washington':'WA','wisconsin':'WI','wyoming':'WY'}
ST_ABBR = {v.lower(): v for v in ST_NAMES.values()}


def slug_state(slug, name):
    """State hint from a schools-index entry, or None."""
    m = re.search(r'-([a-z]{2})$', slug)
    if m and m.group(1) in ST_ABBR:
        return ST_ABBR[m.group(1)]
    m = re.search(r'\(([A-Za-z.]+)\)', name)
    if m:
        t = m.group(1).rstrip('.').lower()
        if t in ST_ABBR: return ST_ABBR[t]
        if t in ST_NAMES: return ST_NAMES[t]
    for w in re.findall(r'[a-z]+', name.lower()):
        if w in ST_NAMES: return ST_NAMES[w]
    return None


def score(club, school):
    """(overlap, state, kind) — state: +1 match / -1 conflict; kind: matching
    college/university token. None when the school shares no name tokens."""
    ct, stt = toks(club['n']), school['_toks']
    if not stt: return None
    ov = len(stt & ct)
    if ov == 0 or ov < len(stt) - 1: return None
    hint = slug_state(school['slug'], school['name'])
    state = 0 if hint is None else (1 if hint == club.get('st') else -1)
    ckind = {'college', 'university'} & set(re.findall(r'[a-z]+', deacc(club['n']).lower()))
    skind = {'college', 'university'} & set(re.findall(r'[a-z]+', school['name'].lower()))
    kind = 1 if ckind and skind and ckind == skind else 0
    return (ov, state, kind)


def main():
    from playwright.sync_api import sync_playwright
    schools = crawl_index()
    for s in schools:
        s['_toks'] = toks(s['name'])
    clubs = load_clubs()
    todo = [c for c in clubs
            if c['g'] in ('ncaa1', 'ncaa2', 'ncaa3', 'ncaa1w', 'ncaa2w') and not c.get('img')]
    print(f'{len(todo)} college clubs still crestless')
    got = skip = 0
    svgdir = os.path.join(ROOT, 'crests', '_svg_tmp')
    os.makedirs(svgdir, exist_ok=True)
    with sync_playwright() as pw:
        page = pw.chromium.launch().new_page(viewport={'width': 160, 'height': 160})
        for c in todo:
            scored = sorted(((sc, s) for s in schools if (sc := score(c, s))),
                            key=lambda x: x[0], reverse=True)
            if not scored or (len(scored) > 1 and scored[0][0] == scored[1][0]) \
               or scored[0][0][1] < 0:
                skip += 1
                print(f"  - {c['n']}: unresolved" + (
                    f" ({scored[0][1]['slug']}/{scored[1][1]['slug']})" if len(scored) > 1 else ''))
                continue
            m = scored[0][1]
            svg = os.path.join(svgdir, m['slug'] + '.svg')
            try:
                if not os.path.exists(svg):
                    req = urllib.request.Request(LOGO.format(slug=m['slug']), headers=UA)
                    data = urllib.request.urlopen(req, timeout=30).read()
                    if b'<svg' not in data[:600]: raise Exception('not svg')
                    open(svg, 'wb').write(data)
                    time.sleep(0.4)
                fn = f"crests/{c['g']}-{slugify(c['n'])}.png"
                dest = os.path.join(ROOT, fn)
                page.set_content(f'<body style="margin:0"><img src="file://{svg}" '
                                 'style="width:128px;height:128px;object-fit:contain"></body>')
                page.locator('img').screenshot(path=dest, omit_background=True)
                assert os.path.getsize(dest) > 500
            except Exception as e:
                skip += 1
                print(f"  - {c['n']}: fetch/raster failed ({m['slug']}: {e})")
                continue
            c['img'] = fn
            got += 1
            print(f"  + {c['n']} <- {m['slug']}.svg [{scored[0][0]}]")
    print(f'resolved {got}, left {skip}')
    if got:
        write_clubs(clubs)


if __name__ == '__main__':
    main()
