#!/usr/bin/env python3
"""Generate static SEO landing pages (upsl-rankings.html, npsl-rankings.html)
from js/data.js — the exact queries that autocomplete today. Re-run each deploy."""
import json, re, os, html, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
clubs = json.loads(re.search(r'export const CLUBS=(\[.*?\]);', open(os.path.join(ROOT,'js','data.js')).read(), re.S).group(1))

PAGES = [
    ('upsl', 'upsl-rankings.html', 'UPSL Rankings & Standings 2026 — all 660+ clubs, one national table',
     'National UPSL rankings 2026: every United Premier Soccer League club rated on one cross-league table, updated from real division standings. See where any UPSL side ranks nationally — against NPSL, USL League Two and the whole US pyramid.'),
    ('npsl', 'npsl-rankings.html', 'NPSL Rankings 2026 — every club rated from real results',
     'NPSL national rankings 2026: all National Premier Soccer League clubs rated by match-by-match Elo from real league results, on one table with the whole US soccer pyramid — compare NPSL vs UPSL directly.'),
]

for g, fname, title, desc in PAGES:
    pool = sorted([c for c in clubs if c['g'] == g and c.get('r')], key=lambda c: -c['r'])
    rows = ''.join(
        f"<tr><td>{i+1}</td><td>{html.escape(c['n'])}</td><td>{html.escape(c.get('st',''))}</td><td>{c['r']}</td></tr>"
        for i, c in enumerate(pool[:100]))
    src_note = ('Ratings from real division standings (points + goal difference), updated as tables move.'
                if g == 'upsl' else
                'Ratings from a match-by-match Elo walk over every scored 2026 NPSL result — backtested and calibrated (Brier 0.531 vs 0.667 uniform baseline).')
    today = datetime.date.today().isoformat()
    page = f"""<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}</title>
<meta name="description" content="{html.escape(desc)}">
<link rel="canonical" href="https://www.rankedxi.com/{fname}">
<meta property="og:title" content="{html.escape(title)}"><meta property="og:image" content="https://www.rankedxi.com/og.png">
<script type="application/ld+json">{{"@context":"https://schema.org","@type":"Dataset","name":"{html.escape(title)}","dateModified":"{today}","url":"https://www.rankedxi.com/{fname}","creator":{{"@type":"Organization","name":"Rank XI"}}}}</script>
<style>body{{margin:0;background:#0C1512;color:#E8EFEA;font:16px/1.55 -apple-system,"Segoe UI",Roboto,sans-serif;padding:24px clamp(16px,4vw,48px)}}
h1{{font-family:"Avenir Next Condensed","Arial Narrow",sans-serif;text-transform:uppercase;font-size:clamp(1.6rem,4vw,2.6rem);margin:.3em 0}}
a{{color:#7FD1A8}}table{{border-collapse:collapse;width:100%;max-width:720px;margin:18px 0}}
td,th{{padding:7px 10px;border-bottom:1px solid #24352C;text-align:left;font-size:.92rem}}
th{{color:#8FA598;text-transform:uppercase;font-size:.72rem;letter-spacing:.06em}}
.cta{{display:inline-block;background:#C77F1E;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:700;margin:10px 0}}
p.note{{color:#8FA598;font-size:.85rem;max-width:60em}}</style></head><body>
<p><a href="/">Rank XI</a> · updated {today}</p>
<h1>{html.escape(title.split('—')[0].strip())}</h1>
<p>{html.escape(desc)}</p>
<a class="cta" href="/app.html#/table">Open the full interactive table →</a>
<table><thead><tr><th>#</th><th>Club</th><th>State</th><th>Rating</th></tr></thead><tbody>{rows}</tbody></table>
<p class="note">{src_note} Top 100 shown — the app has every club, the map, head-to-head predictions and player stats. Not affiliated with the league; data from public sources with attribution in the app.</p>
<a class="cta" href="/app.html#/map">Explore the national map →</a>
</body></html>"""
    open(os.path.join(ROOT, fname), 'w').write(page)
    print(f'{fname}: {len(pool)} clubs, top 100 rendered')
