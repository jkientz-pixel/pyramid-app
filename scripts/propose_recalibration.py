#!/usr/bin/env python3
"""Propose recalibrated men's ratings: measured-offset band re-anchor + per-club
Open Cup Elo walk. Writes data/opencup_recalibration.json and prints a before/after
comparison. DOES NOT touch js/data.js.

Base = r + (mls_mean + measured_offset_league − league_mean)   [order-preserving]
Walk = chronological Elo over 2022–2026 cup matches; joined opponents use their
live walked rating, unjoined opponents a static league proxy. K 64 amateur / 32 pro
(site's backtested values), home edge from the fit, recency decay 0.75^(2026−year).
"""
import json, re, sys, pathlib, unicodedata
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from _datajs import load_clubs

AMATEUR = {'npsl', 'upsl', 'usl2', 'loc', 'regional'}
PRO = {'mls', 'uslc', 'usl1', 'mnp', 'nisa'}
DECAY = 0.75
MONTHS = {m: i + 1 for i, m in enumerate(
    ['January', 'February', 'March', 'April', 'May', 'June',
     'July', 'August', 'September', 'October', 'November', 'December'])}

def norm(name):
    s = unicodedata.normalize('NFKD', name).encode('ascii', 'ignore').decode()
    s = s.lower()
    s = re.sub(r'\([^)]*\)', ' ', s)
    s = re.sub(r'\b(soccer club|football club|athletic club|fc|sc|afc|cf|club)\b', ' ', s)
    return ' '.join(s.split())

