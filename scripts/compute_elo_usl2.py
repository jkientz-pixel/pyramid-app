#!/usr/bin/env python3
"""Truth layer for USL League Two: compute real Elo from banked Modular11
results (data/usl2_matches.json, bank_usl2_full.py output). Mirrors the NPSL
engine in compute_elo.py (K=64, +30 home edge, log margin) but anchors the
final band to the mean of the matched clubs' CURRENT ratings, so the league
keeps its place in the cross-league calibration without an apply_recalibration
rerun. Sets r + rr=1 on matched usl2 clubs (>=3 played) in js/data.js and
writes the wire feed to data/wire_usl2.json."""
import json, re, os, math, sys, unicodedata
from datetime import datetime

# Modular11 name -> app club name, for the pairs norm() can't bridge.
# Verified 2026-08-17 (GFI = The Woodlands per uslleaguetwo.com; Texoma per
# 2026 season coverage — new usl2 entry appended below, old usl1 one stays
# tombstoned).
HAND_MAP = {
    'Texoma FC': 'Texoma FC',
    'Patuxent FA': 'Patuxent Football Athletics',
    'FC Motown STA': 'FC Motown',
    'Cedar Stars': 'Cedar Stars Rush',
    'NEFC': 'New England Fútbol Club',
    'Birmingham Legion FC II': 'Birmingham Legion 2',
    'Dothan United': 'Dothan United Dragons',
    'Swarm FC': 'SSA Swarm FC',
    'Kings Hammer FC - Columbus': 'Kings Hammer FC Columbus',
    'Louisville City FC': 'Louisville City FC U-23',
    'San Antonio FC II': 'San Antonio FC 2',
    'GFI': 'Global Football Innovation Academy',
    'CISA': 'Colorado International Soccer Academy',
    'Atletico Union': 'Atlético Unión',
    'Charlotte Independence 2': 'Charlotte Independence II',
    'South Carolina United Bantams': 'SC United Bantams',
    'Sueno FC': 'Sueño FC',
    'LVU Rush': 'Lehigh Valley United',
    'Real Central NJ': 'Real Central NJ (2026)',
    'PA Classics': 'Pennsylvania Classics AC',
    'Bangers FC': 'Portland Bangers FC',
    'Santafe Wanderers FC': 'Santafé Wanderers FC',
    # club rebranded; app entry keeps the founding name (Shreveport/Bossier
    # City, Mid South — verified 2026-08-17)
    'Red River FC': 'Red River Raiders FC',
}


def norm(n):
    n = unicodedata.normalize('NFKD', n).encode('ascii', 'ignore').decode()
    return re.sub(r'\b(fc|sc|cf|afc|cd|club|the)\b', '', n.lower()).replace(' ', '').strip()


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    bank = json.load(open(os.path.join(root, 'data', 'usl2_matches.json')))
    team_name = bank['teams']

    events = []
    for mid, m in bank['matches'].items():
        if not m.get('score'):
            continue
        hg, ag = (int(x) for x in m['score'].split(':'))
        when = datetime.strptime(m['date'], '%m/%d/%y %I:%M%p')
        events.append((when, m['home'], m['away'], hg, ag))
    events.sort(key=lambda e: e[0])
    print(f'USL2 2026 completed matches with scores: {len(events)}', file=sys.stderr)

    elo, played, wire = {}, {}, []
    K = 64  # amateur-tier optimum, backtested for NPSL 2026-07-27
    for when, h, a, hg, ag in events:
        rh, ra = elo.get(h, 1500), elo.get(a, 1500)
        eh = 1 / (1 + 10 ** ((ra - (rh + 30)) / 400))
        sh = 1.0 if hg > ag else 0.0 if hg < ag else 0.5
        margin = math.log(abs(hg - ag) + 1) or 1
        delta = K * margin * (sh - eh)
        wire.append({'d': when.strftime('%Y-%m-%d'), 't1': team_name[h], 't2': team_name[a],
                     's1': hg, 's2': ag, 'r1': rh, 'r2': ra,
                     'dr': round(delta), 'ph': round(eh, 2),
                     'gp': min(played.get(h, 0), played.get(a, 0))})
        elo[h] = rh + delta; elo[a] = ra - delta
        played[h] = played.get(h, 0) + 1; played[a] = played.get(a, 0) + 1

    dpath = os.path.join(root, 'js', 'data.js')
    cur = open(dpath).read()
    clubs = json.loads(re.search(r'export const CLUBS=(\[.*?\]);', cur, re.S).group(1))

    # Texoma FC self-relegated USL1 -> USL2 for 2026; the usl1 entry is
    # tombstoned. Append the usl2 entity once, reusing the verified pin+crest.
    if not any(c.get('id') == 'texoma-fc-2026' for c in clubs):
        old = next(c for c in clubs if c.get('id') == 'texoma-fc' and c.get('g') == 'usl1')
        clubs.append({'n': 'Texoma FC', 'g': 'usl2', 'x': old['x'], 'la': old['la'],
                      'lo': old['lo'], 'r': 1400, 'st': old.get('st'), 'img': old.get('img'),
                      'acc': old.get('acc'), 're': old.get('re'), 'ct': old.get('ct'),
                      'id': 'texoma-fc-2026'})
        print('appended texoma-fc-2026 (usl2)', file=sys.stderr)

    usl2 = {norm(c['n']): c for c in clubs if c.get('g') == 'usl2' and not c.get('h')}
    tid_club = {}
    for tid, nm in team_name.items():
        k = norm(HAND_MAP.get(nm, nm))
        if k in usl2:
            tid_club[tid] = usl2[k]
    unmatched = [nm for tid, nm in team_name.items() if tid not in tid_club]
    print(f'matched {len(tid_club)}/{len(team_name)} teams; unmatched: {unmatched}',
          file=sys.stderr)

    # anchor: preserve the league's current band centre (skip clubs with no
    # prior rating, e.g. fresh entries)
    anchored = [(elo[t], c['r']) for t, c in tid_club.items()
                if t in elo and isinstance(c.get('r'), int)]
    shift = sum(r for _, r in anchored) / len(anchored) - \
        sum(e for e, _ in anchored) / len(anchored)
    print(f'band anchor shift: {shift:+.1f}', file=sys.stderr)

    for row in wire:
        row['r1'] = round(row['r1'] + shift); row['r2'] = round(row['r2'] + shift)
    json.dump(wire, open(os.path.join(root, 'data', 'wire_usl2.json'), 'w'),
              separators=(',', ':'))
    print(f'wire feed: {len(wire)} rated results -> data/wire_usl2.json', file=sys.stderr)

    n_applied = 0
    for tid, c in tid_club.items():
        if played.get(tid, 0) >= 3:
            c['r'] = max(1000, min(1900, round(elo[tid] + shift)))
            c['rr'] = 1
            n_applied += 1
    print(f'applied real Elo to {n_applied} usl2 clubs', file=sys.stderr)

    rated = sorted(((c['r'], c['n']) for tid, c in tid_club.items()
                    if c.get('rr') == 1), reverse=True)
    print('top 5:', rated[:5], file=sys.stderr)
    print('bottom 5:', rated[-5:], file=sys.stderr)

    cur = cur[:cur.index('export const CLUBS=')] + 'export const CLUBS=' + \
        json.dumps(clubs, ensure_ascii=False, separators=(',', ':')) + ';\n' + \
        cur[cur.index('export const REGIONS='):]
    open(dpath, 'w').write(cur)


if __name__ == '__main__':
    main()
