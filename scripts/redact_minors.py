#!/usr/bin/env python3
"""Blank under-18 birth years in committed player data.

Standing policy (2026-07-28): amateur-tier players 18+ show name and birth
year; players under 18 keep their name but their birth year is blanked, and can
opt in personally to show age. This repo is public, so committed means
published — the redaction has to happen before the file lands in git, not
before it reaches the website. data/usl2_lineups.json is not in deploy.sh's
staged tree at all, and was still publishing 1,150 minors' birth years through
GitHub because the roster file got the treatment and the lineup file did not.

Run this after any scrape that refreshes a player file, and note that
scripts/preflight.py now fails if a minor's birth year is present, so a future
refresh cannot quietly undo it.

Usage: python3 scripts/redact_minors.py [--check]
  --check  report violations and exit non-zero, changing nothing
"""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Season the data describes. A player is a minor if born in or after
# SEASON - 18; for the 2026 season that is 2008.
SEASON = 2026
MINOR_BORN_FROM = SEASON - 18

# Files carrying per-player birth years. usl2_rosters.json is listed even
# though it is already clean: the point is that it stays that way.
TARGETS = ['data/usl2_lineups.json', 'data/usl2_rosters.json']


def redact(node, stats, apply_changes):
    """Walk any nested structure, blanking 'y' on player-shaped dicts."""
    if isinstance(node, dict):
        name = node.get('n') or node.get('name')
        year = node.get('y')
        if name and year not in (None, '', 0):
            try:
                if int(year) >= MINOR_BORN_FROM:
                    stats.append((name, year))
                    if apply_changes:
                        node['y'] = ''
            except (TypeError, ValueError):
                pass
        for v in node.values():
            redact(v, stats, apply_changes)
    elif isinstance(node, list):
        for v in node:
            redact(v, stats, apply_changes)


def main():
    check_only = '--check' in sys.argv
    total = 0
    for rel in TARGETS:
        path = os.path.join(ROOT, rel)
        if not os.path.exists(path):
            continue
        data = json.load(open(path))
        stats = []
        redact(data, stats, apply_changes=not check_only)
        total += len(stats)
        if stats and not check_only:
            json.dump(data, open(path, 'w'), separators=(',', ':'))
            people = len({n for n, _ in stats})
            print(f'  {rel}: blanked {len(stats)} birth years across {people} players')
        elif stats:
            people = len({n for n, _ in stats})
            print(f'  {rel}: {len(stats)} rows / {people} players born '
                  f'{MINOR_BORN_FROM} or later still carry a birth year', file=sys.stderr)
        else:
            print(f'  {rel}: clean')
    if check_only and total:
        sys.exit(f'FAILED: {total} under-18 birth years present — run '
                 f'scripts/redact_minors.py to blank them')
    print('minors redaction clean' if not total else 'redaction applied')


if __name__ == '__main__':
    main()
