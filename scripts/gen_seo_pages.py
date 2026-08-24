#!/usr/bin/env python3
"""Generate the hand-aimed static pages that are not one-per-club:

  upsl-rankings.html      the national UPSL table the league does not publish
  npsl-rankings.html      same for NPSL
  us-soccer-pyramid.html  the pyramid Wikipedia draws, with our numbers in it
  faq.html                the questions AI engines currently answer badly
  about.html              who makes this, and the independence claim
  terms.html              a crawlable copy of the app's legal screen

and bake the landing page's headline counts into index.html / app.html.

Everything here is generated rather than hand-written for one reason: every
page states counts, and counts move twice a day. A hand-maintained About page
claiming "3,900 clubs" is how the site ended up quoting four different totals
across the homepage, the club pages and two Play Store fields (2026-08-23
audit, finding 9). One script owns the numbers; the prose is written around
placeholders it fills.

Re-run each deploy (deploy.sh does)."""
import json, re, os, html, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(ROOT, 'js', 'data.js')).read()
clubs = json.loads(re.search(r'export const CLUBS=(\[.*?\]);', src, re.S).group(1))
leagues = json.loads(re.search(r'export const LEAGUES=(\{.*?\});', src, re.S).group(1))

# /js/* is served immutable for a year, so an untokened script URL here would
# pin every returning visitor to the copy of rxi-a.js they first cached. Emit
# the placeholder; deploy.sh stamps the real token into the staged tree.
from cachebust import PLACEHOLDER as VTOKEN
import seo_common as S
from seo_common import SITE

today = datetime.date.today().isoformat()
today_h = datetime.date.today().strftime('%d %B %Y').lstrip('0')
METHOD_CHANGED = 'August 1, 2026'      # last material change to the method itself

FONT_FACE = ('@font-face{font-family:"Barlow Condensed";font-style:normal;font-weight:700;'
             'font-display:swap;src:url(/fonts/barlow-condensed-latin-700.woff2) format("woff2")}')
DISP_STACK = '"Barlow Condensed","Avenir Next Condensed","Arial Narrow",sans-serif'

# ---- counts, computed once and reused by every sentence on every page ----
mapped = [c for c in clubs if not c.get('h')]
rated = [c for c in mapped if c.get('r')]
rated_m = [c for c in rated if c.get('x') != 'w']
rated_w = [c for c in rated if c.get('x') == 'w']
rosters = json.loads(re.search(r'export const ROSTERS=(\{.*?\});',
                               open(os.path.join(ROOT, 'js', 'rosters.js')).read(), re.S).group(1))
COUNTS = {
    'clubs': len(mapped),
    'rated': len(rated),
    'ratedm': len(rated_m),
    'ratedw': len(rated_w),
    'statlines': sum(1 for arr in rosters.values() for p in arr if p.get('st')),
    'leagues': len(leagues),
}
N = {k: format(v, ',') for k, v in COUNTS.items()}


def lg_label(g):
    return leagues.get(g, {}).get('label', g.upper())


# ---------------------------------------------------------------- shared head
DOC_STYLE = f"""{FONT_FACE}
:root{{--ground:#FAFBF8;--ink:#16211B;--dim:#61705F;--line:#DCE2D8;--accent:#C77F1E;--raise:#fff}}
*{{box-sizing:border-box}}
body{{margin:0;background:var(--ground);color:var(--ink);font:16px/1.6 -apple-system,"Segoe UI",Roboto,sans-serif}}
.disp{{font-family:{DISP_STACK};text-transform:uppercase;letter-spacing:.02em}}
header{{display:flex;justify-content:space-between;align-items:center;padding:18px clamp(20px,5vw,64px);border-bottom:1px solid var(--line)}}
.mark{{font-weight:700;font-size:1.2rem;text-decoration:none;color:var(--ink)}}
main{{max-width:820px;margin:0 auto;padding:28px clamp(20px,5vw,64px) 40px}}
h1{{margin:0 0 4px;font-size:2rem}}
.sub{{color:var(--dim);margin:0 0 22px;font-size:.95rem}}
.lead{{font-size:1.08rem;line-height:1.6;margin:0 0 20px}}
section{{margin-bottom:26px}}
h2{{font-size:1.15rem;margin:0 0 8px}}
h3{{font-size:.95rem;margin:18px 0 4px}}
p{{margin:0 0 10px}}
a{{color:var(--accent)}}
.crumbs{{font-size:.82rem;color:var(--dim);margin:0 0 10px}}.crumbs a{{color:var(--dim)}}
.toc{{background:var(--raise);border:1px solid var(--line);border-radius:12px;padding:14px 18px;margin:0 0 26px}}
.toc ul{{margin:6px 0 0;padding-left:18px;columns:2;font-size:.92rem}}
table{{border-collapse:collapse;width:100%;margin:10px 0 18px;font-size:.93rem}}
th,td{{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}}
th{{color:var(--dim);font-size:.74rem;text-transform:uppercase;letter-spacing:.07em}}
td.n,th.n{{text-align:right;font-variant-numeric:tabular-nums}}
dl.faq dt{{font-weight:700;margin:18px 0 4px;font-size:1.02rem}}
dl.faq dd{{margin:0;color:#3C4A40}}
.tier{{border:1px solid var(--line);background:var(--raise);border-radius:12px;padding:14px 18px;margin:0 0 12px}}
.tier h3{{margin:0 0 6px;font-size:1rem}}
.tier .lgs{{display:flex;flex-wrap:wrap;gap:8px;list-style:none;padding:0;margin:6px 0 0}}
.tier .lgs a{{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:4px 12px;text-decoration:none;font-size:.86rem;color:var(--ink)}}
.tier .note{{color:var(--dim);font-size:.84rem;margin:8px 0 0}}
.cta{{display:inline-block;background:var(--accent);color:#1D1509;padding:12px 22px;border-radius:12px;text-decoration:none;font-weight:700;margin:8px 0}}
footer{{color:var(--dim);font-size:.8rem;padding:18px clamp(20px,5vw,64px) 40px;border-top:1px solid var(--line);max-width:820px;margin:0 auto}}"""

