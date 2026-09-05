#!/usr/bin/env python3
"""Cross-league recalibration v2 — single anchor authority, no undo step.

Replaces apply_recalibration.py's undo-prev design, which poisoned ratings
whenever league membership churned (loc->gcpl split: +254 phantom jumps;
LA Force in NISA: +205) because recal_state.json's `applied` conflated the
league shift with cup nudges and assumed static league membership.

v2 principles:
 1. ONE anchor authority: data/opencup_offsets.json (measured from ~600
    cross-league Open Cup results). Writer-side band constants are display
    conveniences only; this script re-centers whatever writers produce.
 2. NO de-anchoring. League anchoring pins the league MEAN, so a base only
    has to carry within-league order. base = current r minus the club's
    stored cup nudge — never minus a league shift. League churn cannot
    poison anything because no historical shift is ever undone.
 3. Nudges tracked separately. data/recal2_state.json stores per-club
    {b: base, s: shift, n: nudge}; the next run strips exactly n. First run
    bootstraps nudges from the receipt sums in data/cup_receipts.json.
 4. NPSL and USL2 bases rebuild from their match files on EVERY run (NPSL:
    data/npsl_matches_2026.json deduped — Squadi double-lists playoff rounds;
    USL2: data/usl2_matches.json). A pool read back from last run's output
    compounds any per-run transform: before 2026-09-04 USL2 was re-shrunk by
    gp/(gp+10) on each run (sd 139 -> 78 -> 47). Every other league trusts
    its writer.
 5. MLS never moves (official table is the record); it defines mls_mean
    and serves as cup opposition only. NCAA D1/D2 peg to the USL2 shift
    (USL2 rosters are college players in summer — stated assumption).
 6. Spread policy (2026-09-04 backtest, rankedxi-launch-campaign/
    rating-backtest-2026-09-04): the raw walk's within-league spread predicts
    held-out results better than any shrink, so NO shrink is applied. The
    national amateur leagues and the regionals are one band of similar mean
    (their cup offsets differ by <30 points with ±110 CIs), so they all get
    the same rule. The only guard is a tail cap: a club's own league walk may
    not place it more than MAX_ABOVE_MEAN over its league anchor. Cup results
    against higher tiers (the nudge) may carry it beyond that — beating pro
    clubs, not the label, is what moves a club past them.

Pipeline position: run AFTER every rating writer (compute_elo, fetch_asa,
fetch_asa_games, fetch_pro_standings, apply_massey) and BEFORE deploy.
Idempotent: a second run with unchanged inputs is a no-op.

Usage: recalibrate2.py [--datajs PATH] [--state PATH] [--receipts PATH] [--dry]
The path flags exist so the pipeline can be rehearsed against sandbox copies
without touching the shipping files.
"""
import argparse
import importlib.util
import json
import math
import pathlib
import re
import sys
import unicodedata
from datetime import datetime

ROOT = pathlib.Path(__file__).resolve().parent.parent
AMATEUR = {'npsl', 'upsl', 'usl2', 'loc', 'ncaa1', 'ncaa2', 'gcpl', 'apsl'}
ANCHORED = {'uslc', 'usl1', 'mnp', 'nisa', 'npsl', 'upsl', 'usl2', 'loc'}
NCAA_PEG = ('ncaa1', 'ncaa2')
CANON = {'MLS': 'mls', 'USLC': 'uslc', 'USL1': 'usl1', 'MLSNP': 'mnp',
         'NISA': 'nisa', 'NPSL': 'npsl', 'UPSL': 'upsl', 'USL2': 'usl2'}
DECAY = 0.75
PV_MIN_NUDGE, PV_PROXY_SHARE = 30, 0.5
OUTLIER_BAND = 200
MAX_ABOVE_MEAN = 300   # points a league walk alone may lift a club over its anchor
MIN_GP = 3             # games before a results walk replaces a club's base
K, HOME_EDGE = 64, 30  # amateur-tier walk (backtested NPSL 2026-07-27, MWPL/USL2 2026-09-04)
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


def load_clubs(datajs):
    src = open(datajs).read()
    clubs = json.loads(re.search(r'export const CLUBS=(\[.*?\]);', src, re.S).group(1))
    return src, clubs


def write_clubs(datajs, src, clubs):
    out = src[:src.index('export const CLUBS=')] + 'export const CLUBS=' + \
        json.dumps(clubs, ensure_ascii=False, separators=(',', ':')) + ';\n' + \
        src[src.index('export const REGIONS='):]
    open(datajs, 'w').write(out)


