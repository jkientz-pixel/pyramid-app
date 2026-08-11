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

def deacc(x): return unicodedata.normalize('NFKD', x).encode('ascii', 'ignore').decode()
def slugify(n): return re.sub(r'[^a-z0-9]+', '-', deacc(n).lower()).strip('-')

def toks(s):
    s = deacc(s).lower().replace('&amp;', 'and').replace('&', 'and')
    s = re.sub(r'\bst\.', 'state', s)          # Adams St. -> Adams State
    s = re.sub(r'\(.*?\)', ' ', s)             # drop (NY) style qualifiers
    return set(re.findall(r'[a-z0-9]+', s)) - STOP

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
    ct = toks(club_name)
    scored = []
    for s in schools:
        stt = s['_toks']
        if not stt: continue
        ov = len(stt & ct)
        if ov == 0 or ov < len(stt) - 1: continue   # allow one stray school token
        scored.append((ov, stt <= ct, s))
    if not scored: return None
    scored.sort(key=lambda x: (-x[0], -x[1]))
    if len(scored) > 1 and scored[0][:2] == scored[1][:2]:
        return 'AMBIG:' + scored[0][2]['slug'] + '/' + scored[1][2]['slug']
    return scored[0][2]

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
            m = best_school(c['n'], schools)
            if m is None:
                miss += 1; print(f"  - {c['n']}: no school match"); continue
            if isinstance(m, str):
                amb += 1; print(f"  ? {c['n']}: {m}"); continue
            svg = os.path.join(svgdir, m['slug'] + '.svg')
            if not os.path.exists(svg):
                try:
                    req = urllib.request.Request(LOGO.format(slug=m['slug']), headers=UA)
                    data = urllib.request.urlopen(req, timeout=30).read()
                    # ncaa.com soft-404s return HTML that contains inline <svg
                    # icons — the old sniff accepted those, Chromium showed the
                    # broken-image glyph, and 971 grey placeholders shipped.
                    head = data[:600].lstrip()
                    if b'<html' in head.lower() or not (head.startswith(b'<svg') or head.startswith(b'<?xml')):
                        raise Exception('not svg')
                    open(svg, 'wb').write(data)
                    time.sleep(0.3)
                except Exception as e:
                    miss += 1; print(f"  - {c['n']}: logo fetch failed ({m['slug']}: {e})"); continue
            fn = f"crests/{c['g']}-{slugify(c['n'])}.png"
            dest = os.path.join(ROOT, fn)
            try:
                # data: URI, not file:// — Chromium blocks file subresources
                # inside set_content pages, which turned every render into the
                # broken-image glyph (the root cause of the 971 placeholders)
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
            except Exception as e:
                miss += 1; print(f"  - {c['n']}: rasterize failed ({e})"); continue
            c['img'] = fn
            got += 1
            print(f"  + {c['n']} <- {m['slug']}.svg")
        browser.close()
    print(f'got {got}, missed {miss}, ambiguous {amb}')
    if got:
        write_clubs(clubs)

if __name__ == '__main__':
    main()
