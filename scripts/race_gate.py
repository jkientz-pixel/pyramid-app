#!/usr/bin/env python3
"""Season Race inputs: the consistency check preflight runs on
data/seasons.json + data/standings.json + data/schedule_rest.json, and the
refresh workflow's fallback when a fresh fetch fails that check.

Why a fallback: the race trio is secondary data. On 2026-09-06 one ESPN
timing glitch (a match already in the table but not yet `completed` on the
scoreboard) failed preflight, and that blocked rosters, ratings, cup results
and share cards for twelve hours even though all of them were fine. The
workflow now runs this with --fallback right after fetch_race.py: if the
fresh files fail, the last committed copies are restored, fixtures already
played are pruned from the restored schedule, and the run continues with a
warning annotation instead of a failure. Only if the fallback fails too does
the step exit non-zero.

The fallback works league by league first: only the leagues that fail are
restored and every other league keeps its fresh table and fixtures. The
whole trio is restored only when a failure belongs to no single league or
the merged set still fails.

    python3 scripts/race_gate.py             # check, exit 1 on failure
    python3 scripts/race_gate.py --fallback  # check, restore + prune on failure

Restoring never raises a club's played + scheduled total: standings from the
last commit are equal or lower, and pruning only removes fixtures, so the
over-count test preflight applies cannot fail on a restored set that passed
when it was committed.
"""
import datetime as _dt
import json
import os
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
FILES = ('data/seasons.json', 'data/standings.json', 'data/schedule_rest.json')


def pacific_today():
    """Today in Los Angeles. The data is refreshed and read on Pacific time, so
    the date checks must not roll over at 5 PM PT just because a CI runner
    sits on UTC — that made every evening deploy flag the day's remaining
    fixtures as stale (four red emails on 2026-09-04)."""
    try:
        from zoneinfo import ZoneInfo
        return _dt.datetime.now(ZoneInfo('America/Los_Angeles')).date()
    except Exception:  # no tz database on the host: fixed PST is still closer than UTC
        return (_dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(hours=8)).date()


def _load(root):
    sea = json.loads((root / 'data' / 'seasons.json').read_text()).get('leagues', {})
    std = json.loads((root / 'data' / 'standings.json').read_text()).get('leagues', {})
    sch = json.loads((root / 'data' / 'schedule_rest.json').read_text()).get('fixtures', [])
    clubs = {c['id'] for c in json.loads(
        re.search(r'export const CLUBS=(\[.*?\]);', (root / 'js' / 'data.js').read_text(), re.S).group(1))}
    return sea, std, sch, clubs


def league_failures(sea, std, sch, clubs, today):
    """Return [(league, message)] for every inconsistency in the trio. Each
    failure names the league it belongs to, so the fallback can restore just
    that league; None marks a failure no single league owns."""
    fail = []
    for lg in sorted(set(std) - set(sea)):
        fail.append((lg, f'standings.json has {lg} with no seasons.json entry'))
    bad_ids = {}
    for f in sch:
        for k in ('h', 'a'):
            if f[k] not in clubs:
                bad_ids.setdefault(f.get('lg'), set()).add(f[k])
    for lg, ids in bad_ids.items():
        fail.append((lg, f'schedule_rest.json points at {len(ids)} unknown {lg} club ids: {sorted(ids)[:4]}'))
    for lg, g in std.items():
        miss = sorted({r['id'] for grp in g['groups'] for r in grp['rows']} - clubs)
        if miss:
            fail.append((lg, f'standings.json has {len(miss)} {lg} club ids not in data.js: {miss[:4]}'))
    stale = {}
    for f in sch:
        if f['d'] < today:
            stale[f.get('lg')] = stale.get(f.get('lg'), 0) + 1
    for lg, n in stale.items():
        fail.append((lg, f'schedule_rest.json holds {n} {lg} fixtures before today — '
                         'it must contain only games still to be played'))
    for lg, meta in sea.items():
        if lg not in std:
            continue
        left = {}
        for f in sch:
            if f.get('lg') != lg:
                continue
            for k in ('h', 'a'):
                left[f[k]] = left.get(f[k], 0) + 1
        for grp in std[lg]['groups']:
            for r in grp['rows']:
                tot = r['gp'] + left.get(r['id'], 0)
                if tot > meta['games']:
                    fail.append((lg, f'{lg}/{r["id"]}: {r["gp"]} played + {left.get(r["id"], 0)} '
                                     f'scheduled = {tot}, more than the {meta["games"]}-game season'))
                    break
    return fail


def check(root=ROOT):
    """Return (failures, summary). The three files are only useful together: a
    league in standings.json with no seasons.json entry renders nothing, and a
    season length that disagrees with played + scheduled produces a projected
    points-per-game above the 3.0 maximum (which is how the NWSL/USLC
    hardcoded season lengths were caught)."""
    try:
        sea, std, sch, clubs = _load(root)
    except FileNotFoundError as e:
        return [f'season race data missing: {e}'], ''
    except Exception as e:
        return [f'season race gate: {e}'], ''
    fail = [msg for _, msg in league_failures(sea, std, sch, clubs, pacific_today().isoformat())]
    std_ids = {r['id'] for g in std.values() for grp in g['groups'] for r in grp['rows']}
    summary = f'{len(sea)} leagues, {len(std_ids)} clubs, {len(sch)} fixtures still to play'
    return fail, summary


