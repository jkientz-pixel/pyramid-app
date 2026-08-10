#!/usr/bin/env python3
"""NAIA crest sweep via naiastats.prestosports.com (men's soccer teams index).

The Presto network sits behind Cloudflare, so this uses its own headful
persistent-profile Chromium (separate profile from the UPSL scraper so both
can run at once). One teams-index page lists every NAIA msoc program with its
logo; logos download through the browser context (carries the CF cookies),
then sips-resize to 128px PNG. Only fills naia clubs with no img; idempotent.
Match log -> data/naia_presto_report.json.
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


def cf_wait(page, seconds=60):
    for _ in range(seconds // 3):
        if 'moment' not in (page.title() or '').lower():
            return True
        page.wait_for_timeout(3000)
    return False


def main():
    from playwright.sync_api import sync_playwright
    clubs = load_clubs()
    todo = [c for c in clubs if c['g'] == 'naia' and not c.get('img')]
    print(f'{len(todo)} NAIA clubs missing crests')
    report = {'matched': [], 'unmatched': [], 'ambig': [], 'dl_failed': []}
    got = 0
    with sync_playwright() as pw:
        ctx = pw.chromium.launch_persistent_context(PROFILE, headless=False)
        p = ctx.pages[0] if ctx.pages else ctx.new_page()
        p.goto(INDEX, timeout=90000)
        if not cf_wait(p, 90):
            sys.exit('Cloudflare wall never cleared on the teams index')
        p.wait_for_timeout(3000)
        teams = p.evaluate("""() => {
          const out = [];
          for (const a of document.querySelectorAll('a[href*="/teams/"]')) {
            const name = a.textContent.trim();
            if (!name || name.length < 3) continue;
            const row = a.closest('li,tr,div');
            const img = row ? row.querySelector('img') : null;
            out.push({name, logo: img ? (img.dataset.src || img.src) : null,
                      href: a.href});
          }
          return out;
        }""")
        # de-dup by name keeping first row with a logo
        by_name = {}
        for t in teams:
            k = t['name']
            if k not in by_name or (t['logo'] and not by_name[k]['logo']):
                by_name[k] = t
        teams = list(by_name.values())
        print(f'{len(teams)} teams on the Presto index')
        for t in teams:
            t['_toks'] = toks(t['name'])
        for c in todo:
            ct = toks(c['n'])
            scored = []
            for t in teams:
                if not t['_toks']: continue
                ov = len(t['_toks'] & ct)
                if ov == 0 or ov < len(t['_toks']) - 1: continue
                scored.append((ov, t))
            scored.sort(key=lambda x: -x[0])
            if not scored:
                report['unmatched'].append(c['n']); continue
            if len(scored) > 1 and scored[0][0] == scored[1][0]:
                report['ambig'].append({'club': c['n'],
                                        'cands': [scored[0][1]['name'], scored[1][1]['name']]})
                continue
            t = scored[0][1]
            if not t['logo'] or 'blank' in (t['logo'] or ''):
                report['dl_failed'].append({'club': c['n'], 'logo': t['logo'], 'why': 'no logo on index'})
                continue
            # request through the browser context so CF cookies apply
            logo = re.sub(r'\?.*$', '', t['logo'])
            fn = f"crests/naia-{slug(c['n'])}.png"
            dest = os.path.join(ROOT, fn)
            tmp = dest + '.orig'
            try:
                r = p.request.get(t['logo'], timeout=30000)
                if r.status != 200 or len(r.body()) < 400:
                    raise Exception(f'http {r.status}')
                open(tmp, 'wb').write(r.body())
                rr = subprocess.run(['sips', '-s', 'format', 'png', '-Z', '128', tmp,
                                     '--out', dest], capture_output=True)
                if rr.returncode or not os.path.exists(dest) or os.path.getsize(dest) < 400:
                    raise Exception('sips failed')
                c['img'] = fn
                got += 1
                report['matched'].append({'club': c['n'], 'team': t['name']})
                print(f"  + {c['n']} <- {t['name']}")
            except Exception as e:
                report['dl_failed'].append({'club': c['n'], 'logo': t['logo'], 'why': str(e)[:80]})
            finally:
                if os.path.exists(tmp): os.remove(tmp)
            time.sleep(0.4)
        ctx.close()
    json.dump(report, open(os.path.join(ROOT, 'data', 'naia_presto_report.json'), 'w'), indent=1)
    print(f"got {got}; unmatched {len(report['unmatched'])}, ambig {len(report['ambig'])}, "
          f"failed {len(report['dl_failed'])} -> data/naia_presto_report.json")
    if got:
        write_clubs(clubs)


if __name__ == '__main__':
    main()
