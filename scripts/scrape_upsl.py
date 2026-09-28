#!/usr/bin/env python3
"""UPSL standings scraper. Cloudflare blocks plain HTTP clients, so this
drives a real Chromium via Playwright — it runs on the Mac mini (residential
IP) from ops/upsl-refresh.sh on a launchd schedule, which commits only
data/upsl.json; the scheduled GitHub refresh turns it into ratings with
rate_upsl_standings.py. Writes data/upsl.json.

Pass division names to scrape a subset: scrape_upsl.py "Division 1"

Setup once:  pip3 install playwright && python3 -m playwright install chromium
Run:         python3 scripts/scrape_upsl.py
"""
import json, os, sys
from datetime import date
from playwright.sync_api import sync_playwright

SUBS = [('Premier', 'https://premier.upsl.com/standings/'),
        ('Division 1', 'https://division1.upsl.com/standings/'),
        ('Division 2', 'https://division2.upsl.com/standings/')]

EXTRACT = """() => {
  const out = [];
  document.querySelectorAll('table').forEach(t => {
    if (!t.rows.length || !/Team/.test(t.rows[0].textContent)) return;
    let label = '', node = t;
    for (let i = 0; i < 8 && node; i++) {
      node = node.previousElementSibling || node.parentElement;
      if (node && /H[1-6]/.test(node.tagName || '')) { label = node.textContent.trim(); break; }
      if (node && node.querySelector && !node.contains(t)) {
        const hh = node.querySelector('h1,h2,h3,h4');
        if (hh) { label = hh.textContent.trim(); break; }
      }
    }
    const rows = [];
    for (let r = 1; r < t.rows.length; r++) {
      const c = [...t.rows[r].cells].map(x => x.textContent.trim());
      if (c.length >= 13) rows.push({pos: c[0], team: c[1], gp: c[2], w: c[3],
        d: c[4], l: c[5], gf: c[9], ga: c[10], gd: c[11], pts: c[12]});
    }
    if (rows.length) out.push({label, rows});
  });
  return out;
}"""

PAUSE_MS = 8000
# below this many team rows a division's scrape is treated as broken
MIN_TEAMS = {'Premier': 150, 'Division 1': 100, 'Division 2': 20}

# season label the page is showing, e.g. "2026 Fall" (the site defaults to the
# current season; stored so the freshness gate can tell spring from fall)
SEASON = r"""() => {
  const o = document.querySelector('#standings__select-season option[data-season][selected]');
  if (o) return o.textContent.trim();
  const m = document.body.innerText.match(/\b20\d\d (Spring|Fall)\b/);
  return m ? m[0] : '';
}"""

def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    all_tables = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        ctx = browser.new_context(user_agent=(
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
            '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'))
        page = ctx.new_page()
        subs = [x for x in SUBS if not sys.argv[1:] or x[0] in sys.argv[1:]]
        for i, (div, url) in enumerate(subs):
            if i:
                page.wait_for_timeout(PAUSE_MS)  # one page at a time, human pace
            try:
                # 'networkidle' never fires since upsl.com added always-on
                # analytics beacons (every division timed out from late Aug,
                # which is why data/upsl.json froze on spring 2026). Wait for
                # the standings tables themselves instead.
                page.goto(url, wait_until='domcontentloaded', timeout=60000)
                if 'just a moment' in page.title().lower():
                    # Cloudflare challenge: never try to get past it. Fail the
                    # run so the freshness gate reports UPSL as stale.
                    print(f'{div}: Cloudflare challenge page, stopping', file=sys.stderr)
                    break
                page.wait_for_selector('table', timeout=45000)
                season = page.evaluate(SEASON)
                tables = page.evaluate(EXTRACT)
                for t in tables:
                    t['division'] = div
                    t['season'] = season
                    t['fetched'] = date.today().isoformat()
                all_tables += tables
                print(f'{div}: {len(tables)} tables, {sum(len(t["rows"]) for t in tables)} teams', file=sys.stderr)
            except Exception as e:
                print(f'{div}: FAILED {e}', file=sys.stderr)
        browser.close()
    # Merge per division: a division that scraped cleanly replaces its old
    # tables; one that failed (timeout, Cloudflare challenge) keeps the last
    # good tables, still stamped with their own season so the freshness gate
    # can see exactly which division is behind.
    path = os.path.join(root, 'data', 'upsl.json')
    prev = json.load(open(path)) if os.path.exists(path) else []
    fresh = {}
    for t in all_tables:
        fresh.setdefault(t['division'], []).append(t)
    fresh = {d: ts for d, ts in fresh.items() if sum(len(t['rows']) for t in ts) >= MIN_TEAMS[d]}
    if not fresh:
        print('No division scraped cleanly, keeping previous data/upsl.json', file=sys.stderr)
        sys.exit(1)
    merged = [t for t in prev if t['division'] not in fresh]
    for d in fresh:
        merged += fresh[d]
    json.dump(merged, open(path, 'w'), ensure_ascii=False)
    kept = sorted({t['division'] for t in prev} - set(fresh))
    print(f'wrote data/upsl.json: fresh {sorted(fresh)}, kept previous {kept}; '
          f'{len(merged)} tables, {sum(len(t["rows"]) for t in merged)} teams')
    if kept:
        sys.exit(2)  # partial: data written, but the run is not fully fresh

if __name__ == '__main__':
    main()
