#!/usr/bin/env python3
"""Cross-league crest reuse (pass 1 of the 2026-08-10 youth-crest push).

Many clubs field sides in several leagues (ECNL + GA + MLS NEXT ...) but the
crest sweeps were league-driven, so a club can hold a crest under one league
entry while its sibling entries sit crestless. This copies the img path onto
same-club entries only — same normalized name AND same state, plus same city
when both entries state one. Name collision across states (Wave FC NJ vs
SC Wave WI) is exactly what the guard exists for; near-miss holds are printed
for manual review, never auto-applied.
"""
import re, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _datajs import load_clubs, write_clubs

STOP = r'\b(fc|sc|cf|soccer|club|futbol|football|academy|youth|the|of)\b'


def norm(n):
    n = re.sub(r'[^a-z0-9 ]', ' ', n.lower())
    return ' '.join(re.sub(STOP, ' ', n).split())


def main():
    clubs = load_clubs()
    donors = {}
    for c in clubs:
        if c.get('img') and not c.get('h'):
            donors.setdefault(norm(c['n']), []).append(c)

    applied, held = 0, []
    for c in clubs:
        if c.get('img') or c.get('h'):
            continue
        cands = [d for d in donors.get(norm(c['n']), [])
                 if d.get('st') == c.get('st')]
        same_city = [d for d in cands if d.get('ct') and c.get('ct')
                     and d['ct'].lower() == c['ct'].lower()]
        pick = same_city or (cands if len({d['img'] for d in cands}) == 1 else [])
        if same_city or (pick and not c.get('ct')):
            c['img'] = pick[0]['img']
            applied += 1
            print(f"reuse: {c['n']} [{c['g']}] <- {pick[0]['img']}")
        elif cands:
            held.append((c['n'], c.get('g'), c.get('ct'),
                         [(d['g'], d.get('ct'), d['img']) for d in cands]))

    print(f"\napplied {applied}; held for review {len(held)}:")
    for h in held:
        print(' ', h)
    if applied:
        write_clubs(clubs)


if __name__ == '__main__':
    main()