def elo_walk(events):
    """Uncapped K=64, +30 home, log-margin Elo walk. events: sorted
    (when, home, away, hg, ag). -> ({team: rating}, {team: games played})"""
    elo, played = {}, {}
    for _, h, a, hg, ag in events:
        rh, ra = elo.get(h, 1500), elo.get(a, 1500)
        eh = 1 / (1 + 10 ** ((ra - (rh + HOME_EDGE)) / 400))
        sh = 1.0 if hg > ag else 0.0 if hg < ag else 0.5
        margin = math.log(abs(hg - ag) + 1) or 1
        delta = K * margin * (sh - eh)
        elo[h] = rh + delta
        elo[a] = ra - delta
        played[h] = played.get(h, 0) + 1
        played[a] = played.get(a, 0) + 1
    return elo, played


def npsl_bases():
    """Walk over the deduped NPSL results. -> {npsl_norm: rating}"""
    matches = json.load(open(ROOT / 'data' / 'npsl_matches_2026.json'))
    events, seen = [], set()
    for m in matches:
        if m.get('status') != 'ENDED':
            continue
        if not isinstance(m.get('s1'), int) or not isinstance(m.get('s2'), int):
            continue
        if not str(m.get('start', '')).startswith('2026'):
            continue
        key = (m['start'], m['t1'], m['t2'], m['s1'], m['s2'])
        if key in seen:  # Squadi lists playoff rounds under multiple div ids
            continue
        seen.add(key)
        events.append((m['start'], m['t1'], m['t2'], m['s1'], m['s2']))
    events.sort()
    elo, _ = elo_walk(events)
    return {npsl_norm(t): r + 100 for t, r in elo.items()}


def usl2_bases(clubs):
    """Walk over the banked USL2 results (data/usl2_matches.json, Modular11
    ids). Name bridging reuses compute_elo_usl2's norm + HAND_MAP so this
    matches exactly the clubs that writer rates. -> {club id: rating}"""
    spec = importlib.util.spec_from_file_location(
        'compute_elo_usl2', ROOT / 'scripts' / 'compute_elo_usl2.py')
    writer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(writer)
    bank = json.load(open(ROOT / 'data' / 'usl2_matches.json'))
    events = []
    for m in bank['matches'].values():
        if not m.get('score'):
            continue
        hg, ag = (int(x) for x in m['score'].split(':'))
        when = datetime.strptime(m['date'], '%m/%d/%y %I:%M%p')
        events.append((when, m['home'], m['away'], hg, ag))
    events.sort(key=lambda e: e[0])
    elo, played = elo_walk(events)
    by_norm = {writer.norm(c['n']): c['id'] for c in clubs
               if c.get('g') == 'usl2' and not c.get('h')}
    out = {}
    for tid, nm in bank['teams'].items():
        cid = by_norm.get(writer.norm(writer.HAND_MAP.get(nm, nm)))
        if cid and played.get(tid, 0) >= MIN_GP:
            out[cid] = elo[tid]
    return out


def prior_nudges(state_path, receipts_path):
    """Per-club cup nudge to strip from r. v2 state when present; else
    bootstrap from the receipt deltas the previous pipeline baked in."""
    if state_path.exists():
        st = json.load(open(state_path))
        return {cid: rec['n'] for cid, rec in st['clubs'].items()}
    if receipts_path.exists():
        return {cid: sum(e.get('d', 0) for e in evs)
                for cid, evs in json.load(open(receipts_path)).items()}
    return {}


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


def tier_check(by_lg, walk_of, mls_mean, O):
    """Loud guard against the Vermont-Green-over-Atlanta-United class of bug.

    Evaluated on the WALK-ONLY rating (league walk + league anchor, before
    any cup nudge). Deliberately NOT "no league may overlap the one above
    it" — adjacent-tier overlap is correct and expected in a pyramid. Two
    things a league walk alone cannot justify:

      1. lifting a non-MLS club above the MLS floor — a 19-game summer
         season against USL2 opposition says nothing about MLS;
      2. lifting a club more than MAX_ABOVE_MEAN over its OWN league's
         measured anchor (should be unreachable once the tail cap runs).

    Cup results ARE cross-tier evidence, so the nudge step may carry a club
    past either line; main() reports those crossings but does not refuse
    them. Beating pro clubs, not the label, is what moves a club past them.
    """
    bad = []
    if by_lg.get('mls'):
        floor = min(walk_of(c) for c in by_lg['mls'])
        for g, cs in by_lg.items():
            if g == 'mls':
                continue
            for c in cs:
                if walk_of(c) > floor:
                    bad.append(f'{c["n"]} ({g}, {walk_of(c):.0f}) is above the '
                               f'MLS floor ({floor:.0f}) on its league walk alone')
    for g, cs in by_lg.items():
        if g not in O:
            continue
        anchor = mls_mean + O[g]
        for c in cs:
            if walk_of(c) - anchor > MAX_ABOVE_MEAN:
                bad.append(f'{c["n"]} ({g}, {walk_of(c):.0f}) is '
                           f'{walk_of(c) - anchor:.0f} above its league anchor '
                           f'({anchor:.0f}) — within-league spread looks wrong')
    return bad


