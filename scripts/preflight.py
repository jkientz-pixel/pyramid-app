#!/usr/bin/env python3
"""Pre-deploy gate. Run by deploy.sh; exits non-zero on anything that would
ship a broken or stale build. Checks:
  1. js/data.js + js/rosters.js parse, and club slugs are present + unique;
  2. the cache-bust token is identical across app.html, index.html, js/app.js
     and sw.js VERSION (drift = users served stale code);
  3. every data/*.json the app fetches exists and parses.
"""
import json, re, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
fail = []

src = (ROOT / 'js' / 'data.js').read_text()
m = re.search(r'export const CLUBS=(\[.*?\]);', src, re.S)
if not m:
    fail.append('data.js: CLUBS marker missing')
else:
    try:
        clubs = json.loads(m.group(1))
        ids = [c.get('id') for c in clubs]
        if any(not i for i in ids):
            fail.append(f'data.js: {sum(1 for i in ids if not i)} clubs missing an id slug')
        if len(set(ids)) != len(ids):
            fail.append('data.js: duplicate club slugs')
        broken = [c['id'] for c in clubs
                  if c.get('img') and not (ROOT / c['img']).exists()]
        if broken:
            fail.append(f'data.js: {len(broken)} img paths point at missing crest files: {broken[:10]}')
        print(f'  data.js OK — {len(clubs)} clubs, slugs unique, crest paths resolve')
    except Exception as e:
        fail.append(f'data.js: CLUBS does not parse ({e})')

r = (ROOT / 'js' / 'rosters.js').read_text()
for marker in ('ROSTERS', 'HONOURS'):
    mm = re.search(r'export const %s=(\{.*?\});' % marker, r, re.S)
    if not mm:
        fail.append(f'rosters.js: {marker} marker missing'); continue
    try:
        json.loads(mm.group(1))
    except Exception as e:
        fail.append(f'rosters.js: {marker} does not parse ({e})')
print('  rosters.js OK')

vers = set()
for f in ('app.html', 'index.html'):
    vers |= set(re.findall(r'v=(2026[0-9a-z]+)', (ROOT / f).read_text()))
vers |= set(re.findall(r'v=(2026[0-9a-z]+)', (ROOT / 'js' / 'app.js').read_text()))
vers |= set(re.findall(r"VERSION = 'rankxi-v(2026[0-9a-z]+)'", (ROOT / 'sw.js').read_text()))
if len(vers) != 1:
    fail.append(f'cache-bust drift across app.html/index.html/app.js/sw.js: {sorted(vers)}')
else:
    print(f'  cache version consistent: {vers.pop()}')

# This list is also what deploy.sh stages, so a path that matches the pattern
# but does not exist kills the deploy at the cp. The pattern is blind to
# comments: writing fetch + ('data/ + ... in prose here puts a fake path in the
# staging list, which is how it happened once.
_data_ok = True
for jf in re.findall(r"fetch\('(data/[^?']+)", (ROOT / 'js' / 'app.js').read_text()):
    p = ROOT / jf
    if not p.exists():
        fail.append(f'{jf}: fetched by app.js but missing (deploy.sh stages this list — '
                    f'if it came from a comment, reword the comment)')
        _data_ok = False
        continue
    try:
        json.loads(p.read_text())
    except Exception as e:
        fail.append(f'{jf}: invalid JSON ({e})')
        _data_ok = False
if _data_ok:
    print('  fetched data/*.json OK')

# 4. cups.json structural sanity — the Wikipedia parser once shipped an MVP
#    (a person) as an MLS Cup champion and future host cities as winners;
#    these rules mirror fetch_cups.py's own filters so a bad refresh dies
#    here instead of on the Trophy Room.
try:
    import datetime
    this_year = datetime.date.today().year
    cups = json.loads((ROOT / 'data' / 'cups.json').read_text())
    if len(cups) < 4:
        fail.append(f'cups.json: only {len(cups)} tournaments — refresh lost data')
    for k, cup in cups.items():
        if cup.get('kind') not in ('open', 'pro', 'am', 'college'):
            fail.append(f'cups.json[{k}]: unknown kind {cup.get("kind")!r}')
        finals = cup.get('finals') or []
        if not finals:
            fail.append(f'cups.json[{k}]: no finals'); continue
        years = [f.get('y') for f in finals]
        if len(set(years)) != len(years):
            fail.append(f'cups.json[{k}]: duplicate years')
        for f in finals:
            y = int(f.get('y', 0))
            if not 1900 <= y <= this_year:
                fail.append(f'cups.json[{k}]: year {y} out of range (future host row?)'); break
            if y == this_year and not f.get('s'):
                fail.append(f'cups.json[{k}]: {y} champion without a score — final not played yet?'); break
            if not f.get('w') or len(f['w']) < 3:
                fail.append(f'cups.json[{k}]: empty winner in {y}'); break
    print(f'  cups.json OK — {len(cups)} tournaments, '
          f'{sum(len(c["finals"]) for c in cups.values())} editions')
