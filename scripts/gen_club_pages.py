#!/usr/bin/env python3
"""Generate the site's static, crawlable long-tail surface from js/data.js:

  club/<id>.html     one per rated club   ("<club> ranking")
  league/<g>.html    one per league       ("NPSL standings 2026")
  state/<code>.html  one per state        ("semi pro soccer teams in Texas")

plus the full sitemap.xml. The SPA's hash routes (#/club/..., #/league/...,
#/state/...) are invisible to crawlers; these pages are the only search
surface for any of it. The three tiers cross-link into each other so the
long tail has an internal link graph rather than 3,000 orphans hanging off
one sitemap — a club page names its league and state, and both name it back.

Rated clubs only — youth layers are org listings with no ratings and stay out
(thin-content + minors policy). Re-run each deploy (deploy.sh does); ranks and
ratings are baked at generation time.

This script owns sitemap.xml. Anything crawlable that it does not emit is not
in the sitemap, no matter what is on disk (see preflight.py's check #2)."""
import json, re, os, html, math, datetime, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(ROOT, 'js', 'data.js')).read()
clubs = json.loads(re.search(r'export const CLUBS=(\[.*?\]);', src, re.S).group(1))
leagues = json.loads(re.search(r'export const LEAGUES=(\{.*?\});', src, re.S).group(1))

# state/province labels are parsed out of app.js rather than restated here:
# a second copy would drift the moment a province is added (Canada layer)
_app = open(os.path.join(ROOT, 'js', 'app.js')).read()


def _name_map(const):
    body = re.search(r'const %s = (\{.*?\});' % const, _app, re.S).group(1)
    return dict(re.findall(r"(\w+)\s*:\s*'([^']*)'", body))


PLACE_NAME = {**_name_map('STATE_NAME'), **_name_map('PROV_NAME')}

BASIS = {1: 'from real match results', 2: 'from real league standings',
         3: 'from an independent results model'}
ILLUSTRATIVE = 'illustrative — demonstrates the product until this league’s feed connects'
SITE = 'https://www.rankedxi.com'
today = datetime.date.today().isoformat()

# leagues that already have a hand-tuned static landing page from
# gen_seo_pages.py; a second auto-generated page would compete with it
HAS_LANDING = {'upsl': '/upsl-rankings', 'npsl': '/npsl-rankings'}

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
st_pools = {}
for c in rated:
    if c.get('st') in PLACE_NAME:
        st_pools.setdefault(c['st'], []).append(c)
for pool in st_pools.values():
    pool.sort(key=lambda c: -c['r'])

STYLE = """@font-face{font-family:"Barlow Condensed";font-style:normal;font-weight:700;font-display:swap;src:url(/fonts/barlow-condensed-latin-700.woff2) format("woff2")}
body{margin:0;background:#0C1512;color:#E8EFEA;font:16px/1.55 -apple-system,"Segoe UI",Roboto,sans-serif;padding:24px clamp(16px,4vw,48px)}
h1{font-family:"Barlow Condensed","Avenir Next Condensed","Arial Narrow",sans-serif;text-transform:uppercase;font-size:clamp(1.5rem,4vw,2.4rem);margin:.3em 0}
h2{font-family:"Barlow Condensed","Avenir Next Condensed","Arial Narrow",sans-serif;text-transform:uppercase;letter-spacing:.05em;font-size:1.1rem;color:#8FA598;margin:1.8em 0 .5em}
a{color:#7FD1A8}.stats{display:flex;gap:26px;flex-wrap:wrap;margin:16px 0}
.stats b{display:block;font-size:1.5rem}.stats span{color:#8FA598;font-size:.85rem}
.cta{display:inline-block;background:#C77F1E;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:700;margin:12px 0}
ul{padding-left:20px;line-height:1.9}p.note{color:#8FA598;font-size:.85rem;max-width:60em}
table{border-collapse:collapse;width:100%;max-width:52em;margin:8px 0 18px;font-size:.94rem}
th,td{text-align:left;padding:7px 10px;border-bottom:1px solid #1D2A24}
th{color:#8FA598;font-size:.76rem;text-transform:uppercase;letter-spacing:.07em;font-weight:600}
td.n{text-align:right;font-variant-numeric:tabular-nums;color:#8FA598;width:3em}
td.r{text-align:right;font-variant-numeric:tabular-nums;font-weight:700;width:4.5em}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 4px;padding:0;list-style:none;line-height:1.4}
.chips li{margin:0}.chips a{display:inline-block;background:#152420;border:1px solid #22352E;border-radius:999px;padding:5px 12px;text-decoration:none;font-size:.86rem}"""


