#!/usr/bin/env python3
"""Generate a static, crawlable page per rated club at club/<id>.html plus a
full sitemap.xml. The SPA's hash routes (#/club/...) are invisible to
crawlers; these pages are the long-tail search surface ("<club> ranking",
"<city> soccer club"). Rated clubs only — youth layers are org listings with
no ratings and stay out (thin-content + minors policy). Re-run each deploy
(deploy.sh does); ranks and ratings are baked at generation time."""
import json, re, os, html, math, datetime, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(ROOT, 'js', 'data.js')).read()
clubs = json.loads(re.search(r'export const CLUBS=(\[.*?\]);', src, re.S).group(1))
leagues = json.loads(re.search(r'export const LEAGUES=(\{.*?\});', src, re.S).group(1))

BASIS = {1: 'from real match results', 2: 'from real league standings',
         3: 'from an independent results model'}
SITE = 'https://www.rankedxi.com'
today = datetime.date.today().isoformat()

rated = [c for c in clubs if not c.get('h') and c.get('r') and c.get('id')]
by_sex = {}
for c in rated:
    by_sex.setdefault(c.get('x', 'm'), []).append(c)
for pool in by_sex.values():
    pool.sort(key=lambda c: -c['r'])
nat_rank = {c['id']: i + 1 for pool in by_sex.values() for i, c in enumerate(pool)}
lg_pools = {}
for c in rated:
    lg_pools.setdefault(c['g'], []).append(c)
for pool in lg_pools.values():
    pool.sort(key=lambda c: -c['r'])
lg_rank = {c['id']: i + 1 for pool in lg_pools.values() for i, c in enumerate(pool)}


def dist(a, b):
    dy = (a['la'] - b['la']) * 111
    dx = (a['lo'] - b['lo']) * 111 * math.cos(math.radians(a['la']))
    return math.hypot(dx, dy)


def rivals(c, n=5):
    peers = [p for p in by_sex[c.get('x', 'm')]
             if p is not c and isinstance(p.get('la'), (int, float))]
    if not isinstance(c.get('la'), (int, float)):
        return []
    return sorted(peers, key=lambda p: dist(c, p))[:n]


out_dir = os.path.join(ROOT, 'club')
shutil.rmtree(out_dir, ignore_errors=True)
os.makedirs(out_dir)

for c in rated:
    lg = leagues.get(c['g'], {})
    lg_label = lg.get('label', c['g'].upper())
    sexw = c.get('x') == 'w'
    loc = f"{c.get('ct', '')}, {c['st']}" if c.get('ct') else c.get('st', '')
    name = html.escape(c['n'])
    basis = BASIS.get(c.get('rr'), 'illustrative — demonstrates the product until this league’s feed connects')
    title = f"{c['n']} — {lg_label} rating & national rank | Ranked XI"
    desc = (f"{c['n']} ({loc}) rates {c['r']} {basis} — #{lg_rank[c['id']]} in {lg_label}, "
            f"#{nat_rank[c['id']]} of {len(by_sex[c.get('x', 'm')]):,} rated clubs in the "
            f"{'women’s' if sexw else 'men’s'} US soccer pyramid.")
    riv_rows = ''.join(
        f'<li><a href="/club/{p["id"]}">{html.escape(p["n"])}</a> · {html.escape(leagues.get(p["g"], {}).get("label", p["g"]))} · {p["r"]}</li>'
        for p in rivals(c))
    ld = json.dumps({
        '@context': 'https://schema.org', '@type': 'SportsTeam', 'name': c['n'],
        'sport': 'Soccer', 'url': f'{SITE}/club/{c["id"]}',
        'address': {'@type': 'PostalAddress', 'addressLocality': c.get('ct', ''), 'addressRegion': c.get('st', '')},
        'memberOf': {'@type': 'SportsOrganization', 'name': lg_label}})
    page = f"""<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}</title>
<meta name="description" content="{html.escape(desc)}">
<link rel="canonical" href="{SITE}/club/{c['id']}">
<meta property="og:title" content="{html.escape(title)}">
<meta property="og:description" content="{html.escape(desc)}">
<meta property="og:image" content="{SITE}/og.png"><meta property="og:type" content="website">
<script type="application/ld+json">{ld}</script>
<style>body{{margin:0;background:#0C1512;color:#E8EFEA;font:16px/1.55 -apple-system,"Segoe UI",Roboto,sans-serif;padding:24px clamp(16px,4vw,48px)}}
h1{{font-family:"Avenir Next Condensed","Arial Narrow",sans-serif;text-transform:uppercase;font-size:clamp(1.5rem,4vw,2.4rem);margin:.3em 0}}
a{{color:#7FD1A8}}.stats{{display:flex;gap:26px;flex-wrap:wrap;margin:16px 0}}
.stats b{{display:block;font-size:1.5rem}}.stats span{{color:#8FA598;font-size:.85rem}}
.cta{{display:inline-block;background:#C77F1E;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:700;margin:12px 0}}
ul{{padding-left:20px;line-height:1.9}}p.note{{color:#8FA598;font-size:.85rem;max-width:60em}}</style></head><body>
<p><a href="/">Ranked XI</a> · {lg_label} · updated {today}</p>
<h1>{name}</h1>
<p>{html.escape(loc)} · {lg_label} · {'women’s' if sexw else 'men’s'} game</p>
<div class="stats">
<div><b>{c['r']}</b><span>Rating, {html.escape(basis)}</span></div>
<div><b>#{lg_rank[c['id']]}</b><span>{lg_label}</span></div>
<div><b>#{nat_rank[c['id']]}</b><span>National ({'women’s' if sexw else 'men’s'}, of {len(by_sex[c.get('x', 'm')]):,} rated)</span></div>
</div>
<a class="cta" href="/app.html#/club/{c['id']}">Full profile in the app — map, matchups, players →</a>
{f'<h2 style="font-size:1rem;color:#8FA598;text-transform:uppercase;letter-spacing:.06em">Nearest rated rivals</h2><ul>{riv_rows}</ul>' if riv_rows else ''}
<p class="note">Every Ranked XI rating labels its basis; this one is {html.escape(basis)}. Cross-league placement is calibrated on ~600 U.S. Open Cup results — <a href="/methodology">how the ratings work</a>. Not affiliated with any league or club; marks belong to their owners. <a href="/app.html#/legal">Corrections &amp; removal</a>.</p>
</body></html>"""
    open(os.path.join(out_dir, f"{c['id']}.html"), 'w').write(page)

urls = [f'{SITE}/', f'{SITE}/app.html', f'{SITE}/upsl-rankings.html',
        f'{SITE}/npsl-rankings.html', f'{SITE}/methodology.html'] + \
       [f'{SITE}/club/{c["id"]}' for c in rated]
sm = ['<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'] + \
     [f'  <url><loc>{html.escape(u)}</loc></url>' for u in urls] + ['</urlset>']
open(os.path.join(ROOT, 'sitemap.xml'), 'w').write('\n'.join(sm) + '\n')
print(f'club pages: {len(rated)} · sitemap urls: {len(urls)}')
