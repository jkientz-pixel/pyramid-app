#!/usr/bin/env python3
"""Massey Ratings college soccer scraper (D3 + NAIA men's; works for any
scope). masseyratings.com sits behind Cloudflare, so this drives a real
Chromium via Playwright like scrape_upsl.py. Season is pinned to csoc2025
(completed season, games thru Dec 15 2025) to match the vintage of
massey_d1.json / massey_d2.json.

Massey's table packs rank + value into one cell (``1<div class=detail>8.19
</div>``) and team + conference into nested anchors, so extraction reads the
sub-elements, never cell textContent. Writes data/massey_<key>.json in the
same shape as the D1/D2 files: [{team, conf, rat}].

Run:  python3 scripts/scrape_massey.py [d3] [naia]   (default: both)
"""
import json, os, sys, time
from playwright.sync_api import sync_playwright

SCOPES = {
    'd3':   'https://masseyratings.com/csoc2025/ncaa-d3/ratings',
    'naia': 'https://masseyratings.com/csoc2025/naia/ratings',
}
UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36')
MIN_ROWS = 50

EXTRACT = """() => {
  const t = [...document.querySelectorAll('table')]
    .find(t => t.rows.length > 50 && /Team/.test(t.rows[0].textContent));
  if (!t) return [];
  const head = [...t.rows[0].cells].map(c => c.textContent.trim().toLowerCase());
  const ri = head.indexOf('rat');
  if (ri < 0) return [];
  const out = [];
  for (let r = 1; r < t.rows.length; r++) {
    const cells = t.rows[r].cells;
    if (!cells || cells.length <= ri) continue;
    const teamA = cells[0].querySelector('a');
    const conf = cells[0].querySelector('.detail');
    const detail = cells[ri].querySelector('.detail');
    const rat = parseFloat(detail ? detail.textContent : cells[ri].textContent);
    if (!teamA || !isFinite(rat)) continue;
    out.push({team: teamA.textContent.trim(),
              conf: conf ? conf.textContent.trim() : '', rat});
  }
  return out;
}"""


def scrape(ctx_factory, url, attempts=4):
    """Cloudflare challenges are intermittent; retry with a fresh context."""
    for attempt in range(attempts):
        ctx = ctx_factory()
        page = ctx.new_page()
        try:
            page.goto(url, wait_until='domcontentloaded', timeout=60000)
            for _ in range(20):
                if 'Just a moment' not in page.title():
                    rows = page.evaluate(EXTRACT)
                    if len(rows) >= MIN_ROWS:
                        return rows
                time.sleep(2)
        except Exception as e:
            print(f'  attempt {attempt + 1}: {e}', file=sys.stderr)
        finally:
            ctx.close()
        time.sleep(10 * (attempt + 1))
    return []


def main():
    keys = [k for k in sys.argv[1:] if k in SCOPES] or list(SCOPES)
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    fails = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        factory = lambda: browser.new_context(
            user_agent=UA, viewport={'width': 1440, 'height': 900})
        for k in keys:
            rows = scrape(factory, SCOPES[k])
            # a Cloudflare block must never overwrite good data with junk
            if len(rows) < MIN_ROWS:
                print(f'{k}: FAILED — {len(rows)} rows, not writing')
                fails.append(k)
                continue
            # sanity: ratings must be sorted-ish descending (rank order)
            if rows[0]['rat'] < rows[-1]['rat']:
                print(f'{k}: FAILED — ratings not descending, extraction bug?')
                fails.append(k)
                continue
            out = os.path.join(root, 'data', f'massey_{k}.json')
            with open(out, 'w') as f:
                json.dump(rows, f)
            print(f"{k}: {len(rows)} teams -> {out} "
                  f"(top: {rows[0]['team']} {rows[0]['rat']})")
        browser.close()
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