def head(title, desc, path, ld, og_img=f'{SITE}/og.png', tw='summary'):
    """Shared <head>. Canonicals are extensionless: the .html form 308s to the
    extensionless one, so a .html canonical routes every crawler through a
    redirect (external audit #5)."""
    return f"""<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚽</text></svg>">
<title>{html.escape(title)}</title>
<meta name="description" content="{html.escape(desc)}">
<link rel="canonical" href="{SITE}{path}">
<meta property="og:title" content="{html.escape(title)}">
<meta property="og:description" content="{html.escape(desc)}">
<meta property="og:image" content="{og_img}"><meta property="og:type" content="website">
<meta name="twitter:card" content="{tw}">
<script type="application/ld+json">{ld}</script>
<style>{STYLE}</style>
<script src="/js/rxi-a.js" defer></script>
</head><body>"""


FOOT = ('<p class="note">Every Ranked XI rating labels its basis. Cross-league placement is '
        'calibrated on ~600 U.S. Open Cup results — <a href="/methodology">how the ratings work</a>. '
        'Not affiliated with any league or club; marks belong to their owners. '
        '<a href="/app#/legal">Corrections &amp; removal</a>.</p>\n</body></html>')


def lg_href(g):
    """Dedicated landing page where one exists, generated league page otherwise."""
    return HAS_LANDING.get(g, f'/league/{g}')


def lg_label(g):
    return leagues.get(g, {}).get('label', g.upper())


def sexw(c):
    return c.get('x') == 'w'


def rank_table(pool, rank_of=None, show_league=True, limit=None):
    rows = ''.join(
        f'<tr><td class="n">{rank_of(c, i) if rank_of else i + 1}</td>'
        f'<td><a href="/club/{c["id"]}">{html.escape(c["n"])}</a></td>'
        + (f'<td><a href="{lg_href(c["g"])}">{html.escape(lg_label(c["g"]))}</a></td>' if show_league else '')
        + f'<td>{html.escape(c.get("ct") or "")}{", " + html.escape(c["st"]) if c.get("ct") and c.get("st") else html.escape(c.get("st") or "")}</td>'
          f'<td class="r">{c["r"]}</td></tr>'
        for i, c in enumerate(pool[:limit] if limit else pool))
    return (f'<table><thead><tr><th></th><th>Club</th>'
            + ('<th>League</th>' if show_league else '')
            + f'<th>Location</th><th style="text-align:right">Rating</th></tr></thead>'
              f'<tbody>{rows}</tbody></table>')


def item_list(pool, path_of, name_of):
    return {'@context': 'https://schema.org', '@type': 'ItemList',
            'numberOfItems': len(pool),
            'itemListElement': [{'@type': 'ListItem', 'position': i + 1,
                                 'name': name_of(x), 'url': f'{SITE}{path_of(x)}'}
                                for i, x in enumerate(pool[:50])]}


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


def fresh(name):
    d = os.path.join(ROOT, name)
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(d)
    return d


