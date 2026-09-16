#!/usr/bin/env python3
"""Current-edition U.S. Open Cup ties from ESPN -> data/opencup_live.json.

The Cup page (#/opencup) tells one edition round by round. Its historical
source is Wikipedia (scripts/bank_opencup.py -> data/opencup_matches.json),
which carries the league tags the tier badges and the rating receipts depend
on — but Wikipedia lags a semifinal by hours to days, and it never knows a
kickoff time, a venue or a broadcaster. ESPN's scoreboard does, under the slug
`usa.open`, and it carries the whole proper draw of the current year with
scores. This script banks that year's events so the page can show what is
next, what just happened, and where to watch, without the browser ever
calling ESPN (the site CSP is `connect-src 'self'`, on purpose).

Same host and the same two rules as fetch_fixtures.py:

  * plain User-Agent only — a browser UA gets a 403, do not "fix" it;
  * club names resolve to ids HERE, at build time, so a wrong match is a
    logged miss rather than a card linking the wrong club. Ambiguity is None.

Failure is soft: a fetch error keeps the last committed file and exits 0 with
a warning, because a semifinal preview that is a day stale beats a run that
blocks rosters and ratings for an ESPN hiccup (2026-09-06 precedent).
"""
from _datajs import load_clubs, ROOT
import collections, json, os, re, sys, time, unicodedata, urllib.request

UA = {'User-Agent': 'curl/8.4.0'}
API = ('https://site.api.espn.com/apis/site/v2/sports/soccer/usa.open/'
       'scoreboard?dates=%s&limit=1000')  # a bare YYYY = the whole edition;
# YYYYMMDD-YYYYMMDD ranges 400 since 2026-09-16 (see scripts/_espn.py)
OUT = os.path.join(ROOT, 'data', 'opencup_live.json')

# ESPN's season slug -> the round name Wikipedia's articles use, which is the
# name opencup_matches.json carries and the page groups by. An unknown slug
# ships as its own words so a new round type is visible, never dropped.
ROUND = {
    'first-round': 'First round', 'second-round': 'Second round',
    'third-round': 'Third round', 'fourth-round': 'Fourth round',
    'round-of-64': 'Round of 64', 'round-of-32': 'Round of 32',
    'round-of-16': 'Round of 16', 'quarterfinals': 'Quarterfinals',
    'semifinals': 'Semifinals', 'final': 'Final',
}

# ESPN spellings for clubs we hold under another name — same table shape as
# fetch_fixtures.py, kept separate because the Cup draws from every tier.
ALIAS = {
    'new york city fc': 'NYCFC',
    'red bull new york': 'New York Red Bulls',
    'st. louis city sc': 'St. Louis City SC',
}


# leagues whose members are academies, not the senior club — never a Cup entrant
YOUTH = {'mlsnext', 'ecnlb', 'ga', 'ecnlg', 'ea', 'ecrlb', 'ecrlg', 'gaa', 'pecnlb', 'pecnlg'}
# the pyramid, top down, for breaking a dual-league name tie
LEAGUE_RANK = {g: i for i, g in enumerate(
    ['mls', 'uslc', 'usl1', 'mnp', 'nisa', 'npsl', 'usl2', 'upsl', 'apsl',
     'mwpl', 'swpl', 'mpl', 'cpl', 'gcpl', 'eplwa', 'sfsfl', 'csl', 'lisfl', 'loc'])}


def deacc(x):
    return unicodedata.normalize('NFKD', x or '').encode('ascii', 'ignore').decode()


def strip(s):
    s = deacc(s).lower()
    s = re.sub(r'\b(fc|sc|cf|afc|club|the)\b', ' ', s)
    return re.sub(r'[^a-z0-9]', '', s)


def fetch(url):
    return json.load(urllib.request.urlopen(
        urllib.request.Request(url, headers=UA), timeout=60))


def round_name(slug):
    if slug in ROUND:
        return ROUND[slug]
    return (slug or '').replace('-', ' ').strip().capitalize() or 'Unknown round'


