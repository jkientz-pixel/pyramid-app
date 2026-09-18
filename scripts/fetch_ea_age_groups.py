#!/usr/bin/env python3
"""Which age groups each Elite Academy club fields, from the league's own
standings divisions on modular11 (the platform eliteacademyleague.com links to
for its schedule and standings).

EA publishes its member list only as a JPEG, but every team it registers sits
in a standings division, so the division tables are a machine-readable record
of who fields what: U11-U19, in EA (first teams) and EA2 (second teams / the
lower bracket). U11 and U12 are new for 2026-27 and optional by conference.

MEMBERSHIP ONLY. The tables carry W-L-T and goals; this script reads the team
name and division heading and drops the rest before anything touches disk.
Youth pages carry no ratings, fixtures or records, and these are children.

Source call (plain GET, no browser needed):
  /public_schedule/league/get_teams?tournament_type=league&UID_event=27
      &UID_gender=0&UID_age=<age>&list_type=<bracket>
The response is gzip'd HTML whether or not you ask for it.

Output: data/ea_age_groups.json — `clubs`, keyed by CLUBS id, which is all the
app reads. data/ea_age_groups_report.json — `held`, members whose only same-name
page is a women's side (confirm the organization, then alias by hand);
`unpinned`, EA members that have no
page (EA states no locations, so they were never pinned), and `unmatched`, feed
clubs that are not on the EA member list at all. Nothing here adds or pins a club: most of `unmatched` is EA2-only, which
sits below the youth layer's national-league scope.
"""
import datetime, gzip, html, json, os, re, sys, time, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_youth_layers import norm as youth_norm, YOUTH

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'ea_age_groups.json')
REPORT = os.path.join(ROOT, 'data', 'ea_age_groups_report.json')
BASE = 'https://www.modular11.com/public_schedule/league/get_teams'
PAGE = 'https://www.modular11.com/league-standings/elite-academy-league/0/%d/%d'
UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/126 Safari/537.36')
EVENT = 27                                   # Elite Academy League
AGES = {20: 'U11', 17: 'U12', 21: 'U13', 22: 'U14', 33: 'U15', 14: 'U16',
        15: 'U17', 26: 'U19'}
BRACKETS = {47: 'ea', 48: 'ea2'}             # 63 'EA Nationals' mirrors 47
AGE_ORDER = list(AGES.values())
COURTESY_DELAY = 1.0
MIN_CLUBS = 50                               # preflight's floor too

# modular11 team name -> the name on the EA member list, where normalizing
# alone can't bridge them. The member list was transcribed from a JPEG, so
# several of these are its typos ('Foutbol Stras', 'JaBHat', 'Gainsville').
# Only unambiguous pairs: 'PSG Academy DFW' vs 'PSG Dallas' is left unmatched.
ALIAS = {
    'fram soccer club': 'fram cq',
    'flyte sc blue- inland empire': 'flyte sc inland empire',
    'sozo': 'sozos',
    'denver kickers sports club': 'denver kickers sport club',
    'az sandsharks': 'north scottsdale soccer club sandsharks',
    'jahbat': 'jabhat fc',
    'hoosier fc': 'hoosier futbol club',
    'fc dutchmen surf': 'fc dutchmen',
    'global futbol stars 11 academy': 'global foutbol stras 11 academy',
    'ne reds long island': 'north east reds long island',
    'ufa gainesville': 'ufa gainsville',
    'utah athletic (north)': 'utah athletic - north',
    # one Washington club, three sides named for colours in Spanish
    'atletico rojo': 'atletico', 'atletico oro': 'atletico', 'atletico azul': 'atletico',
}
# squad qualifiers that mark a second side of the same club
SQUAD = re.compile(r'\s*(\(\d\)|\b2|\bii|\bblue|\bgreen|\bwhite|\bblack|\bred|\bgold)\s*$', re.I)