# ---------------------------------------------------------------- club pages
out_dir = fresh('club')
for c in rated:
    g = c['g']
    label = lg_label(g)
    loc = f"{c.get('ct', '')}, {c['st']}" if c.get('ct') else c.get('st', '')
    name = html.escape(c['n'])
    basis = BASIS.get(c.get('rr'), ILLUSTRATIVE)
    w = sexw(c)
    title = f"{c['n']} — {label} rating & national rank | Ranked XI"
    desc = (f"{c['n']} ({loc}) rates {c['r']} {basis} — #{lg_rank[c['id']]} in {label}, "
            f"#{nat_rank[c['id']]} of {len(by_sex[c.get('x', 'm')]):,} rated clubs in the "
            f"{'women’s' if w else 'men’s'} US soccer pyramid.")
    # per-club share card when gen_og_cards.py produced one (it runs first in
    # deploy.sh); otherwise the site-wide banner
    has_card = os.path.exists(os.path.join(ROOT, 'og', f"{c['id']}.jpg"))
    og_img = f"{SITE}/og/{c['id']}.jpg" if has_card else f'{SITE}/og.png'
    riv_rows = ''.join(
        f'<li><a href="/club/{p["id"]}">{html.escape(p["n"])}</a> · '
        f'{html.escape(lg_label(p["g"]))} · {p["r"]}</li>' for p in rivals(c))
    # official site + social profiles: sameAs is how schema.org disambiguates
    # an entity, and for a lower-league club these links are often the only
    # other place on the web that names it
    same_as = [c[k] for k in ('si', 'sx', 'sf') if c.get(k)]
    ld_obj = {
        '@context': 'https://schema.org', '@type': 'SportsTeam', 'name': c['n'],
        'sport': 'Soccer', 'url': f'{SITE}/club/{c["id"]}',
        'address': {'@type': 'PostalAddress', 'addressLocality': c.get('ct', ''), 'addressRegion': c.get('st', '')},
        'memberOf': {'@type': 'SportsOrganization', 'name': label,
                     'url': f'{SITE}{lg_href(g)}'}}
    if c.get('url'):
        ld_obj['sameAs'] = [c['url']] + same_as
    elif same_as:
        ld_obj['sameAs'] = same_as
    ld = json.dumps(ld_obj)
    # the club's two parent hubs, so every leaf page feeds its league and state
    off = []
    for lbl, key in (('Official site', 'url'), ('Instagram', 'si'),
                     ('X', 'sx'), ('Facebook', 'sf')):
        if c.get(key):
            off.append(f'<li><a href="{html.escape(c[key], quote=True)}" '
                       f'target="_blank" rel="noopener">{lbl} &nearr;</a></li>')
    off_html = (f'<h2>Official {name} links</h2><ul class="chips">{"".join(off)}</ul>'
                if off else '')

    up = [f'<li><a href="{lg_href(g)}">All {html.escape(label)} rankings</a></li>']
    if c.get('st') in PLACE_NAME:
        up.append(f'<li><a href="/state/{c["st"].lower()}">'
                  f'Soccer clubs in {html.escape(PLACE_NAME[c["st"]])}</a></li>')
    page = (head(title, desc, f'/club/{c["id"]}', ld, og_img,
                 'summary_large_image' if has_card else 'summary') + f"""
<p><a href="/">Ranked XI</a> · <a href="{lg_href(g)}">{html.escape(label)}</a> · updated {today}</p>
<h1>{name}</h1>
<p>{html.escape(loc)} · {html.escape(label)} · {'women’s' if w else 'men’s'} game</p>
<div class="stats">
<div><b>{c['r']}</b><span>Rating, {html.escape(basis)}</span></div>
<div><b>#{lg_rank[c['id']]}</b><span>{html.escape(label)}</span></div>
<div><b>#{nat_rank[c['id']]}</b><span>National ({'women’s' if w else 'men’s'}, of {len(by_sex[c.get('x', 'm')]):,} rated)</span></div>
</div>
<a class="cta" href="/app#/club/{c['id']}">Full profile in the app — map, matchups, players →</a>
{f'<h2>Nearest rated rivals</h2><ul>{riv_rows}</ul>' if riv_rows else ''}
<h2>Where {name} sits</h2><ul class="chips">{''.join(up)}</ul>
{off_html}
""" + FOOT)
    open(os.path.join(out_dir, f"{c['id']}.html"), 'w').write(page)

