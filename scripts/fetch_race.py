#!/usr/bin/env python3
"""Season-race inputs from ESPN: current standings, the schedule still to come,
and the real season window for each league.

Writes three files:
  data/seasons.json        league window + mid-season breaks + season length
  data/standings.json      current table, grouped by conference
  data/schedule_rest.json  every unplayed fixture from today to the season end

Three things here were learned the hard way and must not be "simplified":

  * The standings endpoint is `apis/v2`, NOT `apis/site/v2`. The second one
    returns an empty object silently and you get an empty table, not an error.
  * `season.startDate` / `season.endDate` are a calendar-year placeholder
    (2026-01-01 -> 2026-12-31) for most leagues. The real window is the min and
    max of `leagues[0].calendar`, which is the list of actual matchdays.
  * Season LENGTH is derived (games played + games still scheduled), never
    hardcoded. Hardcoding it had NWSL at 26 (really 30) and USLC at 34 (really
    30), which silently produced projected points-per-game above the 3.0 max.

Like fetch_fixtures.py this sends a PLAIN user agent: ESPN 403s browser-looking
agents and serves curl. Exits non-zero only when every feed fails, so a single
league going quiet never blocks a deploy.
"""
from _datajs import load_clubs, ROOT
import json, os, re, sys, time, unicodedata, urllib.request
from datetime import date, timedelta

UA = {'User-Agent': 'curl/8.4.0'}                       # plain on purpose
STAND = 'https://site.api.espn.com/apis/v2/sports/soccer/%s/standings'
BOARD = 'https://site.api.espn.com/apis/site/v2/sports/soccer/%s/scoreboard?dates=%s&limit=1000'

GAP_DAYS = 14      # a gap longer than this is a break worth telling readers about
TAIL_DAYS = 21     # ...unless it sits this close to the end, where it is the postseason

# ESPN slug -> (our league key, playoff places per group, tiebreak chain)
FEEDS = [
    ('usa.1',      'mls',  9, ['pts', 'w', 'gd', 'gf']),
    ('usa.nwsl',   'nwsl', 8, ['pts', 'w', 'gd', 'gf']),
    ('usa.usl.1',  'uslc', 8, ['pts', 'w', 'gd', 'gf']),
    ('usa.usl.l1', 'usl1', 8, ['pts', 'w', 'gd', 'gf']),
]
# ESPN's name for a club we hold under another. Same list fetch_fixtures.py
# keeps; each was confirmed by eye against the league's own membership.
ALIAS = {
    'new york city fc': 'NYCFC',
    'red bull new york': 'New York Red Bulls',
    'sporting jax': 'Sporting Club Jacksonville',
    'gotham fc': 'NJ/NY Gotham',
    'chicago stars fc': 'Chicago Red Stars',
}


def deacc(x):
    return unicodedata.normalize('NFKD', x or '').encode('ascii', 'ignore').decode()


def strip(s):
    s = deacc(s).lower()
    s = re.sub(r'\b(fc|sc|cf|afc|club|the)\b', ' ', s)
    return re.sub(r'[^a-z0-9]', '', s)


def fetch(url):
    return json.load(urllib.request.urlopen(
        urllib.request.Request(url, headers=UA), timeout=60))


def month_ranges(start, end):
    """ESPN caps a scoreboard call at limit=1000, so walk month by month."""
    y, m = start.year, start.month
    while (y, m) <= (end.year, end.month):
        last = (date(y + (m == 12), m % 12 + 1, 1) - timedelta(days=1)).day
        yield '%04d%02d01-%04d%02d%02d' % (y, m, y, m, last)
        m += 1
        if m > 12:
            m, y = 1, y + 1


