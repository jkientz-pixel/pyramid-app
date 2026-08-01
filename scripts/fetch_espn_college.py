#!/usr/bin/env python3
"""NCAA D1 soccer results from ESPN's public scoreboard API ->
data/espn_college_2025.json.

site.api.espn.com serves college soccer under league slugs usa.ncaa.m.1
(men's D1) and usa.ncaa.w.1 (women's D1); ?dates= accepts a
YYYYMMDD-YYYYMMDD range. ESPN carries the games it tracks, not every D1
fixture — the pull is for calibrating the odds engine against real
college results, not for standings. Only completed games with numeric
scores are kept; the home side is t1 to match the other match files.
"""
import json, os, sys, time, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = {'User-Agent': 'RankXI/1.0 (jkientz@gmail.com; odds calibration)'}
API = ('https://site.api.espn.com/apis/site/v2/sports/soccer/%s/'
       'scoreboard?dates=%s&limit=1000')
LEAGUES = {'ncaa1': 'usa.ncaa.m.1', 'ncaa1w': 'usa.ncaa.w.1'}
# fall 2025 season, week windows (regular season through College Cup)
WEEKS = [(f'202508{d:02d}', f'202508{d+6:02d}') for d in (11, 18, 25)] + [
    ('20250901', '20250907'), ('20250908', '20250914'), ('20250915', '20250921'),
    ('20250922', '20250928'), ('20250929', '20251005'), ('20251006', '20251012'),
    ('20251013', '20251019'), ('20251020', '20251026'), ('20251027', '20251102'),
    ('20251103', '20251109'), ('20251110', '20251116'), ('20251117', '20251123'),
    ('20251124', '20251130'), ('20251201', '20251207'), ('20251208', '20251215')]


def fetch(url):
    return json.load(urllib.request.urlopen(
        urllib.request.Request(url, headers=UA), timeout=30))


def main():
    out = {}
    for lg, slug in LEAGUES.items():
        rows, seen = [], set()
        for a, b in WEEKS:
            try:
                events = fetch(API % (slug, f'{a}-{b}')).get('events', [])
            except Exception as e:
                print(f'  {lg} {a}: fetch failed ({e}) — window skipped',
                      file=sys.stderr)
                continue
            for ev in events:
                if ev['id'] in seen:
                    continue
                seen.add(ev['id'])
                comp = ev['competitions'][0]
                if not comp['status']['type'].get('completed'):
                    continue
                side = {c['homeAway']: c for c in comp['competitors']}
                if set(side) != {'home', 'away'}:
                    continue
                try:
                    s1, s2 = int(side['home']['score']), int(side['away']['score'])
                except (KeyError, TypeError, ValueError):
                    continue
                rows.append({'d': ev['date'][:10],
                             't1': side['home']['team']['displayName'],
                             't2': side['away']['team']['displayName'],
                             's1': s1, 's2': s2})
            time.sleep(0.4)
        rows.sort(key=lambda r: r['d'])
        out[lg] = rows
        print(f'{lg}: {len(rows)} completed games')
    json.dump(out, open(os.path.join(ROOT, 'data', 'espn_college_2025.json'), 'w'))


if __name__ == '__main__':
    main()
