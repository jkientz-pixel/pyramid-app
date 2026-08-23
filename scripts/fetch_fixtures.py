#!/usr/bin/env python3
"""Upcoming fixtures for six leagues -> data/fixtures.json.

#/matches is one of eight primary nav tabs and it said "No verified fixtures in
the next two weeks" through the fourth week of August, with MLS, both USL pro
divisions, NWSL and the entire college season in play. Every sports app that
holds an audience answers *when do they play*; this one answered it for two NPSL
playoff games that finished on 2 August.

Source is ESPN's public scoreboard API, the same one fetch_espn_college.py
already uses for college results. Two things about it are worth writing down:

  * It 403s a BROWSER User-Agent and serves a plain one. That is backwards from
    every other host in this repo, and it is why the existing RankXI/1.0 agent
    started failing — do not "fix" the UA to look like Chrome.
  * MLS Next Pro, USL Super League, NPSL, USL2 and UPSL have no slug. Six
    leagues is what ESPN carries, so six leagues is what ships. Nothing is
    invented to fill the others.

Team names are resolved to club ids HERE, not in the browser, so the match rate
is measurable and the failures are logged instead of silently rendering a game
between two strangers. Pro leagues resolve by suffix-stripped name (plus the
alias table below for the handful ESPN names differently); college resolves
through data/espn_club_map.json, the map map_espn_college.py already built.
A fixture whose sides don't both resolve still ships — it renders as a plain
text row rather than a crested card, which is how the NPSL final already
behaved. Dropping it would hide a real game.

Only scheduled games inside HORIZON_DAYS are kept: a stale feed must never
present last month's fixtures as upcoming, which is the failure the empty state
was there to prevent.
"""
from _datajs import load_clubs, ROOT
import collections, json, os, re, sys, time, unicodedata, urllib.request

# plain agent on purpose — see module docstring
UA = {'User-Agent': 'curl/8.4.0'}
API = ('https://site.api.espn.com/apis/site/v2/sports/soccer/%s/'
       'scoreboard?dates=%s&limit=1000')
HORIZON_DAYS = 21

# ESPN slug -> (our league key, club-pool league keys, espn_club_map key)
FEEDS = [
    ('usa.1',        'mls',    ('mls',),   None),
    ('usa.usl.1',    'uslc',   ('uslc',),  None),
    ('usa.usl.l1',   'usl1',   ('usl1',),  None),
    ('usa.nwsl',     'nwsl',   ('nwsl',),  None),
    ('usa.ncaa.m.1', 'ncaa1',  ('ncaa1', 'ncaa2', 'ncaa3', 'naia'), 'ncaa1'),
    ('usa.ncaa.w.1', 'ncaa1w', ('ncaa1w', 'ncaa2w'),                'ncaa1w'),
]

