#!/usr/bin/env python3
"""Generate the site's static, crawlable long-tail surface from js/data.js:

  club/<id>.html     one per club        ("<club> ranking")
  league/<g>.html    one per league      ("NPSL standings 2026")
  state/<code>.html  one per state       ("semi pro soccer teams in Texas")

plus the sitemap index and its children. The SPA's hash routes (#/club/...,
#/league/..., #/state/...) are invisible to crawlers; these pages are the only
search surface for any of it. The three tiers cross-link into each other so the
long tail has an internal link graph rather than 3,000 orphans hanging off one
sitemap - a club page names its league, its state and its city neighbours, and
all of them name it back.

These pages are also the AI-answer surface. Most AI crawlers do not run
JavaScript, so a fact that only exists after app.js runs does not exist for
ChatGPT or Perplexity. Every number a reader would want - rating, basis, both
ranks with their denominators, weekly movement, honours - is printed here as
text, and each page opens with a self-contained 40-60 word lead that answers
the query on its own when lifted out of the page (2026-08-23 SEO/AEO audit).

Youth layers are org listings with no ratings and stay out (thin-content +
minors policy). Re-run each deploy (deploy.sh does); ranks and ratings are
baked at generation time.

This script owns sitemap.xml. Anything crawlable that it does not emit is not
in the sitemap, no matter what is on disk (see preflight.py's check #2)."""
import json, re, os, html, math, datetime, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(ROOT, 'js', 'data.js')).read()
clubs = json.loads(re.search(r'export const CLUBS=(\[.*?\]);', src, re.S).group(1))
leagues = json.loads(re.search(r'export const LEAGUES=(\{.*?\});', src, re.S).group(1))

# /js/* is served immutable for a year, so an untokened script URL here would
# pin every returning visitor to the copy of rxi-a.js they first cached - on
# the club/league/state pages, which are most of the site. Emit the placeholder;
# deploy.sh stamps the real token into the staged tree (scripts/cachebust.py).
from cachebust import PLACEHOLDER as VTOKEN
import seo_common as S
from seo_common import SITE

# state/province labels are parsed out of app.js rather than restated here:
# a second copy would drift the moment a province is added (Canada layer)
_app = open(os.path.join(ROOT, 'js', 'app.js')).read()


def _name_map(const):
    body = re.search(r'const %s = (\{.*?\});' % const, _app, re.S).group(1)
    return dict(re.findall(r"(\w+)\s*:\s*'([^']*)'", body))


PLACE_NAME = {**_name_map('STATE_NAME'), **_name_map('PROV_NAME')}
CA_PROV = set(_name_map('PROV_NAME'))

BASIS = {1: 'from real match results', 2: 'from real league standings',
         3: 'from an independent results model'}
# The same four labels as prose an AI engine can lift into an answer.
BASIS_LONG = {
    1: ('Real match results. Every scored fixture this club played is walked '
        'through the Elo model, so the rating moves with each result.'),
    2: ('Real league standings. The division publishes a table but not usable '
        'match-by-match results, so the rating is fitted to points and goal '
        'difference and moves as the table moves.'),
    3: ('An independent results model. The rating maps a third-party ratings '
        'system (Massey Ratings) onto the Ranked XI scale rather than being '
        'computed in-house - the source is named so the number can be checked.'),
}
ILLUSTRATIVE = 'illustrative — demonstrates the product until this league’s feed connects'
ILLUSTRATIVE_LONG = ('Illustrative. No usable feed is connected for this competition '
                     'yet, so the number demonstrates the product rather than '
                     'measuring the club. It is labelled here rather than hidden.')
today = datetime.date.today().isoformat()
today_h = datetime.date.today().strftime('%d %B %Y').lstrip('0')

# leagues that already have a hand-tuned static landing page from
# gen_seo_pages.py; a second auto-generated page would compete with it
HAS_LANDING = {'upsl': '/upsl-rankings', 'npsl': '/npsl-rankings'}

# Hand-curated league prose, used for the "what this league is" paragraph the
# audit asked for. Missing entries simply fall back to the generated line.
try:
    LG_INFO = json.load(open(os.path.join(ROOT, 'data', 'leagues_info.json')))['leagues']
except (OSError, KeyError, ValueError):
    LG_INFO = {}

# Club honours cabinet (Wikipedia-derived, already shipped in the app). Keyed
# by club name. Printing it in HTML is what keeps an MLS club page from losing
# every "<club> honours" query to Transfermarkt forever.
try:
    _r = open(os.path.join(ROOT, 'js', 'rosters.js')).read()
    HONOURS = json.loads(re.search(r'export const HONOURS=(\{.*?\});', _r, re.S).group(1))
except (OSError, AttributeError, ValueError):
    HONOURS = {}

# Last week's ratings + national ranks, rotated by scripts/snapshot_ranks.py in
# the refresh workflow. Absent on a fresh checkout - movement is simply omitted
# rather than guessed.
try:
    _snap = json.load(open(os.path.join(ROOT, 'data', 'rank_snapshot.json')))
    SNAP = _snap.get('clubs') or {}
    SNAP_DATE = datetime.date.fromisoformat(_snap['date']).strftime('%d %b').lstrip('0')
except (OSError, KeyError, ValueError):
    SNAP, SNAP_DATE = {}, None

