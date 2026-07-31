#!/usr/bin/env python3
"""Seasonal UPSL location refresh: re-pin clubs from league-stated locations.

Each UPSL team page states "City, ST" in its hero. This script scrapes that
for every team link (Cloudflare-safe: same headful persistent-profile
Chromium as scrape_upsl_crests.py), then re-pins any club in js/data.js
whose city/state disagrees, geocoding through data/geocache.json. Clubs the
league verifies get acc:'v'. NO GUESSED PLACEMENTS (Jeremy, 2026-07-30):
clubs with no current team page or an unusable stated location are never
touched — they land in data/upsl_location_audit.json for review.

Run at each season start (UPSL Spring ~Feb, Fall ~Aug) on the Mac mini,
after scrape_upsl.py has refreshed standings. launchd example (twice yearly):
  StartCalendarInterval: [{Month: 2, Day: 20, Hour: 4}, {Month: 8, Day: 20, Hour: 4}]

Usage:
  python3 scripts/refresh_upsl_locations.py                 # scrape + apply
  python3 scripts/refresh_upsl_locations.py --collect-links # also re-crawl /teams/ indexes first (new season = new teams)
  python3 scripts/refresh_upsl_locations.py --apply-only    # skip scraping, use cached data/upsl_locations.json
  python3 scripts/refresh_upsl_locations.py --max-age-days 60   # reuse page data newer than this (default 60)

Scrape progress saves every 20 pages; rerun to resume. 5 consecutive
Cloudflare walls abort the run (resume later), same as the crest scraper.
"""
from _datajs import load_clubs, write_clubs, ROOT
from scrape_upsl_crests import cf_wait, pause, PROFILE, LINKS_CACHE
import argparse, json, os, re, sys, time, urllib.parse, urllib.request

LOCATIONS = os.path.join(ROOT, 'data', 'upsl_locations.json')
AUDIT = os.path.join(ROOT, 'data', 'upsl_location_audit.json')
GEOCACHE = os.path.join(ROOT, 'data', 'geocache.json')
UA = {'User-Agent': 'RankXI/1.0 (jkientz@gmail.com)'}
LOC_RE = re.compile(r'^(.*),\s*([A-Z]{2})$')
ST_FULL = {'AL':'Alabama','AK':'Alaska','AZ':'Arizona','AR':'Arkansas','CA':'California','CO':'Colorado','CT':'Connecticut','DE':'Delaware','DC':'District of Columbia','FL':'Florida','GA':'Georgia','HI':'Hawaii','ID':'Idaho','IL':'Illinois','IN':'Indiana','IA':'Iowa','KS':'Kansas','KY':'Kentucky','LA':'Louisiana','ME':'Maine','MD':'Maryland','MA':'Massachusetts','MI':'Michigan','MN':'Minnesota','MS':'Mississippi','MO':'Missouri','MT':'Montana','NE':'Nebraska','NV':'Nevada','NH':'New Hampshire','NJ':'New Jersey','NM':'New Mexico','NY':'New York','NC':'North Carolina','ND':'North Dakota','OH':'Ohio','OK':'Oklahoma','OR':'Oregon','PA':'Pennsylvania','RI':'Rhode Island','SC':'South Carolina','SD':'South Dakota','TN':'Tennessee','TX':'Texas','UT':'Utah','VT':'Vermont','VA':'Virginia','WA':'Washington','WV':'West Virginia','WI':'Wisconsin','WY':'Wyoming'}

HERO_JS = """() => {
  const h = document.querySelector('h1');
  if (!h || /upsl\\.com/i.test(h.textContent)) return null;
  const box = h.closest('section,div,header') || h.parentElement;
  const lines = (box ? box.innerText : h.innerText).split('\\n').map(s => s.trim()).filter(Boolean);
  return { name: lines[0] || '', division: lines[1] || '', loc: lines[2] || '' };
}"""


def norm(s):
    return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9]+', ' ', s.lower())).strip()


def all_links():
    cache = json.load(open(LINKS_CACHE)) if os.path.exists(LINKS_CACHE) else {}
    return [u for links in cache.values() for u in links]


def collect_links_fresh(p):
    """Re-crawl the /teams/ index of every subsite (new season = new teams)."""
    from scrape_upsl_crests import collect_links
    if os.path.exists(LINKS_CACHE):
        cache = json.load(open(LINKS_CACHE))
        json.dump({k: [] for k in cache}, open(LINKS_CACHE, 'w'))
    return collect_links(p)


