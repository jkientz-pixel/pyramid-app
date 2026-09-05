#!/usr/bin/env python3
"""Results-based Elo for a regional league from its published match scores.

Input: data/<league>_matches.json — [{d, div, h, a, hg, ag}] (home/away as
the league spells them; rendered from the league's official schedule/standings
page). Mirrors the USL2 engine (compute_elo_usl2.py): K=64, +30 home edge, log
goal margin, chronological walk, >=3 played to rate.

Anchoring: the walk starts everyone at 1500, so its mean is arbitrary. The band
is shifted so the matched clubs' mean equals the mean of their CURRENT ratings
(the standings pass already sits at the Open Cup-measured league anchor), so the
league keeps its place on the national scale and only the ORDER and SPREAD
change. Standings rating stays as `rt` for transparency; `r` becomes
the results Elo with rr=1.

Usage: compute_elo_regional.py <league> [--dry]
"""
import json, math, sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from _datajs import load_clubs, write_clubs, ROOT
from rate_regional_standings import ALIASES, norm

K, HOME, MIN_GP = 64, 30, 3


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if len(args) != 1:
        sys.exit(__doc__)
    league, dry = args[0], '--dry' in sys.argv
    games = json.load(open(ROOT / 'data' / f'{league}_matches.json'))
    games.sort(key=lambda g: g['d'])
    src = (ROOT / 'js' / 'data.js').read_text()
    clubs = load_clubs(src)
    pool = [c for c in clubs if c.get('g') == league and not c.get('h') and c.get('x') != 'w']
    aliases = ALIASES.get(league, {})
    key_to_club = {aliases.get(c['id'], norm(c['n'])): c for c in pool}

    elo, played, wire = {}, {}, []
    unknown = set()
    for g in games:
        h, a = norm(g['h']), norm(g['a'])
        for t, raw in ((h, g['h']), (a, g['a'])):
            if t not in key_to_club:
                unknown.add(raw)
        rh, ra = elo.get(h, 1500.0), elo.get(a, 1500.0)
        eh = 1 / (1 + 10 ** ((ra - (rh + HOME)) / 400))
        sh = 1.0 if g['hg'] > g['ag'] else 0.0 if g['hg'] < g['ag'] else 0.5
        margin = math.log(abs(g['hg'] - g['ag']) + 1) or 1
        delta = K * margin * (sh - eh)
        if h in key_to_club and a in key_to_club:
            wire.append({'d': g['d'], 't1': key_to_club[h]['n'], 't2': key_to_club[a]['n'],
                         's1': g['hg'], 's2': g['ag'], 'r1': round(rh), 'r2': round(ra),
                         'dr': round(delta), 'ph': round(eh, 2),
                         'gp': min(played.get(h, 0), played.get(a, 0))})
        elo[h], elo[a] = rh + delta, ra - delta
        played[h] = played.get(h, 0) + 1
        played[a] = played.get(a, 0) + 1

    matched = {k: c for k, c in key_to_club.items() if played.get(k, 0) >= MIN_GP}
    if not matched:
        sys.exit(f'FATAL: no {league} club matched a match row — refusing to write')
    # recalibrate2 derives each club's base as `r minus its stored cup nudge`,
    # so a writer must leave the nudge IN `r`. Writing the bare walk would make
    # the next recal strip a nudge that is not there and cancel the club's cup
    # results on every rerun (Woodland FC's two qualifiers, 2026-09-04).
    state_path = ROOT / 'data' / 'recal2_state.json'
    nudges = ({cid: v.get('n', 0.0) for cid, v in json.load(open(state_path)).get('clubs', {}).items()}
              if state_path.exists() else {})
    # Anchor to the league's CUP-FREE mean: anchoring to `r` (which carries the
    # nudges) and then adding the nudges back would lift the league mean by the
    # average nudge on every rerun.
    rated = [c for c in matched.values() if c.get('r')]
    cur_mean = sum(c['r'] - nudges.get(c['id'], 0.0) for c in rated) / max(1, len(rated))
    elo_mean = sum(elo[k] for k in matched) / len(matched)
    shift = cur_mean - elo_mean
    err = sys.stderr
    print(f'{league}: {len(games)} games, {len(matched)} clubs with >= {MIN_GP} played; '
          f'band shift {shift:+.1f} (current mean {cur_mean:.0f})', file=err)
    if unknown:
        print(f'  UNMATCHED team names ({len(unknown)}): {sorted(unknown)}', file=err)

    # No spread shrink. The 2026-09-04 backtest (rating-backtest-2026-09-04/)
    # showed recalibrate2's gp/(gp+10) rule makes held-out predictions WORSE on
    # both MWPL and USL2; the raw walk's spread is what the results support.
    # Cross-league plausibility is a separate question (an explicit band), not
    # a reason to compress the within-league order.
    def anchored(k):
        return cur_mean + (elo[k] - elo_mean)

    # re-base wire ratings onto the anchored band so the feed matches the page
    for w in wire:
        w['r1'] = round(w['r1'] + shift)
        w['r2'] = round(w['r2'] + shift)

    n = 0
    for k, c in matched.items():
        nudge = nudges.get(c['id'], 0.0)
        new = round(anchored(k) + nudge)
        if c.get('rr') == 2 and c.get('r'):
            c['rt'] = round(c['r'] - nudge)  # standings number, cup-free, for transparency
        c['r'], c['rr'] = new, 1
        c.pop('pv', None)
        n += 1
    ranked = sorted(matched.values(), key=lambda c: -c['r'])
    print(f'  range {ranked[-1]["r"]}–{ranked[0]["r"]}', file=err)
    if dry:
        for c in ranked:
            print(f'  {c["r"]:5d}  (table {c.get("rt", "-"):>4})  {c["n"]}', file=err)
        print('DRY RUN — nothing written', file=err)
        return
    write_clubs(clubs, src)
    json.dump(wire, open(ROOT / 'data' / f'wire_{league}.json', 'w'), separators=(',', ':'))
    print(f'wrote js/data.js: {n} {league} results ratings; data/wire_{league}.json {len(wire)} rows')


if __name__ == '__main__':
    main()