DARK_STYLE = f"""{FONT_FACE}
body{{margin:0;background:#0C1512;color:#E8EFEA;font:16px/1.55 -apple-system,"Segoe UI",Roboto,sans-serif;padding:24px clamp(16px,4vw,48px)}}
h1{{font-family:{DISP_STACK};text-transform:uppercase;font-size:clamp(1.6rem,4vw,2.6rem);margin:.3em 0}}
h2{{font-family:{DISP_STACK};text-transform:uppercase;letter-spacing:.05em;font-size:1.1rem;color:#8FA598;margin:1.8em 0 .5em}}
a{{color:#7FD1A8}}table{{border-collapse:collapse;width:100%;max-width:720px;margin:18px 0}}
td,th{{padding:7px 10px;border-bottom:1px solid #24352C;text-align:left;font-size:.92rem}}
th{{color:#8FA598;text-transform:uppercase;font-size:.72rem;letter-spacing:.06em}}
.cta{{display:inline-block;background:#C77F1E;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:700;margin:10px 0}}
p.note{{color:#8FA598;font-size:.85rem;max-width:60em}}
.lead{{font-size:1.06rem;max-width:44em;line-height:1.6}}
.crumbs{{font-size:.82rem;color:#8FA598;margin:0 0 4px}}.crumbs a{{color:#8FA598}}
dl.faq{{max-width:52em}}dl.faq dt{{font-weight:700;margin:14px 0 4px}}
dl.faq dd{{margin:0;color:#B8C7BD}}"""


def page_head(title, desc, path, ld, style, og_alt=None):
    S.check_title(title, path)
    return f"""<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
{S.ICONS}
<title>{html.escape(title)}</title>
<meta name="description" content="{html.escape(desc, quote=True)}">
<link rel="canonical" href="{SITE}{path}">
{S.og_tags(title, desc, path, S.OG_DEFAULT, og_alt or title)}
<script type="application/ld+json">{ld}</script>
<style>{style}</style>
<script src="/js/rxi-a.js?v={VTOKEN}" defer></script>
</head><body>"""


DOC_HEADER = ('<header><a class="mark disp" href="/">Ranked XI</a>'
              '<a href="/app" style="color:var(--dim);font-size:.85rem">Open the app &rarr;</a>'
              '</header>\n<main>')
DOC_FOOTER = ('</main>\n<footer>Independent project by Jeremy Kientz &middot; 2026 &middot; '
              '<a href="/">Home</a> &middot; <a href="/app">App</a> &middot; '
              '<a href="/about">About</a> &middot; <a href="/faq">FAQ</a> &middot; '
              '<a href="/methodology">Methodology</a> &middot; <a href="/privacy">Privacy</a> '
              '&middot; <a href="/terms">Terms &amp; notices</a></footer>\n</body></html>')


def write(fname, body):
    open(os.path.join(ROOT, fname), 'w').write(body)
    print(f'  {fname}')


# ================================================= UPSL / NPSL ranking pages
# These two URLs are the whole point of the site's amateur wedge: neither
# league publishes a national table, so "UPSL national rankings 2026" currently
# returns conference standings and a Reddit thread asking for exactly this.
PAGES = [
    ('upsl', 'upsl-rankings.html',
     'UPSL Rankings 2026 — every club on one national table | Ranked XI',
     'National UPSL rankings 2026: every United Premier Soccer League club rated on one '
     'cross-league table, updated from real division standings. See where any UPSL side '
     'ranks nationally — against NPSL, USL League Two and the whole US pyramid.'),
    ('npsl', 'npsl-rankings.html',
     'NPSL Rankings 2026 — every club on one national table | Ranked XI',
     'NPSL national rankings 2026: all National Premier Soccer League clubs rated by '
     'match-by-match Elo from real league results, on one table with the whole US soccer '
     'pyramid — compare NPSL vs UPSL directly.'),
]

