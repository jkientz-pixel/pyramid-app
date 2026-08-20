#!/usr/bin/env python3
"""Map ESPN's college team names onto Ranked XI club ids, once, into
data/espn_club_map.json.

ESPN writes short names ("Akron", "Cal State Fullerton") and this app stores
full institutional ones ("University of Akron Zips"). There is no shared key,
so the join has to be built — and a wrong join is worse than none: it would
hang another school's results on a club page. The rules below therefore refuse
anything they cannot land on exactly one club, and the leftovers are written to
the map as nulls so the count is visible instead of silently absorbed.

Run after scripts/fetch_espn_college.py refreshes the results file."""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(ROOT, 'js', 'data.js')).read()
CLUBS = json.loads(re.search(r'export const CLUBS=(\[.*?\]);', src, re.S).group(1))
ESPN = json.load(open(os.path.join(ROOT, 'data', 'espn_college_2025.json')))

MEN = {'ncaa1', 'ncaa2', 'ncaa3', 'naia'}
WOMEN = {'ncaa1w', 'ncaa2w'}

# ESPN's D1 schedule includes D2/D3/NAIA opponents, so each feed is matched
# against every college layer of that sex, not just its own division.
POOLS = {'ncaa1': MEN, 'ncaa1w': WOMEN}

# Systematic shorthands ESPN uses that no amount of tokenising will recover.
# Patterns are applied to the raw name before normalisation; each is a rename,
# never a guess about which school is meant.
REWRITES = [
    (r'^Cal Poly$',            'California Polytechnic State University'),
    (r'^Cal Poly Humboldt$',   'California State Polytechnic University Humboldt'),
    (r'^(?:Cal State|CSU) (.+)$', r'California State University \1'),
    (r'^UC (.+)$',             r'University of California \1'),
    (r'^UCLA$',                'University of California Los Angeles'),
    (r'^USC$',                 'University of Southern California'),
    (r'^BYU$',                 'Brigham Young University'),
    (r'^Army$',                'United States Military Academy'),
    (r'^Navy$',                'United States Naval Academy'),
    (r'^Air Force$',           'United States Air Force Academy'),
    (r'^IU (.+)$',             r'Indiana University \1'),
    (r'^Penn$',                'University of Pennsylvania'),
    (r'^Ole Miss$',            'University of Mississippi'),
    (r'^Pitt$',                'University of Pittsburgh'),
    (r'^UMass(?: (.+))?$',     r'University of Massachusetts \1'),
    (r'^UMBC$',                'University of Maryland Baltimore County'),
    (r'^UNC (.+)$',            r'University of North Carolina \1'),
    (r'^UT (.+)$',             r'University of Texas \1'),
    (r'^SIU (.+)$',            r'Southern Illinois University \1'),
    (r'^LIU$',                 'Long Island University'),
    (r'^VCU$',                 'Virginia Commonwealth University'),
    (r'^SMU$',                 'Southern Methodist University'),
    (r'^TCU$',                 'Texas Christian University'),
    (r'^FIU$',                 'Florida International University'),
    (r'^FGCU$',                'Florida Gulf Coast University'),
    (r'^UTSA$',                'University of Texas at San Antonio'),
    (r'^UTEP$',                'University of Texas at El Paso'),
    (r'^UNLV$',                'University of Nevada Las Vegas'),
    (r'^ETSU$',                'East Tennessee State University'),
    (r'^UIC$',                 'University of Illinois Chicago'),
    (r'^App State$',           'Appalachian State University'),
    (r'\s*\((?:[A-Z]{2}|[A-Za-z .]+)\)$', ''),   # trailing state disambiguators
]

ABBR = {'st': 'state', 'intl': 'international', 'poly': 'polytechnic'}
STOP = {'university', 'college', 'of', 'the', 'at'}


def rewrite(name):
    out = name
    for pat, rep in REWRITES:
        new = re.sub(pat, rep, out)
        if new != out:
            out = new.strip()
    return out


def norm(t):
    # "A&M" must expand before '&' is flattened, or it tokenises to "a and m"
    t = re.sub(r'\bA&M\b', ' Agricultural and Mechanical ', t)
    t = re.sub(r'\bA&T\b', ' Agricultural and Technical ', t)
    t = t.lower().replace('&', ' and ').replace('-', ' ').replace('.', ' ').replace("'", '')
    t = re.sub(r'[^a-z0-9 ]', ' ', t)
    return ' '.join(ABBR.get(w, w) for w in t.split())


def words(t):
    return [w for w in norm(t).split() if w not in STOP]


def type_conflict(espn_name, club_name):
    """True when ESPN names the institution type and the club's is the other
    one — "X College" must not match "X University"."""
    e, c = espn_name.lower(), club_name.lower()
    for stated, other in (('college', 'university'), ('university', 'college')):
        if re.search(rf'\b{stated}\b', e) and re.search(rf'\b{other}\b', c) \
                and not re.search(rf'\b{stated}\b', c):
            return True
    return False


def build_index(leagues):
    return [(c, words(c['n']), norm(c['n'])) for c in CLUBS if c['g'] in leagues]


# A team playing a full D1 schedule is a D1 team. In these feeds the regulars
# appear 17-24 times and the visiting D2/D3/NAIA opponents 1-3, so the gap is
# wide and this threshold sits in the middle of it rather than on an edge.
REGULAR_MIN = 8


