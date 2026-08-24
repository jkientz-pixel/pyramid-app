#!/usr/bin/env python3
"""ECNL / ECNL Regional League crest + location-verify sweep via the
Total Global Sports (AthleteOne) API — the same feed build_youth_layers.py
ingested the club lists from, so names line up almost exactly.

Per org (ecnlb 12, ecnlg 9, ecrlb 16, ecrlg 13) the club list returns
clubFullName, city, stateCode and clubLogo. For every matched data.js club:
  * crest: download clubLogo -> 128px PNG via sips (skipped for the API's
    /assets/img/club-account.svg placeholder and non-http URLs);
  * location: league-stated city/state confirming the pin stamps acc:'v'
    (same semantics as refresh_upsl_locations.py); a mismatch is only
    LOGGED — youth pins were settlement-geocoded from this same feed, so a
    disagreement means the feed moved and deserves eyes, not a silent move.
Only fills missing img; idempotent. Match log -> data/tgs_crest_report.json.
"""
from _datajs import load_clubs, write_clubs, ROOT
import json, os, re, subprocess, sys, time, unicodedata, urllib.parse, urllib.request

API = 'https://api.athleteone.com/api/Event/get-org-club-list-by-orgID/%d'
UA = {'User-Agent': 'RankXI/1.0 (jkientz@gmail.com; youth crest sweep)'}
ORGS = {'ecnlb': 12, 'ecnlg': 9, 'ecrlb': 16, 'ecrlg': 13, 'pecnlb': 22, 'pecnlg': 21}
SIBLINGS = {'ecnlb': ('ecnlb', 'ecrlb', 'pecnlb'), 'ecrlb': ('ecrlb', 'ecnlb', 'pecnlb'),
            'pecnlb': ('pecnlb', 'ecrlb', 'ecnlb'),
            'ecnlg': ('ecnlg', 'ecrlg', 'pecnlg'), 'ecrlg': ('ecrlg', 'ecnlg', 'pecnlg'),
            'pecnlg': ('pecnlg', 'ecrlg', 'ecnlg')}


def deacc(x): return unicodedata.normalize('NFKD', x).encode('ascii', 'ignore').decode()
def slug(n): return re.sub(r'[^a-z0-9]+', '-', deacc(n).lower()).strip('-')
def norm(s): return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9]+', ' ', deacc(s).lower())).strip()


def fetch_org(org_id):
    req = urllib.request.Request(API % org_id, headers=UA)
    return json.load(urllib.request.urlopen(req, timeout=30)).get('data', [])


def grab(url, dest):
    """Download + resize to 128px PNG. Returns False on any failure."""
    if not re.match(r'https?://', url or ''):
        return False
    if url.rstrip('/').endswith('club-account.svg'):
        return False
    tmp = dest + '.orig'
    try:
        u = urllib.parse.quote(url, safe=':/?&=%')
        urllib.request.urlretrieve(u, tmp)
        if os.path.getsize(tmp) < 400:
            raise Exception('too small')
        r = subprocess.run(['sips', '-s', 'format', 'png', '-Z', '128', tmp, '--out', dest],
                           capture_output=True)
        if r.returncode or not os.path.exists(dest) or os.path.getsize(dest) < 400:
            raise Exception('sips failed')
        return True
    except Exception:
        for p in (tmp, dest):
            if os.path.exists(p): os.remove(p)
        return False
    finally:
        if os.path.exists(tmp): os.remove(tmp)


def main():
    clubs = load_clubs()
    report = {'crests': [], 'verified': 0, 'loc_mismatch': [], 'unmatched': [],
              'no_logo': []}
    got = 0
    for g, org_id in ORGS.items():
        try:
            recs = fetch_org(org_id)
        except Exception as e:
            print(f'{g}: org fetch failed ({e}) — skipped', file=sys.stderr)
            continue
        pool = {}
        for c in clubs:
            if c['g'] in SIBLINGS[g] and not c.get('h'):
                pool.setdefault(norm(c['n']), c)
        print(f'{g}: {len(recs)} clubs in feed, {len(pool)} candidates in data.js')
        for r in recs:
            name = r.get('clubFullName') or r.get('clubName') or ''
            c = pool.get(norm(name))
            if not c:
                report['unmatched'].append({'org': g, 'club': name})
                continue
            # league-stated location confirms the pin -> verified
            if (r.get('city') and r.get('stateCode')
                    and norm(r['city']) == norm(c.get('ct', ''))
                    and r['stateCode'] == c.get('st')):
                if c.get('acc') != 'v':
                    c['acc'] = 'v'
                    report['verified'] += 1
            elif r.get('city') and r.get('stateCode'):
                report['loc_mismatch'].append(
                    {'club': c['n'], 'pin': f"{c.get('ct','?')}, {c.get('st','?')}",
                     'league': f"{r['city']}, {r['stateCode']}"})
            if c.get('img'):
                continue
            fn = f"crests/{c['g']}-{slug(c['n'])}.png"
            if grab(r.get('clubLogo'), os.path.join(ROOT, fn)):
                c['img'] = fn
                got += 1
                report['crests'].append(c['n'])
                print(f"  + {c['n']}")
            else:
                report['no_logo'].append({'org': g, 'club': name,
                                          'logo': r.get('clubLogo')})
            time.sleep(0.25)
    json.dump(report, open(os.path.join(ROOT, 'data', 'tgs_crest_report.json'), 'w'),
              indent=1)
    print(f"crests {got}, verified {report['verified']}, "
          f"unmatched {len(report['unmatched'])}, no-logo {len(report['no_logo'])}, "
          f"loc-mismatch {len(report['loc_mismatch'])} -> data/tgs_crest_report.json")
    if got or report['verified']:
        write_clubs(clubs)


if __name__ == '__main__':
    main()