nat_pool = sorted(rated_m, key=lambda c: -c['r'])
nat_rank_m = {c['id']: i + 1 for i, c in enumerate(nat_pool) if c.get('id')}

for g, fname, title, desc in PAGES:
    pool = sorted([c for c in clubs if c['g'] == g and c.get('r')],
                  key=lambda c: (0 if c.get('rr') else 1, -c['r']))
    label = lg_label(g)
    rows = ''.join(
        f"<tr><td>{i + 1 if c.get('rr') else '—'}</td>"
        f"<td>{'<a href=/club/' + c['id'] + '>' if c.get('id') else ''}{html.escape(c['n'])}"
        f"{'</a>' if c.get('id') else ''}</td>"
        f"<td>{html.escape(c.get('st', ''))}</td><td>{c['r']}</td>"
        f"<td>{'#' + str(nat_rank_m[c['id']]) if c.get('id') in nat_rank_m else '—'}</td></tr>"
        for i, c in enumerate(pool[:100]))
    src_note = ('Ratings from real division standings (points + goal difference), updated as '
                'tables move.' if g == 'upsl' else
                'Ratings from a match-by-match Elo walk over every scored 2026 NPSL result — '
                'backtested and calibrated (Brier 0.531 vs 0.667 uniform baseline).')
    top = pool[0]
    lead = (f'<p class="lead"><strong>{label} has {len(pool)} rated clubs on the Ranked XI '
            f'national table — one table, not {"a dozen division tables" if g == "upsl" else "fourteen conference tables"}.</strong> '
            f'{label} does not publish a national ranking; this is that ranking, built on the '
            f'same scale as MLS, USL and college soccer, so a {label} side and a professional '
            f'club are directly comparable. Top of {label} right now: '
            f'<strong>{html.escape(top["n"])}</strong> at <strong>{top["r"]}</strong>'
            + (f', #{nat_rank_m[top["id"]]} of {N["ratedm"]} rated men’s clubs in the country'
               if top.get('id') in nat_rank_m else '') +
            f'. Updated {today_h}.</p>')

    faq = [
        (f'Does {label} publish a national ranking?',
         f'No. {label} publishes division and conference standings. Ranked XI builds the '
         f'national table by rating all {len(pool)} rated {label} clubs on one scale that also '
         f'covers MLS, USL, NPSL and college soccer.'),
        (f'How are {label} clubs rated?',
         src_note + ' Cross-league placement is calibrated on roughly 600 U.S. Open Cup results.'),
        (f'Can a {label} club rate above a professional club?',
         'Yes, and some do. The scale is calibrated on Open Cup results, where amateur sides '
         'genuinely beat professional ones, so the table reflects that rather than assuming a '
         'league hierarchy.'),
    ]
    crumbs = [('Ranked XI', '/'), ('Leagues', '/us-soccer-pyramid'), (f'{label} rankings', None)]
    # Dataset creator read "Rank XI" here — a fourth name for the same entity,
    # on the two pages most likely to be quoted (audit finding, section 5).
    dataset = {'@type': 'Dataset', '@id': f'{SITE}/{fname[:-5]}#dataset',
               'name': title.split(' | ')[0], 'description': desc,
               'url': f'{SITE}/{fname[:-5]}', 'dateModified': today,
               'creator': {'@id': S.ORG_ID}, 'publisher': {'@id': S.ORG_ID},
               'license': 'https://creativecommons.org/licenses/by-sa/4.0/',
               'isAccessibleForFree': True,
               'variableMeasured': [
                   {'@type': 'PropertyValue', 'name': 'Ranked XI rating',
                    'description': 'Elo-style club strength rating on one national scale'},
                   {'@type': 'PropertyValue', 'name': 'National rank',
                    'description': 'Position among all rated US clubs of the same sex'}]}
    ld = S.graph(S.organization(), S.website(), dataset,
                 S.breadcrumb(crumbs), S.faq_page(faq))
    stem = fname[:-len('.html')]
    page = (page_head(title, desc, f'/{stem}', ld, DARK_STYLE,
                      f'{label} national rankings 2026 on Ranked XI') + f"""
{S.crumbs_html(crumbs)}
<h1>{html.escape(title.split('—')[0].strip())}</h1>
{lead}
<a class="cta" href="/app#/table">Open the full interactive table →</a>
<h2>{html.escape(label)} national table — top 100</h2>
<table><thead><tr><th>#</th><th>Club</th><th>State</th><th>Rating</th>
<th>National</th></tr></thead><tbody>{rows}</tbody></table>
<p class="note">{src_note} Top 100 shown — the app has every club, the map, head-to-head
predictions and player stats. Not affiliated with the league; data from public sources
with attribution in the app.</p>
<a class="cta" href="/app#/map">Explore the national map →</a>
<h2>Where {html.escape(label)} sits</h2>
<p class="note"><a href="/us-soccer-pyramid">The US soccer pyramid, ranked</a> ·
<a href="/methodology">How the ratings work</a> · <a href="/faq">FAQ</a> ·
<a href="/about">About Ranked XI</a></p>
{S.faq_html(faq, f'{label} rankings — common questions')}
</body></html>""")
    write(fname, page)
    print(f'    {len(pool)} clubs, top 100 rendered')

