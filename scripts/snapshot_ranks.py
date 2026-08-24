#!/usr/bin/env python3
"""Rotate data/rank_snapshot.json — the "where every club stood last week" file
that club and league pages diff against to show movement.

Why a separate script instead of a write inside gen_club_pages.py: deploy.sh
runs the generators against the working tree and never commits, so a snapshot
written at deploy time would be thrown away on the next checkout and movement
would read as zero forever. The scheduled refresh workflow *does* commit, so
rotation runs there, before the commit step, and the generators only ever read
the file. That also keeps a deploy idempotent — running it twice cannot change
what the pages claim.

Rotation is time-gated: the snapshot is only replaced once it is ROTATE_DAYS
old, so a day with three refreshes still compares against last week rather
than against this morning (which would show every club as unmoved).

  python3 scripts/snapshot_ranks.py           # rotate if due
  python3 scripts/snapshot_ranks.py --force   # rotate now (bootstrap)
  python3 scripts/snapshot_ranks.py --check   # report age, write nothing
"""
import datetime
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SNAP = os.path.join(ROOT, 'data', 'rank_snapshot.json')
ROTATE_DAYS = 6      # a week's cadence with a day of slack for cron drift


def current():
    """Ratings and national ranks as they stand in js/data.js right now.
    Ranks are computed the same way gen_club_pages.py computes them — rated
    clubs only, split by men's/women's, descending rating."""
    src = open(os.path.join(ROOT, 'js', 'data.js')).read()
    clubs = json.loads(re.search(r'export const CLUBS=(\[.*?\]);', src, re.S).group(1))
    rated = [c for c in clubs if not c.get('h') and c.get('r') and c.get('id')]
    by_sex = {}
    for c in rated:
        by_sex.setdefault(c.get('x', 'm'), []).append(c)
    nat = {}
    for pool in by_sex.values():
        pool.sort(key=lambda c: -c['r'])
        for i, c in enumerate(pool):
            nat[c['id']] = i + 1
    return {c['id']: [c['r'], nat[c['id']]] for c in rated}


def load():
    try:
        with open(SNAP) as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def main():
    force = '--force' in sys.argv
    check = '--check' in sys.argv
    today = datetime.date.today()
    prev = load()

    if prev:
        age = (today - datetime.date.fromisoformat(prev['date'])).days
        print(f'snapshot {prev["date"]} — {age}d old, {len(prev.get("clubs", {}))} clubs')
    else:
        age = None
        print('no snapshot on disk — first run')

    if check:
        return 0
    if prev and not force and age < ROTATE_DAYS:
        print(f'not due (rotates at {ROTATE_DAYS}d) — left alone')
        return 0

    snap = {'date': today.isoformat(), 'clubs': current()}
    os.makedirs(os.path.dirname(SNAP), exist_ok=True)
    with open(SNAP, 'w') as fh:
        json.dump(snap, fh, separators=(',', ':'), sort_keys=True)
    print(f'wrote {SNAP}: {len(snap["clubs"])} clubs as of {snap["date"]}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
