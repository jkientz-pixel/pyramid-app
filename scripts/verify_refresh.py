#!/usr/bin/env python3
"""Post-refresh gate for the scheduled roster action. Compares the freshly
scraped js/rosters.js + js/data.js against the last committed versions and
exits non-zero when the new data is missing, unparseable, or sharply smaller.
A failed upstream scrape must fail the workflow — never silently commit
empty or truncated data over the last good build."""
import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SHRINK = 0.9  # new counts may not drop below 90% of the committed baseline


def rosters_counts(src):
    m = re.search(r'export const ROSTERS=(\{.*?\});', src, re.S)
    if not m:
        raise ValueError('ROSTERS marker missing')
    r = json.loads(m.group(1))
    players = sum(len(v) for v in r.values())
    stats = sum(1 for v in r.values() for p in v if p.get('st'))
    return len(r), players, stats


def clubs_count(src):
    m = re.search(r'export const CLUBS=(\[.*?\]);', src, re.S)
    if not m:
        raise ValueError('CLUBS marker missing')
    return len(json.loads(m.group(1)))


def head(path):
    return subprocess.run(['git', 'show', f'HEAD:{path}'], capture_output=True,
                          text=True, check=True, cwd=ROOT).stdout


fail = []
try:
    new_t, new_p, new_s = rosters_counts((ROOT / 'js' / 'rosters.js').read_text())
    old_t, old_p, old_s = rosters_counts(head('js/rosters.js'))
    print(f'rosters: teams {old_t}->{new_t}, players {old_p}->{new_p}, stat lines {old_s}->{new_s}')
    for label, old, new in (('teams', old_t, new_t), ('players', old_p, new_p),
                            ('stat lines', old_s, new_s)):
        if new < old * SHRINK:
            fail.append(f'rosters.js {label} collapsed: {old} -> {new}')
except Exception as e:
    fail.append(f'rosters.js: {e}')

try:
    new_c = clubs_count((ROOT / 'js' / 'data.js').read_text())
    old_c = clubs_count(head('js/data.js'))
    print(f'clubs: {old_c} -> {new_c}')
    if new_c < old_c * SHRINK:
        fail.append(f'data.js clubs collapsed: {old_c} -> {new_c}')
except Exception as e:
    fail.append(f'data.js: {e}')

try:
    json.loads((ROOT / 'data' / 'wire_asa.json').read_text())
except Exception as e:
    fail.append(f'wire_asa.json: {e}')

if fail:
    print('REFRESH GATE FAILED:\n  ' + '\n  '.join(fail), file=sys.stderr)
    sys.exit(1)
print('refresh gate OK')
