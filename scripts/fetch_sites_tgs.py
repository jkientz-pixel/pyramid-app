#!/usr/bin/env python3
"""Harvest ECNL club websites + socials from the TGS/AthleteOne per-club
endpoint (get-club-info/{clubID}: clubwebsite, clubfacebook, clubtwitter).
Stages results to data/sites_tgs.json keyed by data.js club NAME — does NOT
write data.js (applied by apply_completeness_batch.py), so it can run beside
the crest sweep. Only looks up clubs that lack a url; resumable (staged names
are skipped on rerun)."""
import json, os, re, sys, time, unicodedata, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _datajs import load_clubs, ROOT

LIST_API = 'https://api.athleteone.com/api/Event/get-org-club-list-by-orgID/%d'
INFO_API = 'https://api.athleteone.com/api/Event/get-club-info/%d'
UA = {'User-Agent': 'RankXI/1.0 (jkientz@gmail.com; youth sites harvest)'}
ORGS = {'ecnlb': 12, 'ecnlg': 9, 'ecrlb': 16, 'ecrlg': 13}
YOUTH_POOL = ('ecnlb', 'ecnlg', 'ecrlb', 'ecrlg')
OUT = os.path.join(ROOT, 'data', 'sites_tgs.json')


def deacc(x): return unicodedata.normalize('NFKD', x).encode('ascii', 'ignore').decode()
def norm(s): return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9]+', ' ', deacc(s).lower())).strip()


def get(url):
    return json.load(urllib.request.urlopen(
        urllib.request.Request(url, headers=UA), timeout=30))


def clean_url(u):
    if not u or not isinstance(u, str): return None
    u = u.strip()
    if not u or '.' not in u: return None
    if not re.match(r'https?://', u, re.I): u = 'https://' + u
    return u if re.match(r'https?://[^\s]+$', u) else None


def main():
    clubs = load_clubs()
    staged = json.load(open(OUT)) if os.path.exists(OUT) else {}
    pool = {}
    for c in clubs:
        if c['g'] in YOUTH_POOL and not c.get('h') and not c.get('url'):
            pool.setdefault(norm(c['n']), c)
    todo = {}
    for g, org_id in ORGS.items():
        try:
            recs = get(LIST_API % org_id).get('data', [])
        except Exception as e:
            print(f'{g}: list fetch failed ({e})', file=sys.stderr)
            continue
        for r in recs:
            name = r.get('clubFullName') or r.get('clubName') or ''
            c = pool.get(norm(name))
            if c and c['n'] not in staged and r.get('clubID'):
                todo[c['n']] = r['clubID']
    print(f'{len(todo)} ECNL clubs to look up ({len(staged)} already staged)')
    n = 0
    for i, (cname, cid) in enumerate(todo.items()):
        try:
            d = get(INFO_API % cid)
            d = (d.get('data') or {}).get('clubData') or {}
        except Exception as e:
            print(f'  ! {cname}: {e}', file=sys.stderr)
            continue
        rec = {}
        u = clean_url(d.get('clubwebsite'))
        if u: rec['url'] = u
        fb = clean_url(d.get('clubfacebook'))
        tw = d.get('clubtwitter')
        if tw and isinstance(tw, str) and tw.strip():
            t = tw.strip().rstrip('/').split('/')[-1].lstrip('@')
            if re.match(r'^[A-Za-z0-9_]{1,15}$', t): rec['sx'] = 'https://x.com/' + t
        ig = d.get('clubInstagram')
        if ig and isinstance(ig, str) and ig.strip():
            h = ig.strip().rstrip('/').split('/')[-1].lstrip('@')
            if re.match(r'^[A-Za-z0-9_.]{1,30}$', h): rec['si'] = 'https://www.instagram.com/' + h
        if rec:
            staged[cname] = rec
            n += 1
        if i % 25 == 24:
            json.dump(staged, open(OUT, 'w'), indent=0)
            print(f'  {i+1}/{len(todo)} ({n} with data)', flush=True)
        time.sleep(0.35)
    json.dump(staged, open(OUT, 'w'), indent=0)
    print(f'staged {n} new records -> data/sites_tgs.json (total {len(staged)})')


if __name__ == '__main__':
    main()
