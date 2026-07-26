#!/usr/bin/env python3
"""American Soccer Analysis integration (free public API):
- real player season stats (minutes, goals, assists, xG, key passes)
- real rosters for USLC/USL1/MLSNP/NWSL built from players with minutes
- enrich existing MLS rosters (keeps Wikipedia links/photos)
- NWSL team ratings from real points
Writes js/rosters.js (st fields) and js/data.js (nwsl ratings)."""
import json, re, urllib.request, time, os, sys, unicodedata

B = 'https://app.americansocceranalysis.com/api/v1'
UA = {'User-Agent': 'RankXI/0.1 (jkientz@gmail.com; ASA integration)'}
# league key -> (ASA slug, season name). USL Super League runs fall-spring, so its
# season is named '2025-26' on ASA while the calendar-year leagues use '2026'.
LEAGUES = {'mls': ('mls', '2026'), 'uslc': ('uslc', '2026'), 'usl1': ('usl1', '2026'),
           'mnp': ('mlsnp', '2026'), 'nwsl': ('nwsl', '2026'), 'uslw': ('usls', '2025-26')}

def get(path):
    for _ in range(3):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(B + path, headers=UA), timeout=30))
        except Exception as e:
            time.sleep(5)
    return None

def deacc(x): return unicodedata.normalize('NFKD', x).encode('ascii', 'ignore').decode()
def norm(n): return re.sub(r'\b(fc|sc|cf|afc|cd|club|the)\b', '', deacc(n).lower()).replace(' ', '').replace('.', '')

BRIDGE = {'losangeles': 'lafc', 'newyorkcity': 'nycfc', 'montreal': 'cfmontreal'}

