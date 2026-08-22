#!/usr/bin/env python3
"""Read the first-party pageview table and print the numbers decisions ride on.

Usage: python3 scripts/traffic.py [days]      (default 14)

Run from the MAIN checkout, not a worktree — wrangler resolves its D1 binding
from wrangler.toml relative to the working directory and a worktree copy has
bitten us before.
"""
import json, subprocess, sys, shutil

DAYS = int(sys.argv[1]) if len(sys.argv) > 1 else 14
SINCE = f"date('now','-{DAYS} day')"


def q(sql):
    if not shutil.which('npx'):
        sys.exit('npx not found')
    r = subprocess.run(
        ['npx', 'wrangler', 'd1', 'execute', 'rankxi-signups', '--remote',
         '--command', sql, '--json'],
        capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f'query failed:\n{r.stderr[-800:]}')
    # wrangler prefixes the JSON with human banner lines on some versions
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


tot = q(f"SELECT COUNT(*) hits, COUNT(DISTINCT vid) visitors, COUNT(DISTINCT sid) sessions, "
        f"SUM(fresh) new_visitors FROM hits WHERE d >= {SINCE}")[0]
print(f'\n=== Ranked XI traffic — last {DAYS} days ===')
print(f"  pageviews      {tot['hits'] or 0}")
print(f"  visitors       {tot['visitors'] or 0}")
print(f"  sessions       {tot['sessions'] or 0}")
print(f"  new visitors   {tot['new_visitors'] or 0}")

table('By day', q(
    f"SELECT d, COUNT(*) hits, COUNT(DISTINCT vid) visitors, SUM(fresh) new "
    f"FROM hits WHERE d >= {SINCE} GROUP BY d ORDER BY d DESC"),
    ['d', 'hits', 'visitors', 'new'])

# The iOS build decision rides on this one.
table('Platform', q(
    f"SELECT plat, COUNT(DISTINCT vid) visitors, COUNT(*) hits "
    f"FROM hits WHERE d >= {SINCE} GROUP BY plat ORDER BY visitors DESC"),
    ['plat', 'visitors', 'hits'])

table('Top pages', q(
    f"SELECT path, COUNT(*) hits, COUNT(DISTINCT vid) visitors "
    f"FROM hits WHERE d >= {SINCE} GROUP BY path ORDER BY hits DESC LIMIT 25"),
    ['path', 'hits', 'visitors'])

table('Referrers', q(
    f"SELECT COALESCE(ref,'(direct)') ref, COUNT(*) hits, COUNT(DISTINCT vid) visitors "
    f"FROM hits WHERE d >= {SINCE} GROUP BY ref ORDER BY hits DESC LIMIT 20"),
    ['ref', 'hits', 'visitors'])

# Channels. Referrers alone under-report social badly: platforms strip the
# header, and a tap inside the Facebook or Reddit app arrives as "(direct)".
# The campaign tag is carried only on a visit's landing pageview, so the whole
# session is attributed by joining back to it on sid -- otherwise every page
# someone reads after arriving would count as untagged.
table('Channels (tagged links)', q(
    f"SELECT COALESCE(s.src,'(untagged)') src, "
    f"       COUNT(DISTINCT h.sid) sessions, "
    f"       COUNT(DISTINCT h.vid) visitors, "
    f"       COUNT(*) hits "
    f"FROM hits h "
    f"LEFT JOIN (SELECT sid, MIN(src) src FROM hits "
    f"           WHERE src IS NOT NULL GROUP BY sid) s ON s.sid = h.sid "
    f"WHERE h.d >= {SINCE} GROUP BY 1 ORDER BY sessions DESC, hits DESC LIMIT 20"),
    ['src', 'sessions', 'visitors', 'hits'])

table('Countries', q(
    f"SELECT COALESCE(ctry,'??') ctry, COUNT(DISTINCT vid) visitors "
    f"FROM hits WHERE d >= {SINCE} GROUP BY ctry ORDER BY visitors DESC LIMIT 10"),
    ['ctry', 'visitors'])

# Retention: the whole "is this a look-once product" question in one number.
ret = q(f"SELECT COUNT(*) returning FROM (SELECT vid FROM hits WHERE d >= {SINCE} "
        f"GROUP BY vid HAVING COUNT(DISTINCT d) > 1)")[0]['returning'] or 0
vis = tot['visitors'] or 0
pct = f'{100*ret/vis:.1f}%' if vis else 'n/a'
print(f'\nReturn visitors (seen on 2+ distinct days): {ret} of {vis}  ({pct})')
print()
