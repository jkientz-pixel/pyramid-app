#!/usr/bin/env python3
"""Build the youth directory layers: MLS NEXT (boys), ECNL Boys & Girls,
Girls Academy, Elite Academy League (boys), ECNL Regional League Boys &
Girls (TGS orgIDs 16/13), GA Aspire (girls tier two).

Sources:
  * mlsnext — Wikipedia 'MLS Next' Clubs table (club, 'City, State', join
    season); the league's own site has no machine-readable member list.
  * ecnlb / ecnlg — the Total Global Sports API that powers theecnl.com and
    the ECNL app: api.athleteone.com get-org-club-list-by-orgID (12 = boys,
    9 = girls, confirmed against ECNL conference-standings URLs which carry
    the orgID). Returns clubFullName + city + stateCode per club.
  * ga — girlsacademyleague.com/members/ is server-rendered Divi: club lines
    read 'Name (City, ST)' grouped under conference headings. Second teams
    of one club ('Lou Fusz Athletic White') fold into the parent club.
  * ea — the league publishes its club list only as a JPEG on
    eliteacademyleague.com/members/, so data/ea_clubs_2026.json holds the
    transcription. city is filled ONLY where the club's own name states a
    real city; clubs without a league- or self-stated city are logged to
    no_geocode instead of pinned (no-guessed-locations policy).

Locations are settlement-geocoded through the shared data/geocache.json
(Nominatim, 1.1s courtesy delay on misses); a club whose city won't resolve
is skipped and logged rather than pinned wrong.

Folding: a youth club whose normalized name matches an existing NON-youth
club IN THE SAME STATE folds into it (MLS academies collide with their first
teams by design; a same-name club in another state is a different org and
gets its own pin — 'AFC Lightning' GA vs 'Lightning SC' OH). Within the
youth tier one entry per (name, sex): a club fielding both ECNL boys and
girls appears once per sex, mirroring how adult clubs hold one entry per
league membership.

Outputs: clubs appended to js/data.js (unrated, hollow pins),
         per-league fold/geo log to data/youth_report.json.
Idempotent: youth clubs are rebuilt from scratch each run; previously
written youth ids keep their array positions (write_clubs is append-only).
"""
import json, os, re, sys, time, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _datajs import write_clubs
from build_college_layers import api, unwiki, deacc, STATES

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = {'User-Agent': 'RankXI/1.0 (jkientz@gmail.com; youth layer ingest)'}
GEO_CACHE = os.path.join(ROOT, 'data', 'geocache.json')
TGS_API = 'https://api.athleteone.com/api/Event/get-org-club-list-by-orgID/%d'
GA_URL = 'https://girlsacademyleague.com/members/'
# GA Aspire (tier-two GA, launched 2026-27) publishes its directory on the
# membership page in the same Divi 'Name (City, ST)' format as GA members
GAA_URL = 'https://girlsacademyleague.com/aspire-membership/'
YOUTH = ('mlsnext', 'ecnlb', 'ga', 'ecnlg', 'ea', 'ecrlb', 'ecrlg', 'gaa')

# strip only organizational suffixes — location/identity words (united, city,
# academy, SA) are what distinguish real youth orgs from same-token adult clubs
NAME_NOISE = re.compile(r"\b(fc|sc|cf|afc|ac|club|soccer)\b", re.I)
# trailing squad qualifiers: 'Lou Fusz Athletic White' is a second GA team of
# Lou Fusz Athletic, not a separate club
TEAM_QUALIFIER = {'white', 'black', 'blue', 'red', 'gold', 'silver', 'ii'}
# source typos that break geocoding ('Middle Villages, NY' in the wiki table)
CITY_FIX = {'Middle Villages': 'Middle Village', 'Cinncinati': 'Cincinnati'}


def norm(n):
    # trailing 'Academy' folds into the parent club name so MLS academy
    # sides ('Atlanta United FC Academy') collide with their first team
    n = re.sub(r'\s+academy\s*$', '', deacc(n).lower())
    return ' '.join(NAME_NOISE.sub(' ', n).split())


def slugify(n):
    return re.sub(r'-+', '-', re.sub(r'[^a-z0-9]+', '-', deacc(n).lower())).strip('-')


def _cell(raw):
    # wikitext cell may carry attributes: 'rowspan="2"| Commerce City, CO'
    m = re.match(r'\s*[a-z]+="[^"]*"\s*\|(.*)$', raw)
    return unwiki((m.group(1) if m else raw)).strip()