# -------------------------------------------------------------- league pages
lg_dir = fresh('league')
lg_ids = []
for g, pool in sorted(lg_pools.items()):
    if g in HAS_LANDING:
        continue        # gen_seo_pages.py owns these two
    label = lg_label(g)
    w = sexw(pool[0])
    states = sorted({c['st'] for c in pool if c.get('st') in PLACE_NAME},
                    key=lambda s: PLACE_NAME[s])
    top = pool[0]
    title = f"{label} Rankings 2026 — all {len(pool)} clubs rated | Ranked XI"
    desc = (f"{label} rankings 2026: all {len(pool)} clubs rated on one national scale, "
            f"led by {top['n']} at {top['r']}. See where any {label} side ranks against "
            f"the rest of the {'women’s' if w else 'men’s'} US soccer pyramid.")
    ld = json.dumps(item_list(pool, lambda c: f'/club/{c["id"]}', lambda c: c['n']))
    st_chips = ''.join(
        f'<li><a href="/state/{s.lower()}">{html.escape(PLACE_NAME[s])}</a></li>' for s in states)
    page = (head(title, desc, f'/league/{g}', ld) + f"""
<p><a href="/">Ranked XI</a> · Leagues · updated {today}</p>
<h1>{html.escape(label)} rankings</h1>
<p>{len(pool)} rated clubs · {'women’s' if w else 'men’s'} game · rated on the same scale as every
other league in the pyramid, so a {html.escape(label)} side and an MLS side are directly comparable.</p>
<div class="stats">
<div><b>{len(pool)}</b><span>Rated clubs</span></div>
<div><b>{top['r']}</b><span>Top rating ({html.escape(top['n'])})</span></div>
<div><b>#{nat_rank[top['id']]}</b><span>Best national rank</span></div>
</div>
<a class="cta" href="/app#/league/{g}">Open {html.escape(label)} on the live map →</a>
<h2>Full {html.escape(label)} table</h2>
{rank_table(pool, show_league=False)}
{f'<h2>{html.escape(label)} by state</h2><ul class="chips">{st_chips}</ul>' if st_chips else ''}
""" + FOOT)
    open(os.path.join(lg_dir, f'{g}.html'), 'w').write(page)
    lg_ids.append(g)

# --------------------------------------------------------------- state pages
st_dir = fresh('state')
st_ids = []
for st, pool in sorted(st_pools.items(), key=lambda kv: PLACE_NAME[kv[0]]):
    place = PLACE_NAME[st]
    men = [c for c in pool if not sexw(c)]
    women = [c for c in pool if sexw(c)]
    in_lgs = sorted({c['g'] for c in pool}, key=lambda g: -len([c for c in pool if c['g'] == g]))
    top = pool[0]
    title = f"{place} Soccer Club Rankings — {len(pool)} clubs rated | Ranked XI"
    desc = (f"Every rated soccer club in {place}: {len(pool)} sides across "
            f"{len(in_lgs)} leagues, from the pros down to semi-pro and amateur, "
            f"ranked on one national scale. Led by {top['n']} at {top['r']}.")
    ld = json.dumps(item_list(pool, lambda c: f'/club/{c["id"]}', lambda c: c['n']))
    lg_chips = ''.join(
        f'<li><a href="{lg_href(g)}">{html.escape(lg_label(g))}</a></li>' for g in in_lgs)
    body = f'<h2>Men’s clubs in {html.escape(place)}</h2>{rank_table(men)}' if men else ''
    if women:
        body += f'<h2>Women’s clubs in {html.escape(place)}</h2>{rank_table(women)}'
    page = (head(title, desc, f'/state/{st.lower()}', ld) + f"""
<p><a href="/">Ranked XI</a> · States · updated {today}</p>
<h1>Soccer clubs in {html.escape(place)}</h1>
<p>{len(pool)} rated clubs across {len(in_lgs)} leagues — pro, semi-pro and amateur, all on one
rating scale. Tap any club for its rating, national rank and nearest rivals.</p>
<div class="stats">
<div><b>{len(pool)}</b><span>Rated clubs</span></div>
<div><b>{len(in_lgs)}</b><span>Leagues represented</span></div>
<div><b>{top['r']}</b><span>Top rating ({html.escape(top['n'])})</span></div>
</div>
<a class="cta" href="/app#/state/{st.lower()}">Open {html.escape(place)} on the live map →</a>
{body}
<h2>Leagues in {html.escape(place)}</h2><ul class="chips">{lg_chips}</ul>
""" + FOOT)
    open(os.path.join(st_dir, f'{st.lower()}.html'), 'w').write(page)
    st_ids.append(st.lower())

