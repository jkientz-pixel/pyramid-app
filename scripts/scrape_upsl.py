#!/usr/bin/env python3
"""UPSL standings scraper. Cloudflare blocks plain HTTP clients, so this
drives a real Chromium via Playwright — run it on the Mac mini (residential
IP) on a launchd schedule. Writes data/upsl.json.

Setup once:  pip3 install playwright && python3 -m playwright install chromium
Run:         python3 scripts/scrape_upsl.py
"""
import json, os, sys
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

def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    all_tables = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        ctx = browser.new_context(user_agent=(
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
            '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'))
        page = ctx.new_page()
        for div, url in SUBS:
            try:
                page.goto(url, wait_until='networkidle', timeout=60000)
                tables = page.evaluate(EXTRACT)
                for t in tables:
                    t['division'] = div
                all_tables += tables
                print(f'{div}: {len(tables)} tables, {sum(len(t["rows"]) for t in tables)} teams', file=sys.stderr)
            except Exception as e:
                print(f'{div}: FAILED {e}', file=sys.stderr)
        browser.close()
    if sum(len(t['rows']) for t in all_tables) < 300:
        print('Extraction suspiciously small — keeping previous data/upsl.json', file=sys.stderr)
        sys.exit(1)
    json.dump(all_tables, open(os.path.join(root, 'data', 'upsl.json'), 'w'), ensure_ascii=False)
    print(f'wrote data/upsl.json: {len(all_tables)} tables, {sum(len(t["rows"]) for t in all_tables)} teams')

if __name__ == '__main__':
    main()