except Exception as e:
    fail.append(f'cups.json: {e}')

# 5. national_teams.json structural sanity — fixtures are hand-curated from
#    U.S. Soccer / Concacaf announcements; a match must never carry a score
#    before it's played (or claim ENDED without one), and broadcast links
#    must be https.
try:
    import datetime
    nt = json.loads((ROOT / 'data' / 'national_teams.json').read_text())
    teams = nt.get('teams') or []
    if not teams:
        fail.append('national_teams.json: no teams')
    for t in teams:
        tid = t.get('id', '?')
        for req in ('id', 'label', 'name', 'comp'):
            if not t.get(req):
                fail.append(f'national_teams.json[{tid}]: missing {req}')
        # camp-cycle teams may have no published fixtures, but never a bare card
        if not (t.get('matches') or t.get('note') or t.get('next')):
            fail.append(f'national_teams.json[{tid}]: no matches and no note — empty team card')
        if t.get('g') not in (None, 'men', 'women'):
            fail.append(f'national_teams.json[{tid}]: unknown g {t.get("g")!r}')
        for m in t.get('matches') or []:
            tag = f'national_teams.json[{tid}] v {m.get("opp", "?")}'
            try:
                datetime.datetime.fromisoformat(str(m.get('start', '')).replace('Z', '+00:00'))
            except Exception:
                fail.append(f'{tag}: bad start {m.get("start")!r}'); continue
            if m.get('status') not in ('ENDED', 'SCHEDULED'):
                fail.append(f'{tag}: unknown status {m.get("status")!r}')
            if m.get('status') == 'ENDED' and (m.get('us') is None or m.get('them') is None):
                fail.append(f'{tag}: ENDED without a score')
            if m.get('status') == 'SCHEDULED' and (m.get('us') is not None or m.get('them') is not None):
                fail.append(f'{tag}: SCHEDULED with a score — mark it ENDED')
            for tv in m.get('tv') or []:
                if not str(tv.get('url', '')).startswith('https://'):
                    fail.append(f'{tag}: tv url must be https')
                if not tv.get('label'):
                    fail.append(f'{tag}: tv entry without a label')
    print(f'  national_teams.json OK — {len(teams)} teams, '
          f'{sum(len(t.get("matches") or []) for t in teams)} matches')
except Exception as e:
    fail.append(f'national_teams.json: {e}')

# Under-18 birth years must never reach a commit: this repo is public, so
# committed is published, and the policy is name-yes / birth-year-blanked with
# personal opt-in. usl2_rosters.json was redacted when the policy was set and
# usl2_lineups.json was not, which published 1,150 rows for 376 minors through
# GitHub for months. A scrape refresh would have done it again, so the check
# lives here rather than in anyone's memory.
try:
    import subprocess
    r = subprocess.run([sys.executable, str(ROOT / 'scripts' / 'redact_minors.py'), '--check'],
                       capture_output=True, text=True)
    if r.returncode:
        fail.append((r.stderr.strip().splitlines() or ['minors redaction check failed'])[-1])
    else:
        print('  no under-18 birth years in committed player data')
except Exception as e:
    fail.append(f'minors redaction check: {e}')