def parse_mlsnext():
    text = api({'action': 'parse', 'page': 'MLS Next', 'prop': 'wikitext',
                'redirects': 1, 'format': 'json'})['parse']['wikitext']['*']
    i = text.find('== Clubs ==')
    if i < 0:
        i = text.find('==Clubs==')
    table = text[i:]
    out = []
    for block in re.split(r'\n\|-\s*', table):
        lines = [l for l in block.split('\n') if l.startswith('|') and not l.startswith('|}')]
        if len(lines) < 2 or lines[0].startswith('|+'):
            continue
        name, loc = _cell(lines[0][1:]), _cell(lines[1][1:])
        m = re.match(r'(.+?),\s*([A-Za-z .]+)$', loc)
        if not (name and m):
            continue
        city, state_name = m.group(1).strip(), m.group(2).strip()
        st = STATES.get(state_name.lower())
        if st:
            out.append({'name': name, 'city': city, 'st': st})
    return out


def parse_tgs(org_id):
    req = urllib.request.Request(TGS_API % org_id,
                                 headers={**UA, 'Accept': 'application/json'})
    data = json.load(urllib.request.urlopen(req, timeout=30))
    out = []
    for c in data.get('data') or []:
        name = (c.get('clubFullName') or c.get('clubName') or '').strip()
        city = (c.get('city') or '').strip()
        st = (c.get('stateCode') or '').strip().upper()
        if name and city and re.fullmatch(r'[A-Z]{2}', st):
            out.append({'name': name, 'city': city, 'st': st})
    return out


def parse_ga(url=GA_URL):
    html = urllib.request.urlopen(
        urllib.request.Request(url, headers=UA), timeout=30
    ).read().decode('utf-8', 'replace')
    text = re.sub(r'<script.*?</script>|<style.*?</style>', '', html, flags=re.S)
    out = []
    for line in re.sub(r'<[^>]+>', '\n', text).split('\n'):
        line = (line.strip().replace('&#038;', '&').replace('&amp;', '&')
                .replace('&#8217;', "'").replace('&#8211;', '-'))
        m = re.match(r'^(.{2,60}?)\s*\(([^,()]+),\s*([A-Z]{2})\)$', line)
        if m:
            out.append({'name': m.group(1), 'city': m.group(2).strip(),
                        'st': m.group(3)})
    return out


def parse_ea():
    src = json.load(open(os.path.join(ROOT, 'data', 'ea_clubs_2026.json')))
    # EA states no locations; the audit file carries cities resolved from
    # OTHER leagues' official directories (scripts/audit_youth_locations.py),
    # source-recorded per club — still league-stated, never guessed
    audit = {}
    ap = os.path.join(ROOT, 'data', 'youth_location_audit.json')
    if os.path.exists(ap):
        audit = json.load(open(ap)).get('resolved', {}).get('ea', {})
    out = []
    for c in src['clubs']:
        hit = None if c['city'] else audit.get(c['n'])
        out.append({'name': c['n'],
                    'city': c['city'] or (hit and hit['city']),
                    'st': c['st'] or (hit and hit['st'])})
    return out


def drop_second_teams(rows, log):
    names = {norm(r['name']) for r in rows}
    keep = []
    for r in rows:
        toks = norm(r['name']).split()
        if len(toks) > 1 and toks[-1] in TEAM_QUALIFIER and ' '.join(toks[:-1]) in names:
            log.append(r['name'])
            continue
        keep.append(r)
    return keep


def geocode(city, st, cache):
    city = CITY_FIX.get(city, city)
    key = f'{city}|{st}'
    if key in cache:
        return tuple(cache[key]) if cache[key] else None
    url = 'https://nominatim.openstreetmap.org/search?' + urllib.parse.urlencode(
        {'q': f'{city}, {st}, USA', 'format': 'json', 'limit': 1})
    ll = None
    try:
        r = json.load(urllib.request.urlopen(
            urllib.request.Request(url, headers=UA), timeout=30))
        if r:
            ll = (round(float(r[0]['lat']), 3), round(float(r[0]['lon']), 3))
    except Exception:
        pass
    cache[key] = list(ll) if ll else None
    time.sleep(1.1)
    return ll


