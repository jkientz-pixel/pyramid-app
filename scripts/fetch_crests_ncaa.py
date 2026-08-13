#!/usr/bin/env python3
"""NCAA crest fetcher. Crawls ncaa.com's schools index once (cached at
data/ncaa_schools.json), token-matches schools to ncaa1/ncaa2 clubs, downloads
the school SVG logo (images/logos/schools/bgl/<slug>.svg) and rasterizes it to
a 128px transparent PNG via Playwright Chromium (no SVG rasterizer on macOS by
default; sips can't read SVG). Only fills clubs with no img; idempotent."""
from _datajs import load_clubs, write_clubs, ROOT
import json, os, re, sys, time, unicodedata, urllib.request

UA = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 RankXI/1.0'}
IDX_CACHE = os.path.join(ROOT, 'data', 'ncaa_schools.json')
LOGO = 'https://www.ncaa.com/sites/default/files/images/logos/schools/bgl/{slug}.svg'
STOP = {'university', 'college', 'of', 'in', 'at', 'the', 'a', 'and', 'st'}

# clubs with no usable ncaa.com logo at any slug — never auto-match them, or
# the token matcher walks them into the nearest flagship's crest
NO_LOGO = {
    'West Texas A&M University Buffaloes',
    'Texas A&M University–Texarkana Eagles',
    "University of New England Nor'easters",
}

# ncaa.com index names use AP-style state abbreviations ("Northern Ill.",
# "Western Ky."); without expansion those tokens never meet the club's full
# name and the flagship ("Illinois") swallows the directional school.
AP_STATE = {'ala': 'alabama', 'ariz': 'arizona', 'ark': 'arkansas',
    'calif': 'california', 'colo': 'colorado', 'conn': 'connecticut',
    'del': 'delaware', 'fla': 'florida', 'ill': 'illinois', 'ind': 'indiana',
    'kan': 'kansas', 'ky': 'kentucky', 'md': 'maryland',
    'mass': 'massachusetts', 'mich': 'michigan', 'minn': 'minnesota',
    'miss': 'mississippi', 'mo': 'missouri', 'mont': 'montana',
    'neb': 'nebraska', 'nev': 'nevada', 'okla': 'oklahoma', 'ore': 'oregon',
    'pa': 'pennsylvania', 'tenn': 'tennessee', 'vt': 'vermont',
    'va': 'virginia', 'wash': 'washington', 'wis': 'wisconsin',
    'wyo': 'wyoming', 'caro': 'carolina'}

def deacc(x): return unicodedata.normalize('NFKD', x).encode('ascii', 'ignore').decode()
def slugify(n): return re.sub(r'[^a-z0-9]+', '-', deacc(n).lower()).strip('-')

def toks(s):
    s = deacc(s).lower().replace('&amp;', 'and').replace('&', 'and')
    s = re.sub(r'\bst\.', 'state', s)          # Adams St. -> Adams State
    s = re.sub(r'\(.*?\)', ' ', s)             # drop (NY) style qualifiers
    return {AP_STATE.get(t, t) for t in re.findall(r'[a-z0-9]+', s)} - STOP

def crawl_index():
    if os.path.exists(IDX_CACHE):
        return json.load(open(IDX_CACHE))
    schools, page = [], 0
    while page < 40:
        url = 'https://www.ncaa.com/schools-index' + (f'/{page}' if page else '')
        try:
            req = urllib.request.Request(url, headers=UA)
            html = urllib.request.urlopen(req, timeout=30).read().decode('utf-8', 'replace')
        except Exception as e:
            print(f'  index page {page}: {e}'); break
        rows = re.findall(r'href="/schools/([a-z0-9-]+)"[^>]*>([^<]{2,80})<', html)
        rows = [(s, n.strip()) for s, n in rows if n.strip()]
        if not rows: break
        schools += rows
        page += 1
        time.sleep(0.5)
    # de-dup (each school appears once as image link + once as name link)
    seen, out = set(), []
    for s, n in schools:
        if s not in seen:
            seen.add(s); out.append({'slug': s, 'name': n})
    json.dump(out, open(IDX_CACHE, 'w'), indent=0)
    print(f'crawled {page} pages, {len(out)} schools -> data/ncaa_schools.json')
    return out

