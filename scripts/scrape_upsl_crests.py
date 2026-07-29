#!/usr/bin/env python3
"""UPSL crest scraper. Cloudflare blocks plain HTTP and headless Chromium, so
this drives a HEADFUL Chromium via Playwright (challenge clears in ~4s per
host, cookie then persists for the session).

Per subsite (premier/division1/division2 .upsl.com): scroll /teams/ to load
every card, cache links in data/upsl_team_links.json. Token-match link slugs
to upsl clubs missing a crest (ambiguity-guarded). Visit each matched team
page, read the .page__header--logo img, fetch its bytes with page.goto(...)
.body() (browser session carries the CF cookie), sips-resize to 128px.
Progress lands in js/data.js every 25 crests — rerunnable/resumable."""
from _datajs import load_clubs, write_clubs, ROOT
import json, os, re, subprocess, sys, time, unicodedata

SUBS = ['premier', 'division1', 'division2']
LINKS_CACHE = os.path.join(ROOT, 'data', 'upsl_team_links.json')
STOP = {'fc', 'sc', 'cf', 'afc', 'the', 'club', 'soccer', 'football', 'futbol', 'de'}

def deacc(x): return unicodedata.normalize('NFKD', x).encode('ascii', 'ignore').decode()
def slugify(n): return re.sub(r'[^a-z0-9]+', '-', deacc(n).lower()).strip('-')
def toks(s): return set(re.findall(r'[a-z0-9]+', deacc(s).lower())) - STOP

def cf_wait(page, tries=10):
    for _ in range(tries):
        if 'moment' not in (page.title() or '').lower():
            return True
        page.wait_for_timeout(3000)
    return False

def collect_links(pw):
    if os.path.exists(LINKS_CACHE):
        return json.load(open(LINKS_CACHE))
    b = pw.chromium.launch(headless=False)
    p = b.new_page()
    links = []
    for sub in SUBS:
        p.goto(f'https://{sub}.upsl.com/teams/', timeout=60000)
        if not cf_wait(p):
            print(f'  ! {sub}: stuck on Cloudflare, skipping'); continue
        p.wait_for_timeout(2000)
        prev = 0
        for _ in range(40):
            p.evaluate('window.scrollTo(0, document.body.scrollHeight)')
            p.wait_for_timeout(700)
            n = p.evaluate("document.querySelectorAll('a[href*=\"/teams/\"]').length")
            if n == prev: break
            prev = n
        got = p.eval_on_selector_all('a[href*="/teams/"]',
                                     'els=>[...new Set(els.map(e=>e.href))]')
        got = [u for u in got if '?' not in u and u.rstrip('/').split('/')[-1] != 'teams']
        print(f'  {sub}: {len(got)} team links')
        links += got
    b.close()
    json.dump(links, open(LINKS_CACHE, 'w'), indent=0)
    return links

def match_links(clubs, links):
    """club -> team-page URL via slug token match, ambiguity-guarded."""
    entries = []
    for u in links:
        s = re.sub(r'-\d+$', '', u.rstrip('/').split('/')[-1])
        entries.append({'url': u, 'toks': toks(s.replace('-', ' '))})
    out, ambig = {}, 0
    for c in clubs:
        ct = toks(c['n'])
        scored = []
        for e in entries:
            if not e['toks']: continue
            ov = len(ct & e['toks'])
            if not ov: continue
            score = ov / max(len(ct), len(e['toks']))
            scored.append((score, e))
        scored.sort(key=lambda x: -x[0])
        if not scored or scored[0][0] < 0.75: continue
        tied = [e for s, e in scored if s == scored[0][0]]
        urls = {e['url'] for e in tied}
        if len(urls) > 1:
            ambig += 1; print(f"  ? {c['n']}: ambiguous {sorted(urls)[:2]}"); continue
        out[c['id']] = scored[0][1]['url']
    print(f'matched {len(out)} clubs to team pages ({ambig} ambiguous)')
    return out

def main():
    from playwright.sync_api import sync_playwright
    clubs = load_clubs()
    todo = [c for c in clubs if c['g'] == 'upsl' and not c.get('img')]
    print(f'{len(todo)} upsl clubs missing crests')
    with sync_playwright() as pw:
        links = collect_links(pw)
        m = match_links(todo, links)
        b = pw.chromium.launch(headless=False)
        p = b.new_page()
        got = miss = 0
        for c in todo:
            url = m.get(c['id'])
            if not url:
                miss += 1; continue
            try:
                p.goto(url, timeout=60000)
                if not cf_wait(p): raise Exception('cloudflare stuck')
                src = p.eval_on_selector('.page__header--logo', 'e=>e.src')
                if not src: raise Exception('no logo img')
                r = p.goto(src, timeout=60000)
                if not cf_wait(p): raise Exception('cloudflare stuck on img')
                body = r.body()
                if len(body) < 500: raise Exception(f'tiny body {len(body)}')
                tmp = os.path.join(ROOT, 'crests', '_raw_tmp')
                open(tmp, 'wb').write(body)
                fn = f"crests/upsl-{slugify(c['n'])}.png"
                dest = os.path.join(ROOT, fn)
                subprocess.run(['sips', '-s', 'format', 'png', '-Z', '128', tmp, '--out', dest],
                               capture_output=True)
                if not (os.path.exists(dest) and os.path.getsize(dest) > 500):
                    raise Exception('sips produced nothing')
                c['img'] = fn
                got += 1
                print(f"  + {c['n']}")
                if got % 25 == 0:
                    write_clubs(clubs)
                    print(f'  ... checkpoint: {got} written to data.js')
            except Exception as e:
                miss += 1
                print(f"  - {c['n']}: {e}")
        b.close()
    print(f'got {got}, missed/skipped {miss}')
    if got:
        write_clubs(clubs)

if __name__ == '__main__':
    main()
