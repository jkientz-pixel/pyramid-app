#!/usr/bin/env python3
"""Stamp the ASA game id (gid) onto existing data/wire_asa.json rows.

fetch_asa_games.py writes gid on every row it emits from now on, but it also
re-walks the ratings, which is not something to run just to add a key. This
matches each existing wire row to an ASA game by league + date + score +
team name and writes the id back. Rows it cannot match are left as they are
(the panel falls back to the Elo-only tier for them). Safe to re-run."""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_asa_games import LEAGUES, get, norm, BRIDGE

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, 'data', 'wire_asa.json')


def same_team(wire_name, asa_name):
    a, b = norm(wire_name), norm(asa_name)
    return a == b or BRIDGE.get(b) == a or BRIDGE.get(a) == b or (len(a) >= 6 and (a in b or b in a)) or a[:7] == b[:7]


def main():
    wire = json.load(open(PATH))
    todo = [w for w in wire if not w.get('gid')]
    if not todo:
        print('every row already carries gid'); return
    stamped = 0
    for g, (asa, season) in LEAGUES.items():
        mine = [w for w in todo if w['lg'] == g]
        if not mine: continue
        teams = get(f'/{asa}/teams'); time.sleep(1)
        games = get(f'/{asa}/games?season_name={season}'); time.sleep(1)
        if not teams or not games:
            print(f'{g}: ASA fetch failed', file=sys.stderr); continue
        tname = {t['team_id']: t['team_name'] for t in teams}
        by_key = {}
        for x in games:
            if x.get('status') != 'FullTime': continue
            key = ((x.get('date_time_utc') or '')[:10], x.get('home_score'), x.get('away_score'))
            by_key.setdefault(key, []).append(x)
        n = 0
        for w in mine:
            cands = by_key.get((w['d'], w['s1'], w['s2']), [])
            hit = [x for x in cands if same_team(w['t1'], tname.get(x['home_team_id'], ''))
                   and same_team(w['t2'], tname.get(x['away_team_id'], ''))]
            if len(hit) == 1:
                w['gid'] = hit[0]['game_id']; n += 1
        print(f'{g}: stamped {n} of {len(mine)}')
        stamped += n
    json.dump(wire, open(PATH, 'w'), separators=(',', ':'))
    print(f'wrote {PATH}: {stamped} rows gained gid, {sum(1 for w in wire if not w.get("gid"))} still without')


if __name__ == '__main__':
    main()
