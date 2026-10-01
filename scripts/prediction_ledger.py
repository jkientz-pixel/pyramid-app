#!/usr/bin/env python3
"""Public prediction ledger: freeze the odds we show before kickoff, score
them after, and publish the record (data/accuracy.json, rendered at /accuracy).

Why: a rating site's claim to be right is only as good as a record nobody can
edit after the fact. Every refresh:

  freeze  fixtures kicking off in the next FREEZE_HOURS get the same
          win/draw/loss odds the app shows (js/app.js oddsFor, ported
          exactly below) written to data/predictions.json with the ratings
          used and the time frozen. An entry is NEVER changed once written.
  score   frozen games that have kicked off are matched to their result in
          data/wire_asa.json. A game with no result VOID_DAYS after kickoff
          (postponed, abandoned) is marked void, never deleted.
  report  data/accuracy.json: hit rate, Brier score, log loss and a
          calibration table, overall and per league, plus a clearly labelled
          walk-forward backtest over this season's results.

Pro tier only (js/app.js ODDS_TIER): odds on amateur, college or youth
fixtures are off by policy (2026-08-25), so they are neither shown nor logged.

Usage: prediction_ledger.py [--now 2026-09-29T12:00]
"""
import json, math, sys, pathlib
from datetime import datetime, timedelta, timezone

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from _datajs import load_clubs, ROOT
import _elo_pro as ELO

PRO = ('mls', 'uslc', 'usl1', 'mnp', 'nwsl', 'uslw')  # js/app.js ODDS_TIER
HOME_ADV, LAMBDA = ELO.HOME_ADV, 1.35                 # js/app.js oddsFor, pro
FREEZE_HOURS = 36   # refresh runs every 12h: every game is frozen 24-36h before kickoff
VOID_DAYS = 7
MATCH_DAYS = 1      # ESPN kickoff (UTC) vs ASA date can differ by a day
LEDGER = ROOT / 'data' / 'predictions.json'
REPORT = ROOT / 'data' / 'accuracy.json'
FACT = [1, 1, 2, 6, 24, 120, 720, 5040]


def odds(rh, ra, ha=HOME_ADV, lam=LAMBDA):
    """(pH, pD, pA): exact port of js/app.js oddsFor for two pro clubs."""
    d = rh + ha - ra
    lh, la = lam * 10 ** (d / 1000), lam * 10 ** (-d / 1000)
    pois = lambda l, k: math.exp(-l) * l ** k / FACT[k]
    ph = pd = pa = 0.0
    for i in range(8):
        for j in range(8):
            p = pois(lh, i) * pois(la, j)
            if i > j: ph += p
            elif i == j: pd += p
            else: pa += p
    t = ph + pd + pa
    return ph / t, pd / t, pa / t


def outcome(s1, s2):
    return 0 if s1 > s2 else 1 if s1 == s2 else 2


def freeze(ledger, fixtures, clubs, now):
    """Add every pro fixture kicking off within FREEZE_HOURS that isn't frozen yet."""
    by_id = {c['id']: c for c in clubs}
    have = {e['k'] for e in ledger}
    horizon = now + timedelta(hours=FREEZE_HOURS)
    added = []
    for f in fixtures:
        if f['lg'] not in PRO:
            continue
        start = datetime.fromisoformat(f['start'].replace('Z', '+00:00'))
        h, a = by_id.get(f.get('id1')), by_id.get(f.get('id2'))
        if not (now < start <= horizon and h and a and h.get('r') and a.get('r')):
            continue
        k = f"{f['lg']}:{f['start'][:16]}:{h['id']}:{a['id']}"
        if k in have:
            continue
        ph, pd, pa = odds(h['r'], a['r'])
        added.append({'k': k, 'lg': f['lg'], 'start': f['start'], 'id1': h['id'], 'id2': a['id'],
                      'n1': h['n'], 'n2': a['n'], 'r1': h['r'], 'r2': a['r'],
                      'p': [round(ph, 4), round(pd, 4), round(pa, 4)],
                      'frozen': now.strftime('%Y-%m-%dT%H:%MZ')})
        have.add(k)
    return ledger + added, len(added)


def score(ledger, wire, now):
    """Attach results to frozen games. Returns a new list; frozen fields untouched."""
    idx = {}
    for w in wire:
        idx.setdefault((w['lg'], w['t1'], w['t2']), []).append(w)
    out, scored = [], 0
    for e in ledger:
        if 'res' in e or e.get('void'):
            out.append(e); continue
        start = datetime.fromisoformat(e['start'].replace('Z', '+00:00'))
        if start > now:
            out.append(e); continue
        day = start.date()
        hit = next((w for w in idx.get((e['lg'], e['n1'], e['n2']), [])
                    if abs((datetime.fromisoformat(w['d']).date() - day).days) <= MATCH_DAYS), None)
        if hit:
            out.append({**e, 'res': [hit['s1'], hit['s2']]}); scored += 1
        elif now - start > timedelta(days=VOID_DAYS):
            out.append({**e, 'void': True})
        else:
            out.append(e)
    return out, scored