def main():
    clubs = [c for c in load_clubs() if not c.get('h')]
    today = date.today()
    seasons, standings, schedule = {}, {}, []
    failed, notes = [], []

    for slug, lg, cut, tiebreak in FEEDS:
        pool = {strip(c['n']): c for c in clubs if c['g'] == lg}

        def find(name):
            n = ALIAS.get(deacc(name).lower(), name)
            return pool.get(strip(n))

        # ---- season window from the matchday calendar
        try:
            board = fetch(BOARD % (slug, today.strftime('%Y%m%d')))
        except Exception as e:
            print('  ! %s calendar: %s' % (slug, e), file=sys.stderr)
            failed.append(slug)
            continue
        cal = sorted(x[:10] for x in (board.get('leagues', [{}])[0].get('calendar') or [])
                     if isinstance(x, str))
        if not cal:
            print('  ! %s: no calendar' % slug, file=sys.stderr)
            failed.append(slug)
            continue
        start_d, end_d = cal[0], cal[-1]
        ds = [date.fromisoformat(x) for x in cal]
        last = ds[-1]
        breaks, postseason = [], None
        for i in range(len(ds) - 1):
            gap = (ds[i + 1] - ds[i]).days
            if gap <= GAP_DAYS:
                continue
            # a long gap at the END is a postseason tail, not a mid-season break
            if (last - ds[i + 1]).days <= TAIL_DAYS:
                postseason = {'from': cal[i + 1], 'days': gap}
            else:
                breaks.append({'from': cal[i], 'to': cal[i + 1], 'days': gap})

        # ---- standings
        try:
            sd = fetch(STAND % slug)
        except Exception as e:
            print('  ! %s standings: %s' % (slug, e), file=sys.stderr)
            failed.append(slug)
            continue
        groups, miss = [], []
        for ch in sd.get('children', []):
            rows = []
            for e in ch['standings']['entries']:
                st = {s['name']: s.get('value') for s in e['stats']}
                nm = e['team'].get('displayName', '')
                c = find(nm)
                if not c:
                    miss.append(nm)
                    continue
                iv = lambda k: int(st.get(k) or 0)
                rows.append({'id': c['id'], 'gp': iv('gamesPlayed'), 'w': iv('wins'),
                             'd': iv('ties'), 'l': iv('losses'), 'gf': iv('pointsFor'),
                             'ga': iv('pointsAgainst'), 'gd': iv('pointDifferential'),
                             'pts': iv('points'), 'ded': iv('deductions')})
            if rows:
                groups.append({'name': ch.get('name', 'League'), 'rows': rows})
        if not groups:
            print('  ! %s: standings empty' % slug, file=sys.stderr)
            failed.append(slug)
            continue

        # ---- remaining schedule, today -> season end
        rest, seen = [], set()
        for rng in month_ranges(today, date.fromisoformat(end_d)):
            try:
                b = fetch(BOARD % (slug, rng))
            except Exception as e:
                print('  ! %s %s: %s' % (slug, rng, e), file=sys.stderr)
                continue
            for ev in b.get('events', []):
                comp = (ev.get('competitions') or [{}])[0]
                if (comp.get('status', {}).get('type', {}) or {}).get('completed'):
                    continue
                dt = ev.get('date', '')[:10]
                if not dt or dt < today.isoformat():
                    continue
                cs = comp.get('competitors') or []
                h = next((x for x in cs if x.get('homeAway') == 'home'), None)
                a = next((x for x in cs if x.get('homeAway') == 'away'), None)
                if not h or not a:
                    continue
                hc = find(h['team'].get('displayName', ''))
                ac = find(a['team'].get('displayName', ''))
                if not hc or not ac:
                    continue
                k = (dt, hc['id'], ac['id'])
                if k in seen:
                    continue
                seen.add(k)
                rest.append({'lg': lg, 'd': dt, 'h': hc['id'], 'a': ac['id']})
            time.sleep(0.4)

        # ---- season length is DERIVED: played + still scheduled
        played = {r['id']: r['gp'] for g in groups for r in g['rows']}
        left = {i: 0 for i in played}
        for f in rest:
            if f['h'] in left: left[f['h']] += 1
            if f['a'] in left: left[f['a']] += 1
        totals = {i: played[i] + left[i] for i in played}
        tally = {}
        for v in totals.values():
            tally[v] = tally.get(v, 0) + 1
        games = max(tally, key=tally.get) if tally else 0
        odd = sorted(i for i, v in totals.items() if v != games)
        if odd:
            notes.append('%s: %d club(s) not on the %d-game total (%s)'
                         % (lg, len(odd), games, ', '.join(odd[:4])))

        seasons[lg] = {'start': start_d, 'end': end_d, 'matchdays': len(cal),
                       'games': games, 'cut': cut, 'tiebreak': tiebreak,
                       'breaks': breaks, 'src': 'espn'}
        if postseason:
            seasons[lg]['postseason'] = postseason
        standings[lg] = {'groups': groups}
        schedule += rest
        print('%-5s %s -> %s | %d clubs | %d games | %d remaining%s'
              % (lg, start_d, end_d, len(played), games, len(rest),
                 (' | unmatched: %s' % miss[:3]) if miss else ''), file=sys.stderr)

    if len(failed) >= len(FEEDS):
        sys.exit('FATAL: every ESPN feed failed (%s) - not writing' % ', '.join(failed))
    for n in notes:
        print('  note: %s' % n, file=sys.stderr)

    stamp = time.strftime('%Y-%m-%dT%H:%MZ', time.gmtime())
    out = os.path.join(ROOT, 'data')
    for name, payload in (
        ('seasons.json', {'updated': stamp, 'leagues': seasons}),
        ('standings.json', {'updated': stamp, 'leagues': standings}),
        ('schedule_rest.json', {'updated': stamp, 'fixtures': schedule}),
    ):
        p = os.path.join(out, name)
        # merge, never replace: a league whose feed failed this run keeps the
        # entry it already had rather than vanishing from the site
        if os.path.exists(p) and name != 'schedule_rest.json':
            try:
                prev = json.load(open(p))
                merged = dict(prev.get('leagues') or {})
                merged.update(payload['leagues'])
                payload['leagues'] = merged
            except Exception:
                pass
        json.dump(payload, open(p, 'w'), separators=(',', ':'))
        print('wrote data/%s' % name, file=sys.stderr)


if __name__ == '__main__':
    main()
