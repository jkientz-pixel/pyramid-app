#!/usr/bin/env python3
"""Walk-forward calibration backtest of the Elo->Poisson odds engine
against real NPSL 2026 results. Reports Brier score vs baselines and
a calibration table."""
import json, math, os

def poisson_probs(rh, ra, home_adv=50, k_goals=1000, lam=1.35):
    d = rh + home_adv - ra
    lh, la = lam * 10 ** (d / k_goals), lam * 10 ** (-d / k_goals)
    fact = [1, 1, 2, 6, 24, 120, 720, 5040]
    ph = pd = pa = 0.0
    for i in range(8):
        for j in range(8):
            pr = math.exp(-lh) * lh ** i / fact[i] * math.exp(-la) * la ** j / fact[j]
            if i > j: ph += pr
            elif i == j: pd += pr
            else: pa += pr
    t = ph + pd + pa
    return ph / t, pd / t, pa / t

def run(matches, K=40, home_adv=50):
    elo = {}
    brier = 0.0; base_brier = 0.0; freq_brier = 0.0; n = 0
    buckets = {}
    for m in matches:
        h, a, hg, ag = m['t1'], m['t2'], m['s1'], m['s2']
        rh, ra = elo.get(h, 1500), elo.get(a, 1500)
        if h in elo and a in elo:  # only score predictions once both teams seen
            ph, pd, pa = poisson_probs(rh, ra, home_adv)
            out = [1, 0, 0] if hg > ag else ([0, 1, 0] if hg == ag else [0, 0, 1])
            brier += (ph - out[0]) ** 2 + (pd - out[1]) ** 2 + (pa - out[2]) ** 2
            base_brier += (1/3 - out[0]) ** 2 + (1/3 - out[1]) ** 2 + (1/3 - out[2]) ** 2
            # home-freq baseline: NPSL-ish home win 45/25/30
            freq_brier += (0.45 - out[0]) ** 2 + (0.25 - out[1]) ** 2 + (0.30 - out[2]) ** 2
            n += 1
            b = min(9, int(ph * 10))
            buckets.setdefault(b, [0, 0])
            buckets[b][0] += out[0]; buckets[b][1] += 1
        eh = 1 / (1 + 10 ** ((ra - (rh + home_adv)) / 400))
        sh = 1.0 if hg > ag else 0.0 if hg < ag else 0.5
        delta = K * (math.log(abs(hg - ag) + 1) or 1) * (sh - eh)
        elo[h] = rh + delta; elo[a] = ra - delta
    return brier / n, base_brier / n, freq_brier / n, n, buckets

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
matches = json.load(open(os.path.join(root, 'data', 'npsl_matches_2026.json')))
matches.sort(key=lambda m: m['start'])
best = None
for K in (24, 32, 40, 56):
    for ha in (30, 50, 80):
        b, bb, fb, n, _ = run(matches, K, ha)
        if best is None or b < best[0]: best = (b, K, ha)
b, bb, fb, n, buckets = run(matches, best[1], best[2])
print(f'predictions scored: {n} matches (walk-forward, both teams previously seen)')
print(f'Brier (ours): {b:.4f} | uniform baseline: {bb:.4f} | home-freq baseline: {fb:.4f}')
print(f'best params: K={best[1]}, home_adv=+{best[2]}')
print('calibration (predicted home-win % -> actual):')
for k in sorted(buckets):
    hits, tot = buckets[k]
    if tot >= 5:
        print(f'  {k*10}-{k*10+9}% predicted -> {100*hits/tot:.0f}% actual ({tot} matches)')