def fetch(age, bracket):
    q = urllib.parse.urlencode({'tournament_type': 'league', 'UID_event': EVENT,
                                'UID_gender': 0, 'UID_age': age, 'list_type': bracket})
    req = urllib.request.Request(f'{BASE}?{q}', headers={
        'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest',
        'Referer': PAGE % (age, bracket)})
    raw = urllib.request.urlopen(req, timeout=60).read()
    if raw[:2] == b'\x1f\x8b':
        raw = gzip.decompress(raw)
    return raw.decode('utf-8', 'replace')


def parse_divisions(page):
    """[(division heading, [team name, ...])] from one standings response.
    Records are deliberately not returned."""
    page = re.sub(r'<(script|style)[\s\S]*?</\1>', '', page)
    toks = [t.strip() for t in html.unescape(re.sub(r'<[^>]+>', '|', page)).split('|')]
    toks = [t for t in toks if t]
    out, i = [], 0
    while i < len(toks):
        if toks[i] == 'Rank' and i + 1 < len(toks):
            out.append((toks[i + 1], []))
            i += 11                          # heading + nine column heads
            continue
        is_row = (out and toks[i].isdigit() and i + 1 < len(toks)
                  and not re.fullmatch(r'-?[\d.]+', toks[i + 1]))
        if is_row:
            out[-1][1].append(toks[i + 1])
            i += 11                          # rank, name, nine stat cells
            if i < len(toks) and toks[i] == 'MP':
                i += 14                      # the expandable home/away sub-row
            continue
        i += 1
    return out


def club_of(team):
    """'Rangers FC 2' / 'ALBION SC San Diego (1)' -> the club's own name."""
    prev = None
    while prev != team:
        prev, team = team, SQUAD.sub('', team).strip()
    return team


def norm(name):
    n = ALIAS.get(name.strip().lower(), name.strip().lower())
    n = n.replace('football club', 'fc').replace('soccer club', 'sc')
    n = re.sub(r'\b(fc|sc|the)\b', ' ', n)
    return re.sub(r'[^a-z0-9]', '', n)


def division_label(heading):
    """'U12 Southwest EA Division' -> 'Southwest EA'."""
    return re.sub(r'^U\d+\s+|\s+Division$', '', heading).strip()


# an audit state counts only when the club itself stated it. The audit file
# also carries states joined in from other leagues' directories BY NAME, and
# from our own club records — using those to confirm a name match is circular
OWN_WORDS = ('club website', "club's own page")


def stated_state(member, audit):
    if member.get('st'):
        return member['st']
    hit = audit.get(member['n']) or {}
    return hit.get('st') if hit.get('source', '').lower().startswith(OWN_WORDS) else None


def resolve_members(members, all_clubs, audit):
    """EA member name -> CLUBS id, following the youth build's own folding.
    Returns (resolved, held).

    An EA member is pinned under 'ea' only when nothing outranks it: a club
    that also plays MLS NEXT keeps its MLS NEXT pin, and one whose name matches
    an adult club IN THE SAME STATE folds into that club. So the member list,
    not the 'ea' tag, is the universe. Two guards keep a shared name from
    becoming a wrong organization:
      * the state must be one the member itself states — EA's 'FC Stars' plays
        in Mid-America and is not FC Stars of Massachusetts, which is where a
        name-joined directory state sent it. No own state, no match.
      * the page must be a men's side. A same-name women's team is probably
        the same organization, but 'probably' does not put a boys' academy
        roll on a WPSL page: those go to `held` for a human to confirm."""
    live = [c for c in all_clubs if not c.get('h')]
    resolved, held = {}, {}
    for m in members:
        key = youth_norm(m['n'])
        own = [c for c in live if c['g'] == 'ea' and youth_norm(c['n']) == key]
        if own:
            resolved[m['n']] = own[0]['id']
            continue
        st = stated_state(m, audit)
        same = [c for c in live if st and c.get('st') == st and youth_norm(c['n']) == key]
        mens = sorted((c for c in same if c.get('x') == 'm'),
                      key=lambda c: c['g'] not in YOUTH)   # a boys' youth pin first
        if mens:
            resolved[m['n']] = mens[0]['id']
        elif same:
            held[m['n']] = [f"{c['id']} ({c['g']}, {c.get('x')})" for c in same]
    return resolved, held