def best_school(club_name, schools):
    """Match a club to a schools-index entry, or None / 'AMBIG:a/b'.

    Every school token must appear in the club name (no stray tokens), and a
    single-token school may only claim a club whose whole name is that short.
    The old matcher allowed one stray token and preferred subset matches,
    which let flagships swallow their neighbors: "Wisconsin" took Wisconsin
    Lutheran, "Milwaukee" (UW–Milwaukee) took Milwaukee School of Engineering,
    and "Illinois" took every directional Illinois school — while the real
    owners tied two ways and shipped no crest at all. Under-matching is the
    cheap failure here (apply_ncaa_overrides.py mops up); over-matching ships
    the wrong school's logo."""
    ct = toks(club_name)
    kind = lambda n: ('college' in n.lower() and 'university' not in n.lower() and 'college') or \
                     ('university' in n.lower() and 'college' not in n.lower() and 'university') or None
    ck = kind(club_name)
    scored = []
    for s in schools:
        stt = s['_toks']
        if not stt: continue
        ov = len(stt & ct)
        if ov < len(stt): continue        # school name fully inside club name
        if ov < 2 and len(ct) > 2: continue   # 1-token school, long club name
        sk = kind(s['name'])
        if ck and sk and ck != sk: continue   # Boston College is not Boston University
        scored.append((ov, s))
    if not scored: return None
    scored.sort(key=lambda x: -x[0])
    if len(scored) > 1 and scored[0][0] == scored[1][0]:
        return 'AMBIG:' + scored[0][1]['slug'] + '/' + scored[1][1]['slug']
    best = scored[0][1]
    # a leftover club token that near-completes ANOTHER school means the club
    # is probably that school under a name the index abbreviates (SIU
    # Edwardsville vs Southern Ill.) — punt to the override/resolve passes
    leftover = ct - best['_toks']
    for s2 in schools:
        st2 = s2['_toks']
        if s2 is best or not st2: continue
        if st2 & leftover and len(st2 & ct) >= len(st2) - 1:
            return 'AMBIG:' + best['slug'] + '/' + s2['slug']
    return best

def fetch_svg(slug, svgdir):
    """Download + cache a school SVG, rejecting ncaa.com's soft-404 HTML
    (it contains inline <svg icons, so sniff the head, not the body)."""
    svg = os.path.join(svgdir, slug + '.svg')
    if not os.path.exists(svg):
        req = urllib.request.Request(LOGO.format(slug=slug), headers=UA)
        data = urllib.request.urlopen(req, timeout=30).read()
        head = data[:600].lstrip()
        if b'<html' in head.lower() or not (head.startswith(b'<svg') or head.startswith(b'<?xml')):
            raise Exception('not svg')
        open(svg, 'wb').write(data)
        time.sleep(0.3)
    return svg

def rasterize_svg(page, svg, dest):
    """SVG -> 128px transparent PNG. data: URI, not file:// — Chromium
    blocks file subresources inside set_content pages, which turns every
    render into the broken-image glyph (root cause of the 971 grey
    placeholders, and again of 165 identical PNGs when the override/resolve
    passes kept their own file:// copy of this code)."""
    import base64
    uri = 'data:image/svg+xml;base64,' + base64.b64encode(open(svg, 'rb').read()).decode()
    page.set_content(f'<body style="margin:0"><img src="{uri}" '
                     'style="width:128px;height:128px;object-fit:contain"></body>')
    page.locator('img').screenshot(path=dest, omit_background=True)
    assert os.path.getsize(dest) > 500
    # a broken-image render is nearly all transparent — reject it
    from PIL import Image
    a = Image.open(dest).convert('RGBA').getchannel('A')
    opaque = sum(n for v, n in enumerate(a.histogram()) if v >= 200) / (a.width * a.height)
    if opaque < 0.10:
        os.remove(dest)
        raise Exception(f'placeholder render ({opaque:.0%} opaque)')
    # schools with no real logo get ncaa.com's generic mark — tiny SVGs that
    # all render to this exact PNG. Crestless beats generic.
    import hashlib
    if hashlib.md5(open(dest, 'rb').read()).hexdigest() == '59845c883ec9b2236febe3f6abb9b829':
        os.remove(dest)
        raise Exception('generic ncaa placeholder logo')

def main():
    from playwright.sync_api import sync_playwright
    schools = crawl_index()
    for s in schools:
        s['_toks'] = toks(s['name'])
    groups = tuple(sys.argv[1].split(',')) if len(sys.argv) > 1 else (
        'ncaa1', 'ncaa2', 'ncaa3', 'ncaa1w', 'ncaa2w')
    clubs = load_clubs()
    todo = [c for c in clubs if c['g'] in groups and not c.get('img')]
    print(f'{len(todo)} NCAA clubs missing crests')
    got = miss = amb = 0
    svgdir = os.path.join(ROOT, 'crests', '_svg_tmp')
    os.makedirs(svgdir, exist_ok=True)
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={'width': 160, 'height': 160})
        for c in todo:
            if c['n'] in NO_LOGO:
                miss += 1; continue
            m = best_school(c['n'], schools)
            if m is None:
                miss += 1; print(f"  - {c['n']}: no school match"); continue
            if isinstance(m, str):
                amb += 1; print(f"  ? {c['n']}: {m}"); continue
            fn = f"crests/{c['g']}-{slugify(c['n'])}.png"
            dest = os.path.join(ROOT, fn)
            try:
                svg = fetch_svg(m['slug'], svgdir)
                rasterize_svg(page, svg, dest)
            except Exception as e:
                miss += 1; print(f"  - {c['n']}: fetch/raster failed ({m['slug']}: {e})"); continue
            c['img'] = fn
            got += 1
            print(f"  + {c['n']} <- {m['slug']}.svg")
        browser.close()
    print(f'got {got}, missed {miss}, ambiguous {amb}')
    if got:
        write_clubs(clubs)

if __name__ == '__main__':
    main()
