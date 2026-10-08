#!/usr/bin/env python3
"""Where do users struggle? Read the first-party friction table and rank it.

Usage: python3 scripts/friction.py [days]      (default 14)

Run from the MAIN checkout, not a worktree — same reason as scripts/traffic.py:
wrangler resolves the D1 binding from wrangler.toml relative to the cwd.

What the kinds mean (see migrations/0010_friction.sql):
  rage  3+ clicks in quick succession on one spot — something looked clickable
        and didn't respond the way the visitor expected
  dead  a link/button click after which nothing on the page changed for 1 s —
        a hint, not proof: a slow network call can also look dead
  err   an uncaught error from our own scripts

Rank by distinct SESSIONS, not raw events: one frustrated visitor can fire a
handful of events, and that is one problem seen once, not five.
"""
import json, shutil, subprocess, sys

DAYS = int(sys.argv[1]) if len(sys.argv) > 1 else 14
SINCE = f"date('now','-{DAYS} day')"

# Below this many sessions with any friction, patterns are noise — say so
# instead of letting a ranking look more certain than it is.
THIN_SESSIONS = 30


def q(sql):
    if not shutil.which('npx'):
        sys.exit('npx not found')
    r = subprocess.run(
        ['npx', 'wrangler', 'd1', 'execute', 'rankxi-signups', '--remote',
         '--command', sql, '--json'],
        capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f'query failed:\n{r.stderr[-800:]}')
    body = r.stdout[r.stdout.index('['):]
    return json.loads(body)[0]['results']


def table(title, rows, cols):
    print(f'\n{title}')
    print('-' * len(title))
    if not rows:
        print('  (no rows)')
        return
    w = [max(len(c), max(len(str(r.get(c, ''))) for r in rows)) for c in cols]
    print('  ' + '  '.join(c.ljust(w[i]) for i, c in enumerate(cols)))
    for r in rows:
        print('  ' + '  '.join(str(r.get(c, '')).ljust(w[i]) for i, c in enumerate(cols)))


tot = q(f"SELECT COUNT(*) events, COUNT(DISTINCT sid) sessions FROM friction WHERE d >= {SINCE}")[0]
all_sessions = q(f"SELECT COUNT(DISTINCT sid) n FROM hits WHERE d >= {SINCE}")[0]['n'] or 0
fs = tot['sessions'] or 0

print(f'\n=== Ranked XI friction — last {DAYS} days ===')
print(f"  friction events        {tot['events'] or 0}")
print(f"  sessions with friction {fs} of {all_sessions}"
      + (f" ({100 * fs / all_sessions:.1f}%)" if all_sessions else ''))
if fs < THIN_SESSIONS:
    print(f"  NOTE: fewer than {THIN_SESSIONS} sessions — treat every ranking below as anecdote, not pattern.")

table('By kind', q(
    f"SELECT kind, COUNT(*) events, COUNT(DISTINCT sid) sessions "
    f"FROM friction WHERE d >= {SINCE} GROUP BY kind ORDER BY sessions DESC"),
    ['kind', 'events', 'sessions'])

table('Top friction spots (kind · page · element)', q(
    f"SELECT kind, path, COALESCE(tgt,'-') tgt, COUNT(*) events, COUNT(DISTINCT sid) sessions, "
    f"GROUP_CONCAT(DISTINCT plat) plats "
    f"FROM friction WHERE d >= {SINCE} AND kind != 'err' "
    f"GROUP BY kind, path, tgt ORDER BY sessions DESC, events DESC LIMIT 25"),
    ['kind', 'path', 'tgt', 'sessions', 'events', 'plats'])

# The rate is what separates a broken page from a busy one.
table('Pages by share of their sessions that hit friction', q(
    f"WITH f AS (SELECT path, COUNT(DISTINCT sid) fs FROM friction WHERE d >= {SINCE} GROUP BY path), "
    f"h AS (SELECT path, COUNT(DISTINCT sid) hs FROM hits WHERE d >= {SINCE} GROUP BY path) "
    f"SELECT f.path, f.fs friction_sessions, COALESCE(h.hs,0) sessions, "
    f"CASE WHEN h.hs > 0 THEN ROUND(100.0 * f.fs / h.hs, 1) END pct "
    f"FROM f LEFT JOIN h ON h.path = f.path ORDER BY f.fs DESC LIMIT 20"),
    ['path', 'friction_sessions', 'sessions', 'pct'])

table('JavaScript errors', q(
    f"SELECT detail, COUNT(*) events, COUNT(DISTINCT sid) sessions, MIN(d) first, MAX(d) last, "
    f"GROUP_CONCAT(DISTINCT plat) plats "
    f"FROM friction WHERE d >= {SINCE} AND kind = 'err' "
    f"GROUP BY detail ORDER BY sessions DESC LIMIT 15"),
    ['detail', 'sessions', 'events', 'first', 'last', 'plats'])

print()
