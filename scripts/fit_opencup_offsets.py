#!/usr/bin/env python3
"""Fit cross-league Elo offsets from banked Open Cup matches (data/opencup_matches.json).

Bradley-Terry on the Elo scale: P(home win at 90') = 1/(1+10^(-(o_h + H - o_a)/400)).
Draws at 90' (matches decided in ET/pens) count as 0.5. MLS is the anchor (offset 0).
Output: data/opencup_offsets.json + human-readable comparison vs current data.js bands.
"""
import json, math, sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from _datajs import load_clubs

CANON = {
    'MLS': 'mls', 'USLC': 'uslc', 'USL1': 'usl1', 'MLSNP': 'mnp', 'NISA': 'nisa',
    'NPSL': 'npsl', 'UPSL': 'upsl', 'USL2': 'usl2', 'PDL': 'usl2',
    'USL': 'usl-d23-era', 'NASL': 'nasl-era',
}
KNOWN_REGIONAL = {
    'LQ', 'USASA', 'EPSL', 'SWPL', 'BSSL', 'SFSFL', 'CSL', 'Colo SL', 'CPL', 'USSL',
    'MWPL', 'NSL', 'MSSL', 'DCPL', 'MPL', 'APL', 'NAC', 'USLP', 'USLPA', 'NISAN',
    'TLC', 'SRATS', 'GCPL', 'UWS', 'WPSL', 'SAL',
}

def canon(tag, unmapped):
    if tag in CANON:
        return CANON[tag]
    if tag in KNOWN_REGIONAL:
        return 'regional'
    unmapped[tag] = unmapped.get(tag, 0) + 1
    return 'regional'

def outcome_90(m):
    """Home result at 90 minutes: 1 / 0.5 / 0, or None to skip."""
    if m['winner'] == 0:
        return None
    if m.get('aet') or m.get('pens'):
        return 0.5
    g1, g2 = m['score']
    if g1 == g2:
        return 0.5
    return 1.0 if g1 > g2 else 0.0

def fit(matches, leagues, anchor='mls', iters=20000, lr=8.0):
    """Gradient ascent on log-likelihood. Returns offsets dict + home adv."""
    idx = {lg: i for i, lg in enumerate(leagues)}
    o = [0.0] * len(leagues)
    H = 0.0
    LN10_400 = math.log(10) / 400
    for step in range(iters):
        grad = [0.0] * len(leagues)
        gH = 0.0
        for lh, la, y in matches:
            d = o[idx[lh]] + H - o[idx[la]]
            p = 1 / (1 + 10 ** (-d / 400))
            e = (y - p) * LN10_400 * 400  # d/d(diff) of loglik, scaled
            grad[idx[lh]] += e
            grad[idx[la]] -= e
            gH += e
        for i in range(len(o)):
            o[i] += lr * grad[i] / len(matches)
        H += lr * gH / len(matches)
        o_anchor = o[idx[anchor]]
        o = [x - o_anchor for x in o]
    return {lg: round(o[idx[lg]], 1) for lg in leagues}, round(H, 1)

def loglik(matches, offs, H):
    ll = 0.0
    for lh, la, y in matches:
        d = offs[lh] + H - offs[la]
        p = 1 / (1 + 10 ** (-d / 400))
        p = min(max(p, 1e-9), 1 - 1e-9)
        ll += y * math.log(p) + (1 - y) * math.log(1 - p)
    return ll / len(matches)

def window(ms, years, unmapped):
    out = []
    for m in ms:
        if m['year'] not in years or not (m['l1'] and m['l2']):
            continue
        y = outcome_90(m)
        if y is None:
            continue
        lh, la = canon(m['l1'], unmapped), canon(m['l2'], unmapped)
        if lh == la:
            continue  # same-league match carries no cross-league information
        out.append((lh, la, y))
    return out

def main():
    d = json.load(open('data/opencup_matches.json'))
    ms = d['matches']
    unmapped = {}

    modern_years = {2022, 2023, 2024, 2025, 2026}
    modern = window(ms, modern_years, unmapped)
    leagues_m = sorted({l for lh, la, _ in modern for l in (lh, la)})
    offs_m, H_m = fit(modern, leagues_m)

    hist_years = {2016, 2017, 2018, 2019}
    hist = window(ms, hist_years, unmapped)
    leagues_h = sorted({l for lh, la, _ in hist for l in (lh, la)})
    offs_h, H_h = fit(hist, leagues_h)

    if unmapped:
        print(f'NOTE unmapped tags bucketed as regional: {unmapped}', file=sys.stderr)

    # pair coverage (modern) — how much evidence sits behind each gap
    pairs = {}
    for lh, la, _ in modern:
        k = tuple(sorted((lh, la)))
        pairs[k] = pairs.get(k, 0) + 1

    # current site league means for comparison
    clubs = load_clubs()
    cur = {}
    for c in clubs:
        if c.get('x') == 'm' and c.get('r') and not c.get('h'):
            cur.setdefault(c['g'], []).append(c['r'])
    cur_mean = {g: round(sum(v) / len(v)) for g, v in cur.items()}
    mls_mean = cur_mean.get('mls', 0)

    print(f'\n== modern window 2022-2026: {len(modern)} cross-league matches, home adv {H_m} Elo')
    print(f'   avg loglik {loglik(modern, offs_m, H_m):.4f} (uniform baseline {math.log(0.5):.4f})')
    print(f'{"league":12} {"measured offset":>16} {"site mean r - MLS mean":>24} {"n matches":>10}')
    for lg in sorted(offs_m, key=lambda x: -offs_m[x]):
        n = sum(v for k, v in pairs.items() if lg in k)
        site = (cur_mean[lg] - mls_mean) if lg in cur_mean else None
        print(f'{lg:12} {offs_m[lg]:>+16.0f} {("%+d" % site) if site is not None else "-":>24} {n:>10}')

    print(f'\n== historical window 2016-2019: {len(hist)} matches, home adv {H_h} Elo (stability check)')
    for lg in sorted(offs_h, key=lambda x: -offs_h[x]):
        print(f'   {lg:14} {offs_h[lg]:+.0f}')

    out = {
        'fitted': d['fetched'],
        'model': 'bradley-terry elo-scale, 90-min results, draws 0.5, MLS anchored 0',
        'modern': {'years': sorted(modern_years), 'n': len(modern), 'home_adv': H_m,
                   'offsets': offs_m,
                   'pair_counts': {f'{a}|{b}': n for (a, b), n in sorted(pairs.items())}},
        'historical': {'years': sorted(hist_years), 'n': len(hist), 'home_adv': H_h,
                       'offsets': offs_h},
    }
    with open('data/opencup_offsets.json', 'w') as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
    print('\nwrote data/opencup_offsets.json', file=sys.stderr)

if __name__ == '__main__':
    main()
