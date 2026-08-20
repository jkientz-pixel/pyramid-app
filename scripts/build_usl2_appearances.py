#!/usr/bin/env python3
"""Turn banked USL League Two lineups into per-club appearance counts at
data/usl2_appearances.json.

data/usl2_lineups.json holds the starting eleven and reserves for 1,039
matches — who actually played, which nothing in the app has ever shown. This
collapses it to squads: starts, appearances off the bench, and total matches
in a matchday squad, per club.

Birth years are deliberately absent from the output. The source file carries
them for adults and blanks them for minors (scripts/redact_minors.py), and an
appearance count needs neither, so the published artefact simply has no age
field to get wrong.

Club matching reuses compute_elo_usl2.py's norm() and HAND_MAP rather than
inventing a third rule — that pairing is what the league's Elo already runs on,
so a club that rates here resolves here."""
import json, os, re, sys, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
from compute_elo_usl2 import norm, HAND_MAP        # noqa: E402  (single source of truth)

lineups = json.load(open(os.path.join(ROOT, 'data', 'usl2_lineups.json')))['matches']
bank = json.load(open(os.path.join(ROOT, 'data', 'usl2_matches.json')))
team_name = bank['teams']

src = open(os.path.join(ROOT, 'js', 'data.js')).read()
CLUBS = json.loads(re.search(r'export const CLUBS=(\[.*?\]);', src, re.S).group(1))
by_norm = {norm(c['n']): c for c in CLUBS if c.get('g') == 'usl2' and not c.get('h')}

tid_club = {}
for tid, nm in team_name.items():
    key = norm(HAND_MAP.get(nm, nm))
    if key in by_norm:
        tid_club[tid] = by_norm[key]

squads = {}
for mid, m in lineups.items():
    for t in m.get('teams', []):
        club = tid_club.get(t.get('team_id'))
        if not club:
            continue
        sq = squads.setdefault(club['id'], {'club': club['n'], 'players': {}})
        for group, field in (('starting', 'st'), ('reserves', 'sub')):
            for p in t.get(group) or []:
                name = (p.get('n') or '').strip()
                if not name:
                    continue
                rec = sq['players'].setdefault(name, {'n': name, 'st': 0, 'sub': 0})
                rec[field] += 1

out = {}
for cid, sq in squads.items():
    players = sorted(sq['players'].values(),
                     key=lambda p: (-(p['st'] + p['sub']), -p['st'], p['n']))
    out[cid] = {'club': sq['club'], 'players': players}

unmatched = sorted({team_name[t] for t in team_name if t not in tid_club})
matched_rows = sum(len(v['players']) for v in out.values())
print(f'  clubs matched: {len(tid_club)}/{len(team_name)}')
print(f'  squads written: {len(out)} · {matched_rows} player rows')
if unmatched:
    print(f'  unmatched teams ({len(unmatched)}): {unmatched}')

assert not any('y' in p for v in out.values() for p in v['players']), \
    'appearance output must carry no birth years'

path = os.path.join(ROOT, 'data', 'usl2_appearances.json')
json.dump(out, open(path, 'w'), separators=(',', ':'), sort_keys=True)
print(f'wrote {path}')
