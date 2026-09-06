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


def check(root=ROOT):
    """Return (failures, summary). The three files are only useful together: a
    league in standings.json with no seasons.json entry renders nothing, and a
    season length that disagrees with played + scheduled produces a projected
    points-per-game above the 3.0 maximum (which is how the NWSL/USLC
    hardcoded season lengths were caught)."""
    fail = []
    try:
        sea, std, sch, clubs = _load(root)
    except FileNotFoundError as e:
        return [f'season race data missing: {e}'], ''
    except Exception as e:
        return [f'season race gate: {e}'], ''
    orphan_lg = sorted(set(std) - set(sea))
    if orphan_lg:
        fail.append(f'standings.json has leagues with no seasons.json entry: {orphan_lg}')
    bad_ids = {f[k] for f in sch for k in ('h', 'a') if f[k] not in clubs}
    if bad_ids:
        fail.append(f'schedule_rest.json points at {len(bad_ids)} unknown club ids: {sorted(bad_ids)[:4]}')
    std_ids = {r['id'] for g in std.values() for grp in g['groups'] for r in grp['rows']}
    miss = sorted(std_ids - clubs)
    if miss:
        fail.append(f'standings.json has {len(miss)} club ids not in data.js: {miss[:4]}')
    today = pacific_today().isoformat()
    stale = [f for f in sch if f['d'] < today]
    if stale:
        fail.append(f'schedule_rest.json holds {len(stale)} fixtures before today — '
                    'it must contain only games still to be played')
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
                    fail.append(f'{lg}/{r["id"]}: {r["gp"]} played + {left.get(r["id"], 0)} '
                                f'scheduled = {tot}, more than the {meta["games"]}-game season')
                    break
    summary = f'{len(sea)} leagues, {len(std_ids)} clubs, {len(sch)} fixtures still to play'
    return fail, summary


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
