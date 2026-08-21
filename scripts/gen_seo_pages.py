#!/usr/bin/env python3
"""Generate static SEO landing pages (upsl-rankings.html, npsl-rankings.html)
from js/data.js — the exact queries that autocomplete today — and bake the
landing page's headline counts into index.html. Re-run each deploy."""
import json, re, os, html, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(ROOT, 'js', 'data.js')).read()
clubs = json.loads(re.search(r'export const CLUBS=(\[.*?\]);', src, re.S).group(1))
leagues = json.loads(re.search(r'export const LEAGUES=(\{.*?\});', src, re.S).group(1))

# /js/* is served immutable for a year, so an untokened script URL here would
# pin every returning visitor to the copy of rxi-a.js they first cached — on
# the club/league/state pages, which are most of the site. Read the token
# deploy.sh just stamped into app.html rather than restating it.
def _asset_token():
    m = re.search(r'2026\d{4}[a-z]', open(os.path.join(ROOT, 'app.html')).read())
    if not m:
        raise SystemExit('FATAL: no cache-bust token in app.html')
    return m.group(0)


VTOKEN = _asset_token()

FONT_FACE = ('@font-face{font-family:"Barlow Condensed";font-style:normal;font-weight:700;'
             'font-display:swap;src:url(/fonts/barlow-condensed-latin-700.woff2) format("woff2")}')
DISP_STACK = '"Barlow Condensed","Avenir Next Condensed","Arial Narrow",sans-serif'

PAGES = [
    ('upsl', 'upsl-rankings.html', 'UPSL Rankings & Standings 2026 — all 660+ clubs, one national table',
     'National UPSL rankings 2026: every United Premier Soccer League club rated on one cross-league table, updated from real division standings. See where any UPSL side ranks nationally — against NPSL, USL League Two and the whole US pyramid.'),
    ('npsl', 'npsl-rankings.html', 'NPSL Rankings 2026 — every club rated from real results',
     'NPSL national rankings 2026: all National Premier Soccer League clubs rated by match-by-match Elo from real league results, on one table with the whole US soccer pyramid — compare NPSL vs UPSL directly.'),
]

for g, fname, title, desc in PAGES:
    pool = sorted([c for c in clubs if c['g'] == g and c.get('r')], key=lambda c: (0 if c.get('rr') else 1, -c['r']))
    rows = ''.join(
        f"<tr><td>{i + 1 if c.get('rr') else '—'}</td><td>{html.escape(c['n'])}</td><td>{html.escape(c.get('st',''))}</td><td>{c['r']}</td></tr>"
        for i, c in enumerate(pool[:100]))
    src_note = ('Ratings from real division standings (points + goal difference), updated as tables move.'
                if g == 'upsl' else
                'Ratings from a match-by-match Elo walk over every scored 2026 NPSL result — backtested and calibrated (Brier 0.531 vs 0.667 uniform baseline).')
    today = datetime.date.today().isoformat()
    # canonical/URLs are extensionless: Cloudflare Pages 308s the .html form to
    # the extensionless one, so pointing canonicals at .html split every signal
    # through a redirect (external audit #5)
    stem = fname[:-len('.html')]
    page = f"""<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚽</text></svg>">
<title>{html.escape(title)}</title>
<meta name="description" content="{html.escape(desc)}">
<link rel="canonical" href="https://www.rankedxi.com/{stem}">
<meta property="og:title" content="{html.escape(title)}"><meta property="og:image" content="https://www.rankedxi.com/og.png">
<script type="application/ld+json">{{"@context":"https://schema.org","@type":"Dataset","name":"{html.escape(title)}","dateModified":"{today}","url":"https://www.rankedxi.com/{stem}","creator":{{"@type":"Organization","name":"Rank XI"}}}}</script>
<style>{FONT_FACE}
body{{margin:0;background:#0C1512;color:#E8EFEA;font:16px/1.55 -apple-system,"Segoe UI",Roboto,sans-serif;padding:24px clamp(16px,4vw,48px)}}
h1{{font-family:{DISP_STACK};text-transform:uppercase;font-size:clamp(1.6rem,4vw,2.6rem);margin:.3em 0}}
a{{color:#7FD1A8}}table{{border-collapse:collapse;width:100%;max-width:720px;margin:18px 0}}
td,th{{padding:7px 10px;border-bottom:1px solid #24352C;text-align:left;font-size:.92rem}}
th{{color:#8FA598;text-transform:uppercase;font-size:.72rem;letter-spacing:.06em}}
.cta{{display:inline-block;background:#C77F1E;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:700;margin:10px 0}}
p.note{{color:#8FA598;font-size:.85rem;max-width:60em}}</style>
<script src="/js/rxi-a.js?v={VTOKEN}" defer></script>
</head><body>
<p><a href="/">Rank XI</a> · updated {today}</p>
<h1>{html.escape(title.split('—')[0].strip())}</h1>
<p>{html.escape(desc)}</p>
<a class="cta" href="/app#/table">Open the full interactive table →</a>
<table><thead><tr><th>#</th><th>Club</th><th>State</th><th>Rating</th></tr></thead><tbody>{rows}</tbody></table>
<p class="note">{src_note} Top 100 shown — the app has every club, the map, head-to-head predictions and player stats. Not affiliated with the league; data from public sources with attribution in the app.</p>
<a class="cta" href="/app#/map">Explore the national map →</a>
</body></html>"""
    open(os.path.join(ROOT, fname), 'w').write(page)
    print(f'{fname}: {len(pool)} clubs, top 100 rendered')

# ---- bake headline counts into index.html (external audit #6) ----
# The landing page used to import data.js + rosters.js at runtime — 240KB over
# the wire and ~1.25MB parsed — to print three numbers. Baking them here keeps
# the landing payload near zero and gives every surface the same figures.
rosters = json.loads(re.search(r'export const ROSTERS=(\{.*?\});',
                               open(os.path.join(ROOT, 'js', 'rosters.js')).read(), re.S).group(1))
counts = {
    'clubs': sum(1 for c in clubs if not c.get('h')),
    'statlines': sum(1 for arr in rosters.values() for p in arr if p.get('st')),
    'leagues': len(leagues),
}
for fname in ('index.html', 'app.html'):
    path = os.path.join(ROOT, fname)
    page = open(path).read()
    for key, value in counts.items():
        page = re.sub(f'(data-stat="{key}">)[^<]*',
                      lambda m, v=value: m.group(1) + format(v, ','), page)
    # og:description is what crawlers and every social unfurl read; app.html
    # carried a hand-written "3,900+" there and in the pre-hydration
    # placeholder long after the database passed 4,285, so the three surfaces
    # disagreed with each other. Both are derived here now.
    page = re.sub(r'([\d,]+)\+? clubs from MLS to the grassroots',
                  f"{counts['clubs']:,} clubs from MLS to the grassroots", page)
    open(path, 'w').write(page)
print(f"index.html + app.html counts baked: {counts['clubs']:,} clubs · "
      f"{counts['statlines']:,} stat lines · {counts['leagues']} leagues")