# Two hardcoded lists decide whether a new page actually reaches users, and
# neither errors when you forget it:
#   1. deploy.sh's cp list  — miss it and the page 404s in production
#   2. gen_club_pages.py's  — miss it and the page is dropped from the sitemap
#      static urls            on the NEXT deploy, because that script rewrites
#                             sitemap.xml wholesale (editing sitemap.xml by
#                             hand is useless; it is a generated file)
# radar.html hit BOTH on the way out, and shots/player-simulator hit #2 before
# it. Checking the live sitemap can't catch #2 — the check has to read the
# generator's list.
try:
    import re as _re
    dep = (ROOT / 'deploy.sh').read_text()
    gen = (ROOT / 'scripts' / 'gen_club_pages.py').read_text()
    # pages deploy.sh ships, minus the ones that are infrastructure rather than
    # a search surface (404 has no canonical URL; index/app are already listed)
    INFRA = {'404.html', 'index.html', 'app.html'}
    staged = set(_re.findall(r'\b([a-z0-9-]+\.html)\b', dep.split('cp -R', 1)[-1].split('\n\n', 1)[0])) - INFRA
    missing_sitemap = sorted(f for f in staged
                             if not _re.search(r"SITE\}/" + _re.escape(f[:-5]) + r"'", gen))
    if missing_sitemap:
        fail.append('gen_club_pages.py sitemap list is missing: '
                    + ', '.join(missing_sitemap)
                    + ' (deployed, but the next deploy drops it from sitemap.xml)')
    # and the reverse. The generator's list is the source of truth for what we
    # INTEND to publish — sitemap.xml on disk only reflects the last deploy, so
    # a page added to the generator but not to deploy.sh is invisible to a
    # sitemap.xml-based check until after it has already shipped broken.
    intended = {n + '.html' for n in _re.findall(r"SITE\}/([a-z0-9-]+)'", gen)}
    smap = (ROOT / 'sitemap.xml').read_text()
    intended |= {loc + '.html' for loc in
                 _re.findall(r'<loc>https://www\.rankedxi\.com/([a-z0-9-]+)</loc>', smap)}
    unstaged = sorted(f for f in intended
                      if (ROOT / f).exists() and not _re.search(r'\b' + _re.escape(f) + r'\b', dep))
    if unstaged:
        fail.append('deploy.sh does not stage: ' + ', '.join(unstaged)
                    + ' (meant to be published, but would 404 in production)')
    # The .html checks above only see top-level files. gen_club_pages.py also
    # emits whole directories (club/, league/, state/) — miss one in deploy.sh's
    # cp list and thousands of sitemapped URLs 404 in production with nothing
    # failing. Every directory the generator freshens must be staged.
    gen_dirs = sorted(set(_re.findall(r"fresh\('([a-z0-9-]+)'\)", gen)))
    cp_block = dep.split('cp -R', 1)[-1].split('\n\n', 1)[0]
    unstaged_dirs = [d for d in gen_dirs if not _re.search(r'(?<![\w/-])' + d + r'(?![\w/-])', cp_block)]
    if unstaged_dirs:
        fail.append('deploy.sh does not stage generated directories: '
                    + ', '.join(unstaged_dirs)
                    + ' (sitemapped, but every URL under them would 404)')
    elif gen_dirs:
        print(f'  generated dirs staged: {", ".join(gen_dirs)}')
    if not missing_sitemap and not unstaged:
        print(f'  every landing page is both staged and sitemapped ({len(staged)} checked)')
    # Five shipped pages went live with no pageview ping at all, so /coach and
    # /methodology were invisible in our own numbers. A page is only measured if
    # it carries the tag, and the tag is only updatable if it carries the token
    # (/js/* is served immutable for a year).
    untagged, untokened = [], []
    for f in sorted(staged):
        src = (ROOT / f).read_text() if (ROOT / f).exists() else ''
        if not src:
            continue
        if 'rxi-a.js' not in src:
            untagged.append(f)
        elif not _re.search(r'rxi-a\.js\?v=2026\d{4}[a-z]', src):
            untokened.append(f)
    if untagged:
        fail.append('shipped pages carry no analytics ping: ' + ', '.join(untagged)
                    + ' (add <script src="/js/rxi-a.js?v=TOKEN" defer> and list the'
                    + ' page in scripts/bump_version.py FILES)')
    if untokened:
        fail.append('analytics ping is untokened on: ' + ', '.join(untokened)
                    + ' (/js/* is immutable for a year — returning visitors would'
                    + ' never receive a fixed rxi-a.js)')
    if not untagged and not untokened:
        print(f'  every staged page reports pageviews ({len(staged)} checked)')
except Exception as e:
    fail.append(f'deploy staging check: {e}')

if fail:
    print('\nPREFLIGHT FAILED:', file=sys.stderr)
    for f in fail: print('  ✗', f, file=sys.stderr)
    sys.exit(1)
print('preflight passed')
