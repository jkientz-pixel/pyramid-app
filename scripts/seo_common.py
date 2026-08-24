#!/usr/bin/env python3
"""One definition of who Ranked XI is, shared by every generator.

The 23 Aug 2026 SEO/AEO audit's first finding was that the site answers to four
names: the brand is "Ranked XI", the Dataset schema said "Rank XI", the Play
Store publisher is The Delegate, Inc., and the footer says Jeremy Kientz. AI
engines and Google's Knowledge Graph reconcile entities by cross-reference, so
a fuzzy entity gets no card and no citation. Everything an engine reads the
name, the logo, the description or the publisher from now comes from here.

Also holds the pieces every template kept re-deriving slightly differently:
the <head> builder (canonical + full OG/Twitter + real favicon), the
BreadcrumbList and FAQPage builders, and the answer-first lead helper.
"""
import html
import json

SITE = 'https://www.rankedxi.com'

# The canonical entity sentence. Byte-identical wherever a description is asked
# for — schema, meta, manifest, Play Store, social bios. Repetition across
# surfaces is exactly how an engine decides two mentions are one entity.
ENTITY = ("Ranked XI is the national table of American soccer: every club from "
          "MLS to the grassroots, men's and women's, ranked on one scale.")

BRAND = 'Ranked XI'
LEGAL_NAME = 'The Delegate, Inc.'   # Play Store publisher — reconciled, not swapped
FOUNDER = 'Jeremy Kientz'
CONTACT = 'hello@rankedxi.com'
PLAY_URL = 'https://play.google.com/store/apps/details?id=com.rankedxi.app'

ORG_ID = f'{SITE}/#organization'
SITE_ID = f'{SITE}/#website'
APP_ID = f'{SITE}/#app'
FOUNDER_ID = f'{SITE}/about#jeremy-kientz'

LOGO = f'{SITE}/icon-512.png'
OG_DEFAULT = f'{SITE}/og.png'
OG_W, OG_H = 1200, 630

# The one-line difference from the nearest peer. The audit called this a
# citation magnet: it is the sentence an engine can lift when asked "how is
# Ranked XI different from Club Coefficient".
VS_CLUB_COEFFICIENT = (
    "Club Coefficient scores men's clubs by multi-year honors and league "
    "strength. Ranked XI puts men's and women's, college included, on one "
    "current Elo-style scale, and labels whether each rating is real results, "
    "real standings, an independent model, or illustrative.")


def _person():
    return {'@type': 'Person', '@id': FOUNDER_ID, 'name': FOUNDER,
            'url': f'{SITE}/about'}


def organization():
    """The single Organization node. Every other node points at it by @id
    rather than restating a name that could drift."""
    return {
        '@type': 'Organization', '@id': ORG_ID, 'name': BRAND,
        'legalName': LEGAL_NAME, 'url': f'{SITE}/',
        'logo': {'@type': 'ImageObject', 'url': LOGO, 'width': 512, 'height': 512},
        'description': ENTITY, 'email': CONTACT,
        'founder': {'@id': FOUNDER_ID},
        # Only profiles that actually resolve. A sameAs pointing at a handle
        # that does not exist is a disambiguation signal aimed at nothing.
        'sameAs': [PLAY_URL],
    }


def website():
    # No SearchAction: the app has no #/search route, and a sitelinks search
    # box pointed at a URL that does not handle q= is a spam signal.
    return {'@type': 'WebSite', '@id': SITE_ID, 'url': f'{SITE}/', 'name': BRAND,
            'description': ENTITY, 'inLanguage': 'en-US',
            'publisher': {'@id': ORG_ID}}


def application():
    return {'@type': ['SoftwareApplication', 'SportsApplication'], '@id': APP_ID,
            'name': BRAND, 'applicationCategory': 'SportsApplication',
            'operatingSystem': 'Android, Web', 'description': ENTITY,
            'offers': {'@type': 'Offer', 'price': '0', 'priceCurrency': 'USD'},
            'downloadUrl': PLAY_URL, 'publisher': {'@id': ORG_ID}}


