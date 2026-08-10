#!/usr/bin/env python3
"""One-shot data.js batch for the 2026-08-09 completeness push. Four edits,
all idempotent:

1. ia:1 on UPSL clubs the 2026 location re-pin could not find on upsl.com AND
   that never got a crest from any sweep — shown in the app as an Inactive
   badge, NOT hidden (h:1 stays reserved for true tombstones/dupes).
2. acc:'v' on college clubs with no acc yet: their city/state come from the
   Wikipedia institutional lists / men's-entry clones the layer builders used
   (school-stated, never invented — see build_college_layers.py,
   build_ncaaw_layers.py). Clubs already flagged acc:'a' keep the flag.
3. Women's college entries borrow url/si/sx from the same school's men's
   entry (id minus '-w') when the men's side has one and they don't.
4. Apply data/sites_wikidata.json (staged by fetch_sites_wikidata.py) —
   fills url/si/sx by club name, only where missing.
"""
import json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _datajs import load_clubs, write_clubs, ROOT

COLLEGE = ('ncaa1', 'ncaa2', 'ncaa3', 'naia', 'ncaa1w', 'ncaa2w')


def main():
    clubs = load_clubs()
    by_id = {c['id']: c for c in clubs}
    audit = json.load(open(os.path.join(ROOT, 'data', 'upsl_location_audit.json')))
    unmatched = set(audit.get('unmatched', []))

    n_ia = 0
    for c in clubs:
        if c['g'] == 'upsl' and c['n'] in unmatched and not c.get('img') \
           and not c.get('h') and not c.get('ia'):
            c['ia'] = 1; n_ia += 1

    n_v = 0
    for c in clubs:
        if c['g'] in COLLEGE and not c.get('acc'):
            c['acc'] = 'v'; n_v += 1

    n_url = 0
    for c in clubs:
        if c['g'] in ('ncaa1w', 'ncaa2w') and c['id'].endswith('-w'):
            m = by_id.get(c['id'][:-2])
            if not m: continue
            for k in ('url', 'si', 'sx'):
                if m.get(k) and not c.get(k):
                    c[k] = m[k]
                    if k == 'url': n_url += 1

    n_wd = 0
    for sidecar in ('sites_wikidata.json', 'sites_tgs.json', 'socials_ncaa.json'):
        path = os.path.join(ROOT, 'data', sidecar)
        if not os.path.exists(path): continue
        staged = json.load(open(path))
        for c in clubs:
            rec = staged.get(c['n'])
            if not rec: continue
            for k in ('url', 'si', 'sx'):
                if rec.get(k) and not c.get(k):
                    c[k] = rec[k]
                    if k == 'url': n_wd += 1

    # GA / GA Aspire verify: girlsacademyleague.com members pages state
    # "Club (City, ST)" — league-stated, same source the youth build scraped.
    n_ga = 0
    ga_path = os.path.join(ROOT, 'data', 'ga_member_locs.json')
    if os.path.exists(ga_path):
        ga = json.load(open(ga_path))
        import unicodedata
        def _norm(s):
            s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode()
            return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9]+', ' ', s.lower())).strip()
        for grp, entries in (('ga', ga.get('ga', {})), ('gaa', ga.get('gaa', {}))):
            emap = {_norm(k): v for k, v in entries.items()}
            for c in clubs:
                if c['g'] != grp or c.get('acc') == 'v':
                    continue
                rec = emap.get(_norm(c['n']))
                if rec and _norm(rec[0]) == _norm(c.get('ct', '')) and rec[1] == c.get('st'):
                    c['acc'] = 'v'; n_ga += 1

    # UPSL team-page harvest (data/upsl_sites.json, keyed by team URL): match
    # by slug then normalized name, mirroring refresh_upsl_locations.py.
    n_upsl = 0
    us_path = os.path.join(ROOT, 'data', 'upsl_sites.json')
    if os.path.exists(us_path):
        harvested = json.load(open(us_path))
        by_slug = {}
        for u, rec in harvested.items():
            if rec.get('error'):
                continue
            s = re.sub(r'-\d+$', '', u.rstrip('/').split('/')[-1])
            by_slug.setdefault(s, rec)
        for c in clubs:
            if c['g'] != 'upsl':
                continue
            rec = by_slug.get(c.get('id', ''))
            if not rec:
                continue
            for k in ('url', 'si', 'sx'):
                if rec.get(k) and not c.get(k):
                    c[k] = rec[k]
                    if k == 'url': n_upsl += 1

    print(f'inactive-flagged {n_ia} UPSL ghosts; acc=v on {n_v} college clubs; '
          f'{n_url} urls cloned men->women; {n_wd} urls from sidecars; '
          f'GA/GAA verified {n_ga}; UPSL urls {n_upsl}')
    write_clubs(clubs)


if __name__ == '__main__':
    main()