# ESPN's name for a club we hold under another. Kept tiny and explicit: each
# one was confirmed by eye against the league's own current membership.
ALIAS = {
    'new york city fc': 'NYCFC',
    'red bull new york': 'New York Red Bulls',
    'sporting jax': 'Sporting Club Jacksonville',
    'gotham fc': 'NJ/NY Gotham',
    # NWSL renamed this club in 2025; our record still carries the old name,
    # so alias rather than rename — the id is a live URL.
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


def main():
    clubs = [c for c in load_clubs() if not c.get('h')]
    by_id = {c['id']: c for c in clubs}
    emap = {}
    p = os.path.join(ROOT, 'data', 'espn_club_map.json')
    if os.path.exists(p):
        emap = json.load(open(p))

    today = time.gmtime()
    start = time.strftime('%Y%m%d', today)
    end = time.strftime('%Y%m%d', time.gmtime(time.time() + HORIZON_DAYS * 86400))
    cutoff = time.strftime('%Y-%m-%dT%H:%M', time.gmtime(time.time() + HORIZON_DAYS * 86400))

    out, unmatched = [], collections.Counter()
    failed = []
    for slug, lg, pool, mapkey in FEEDS:
        idx = collections.defaultdict(list)
        for c in clubs:
            if c['g'] in pool:
                idx[strip(c['n'])].append(c)
        cmap = emap.get(mapkey, {}) if mapkey else {}

        def resolve(name):
            """club id or None. Ambiguity resolves to None: a missing crest
            beats a game attributed to the wrong club."""
            if cmap:
                cid = cmap.get(name)
                if cid and cid in by_id:
                    return cid
            hit = idx.get(strip(ALIAS.get((name or '').lower(), name)))
            return hit[0]['id'] if hit and len(hit) == 1 else None

        try:
            data = fetch(API % (slug, f'{start}-{end}'))
        except Exception as e:
            print(f'  ! {slug}: {e}')
            failed.append(slug)
            continue
        kept = 0
        for e in data.get('events', []):
            st = ((e.get('status') or {}).get('type') or {})
            if st.get('state') != 'pre':          # played or in progress
                continue
            when = (e.get('date') or '').replace('Z', ':00.000Z')
            if not when or when[:16] > cutoff:
                continue
            comp = (e.get('competitions') or [{}])[0]
            sides = {t.get('homeAway'): t for t in comp.get('competitors', [])}
            h, a = sides.get('home'), sides.get('away')
            if not h or not a:
                continue
            hn = (h.get('team') or {}).get('displayName', '')
            an = (a.get('team') or {}).get('displayName', '')
            if not hn or not an:
                continue
            hid, aid = resolve(hn), resolve(an)
            for nm, got in ((hn, hid), (an, aid)):
                if not got:
                    unmatched[f'{lg}: {nm}'] += 1
            venue = ((comp.get('venue') or {}).get('fullName') or '')
            tv = ''
            for b in (comp.get('broadcasts') or []):
                names = b.get('names') or []
                if names:
                    tv = names[0]
                    break
            note = comp.get('notes') or []
            round_ = (note[0].get('headline') if note and isinstance(note[0], dict) else '') or ''
            rec = {'lg': lg, 'start': when, 't1': hn, 't2': an, 'venue': venue}
            if hid: rec['id1'] = hid
            if aid: rec['id2'] = aid
            if tv: rec['tv'] = tv
            if round_: rec['round'] = round_
            out.append(rec)
            kept += 1
        print(f'  {lg:<7} {kept} upcoming fixtures')
        time.sleep(0.4)

    # An empty file is legitimate — there is a real off-season between the
    # college final in December and the MLS opener in February. A file that is
    # empty because every request failed is not, and the two are indistinguish-
    # able downstream: both render the honest "no verified fixtures" state
    # while the site quietly stops answering "when do they play". So fail loudly
    # on transport, and only on transport. ESPN's UA blocklist is the live risk
    # here — it already broke the college fetcher once.
    if len(failed) == len(FEEDS):
        sys.exit(f'FAIL: every feed errored ({", ".join(failed)}) — '
                 f'refusing to publish an empty fixtures file')
    if failed:
        print(f'WARNING: {len(failed)} of {len(FEEDS)} feeds errored: {", ".join(failed)}')

    out.sort(key=lambda r: (r['start'], r['lg']))
    both = sum(1 for r in out if r.get('id1') and r.get('id2'))
    json.dump(out, open(os.path.join(ROOT, 'data', 'fixtures.json'), 'w'))
    print(f'\n{len(out)} fixtures -> data/fixtures.json '
          f'({both} with both clubs resolved, {len(out) - both} partial)')
    if unmatched:
        rep = os.path.join(ROOT, 'data', 'fixtures_unmatched.json')
        json.dump(unmatched.most_common(), open(rep, 'w'), indent=1)
        print(f'{len(unmatched)} unresolved team names -> data/fixtures_unmatched.json')


if __name__ == '__main__':
    main()