def main():
    offs = json.load(open('data/opencup_offsets.json'))['modern']
    O, HOME = offs['offsets'], offs['home_adv']
    cup = json.load(open('data/opencup_matches.json'))['matches']
    clubs = load_clubs()

    men = [c for c in clubs if c.get('x') == 'm' and c.get('r') and not c.get('h')]
    by_lg = {}
    for c in men:
        by_lg.setdefault(c['g'], []).append(c)
    mls_mean = sum(c['r'] for c in by_lg['mls']) / len(by_lg['mls'])

    lg_off = dict(O)
    lg_off['loc'] = O['regional']          # site's local-league bucket
    shifts = {}
    for g, cs in by_lg.items():
        if g in lg_off:
            cur_mean = sum(c['r'] for c in cs) / len(cs)
            shifts[g] = (mls_mean + lg_off[g]) - cur_mean
    # college plays no Open Cup, so no measured offset exists; peg NCAA to the
    # USL2 shift — USL2 rosters ARE college players in summer (stated assumption)
    for g in ('ncaa1', 'ncaa2'):
        if g in by_lg and 'usl2' in shifts:
            shifts[g] = shifts['usl2']
    base = {c['id']: c['r'] + shifts.get(c['g'], 0.0) for c in men}

    # --- join cup team names to club slugs ---
    idx = {}
    for c in men:
        idx.setdefault(norm(c['n']), c['id'])
    ALIAS = {  # cup-name quirks that normalisation alone cannot bridge
        'portland timbers 2': 'portland-timbers-2', 'real monarchs': 'real-monarchs',
        'new york red bulls ii': 'new-york-red-bulls-ii',
        'north carolina': 'north-carolina-fc', 'louisville city': 'louisville-city-fc',
    }
    def join(name):
        n = norm(name)
        return idx.get(n) or (ALIAS.get(n) if ALIAS.get(n) in base else None)

    CANON = {'MLS': 'mls', 'USLC': 'uslc', 'USL1': 'usl1', 'MLSNP': 'mnp',
             'NISA': 'nisa', 'NPSL': 'npsl', 'UPSL': 'upsl', 'USL2': 'usl2'}
    def lg_proxy(tag):
        g = CANON.get(tag, 'regional')
        return mls_mean + lg_off.get(g, O['regional']), g

    def datekey(m):
        mm = re.match(r'([A-Z][a-z]+)\s+(\d+)', m.get('date', ''))
        return (m['year'], MONTHS.get(mm.group(1), 6) if mm else 6,
                int(mm.group(2)) if mm else 15)

    walk = dict(base)
    nudge = {}
    log = {}
    joined = unjoined = 0
    for m in sorted((m for m in cup if m['year'] >= 2022 and m['winner'] != 0), key=datekey):
        i1, i2 = join(m['t1']), join(m['t2'])
        if not (i1 or i2):
            continue
        r1 = walk[i1] if i1 else lg_proxy(m['l1'] or '')[0]
        r2 = walk[i2] if i2 else lg_proxy(m['l2'] or '')[0]
        g1 = next((c['g'] for c in men if c['id'] == i1), None) if i1 else lg_proxy(m['l1'] or '')[1]
        g2 = next((c['g'] for c in men if c['id'] == i2), None) if i2 else lg_proxy(m['l2'] or '')[1]
        exp1 = 1 / (1 + 10 ** (-((r1 + HOME) - r2) / 400))
        g1_, g2_ = m['score']
        if m.get('pens') and g1_ == g2_:
            y1 = 0.6 if m['pens'][0] > m['pens'][1] else 0.4
        elif g1_ == g2_:
            y1 = 0.5
        elif m.get('aet'):
            y1 = 0.75 if g1_ > g2_ else 0.25
        else:
            y1 = 1.0 if g1_ > g2_ else 0.0
        w = DECAY ** (2026 - m['year'])
        for ii, gg, delta in ((i1, g1, y1 - exp1), (i2, g2, exp1 - y1)):
            if not ii:
                continue
            K = 64 if gg in AMATEUR else 32
            d = K * w * delta
            walk[ii] += d
            nudge[ii] = nudge.get(ii, 0.0) + d
            log.setdefault(ii, []).append(
                f"{m['year']} {m['round'][:14]}: {m['t1']} {m['score'][0]}-{m['score'][1]} {m['t2']}"
                f"{' (pens)' if m.get('pens') else ''} [{d:+.0f}]")
            joined += 1
        if not (i1 and i2):
            unjoined += 1

    proposed = {cid: round(v) for cid, v in walk.items()}
    print(f'cup joins: {joined} club-match updates, {unjoined} matches with one side unjoined',
          file=sys.stderr)
    print('shifts applied:', {g: round(s) for g, s in sorted(shifts.items(), key=lambda x: x[1])},
          file=sys.stderr)

    cur_sorted = sorted(men, key=lambda c: -c['r'])
    new_sorted = sorted(men, key=lambda c: -proposed[c['id']])
    cur_rank = {c['id']: i + 1 for i, c in enumerate(cur_sorted)}
    new_rank = {c['id']: i + 1 for i, c in enumerate(new_sorted)}

    print('\n== proposed national top 50 (men) ==')
    print(f'{"#":>3} {"club":32} {"lg":6} {"r now":>6} {"r new":>6} {"rank move":>10} {"cup":>5}')
    for i, c in enumerate(new_sorted[:50]):
        cid = c['id']
        mv = cur_rank[cid] - new_rank[cid]
        print(f'{i+1:>3} {c["n"][:32]:32} {c["g"]:6} {c["r"]:>6} {proposed[cid]:>6} '
              f'{("+" + str(mv)) if mv > 0 else (str(mv) if mv else "="):>10} '
              f'{("%+d" % round(nudge[cid])) if cid in nudge else "":>5}')

    movers = sorted(nudge.items(), key=lambda x: -abs(x[1]))[:12]
    print('\n== biggest cup-walk movers ==')
    for cid, d in movers:
        c = next(c for c in men if c['id'] == cid)
        print(f'  {c["n"]:32} {c["g"]:6} {d:+.0f}  (rank {cur_rank[cid]} -> {new_rank[cid]})')

    faro = 'el-farolito'
    if faro in log:
        print('\n== El Farolito receipt trail ==')
        print(f'  base after re-anchor: {round(base[faro])}  |  proposed: {proposed[faro]}'
              f'  |  rank {cur_rank[faro]} -> {new_rank[faro]}')
        for line in log[faro]:
            print('   ', line)

    json.dump({'generated': json.load(open("data/opencup_offsets.json"))['fitted'],
               'mls_mean': round(mls_mean), 'shifts': {g: round(s, 1) for g, s in shifts.items()},
               'proposed': proposed,
               'cup_nudges': {k: round(v, 1) for k, v in nudge.items()},
               'receipts': log},
              open('data/opencup_recalibration.json', 'w'), ensure_ascii=False, indent=1)
    print('\nwrote data/opencup_recalibration.json', file=sys.stderr)

if __name__ == '__main__':
    main()