def match(name, index, own_division=None, appearances=0):
    """Return (club_id, rule) or (None, reason). Only ever returns a club when
    exactly one candidate survives."""
    key = words(rewrite(name))
    n = len(key)
    if not n:
        return None, 'empty'
    hits = [h for h in index
            if any(h[1][i:i + n] == key for i in range(len(h[1]) - n + 1))]
    # A side with a full D1 schedule must land on a D1 club or on nothing. The
    # app's D1 men's list holds 209 of ESPN's 266 teams, so without this the
    # single-candidate rule below still fired for a name whose real club is
    # simply absent: ESPN's "Georgetown" — the Hoyas, 22 matches — was handed
    # to Georgetown College, an NAIA school in Kentucky, because that was the
    # only men's college club whose name contained the word.
    if appearances >= REGULAR_MIN and own_division:
        hits = [h for h in hits if h[0]['g'] == own_division]
        if not hits:
            return None, 'd1-regular-absent'
    # "Regis College" (Massachusetts) and "Regis University" (Colorado) are two
    # schools sharing a word. Normalisation drops College/University as noise,
    # which is right for "Akron" vs "University of Akron" and wrong here — so
    # when ESPN states the type explicitly, the club has to agree.
    hits = [h for h in hits if not type_conflict(name, h[0]['n'])]
    if len(hits) == 1:
        return hits[0][0]['id'], 'unique'
    if not hits:
        return None, 'no-candidate'
    # A D1 feed's teams are D1 sides. Without this, ESPN's "Georgetown" — the
    # Hoyas, a D1 programme — landed on Georgetown College, an NAIA school in
    # Kentucky, purely because its name is shorter.
    if own_division:
        same = [h for h in hits if h[0]['g'] == own_division]
        if len(same) == 1:
            return same[0][0]['id'], 'own-division'
    # ESPN writes a flagship campus as the bare state name; the flagship is the
    # one styled "University of X", not "X State University".
    flagship = [h for h in hits if f'university of {" ".join(key)}' in h[2]]
    if len(flagship) == 1:
        return flagship[0][0]['id'], 'flagship'
    # There was a "fewest extra words wins" rule here. It is gone: the app's D1
    # men's list has 209 of ESPN's 266 teams, so when a name has no correct
    # target the rule still returned one. ESPN's "Georgetown" is the Hoyas, a
    # D1 programme the app doesn't carry, and the rule handed its season to
    # Georgetown College — an NAIA school in Kentucky. Ambiguity now resolves
    # to no link, which is what the club-linking rule elsewhere already does.
    return None, f'ambiguous:{len(hits)}'


# how far each rule is trusted when two names land on the same club
CONFIDENCE = {'unique': 3, 'own-division': 2, 'flagship': 1}


def main():
    out = {}
    for feed, pool in POOLS.items():
        index = build_index(pool)
        names = set()
        for row in ESPN[feed]:
            names.add(row['t1'])
            names.add(row['t2'])
        appear = {}
        for row in ESPN[feed]:
            appear[row['t1']] = appear.get(row['t1'], 0) + 1
            appear[row['t2']] = appear.get(row['t2'], 0) + 1
        mapping, rules, counts = {}, {}, {}
        for nm in sorted(names):
            club, rule = match(nm, index, own_division=feed,
                               appearances=appear.get(nm, 0))
            mapping[nm] = club
            rules[nm] = rule
            k = rule.split(':')[0]
            counts[k] = counts.get(k, 0) + 1

        # Two ESPN names landing on one club means at least one is wrong.
        # "Colorado" reached Colorado College by the shortest rule while
        # "Colorado College" reached it by exact match: keep the confident
        # one and drop the other rather than hang a season on the wrong side.
        claimed = {}
        for nm in sorted(names):
            cid = mapping[nm]
            if not cid:
                continue
            prev = claimed.get(cid)
            if prev is None:
                claimed[cid] = nm
                continue
            keep, drop = (nm, prev) if CONFIDENCE[rules[nm].split(':')[0]] > \
                CONFIDENCE[rules[prev].split(':')[0]] else (prev, nm)
            if CONFIDENCE[rules[keep].split(':')[0]] == CONFIDENCE[rules[drop].split(':')[0]]:
                keep = None                      # equally confident: trust neither
                mapping[prev] = None
            mapping[drop] = None
            counts['collision'] = counts.get('collision', 0) + 1
            print(f'    collision on {cid}: ' + (f'kept "{keep}", dropped "{drop}"'
                  if keep else f'dropped both "{prev}" and "{nm}" (equally weak rules)'))
            if keep:
                claimed[cid] = keep

        out[feed] = mapping
        matched = sum(1 for v in mapping.values() if v)
        print(f'  {feed}: {matched}/{len(names)} teams mapped '
              f'({100 * matched // len(names)}%) {counts}')

    for feed, mapping in out.items():
        seen = {}
        for nm, cid in mapping.items():
            if not cid:
                continue
            if cid in seen:
                sys.exit(f'FATAL: {feed}: "{nm}" and "{seen[cid]}" both map to {cid}')
            seen[cid] = nm

    path = os.path.join(ROOT, 'data', 'espn_club_map.json')
    json.dump(out, open(path, 'w'), separators=(',', ':'), sort_keys=True)
    print(f'wrote {path}')


if __name__ == '__main__':
    main()
