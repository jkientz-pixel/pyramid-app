#!/usr/bin/env python3
"""Turn banked USL League Two lineups into per-club appearance counts at
data/usl2_appearances.json, plus a per-club match log at
data/usl2_player_logs.json that the player pages read.

data/usl2_lineups.json holds the starting eleven and reserves for 1,039
matches — who actually played, which nothing in the app has ever shown. This
collapses it to squads: starts, appearances off the bench, and total matches
in a matchday squad, per club. Every player row carries the league's own
player id (pid), which is what #/player/<club>/u<pid> routes on.

data/usl2_sheet_extras.json (scripts/scrape_usl2_sheet_extras.py) adds the
shirt number next to each player on each sheet and the staff block the club
listed. A player's number is published only when the same number appears on
more than half of their sheets — USL2 squads reshuffle numbers week to week,
and a guessed one is worse than none. Staff are ordered by how many sheets
they were listed on. Positions do not exist anywhere in the source and are
not invented.

Birth years are deliberately absent from both outputs. The source file carries
them for adults and blanks them for minors (scripts/redact_minors.py), and an
appearance count needs neither, so the published artefacts simply have no age
field to get wrong.

Club matching reuses compute_elo_usl2.py's norm() and HAND_MAP rather than
inventing a third rule — that pairing is what the league's Elo already runs on,
so a club that rates here resolves here."""
import json, os, re, sys, collections, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
from compute_elo_usl2 import norm, HAND_MAP        # noqa: E402  (single source of truth)

DATA = os.path.join(ROOT, 'data')
lineups = json.load(open(os.path.join(DATA, 'usl2_lineups.json')))['matches']
bank = json.load(open(os.path.join(DATA, 'usl2_matches.json')))
team_name = bank['teams']
sched = bank['matches']
extras_path = os.path.join(DATA, 'usl2_sheet_extras.json')
extras = json.load(open(extras_path))['matches'] if os.path.exists(extras_path) else {}

src = open(os.path.join(ROOT, 'js', 'data.js')).read()
CLUBS = json.loads(re.search(r'export const CLUBS=(\[.*?\]);', src, re.S).group(1))
by_norm = {norm(c['n']): c for c in CLUBS if c.get('g') == 'usl2' and not c.get('h')}

tid_club = {}
for tid, nm in team_name.items():
    key = norm(HAND_MAP.get(nm, nm))
    if key in by_norm:
        tid_club[tid] = by_norm[key]


def iso_date(raw):
    """'05/03/26 03:00pm' -> '2026-05-03'; unknown shapes pass through."""
    try:
        return datetime.datetime.strptime(raw[:8], '%m/%d/%y').date().isoformat()
    except (ValueError, TypeError):
        return raw or ''


def match_order(mid):
    return (iso_date(sched.get(mid, {}).get('date', '')), mid)


squads = {}       # club id -> {'club', 'players': {pid: rec}, 'staff': {sid: rec}, 'games': []}
for mid in sorted(lineups, key=match_order):
    m = lineups[mid]
    meta = sched.get(mid, {})
    ex = {t['team_id']: t for t in extras.get(mid, {}).get('teams', [])}
    seen = set()
    for t in m.get('teams', []):
        tid = t.get('team_id')
        club = tid_club.get(tid)
        if not club or tid in seen or not (t.get('starting') or t.get('reserves')):
            continue                       # staff-only duplicate block / unmatched team
        seen.add(tid)
        sq = squads.setdefault(club['id'], {'club': club['n'], 'players': {}, 'staff': {}, 'games': []})
        is_home = meta.get('home') == tid
        opp_tid = meta.get('away') if is_home else meta.get('home')
        opp_club = tid_club.get(opp_tid)
        score = (m.get('score') or meta.get('score') or '').split(':')
        gf, ga = (int(score[0]), int(score[1])) if len(score) == 2 and all(s.isdigit() for s in score) else (None, None)
        if not is_home and gf is not None:
            gf, ga = ga, gf
        gi = len(sq['games'])
        sq['games'].append([iso_date(meta.get('date', m.get('week', ''))),
                            opp_club['id'] if opp_club else team_name.get(opp_tid, '?'),
                            gf, ga, 1 if is_home else 0, meta.get('bracket', '')])
        numbers = ex.get(tid, {}).get('numbers', {})
        for group, field, flag in (('starting', 'st', 1), ('reserves', 'sub', 0)):
            for p in t.get(group) or []:
                name, pid = (p.get('n') or '').strip(), str(p.get('pid') or '')
                if not name or not pid:
                    continue
                rec = sq['players'].setdefault(pid, {'n': name, 'pid': pid, 'st': 0, 'sub': 0,
                                                     '_nums': collections.Counter(), '_log': []})
                rec[field] += 1
                rec['_log'].append([gi, flag])
                if numbers.get(pid) and numbers[pid] != '0':   # 0 is the platform's 'no number'
                    rec['_nums'][numbers[pid]] += 1
        for s in ex.get(tid, {}).get('staff', []):
            key = s['sid']
            st = sq['staff'].setdefault(key, {'n': s['n'], 'role': s['role'], 'sid': key, 'g': 0})
            st['g'] += 1
            if s['role'] and not st['role']:
                st['role'] = s['role']

out, logs = {}, {}
for cid, sq in squads.items():
    players = []
    for rec in sq['players'].values():
        row = {'n': rec['n'], 'pid': rec['pid'], 'st': rec['st'], 'sub': rec['sub']}
        if rec['_nums']:
            num, cnt = rec['_nums'].most_common(1)[0]
            if cnt * 2 > rec['st'] + rec['sub']:
                row['num'] = num
        players.append(row)
    players.sort(key=lambda p: (-(p['st'] + p['sub']), -p['st'], p['n']))
    staff = sorted(sq['staff'].values(), key=lambda s: (-s['g'], s['n']))
    entry = {'club': sq['club'], 'players': players}
    if staff:
        entry['staff'] = staff
    out[cid] = entry
    logs[cid] = {'m': sq['games'], 'p': {pid: rec['_log'] for pid, rec in sq['players'].items()}}

unmatched = sorted({team_name[t] for t in team_name if t not in tid_club})
matched_rows = sum(len(v['players']) for v in out.values())
numbered = sum(1 for v in out.values() for p in v['players'] if 'num' in p)
staff_rows = sum(len(v.get('staff', [])) for v in out.values())
print(f'  clubs matched: {len(tid_club)}/{len(team_name)}')
print(f'  squads written: {len(out)} · {matched_rows} player rows · {numbered} with a usual number · {staff_rows} staff')
print(f'  sheet extras: {len(extras)} matches' if extras else '  sheet extras: none (run scrape_usl2_sheet_extras.py for numbers + staff)')
if unmatched:
    print(f'  unmatched teams ({len(unmatched)}): {unmatched}')

assert not any('y' in p for v in out.values() for p in v['players']), \
    'appearance output must carry no birth years'

path = os.path.join(DATA, 'usl2_appearances.json')
json.dump(out, open(path, 'w'), separators=(',', ':'), sort_keys=True)
print(f'wrote {path}')
path = os.path.join(DATA, 'usl2_player_logs.json')
json.dump(logs, open(path, 'w'), separators=(',', ':'), sort_keys=True)
print(f'wrote {path} ({os.path.getsize(path) // 1024} KB)')
