#!/usr/bin/env python3
"""Re-read the banked USL League Two match reports for the two things
scrape_usl2_lineups.py threw away: the shirt number next to every player, and
the staff block (name + role) each club listed on the team sheet.

Input:  data/usl2_lineups.json  — the match ids already banked (nothing new is
        enumerated here; this is a second pass over the same public pages)
Output: data/usl2_sheet_extras.json
        {"matches": {mid: {"teams": [{"team_id", "numbers": {pid: "7"},
                                      "staff": [{"n", "role", "sid"}]}]}}}

Resumable: the output is rewritten every 25 matches and matches already
present are skipped, so a killed run picks up where it stopped. Positions are
NOT on these pages — the league's sheets publish name, birth year, number and
staff role only — so nothing here invents one."""
import json, os, re, sys, time, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = 'https://www.modular11.com'
UA = {'User-Agent': 'RankXI/1.0 (jkientz@gmail.com; banking public league data)'}
OUT = os.path.join(ROOT, 'data', 'usl2_sheet_extras.json')

TEAM_RE = re.compile(r'js-team-number-details="(\d+)"')
PLAYER_RE = re.compile(
    r'data-title="([^"]+)">.*?player-(\d+)"></span>.*?ticket--number">\s*([^<\s]*)\s*</p>', re.S)
STAFF_RE = re.compile(
    r'team_manager/(\d+)/.*?staff-info">.*?data-title="([^"]+)".*?<span>([^<]*)</span>', re.S)


def get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode('utf-8', 'replace')


def parse(h):
    teams = []
    blocks = TEAM_RE.split(h)
    for bi in range(1, len(blocks) - 1, 2):
        team_id, body = blocks[bi], blocks[bi + 1]
        body = body.split('<h3>Referees</h3>')[0]      # officials are not club staff
        rec = next((t for t in teams if t['team_id'] == team_id), None)
        if rec is None:
            rec = {'team_id': team_id, 'numbers': {}, 'staff': []}
            teams.append(rec)
        if 'staff-content' in body:
            for sid, name, role in STAFF_RE.findall(body):
                name, role = name.strip(), role.strip()
                if name and not any(s['sid'] == sid for s in rec['staff']):
                    rec['staff'].append({'n': name, 'role': role, 'sid': sid})
        else:
            for name, pid, num in PLAYER_RE.findall(body):
                if num.isdigit():
                    rec['numbers'][pid] = num
    return teams


def main():
    mids = list(json.load(open(os.path.join(ROOT, 'data', 'usl2_lineups.json')))['matches'])
    state = json.load(open(OUT)) if os.path.exists(OUT) else {'matches': {}}
    todo = [m for m in mids if m not in state['matches']]
    print(f'{len(mids)} banked matches, {len(todo)} to fetch', flush=True)
    done = 0
    for mid in todo:
        try:
            h = get(f'{BASE}/match_details/{mid}/2')
        except Exception as e:                       # noqa: BLE001 — log and move on
            print('MATCH ERR', mid, e, file=sys.stderr, flush=True)
            time.sleep(1.5)
            continue
        state['matches'][mid] = {'teams': parse(h)}
        done += 1
        if done % 25 == 0:
            json.dump(state, open(OUT, 'w'), separators=(',', ':'))
            print(f'{done} fetched ({len(state["matches"])} total)', flush=True)
        time.sleep(0.4)
    json.dump(state, open(OUT, 'w'), separators=(',', ':'))
    staff = sum(len(t['staff']) for m in state['matches'].values() for t in m['teams'])
    nums = sum(len(t['numbers']) for m in state['matches'].values() for t in m['teams'])
    print(f'FINISHED: {len(state["matches"])} matches · {nums} numbered slots · {staff} staff rows', flush=True)


if __name__ == '__main__':
    main()
