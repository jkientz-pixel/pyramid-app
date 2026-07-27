#!/usr/bin/env python3
"""Results wire for the ASA-covered pro leagues: fetch completed games, run a
results-only Elo walk per league (same K / home-edge / margin model as the NPSL
walk in compute_elo.py), and emit data/wire_asa.json for The Wire screen.

The club ratings displayed in the app are NOT touched — the walk exists to
publish per-match rating swings and pre-match expectations with each result."""
import json, re, urllib.request, time, os, sys, math, unicodedata

B = 'https://app.americansocceranalysis.com/api/v1'
UA = {'User-Agent': 'RankXI/0.1 (jkientz@gmail.com; results wire)'}
# app league key -> (ASA slug, season name); USLS runs fall-spring
LEAGUES = {'mls': ('mls', '2026'), 'uslc': ('uslc', '2026'), 'usl1': ('usl1', '2026'),
           'mnp': ('mlsnp', '2026'), 'nwsl': ('nwsl', '2026'), 'uslw': ('usls', '2025-26')}

def get(path):
    for _ in range(3):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(B + path, headers=UA), timeout=30))
        except Exception:
            time.sleep(5)
    return None

def deacc(x): return unicodedata.normalize('NFKD', x).encode('ascii', 'ignore').decode()
def norm(n): return re.sub(r'\b(fc|sc|cf|afc|cd|club|the)\b', '', deacc(n).lower()).replace(' ', '').replace('.', '')

BRIDGE = {'losangeles': 'lafc', 'newyorkcity': 'nycfc', 'montreal': 'cfmontreal'}

def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    cur = open(os.path.join(root, 'js', 'data.js')).read()
    clubs = json.loads(re.search(r'export const CLUBS=(\[.*?\]);', cur, re.S).group(1))
    club_by_norm = {}
    for c in clubs:
        club_by_norm.setdefault(c['g'] + ':' + norm(c['n']), c)

    def resolve(g, asa_name):
        """Map an ASA team name to our club's display name so wire rows link."""
        club = club_by_norm.get(g + ':' + norm(asa_name))
        if not club:
            club = club_by_norm.get(g + ':' + BRIDGE.get(norm(asa_name), ''))
        if not club:
            cand = [c2 for k2, c2 in club_by_norm.items()
                    if k2.startswith(g + ':') and (norm(asa_name)[:7] in k2 or k2.split(':')[1][:7] in norm(asa_name))]
            club = cand[0] if len(cand) == 1 else None
        return club['n'] if club else asa_name

    wire = []
    K = 40
    for g, (asa, season) in LEAGUES.items():
        teams = get(f'/{asa}/teams'); time.sleep(1)
        games = get(f'/{asa}/games?season_name={season}'); time.sleep(1)
        if not teams or not games:
            print(f'{g}: ASA fetch failed', file=sys.stderr); continue
        tname = {t['team_id']: t['team_name'] for t in teams}
        rows = [x for x in games if x.get('status') == 'FullTime'
                and isinstance(x.get('home_score'), int) and isinstance(x.get('away_score'), int)]
        rows.sort(key=lambda x: x.get('date_time_utc') or '')
        elo, played = {}, {}
        n = 0
        for x in rows:
            h, a = x['home_team_id'], x['away_team_id']
            if h not in tname or a not in tname: continue
            hg, ag = x['home_score'], x['away_score']
            rh, ra = elo.get(h, 1500), elo.get(a, 1500)
            eh = 1 / (1 + 10 ** ((ra - (rh + 50)) / 400))
            sh = 1.0 if hg > ag else 0.0 if hg < ag else 0.5
            margin = math.log(abs(hg - ag) + 1) or 1
            delta = K * margin * (sh - eh)
            wire.append({'d': (x.get('date_time_utc') or '')[:10], 'lg': g,
                         't1': resolve(g, tname[h]), 't2': resolve(g, tname[a]),
                         's1': hg, 's2': ag, 'dr': round(delta), 'ph': round(eh, 2),
                         'gp': min(played.get(h, 0), played.get(a, 0))})
            elo[h] = rh + delta; elo[a] = ra - delta
            played[h] = played.get(h, 0) + 1; played[a] = played.get(a, 0) + 1
            n += 1
        print(f'{g}: {n} rated results')
    json.dump(wire, open(os.path.join(root, 'data', 'wire_asa.json'), 'w'), separators=(',', ':'))
    print(f'wrote data/wire_asa.json: {len(wire)} rows')

if __name__ == '__main__':
    main()