def main():
    year = int(os.environ.get('OPENCUP_YEAR') or time.gmtime().tm_year)
    # men's senior clubs only: the Cup is a men's competition, the college
    # short names ("Georgetown") must never swallow a pro or amateur side, and
    # a youth academy that shares its parent's name ("El Paso Locomotive FC"
    # in ECNL) must not make the USL Championship club ambiguous
    clubs = [c for c in load_clubs()
             if not c.get('h') and c.get('x') == 'm'
             and c.get('g') not in YOUTH
             and not str(c.get('g', '')).startswith(('ncaa', 'naia'))]
    exact = collections.defaultdict(list)
    loose = collections.defaultdict(list)
    for c in clubs:
        exact[deacc(c['n']).lower()].append(c)
        loose[strip(c['n'])].append(c)

    def pick(hits):
        """One club or None. A club fielding sides in two leagues is two
        records by design (Jeremy's ruling, recalibrate2); the Cup entry is
        the senior one, so the higher-tier record wins. Two records at the
        same tier stay ambiguous — a missing crest beats the wrong club."""
        if not hits:
            return None
        if len(hits) == 1:
            return hits[0]['id']
        ranked = sorted(hits, key=lambda c: LEAGUE_RANK.get(c['g'], 99))
        top = LEAGUE_RANK.get(ranked[0]['g'], 99)
        if top < 99 and LEAGUE_RANK.get(ranked[1]['g'], 99) != top:
            return ranked[0]['id']
        return None

    def resolve(name):
        name = ALIAS.get((name or '').lower(), name)
        return pick(exact.get(deacc(name).lower())) or pick(loose.get(strip(name)))

    try:
        data = fetch(API % year)
    except Exception as e:  # noqa: BLE001 — any transport error is the same to us
        print(f'WARNING: usa.open fetch failed ({e}); keeping the last file', file=sys.stderr)
        return 0

    out, unmatched = [], collections.Counter()
    for e in data.get('events', []):
        comp = (e.get('competitions') or [{}])[0]
        st = ((comp.get('status') or e.get('status') or {}).get('type') or {})
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
                unmatched[nm] += 1
        rec = {
            'round': round_name((e.get('season') or {}).get('slug')),
            'start': (e.get('date') or '').replace('Z', ':00.000Z'),
            'state': st.get('state') or 'pre',        # pre | in | post
            't1': hn, 't2': an,
        }
        if hid: rec['id1'] = hid
        if aid: rec['id2'] = aid
        venue = ((comp.get('venue') or {}).get('fullName') or '')
        if venue: rec['venue'] = venue
        tv = [n for b in (comp.get('broadcasts') or []) for n in (b.get('names') or [])]
        if tv: rec['tv'] = tv
        if rec['state'] != 'pre':
            try:
                rec['score'] = [int(h.get('score') or 0), int(a.get('score') or 0)]
            except (TypeError, ValueError):
                rec['score'] = None
            detail = (st.get('shortDetail') or st.get('detail') or '')
            if 'AET' in detail.upper():
                rec['aet'] = True
            if 'PEN' in detail.upper():
                rec['pens'] = True
            if rec['state'] == 'post':
                rec['winner'] = 1 if h.get('winner') else 2 if a.get('winner') else 0
            elif rec['state'] == 'in':
                rec['clock'] = (comp.get('status') or {}).get('displayClock') or ''
        out.append(rec)

    out.sort(key=lambda r: r['start'])
    both = sum(1 for r in out if r.get('id1') and r.get('id2'))
    json.dump({'year': year, 'fetched': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
               'source': 'ESPN scoreboard (usa.open)', 'ties': out},
              open(OUT, 'w'), separators=(',', ':'))
    print(f'{len(out)} {year} Open Cup ties -> data/opencup_live.json '
          f'({both} with both clubs resolved, {len(out) - both} partial)')
    if unmatched:
        print('unresolved: ' + ', '.join(f'{n} x{k}' for n, k in unmatched.most_common()))
    return 0


if __name__ == '__main__':
    sys.exit(main())
