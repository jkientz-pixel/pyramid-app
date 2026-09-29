#!/usr/bin/env python3
"""Massey Ratings college soccer scraper (D3 + NAIA men's; works for any
scope). masseyratings.com sits behind Cloudflare, so this drives a real
Chromium via Playwright like scrape_upsl.py, and runs from a residential IP.
Season is SEASON below (all six layers, men's and women's).

Massey's table packs rank + value into one cell (``1<div class=detail>8.19
</div>``) and team + conference into nested anchors, so extraction reads the
sub-elements, never cell textContent. Writes data/massey_<key>.json in the
same shape as the D1/D2 files: [{team, conf, rat}].

Run:  python3 scripts/scrape_massey.py [d1] [d2] [d3] [naia] [d1w] [d2w]   (default: all)
"""
import json, os, sys, time
from datetime import date
from playwright.sync_api import sync_playwright

# Current season. Was pinned to 2025 (the completed season) until 2026-09-28,
# which left all six college layers a year stale through the 2026 season.
# Massey's in-season ratings carry its own preseason prior, so early-season
# numbers are Massey's published ratings, not a raw five-game table.
SEASON = '2026'
_M = 'https://masseyratings.com/csoc%s/%s/ratings'
_W = 'https://masseyratings.com/csocw%s/%s/ratings'  # women's is its own scope
SCOPES = {
    'd1':   _M % (SEASON, 'ncaa-d1'),
    'd2':   _M % (SEASON, 'ncaa-d2'),
    'd3':   _M % (SEASON, 'ncaa-d3'),
    'naia': _M % (SEASON, 'naia'),
    'd1w':  _W % (SEASON, 'ncaa-d1'),
    'd2w':  _W % (SEASON, 'ncaa-d2'),
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


def scrape(ctx_factory, url, thru):
    """One normal page load. A Cloudflare challenge page is never worked
    around (no fresh-context retries): the scope fails and keeps its last good
    file, and the caller reports it."""
    ctx = ctx_factory()
    page = ctx.new_page()
    try:
        page.goto(url, wait_until='domcontentloaded', timeout=60000)
        if 'just a moment' in page.title().lower():
            print(f'  Cloudflare challenge on {url}, stopping', file=sys.stderr)
            return []
        # a small header table renders first; wait for the ratings table itself
        page.wait_for_function(
            f'[...document.querySelectorAll("table")].some(t => t.rows.length > {MIN_ROWS})',
            timeout=45000)
        thru.append(page.evaluate(
            "() => (document.body.innerText.match(/Using games thru ([^\\n]+)/) || [])[1] || ''"))
        return page.evaluate(EXTRACT)
    except Exception as e:
        print(f'  {url}: {e}', file=sys.stderr)
        return []
    finally:
        ctx.close()


def main():
    keys = [k for k in sys.argv[1:] if k in SCOPES] or list(SCOPES)
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    fails = []
    mpath = os.path.join(root, 'data', 'massey_meta.json')
    meta = json.load(open(mpath)) if os.path.exists(mpath) else {}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        factory = lambda: browser.new_context(
            user_agent=UA, viewport={'width': 1440, 'height': 900})
        for i, k in enumerate(keys):
            if i:
                time.sleep(8)  # one page at a time, human pace
            thru = []
            rows = scrape(factory, SCOPES[k], thru)
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
            # fetch date per scope, read by check_freshness.py
            meta[k] = {'season': SEASON, 'fetched': date.today().isoformat(),
                       'thru': thru[0] if thru else ''}
            print(f"{k}: {len(rows)} teams -> {out} "
                  f"(top: {rows[0]['team']} {rows[0]['rat']})")
        browser.close()
    with open(mpath, 'w') as f:
        json.dump(meta, f, indent=1, sort_keys=True)
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
