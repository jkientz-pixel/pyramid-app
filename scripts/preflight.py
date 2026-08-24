#!/usr/bin/env python3
"""Pre-deploy gate. Run by deploy.sh; exits non-zero on anything that would
ship a broken or stale build. Checks:
  1. js/data.js + js/rosters.js parse, and club slugs are present + unique;
  2. no shipped source file carries a literal cache-bust token, and every one
     that needs it carries the placeholder deploy.sh stamps (see cachebust.py);
  3. every data/*.json the app fetches exists and parses.
"""
import json, re, pathlib, subprocess, sys
import html as html_mod
import cachebust

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

# Source must never carry a real cache-bust token: deploy.sh stamps one into
# the staged tree instead. A literal token committed here ships frozen — /js/*
# and /css/* are served immutable for a year, so anyone who cached that URL
# never sees another build. It is also what made every PR older than a few
# hours go red, back when the token was committed and master's advanced twice
# a day under the roster refresh.
CB_FILES = ['app.html', 'index.html', 'js/app.js', 'sw.js', 'js/myxi.js',
            'js/account.js', 'privacy.html', 'methodology.html', 'shots.html',
            'radar.html', 'player-simulator.html', '404.html',
            'npsl-rankings.html', 'upsl-rankings.html']
_cb_literal = cachebust.check([ROOT / f for f in CB_FILES])
for b in _cb_literal:
    fail.append(f'literal cache-bust token in source (deploy.sh stamps it): {b}')
_cb_missing = [f for f in CB_FILES
               if cachebust.PLACEHOLDER not in (ROOT / f).read_text()]
if _cb_missing:
    fail.append(f'cache-bust placeholder missing from {_cb_missing} — those assets '
                f'would ship untokened and cache for a year')
if not _cb_literal and not _cb_missing:
    print(f'  cache-bust: {len(CB_FILES)} files carry {cachebust.PLACEHOLDER}, '
          f'no literal tokens')

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
    # gen_seo_pages.py rewrites some pages every deploy, so the token in a
    # committed copy is always stale — those are checked via the generator's
    # template instead. Pages listed in CB_FILES are NOT exempt even
    # when the generator also touches them: it bakes counts into index.html
    # and app.html, and exempting those would have skipped the two pages that
    # carry the most traffic.
    # files that carry the cache-bust placeholder in their own committed source,
    # as opposed to receiving it from a generator at build time
    _versioned = set(CB_FILES)
    generated = set(_re.findall(r"'([a-z0-9-]+\.html)'",
                                (ROOT / 'scripts' / 'gen_seo_pages.py').read_text())) - _versioned
    # INFRA is excluded from the sitemap checks above because those pages are
    # not landing pages — but they are still pages people load, so they are
    # measured here.
    measured = staged | INFRA
    untagged, untokened = [], []
    for f in sorted(measured):
        src = (ROOT / f).read_text() if (ROOT / f).exists() else ''
        if not src:
            continue
        if 'rxi-a.js' not in src:
            untagged.append(f)
        elif f not in generated and f'rxi-a.js?v={cachebust.PLACEHOLDER}' not in src:
            untokened.append(f)
    for s in ('scripts/gen_seo_pages.py', 'scripts/gen_club_pages.py'):
        body = (ROOT / s).read_text()
        if 'rxi-a.js' not in body:
            untagged.append(s)
        elif 'rxi-a.js?v={VTOKEN}' not in body:
            untokened.append(s)
    if untagged:
        fail.append('shipped pages carry no analytics ping: ' + ', '.join(untagged)
                    + ' (add <script src="/js/rxi-a.js?v=TOKEN" defer> and list the'
                    + ' page in CB_FILES above)')
    if untokened:
        fail.append('analytics ping is untokened on: ' + ', '.join(untokened)
                    + ' (/js/* is immutable for a year — returning visitors would'
                    + ' never receive a fixed rxi-a.js)')
    if not untagged and not untokened:
        print(f'  every staged page reports pageviews ({len(measured)} checked, '
              f'{len(generated)} via generator)')
except Exception as e:
    fail.append(f'deploy staging check: {e}')

