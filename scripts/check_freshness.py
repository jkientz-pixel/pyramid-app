#!/usr/bin/env python3
"""Freshness gate: fail loudly when an in-season league's ratings go stale.

Written after the 2026-09-23 audit found MLS frozen since Aug 1, USL Super
League walking last season, and UPSL/APSL still on spring tables, all while
every scheduled refresh reported success. Each of those was a writer that
silently stopped writing. This gate checks the INPUTS each league's rating
comes from, and one output check (MLS order vs the live table) that catches a
writer being dropped from the pipeline.

Writes data/freshness.json ({league: {updated, source, stale}}) for the site's
"updated" labels, then exits 1 listing every stale league. The scheduled
refresh runs it AFTER the deploy, so a stale league opens a scrape-failure
issue without blocking the leagues that did refresh.

Usage: check_freshness.py [--report-only] [--today YYYY-MM-DD]
  --report-only  write data/freshness.json and exit 0 (the pre-deploy step)
"""
import json, re, sys, pathlib
from datetime import date

ROOT = pathlib.Path(__file__).resolve().parent.parent

# Months each league is reliably playing. Outside them a quiet feed is the
# offseason, not a failure. Kept conservative: a false alarm every winter
# teaches everyone to ignore the gate.
IN_SEASON = {
    'mls': {3, 4, 5, 6, 7, 8, 9, 10},
    'uslc': {4, 5, 6, 7, 8, 9, 10},
    'usl1': {4, 5, 6, 7, 8, 9, 10},
    'mnp': {4, 5, 6, 7, 8, 9},
    'nwsl': {4, 5, 6, 8, 9, 10},
    'uslw': {9, 10, 11, 3, 4, 5},
    'upsl': {3, 4, 5, 9, 10, 11},
    'apsl': {9, 10, 11, 3, 4, 5},
}
MAX_GAME_GAP = 21     # days since the newest rated result, results-walk leagues
MAX_SCRAPE_AGE = 4    # days since a standings scrape (UPSL, APSL)
MAX_TABLE_AGE = 2     # days since data/standings.json (ESPN, twice daily)
MIN_MLS_RHO = 0.9     # MLS rating order vs the live table


def spearman(a, b):
    """Rank correlation of two equal-length lists (average ranks for ties)."""
    def ranks(xs):
        order = sorted(range(len(xs)), key=lambda i: xs[i])
        r = [0.0] * len(xs)
        i = 0
        while i < len(order):
            j = i
            while j + 1 < len(order) and xs[order[j + 1]] == xs[order[i]]:
                j += 1
            for k in range(i, j + 1):
                r[order[k]] = (i + j) / 2
            i = j + 1
        return r
    ra, rb = ranks(a), ranks(b)
    n = len(a)
    ma, mb = sum(ra) / n, sum(rb) / n
    cov = sum((x - ma) * (y - mb) for x, y in zip(ra, rb))
    va = sum((x - ma) ** 2 for x in ra) ** 0.5
    vb = sum((y - mb) ** 2 for y in rb) ** 0.5
    return cov / (va * vb) if va and vb else 0.0


def age(today, iso):
    return (today - date.fromisoformat(iso[:10])).days if iso else 10 ** 6


def check(today, wire, standings, upsl, apsl, mls_clubs):
    """Returns {league: {'updated', 'source', 'stale': reason or None}}."""
    out = {}

    def put(lg, updated, source, reason):
        live = today.month in IN_SEASON.get(lg, set())
        out[lg] = {'updated': updated, 'source': source, 'stale': reason if live else None}

    newest = {}
    for g in wire:
        newest[g['lg']] = max(newest.get(g['lg'], ''), g['d'])
    for lg in ('uslc', 'usl1', 'mnp', 'nwsl', 'uslw'):
        d = newest.get(lg, '')
        put(lg, d, 'results (ASA)',
            f'newest rated result {d or "none"}, over {MAX_GAME_GAP} days old'
            if age(today, d) > MAX_GAME_GAP else None)

    t_upd = standings.get('updated', '')
    reason = None
    if age(today, t_upd) > MAX_TABLE_AGE:
        reason = f'league table fetched {t_upd or "never"}'
    else:
        rows = {r['id']: r for grp in standings['leagues']['mls']['groups'] for r in grp['rows']}
        both = [c for c in mls_clubs if c['id'] in rows and rows[c['id']]['gp']]
        tbl = [(rows[c['id']]['pts'] - rows[c['id']].get('ded', 0)) / rows[c['id']]['gp']
               + 0.25 * rows[c['id']]['gd'] / rows[c['id']]['gp'] for c in both]
        rho = spearman([c['r'] for c in both], tbl) if len(both) > 2 else 0.0
        if rho < MIN_MLS_RHO:
            reason = f'MLS ratings do not follow the table (rank corr {rho:.2f} < {MIN_MLS_RHO})'
    put('mls', t_upd[:10], 'official table (ESPN)', reason)

    by_div = {}
    for t in upsl:
        by_div.setdefault(t['division'], []).append(t.get('fetched', ''))
    oldest = min((min(v) for v in by_div.values()), default='')
    late = sorted(d for d, v in by_div.items() if age(today, min(v)) > MAX_SCRAPE_AGE)
    put('upsl', oldest, 'standings (upsl.com)',
        f'UPSL {", ".join(late)} standings last fetched {oldest or "never"}' if late else None)

    a_upd = apsl.get('fetched', '')
    put('apsl', a_upd, 'standings (apslsoccer.com)',
        f'APSL standings last fetched {a_upd or "never"}' if age(today, a_upd) > MAX_SCRAPE_AGE else None)
    return out


def load(name, default):
    p = ROOT / 'data' / name
    return json.load(open(p)) if p.exists() else default


def main():
    today = date.today()
    if '--today' in sys.argv:
        today = date.fromisoformat(sys.argv[sys.argv.index('--today') + 1])
    src = (ROOT / 'js' / 'data.js').read_text()
    clubs = json.loads(re.search(r'export const CLUBS=(\[.*?\]);', src, re.S).group(1))
    mls = [c for c in clubs if c.get('g') == 'mls' and not c.get('h') and c.get('r')]
    res = check(today, load('wire_asa.json', []), load('standings.json', {}),
                load('upsl.json', []), load('apsl_current.json', {}), mls)
    # no run timestamp in the file: it only changes when a league's data does,
    # so an idle refresh stays an empty diff and doesn't trigger a deploy
    json.dump({'leagues': res}, open(ROOT / 'data' / 'freshness.json', 'w'), indent=1, sort_keys=True)
    stale = {lg: v['stale'] for lg, v in res.items() if v['stale']}
    for lg, v in sorted(res.items()):
        print(f"{lg:5} updated {v['updated'] or '-':10}  {'STALE: ' + v['stale'] if v['stale'] else 'ok'}")
    if stale and '--report-only' not in sys.argv:
        for lg, why in stale.items():
            print(f'::error title=Stale ratings ({lg})::{why}')
        sys.exit(1)


if __name__ == '__main__':
    main()