rated = [c for c in clubs if not c.get('h') and c.get('r') and c.get('id')]
# Clubs we hold but cannot rate still get a page. They are real clubs with a
# crest, a city and socials, and 279 of them are UPSL sides whose divisions
# publish no usable standings. Dropping their pages would 404 indexed URLs
# and delete the one page on the web that names some of these clubs - the
# honest fix is a page that says "not yet rated", not no page.
#
# They ship with a lead built from their own geography (nearest rated clubs and
# how far away they are), so no two unrated pages carry the same paragraph, and
# they sit in their own sitemap so a crawler is not told they rank alongside
# the rated pages (audit T4).
unrated = [c for c in clubs if not c.get('h') and not c.get('r') and c.get('id')]
listed = rated + unrated
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
st_rank = {c['id']: i + 1 for pool in st_pools.values() for i, c in enumerate(pool)}
# city index - "3 related clubs in the same city" is how a local query
# ("soccer clubs in Fresno") attaches to a club page that never names the query
city_pools = {}
for c in listed:
    if c.get('ct') and c.get('st'):
        city_pools.setdefault((c['ct'], c['st']), []).append(c)
for pool in city_pools.values():
    pool.sort(key=lambda c: -(c.get('r') or 0))

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
.chips li{margin:0}.chips a{display:inline-block;background:#152420;border:1px solid #22352E;border-radius:999px;padding:5px 12px;text-decoration:none;font-size:.86rem}
.lead{font-size:1.06rem;max-width:44em;line-height:1.6}
.crumbs{font-size:.82rem;color:#8FA598;margin:0 0 4px}.crumbs a{color:#8FA598}
.up{color:#7FD1A8;font-weight:700}.down{color:#E08A7B;font-weight:700}.flat{color:#8FA598}
dl.faq{max-width:52em}dl.faq dt{font-weight:700;margin:14px 0 4px}
dl.faq dd{margin:0;color:#B8C7BD}
.basis{max-width:52em;color:#B8C7BD}"""


def head(title, desc, path, ld, og_img=S.OG_DEFAULT, og_alt=None, robots=None):
    """Shared <head>. Canonicals are extensionless: the .html form 308s to the
    extensionless one, so a .html canonical routes every crawler through a
    redirect (external audit #5). OG/Twitter and the favicon come from
    seo_common so all 4,400 pages describe the same entity."""
    S.check_title(title, path)
    robots_tag = f'<meta name="robots" content="{robots}">' if robots else ''
    return f"""<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
{S.ICONS}
<title>{html.escape(title)}</title>
<meta name="description" content="{html.escape(desc, quote=True)}">
<link rel="canonical" href="{SITE}{path}">
{robots_tag}
{S.og_tags(title, desc, path, og_img, og_alt)}
<script type="application/ld+json">{ld}</script>
<style>{STYLE}</style>
<script src="/js/rxi-a.js?v={VTOKEN}" defer></script>
</head><body>"""


FOOT = ('<p class="note">Every Ranked XI rating labels its basis. Cross-league placement is '
        'calibrated on ~600 U.S. Open Cup results — <a href="/methodology">how the ratings work</a>. '
        'Ranked XI is an independent project: not an official USSF or league ranking, '
        'not affiliated with any league or club, and not betting advice. Marks belong to '
        'their owners. <a href="/about">About</a> · <a href="/faq">FAQ</a> · '
        '<a href="/us-soccer-pyramid">The US soccer pyramid</a> · '
        '<a href="/terms">Corrections &amp; removal</a>.</p>\n</body></html>')


def fit_title(*candidates):
    """First candidate that fits a SERP line. Club names run from 'LAFC' to
    'University of Nebraska at Omaha Mavericks', so one f-string cannot serve
    4,400 pages without truncating thousands of them."""
    for t in candidates:
        if len(t) <= S.TITLE_MAX:
            return t
    return candidates[-1][:S.TITLE_MAX - 1].rstrip(' ,–—-') + '…'


def lg_href(g):
    """Dedicated landing page where one exists, generated league page otherwise."""
    return HAS_LANDING.get(g, f'/league/{g}')


def lg_label(g):
    return leagues.get(g, {}).get('label', g.upper())


def sexw(c):
    return c.get('x') == 'w'


def sexword(c):
    return 'women’s' if sexw(c) else 'men’s'


def movement(c):
    """(rating delta, national rank delta) against the last rotated snapshot,
    or (None, None) when the club is new or no snapshot exists. A rank delta is
    inverted for display: rank 40 -> 28 is a rise."""
    prev = SNAP.get(c['id'])
    if not prev or c['id'] not in nat_rank:
        return None, None
    return c['r'] - prev[0], prev[1] - nat_rank[c['id']]


def move_html(dr, dn):
    if dr is None or (not dr and not dn):
        return ''
    if dn > 0:
        cls, arrow, word = 'up', '▲', f'up {dn} place{"s" if dn != 1 else ""}'
    elif dn < 0:
        cls, arrow, word = 'down', '▼', f'down {abs(dn)} place{"s" if abs(dn) != 1 else ""}'
    else:
        cls, arrow, word = 'flat', '=', 'no change'
    sign = f'{dr:+d}' if dr else '±0'
    return (f'<div><b class="{cls}">{arrow} {sign}</b>'
            f'<span>Rating since {SNAP_DATE} · {word}</span></div>')


def move_sentence(c, dr, dn):
    if dr is None or (not dr and not dn):
        return ''
    if dn > 0:
        d = f'up {dn} place{"s" if dn != 1 else ""} nationally'
    elif dn < 0:
        d = f'down {abs(dn)} place{"s" if abs(dn) != 1 else ""} nationally'
    else:
        d = 'holding the same national position'
    return f' Since {SNAP_DATE} the rating has moved {dr:+d}, {d}.'


def rank_table(pool, rank_of=None, show_league=True, limit=None):
    rows = ''.join(
        f'<tr><td class="n">{rank_of(c, i) if rank_of else i + 1}</td>'
        f'<td><a href="/club/{c["id"]}">{html.escape(c["n"])}</a></td>'
        + (f'<td><a href="{lg_href(c["g"])}">{html.escape(lg_label(c["g"]))}</a></td>' if show_league else '')
        + f'<td>{html.escape(city(c.get("ct") or ""))}{", " + html.escape(c["st"]) if c.get("ct") and c.get("st") else html.escape(c.get("st") or "")}</td>'
          f'<td class="r">{c["r"]}</td></tr>'
        for i, c in enumerate(pool[:limit] if limit else pool))
    return (f'<table><thead><tr><th></th><th>Club</th>'
            + ('<th>League</th>' if show_league else '')
            + f'<th>Location</th><th style="text-align:right">Rating</th></tr></thead>'
              f'<tbody>{rows}</tbody></table>')


def item_list(pool, path_of, name_of, name, url):
    """ItemList with the dates and ordering the audit found missing - without
    itemListOrder a consumer cannot tell a ranking from an alphabetical list."""
    return {'@type': 'ItemList', 'name': name, 'url': f'{SITE}{url}',
            '@id': f'{SITE}{url}#list',
            'numberOfItems': len(pool), 'itemListOrder': 'https://schema.org/ItemListOrderDescending',
            'dateModified': today, 'isPartOf': {'@id': S.SITE_ID},
            'itemListElement': [{'@type': 'ListItem', 'position': i + 1,
                                 'name': name_of(x), 'url': f'{SITE}{path_of(x)}'}
                                for i, x in enumerate(pool[:50])]}


def dist(a, b):
    dy = (a['la'] - b['la']) * 111
    dx = (a['lo'] - b['lo']) * 111 * math.cos(math.radians(a['la']))
    return math.hypot(dx, dy)


def rivals(c, n=5):
    peers = [p for p in by_sex.get(c.get('x', 'm'), [])
             if p is not c and isinstance(p.get('la'), (int, float))]
    if not isinstance(c.get('la'), (int, float)):
        return []
    return sorted(peers, key=lambda p: dist(c, p))[:n]


def city_mates(c, n=3):
    pool = city_pools.get((c.get('ct'), c.get('st')), [])
    return [p for p in pool if p is not c][:n]


def fresh(name):
    d = os.path.join(ROOT, name)
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(d)
    return d


def city(name):
    """Ten club records carry a SHOUTED city ("ORINDA"). It reads as scraped
    junk in a lead paragraph, so it is cased for display here rather than
    edited in data.js, where the raw value is what the scrapers match on."""
    if name and name.isupper() and len(name) > 2:
        return name.title()
    return name


def article(label):
    """"a" or "an" for a league label. An initialism takes the article of its
    spoken first LETTER, not its first letter as a sound: "an MLS club" (em),
    "a UPSL side" (you). Getting this wrong reads as machine-written text on
    4,400 pages, which is exactly the impression the audit says to avoid."""
    first = label.split()[0]
    if len(first) > 1 and first.isupper():
        # letters whose names begin with a vowel sound
        return 'n' if first[0] in 'AEFHILMNORSX' else ''
    return 'n' if first[0].upper() in 'AEIOU' else ''


def honours_for(c):
    return HONOURS.get(c['n']) or []


# ---------------------------------------------------------------- club pages
out_dir = fresh('club')
# every league a club page will claim membership of must resolve, or the
# JSON-LD ships a 404 to every crawler that reads it (audit T3: GA Aspire's
# memberOf pointed at /league/gaa, which has never existed)
LIVE_LEAGUE_PAGES = set(HAS_LANDING) | set(lg_pools)
for c in listed:
    g = c['g']
    label = lg_label(g)
    ct = city(c.get('ct', ''))
    loc = f"{ct}, {c['st']}" if ct else c.get('st', '')
    place = PLACE_NAME.get(c.get('st', ''), c.get('st', ''))
    name = html.escape(c['n'])
    basis = BASIS.get(c.get('rr'), ILLUSTRATIVE)
    basis_long = BASIS_LONG.get(c.get('rr'), ILLUSTRATIVE_LONG)
    w = sexw(c)
    sw = sexword(c)
    is_rated = c['id'] in nat_rank
    denom = len(by_sex.get(c.get('x', 'm'), []))
    dr, dn = movement(c) if is_rated else (None, None)
    riv = rivals(c)
    mates = city_mates(c)
    an = article(label)

    if is_rated:
        title = fit_title(
            f"{c['n']} rank 2026: #{lg_rank[c['id']]} {label}, #{nat_rank[c['id']]} US | Ranked XI",
            f"{c['n']} rank 2026: #{nat_rank[c['id']]} US | Ranked XI",
            f"{c['n']} — {label} rating & rank | Ranked XI",
            f"{c['n']} rank & rating | Ranked XI",
            f"{c['n']} | Ranked XI")
        desc = (f"{c['n']} ({loc}) rates {c['r']} {basis} — #{lg_rank[c['id']]} in {label}, "
                f"#{nat_rank[c['id']]} of {denom:,} rated clubs in the {sw} US soccer "
                f"pyramid. Updated {today_h}.")
    else:
        title = fit_title(f"{c['n']} — {label} club profile | Ranked XI",
                          f"{c['n']} — {label} | Ranked XI",
                          f"{c['n']} | Ranked XI")
        desc = (f"{c['n']} ({loc}) plays in {label}. Not yet rated — no usable "
                f"results or standings published for this club's division. "
                f"Location, nearest rated clubs and official links on Ranked XI.")

    # ---- the AEO lead: 40-60 words that answer the query on their own ----
    # Written to survive being copied out of the page and into a chat window
    # with no surrounding context, which is how an AI engine quotes a source.
    if is_rated:
        same = ''
        if lg_rank[c['id']] == nat_rank[c['id']]:
            same = (f' Its league and national positions are the same number this week '
                    f'— {label} supplies the top {nat_rank[c["id"]]} {sw} clubs in the country.')
        riv_bit = ''
        if riv:
            r0 = riv[0]
            riv_bit = (f' Nearest rated rival: <a href="/club/{r0["id"]}">{html.escape(r0["n"])}</a> '
                       f'({html.escape(lg_label(r0["g"]))}, {r0["r"]}).')
        lead = (f'<p class="lead"><strong>{name} is a{an} '
                f'{html.escape(label)} {sw} soccer club in {html.escape(loc)}.</strong> '
                f'On the Ranked XI national table it rates <strong>{c["r"]}</strong> '
                f'({html.escape(basis)}), <strong>#{lg_rank[c["id"]]} in {html.escape(label)}</strong> '
                f'and <strong>#{nat_rank[c["id"]]} of {denom:,}</strong> rated {sw} clubs in the '
                f'US soccer pyramid. Figures updated {today_h}.{same}'
                f'{move_sentence(c, dr, dn)}{riv_bit}</p>')
    else:
        near = ''
        if riv:
            near = (' The nearest rated clubs are '
                    + ', '.join(f'<a href="/club/{p["id"]}">{html.escape(p["n"])}</a> '
                                f'({html.escape(lg_label(p["g"]))}, {p["r"]}, '
                                f'{dist(c, p):.0f} km)' for p in riv[:3]) + '.')
        st_ct = len(st_pools.get(c.get('st', ''), []))
        st_bit = (f' {html.escape(place)} has {st_ct:,} rated clubs on the table — '
                  f'<a href="/state/{c["st"].lower()}">see them all</a>.' if st_ct else '')
        lead = (f'<p class="lead"><strong>{name} is a{an} '
                f'{html.escape(label)} {sw} soccer club in {html.escape(loc)}.</strong> '
                f'It carries no Ranked XI rating: {html.escape(label)} publishes no '
                f'standings or results for this club\'s division that we can verify, and '
                f'we do not invent a number to fill the gap. A rating appears here the '
                f'moment a usable table exists.{near}{st_bit}</p>')

    # per-club share card when gen_og_cards.py produced one (it runs first in
    # deploy.sh); otherwise the site-wide banner
    has_card = os.path.exists(os.path.join(ROOT, 'og', f"{c['id']}.jpg"))
    og_img = f"{SITE}/og/{c['id']}.jpg" if has_card else S.OG_DEFAULT
    og_alt = (f"{c['n']} — Ranked XI rating {c['r']}, #{nat_rank[c['id']]} nationally"
              if is_rated else f"{c['n']} — {label} club profile on Ranked XI")

    riv_rows = ''.join(
        f'<li><a href="/club/{p["id"]}">{html.escape(p["n"])}</a> · '
        f'{html.escape(lg_label(p["g"]))} · {p["r"]}'
        + (f' · #{nat_rank[p["id"]]} nationally' if p['id'] in nat_rank else '')
        + f' · {dist(c, p):.0f} km</li>' for p in riv)

    # official site + social profiles: sameAs is how schema.org disambiguates
    # an entity, and for a lower-league club these links are often the only
    # other place on the web that names it
    same_as = [c[k] for k in ('si', 'sx', 'sf') if c.get(k)]
    ld_team = {
        '@type': 'SportsTeam', '@id': f'{SITE}/club/{c["id"]}#team', 'name': c['n'],
        'sport': 'Soccer', 'url': f'{SITE}/club/{c["id"]}', 'description': desc,
        'address': {'@type': 'PostalAddress', 'addressLocality': c.get('ct', ''),
                    'addressRegion': c.get('st', ''),
                    'addressCountry': 'CA' if c.get('st') in CA_PROV else 'US'},
    }
    if c.get('img'):
        ld_team['logo'] = f'{SITE}/{c["img"]}'
    # memberOf only names a URL when the league page it points at actually
    # resolves - a 404 in JSON-LD is worse than an omitted property (audit T3)
    if g in LIVE_LEAGUE_PAGES:
        ld_team['memberOf'] = {'@type': 'SportsOrganization', 'name': label,
                               'url': f'{SITE}{lg_href(g)}'}
    else:
        ld_team['memberOf'] = {'@type': 'SportsOrganization', 'name': label}
    if is_rated:
        # A rating is not a star review. AggregateRating here would be a lie to
        # earn a rich result; PropertyValue says exactly what the number is.
        ld_team['additionalProperty'] = [{
            '@type': 'PropertyValue', 'name': 'Ranked XI rating', 'value': c['r'],
            'description': (f'{basis.capitalize()}. {sw.capitalize()} national rank '
                            f'{nat_rank[c["id"]]} of {denom}. League rank '
                            f'{lg_rank[c["id"]]} of {len(lg_pools[g])}. Updated {today}.')}]
    if c.get('url'):
        ld_team['sameAs'] = [c['url']] + same_as
    elif same_as:
        ld_team['sameAs'] = same_as

    crumb_trail = [('Ranked XI', '/')]
    if c.get('st') in PLACE_NAME:
        crumb_trail.append((place, f'/state/{c["st"].lower()}'))
    crumb_trail.append((label, lg_href(g)))
    crumb_trail.append((c['n'], None))

    # ---- FAQ: visible text and schema built from one list, never separately --
    faq = []
    if is_rated:
        faq.append((f'Is this the official {label} ranking?',
                    f'No. Ranked XI is an independent national table. {label} publishes its own '
                    f'standings; this page places {c["n"]} on one scale that runs from MLS to the '
                    f'grassroots so clubs in different leagues can be compared.'))
        faq.append((f'What does a rating of {c["r"]} mean?',
                    f'It is an Elo-style strength estimate {basis}, calibrated across leagues on '
                    f'about 600 U.S. Open Cup results. Higher is stronger. It is a measure of '
                    f'form and level, not a prediction that {c["n"]} would win any particular match.'))
        if riv:
            faq.append(('Why is a club from another league listed as a rival?',
                        f'"Nearest rated rivals" means nearest by distance, not by league. Because '
                        f'every club sits on one scale, the closest club to {c["n"]} is shown '
                        f'whatever division it plays in.'))
    else:
        faq.append((f'Why does {c["n"]} have no rating?',
                    f'{label} does not publish standings or match results for this club\'s division '
                    f'in a form we can verify. Ranked XI labels the gap instead of filling it with '
                    f'an estimate.'))
        faq.append(('When will a rating appear?',
                    'As soon as a usable table or set of results is published for the division. '
                    'The page updates automatically on the next data run.'))
    faq.append(('Is this betting advice?',
                'No. Ranked XI publishes ratings and probabilities as data. Nothing on this site '
                'is betting advice.'))

    off = []
    for lbl, key in (('Official site', 'url'), ('Instagram', 'si'),
                     ('X', 'sx'), ('Facebook', 'sf')):
        if c.get(key):
            off.append(f'<li><a href="{html.escape(c[key], quote=True)}" '
                       f'target="_blank" rel="noopener">{lbl} &nearr;</a></li>')
    off_html = (f'<h2>Official {name} links</h2><ul class="chips">{"".join(off)}</ul>'
                if off else '')

    hon = honours_for(c)
    hon_html = ''
    if hon:
        rows = ''.join(f'<tr><td>{html.escape(h["t"])}</td>'
                       f'<td class="n">{len(h["y"])}</td>'
                       f'<td>{html.escape(", ".join(h["y"]))}</td></tr>' for h in hon)
        hon_html = (f'<h2>What has {name} won?</h2>'
                    f'<table><thead><tr><th>Competition</th><th>Titles</th>'
                    f'<th>Years</th></tr></thead><tbody>{rows}</tbody></table>')

    mates_html = ''
    if mates:
        items = ''.join(
            f'<li><a href="/club/{p["id"]}">{html.escape(p["n"])}</a> · '
            f'{html.escape(lg_label(p["g"]))}'
            + (f' · {p["r"]}' if p.get('r') else ' · not yet rated') + '</li>' for p in mates)
        mates_html = (f'<h2>Other clubs in {html.escape(ct)}</h2>'
                      f'<ul>{items}</ul>')

    # "where it sits" - the two parent hubs, so every leaf feeds league + state
    up = [f'<li><a href="{lg_href(g)}">All {html.escape(label)} rankings</a></li>']
    if c.get('st') in PLACE_NAME:
        up.append(f'<li><a href="/state/{c["st"].lower()}">'
                  f'Soccer clubs in {html.escape(place)}</a></li>')
    up.append('<li><a href="/us-soccer-pyramid">Where this league sits in the pyramid</a></li>')
    up.append('<li><a href="/methodology">How the ratings work</a></li>')

    # national placement section - spells out both denominators, which is what
    # turns "#28 / #28" from a suspected bug into a stated fact
    if is_rated:
        st_bit = ''
        if c['id'] in st_rank:
            st_bit = (f' In {html.escape(place)} it is <strong>#{st_rank[c["id"]]}</strong> of '
                      f'{len(st_pools[c["st"]]):,} rated clubs '
                      f'(<a href="/state/{c["st"].lower()}">state table</a>).')
        where = (f'<h2>Where does {name} sit nationally?</h2>'
                 f'<p class="basis">{name} is <strong>#{nat_rank[c["id"]]} of {denom:,}</strong> '
                 f'rated {sw} clubs in the United States, and <strong>#{lg_rank[c["id"]]} of '
                 f'{len(lg_pools[g]):,}</strong> rated clubs in {html.escape(label)}. '
                 f'Both figures come from the same scale, so the national number already '
                 f'accounts for every league above and below {html.escape(label)}.{st_bit}</p>')
        howrated = (f'<h2>How is {name} rated?</h2>'
                    f'<p class="basis">{html.escape(basis_long)} Cross-league placement is '
                    f'calibrated on roughly 600 U.S. Open Cup results, the only competition where '
                    f'clubs from different tiers actually play each other — '
                    f'<a href="/methodology">full methodology</a>.</p>')
    else:
        where = ''
        howrated = (f'<h2>How is {name} rated?</h2>'
                    f'<p class="basis">It is not, yet. {html.escape(basis_long)} '
                    f'<a href="/methodology">How Ranked XI builds ratings</a>.</p>')

    ld = S.graph(S.organization(), S.website(), ld_team,
                 S.breadcrumb(crumb_trail), S.faq_page(faq))

    page = (head(title, desc, f'/club/{c["id"]}', ld, og_img, og_alt) + f"""
{S.crumbs_html(crumb_trail)}
<h1>{name}</h1>
<p>{html.escape(loc)} · {html.escape(label)} · {sw} game · updated {today_h}</p>
{lead}
<div class="stats">
{f'<div><b>{c["r"]}</b><span>Rating, {html.escape(basis)}</span></div>' if is_rated else '<div><b>&mdash;</b><span>Not yet rated</span></div>'}
{f'<div><b>#{lg_rank[c["id"]]}</b><span>{html.escape(label)} (of {len(lg_pools[g]):,})</span></div>' if is_rated else ''}
{f'<div><b>#{nat_rank[c["id"]]}</b><span>National ({sw}, of {denom:,} rated)</span></div>' if is_rated else f'<div><b>NR</b><span>National ({sw})</span></div>'}
{move_html(dr, dn) if is_rated else ''}
</div>
<a class="cta" href="/app#/club/{c['id']}">Full profile in the app — map, matchups, players →</a>
{howrated}
{where}
{hon_html}
{f'<h2>Nearest rated rivals</h2><ul>{riv_rows}</ul>' if riv_rows else ''}
{mates_html}
<h2>Where {name} sits</h2><ul class="chips">{''.join(up)}</ul>
{off_html}
{S.faq_html(faq, f'{c["n"]} — common questions')}
""" + FOOT)
    open(os.path.join(out_dir, f"{c['id']}.html"), 'w').write(page)

# -------------------------------------------------------------- league pages
lg_dir = fresh('league')
lg_ids = []
for g, pool in sorted(lg_pools.items()):
    if g in HAS_LANDING:
        continue        # gen_seo_pages.py owns these two
    label = lg_label(g)
    sw = sexword(pool[0])
    states = sorted({c['st'] for c in pool if c.get('st') in PLACE_NAME},
                    key=lambda s: PLACE_NAME[s])
    top = pool[0]
    denom = len(by_sex.get(pool[0].get('x', 'm'), []))
    title = fit_title(f"{label} Rankings 2026 — all {len(pool)} clubs rated | Ranked XI",
                      f"{label} Rankings 2026 — {len(pool)} clubs | Ranked XI",
                      f"{label} Rankings 2026 | Ranked XI")
    desc = (f"{label} rankings 2026: all {len(pool)} clubs rated on one national scale, "
            f"led by {top['n']} at {top['r']}. See where any {label} side ranks against "
            f"the rest of the {sw} US soccer pyramid. Updated {today_h}.")

    # The old intro read "so a MLS side and an MLS side are directly comparable"
    # on /league/mls and "a NWSL side and an MLS side" on /league/nwsl - the
    # template compared the league to itself, and to the wrong league on the
    # women's pages. It now names real peers that are not this league.
    peers = [lg_label(x) for x in ('mls', 'nwsl', 'uslc', 'usl2', 'npsl', 'upsl')
             if (x in lg_pools or x in HAS_LANDING) and x != g][:2] or ['MLS']
    peer_line = ('They sit on the same scale as ' + ' and '.join(peers)
                 + ', so a league position and a national rank are the same unit.')

    about = (LG_INFO.get(g) or {}).get('about') or ''
    about_html = (f'<h2>What is {html.escape(label)}?</h2>'
                  f'<p class="basis">{html.escape(about)}</p>') if about else ''

    prose = ', '.join(
        f'<a href="/club/{c["id"]}">{html.escape(c["n"])}</a> ({c["r"]}'
        + (f', #{nat_rank[c["id"]]} nationally' if c['id'] in nat_rank else '') + ')'
        for c in pool[:5])
    lead = (f'<p class="lead"><strong>{html.escape(label)} has {len(pool)} rated clubs on the '
            f'Ranked XI national table.</strong> {peer_line} Top of {html.escape(label)} this '
            f'week: <strong>{html.escape(top["n"])}</strong> at <strong>{top["r"]}</strong>, '
            f'#{nat_rank[top["id"]]} of {denom:,} rated {sw} clubs in the country. '
            f'Updated {today_h}.</p>')

    faq = [
        (f'Is this the official {label} table?',
         f'No. {label} publishes its own standings. Ranked XI is an independent national '
         f'ranking that places all {len(pool)} {label} clubs on one scale alongside every '
         f'other league in the US pyramid, so cross-league comparison is possible.'),
        (f'Why does this not match the {label} standings?',
         f'Standings measure points won inside one league or conference this season. A Ranked XI '
         f'rating measures strength on a single national scale, calibrated across tiers on U.S. '
         f'Open Cup results, so a club can sit high here and mid-table in its own conference.'),
        (f'How many {label} clubs are rated?',
         f'{len(pool)} of them, led by {top["n"]} at {top["r"]}. Clubs whose divisions publish no '
         f'usable table are listed without a rating rather than being given an invented one.'),
    ]

    crumb_trail = [('Ranked XI', '/'), ('Leagues', '/us-soccer-pyramid'), (label, None)]
    ld = S.graph(S.organization(), S.website(),
                 item_list(pool, lambda c: f'/club/{c["id"]}', lambda c: c['n'],
                           f'{label} rankings 2026', f'/league/{g}'),
                 S.breadcrumb(crumb_trail), S.faq_page(faq))
    st_chips = ''.join(
        f'<li><a href="/state/{s.lower()}">{html.escape(PLACE_NAME[s])}</a></li>' for s in states)
    page = (head(title, desc, f'/league/{g}', ld,
                 og_alt=f'{label} rankings 2026 on Ranked XI') + f"""
{S.crumbs_html(crumb_trail)}
<h1>{html.escape(label)} rankings</h1>
<p>{len(pool)} rated clubs · {sw} game · updated {today_h}</p>
{lead}
<div class="stats">
<div><b>{len(pool)}</b><span>Rated clubs</span></div>
<div><b>{top['r']}</b><span>Top rating ({html.escape(top['n'])})</span></div>
<div><b>#{nat_rank[top['id']]}</b><span>Best national rank</span></div>
</div>
<a class="cta" href="/app#/league/{g}">Open {html.escape(label)} on the live map →</a>
{about_html}
<h2>Top five in {html.escape(label)} right now</h2>
<p class="basis">{prose}. Every club below is on the same scale — tap through for its
national rank, weekly movement and nearest rivals.</p>
<h2>Full {html.escape(label)} table</h2>
{rank_table(pool, show_league=False)}
{f'<h2>{html.escape(label)} by state</h2><ul class="chips">{st_chips}</ul>' if st_chips else ''}
<h2>Where {html.escape(label)} sits</h2><ul class="chips">
<li><a href="/us-soccer-pyramid">The US soccer pyramid, ranked</a></li>
<li><a href="/methodology">How the ratings work</a></li>
<li><a href="/faq">Ranked XI FAQ</a></li></ul>
{S.faq_html(faq, f'{label} rankings — common questions')}
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
    title = fit_title(f"{place} Soccer Club Rankings — {len(pool)} clubs rated | Ranked XI",
                      f"{place} Soccer Club Rankings — {len(pool)} rated | Ranked XI",
                      f"{place} Soccer Club Rankings | Ranked XI")
    desc = (f"Every rated soccer club in {place}: {len(pool)} sides across "
            f"{len(in_lgs)} leagues, from the pros down to semi-pro and amateur, "
            f"ranked on one national scale. Led by {top['n']} at {top['r']}. Updated {today_h}.")

    bits = []
    if men:
        bits.append(f'The top men’s side is <a href="/club/{men[0]["id"]}">'
                    f'{html.escape(men[0]["n"])}</a> ({men[0]["r"]}, '
                    f'{html.escape(lg_label(men[0]["g"]))})')
    if women:
        bits.append(f'the top women’s side is <a href="/club/{women[0]["id"]}">'
                    f'{html.escape(women[0]["n"])}</a> ({women[0]["r"]}, '
                    f'{html.escape(lg_label(women[0]["g"]))})')
    lead = (f'<p class="lead"><strong>{html.escape(place)} has {len(pool)} rated soccer clubs on '
            f'Ranked XI across {len(in_lgs)} leagues.</strong> ' + '; '.join(bits) +
            f'. Every club here is rated on the same national scale as MLS and the '
            f'grassroots, so a {html.escape(place)} amateur side and a top-flight club are '
            f'directly comparable. Updated {today_h}.</p>')

    # one genuinely unique paragraph per state, derived from that state's own
    # league mix - the difference between a directory and a doorway page
    biggest = in_lgs[0]
    biggest_n = len([c for c in pool if c['g'] == biggest])
    nat_top = min((nat_rank[c['id']] for c in pool), default=None)
    shape = (f'<p class="basis">{html.escape(place)}’s largest represented league is '
             f'<a href="{lg_href(biggest)}">{html.escape(lg_label(biggest))}</a> with '
             f'{biggest_n} rated club{"s" if biggest_n != 1 else ""}. '
             f'{len(men)} men’s and {len(women)} women’s sides carry a rating here, and the '
             f'state’s best national position is #{nat_top}. '
             f'Clubs from {html.escape(place)} whose divisions publish no usable table are '
             f'listed on the map without a rating rather than being given an invented one.</p>')

    faq = [
        (f'How many soccer clubs are ranked in {place}?',
         f'{len(pool)} rated clubs across {len(in_lgs)} leagues — {len(men)} men’s and '
         f'{len(women)} women’s. Unrated clubs are held and mapped but carry no number.'),
        (f'Which is the best soccer club in {place}?',
         f'{top["n"]} at {top["r"]}, playing in {lg_label(top["g"])}. "Best" here means highest '
         f'rating on the Ranked XI national scale, not league position.'),
        ('Are amateur and pro clubs really on the same scale?',
         'Yes. Cross-league placement is calibrated on about 600 U.S. Open Cup results, the one '
         'competition where clubs from different tiers meet, so a strong amateur side can rate '
         'above a weak professional one.'),
    ]
    crumb_trail = [('Ranked XI', '/'), ('States', '/'), (place, None)]
    ld = S.graph(S.organization(), S.website(),
                 item_list(pool, lambda c: f'/club/{c["id"]}', lambda c: c['n'],
                           f'Soccer clubs in {place}', f'/state/{st.lower()}'),
                 S.breadcrumb(crumb_trail), S.faq_page(faq))
    lg_chips = ''.join(
        f'<li><a href="{lg_href(g)}">{html.escape(lg_label(g))}</a></li>' for g in in_lgs)
    jump = []
    if men:
        jump.append('<li><a href="#mens">Men’s table</a></li>')
    if women:
        jump.append('<li><a href="#womens">Women’s table</a></li>')
    jump.append('<li><a href="#leagues">By league</a></li>')
    body = (f'<h2 id="mens">Men’s clubs in {html.escape(place)}</h2>{rank_table(men)}'
            if men else '')
    if women:
        body += (f'<h2 id="womens">Women’s clubs in {html.escape(place)}</h2>'
                 f'{rank_table(women)}')
    page = (head(title, desc, f'/state/{st.lower()}', ld,
                 og_alt=f'Soccer clubs in {place}, ranked by Ranked XI') + f"""
{S.crumbs_html(crumb_trail)}
<h1>Soccer clubs in {html.escape(place)}</h1>
<p>{len(pool)} rated clubs · {len(in_lgs)} leagues · updated {today_h}</p>
{lead}
<ul class="chips">{''.join(jump)}</ul>
<div class="stats">
<div><b>{len(pool)}</b><span>Rated clubs</span></div>
<div><b>{len(in_lgs)}</b><span>Leagues represented</span></div>
<div><b>{top['r']}</b><span>Top rating ({html.escape(top['n'])})</span></div>
</div>
<a class="cta" href="/app#/state/{st.lower()}">Open {html.escape(place)} on the live map →</a>
{shape}
{body}
<h2 id="leagues">Leagues in {html.escape(place)}</h2><ul class="chips">{lg_chips}</ul>
{S.faq_html(faq, f'Soccer in {place} — common questions')}
""" + FOOT)
    open(os.path.join(st_dir, f'{st.lower()}.html'), 'w').write(page)
    st_ids.append(st.lower())

# ------------------------------------------------------------------- sitemap
# A sitemap index, not one flat file. 4,450 undated URLs told Google nothing
# about what had changed, so weekly Elo movement on a new domain burned crawl
# budget re-fetching 4,000 pages that had not moved (audit T1). Splitting also
# separates the rated pages from the unrated ones so a crawl-budget decision
# can be made per group rather than for the whole site (audit T4).
#
# extensionless URLs only: the .html forms 308 to these, so listing .html in
# the sitemap sent every crawler entry through a redirect (external audit #5).
STATIC_URLS = [
    f'{SITE}/', f'{SITE}/app', f'{SITE}/upsl-rankings', f'{SITE}/npsl-rankings',
    f'{SITE}/methodology', f'{SITE}/privacy',
    # entity + answer pages the audit called missing; all four are generated by
    # gen_seo_pages.py and staged by deploy.sh
    f'{SITE}/about', f'{SITE}/faq', f'{SITE}/terms', f'{SITE}/us-soccer-pyramid',
    # tool landing pages: the tools themselves are hash routes a crawler
    # can't see, so these static pages are their only search surface. They were
    # hand-added to sitemap.xml once and silently dropped by every subsequent
    # deploy, because this list is what regenerates it.
    f'{SITE}/player-simulator', f'{SITE}/shots', f'{SITE}/radar']

CLUB_CHUNK = 2000       # well under the 50k/50MB limit, small enough to diff


def urlset(entries):
    """entries: [(loc, changefreq, priority)] - lastmod is the data stamp for
    every generated page, because every one of them is rewritten on each run."""
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for loc, freq, prio in entries:
        out.append(f'  <url><loc>{html.escape(loc)}</loc><lastmod>{today}</lastmod>'
                   f'<changefreq>{freq}</changefreq><priority>{prio}</priority></url>')
    out.append('</urlset>')
    return '\n'.join(out) + '\n'


def write_sitemap(name, entries):
    open(os.path.join(ROOT, name), 'w').write(urlset(entries))
    return name


children = [
    write_sitemap('sitemap-core.xml', [(u, 'weekly', '1.0') for u in STATIC_URLS]),
    write_sitemap('sitemap-leagues.xml',
                  [(f'{SITE}/league/{g}', 'weekly', '0.9') for g in lg_ids]),
    write_sitemap('sitemap-states.xml',
                  [(f'{SITE}/state/{s}', 'weekly', '0.9') for s in st_ids]),
]
for i in range(0, len(rated), CLUB_CHUNK):
    chunk = rated[i:i + CLUB_CHUNK]
    children.append(write_sitemap(
        f'sitemap-clubs-rated-{i // CLUB_CHUNK + 1}.xml',
        [(f'{SITE}/club/{c["id"]}', 'weekly', '0.7') for c in chunk]))
# unrated pages change only when a league finally publishes a table; telling a
# crawler "weekly" about 1,400 pages that will read identically next week is
# how a new domain spends its whole budget on its weakest content
if unrated:
    children.append(write_sitemap(
        'sitemap-clubs-unrated.xml',
        [(f'{SITE}/club/{c["id"]}', 'monthly', '0.3') for c in unrated]))

index = ['<?xml version="1.0" encoding="UTF-8"?>',
         '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'] + \
        [f'  <sitemap><loc>{SITE}/{n}</loc><lastmod>{today}</lastmod></sitemap>'
         for n in children] + ['</sitemapindex>']
open(os.path.join(ROOT, 'sitemap.xml'), 'w').write('\n'.join(index) + '\n')

# The IndexNow key file and the URL list deploy.sh submits. Bing, Yandex and
# Seznam accept a push instead of waiting for a crawl; Google ignores it, which
# is why this is a cheap extra and not a strategy (audit T9).
INDEXNOW_KEY = 'a7f3c1d94b6e42f8ae05c7213d9b8e64'
open(os.path.join(ROOT, f'{INDEXNOW_KEY}.txt'), 'w').write(INDEXNOW_KEY + '\n')
# only the pages worth a push: the hubs. Pushing 1,400 unrated stubs would be
# the same crawl-budget mistake, made in someone else's index.
push = STATIC_URLS + [f'{SITE}/league/{g}' for g in lg_ids] + \
       [f'{SITE}/state/{s}' for s in st_ids]
json.dump({'host': 'www.rankedxi.com', 'key': INDEXNOW_KEY,
           'keyLocation': f'{SITE}/{INDEXNOW_KEY}.txt', 'urlList': push},
          open(os.path.join(ROOT, 'indexnow.json'), 'w'))

# ---- crawl path from the landing page into everything above ----
# Search Console said it plainly on 2026-08-20: for /club/atlanta-united,
# "URL is unknown to Google - no referring sitemaps detected, referring page:
# none detected, last crawl: N/A". The homepage was indexed and linked only to
# /app, /methodology and /privacy, so all 3,336 generated pages formed an
# island with no way in. They are well connected to each other - state pages
# list their clubs, club pages list rivals and their league - which is exactly
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
<h3>Start here</h3>
<ul>
{_chips([('/us-soccer-pyramid', 'The US soccer pyramid, ranked'),
         ('/upsl-rankings', 'UPSL national rankings'),
         ('/npsl-rankings', 'NPSL national rankings'),
         ('/methodology', 'How the ratings work'),
         ('/faq', 'FAQ'), ('/about', 'About Ranked XI')])}
</ul>
</section>
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

print(f'club pages: {len(listed)} ({len(rated)} rated, {len(unrated)} unrated) · '
      f'league pages: {len(lg_ids)} · state pages: {len(st_ids)}')
print(f'sitemap index: {len(children)} children, '
      f'{len(STATIC_URLS) + len(lg_ids) + len(st_ids) + len(listed)} urls, lastmod {today}')
print(f'  honours printed on {sum(1 for c in listed if honours_for(c))} club pages')
print(f'  movement vs {SNAP_DATE or "(no snapshot yet)"} on '
      f'{sum(1 for c in rated if c["id"] in SNAP)} clubs')