def salvage(fresh, last, bad, today):
    """Merge the fresh trio with the last committed one, league by league.

    `fresh` and `last` are (seasons leagues, standings doc, schedule doc).
    Returns the merged triple in the same shape. Leagues in `bad` take their last committed season,
    table and remaining fixtures (minus any already played); every other
    league keeps its fresh data. Each league's table carries its own
    `updated` stamp so the freshness gate sees a restored table at its real
    age instead of the fresh top-level stamp.

    Why: on 2026-10-29 one USL League One row (32 played + 1 scheduled in a
    32-game season) made the all-or-nothing fallback throw away three days of
    good MLS tables, and the freshness gate failed the run on MLS."""
    f_sea, f_std, f_sch = fresh
    l_sea, l_std, l_sch = last
    stamp, l_stamp = f_std.get('updated', ''), l_std.get('updated', '')
    f_lgs, l_lgs = f_std.get('leagues', {}), l_std.get('leagues', {})
    sea, std = {}, {}
    for lg in sorted(set(f_sea) | set(f_lgs) | set(l_sea) | set(l_lgs)):
        src_sea, src_std, upd = (l_sea, l_lgs, None) if lg in bad else (f_sea, f_lgs, stamp)
        if lg in src_sea:
            sea[lg] = src_sea[lg]
        if lg in src_std:
            std[lg] = {**src_std[lg], 'updated': upd or src_std[lg].get('updated', l_stamp)}
    sch = [f for f in f_sch.get('fixtures', []) if f.get('lg') not in bad]
    sch += prune_played([f for f in l_sch.get('fixtures', []) if f.get('lg') in bad], today)
    sch = sorted(sch, key=lambda f: f['d'])
    return sea, {**f_std, 'leagues': std}, {**f_sch, 'fixtures': sch}


def prune_played(fixtures, today):
    """Drop fixtures dated before `today` (ISO string). A restored schedule is
    up to a day old, and preflight rejects any fixture already in the past."""
    return [f for f in fixtures if f['d'] >= today]


def restore_last_good(root=ROOT):
    """Put the last committed race trio back, minus fixtures already played."""
    for rel in FILES:
        src = subprocess.run(['git', 'show', f'HEAD:{rel}'], capture_output=True,
                             text=True, check=True, cwd=root).stdout
        (root / rel).write_text(src)
    p = root / 'data' / 'schedule_rest.json'
    doc = json.loads(p.read_text())
    before = len(doc.get('fixtures', []))
    doc['fixtures'] = prune_played(doc.get('fixtures', []), pacific_today().isoformat())
    p.write_text(json.dumps(doc, separators=(',', ':')))
    return before - len(doc['fixtures'])


def _read_trio(root, rev=None):
    """The three race documents from disk, or from git at `rev`."""
    docs = []
    for rel in FILES:
        if rev is None:
            src = (root / rel).read_text()
        else:
            src = subprocess.run(['git', 'show', f'{rev}:{rel}'], capture_output=True,
                                 text=True, check=True, cwd=root).stdout
        docs.append(json.loads(src))
    return docs


def salvage_by_league(root=ROOT):
    """Restore only the leagues whose fresh data fails, keep the rest fresh.
    Returns the restored league names, or None when a failure is not tied to
    one league (or the files cannot be read) and only a full restore will do."""
    try:
        fresh = _read_trio(root)
        last = _read_trio(root, 'HEAD')
        sea, std, sch, clubs = _load(root)
    except (OSError, ValueError, subprocess.CalledProcessError):
        return None
    today = pacific_today().isoformat()
    bad = {lg for lg, _ in league_failures(sea, std, sch, clubs, today)}
    if not bad or None in bad:
        return None
    merged = salvage((fresh[0].get('leagues', {}), fresh[1], fresh[2]),
                     (last[0].get('leagues', {}), last[1], last[2]), bad, today)
    out = ({**fresh[0], 'leagues': merged[0]}, merged[1], merged[2])
    for rel, doc in zip(FILES, out):
        (root / rel).write_text(json.dumps(doc, separators=(',', ':')))
    return sorted(bad)


def _annotate(level, msg):
    """GitHub Actions annotation (shows on the run, sends no email) plus the
    job summary; plain stderr anywhere else."""
    print(f'::{level} title=Season race::{msg}')
    summ = os.environ.get('GITHUB_STEP_SUMMARY')
    if summ:
        with open(summ, 'a') as fh:
            fh.write(f'- **Season race {level}:** {msg}\n')


def main(argv):
    fallback = '--fallback' in argv
    fail, summary = check()
    if not fail:
        print(f'season race OK - {summary}')
        return 0
    if not fallback:
        print('SEASON RACE GATE FAILED:\n  ' + '\n  '.join(fail), file=sys.stderr)
        return 1
    restored = salvage_by_league()
    if restored is not None:
        fail2, summary2 = check()
        if not fail2:
            _annotate('warning', f'fresh race data rejected for {", ".join(restored)} only, '
                      f'kept the last committed copy for {"those" if len(restored) > 1 else "that"} '
                      f'league and fresh data for the rest ({summary2}): ' + ' | '.join(fail))
            return 0
    _annotate('warning', 'fresh race data rejected, keeping the last committed copy: '
              + ' | '.join(fail))
    try:
        pruned = restore_last_good()
    except subprocess.CalledProcessError as e:
        _annotate('error', f'could not restore the last committed race files: {e}')
        return 1
    fail2, summary2 = check()
    if fail2:
        _annotate('error', 'the restored copy fails too: ' + ' | '.join(fail2))
        return 1
    _annotate('warning', f'restored last good race data ({summary2}; {pruned} played '
              'fixtures pruned). The race view is up to a refresh old until ESPN agrees with itself.')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
