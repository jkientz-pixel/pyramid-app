#!/usr/bin/env python3
"""Harvest each UPSL team page's outbound links — club website, Instagram,
X/Twitter, Facebook — into data/upsl_sites.json (sidecar; data.js untouched).

Same headful persistent-profile Chromium + cf_wait pacing as
scrape_upsl_crests.py, same cached team-link list. Resumable: progress saves
every 15 pages; pages already harvested are skipped on rerun. Apply happens in
apply_completeness_batch.py by slug/name (mirrors refresh_upsl_locations.py).
"""
from scrape_upsl_crests import cf_wait, pause, PROFILE, LINKS_CACHE
from _datajs import ROOT
import json, os, re, sys, time

OUT = os.path.join(ROOT, 'data', 'upsl_sites.json')

LINKS_JS = """() => {
  const out = [];
  for (const a of document.querySelectorAll('a[href]')) {
    const h = a.href;
    if (/^https?:\\/\\//i.test(h) && !/upsl\\.com|youtube|tiktok|linktr|mailto/i.test(h))
      out.push(h);
  }
  return [...new Set(out)];
}"""


def classify(links):
    rec = {}
    for h in links:
        low = h.lower()
        if 'instagram.com/' in low:
            rec.setdefault('si', h.split('?')[0])
        elif 'twitter.com/' in low or re.search(r'//(www\.)?x\.com/', low):
            rec.setdefault('sx', h.split('?')[0])
        elif 'facebook.com/' in low:
            rec.setdefault('fb', h.split('?')[0])
        else:
            # first non-social external link wins as the club site; skip
            # obvious platform/vendor links
            if not re.search(r'(squarespace|wixsite|godaddysites)\.com/(config|admin)', low) \
               and not re.search(r'(shopify|teamsnap|gotsport|demosphere|leagueapps|apple|google)', low):
                rec.setdefault('url', h)
    return rec


def main():
    done = json.load(open(OUT)) if os.path.exists(OUT) else {}
    cache = json.load(open(LINKS_CACHE)) if os.path.exists(LINKS_CACHE) else {}
    links = [u for ls in cache.values() for u in ls]
    todo = [u for u in links if u not in done]
    print(f'{len(todo)} team pages to harvest of {len(links)}', flush=True)
    if not todo:
        return
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        ctx = pw.chromium.launch_persistent_context(PROFILE, headless=False)
        p = ctx.pages[0] if ctx.pages else ctx.new_page()
        cf_streak = 0
        for i, url in enumerate(todo):
            rec = {'fetched_at': int(time.time())}
            try:
                p.goto(url, timeout=60000)
                if not cf_wait(p):
                    cf_streak += 1
                    if cf_streak >= 5:
                        print('  !! 5 consecutive Cloudflare walls — aborting; rerun to resume', flush=True)
                        break
                    raise Exception('cloudflare stuck')
                cf_streak = 0
                p.wait_for_function('!!document.querySelector("h1")', timeout=15000)
                rec.update(classify(p.evaluate(LINKS_JS)))
            except Exception as e:
                rec['error'] = str(e)[:120]
            done[url] = rec
            if i % 15 == 14 or i == len(todo) - 1:
                json.dump(done, open(OUT, 'w'))
                print(f'  {i+1}/{len(todo)}', flush=True)
            pause(p)
        ctx.close()
    json.dump(done, open(OUT, 'w'))
    got = sum(1 for r in done.values() if any(k in r for k in ('url', 'si', 'sx', 'fb')))
    print(f'harvest done: {len(done)} pages, {got} with links -> data/upsl_sites.json', flush=True)


if __name__ == '__main__':
    main()