# ---------------------------------------------------------------- SEO gates
# The 2026-08-23 SEO/AEO audit found four classes of defect that ship silently
# across thousands of pages at once, because nothing reads the generated HTML
# back: a title too long for a SERP line, an empty description, a JSON-LD URL
# that 404s (GA Aspire's memberOf pointed at /league/gaa, which has never
# existed), and the brand spelled four different ways. All four are cheap to
# check here and impossible to notice by eye on 4,400 files.
#
# CI runs preflight on a clean checkout where club/ league/ state/ are absent
# (they are gitignored build output), so the scan reports and skips rather
# than failing when there is nothing generated to read.
try:
    import seo_common as _S

    gen_dirs_present = [d for d in ('club', 'league', 'state') if (ROOT / d).is_dir()]
    top_pages = [f for f in ('index.html', 'app.html', 'methodology.html', 'privacy.html',
                             'about.html', 'faq.html', 'terms.html', 'us-soccer-pyramid.html',
                             'upsl-rankings.html', 'npsl-rankings.html', 'shots.html',
                             'radar.html', 'player-simulator.html') if (ROOT / f).exists()]

    def _pages():
        for f in top_pages:
            yield ROOT / f
        for d in gen_dirs_present:
            yield from sorted((ROOT / d).glob('*.html'))

    # every local page path this build actually produced, for resolving the
    # URLs that appear inside JSON-LD
    produced = {'/', '/app'}
    produced |= {'/' + f[:-5] for f in top_pages if f not in ('index.html', 'app.html')}
    for d in gen_dirs_present:
        produced |= {f'/{d}/{x.stem}' for x in (ROOT / d).glob('*.html')}

    long_titles, no_desc, no_canon, no_og, bad_ld, brand = [], [], [], [], [], []
    _TITLE = re.compile(r'<title>(.*?)</title>', re.S)
    _DESC = re.compile(r'<meta name="description" content="(.*?)">', re.S)
    _LD = re.compile(r'<script type="application/ld\+json">(.*?)</script>', re.S)
    _URL = re.compile(r'"url":\s*"https://www\.rankedxi\.com([^"]*)"')
    checked = 0
    for path in _pages():
        body = path.read_text()
        checked += 1
        rel = path.relative_to(ROOT).as_posix()
        m = _TITLE.search(body)
        title = html_mod.unescape(m.group(1)) if m else ''
        if not title:
            long_titles.append(f'{rel}: no <title>')
        elif len(title) > _S.TITLE_MAX:
            long_titles.append(f'{rel}: {len(title)} chars')
        d = _DESC.search(body)
        if not d or not d.group(1).strip():
            no_desc.append(rel)
        if '<link rel="canonical"' not in body:
            no_canon.append(rel)
        if 'property="og:url"' not in body:
            no_og.append(rel)
        # "Rank XI" was the Dataset creator name while every visible surface
        # said "Ranked XI". An entity that answers to two names gets no
        # Knowledge Graph entry and no citation (audit section 5).
        if re.search(r'\bRank XI\b', body):
            brand.append(rel)
        # a URL inside JSON-LD that this build did not produce is a 404 handed
        # to every crawler that reads the page
        for blob in _LD.findall(body):
            for u in _URL.findall(blob):
                probe = u.split('#')[0].split('?')[0]
                if not probe:
                    continue
                if probe != '/':
                    probe = probe.rstrip('/')
                if '.' in probe.rsplit('/', 1)[-1]:
                    # an asset (logo, crest, share card), not a page: the test
                    # is whether the file ships, not whether it is a route
                    if not (ROOT / probe.lstrip('/')).exists():
                        bad_ld.append(f'{rel} -> {probe} (file missing)')
                elif probe not in produced:
                    bad_ld.append(f'{rel} -> {probe}')

    def _cap(items, n=6):
        return ', '.join(items[:n]) + (f' (+{len(items) - n} more)' if len(items) > n else '')

    if long_titles:
        fail.append(f'titles over {_S.TITLE_MAX} chars (Google truncates): {_cap(long_titles)}')
    if no_desc:
        fail.append(f'pages with an empty meta description: {_cap(no_desc)}')
    if no_canon:
        fail.append(f'pages with no canonical: {_cap(no_canon)}')
    if no_og:
        fail.append(f'pages missing og:url (share unfurls the wrong document): {_cap(no_og)}')
    if brand:
        fail.append(f'"Rank XI" (the old, wrong entity name) appears in: {_cap(brand)}')
    if bad_ld:
        fail.append(f'JSON-LD points at URLs this build did not produce: {_cap(sorted(set(bad_ld)))}')
    if checked and not (long_titles or no_desc or no_canon or no_og or brand or bad_ld):
        print(f'  SEO: {checked} pages — titles fit, descriptions set, canonical + og:url '
              f'present, one brand name, no 404s in JSON-LD')
    if not gen_dirs_present:
        print('  SEO: club/league/state not generated in this checkout — leaf pages not scanned')

    # Favicon drift. The favicon set is hand-written into every static page
    # rather than injected, so a page added or edited without copying the
    # current block silently keeps an older one. That is not cosmetic: when the
    # only icon links carry a `sizes` attribute and none is tab-sized, Chrome
    # ignores all of them and requests /favicon.ico, so a drifted page shows the
    # generic globe. It shipped that way on 6 pages — the 2026-08-23 fix updated
    # index/app and missed methodology, privacy, shots, radar, player-simulator
    # and 404 (which still served a soccer-ball emoji). 404.html is checked here
    # even though the SEO scan above skips it: a 404 is a real rendered tab.
    icon_drift = [f for f in top_pages + ['404.html']
                  if (ROOT / f).exists() and _S.ICONS not in (ROOT / f).read_text()]
    if icon_drift:
        fail.append('pages whose favicon block has drifted from seo_common.ICONS '
                    f'(Chrome falls back to /favicon.ico and shows a generic tab): {_cap(icon_drift)}')
    else:
        print(f'  favicon: seo_common.ICONS intact on {len(top_pages) + 1} static pages')

    # Stray markup from a half-removed tag. The 2026-08-23 favicon swap replaced
    # a two-line emoji data-URI link but its regex only matched the opening line,
    # so the closing half — `<text ...>SOCCER</text></svg>">` — was stranded in the
    # head of 7 pages. The check above was satisfied (the correct ICONS block was
    # there too) while the orphan rendered as a soccer ball and a literal `">` in
    # the top-left corner of the live homepage. An unbalanced `</svg>` is the
    # generic signature of that mistake, so assert the tags pair up.
    svg_orphans = []
    for f in top_pages + ['404.html']:
        if not (ROOT / f).exists():
            continue
        html = (ROOT / f).read_text()
        if html.count('</svg>') > html.count('<svg'):
            svg_orphans.append(f)
    if svg_orphans:
        fail.append('pages with an unbalanced </svg> — a stray tag fragment is '
                    f'rendering as visible text: {_cap(svg_orphans)}')
    else:
        print(f'  markup: no orphaned </svg> fragments on {len(top_pages) + 1} static pages')

    # the sitemap is an index now: every child it names must exist and be
    # staged, or a crawler follows the index into a 404
    smap_txt = (ROOT / 'sitemap.xml').read_text()
    kids = re.findall(r'<loc>https://www\.rankedxi\.com/(sitemap-[a-z0-9-]+\.xml)</loc>', smap_txt)
    if '<sitemapindex' in smap_txt:
        missing_kids = [k for k in kids if not (ROOT / k).exists()]
        if missing_kids:
            fail.append(f'sitemap index names children that do not exist: {missing_kids}')
        dep_txt = (ROOT / 'deploy.sh').read_text()
        if 'sitemap-*.xml' not in dep_txt and any(k not in dep_txt for k in kids):
            fail.append('deploy.sh does not stage the sitemap index children — '
                        'the index would point at 404s in production')
        if not missing_kids:
            locs = sum(len(re.findall(r'<loc>', (ROOT / k).read_text())) for k in kids)
            print(f'  sitemap index OK — {len(kids)} children, {locs} urls, all present + staged')
    else:
        fail.append('sitemap.xml is not a sitemap index (gen_club_pages.py should emit one)')
except Exception as e:
    fail.append(f'SEO gate: {e}')

if fail:
    print('\nPREFLIGHT FAILED:', file=sys.stderr)
    for f in fail: print('  ✗', f, file=sys.stderr)
    sys.exit(1)
print('preflight passed')
