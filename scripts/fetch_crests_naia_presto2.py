#!/usr/bin/env python3
"""NAIA crest sweep v2 via naiastats.prestosports.com.

v1 lessons baked in: the teams index is a paginated DataTable (expand every
table to All before scraping links, else coverage is whatever page 1 held),
and cdn.prestosports.com 403s any non-browser HTTP stack (Playwright's
request API included) — so each crest is captured by screenshotting the
rendered <img> on the team's own page, the same trick fetch_crests_ncaa.py
uses for SVGs. Presto team names carry a "(ST)" qualifier that breaks
same-name ties against the club's st field. Only fills missing img.
"""
from _datajs import load_clubs, write_clubs, ROOT
import json, os, re, subprocess, sys, time, unicodedata

PROFILE = os.path.expanduser('~/.cache/rankxi-naia-chrome')
INDEX = 'https://naiastats.prestosports.com/sports/msoc/2025-26/teams'
STOP = {'university', 'college', 'of', 'in', 'at', 'the', 'a', 'and'}


def deacc(x): return unicodedata.normalize('NFKD', x).encode('ascii', 'ignore').decode()
def slug(n): return re.sub(r'[^a-z0-9]+', '-', deacc(n).lower()).strip('-')


def toks(s):
    s = deacc(s).lower().replace('&', 'and')
    s = re.sub(r'\bst\.', 'saint', s)
    s = re.sub(r'\(.*?\)', ' ', s)
    return set(re.findall(r'[a-z0-9]+', s)) - STOP


def pstate(name):
    m = re.search(r'\(([A-Z]{2})\.?\)', name)
    return m.group(1) if m else None


def cf_wait(page, seconds=90):
    for _ in range(seconds // 3):
        if 'moment' not in (page.title() or '').lower():
            return True
        page.wait_for_timeout(3000)
    return False


def main():
    from playwright.sync_api import sync_playwright
    clubs = load_clubs()
    todo = [c for c in clubs if c['g'] == 'naia' and not c.get('img')]
    print(f'{len(todo)} NAIA clubs missing crests', flush=True)
    report = {'matched': [], 'unmatched': [], 'ambig': [], 'failed': []}
    got = 0
    with sync_playwright() as pw:
        ctx = pw.chromium.launch_persistent_context(PROFILE, headless=False)
        p = ctx.pages[0] if ctx.pages else ctx.new_page()
        p.goto(INDEX, timeout=90000)
        if not cf_wait(p):
            sys.exit('Cloudflare wall never cleared')
        p.wait_for_timeout(4000)
        # expand every DataTable to show all rows, then harvest links
        p.evaluate("""() => {
          if (window.jQuery && jQuery.fn.dataTable)
            jQuery('table.dataTable').each(function(){
              try { jQuery(this).DataTable().page.len(-1).draw(); } catch(e){} });
          for (const s of document.querySelectorAll('select[id^=dt-length]')) {
            const all = [...s.options].find(o => /all|-1/i.test(o.value + o.text));
            if (all) { s.value = all.value; s.dispatchEvent(new Event('change', {bubbles:true})); }
          }
        }""")
        p.wait_for_timeout(2500)
        teams = p.evaluate("""() => {
          const seen = {};
          for (const a of document.querySelectorAll('a[href*="/teams/"]')) {
            const name = a.textContent.trim();
            const href = a.getAttribute('href');
            if (name && name.length > 2 && href && !seen[name]) seen[name] = href;
          }
          return Object.entries(seen).map(([name, href]) => ({name, href}));
        }""")
        print(f'{len(teams)} teams on the expanded index', flush=True)
        for t in teams:
            t['_toks'] = toks(t['name'])
            t['_st'] = pstate(t['name'])
        for c in todo:
            ct = toks(c['n'])
            scored = []
            for t in teams:
                if not t['_toks']: continue
                ov = len(t['_toks'] & ct)
                if ov == 0 or ov < len(t['_toks']) - 1: continue
                sthint = 0 if t['_st'] is None else (1 if t['_st'] == c.get('st') else -1)
                scored.append(((ov, sthint), t))
            scored.sort(key=lambda x: x[0], reverse=True)
            if not scored or scored[0][0][1] < 0:
                report['unmatched'].append(c['n']); continue
            if len(scored) > 1 and scored[0][0] == scored[1][0]:
                report['ambig'].append({'club': c['n'],
                                        'cands': [scored[0][1]['name'], scored[1][1]['name']]})
                continue
            t = scored[0][1]
            url = 'https://naiastats.prestosports.com' + t['href'] if t['href'].startswith('/') else t['href']
            fn = f"crests/naia-{slug(c['n'])}.png"
            dest = os.path.join(ROOT, fn)
            try:
                p.goto(url, timeout=60000)
                if not cf_wait(p): raise Exception('cf wall')
                try:
                    img = p.wait_for_selector('img[src*="cdn/logos"]', timeout=12000)
                except Exception:
                    img = p.query_selector('.team-logo img, header img[alt*="ogo"], img[class*="logo"]')
                if not img: raise Exception('no logo img on team page')
                p.evaluate("(el) => { el.style.width='128px'; el.style.height='128px'; el.style.objectFit='contain'; }", img)
                p.wait_for_timeout(300)
                img.screenshot(path=dest, omit_background=True)
                if os.path.getsize(dest) < 400: raise Exception('empty screenshot')
                sub = subprocess.run(['sips', '-Z', '128', dest], capture_output=True)
                c['img'] = fn
                got += 1
                report['matched'].append({'club': c['n'], 'team': t['name']})
                print(f"  + {c['n']} <- {t['name']}", flush=True)
            except Exception as e:
                report['failed'].append({'club': c['n'], 'team': t['name'], 'why': str(e)[:80]})
                print(f"  - {c['n']}: {str(e)[:60]}", flush=True)
            time.sleep(3.0)
        ctx.close()
    json.dump(report, open(os.path.join(ROOT, 'data', 'naia_presto_report.json'), 'w'), indent=1)
    print(f"got {got}; unmatched {len(report['unmatched'])}, ambig {len(report['ambig'])}, "
          f"failed {len(report['failed'])}", flush=True)
    if got:
        write_clubs(clubs)


if __name__ == '__main__':
    main()
