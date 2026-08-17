#!/usr/bin/env python3
"""Bump the cache-bust token in ONE place across every file that carries it:
app.html, index.html, js/app.js (?v=) and sw.js (VERSION). Drift between these
serves users stale code, so this replaces hand-editing four files.
Usage: python3 scripts/bump_version.py [YYYYMMDDx]   (default: today + next letter)
"""
import re, subprocess, sys, pathlib, datetime, string

ROOT = pathlib.Path(__file__).resolve().parent.parent
FILES = [ROOT / 'app.html', ROOT / 'index.html', ROOT / 'js' / 'app.js', ROOT / 'sw.js']
TOKEN = re.compile(r'2026\d{4}[a-z]')

cur = set()
for f in FILES:
    cur |= set(TOKEN.findall(f.read_text()))
if len(cur) != 1:
    sys.exit(f'FATAL: files already disagree on version {sorted(cur)} — fix by hand first')
old = cur.pop()

if len(sys.argv) > 1:
    new = sys.argv[1]
else:
    today = datetime.date.today().strftime('%Y%m%d')
    # never mint a token <= the current one: scheduled jobs run on UTC dates,
    # so a local-date bump after a UTC rollover restarts at 'a' and reissues an
    # already-used token (v20260809a shipped twice on 2026-08-09; returning
    # clients kept stale cached assets). If the file token's date is ahead of
    # today, keep that date and advance its letter instead.
    base = max(today, old[:8])
    new = base + ('a' if old[:8] != base
                  else string.ascii_lowercase[string.ascii_lowercase.index(old[8]) + 1])

# a stale checkout can re-mint a token master already shipped (v20260809a
# shipped twice; near-miss again 2026-08-17 when a worktree bumped to a token
# two auto-deploys had used). Best-effort: read origin/master's sw.js and mint
# strictly above whatever it carries. Offline or missing ref -> skip silently.
try:
    r = subprocess.run(['git', 'show', 'origin/master:sw.js'], cwd=ROOT,
                       capture_output=True, text=True, timeout=10)
    remote = max(TOKEN.findall(r.stdout), default=None) if r.returncode == 0 else None
except Exception:
    remote = None
if remote and new <= remote:
    base = remote[:8]
    new = base + string.ascii_lowercase[string.ascii_lowercase.index(remote[8]) + 1]
    print(f'  (origin/master already at {remote}; minting {new} instead)')

for f in FILES:
    t = f.read_text()
    f.write_text(t.replace(old, new))
    print(f'  {f.relative_to(ROOT)}: {t.count(old)} occurrence(s)')
print(f'version {old} -> {new}')
