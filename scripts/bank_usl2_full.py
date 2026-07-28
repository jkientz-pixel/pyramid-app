#!/usr/bin/env python3
"""Full-season USL2 bank via Modular11 TEAM pages (the weekly schedule API
silently truncates — team pages list every fixture).

1. BFS team pages from known team ids -> data/usl2_matches.json
   (mid -> date, bracket, group/division, home/away tid+name, score).
2. Scrape lineups for played matches missing from data/usl2_lineups.json.
Resumable/idempotent: skips banked match ids; team names cached.
"""
import json, re, time, urllib.request, pathlib, sys, datetime

ROOT = pathlib.Path(__file__).resolve().parent.parent
LINEUPS = ROOT / 'data' / 'usl2_lineups.json'
MATCHES = ROOT / 'data' / 'usl2_matches.json'
UA = {'User-Agent': 'RankXI/1.0 (jkientz@gmail.com; banking public league data)'}
BASE = 'https://www.modular11.com'

def get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode('utf-8', 'replace')

state = json.loads(LINEUPS.read_text()) if LINEUPS.exists() else {'matches': {}}
sched = json.loads(MATCHES.read_text()) if MATCHES.exists() else {'teams': {}, 'matches': {}}

# seed = verified USL2 team ids ONLY (tournament=24 sources); NO BFS —
# team pages mix in other Modular11 competitions, expanding runs away.
import json as _j
seed = set(_j.loads((ROOT / 'data' / 'usl2_rosters.json').read_text())['teams'])
for m in state['matches'].values():
    for t in m['teams']:
        seed.add(t['team_id'])
sched['matches'] = {}  # rebuild clean (prior run polluted with other leagues)

ROW_TEAM = re.compile(r'/league-schedule/teams/(\d+)"[^>]*>\s*<p data-title="([^"]+)"')
queue, seen_teams = list(seed), set()
while queue:
    tid = queue.pop()
    if tid in seen_teams:
        continue
    seen_teams.add(tid)
    try:
        h = get(f'{BASE}/league-schedule/teams/{tid}')
    except Exception as e:
        print('TEAM ERR', tid, e, file=sys.stderr); time.sleep(0.4); continue
    rows = 0
    for chunk in h.split('<!-- desktop version -->'):
        mid_m = re.search(r'/match_details/(\d+)/2', chunk)
        if not mid_m:
            continue
        pairs = ROW_TEAM.findall(chunk)
        if len(pairs) < 2:
            continue
        br = re.search(r'js-match-bracket="([^"]*)"', chunk)
        gr = re.search(r'js-match-group="([^"]*)"', chunk)
        dt = re.search(r'(\d{2}/\d{2}/\d{2} \d{2}:\d{2}[ap]m)', chunk)
        sc = re.search(r'score-match-table">\s*(\d+)\s*&nbsp;?:&nbsp;?\s*(\d+)', chunk)
        mid = mid_m.group(1)
        if pairs[0][0] not in seed or pairs[1][0] not in seed:
            continue  # cross-competition fixture, not USL2
        sched['matches'][mid] = {
            'date': dt.group(1) if dt else '',
            'bracket': br.group(1) if br else '',
            'group': gr.group(1) if gr else '',
            'home': pairs[0][0], 'away': pairs[1][0],
            'score': f'{sc.group(1)}:{sc.group(2)}' if sc else ''}
        rows += 1
        for t2, nm in pairs:
            sched['teams'][t2] = nm.strip()
    print(f'team {tid} ({sched["teams"].get(tid, "?")}): {rows} rows; '
          f'{len(sched["matches"])} matches, {len(seen_teams)}/{len(seen_teams)+len(queue)} teams', flush=True)
    MATCHES.write_text(json.dumps(sched))
    time.sleep(0.4)

played = {mid for mid, m in sched['matches'].items() if m['score']}
todo = sorted(played - set(state['matches']))
print(f'TEAM PHASE DONE: {len(sched["teams"])} teams, {len(sched["matches"])} matches, '
      f'{len(played)} played, {len(todo)} lineups to fetch', flush=True)

TEAM_RE = re.compile(r'js-team-number-details="(\d+)"')
PLAYER_RE = re.compile(r'data-title="([^"]+)">[^<]*</p>.*?<span[^>]*pad-left">\s*(\d{4})?\s*</span>.*?player-(\d+)', re.S)
done = 0
for mid in todo:
    try:
        h = get(f'{BASE}/match_details/{mid}/2')
    except Exception as e:
        print('MATCH ERR', mid, e, file=sys.stderr); time.sleep(0.4); continue
    teams = []
    blocks = TEAM_RE.split(h)
    for bi in range(1, len(blocks) - 1, 2):
        team_id, body = blocks[bi], blocks[bi + 1]
        starting, reserves = [], []
        parts = re.split(r'<h4>\s*Reserve players\s*</h4>', body)
        for section, bucket in ((parts[0], starting), (parts[1] if len(parts) > 1 else '', reserves)):
            for pm in PLAYER_RE.finditer(section):
                bucket.append({'n': pm.group(1).strip(), 'y': pm.group(2) or '', 'pid': pm.group(3)})
        teams.append({'team_id': team_id, 'starting': starting, 'reserves': reserves})
    sm = sched['matches'][mid]
    state['matches'][mid] = {'week': sm['date'][:8], 'score': sm['score'],
                             'home': sm['home'], 'away': sm['away'], 'teams': teams,
                             'raw_names': []}
    done += 1
    if done % 25 == 0:
        LINEUPS.write_text(json.dumps(state))
        print(f'{done}/{len(todo)} new lineups banked ({len(state["matches"])} total)', flush=True)
    time.sleep(0.4)

LINEUPS.write_text(json.dumps(state))
withl = sum(1 for m in state['matches'].values() if any(t['starting'] for t in m['teams']))
print(f'FINISHED: {len(state["matches"])} matches banked, {withl} with lineups', flush=True)