def cup_walk(men, by_id, anchored, mls_mean, O, HOME):
    """Chronological walk over 2022-26 cup matches on anchored ratings.
    Returns (nudge, proxy_gain, receipts). MLS clubs never move."""
    idx = {}
    for c in men:
        idx.setdefault(cup_norm(c['n']), []).append((c['g'], c['id']))

    def join(name, tag):
        # normalized-name ties (Foro SC apsl vs Foro Soccer Club upsl) break
        # on the cup's league tag; otherwise first club wins as before
        cands = idx.get(cup_norm(name))
        if not cands:
            return None
        want = CANON.get(tag or '')
        for g, cid in cands:
            if g == want:
                return cid
        return cands[0][1]

    cup = json.load(open(ROOT / 'data' / 'opencup_matches.json'))['matches']
    walk = dict(anchored)
    nudge, proxy_gain, receipts = {}, {}, {}
    for m in sorted((m for m in cup if m['year'] >= 2022), key=datekey):
        i1, i2 = join(m['t1'], m.get('l1')), join(m['t2'], m.get('l2'))
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
            if gg != 'mls':
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
    return nudge, proxy_gain, receipts


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--datajs', default=str(ROOT / 'js' / 'data.js'))
    ap.add_argument('--state', default=str(ROOT / 'data' / 'recal2_state.json'))
    ap.add_argument('--receipts', default=str(ROOT / 'data' / 'cup_receipts.json'))
    ap.add_argument('--dry', action='store_true',
                    help='report movement, write nothing')
    ap.add_argument('--allow-tier-cross', action='store_true',
                    help='write even if a league outrates the tier above it')
    args = ap.parse_args()
    state_path, receipts_path = pathlib.Path(args.state), pathlib.Path(args.receipts)

    offs = json.load(open(ROOT / 'data' / 'opencup_offsets.json'))['modern']
    O, HOME = dict(offs['offsets']), offs['home_adv']
    O['loc'] = O['regional']

    src, clubs = load_clubs(args.datajs)
    men = [c for c in clubs if c.get('x') == 'm' and c.get('r') and not c.get('h')]
    by_id = {c['id']: c for c in men}
    old_n = prior_nudges(state_path, receipts_path)
    prior_state = json.load(open(state_path)) if state_path.exists() else {}

    # --- 1. bases: r minus stored cup nudge; NPSL rebuilds from results ---
    base = {c['id']: c['r'] - old_n.get(c['id'], 0) for c in men}
    npsl = npsl_bases()
    n_rebuilt = 0
    for c in men:
        if c['g'] == 'npsl' and npsl_norm(c['n']) in npsl:
            base[c['id']] = npsl[npsl_norm(c['n'])]
            n_rebuilt += 1
    print(f'NPSL bases rebuilt from deduped results: {n_rebuilt}', file=sys.stderr)
    usl2 = usl2_bases(clubs)
    n_usl2, held = 0, []
    pool_median = sorted(usl2.values())[len(usl2) // 2] if usl2 else 1500
    for c in men:
        if c['g'] != 'usl2':
            continue
        if c['id'] in usl2:
            base[c['id']] = usl2[c['id']]
            n_usl2 += 1
        else:
            # no banked results (<MIN_GP games or unmatched name): a display-
            # scale base cannot ride a raw-scale shift without compounding, so
            # hold the club at the pool median (= the league anchor after shift).
            base[c['id']] = pool_median
            held.append(c['n'])
    print(f'USL2 bases rebuilt from banked results: {n_usl2}; held at league '
          f'median (no results): {held}', file=sys.stderr)

    # No spread shrink (principle 6): the raw walk is what the results support.
    by_lg = {}
    for c in men:
        by_lg.setdefault(c['g'], []).append(c)

    # --- 2. anchor league means to the measured offsets ---
    mls_mean = sum(base[c['id']] for c in by_lg['mls']) / len(by_lg['mls'])
    shifts = {}
    for g in ANCHORED:
        if g in by_lg:
            cur = sum(base[c['id']] for c in by_lg[g]) / len(by_lg[g])
            shifts[g] = (mls_mean + O[g]) - cur
    # NCAA pegs to USL2's LEVEL: it moves only when the USL2 anchor itself
    # moves (an offsets refit), never by USL2's per-run rebuild shift — that
    # shift is ~-120 every run now that USL2 rebuilds from a 1500-centred walk,
    # and pegging to it would march college ratings down 120 points per run.
    usl2_anchor = mls_mean + O['usl2']
    prior_anchor = prior_state.get('usl2_anchor')
    for g in NCAA_PEG:
        if g in by_lg:
            shifts[g] = (usl2_anchor - prior_anchor) if prior_anchor else 0.0
    anchored = {c['id']: base[c['id']] + shifts.get(c['g'], 0.0) for c in men}

    # --- 2b. tail cap: a league walk alone may not lift a club past the cap ---
    capped = []
    for c in men:
        if c['g'] in O and c['g'] != 'mls':
            lim = mls_mean + O[c['g']] + MAX_ABOVE_MEAN
            if anchored[c['id']] > lim:
                if anchored[c['id']] - lim >= 1:
                    capped.append(f"{c['n']} {anchored[c['id']]:.0f}->{lim:.0f}")
                anchored[c['id']] = lim
    if capped:
        print(f'tail cap (+{MAX_ABOVE_MEAN} over league anchor): {capped}', file=sys.stderr)
    print('shifts:', {g: round(s) for g, s in sorted(shifts.items(), key=lambda x: x[1])},
          file=sys.stderr)
    for g, cs in by_lg.items():
        center = sum(anchored[c['id']] for c in cs) / len(cs)
        wild = [c['n'] for c in cs if abs(anchored[c['id']] - center) > OUTLIER_BAND]
        if wild and g not in ('mls', 'npsl'):
            print(f'note: {g} clubs >{OUTLIER_BAND} from league center '
                  f'(check for league-churn contamination): {wild[:5]}', file=sys.stderr)

    # --- 3. cup walk + provisional flags ---
    nudge, proxy_gain, receipts = cup_walk(men, by_id, anchored, mls_mean, O, HOME)
    moved = 0
    state = {'mls_mean': round(mls_mean, 1), 'usl2_anchor': round(usl2_anchor, 1),
             'shifts': {g: round(s, 1) for g, s in shifts.items()}, 'clubs': {}}
    for c in clubs:
        c.pop('pv', None)
    for c in men:
        cid = c['id']
        newr = round(anchored[cid] + (nudge.get(cid, 0.0) if c['g'] != 'mls' else 0.0))
        state['clubs'][cid] = {'b': round(base[cid], 1),
                               's': round(shifts.get(c['g'], 0.0), 1),
                               'n': round(nudge.get(cid, 0.0), 1)}
        if newr != c['r']:
            moved += 1
        c['r'] = newr
        nd, pg = abs(nudge.get(cid, 0)), proxy_gain.get(cid, 0)
        total_move = sum(abs(e['d']) for e in receipts.get(cid, [])) or 1
        if nd > PV_MIN_NUDGE and pg / total_move > PV_PROXY_SHARE:
            c['pv'] = 1
    npv = sum(1 for c in men if c.get('pv'))

    # --- 4. tier guard on the walk alone; cup-earned crossings are reported ---
    violations = tier_check(by_lg, lambda c: anchored[c['id']], mls_mean, O)
    if by_lg.get('mls'):
        floor = min(c['r'] for c in by_lg['mls'])
        earned = [f"{c['n']} ({c['g']}, {c['r']})" for c in men
                  if c['g'] != 'mls' and c['r'] > floor]
        if earned:
            print(f'note: above the MLS floor ({floor}) on cup results: {earned}',
                  file=sys.stderr)
    if violations:
        print('TIER VIOLATION:', file=sys.stderr)
        for v in violations:
            print(f'  {v}', file=sys.stderr)
        if not args.allow_tier_cross:
            sys.exit('refusing to write — a lower tier outrates the floor of the '
                     'tier above it. This is the Vermont-Green-over-Atlanta-United '
                     'class of bug. Re-run with --allow-tier-cross only if the '
                     'crossing is genuinely supported by cup results.')
        print('  --allow-tier-cross set; writing anyway', file=sys.stderr)

    if args.dry:
        print(f'DRY RUN: {moved} of {len(men)} rated men would move, '
              f'{npv} provisional; nothing written')
        return
    write_clubs(args.datajs, src, clubs)
    json.dump(state, open(state_path, 'w'), ensure_ascii=False)
    json.dump(receipts, open(receipts_path, 'w'), ensure_ascii=False,
              separators=(',', ':'))
    print(f'wrote {args.datajs} ({len(men)} men rated, {moved} moved), '
          f'{receipts_path.name} ({len(receipts)} clubs), {npv} provisional')


if __name__ == '__main__':
    main()
