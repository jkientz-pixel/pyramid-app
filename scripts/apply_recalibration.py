#!/usr/bin/env python3
"""Apply the measured cross-league recalibration to js/data.js (men's ratings).

Pipeline position: run AFTER every rating writer (compute_elo, fetch_asa,
reconcile_standings, apply_massey) and BEFORE deploy. Steps:

 1. NPSL bases rebuilt UNCAPPED from data/npsl_matches_2026.json (same walk as
    compute_elo: K=64, +30 home, log goal margin, +100 display shift — but no
    [1400,1900] clamp; the clamp is what pinned El Farolito/Ambassadors to 1900).
 2. Every league re-anchored so its base mean sits at mls_mean + measured offset
    (data/opencup_offsets.json, 2022-26 window). NCAA pegged to the USL2 shift —
    USL2 rosters are college players in summer (stated assumption). Within-league
    order is preserved.
 3. Chronological Elo walk over 2022-26 Open Cup matches. MLS clubs are NEVER
    moved (site policy: MLS ranks by the official league table) but do serve as
    opponents. K 64 amateur / 32 pro (backtested), home edge from the fit,
    recency decay 0.75^(2026-year), credit: 90' win 1.0 / ET win 0.75 /
    pens win 0.6 / draw 0.5.
 4. Provisional flag pv=1 where a club moved >30 Elo and >50% of that movement
    came from league-proxy opponents (clubs we could not join).

Idempotent: data/recal_state.json records what was applied per club; re-runs
subtract it first. Receipts for the club pages land in data/cup_receipts.json.
"""
import json, math, os, re, sys, pathlib, unicodedata
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from _datajs import load_clubs, write_clubs

ROOT = pathlib.Path(__file__).resolve().parent.parent
AMATEUR = {'npsl', 'upsl', 'usl2', 'loc', 'ncaa1', 'ncaa2'}
RECAL_LEAGUES = {'uslc', 'usl1', 'mnp', 'nisa', 'npsl', 'upsl', 'usl2', 'loc'}
DECAY = 0.75
PV_MIN_NUDGE, PV_PROXY_SHARE = 30, 0.5
MONTHS = {m: i + 1 for i, m in enumerate(
    ['January', 'February', 'March', 'April', 'May', 'June',
     'July', 'August', 'September', 'October', 'November', 'December'])}


def npsl_norm(n):
    return re.sub(r'\b(fc|sc|cf|afc|cd|club|the)\b', '', n.lower()).replace(' ', '').strip()


def cup_norm(name):
    s = unicodedata.normalize('NFKD', name).encode('ascii', 'ignore').decode().lower()
    s = re.sub(r'\([^)]*\)', ' ', s)
    s = re.sub(r'\b(soccer club|football club|athletic club|fc|sc|afc|cf|club)\b', ' ', s)
    return ' '.join(s.split())


def npsl_uncapped():
    """compute_elo's walk, minus the clamp. -> {npsl_norm(team): rating}"""
    matches = json.load(open(ROOT / 'data' / 'npsl_matches_2026.json'))
    events = []
    seen = set()  # Squadi lists playoff rounds under conference AND national div ids
    for m in matches:
        if m.get('status') != 'ENDED':
            continue
        if not isinstance(m.get('s1'), int) or not isinstance(m.get('s2'), int):
            continue
        if not str(m.get('start', '')).startswith('2026'):
            continue
        key = (m['start'], m['t1'], m['t2'], m['s1'], m['s2'])
        if key in seen:
            continue
        seen.add(key)
        events.append((m['start'], m['t1'], m['t2'], m['s1'], m['s2']))
    events.sort()
    elo = {}
    for _, h, a, hg, ag in events:
        rh, ra = elo.get(h, 1500), elo.get(a, 1500)
        eh = 1 / (1 + 10 ** ((ra - (rh + 30)) / 400))
        sh = 1.0 if hg > ag else 0.0 if hg < ag else 0.5
        margin = math.log(abs(hg - ag) + 1) or 1
        delta = 64 * margin * (sh - eh)
        elo[h] = rh + delta
        elo[a] = ra - delta
    return {npsl_norm(t): round(r + 100) for t, r in elo.items()}


def credit(m):
    g1, g2 = m['score']
    if m.get('pens') and g1 == g2:
        return 0.6 if m['pens'][0] > m['pens'][1] else 0.4
    if g1 == g2:
        return 0.5
    if m.get('aet'):
        return 0.75 if g1 > g2 else 0.25
    return 1.0 if g1 > g2 else 0.0


def datekey(m):
    mm = re.match(r'([A-Z][a-z]+)\s+(\d+)', m.get('date', ''))
    return (m['year'], MONTHS.get(mm.group(1), 6) if mm else 6,
            int(mm.group(2)) if mm else 15)