# ------------------------------------------------------------------- sitemap
# extensionless URLs only: the .html forms 308 to these, so listing .html in
# the sitemap sent every crawler entry through a redirect (external audit #5)
urls = [f'{SITE}/', f'{SITE}/app', f'{SITE}/upsl-rankings',
        f'{SITE}/npsl-rankings', f'{SITE}/methodology', f'{SITE}/privacy',
        # tool landing pages: the tools themselves are hash routes a crawler
        # can't see, so these two static pages are their only search surface.
        # They were hand-added to sitemap.xml once and silently dropped by
        # every subsequent deploy, because this list is what regenerates it.
        f'{SITE}/player-simulator', f'{SITE}/shots', f'{SITE}/radar'] + \
       [f'{SITE}/league/{g}' for g in lg_ids] + \
       [f'{SITE}/state/{s}' for s in st_ids] + \
       [f'{SITE}/club/{c["id"]}' for c in rated]
sm = ['<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'] + \
     [f'  <url><loc>{html.escape(u)}</loc></url>' for u in urls] + ['</urlset>']
open(os.path.join(ROOT, 'sitemap.xml'), 'w').write('\n'.join(sm) + '\n')
# ---- crawl path from the landing page into everything above ----
# Search Console said it plainly on 2026-08-20: for /club/atlanta-united,
# "URL is unknown to Google — no referring sitemaps detected, referring page:
# none detected, last crawl: N/A". The homepage was indexed and linked only to
# /app, /methodology and /privacy, so all 3,336 generated pages formed an
# island with no way in. They are well connected to each other — state pages
# list their clubs, club pages list rivals and their league — which is exactly
# why one entry point is enough to open the whole tree.
#
# Generated rather than hand-written so the links can only ever name pages this
# script actually produced. A hand-maintained list drifts and starts pointing at
# 404s, which is worse for crawling than no list.
def _chips(items):
    return '\n'.join(f'<li><a href="{h}">{html.escape(n)}</a></li>' for h, n in items)


leagues_in_browse = [(lg_href(g), lg_label(g)) for g in lg_ids]
states_in_browse = [(f'/state/{s}', PLACE_NAME[s.upper()]) for s in st_ids]

browse = f"""<!-- browse:start -->
<nav class="browse" aria-label="Browse every club">
<h2 class="disp">Browse every club</h2>
<p>Every rated club has a page of its own — rating, national position,
nearest rivals. Start from a league or a state.</p>
<section>
<h3>By league</h3>
<ul>
{_chips(leagues_in_browse)}
</ul>
</section>
<section>
<h3>By state</h3>
<ul>
{_chips(states_in_browse)}
</ul>
</section>
</nav>
<!-- browse:end -->"""

idx_path = os.path.join(ROOT, 'index.html')
idx = open(idx_path).read()
start, end = idx.index('<!-- browse:start -->'), idx.index('<!-- browse:end -->') + len('<!-- browse:end -->')
open(idx_path, 'w').write(idx[:start] + browse + idx[end:])
print(f'index.html browse block: {len(leagues_in_browse)} leagues + '
      f'{len(states_in_browse)} states linked')

print(f'club pages: {len(rated)} · league pages: {len(lg_ids)} · '
      f'state pages: {len(st_ids)} · sitemap urls: {len(urls)}')