def build(pages, members, member_ids):
    """pages: {(age label, tier): html}; members: the EA member list;
    member_ids: resolve_members() output."""
    by_norm = {norm(m['n']): m['n'] for m in members}
    clubs, unpinned, unmatched = {}, {}, {}
    blank = lambda: {'ea': set(), 'ea2': set(), 'div': {'ea': set(), 'ea2': set()}}
    for (age, tier), page in pages.items():
        for heading, teams in parse_divisions(page):
            for team in teams:
                name = team if team.strip().lower() in ALIAS else club_of(team)
                member = by_norm.get(norm(name))
                if member is None:
                    rec = unmatched.setdefault(name, blank())
                elif member in member_ids:
                    rec = clubs.setdefault(member_ids[member], blank())
                else:
                    rec = unpinned.setdefault(member, blank())
                rec[tier].add(age)
                rec['div'][tier].add(division_label(heading))
    tidy = lambda d: {k: {'ea': sorted(r['ea'], key=AGE_ORDER.index),
                          'ea2': sorted(r['ea2'], key=AGE_ORDER.index),
                          'div': {t: sorted(v) for t, v in r['div'].items() if v}}
                      for k, r in sorted(d.items())}
    return tidy(clubs), tidy(unpinned), tidy(unmatched)


def main():
    src = open(os.path.join(ROOT, 'js', 'data.js')).read()
    all_clubs = json.loads(re.search(r'export const CLUBS=(\[.*?\]);', src, re.S).group(1))
    members = json.load(open(os.path.join(ROOT, 'data', 'ea_clubs_2026.json')))['clubs']
    audit = json.load(open(os.path.join(ROOT, 'data', 'youth_location_audit.json'))
                      ).get('resolved', {}).get('ea', {})
    member_ids, held = resolve_members(members, all_clubs, audit)
    pages = {}
    for age, label in AGES.items():
        for bracket, tier in BRACKETS.items():
            pages[(label, tier)] = fetch(age, bracket)
            time.sleep(COURTESY_DELAY)
    clubs, unpinned, unmatched = build(pages, members, member_ids)
    # relative AND absolute: half of nothing is nothing, and an empty roll
    # written over a good file is the failure this exists to stop
    if len(clubs) < max(MIN_CLUBS, len(member_ids) // 2):
        sys.exit(f'only {len(clubs)} of {len(member_ids)} pinned EA members matched — '
                 'feed shape changed? keeping the existing file')
    source = ('modular11.com Elite Academy League standings divisions (event 27; '
              'brackets 47 EA / 48 EA2). Team name + division only — no records, '
              'scores or players are stored.')
    stamp = {'_source': source, 'season': '2026-27',
             'updated': datetime.date.today().isoformat()}
    # the app fetches OUT on club pages, so it carries only what a page shows;
    # the clubs this run could not place live in the report, for a human
    json.dump({**stamp, 'clubs': clubs}, open(OUT, 'w'), separators=(',', ':'))
    json.dump({**stamp, 'held': held, 'unpinned': unpinned, 'unmatched': unmatched},
              open(REPORT, 'w'), indent=1)
    print(f'{len(members)} EA members: {len(member_ids)} have a page ({len(held)} held), '
          f'{len(clubs)} of those matched the feed; {len(unpinned)} matched but have '
          f'no page; {len(unmatched)} feed clubs are not on the member list')
    quiet = [m['n'] for m in members
             if member_ids.get(m['n']) not in clubs and m['n'] not in unpinned]
    if quiet:
        print('members with no team in the feed:', '; '.join(quiet))


if __name__ == '__main__':
    main()