def scrape(collect, max_age_days):
    from playwright.sync_api import sync_playwright
    done = json.load(open(LOCATIONS)) if os.path.exists(LOCATIONS) else {}
    cutoff = time.time() - max_age_days * 86400
    with sync_playwright() as pw:
        ctx = pw.chromium.launch_persistent_context(PROFILE, headless=False)
        p = ctx.pages[0] if ctx.pages else ctx.new_page()
        links = collect_links_fresh(p) if collect else all_links()
        todo = [u for u in links
                if u not in done or done[u].get('error') or done[u].get('fetched_at', 0) < cutoff]
        print(f'{len(todo)} team pages to fetch of {len(links)}', flush=True)
        cf_streak = 0
        for i, url in enumerate(todo):
            rec = {'fetched_at': int(time.time())}
            try:
                p.goto(url, timeout=60000)
                if not cf_wait(p):
                    cf_streak += 1
                    if cf_streak >= 5:
                        print('  !! 5 consecutive Cloudflare walls — aborting; rerun to resume')
                        break
                    raise Exception('cloudflare stuck')
                cf_streak = 0
                p.wait_for_function('!!document.querySelector("h1")', timeout=15000)
                hero = p.evaluate(HERO_JS)
                if not hero:
                    raise Exception('hero is challenge page')
                rec.update(hero)
            except Exception as e:
                rec['error'] = str(e)[:120]
            done[url] = rec
            if i % 20 == 19 or i == len(todo) - 1:
                json.dump(done, open(LOCATIONS, 'w'))
                print(f'  {i+1}/{len(todo)}', flush=True)
            pause(p)
        ctx.close()
    json.dump(done, open(LOCATIONS, 'w'))
    errs = sum(1 for r in done.values() if r.get('error'))
    print(f'scrape done: {len(done)} pages cached, {errs} errors', flush=True)


def geocode(cache, city, st):
    key = f'{city}, {ST_FULL[st]}'
    if key in cache:
        return cache[key]
    url = 'https://nominatim.openstreetmap.org/search?' + urllib.parse.urlencode(
        {'q': key + ', USA', 'format': 'json', 'limit': 1})
    try:
        r = json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30))
        cache[key] = [round(float(r[0]['lat']), 4), round(float(r[0]['lon']), 4)] if r else None
    except Exception as e:
        print(f'  geocode ERR {key}: {e}', file=sys.stderr)
        return None  # transient: leave uncached so a rerun retries
    json.dump(cache, open(GEOCACHE, 'w'))
    time.sleep(1.1)
    return cache[key]


def apply():
    scraped = json.load(open(LOCATIONS))
    clubs = load_clubs()
    geocache = json.load(open(GEOCACHE))

    by_slug, by_name = {}, {}
    for url, r in scraped.items():
        if r.get('error') or not r.get('name') or 'Nothing Found' in r['name']:
            continue
        slug = re.sub(r'-\d+$', '', url.rstrip('/').split('/')[-1])
        by_slug.setdefault(slug, r)
        by_name.setdefault(norm(r['name']), r)
        by_name.setdefault(norm(slug.replace('-', ' ')), r)

    audit = {'repinned': [], 'verified_in_place': 0, 'unmatched': [],
             'league_loc_unusable': [], 'geocode_failed': [],
             'ran_at': time.strftime('%Y-%m-%d %H:%M')}
    changed = 0
    for c in clubs:
        if c.get('g') != 'upsl':
            continue
        rec = by_slug.get(c.get('id', '')) or by_name.get(norm(c['n']))
        if not rec:
            audit['unmatched'].append(c['n'])
            continue
        m = LOC_RE.match((rec.get('loc') or '').strip())
        if not m or m.group(2) not in ST_FULL:
            audit['league_loc_unusable'].append({'club': c['n'], 'loc': rec.get('loc', '')})
            continue
        city, st = m.group(1).strip(), m.group(2)
        if norm(c.get('ct', '')) == norm(city) and c.get('st') == st:
            if c.get('acc') != 'v':
                c['acc'] = 'v'
                changed += 1
            audit['verified_in_place'] += 1
            continue
        ll = geocode(geocache, city, st)
        if not ll:
            audit['geocode_failed'].append({'club': c['n'], 'league': f'{city}, {st}'})
            continue
        audit['repinned'].append({'club': c['n'], 'from': f"{c.get('ct','?')}, {c.get('st','?')}",
                                  'to': f'{city}, {st}'})
        c['la'], c['lo'] = ll
        c['ct'], c['st'] = city, st
        c['acc'] = 'v'
        changed += 1

    json.dump(audit, open(AUDIT, 'w'), indent=1)
    print(f"apply: {len(audit['repinned'])} re-pinned, {audit['verified_in_place']} verified in place, "
          f"{len(audit['unmatched'])} unmatched (untouched), "
          f"{len(audit['league_loc_unusable'])} unusable league loc, "
          f"{len(audit['geocode_failed'])} geocode failures — audit in data/upsl_location_audit.json")
    if changed:
        write_clubs(clubs)
    else:
        print('no changes to js/data.js')


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--collect-links', action='store_true',
                    help='re-crawl /teams/ indexes first (do this each new season)')
    ap.add_argument('--apply-only', action='store_true',
                    help='skip scraping; apply cached data/upsl_locations.json')
    ap.add_argument('--max-age-days', type=int, default=60,
                    help='reuse cached team-page data newer than this (default 60)')
    args = ap.parse_args()
    if not args.apply_only:
        scrape(args.collect_links, args.max_age_days)
    apply()


if __name__ == '__main__':
    main()