def summarize(games):
    """games: [(p=(ph,pd,pa), out=0|1|2)] -> hit rate, Brier, log loss, calibration."""
    n = len(games)
    if not n:
        return {'n': 0}
    hits = brier = ll = 0.0
    cal = {}
    for p, o in games:
        pick = max(range(3), key=lambda i: p[i])
        hits += pick == o
        brier += sum((p[i] - (i == o)) ** 2 for i in range(3))
        ll -= math.log(max(p[o], 1e-9))
        b = min(9, int(p[pick] * 10))
        c = cal.setdefault(b, [0, 0, 0.0])
        c[0] += 1; c[1] += pick == o; c[2] += p[pick]
    return {'n': n, 'hit': round(hits / n, 3), 'brier': round(brier / n, 3), 'logloss': round(ll / n, 3),
            'cal': [{'band': f'{b * 10}-{b * 10 + 10}%', 'n': c[0], 'predicted': round(c[2] / c[0], 3),
                     'actual': round(c[1] / c[0], 3)} for b, c in sorted(cal.items())]}


def backtest(wire):
    """Walk-forward over this season's results with the production engine
    (_elo_pro, xG-weighted updates from the wire's x1/x2): every game predicted
    from only the games before it. Teams start the season level here, while the
    live walk carries half of last season, so this understates the live model
    early on."""
    games, by_lg = [], {}
    for w in sorted(wire, key=lambda w: w['d']):
        if w['lg'] not in PRO:
            continue
        elo = by_lg.setdefault(w['lg'], {})
        h, a = w['t1'], w['t2']
        rh, ra = elo.get(h, 1500), elo.get(a, 1500)
        if h in elo and a in elo:
            games.append((w['lg'], odds(rh, ra), outcome(w['s1'], w['s2'])))
        delta, _ = ELO.update(rh, ra, w['s1'], w['s2'], w.get('x1'), w.get('x2'))
        elo[h], elo[a] = rh + delta, ra - delta
    return games


def per_league(rows):
    """rows: [(lg, p, outcome)] -> overall summary plus one per league."""
    return {**summarize([(p, o) for _, p, o in rows]),
            'leagues': {lg: summarize([(p, o) for l2, p, o in rows if l2 == lg])
                        for lg in PRO if any(l2 == lg for l2, _, _ in rows)}}


def report(ledger, wire):
    live = [e for e in ledger if 'res' in e]
    recent = sorted(live, key=lambda e: e['start'], reverse=True)[:40]
    return {
        'live': {**per_league([(e['lg'], e['p'], outcome(*e['res'])) for e in live]),
                 'since': min((e['frozen'] for e in ledger), default=''),
                 'pending': sum(1 for e in ledger if 'res' not in e and not e.get('void')),
                 'void': sum(1 for e in ledger if e.get('void'))},
        'backtest': per_league(backtest(wire)),
        'recent': [{k: e[k] for k in ('lg', 'start', 'n1', 'n2', 'p', 'res', 'frozen')} for e in recent],
        'baseline_brier': round(2 / 3, 3),
    }


def load(path, default):
    return json.load(open(path)) if path.exists() else default


def main():
    now = datetime.now(timezone.utc)
    if '--now' in sys.argv:
        now = datetime.fromisoformat(sys.argv[sys.argv.index('--now') + 1]).replace(tzinfo=timezone.utc)
    ledger = load(LEDGER, [])
    clubs = [c for c in load_clubs() if not c.get('h')]
    ledger, added = freeze(ledger, load(ROOT / 'data' / 'fixtures.json', []), clubs, now)
    wire = load(ROOT / 'data' / 'wire_asa.json', [])
    ledger, scored = score(ledger, wire, now)
    json.dump(ledger, open(LEDGER, 'w'), indent=0, separators=(',', ':'))
    rep = report(ledger, wire)
    json.dump(rep, open(REPORT, 'w'), indent=1, sort_keys=True)
    lv, bt = rep['live'], rep['backtest']
    print(f"ledger: +{added} frozen, +{scored} scored; live {lv.get('n', 0)} scored "
          f"(hit {lv.get('hit', '-')}, Brier {lv.get('brier', '-')}), {lv['pending']} pending; "
          f"backtest {bt.get('n', 0)} games hit {bt.get('hit', '-')} Brier {bt.get('brier', '-')}")


if __name__ == '__main__':
    main()