# =========================================================== /us-soccer-pyramid
# Wikipedia owns the diagram of the American league system. It cannot rank it.
# This page is the diagram with our numbers in it, which is the one thing an AI
# engine asked "how do US soccer leagues compare" cannot get anywhere else.
#
# The tier structure is parsed out of app.js rather than restated, so the page
# cannot drift from the Tiers screen users see in the product.
def parse_tiers():
    block = re.search(r'const TIERS = (\{.*?\n\};)', _app_src, re.S).group(1).rstrip(';')
    block = re.sub(r'/\*.*?\*/', '', block, flags=re.S)      # strip JS comments
    strings = []

    def stash(m):
        strings.append(m.group(1))
        return f'"@@{len(strings) - 1}@@"'

    block = re.sub(r"'((?:[^'\\]|\\.)*)'", stash, block)      # protect strings
    block = re.sub(r'([{,]\s*)([A-Za-z_]\w*)\s*:', r'\1"\2":', block)   # quote keys
    block = re.sub(r',(\s*[}\]])', r'\1', block)              # trailing commas
    data = json.loads(block)

    def restore(x):
        if isinstance(x, str):
            m = re.fullmatch(r'@@(\d+)@@', x)
            return strings[int(m.group(1))].replace("\\'", "'") if m else x
        if isinstance(x, list):
            return [restore(i) for i in x]
        if isinstance(x, dict):
            return {k: restore(v) for k, v in x.items()}
        return x

    return restore(data)


_app_src = open(os.path.join(ROOT, 'js', 'app.js')).read()
TIERS = parse_tiers()

by_league = {}
for c in rated:
    by_league.setdefault(c['g'], []).append(c)
for pool in by_league.values():
    pool.sort(key=lambda c: -c['r'])


