#!/usr/bin/env python3
"""Aggregate banked USL2 lineups into per-club player rosters (v2).

Sources: data/usl2_matches.json (schedule: date/division/bracket/score/teams)
         data/usl2_lineups.json (per-match starting/reserve lists)
Join:    Modular11 team name -> data.js club, global best-score assignment
         (not greedy first-come) + manual alias table; searches usl2 clubs
         first, then clubs filed under other leagues (2026 USL2 movers whose
         data.js league label is stale — reported, not changed here).
Output:  data/usl2_rosters.json
"""
import json, re, unicodedata, collections, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sched = json.loads((ROOT / 'data' / 'usl2_matches.json').read_text())
lineups = json.loads((ROOT / 'data' / 'usl2_lineups.json').read_text())['matches']
team_name = sched['teams']

# ---- aggregate appearances (league + playoffs, tagged) ----
apps = collections.defaultdict(lambda: collections.defaultdict(
    lambda: {'n': '', 'y': '', 'starts': 0, 'res': 0}))
games = collections.Counter()
for mid, m in lineups.items():
    meta = sched['matches'].get(mid)
    seen = set()
    for t in m['teams']:
        tid = t['team_id']
        if tid in seen or not (t['starting'] or t['reserves']):
            continue  # staff-section duplicate / empty block
        seen.add(tid)
        games[tid] += 1
        for p in t['starting']:
            r = apps[tid][p['pid']]
            r['n'] = r['n'] or p['n']; r['y'] = r['y'] or p['y']; r['starts'] += 1
        for p in t['reserves']:
            r = apps[tid][p['pid']]
            r['n'] = r['n'] or p['n']; r['y'] = r['y'] or p['y']; r['res'] += 1

# ---- club join ----
def deacc(x): return unicodedata.normalize('NFKD', x).encode('ascii', 'ignore').decode()
STOP = {'fc', 'sc', 'cf', 'afc', 'the', 'of', 'club', 'soccer', 'football',
        'pre', 'professional', 'u23', 'usl', 'league', 'two', '2'}
def toks(s): return set(re.findall(r'[a-z0-9]+', deacc(s).lower())) - STOP

ALIAS = {  # Modular11 name -> data.js club name
    'NEFC': 'New England Fútbol Club',
    'LVU Rush': 'Lehigh Valley United',
    'PA Classics': 'Pennsylvania Classics AC',
    'Patuxent FA': 'Patuxent Football Athletics',
    'FC Motown STA': 'FC Motown',
    'Charlotte Independence 2': 'Charlotte Independence II',
    'GFI': 'Global Football Innovation Academy',
    'Real Central NJ': 'Real Central NJ (2026)',
}

src = (ROOT / 'js' / 'data.js').read_text()
clubs = json.loads(re.search(r'export const CLUBS=(\[.*?\]);', src, re.S).group(1))
by_name = {c['n']: c for c in clubs}
usl2 = [c for c in clubs if c['g'] == 'usl2' and not c.get('h')]  # tombstones never own a squad
NONLEAGUE_OK = ('upsl', 'npsl', 'nisa', 'loc')  # stale-label pools to fall back on

cands = []
for tid, nm in team_name.items():
    if nm in ALIAS and ALIAS[nm] in by_name:
        cands.append((2.0, tid, by_name[ALIAS[nm]])); continue
    nt = toks(nm)
    if not nt: continue
    for pool_rank, pool in ((1, usl2), (0, [c for c in clubs if c['g'] in NONLEAGUE_OK and not c.get('h')])):
        for c in pool:
            ct = toks(c['n'])
            if not ct: continue
            # Jaccard, not len(∩)/min(): the latter scores 'FC Davis' a perfect
            # 1.0 against 'Davis Legacy SC' because the shorter name is a subset,
            # which silently attributed a whole squad to the wrong club.
            jac = len(nt & ct) / len(nt | ct)
            if jac < 0.5: continue
            exact = 1.0 if nt == ct else 0.0
            cands.append((jac + exact + pool_rank, tid, c))
cands.sort(key=lambda x: -x[0])
club_by_tid, used = {}, set()
for score, tid, c in cands:
    if tid in club_by_tid or c['id'] in used: continue
    club_by_tid[tid] = (c['id'], c['g'], score)
    used.add(c['id'])
LOW = {t: v for t, v in club_by_tid.items() if v[2] % 1 < 0.999 and v[2] < 2.0}

out = {'season': 2026, 'source': 'modular11 USL League Two match reports',
       'fetched': '2026-07-28', 'teams': {}}
stale, unmatched = [], []
for tid in sorted(team_name, key=lambda t: -games[t]):
    hit = club_by_tid.get(tid)
    if hit and hit[1] != 'usl2':
        stale.append((team_name[tid], hit[0], hit[1]))
    if not hit and games[tid]:
        unmatched.append((tid, team_name[tid], games[tid]))
    plist = sorted(apps[tid].items(), key=lambda kv: (-kv[1]['starts'], -kv[1]['res']))
    out['teams'][tid] = {
        'name': team_name[tid], 'club': hit[0] if hit else '',
        'club_league': hit[1] if hit else '', 'games': games[tid],
        'players': [{'pid': pid, **rec} for pid, rec in plist]}

(ROOT / 'data' / 'usl2_rosters.json').write_text(json.dumps(out, ensure_ascii=False))
tp = sum(len(t['players']) for t in out['teams'].values())
withg = sum(1 for t in out['teams'].values() if t['games'])
print(f'WROTE usl2_rosters.json: {withg} teams with games, {tp} players, '
      f'{sum(games.values())} team-games over {len(lineups)} matches')
print(f'{len(stale)} clubs matched under STALE league labels (now play USL2):')
for nm, cid, g in stale: print(f'  {nm} -> {cid} [{g}]')
print(f'{len(unmatched)} teams UNMATCHED (need new data.js entries or aliases):')
for tid, nm, g in unmatched: print(f'  {tid} {nm} ({g} games)')
print(f'{len(LOW)} FUZZY matches — confirm before publishing:')
for tid, (cid, g, sc) in sorted(LOW.items(), key=lambda kv: kv[1][2]):
    print(f'  {team_name[tid]!r} -> {cid} [{g}]  score={sc:.2f}')
