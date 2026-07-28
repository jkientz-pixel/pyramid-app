#!/usr/bin/env python3
"""Bank USL League Two 2026 per-match lineups from Modular11 (public pages).

Phase 1: schedule fragments via /public_schedule/league/get_matches
         (tournament=24 = USL League Two, status=all, weekly windows).
Phase 2: /match_details/<id>/2 pages -> per-team starting/reserve lists
         with player name, birth year, and Modular11 global player id.
Output:  data/usl2_lineups.json, written incrementally every 25 matches.
Polite:  0.4s between requests, custom UA.
"""
import json, re, time, urllib.request, pathlib, sys, datetime

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'usl2_lineups.json'
UA = {'User-Agent': 'RankXI/1.0 (jkientz@gmail.com; banking public league data)'}
BASE = 'https://www.modular11.com'

def get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode('utf-8', 'replace')

state = json.loads(OUT.read_text()) if OUT.exists() else {'matches': {}}

# Phase 1: enumerate matches across the season in weekly windows
ids = {}
d = datetime.date(2026, 4, 6)
while d < datetime.date(2026, 8, 16):
    d2 = d + datetime.timedelta(days=7)
    url = (f'{BASE}/public_schedule/league/get_matches?open_page=0&academy=0&tournament=24'
           f'&gender=0&age=0&brackets=&groups=&group=&match_number=0&status=all&match_type=2'
           f'&schedule=0&teamPlayer=0&location=0&as_referee=0&report_status=0'
           f'&start_date={d}+00%3A00%3A00&end_date={d2}+23%3A59%3A59')
    try:
        frag = get(url)
    except Exception as e:
        print('SCHED ERR', d, e, file=sys.stderr); d = d2; continue
    for m in re.finditer(r'/match_details/(\d+)/2', frag):
        ids[m.group(1)] = str(d)
    time.sleep(0.4)
    d = d2
print(f'{len(ids)} matches enumerated', flush=True)

# Phase 2: lineups per match
TEAM_RE = re.compile(r'js-team-number-details="(\d+)"')
PLAYER_RE = re.compile(r'data-title="([^"]+)">[^<]*</p>.*?<span[^>]*pad-left">\s*(\d{4})?\s*</span>.*?player-(\d+)', re.S)
done = 0
for mid, wk in ids.items():
    if mid in state['matches']:
        continue
    try:
        h = get(f'{BASE}/match_details/{mid}/2')
    except Exception as e:
        print('MATCH ERR', mid, e, file=sys.stderr); time.sleep(0.4); continue
    title = re.search(r'<title>([^<]*)</title>', h)
    score = re.search(r'(\d+)\s*:\s*(\d+)', h)
    teams = []
    blocks = TEAM_RE.split(h)
    # blocks: [pre, teamId1, html1, teamId2, html2, ...]
    for bi in range(1, len(blocks) - 1, 2):
        team_id, body = blocks[bi], blocks[bi + 1]
        starting, reserves = [], []
        parts = re.split(r'<h4>\s*Reserve players\s*</h4>', body)
        for section, bucket in ((parts[0], starting), (parts[1] if len(parts) > 1 else '', reserves)):
            for pm in PLAYER_RE.finditer(section):
                bucket.append({'n': pm.group(1).strip(), 'y': pm.group(2) or '', 'pid': pm.group(3)})
        teams.append({'team_id': team_id, 'starting': starting, 'reserves': reserves})
    names = re.findall(r'class="container-match-participants--heading[^"]*">\s*<h3>Players</h3>', h)
    tnames = re.findall(r'<p[^>]*class="[^"]*match-title[^"]*"[^>]*>([^<]+)</p>|<h2[^>]*>([^<]+)</h2>', h)
    state['matches'][mid] = {
        'week': wk,
        'score': score.group(0).replace(' ', '') if score else '',
        'teams': teams,
        'raw_names': [a or b for a, b in tnames][:4],
    }
    done += 1
    if done % 25 == 0:
        OUT.write_text(json.dumps(state))
        total_players = sum(len(t['starting']) + len(t['reserves']) for mm in state['matches'].values() for t in mm['teams'])
        print(f'{done} new matches parsed ({len(state["matches"])} total, {total_players} lineup slots)', flush=True)
    time.sleep(0.4)

OUT.write_text(json.dumps(state))
withl = sum(1 for m in state['matches'].values() if any(t['starting'] for t in m['teams']))
print(f'FINISHED: {len(state["matches"])} matches banked, {withl} with lineups', flush=True)