def league_row(g):
    pool = by_league.get(g, [])
    if not pool:
        return None
    mid = pool[len(pool) // 2]['r']
    return {'g': g, 'label': lg_label(g), 'n': len(pool),
            'top': pool[0], 'median': mid}


def tier_block(tier, sex):
    rows = [r for r in (league_row(g) for g in tier.get('leagues', []) or []) if r]
    rows += [r for r in (league_row(g) for g in tier.get('extra', []) or []) if r]
    if not rows and not tier.get('coming'):
        return ''
    rows.sort(key=lambda r: -r['median'])
    tbl = ''
    if rows:
        body = ''.join(
            f'<tr><td><a href="/league/{r["g"]}">{html.escape(r["label"])}</a></td>'
            f'<td class="n">{r["n"]}</td><td class="n">{r["median"]}</td>'
            f'<td><a href="/club/{r["top"]["id"]}">{html.escape(r["top"]["n"])}</a> '
            f'({r["top"]["r"]})</td></tr>' for r in rows)
        tbl = (f'<table><thead><tr><th>League</th><th class="n">Rated clubs</th>'
               f'<th class="n">Median rating</th><th>Strongest club</th></tr></thead>'
               f'<tbody>{body}</tbody></table>')
    coming = ''
    if tier.get('coming'):
        names = [c if isinstance(c, str) else c.get('label', '') for c in tier['coming']]
        coming = (f'<p class="note">Not yet rated here: '
                  f'{html.escape(", ".join(n for n in names if n))}.</p>')
    note = f'<p class="note">{html.escape(tier["note"])}</p>' if tier.get('note') else ''
    pro = ' · professional' if tier.get('pro') else ''
    return (f'<div class="tier"><h3>{html.escape(tier["t"])}{pro}</h3>{tbl}{note}{coming}</div>')


pyr_title = 'The US Soccer Pyramid, Ranked (2026) | Ranked XI'
pyr_desc = (f'Every tier of American soccer — MLS down to regional amateur, plus college and '
            f'the women\'s pyramid — with the median Ranked XI rating of each league, so the '
            f'levels can be compared by number instead of by diagram. {N["rated"]} rated clubs, '
            f'updated {today_h}.')
pyr_lead = (f'<p class="lead"><strong>American soccer has no promotion or relegation, so its '
            f'"pyramid" is a set of sanctioned divisions plus a much larger amateur and college '
            f'game that sits outside them.</strong> Ranked XI rates {N["rated"]} clubs '
            f'({N["ratedm"]} men’s, {N["ratedw"]} women’s) across {N["leagues"]} leagues on a '
            f'single Elo-style scale, so the tiers below can be compared by median rating rather '
            f'than by where they sit on a chart. Cross-league placement is calibrated on roughly '
            f'600 U.S. Open Cup results. Updated {today_h}.</p>')

pyr_faq = [
    ('What is the US soccer pyramid?',
     'It is the structure of American league soccer: U.S. Soccer sanctions Division I, II and III '
     'for professional men\'s leagues, and Division I for professional women\'s leagues. Below '
     'and alongside those sit national amateur leagues, regional leagues, and the college game. '
     'There is no promotion or relegation between them.'),
    ('Which league is the top division in the United States?',
     'MLS is Division I for men. NWSL is Division I for women. USL Championship is Division II '
     'for men, and USL League One and MLS Next Pro are Division III.'),
    ('How can college soccer be compared to professional leagues?',
     'College teams never play in the U.S. Open Cup, so no real cross-league results anchor them. '
     'Ranked XI orders college divisions by independent Massey ratings and places them in '
     'calibrated bands — men\'s below the USL Championship floor, women\'s higher, because '
     'college is the women\'s game\'s primary development tier.'),
    ('Is a higher tier always a stronger club?',
     'No. The tables below show median ratings, and the ranges overlap. A strong national-amateur '
     'club can rate above a weak Division III professional side, which is what Open Cup results '
     'show when those clubs actually meet.'),
]
pyr_crumbs = [('Ranked XI', '/'), ('The US soccer pyramid', None)]
pyr_ld = S.graph(
    S.organization(), S.website(),
    {'@type': 'Article', '@id': f'{SITE}/us-soccer-pyramid#article',
     'headline': 'The US soccer pyramid, ranked',
     'description': pyr_desc, 'datePublished': '2026-08-23', 'dateModified': today,
     'author': {'@id': S.FOUNDER_ID}, 'publisher': {'@id': S.ORG_ID},
     'isPartOf': {'@id': S.SITE_ID},
     'mainEntityOfPage': f'{SITE}/us-soccer-pyramid'},
    S.breadcrumb(pyr_crumbs), S.faq_page(pyr_faq))

men_blocks = ''.join(tier_block(t, 'm') for t in TIERS['m'])
women_blocks = ''.join(tier_block(t, 'w') for t in TIERS['w'])
write('us-soccer-pyramid.html', page_head(
    pyr_title, pyr_desc, '/us-soccer-pyramid', pyr_ld, DOC_STYLE,
    'The US soccer pyramid ranked by median club rating') + f"""
{DOC_HEADER}
{S.crumbs_html(pyr_crumbs)}
<h1 class="disp">The US soccer pyramid, ranked</h1>
<p class="sub">Every tier, with the median rating of each league · {N['rated']} rated clubs ·
ratings computed {today_h} · method last changed {METHOD_CHANGED}</p>
{pyr_lead}
<div class="toc"><b>On this page</b><ul>
<li><a href="#men">The men's pyramid</a></li>
<li><a href="#women">The women's pyramid</a></li>
<li><a href="#how">How the tiers are compared</a></li>
<li><a href="#faq">Common questions</a></li></ul></div>
<section id="men"><h2>The men's pyramid</h2>
<p>Leagues are ordered inside each tier by median rating, not by name. "Median" is the middle
club, which describes a league better than its best club does.</p>
{men_blocks}</section>
<section id="women"><h2>The women's pyramid</h2>
<p>The women's game has one sanctioned professional division today, a second launching, and a
college tier that carries far more of the development load than it does on the men's side.</p>
{women_blocks}</section>
<section id="how"><h2>How the tiers are compared</h2>
<p>Within a league, ratings are evidence: they come from results or standings. Between leagues
they are measured — league anchors come from roughly 600 cross-league U.S. Open Cup results
across the last five editions, the only competition where clubs from different tiers actually
play each other. On top of that anchor, a club's own Cup results move its own rating.</p>
<p>{html.escape(S.VS_CLUB_COEFFICIENT)}</p>
<p><a href="/methodology">Full methodology</a> · <a href="/faq">FAQ</a> ·
<a href="/about">About Ranked XI</a></p>
<a class="cta" href="/app#/tiers">See the pyramid in the app →</a></section>
<section id="faq">{S.faq_html(pyr_faq)}</section>
{DOC_FOOTER}""")

# ======================================================================= /faq
faq_pairs = [
    ('What is Ranked XI?',
     f'{S.ENTITY} It maps {N["clubs"]} clubs across {N["leagues"]} leagues and rates '
     f'{N["rated"]} of them — {N["ratedm"]} men\'s and {N["ratedw"]} women\'s — on a single '
     f'Elo-style scale, so a grassroots side and an MLS club can be compared directly.'),
    ('How are the ratings built?',
     'League results feed a weekly Elo rating per club. Cup competitions — U.S. Open Cup '
     'qualifying and the National Amateur Cup — are where leagues actually meet, and roughly '
     '600 cross-league Cup results from the last five editions calibrate the gaps between '
     'levels. Every rating labels its basis on the page where it appears.'),
    ('What do the four basis labels mean?',
     'Real results means Elo computed over that club\'s actual matches. Real standings means the '
     'division publishes a table but not usable match results, so the rating is fitted to points '
     'and goal difference. Independent results model means a third party (primarily Massey '
     'Ratings) ran the math on real games and we mapped that ordering onto our scale. '
     'Illustrative means no feed is connected yet and the number demonstrates the product, not '
     'the club.'),
    ('Are men\'s and women\'s clubs ranked together?',
     'No. They are rated on the same scale but ranked in separate tables, because they do not '
     f'play each other. There are {N["ratedm"]} rated men\'s clubs and {N["ratedw"]} rated '
     f'women\'s clubs.'),
    ('How can an amateur club rate above a professional one?',
     'Because the scale is calibrated on U.S. Open Cup results, where amateur clubs genuinely do '
     'beat professional ones. The table reports what the results show rather than assuming a '
     'league hierarchy holds.'),
    ('Is Ranked XI affiliated with MLS, U.S. Soccer or any league?',
     'No. Ranked XI is an independent project by Jeremy Kientz. It is not affiliated with, '
     'endorsed by, or sponsored by any league, club or federation shown. Club and league names '
     'and crests belong to their owners and appear for identification only.'),
    ('Why is my club listed but not rated?',
     f'{format(COUNTS["clubs"] - COUNTS["rated"], ",")} mapped clubs carry no rating because '
     f'their division publishes no standings or results we can verify. Ranked XI labels that gap '
     f'rather than inventing a number. A rating appears automatically once a usable table exists.'),
    ('How often do the ratings update?',
     'Data refreshes run twice daily and the static pages are regenerated on each deploy. Every '
     f'club, league and state page carries the date its figures were computed — currently '
     f'{today_h}.'),
    ('Are the match probabilities betting advice?',
     'No. Probabilities are statistical estimates for entertainment and analysis. Ranked XI takes '
     'no wagers and no commissions, and nothing on the site is betting advice.'),
    ('Do you publish data about minors?',
     'No. Youth league entries are organization listings only — name, league and location from '
     'what the league publishes. Youth clubs carry no ratings, no fixtures and no player data, '
     'and Ranked XI never publishes personal information about minors.'),
    ('How is this different from Club Coefficient or Transfermarkt?',
     S.VS_CLUB_COEFFICIENT + ' Transfermarkt and FBref cover professional players and squad '
     'values; they do not rank the US amateur pyramid or the college game at all.'),
    ('How do I get a correction, a crest removed, or a club page taken down?',
     f'Email {S.CONTACT}. Corrections from a source we can check usually ship within a couple of '
     f'days; removal requests are confirmed as coming from the club or player and then actioned, '
     f'usually within the week. Crests and images come down first. See the terms page for the '
     f'full notice process.'),
]
faq_crumbs = [('Ranked XI', '/'), ('FAQ', None)]
faq_title = 'Ranked XI FAQ — how US soccer clubs are ranked | Ranked XI'
faq_desc = ('Answers to the twelve questions asked most about Ranked XI: what it is, how the '
            'cross-league ratings are built, what each basis label means, why some clubs are '
            'unrated, and how to request a correction or removal.')
faq_ld = S.graph(S.organization(), S.website(), S.faq_page(faq_pairs),
                 S.breadcrumb(faq_crumbs))
write('faq.html', page_head(faq_title, faq_desc, '/faq', faq_ld, DOC_STYLE,
                            'Frequently asked questions about Ranked XI') + f"""
{DOC_HEADER}
{S.crumbs_html(faq_crumbs)}
<h1 class="disp">Frequently asked questions</h1>
<p class="sub">Ratings computed {today_h} · method last changed {METHOD_CHANGED}</p>
<p class="lead"><strong>{html.escape(S.ENTITY)}</strong> Below are the twelve questions that
come up most, answered in full — including the ones with awkward answers.</p>
{S.faq_html(faq_pairs, 'Questions')}
<section><h2>Still stuck?</h2>
<p>Email <a href="mailto:{S.CONTACT}">{S.CONTACT}</a>. A person reads every one.
See also <a href="/methodology">the full methodology</a>,
<a href="/us-soccer-pyramid">the ranked pyramid</a> and <a href="/about">about this project</a>.</p></section>
{DOC_FOOTER}""")

# ===================================================================== /about
about_crumbs = [('Ranked XI', '/'), ('About', None)]
about_title = 'About Ranked XI — who builds it and why | Ranked XI'
about_desc = ('Ranked XI is an independent project by Jeremy Kientz that puts every American '
              'soccer club, men\'s and women\'s, MLS to the grassroots, on one rating scale. '
              'Who makes it, what it is not, and how to reach a person.')
about_ld = S.graph(
    S.organization(), S.website(), S.application(),
    {'@type': 'Person', '@id': S.FOUNDER_ID, 'name': S.FOUNDER,
     'url': f'{SITE}/about', 'email': S.CONTACT,
     'jobTitle': 'Founder', 'worksFor': {'@id': S.ORG_ID},
     'description': 'Founder of Ranked XI, an independent national rating system for '
                    'American soccer clubs.'},
    {'@type': 'AboutPage', '@id': f'{SITE}/about#page', 'url': f'{SITE}/about',
     'name': 'About Ranked XI', 'description': about_desc,
     'dateModified': today, 'about': {'@id': S.ORG_ID},
     'isPartOf': {'@id': S.SITE_ID}},
    S.breadcrumb(about_crumbs))
write('about.html', page_head(about_title, about_desc, '/about', about_ld, DOC_STYLE,
                              'About Ranked XI and its founder') + f"""
{DOC_HEADER}
{S.crumbs_html(about_crumbs)}
<h1 class="disp">About Ranked XI</h1>
<p class="sub">Independent · no ads · no trackers · ratings computed {today_h}</p>
<p class="lead"><strong>{html.escape(S.ENTITY)}</strong> It maps {N['clubs']} clubs across
{N['leagues']} leagues and rates {N['rated']} of them — {N['ratedm']} men's and {N['ratedw']}
women's — on a single Elo-style scale, with every rating labelled by what it is actually
based on.</p>
<section><h2>Why it exists</h2>
<p>American soccer has no promotion or relegation, and no single table. MLS publishes MLS
standings. UPSL publishes division standings. NPSL publishes conference standings. The NCAA
publishes its own. Nobody publishes the one number a fan actually wants: where does <em>my</em>
club sit against everyone else's?</p>
<p>That question has a real answer, because clubs from different tiers do meet — in the U.S.
Open Cup and the National Amateur Cup. Roughly 600 of those cross-league results over five
editions are enough to calibrate the gaps between levels. Ranked XI is that calibration,
applied to every club we can find.</p></section>
<section><h2 id="jeremy-kientz">Who builds it</h2>
<p>Ranked XI is built by <strong>{S.FOUNDER}</strong>, a producer and director based in
Southern California, and published by {S.LEGAL_NAME}. It is a solo independent project, not a
league product and not a media company's side project. The method is published in full at
<a href="/methodology">Methodology &amp; Disclaimer</a>, including the parts that are estimates
rather than measurements — because a rating you cannot audit is not worth quoting.</p>
<p>Reach a person at <a href="mailto:{S.CONTACT}">{S.CONTACT}</a>.</p></section>
<section><h2>What Ranked XI is not</h2>
<ul>
<li><strong>Not official.</strong> Not affiliated with, endorsed by, or sponsored by any league,
club or federation. Names and crests belong to their owners and appear for identification only.</li>
<li><strong>Not betting advice.</strong> Match probabilities are statistical estimates. Ranked XI
takes no wagers and no commissions.</li>
<li><strong>Not a youth database.</strong> Youth clubs are organization listings only. No youth
ratings, no youth fixtures, no personal information about minors, ever.</li>
<li><strong>Not ad-supported.</strong> No advertising pixels and no third-party trackers.
Pageviews are counted on our own servers without recording who you are.</li>
</ul></section>
<section><h2>How it compares</h2>
<p>{html.escape(S.VS_CLUB_COEFFICIENT)}</p>
<p><a href="/us-soccer-pyramid">See the whole pyramid ranked</a> ·
<a href="/faq">FAQ</a> · <a href="/terms">Terms &amp; notices</a></p>
<a class="cta" href="/app">Open the app →</a></section>
{DOC_FOOTER}""")

# ===================================================================== /terms
# A crawlable copy of the app's legal screen (#/legal). Hash URLs are not
# indexable documents, so the site's terms were invisible to search and to any
# AI engine asked "what are Ranked XI's terms" (audit, section 6).
terms_crumbs = [('Ranked XI', '/'), ('Terms & notices', None)]
terms_title = 'Terms, Privacy & Notices — Ranked XI'
terms_desc = ('Ranked XI terms in plain language: what the site is, where the data comes from, '
              'how to request a club crest or player removal, how to file a correction, the '
              'privacy position, and the accessibility commitment.')
terms_ld = S.graph(
    S.organization(), S.website(),
    {'@type': 'WebPage', '@id': f'{SITE}/terms#page', 'url': f'{SITE}/terms',
     'name': 'Terms, Privacy & Notices', 'description': terms_desc,
     'dateModified': today, 'publisher': {'@id': S.ORG_ID},
     'isPartOf': {'@id': S.SITE_ID}},
    S.breadcrumb(terms_crumbs))
MAILTO = f'mailto:{S.CONTACT}?subject='
write('terms.html', page_head(terms_title, terms_desc, '/terms', terms_ld, DOC_STYLE,
                              'Ranked XI terms, privacy and notices') + f"""
{DOC_HEADER}
{S.crumbs_html(terms_crumbs)}
<h1 class="disp">Terms, Privacy &amp; Notices</h1>
<p class="sub">The plain-language version · last reviewed {today_h}</p>
<p class="lead"><strong>Ranked XI is an independent guide to American soccer.</strong> It is not
affiliated with, endorsed by, or sponsored by any league, club, or federation shown. This page
and <a href="/methodology">Methodology &amp; Disclaimer</a> are the policy; material changes are
dated there.</p>
<section><h2>Where the data comes from</h2>
<p>Club, roster and historical data is gathered from what the leagues themselves publish —
league websites and public feeds — plus Wikipedia (CC BY-SA), American Soccer Analysis, and
OpenStreetMap. We organize that information; we don't control it at the source. If a league's
published table is wrong, ours will be too until someone tells us. Ratings label their basis:
real results, real standings, an independent results model, or illustrative.</p></section>
<section><h2>Removal requests</h2>
<p>Club and league names and crests belong to their owners and appear here for identification
only — shown small, next to the club's own public information, never as a claim of affiliation
or endorsement. If you'd rather your club, crest, or player info not appear on Ranked XI, one
email does it. We confirm the request actually comes from the club or the player — a reply from
an official club account or league contact is enough — then take it down, usually within the
week. Crests and images come down first.</p>
<p><a href="{MAILTO}RankedXI%20Removal:%20club%20/%20crest"><b>Remove my club or crest</b></a> ·
<a href="{MAILTO}RankedXI%20Removal:%20player"><b>Remove my player info</b></a></p></section>
<section><h2>Corrections &amp; missing info</h2>
<p>See something wrong, or something that should be here and isn't? File a notice. A person
reads every one, and most data corrections ship within a couple of days. A link to a source we
can check speeds it up.</p>
<p><a href="{MAILTO}RankedXI%20Notice:%20correction"><b>File a correction notice</b></a></p></section>
<section><h2>Privacy</h2>
<p>No tracking cookies, no third-party trackers and no advertising pixels. We count pageviews on
our own servers without recording who you are, and we honor Do Not Track. Your favorites live in
your browser's local storage and following a club still sends us nothing; we hold a copy only if
you choose to save your XI to an email address, which is optional, passwordless and off by
default. The only address we hold is one you typed in yourself (13 and older, unsubscribe in
every send). We never sell or share it. <a href="/privacy">Full privacy policy</a>.</p></section>
<section><h2>Predictions</h2>
<p>Probabilities are statistical estimates for entertainment and analysis. They are not betting
advice, and Ranked XI takes no wagers and no commissions on anything. Ratings and probabilities
describe teams and organizations, never individual athletes.</p></section>
<section><h2>Illustrative data</h2>
<p>Anything wearing the dashed <em>Illustrative</em> tag demonstrates the product, not the club.
Real results, standings and stats always say what they're based on.</p></section>
<section><h2>Youth clubs</h2>
<p>Youth league entries are organization listings only — name, league, and location from what
the league publishes. Youth clubs carry no ratings, no fixtures, and no player data, and we
never publish personal information about minors.</p></section>
<section><h2>Free agents &amp; claims</h2>
<p>Listings are self-reported by players; verified badges mark only what we can check against
league data. Clubs contact players directly — Ranked XI is never party to any deal. Listings are
restricted to players 18 and older, are submitted by email, and are human-reviewed before
publication. Any listing can be reported from its page; reported listings come down pending
review.</p></section>
<section><h2>Accessibility</h2>
<p>Ranked XI aims for WCAG 2.1 AA. The app is built to work with keyboards and screen readers:
every club is reachable through search, the National Table, and the Tiers pages — never only
through the map — and anything the map does has a text equivalent. If you hit a barrier, tell us
the page and what got in the way; accessibility reports get fixed like any other correction,
usually within days.</p>
<p><a href="{MAILTO}RankedXI%20Accessibility%20barrier"><b>Report an accessibility barrier</b></a></p></section>
{DOC_FOOTER}""")

# ---- bake headline counts into index.html / app.html (external audit #6) ----
# The landing page used to import data.js + rosters.js at runtime — 240KB over
# the wire and ~1.25MB parsed — to print three numbers. Baking them here keeps
# the landing payload near zero and gives every surface the same figures.
for fname in ('index.html', 'app.html'):
    path = os.path.join(ROOT, fname)
    page = open(path).read()
    for key, value in COUNTS.items():
        page = re.sub(f'(data-stat="{key}">)[^<]*',
                      lambda m, v=value: m.group(1) + format(v, ','), page)
    # og:description is what crawlers and every social unfurl read; app.html
    # carried a hand-written "3,900+" there and in the pre-hydration
    # placeholder long after the database passed 4,285, so the three surfaces
    # disagreed with each other. Both are derived here now.
    page = re.sub(r'([\d,]+)\+? clubs from MLS to the grassroots',
                  f"{COUNTS['clubs']:,} clubs from MLS to the grassroots", page)
    open(path, 'w').write(page)
# methodology.html states two dates - when the METHOD last changed (hand-edited,
# rare) and when the RATINGS were last computed (every deploy). Only the second
# is baked, so the page can never claim the policy changed because data moved.
mpath = os.path.join(ROOT, 'methodology.html')
mpage = open(mpath).read()
mpage = re.sub(r'(data-stat="updated">)[^<]*', lambda m: m.group(1) + today_h, mpage)
open(mpath, 'w').write(mpage)
print(f'methodology.html ratings-date stamped: {today_h}')

print(f"index.html + app.html counts baked: {N['clubs']} mapped · {N['rated']} rated "
      f"({N['ratedm']} men's, {N['ratedw']} women's) · {N['statlines']} stat lines · "
      f"{N['leagues']} leagues")