def main():
    offs = json.load(open(ROOT / 'data' / 'opencup_offsets.json'))['modern']
    O, HOME = dict(offs['offsets']), offs['home_adv']
    O['loc'] = O['regional']
    cup = json.load(open(ROOT / 'data' / 'opencup_matches.json'))['matches']
    state_path = ROOT / 'data' / 'recal_state.json'
    prev = json.load(open(state_path))['applied'] if state_path.exists() else {}

    clubs = load_clubs()
    men = [c for c in clubs if c.get('x') == 'm' and c.get('r') and not c.get('h')]
    by_id = {c['id']: c for c in men}

    # --- 1. pipeline bases (undo any previous recalibration, uncap NPSL) ---
    base = {}
    for c in men:
        base[c['id']] = c['r'] - prev.get(c['id'], 0)
    uncapped = npsl_uncapped()
    n_uncap = 0
    for c in men:
        if c['g'] == 'npsl' and npsl_norm(c['n']) in uncapped:
            base[c['id']] = uncapped[npsl_norm(c['n'])]
            n_uncap += 1
    print(f'NPSL bases rebuilt uncapped: {n_uncap}', file=sys.stderr)

    # --- 2. re-anchor league means to measured offsets ---
    by_lg = {}
    for c in men:
        by_lg.setdefault(c['g'], []).append(c)
    mls_mean = sum(base[c['id']] for c in by_lg['mls']) / len(by_lg['mls'])
    shifts = {}
    for g in RECAL_LEAGUES:
        if g in by_lg:
            cur = sum(base[c['id']] for c in by_lg[g]) / len(by_lg[g])
            shifts[g] = (mls_mean + O[g]) - cur
    for g in ('ncaa1', 'ncaa2'):
        if g in by_lg and 'usl2' in shifts:
            shifts[g] = shifts['usl2']
    for c in men:
        base[c['id']] += shifts.get(c['g'], 0.0)
    print('shifts:', {g: round(s) for g, s in sorted(shifts.items(), key=lambda x: x[1])},
          file=sys.stderr)

    # --- 3. cup walk (never moves MLS) ---
    idx = {}
    for c in men:
        idx.setdefault(cup_norm(c['n']), c['id'])
    CANON = {'MLS': 'mls', 'USLC': 'uslc', 'USL1': 'usl1', 'MLSNP': 'mnp',
             'NISA': 'nisa', 'NPSL': 'npsl', 'UPSL': 'upsl', 'USL2': 'usl2'}

    walk = dict(base)
    nudge, proxy_gain, receipts = {}, {}, {}
    for m in sorted((m for m in cup if m['year'] >= 2022), key=datekey):
        i1, i2 = idx.get(cup_norm(m['t1'])), idx.get(cup_norm(m['t2']))
        if not (i1 or i2):
            continue
        g1 = by_id[i1]['g'] if i1 else CANON.get(m['l1'] or '', 'loc')
        g2 = by_id[i2]['g'] if i2 else CANON.get(m['l2'] or '', 'loc')
        r1 = walk[i1] if i1 else mls_mean + O.get(g1, O['regional'])
        r2 = walk[i2] if i2 else mls_mean + O.get(g2, O['regional'])
        exp1 = 1 / (1 + 10 ** (-((r1 + HOME) - r2) / 400))
        y1 = credit(m)
        w = DECAY ** (2026 - m['year'])
        for ii, gg, opp_joined, delta, opp_name, home in (
                (i1, g1, bool(i2), y1 - exp1, m['t2'], True),
                (i2, g2, bool(i1), exp1 - y1, m['t1'], False)):
            if not ii:
                continue
            d = 0.0
            if gg != 'mls':  # MLS ranks by the official league table — receipts only
                K = 64 if gg in AMATEUR else 32
                d = K * w * delta
                walk[ii] += d
                nudge[ii] = nudge.get(ii, 0.0) + d
                if not opp_joined:
                    proxy_gain[ii] = proxy_gain.get(ii, 0.0) + abs(d)
            gf, ga = (m['score'] if home else m['score'][::-1])
            e = {'y': m['year'], 'rd': m['round'], 'opp': opp_name,
                 'ha': 'H' if home else 'A', 'gf': gf, 'ga': ga, 'd': round(d)}
            if m.get('aet'):
                e['aet'] = 1
            if m.get('pens'):
                e['pens'] = m['pens'] if home else m['pens'][::-1]
            receipts.setdefault(ii, []).append(e)

    # --- 4. provisional flags + write ---
    applied = {}
    for c in clubs:
        c.pop('pv', None)
    for c in men:
        newr = round(walk[c['id']])
        applied[c['id']] = newr - (c['r'] - prev.get(c['id'], 0))
        c['r'] = newr
        nd, pg = abs(nudge.get(c['id'], 0)), proxy_gain.get(c['id'], 0)
        total_move = sum(abs(e['d']) for e in receipts.get(c['id'], [])) or 1
        if nd > PV_MIN_NUDGE and pg / total_move > PV_PROXY_SHARE:
            c['pv'] = 1
    write_clubs(clubs)

    json.dump({'applied': {k: round(v, 1) for k, v in applied.items()},
               'mls_mean': round(mls_mean, 1)},
              open(state_path, 'w'), ensure_ascii=False)
    json.dump(receipts, open(ROOT / 'data' / 'cup_receipts.json', 'w'),
              ensure_ascii=False, separators=(',', ':'))
    npv = sum(1 for c in men if c.get('pv'))
    print(f'wrote data.js ({len(men)} men rated), cup_receipts.json '
          f'({len(receipts)} clubs with receipts), {npv} provisional', file=sys.stderr)


if __name__ == '__main__':
    main()
