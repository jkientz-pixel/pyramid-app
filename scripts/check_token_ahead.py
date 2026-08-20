#!/usr/bin/env python3
"""Fail a PR whose cache-bust token is not strictly ahead of master's.

The scheduled roster refresh deploys and bumps the token on master twice a
day, so any branch older than a few hours carries a token master has already
shipped. Merging that walks the token backwards: returning browsers keep
serving the ?v= build they already cached, and the change looks deployed
while nobody sees it. bump_version.py guards the mint; this guards the merge.

Fix when it fires:  git fetch origin master && git merge origin/master
                    && python3 scripts/bump_version.py
"""
import re, subprocess, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
TOKEN = re.compile(r'2026\d{4}[a-z]')

def token_of(text, where):
    found = set(TOKEN.findall(text))
    if len(found) != 1:
        sys.exit(f'FATAL: {where} has {len(found)} version tokens {sorted(found)}; expected exactly 1')
    return found.pop()

ours = token_of((ROOT / 'sw.js').read_text(), 'sw.js')

r = subprocess.run(['git', 'show', 'origin/master:sw.js'], cwd=ROOT,
                   capture_output=True, text=True)
if r.returncode != 0:
    # no master ref to compare against (shallow clone, fork) — don't invent a failure
    print(f'  origin/master unavailable; skipping token comparison (branch at {ours})')
    sys.exit(0)
theirs = token_of(r.stdout, 'origin/master:sw.js')

if ours <= theirs:
    sys.exit(
        f'FATAL: cache-bust token {ours} is not ahead of master ({theirs}).\n'
        f'  Merging would reissue a token master has already deployed, and returning\n'
        f'  browsers would keep the build they cached under it.\n'
        f'  Fix: git fetch origin master && git merge origin/master '
        f'&& python3 scripts/bump_version.py')

print(f'  cache-bust token {ours} is ahead of master ({theirs})')