def breadcrumb(trail):
    """trail: [(name, path_or_None)]. The last crumb is the current page and
    carries no url, per Google's guidance."""
    items = []
    for i, (name, path) in enumerate(trail):
        item = {'@type': 'ListItem', 'position': i + 1, 'name': name}
        if path:
            item['item'] = f'{SITE}{path}'
        items.append(item)
    return {'@type': 'BreadcrumbList', 'itemListElement': items}


def faq_page(pairs):
    """pairs: [(question, answer_text)] — must match text visible on the page.
    FAQPage schema for answers a reader cannot see is a manual-action risk."""
    return {'@type': 'FAQPage', 'mainEntity': [
        {'@type': 'Question', 'name': q,
         'acceptedAnswer': {'@type': 'Answer', 'text': a}} for q, a in pairs]}


def faq_html(pairs, heading='Common questions'):
    """The visible half of faq_page(). Rendered as a definition list so the
    question/answer pairing survives text extraction by an AI crawler."""
    body = ''.join(f'<dt>{html.escape(q)}</dt><dd>{html.escape(a)}</dd>'
                   for q, a in pairs)
    return f'<h2>{html.escape(heading)}</h2><dl class="faq">{body}</dl>'


def graph(*nodes):
    """JSON-LD @graph. Nodes are emitted in one script tag so @id references
    resolve inside a single document rather than across tags."""
    return json.dumps({'@context': 'https://schema.org',
                       '@graph': [n for n in nodes if n]}, ensure_ascii=False)


def crumbs_html(trail):
    """Visible breadcrumb matching breadcrumb()'s schema. Text-only separator
    so a crawler reading the stripped text still sees the hierarchy."""
    parts = []
    for name, path in trail:
        parts.append(f'<a href="{path}">{html.escape(name)}</a>' if path
                     else f'<span aria-current="page">{html.escape(name)}</span>')
    return f'<nav class="crumbs" aria-label="Breadcrumb">{" · ".join(parts)}</nav>'


# Every page shares one favicon set. The emoji data-URI that used to sit here
# renders as a throwaway domain in a SERP and disagreed with the PWA icons the
# same page installs with.
ICONS = ('<link rel="icon" href="/icon-192.png" sizes="192x192" type="image/png">'
         '<link rel="icon" href="/icon-512.png" sizes="512x512" type="image/png">'
         '<link rel="apple-touch-icon" href="/apple-touch-icon.png">')


def og_tags(title, desc, path, img=OG_DEFAULT, img_alt=None, card=None,
            og_type='website', width=OG_W, height=OG_H):
    """The full unfurl block. og:url and og:site_name were missing on every
    page sampled in the audit — without og:url a share of a tokened or
    parameterised URL unfurls as a different document than the canonical."""
    card = card or ('summary_large_image' if img != OG_DEFAULT else 'summary_large_image')
    alt = img_alt or title
    e = lambda s: html.escape(str(s), quote=True)
    return (f'<meta property="og:title" content="{e(title)}">'
            f'<meta property="og:description" content="{e(desc)}">'
            f'<meta property="og:url" content="{SITE}{path}">'
            f'<meta property="og:site_name" content="{BRAND}">'
            f'<meta property="og:locale" content="en_US">'
            f'<meta property="og:type" content="{og_type}">'
            f'<meta property="og:image" content="{e(img)}">'
            f'<meta property="og:image:width" content="{width}">'
            f'<meta property="og:image:height" content="{height}">'
            f'<meta property="og:image:alt" content="{e(alt)}">'
            f'<meta name="twitter:card" content="{card}">'
            f'<meta name="twitter:title" content="{e(title)}">'
            f'<meta name="twitter:description" content="{e(desc)}">'
            f'<meta name="twitter:image" content="{e(img)}">'
            f'<meta name="twitter:image:alt" content="{e(alt)}">')


TITLE_MAX = 65   # beyond this Google truncates; preflight fails the build


def check_title(title, where):
    """Generators call this so an over-long title fails the build rather than
    shipping a truncated SERP line to thousands of pages."""
    if len(title) > TITLE_MAX:
        raise SystemExit(f'title too long ({len(title)} > {TITLE_MAX}) on {where}: {title}')
    return title
