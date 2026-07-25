#!/usr/bin/env python3
"""Truth layer v1: compute real Elo ratings from NPSL match results and
flag UPSL clubs whose ratings derive from real standings. Updates js/data.js:
sets r + rr (1 = result-computed Elo, 2 = standings-derived) on matched clubs."""
import json, re, os, math, sys

def norm(n):
    return re.sub(r'\b(fc|sc|cf|afc|cd|club|the)\b', '', n.lower()).replace(' ', '').strip()

def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    npsl = json.load(open(os.path.join(root, 'data', 'npsl.json')))
    team_name = {t['id']: t['name'] for t in npsl['teams']}

    events = []
    for e in npsl['events']:
        if e.get('status') != 'publish': continue
        teams = e.get('teams') or []
        score = e.get('score') or []
        if len(teams) != 2 or len(score) < 2: continue
        try:
            hg, ag = int(score[0]), int(score[1])
        except (ValueError, TypeError):
            continue
        if not e.get('date', '').startswith('2026'): continue
        events.append((e['date'], teams[0], teams[1], hg, ag))
    events.sort()
    print(f'NPSL 2026 completed matches with scores: {len(events)}', file=sys.stderr)

    elo = {}
    played = {}
    K = 40
    for date, h, a, hg, ag in events:
        rh, ra = elo.get(h, 1500), elo.get(a, 1500)
        eh = 1 / (1 + 10 ** ((ra - (rh + 50)) / 400))
        sh = 1.0 if hg > ag else 0.0 if hg < ag else 0.5
        margin = math.log(abs(hg - ag) + 1) or 1
        delta = K * margin * (sh - eh)
        elo[h] = rh + delta; elo[a] = ra - delta
        played[h] = played.get(h, 0) + 1; played[a] = played.get(a, 0) + 1

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