# ECRL orgIDs 16 (boys) / 13 (girls) confirmed via
# get-event-details-by-eventID on 2026-27 conference events (e.g. 4296, 4352),
# whose records carry orgID + current orgSeasonID; the org club list is the
# current-season membership (each club row references its 2026-27 conference
# eventID). Higher leagues parse first so a club fielding ECNL and ECRL teams
# pins once, under the higher league (youth_taken dedupe).
SOURCES = [('mlsnext', 'm', parse_mlsnext),
           ('ecnlb', 'm', lambda: parse_tgs(12)),
           ('ga', 'w', parse_ga),
           ('ecnlg', 'w', lambda: parse_tgs(9)),
           ('ea', 'm', parse_ea),
           ('ecrlb', 'm', lambda: parse_tgs(16)),
           ('ecrlg', 'w', lambda: parse_tgs(13)),
           ('gaa', 'w', lambda: parse_ga(GAA_URL))]


def main():
    dpath = os.path.join(ROOT, 'js', 'data.js')
    cur = open(dpath).read()
    clubs = json.loads(re.search(r'export const CLUBS=(\[.*?\]);', cur, re.S).group(1))
    adults = [c for c in clubs if c['g'] not in YOUTH]
    # fold targets: same normalized name AND same state as an existing
    # non-youth club (cross-state matches are different orgs)
    adult_states = {}
    for c in adults:
        adult_states.setdefault(norm(c['n']), set()).add(c.get('st'))
    taken_ids = {c['id'] for c in adults}
    cache = json.load(open(GEO_CACHE)) if os.path.exists(GEO_CACHE) else {}

    report, new_youth = {}, []
    youth_taken = set()          # (norm name, sex) — one youth pin per sex
    for g, x, parse in SOURCES:
        rows = parse()
        log = {'listed': len(rows), 'folded': [], 'youth_dup': [],
               'second_teams': [], 'no_geocode': [], 'added': 0}
        rows = drop_second_teams(rows, log['second_teams'])
        for r in rows:
            key = norm(r['name'])
            if r['st'] in adult_states.get(key, ()):
                log['folded'].append(r['name'])
                continue
            if (key, x) in youth_taken:
                log['youth_dup'].append(r['name'])
                continue
            # EA publishes no locations: a club without a stated city is
            # logged, never pinned from a guessed coordinate
            if not r.get('city') or not r.get('st'):
                log['no_geocode'].append(f"{r['name']} (no league-stated city)")
                continue
            ll = geocode(r['city'], r['st'], cache)
            if not ll:
                log['no_geocode'].append(f"{r['name']} ({r['city']}, {r['st']})")
                continue
            cid = slugify(r['name'])
            if cid in taken_ids:
                cid = f'{cid}-{g}'
            if cid in taken_ids:
                log['youth_dup'].append(r['name'] + ' (slug)')
                continue
            taken_ids.add(cid)
            youth_taken.add((key, x))
            new_youth.append({'n': r['name'], 'g': g, 'x': x,
                              'la': ll[0], 'lo': ll[1], 'st': r['st'],
                              'ct': r['city'], 'id': cid})
            log['added'] += 1
        report[g] = log
    json.dump(cache, open(GEO_CACHE, 'w'))

    # array position is the legacy-URL map, and other layers may sit AFTER the
    # youth block — so rebuild in place: an existing youth id is replaced at
    # its old position (or kept as-is if its source dropped it this run) and
    # only genuinely new clubs append at the tail
    regen = {c['id']: c for c in new_youth}
    out, stale = [], []
    for c in clubs:
        if c['g'] in YOUTH and c['id'] not in regen:
            stale.append(c['n'])
        out.append(regen.pop(c['id'], c) if c['g'] in YOUTH else c)
    out.extend(regen.values())
    if stale:
        report['kept_stale'] = stale
    write_clubs(out, cur)
    json.dump(report, open(os.path.join(ROOT, 'data', 'youth_report.json'), 'w'),
              indent=1)
    for g, log in report.items():
        if g == 'kept_stale':
            print(f'kept_stale: {len(log)}')
            continue
        print(f"{g}: {log['listed']} listed -> {log['added']} added, "
              f"{len(log['folded'])} folded, {len(log['second_teams'])} second teams, "
              f"{len(log['youth_dup'])} youth dups, {len(log['no_geocode'])} no-geocode")


if __name__ == '__main__':
    main()