def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    rpath = os.path.join(root, 'js', 'rosters.js')
    rjs = open(rpath).read()
    rosters = json.loads(re.search(r'export const ROSTERS=(\{.*?\});', rjs, re.S).group(1))
    coaches = json.loads(re.search(r'export const COACHES=(\{.*?\});', rjs, re.S).group(1))
    honours = json.loads(re.search(r'export const HONOURS=(\{.*?\});', rjs, re.S).group(1))
    dpath = os.path.join(root, 'js', 'data.js')
    cur = open(dpath).read()
    clubs = json.loads(re.search(r'export const CLUBS=(\[.*?\]);', cur, re.S).group(1))
    club_by_norm = {}
    for c in clubs:
        club_by_norm.setdefault(c['g'] + ':' + norm(c['n']), c)

    POSMAP = {'GK': 'GK', 'CB': 'DF', 'FB': 'DF', 'DF': 'DF', 'DM': 'MF', 'CM': 'MF',
              'AM': 'MF', 'MF': 'MF', 'W': 'FW', 'ST': 'FW', 'FW': 'FW'}
    total_stats = 0
    dup_names = {n for n in {c['n'] for c in clubs}
                 if len({c2['g'] for c2 in clubs if c2['n'] == n}) > 1}
    # migrate legacy plain-key entries for duplicated names to the men's/NWSL club
    # that originally produced them (uslw entries are always written league-qualified)
    for n in dup_names:
        owner = next((c for c in clubs if c['n'] == n and c['g'] in ('mls', 'uslc', 'usl1', 'mnp', 'nwsl')), None)
        if not owner: continue
        for store in (rosters, coaches, honours):
            if n in store:
                store[owner['g'] + ':' + n] = store.pop(n)
    for g, (asa, season) in LEAGUES.items():
        teams = get(f'/{asa}/teams'); time.sleep(1)
        players = get(f'/{asa}/players'); time.sleep(1)
        px = get(f'/{asa}/players/xgoals?season_name={season}'); time.sleep(1)
        gx = get(f'/{asa}/goalkeepers/xgoals?season_name={season}') or []; time.sleep(1)
        if not teams or not players or not px:
            print(f'{g}: ASA fetch failed', file=sys.stderr); continue
        tname = {t['team_id']: t['team_name'] for t in teams}
        pname = {p['player_id']: (p.get('player_name') or p.get('name')) for p in players if p.get('player_id')}
        by_team = {}
        for row in px:
            tid = row.get('team_id'); pid = row.get('player_id')
            if isinstance(tid, list): tid = tid[0] if tid else None
            if not tid or not pid or not row.get('minutes_played'): continue
            nm = pname.get(pid)
            if not nm: continue
            st = {'min': row['minutes_played'], 'g': row.get('goals') or 0,
                  'a': row.get('primary_assists') or 0,
                  'xg': round(row.get('xgoals') or 0, 1), 'kp': row.get('key_passes') or 0,
                  'sh': row.get('shots') or 0, 'sot': row.get('shots_on_target') or 0,
                  'xa': round(row.get('xassists') or 0, 1)}
            pos = POSMAP.get((row.get('general_position') or '').upper(), 'MF')
            by_team.setdefault(tid, {})[nm] = (pos, st)
        for row in gx:
            tid = row.get('team_id'); pid = row.get('player_id')
            if isinstance(tid, list): tid = tid[0] if tid else None
            nm = pname.get(pid)
            if not tid or not nm or not row.get('minutes_played'): continue
            st = {'min': row['minutes_played'], 'g': 0, 'a': 0,
                  'xg': 0, 'kp': 0, 'sv': row.get('saves') or 0,
                  'gc': row.get('goals_conceded') or 0, 'sf': row.get('shots_faced') or 0}
            by_team.setdefault(tid, {})[nm] = ('GK', st)
        applied_clubs = 0
        for tid, plist in by_team.items():
            club = club_by_norm.get(g + ':' + norm(tname.get(tid, '')))
            if not club:
                k = norm(tname.get(tid, ''))
                club = club_by_norm.get(g + ':' + BRIDGE.get(k, ''))
            if not club:
                cand = [c2 for k2, c2 in club_by_norm.items()
                        if k2.startswith(g + ':') and (norm(tname.get(tid, ''))[:7] in k2 or k2.split(':')[1][:7] in norm(tname.get(tid, '')))]
                club = cand[0] if len(cand) == 1 else None
            if not club: continue
            # clubs sharing a name across leagues (e.g. Lexington SC in USLC and USLS)
            # get league-qualified roster keys so the two squads never collide
            rkey = club['g'] + ':' + club['n'] if club['n'] in dup_names else club['n']
            existing = rosters.get(rkey)
            if existing:
                nmap = {deacc(p['name']).lower(): p for p in existing}
                for nm, (pos, st) in plist.items():
                    p = nmap.get(deacc(nm).lower())
                    if p: p['st'] = st
            else:
                roster = []
                for nm, (pos, st) in sorted(plist.items(), key=lambda kv: -kv[1][1]['min']):
                    roster.append({'num': None, 'pos': pos, 'name': nm, 'nat': None,
                                   'wiki': None, 'st': st})
                rosters[rkey] = roster
            applied_clubs += 1
            total_stats += len(plist)
        print(f'{g}: real stats for {applied_clubs} clubs')
        # NWSL ratings from real team points
        if g == 'nwsl':
            tx = get(f'/{asa}/teams/xgoals?season_name=2026'); time.sleep(1)
            if tx:
                napp = 0
                for row in tx:
                    club = club_by_norm.get('nwsl:' + norm(tname.get(row['team_id'], '')))
                    if not club:
                        k = norm(tname.get(row['team_id'], ''))
                        cand = [c2 for k2, c2 in club_by_norm.items() if k2.startswith('nwsl:') and (k[:6] in k2 or k2.split(':')[1][:6] in k)]
                        club = cand[0] if len(cand) == 1 else None
                    if club and row.get('points') is not None:
                        club['r'] = 1820 + row['points'] * 3 + (row.get('goal_difference') or 0)
                        club['rr'] = 2; napp += 1
                print(f'nwsl ratings applied: {napp}')
    out = ('// generated by scripts/refresh_rosters.py + fetch_asa.py - do not edit\n'
           'export const ROSTERS=' + json.dumps(rosters, ensure_ascii=False, separators=(',', ':')) +
           ';\nexport const COACHES=' + json.dumps(coaches, ensure_ascii=False) +
           ';\nexport const HONOURS=' + json.dumps(honours, ensure_ascii=False, separators=(',', ':')) + ';\n')
    open(rpath, 'w').write(out)
    cur = cur[:cur.index('export const CLUBS=')] + 'export const CLUBS=' + \
        json.dumps(clubs, ensure_ascii=False, separators=(',', ':')) + ';\n' + \
        cur[cur.index('export const REGIONS='):]
    open(dpath, 'w').write(cur)
    print(f'total player stat lines: {total_stats}; rosters now cover {len(rosters)} clubs')

if __name__ == '__main__':
    main()
