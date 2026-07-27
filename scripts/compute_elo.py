#!/usr/bin/env python3
"""Truth layer v1: compute real Elo ratings from NPSL match results and
flag UPSL clubs whose ratings derive from real standings. Updates js/data.js:
sets r + rr (1 = result-computed Elo, 2 = standings-derived) on matched clubs."""
import json, re, os, math, sys

def norm(n):
    return re.sub(r'\b(fc|sc|cf|afc|cd|club|the)\b', '', n.lower()).replace(' ', '').strip()

def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    # source of record: npsl_matches_2026.json (scrape_npsl.py output, team names
    # inline). The legacy npsl.json events feed went stale and no longer parses.
    matches = json.load(open(os.path.join(root, 'data', 'npsl_matches_2026.json')))
    team_name = {}

    events = []
    for m in matches:
        if m.get('status') != 'ENDED': continue
        if not isinstance(m.get('s1'), int) or not isinstance(m.get('s2'), int): continue
        if not str(m.get('start', '')).startswith('2026'): continue
        events.append((m['start'], m['t1'], m['t2'], m['s1'], m['s2']))
        team_name[m['t1']] = m['t1']; team_name[m['t2']] = m['t2']
    events.sort()
    print(f'NPSL 2026 completed matches with scores: {len(events)}', file=sys.stderr)

    elo = {}
    played = {}
    wire = []
    K = 40
    for date, h, a, hg, ag in events:
        rh, ra = elo.get(h, 1500), elo.get(a, 1500)
        eh = 1 / (1 + 10 ** ((ra - (rh + 50)) / 400))
        sh = 1.0 if hg > ag else 0.0 if hg < ag else 0.5
        margin = math.log(abs(hg - ag) + 1) or 1
        delta = K * margin * (sh - eh)
        # wire feed row: pre-match ratings (+100 display band), the rating change
        # this match caused, and the pre-match home expectation for upset tagging
        if team_name.get(h) and team_name.get(a):
            wire.append({'d': date[:10], 't1': team_name[h], 't2': team_name[a],
                         's1': hg, 's2': ag, 'r1': round(rh + 100), 'r2': round(ra + 100),
                         'dr': round(delta), 'ph': round(eh, 2),
                         'gp': min(played.get(h, 0), played.get(a, 0))})
        elo[h] = rh + delta; elo[a] = ra - delta
        played[h] = played.get(h, 0) + 1; played[a] = played.get(a, 0) + 1
    json.dump(wire, open(os.path.join(root, 'data', 'wire_npsl.json'), 'w'),
              separators=(',', ':'))
    print(f'wire feed: {len(wire)} rated results -> data/wire_npsl.json', file=sys.stderr)

    rated = {norm(team_name[t]): round(elo[t] + 100)  # +100 shifts NPSL band vs demo base
             for t in elo if played.get(t, 0) >= 3 and t in team_name}
    print(f'clubs with >=3 real matches: {len(rated)}', file=sys.stderr)

    upsl = json.load(open(os.path.join(root, 'data', 'upsl.json')))
    upsl_names = {norm(r['team']) for t in upsl for r in t['rows']}

    dpath = os.path.join(root, 'js', 'data.js')
    cur = open(dpath).read()
    clubs = json.loads(re.search(r'export const CLUBS=(\[.*?\]);', cur, re.S).group(1))
    n_elo = n_st = 0
    for c in clubs:
        k = norm(c['n'])
        if c['g'] == 'npsl' and k in rated:
            c['r'] = max(1400, min(1900, rated[k])); c['rr'] = 1; n_elo += 1
        elif c['g'] == 'upsl' and k in upsl_names and 'img' not in c:
            c['rr'] = 2; n_st += 1
    print(f'applied: {n_elo} real-Elo NPSL clubs, {n_st} standings-flagged UPSL clubs')
    cur = cur[:cur.index('export const CLUBS=')] + 'export const CLUBS=' + \
        json.dumps(clubs, ensure_ascii=False, separators=(',', ':')) + ';\n' + \
        cur[cur.index('export const REGIONS='):]
    open(dpath, 'w').write(cur)

if __name__ == '__main__':
    main()
