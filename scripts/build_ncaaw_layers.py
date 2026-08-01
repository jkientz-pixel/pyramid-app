#!/usr/bin/env python3
"""Build the NCAA Division I + II women's soccer layers.

Mirrors build_college_layers.py (D3/NAIA men's) with one large shortcut:
most women's-soccer schools already exist as ncaa1/ncaa2 men's clubs, so
coordinates, city, url, socials and the school crest are cloned from the
men's entry instead of re-derived. Schools that field women's soccer but not
men's (a third of D1 — Alabama, Texas, Tennessee, ...) fall back to the
Wikipedia-article + Nominatim path the D3/NAIA build used.

Inputs:  data/massey_d1w.json, data/massey_d2w.json  (scrape_massey.py d1w d2w)
Sources: Wikipedia 'List of NCAA Division I institutions' / Division II
Outputs: CLUBS entries (g=ncaa1w / g=ncaa2w, x=w, id = men's slug + '-w'),
         massey-name maps merged into data/massey_college_map.json
         (run apply_massey.py after to rate), leftovers merged into
         data/college_unmatched.json.

Idempotent: existing ncaa1w/ncaa2w clubs are rebuilt from scratch each run.
"""
import json, os, re, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_college_layers as bcl
from build_college_layers import (parse_list, match_school, coords_for,
                                  nominatim, slugify, unwiki, first_link,
                                  deacc, api, STATES)
from _datajs import write_clubs

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LISTS = {'ncaa1w': 'List of NCAA Division I institutions',
         'ncaa2w': 'List of NCAA Division II institutions'}
MASSEY = {'ncaa1w': 'massey_d1w.json', 'ncaa2w': 'massey_d2w.json'}
CLONE_FIELDS = ('la', 'lo', 'st', 'ct', 'url', 'sx', 'si', 'img')

# Massey women's names the token matcher can't resolve — anchored to the
# exact school name in the Wikipedia institution lists (hand-verified)
bcl.ALIAS.update({
    'CS Poly Pomona': 'California State Polytechnic University, Pomona',
    'Simon Fraser': 'Simon Fraser University',
    'Nova SE': 'Nova Southeastern University',
    'Azusa Pacific': 'Azusa Pacific University',
    'CS Stanislaus': 'California State University, Stanislaus',
    'West Florida': 'University of West Florida',
    'Cal St-LA': 'California State University, Los Angeles',
    'CS Chico': 'California State University, Chico',
    'CS San Marcos': 'California State University San Marcos',
    'C Missouri': 'University of Central Missouri',
    'Hawaii Hilo': "University of Hawai'i at Hilo",
    'CSU East Bay': 'California State University, East Bay',
    'CS San Bern.': 'California State University, San Bernardino',
    'Midwest TX St': 'Midwestern State University',
    'Concordia SP': 'Concordia University–St. Paul',
    'C Oklahoma': 'University of Central Oklahoma',
    'CS Monterey Bay': 'California State University, Monterey Bay',
    'CS Dom. Hills': 'California State University, Dominguez Hills',
    'UT Dallas': 'University of Texas at Dallas',
    'UT Tyler': 'University of Texas at Tyler',
    'C Washington': 'Central Washington University',
    'T Jefferson': 'Thomas Jefferson University',
    'NE Oklahoma': 'Northeastern State University',
    'St Anselm': 'Saint Anselm College',
    'N Michigan': 'Northern Michigan University',
    'Georgia C&S': 'Georgia College & State University',
    'Hawaii Pacific': "Hawai'i Pacific University",
    'Connecticut': 'University of Connecticut',
    'CS Fullerton': 'California State University, Fullerton',
    'Army': 'United States Military Academy',
    'UT San Antonio': 'University of Texas at San Antonio',
    'Loy Marymount': 'Loyola Marymount University',
    'CS Northridge': 'California State University, Northridge',
    'CS Bakersfield': 'California State University, Bakersfield',
    'UNC Wilmington': 'University of North Carolina at Wilmington',
    'Boston Univ': 'Boston University',
    'MTSU': 'Middle Tennessee State University',
    'Mid Georgia': 'Middle Georgia State University',
    'UT San Antonio': 'The University of Texas at San Antonio',
    'Missouri KC': 'University of Missouri–Kansas City',
    'WKU': 'Western Kentucky University',
    'CS Sacramento': 'California State University, Sacramento',
    'Ga Southern': 'Georgia Southern University',
    'ETSU': 'East Tennessee State University',
    'SF Austin': 'Stephen F. Austin State University',
    'N Colorado': 'University of Northern Colorado',
    'Coastal Car': 'Coastal Carolina University',
    'N Kentucky': 'Northern Kentucky University',
    'S Illinois': 'Southern Illinois University Carbondale',
    'N Illinois': 'Northern Illinois University',
    'F Dickinson': 'Fairleigh Dickinson University',
    'SE Louisiana': 'Southeastern Louisiana University',
    'Ark Little Rock': 'University of Arkansas at Little Rock',
    'G Washington': 'The George Washington University',
    'C Michigan': 'Central Michigan University',
    'Central Conn': 'Central Connecticut State University',
    'IUPUI': 'Indiana University Indianapolis',
    'TAM C. Christi': 'Texas A&M University–Corpus Christi',
    'SE Missouri St': 'Southeast Missouri State University',
    'PFW': 'Purdue University Fort Wayne',
    'Ark Pine Bluff': 'University of Arkansas at Pine Bluff',
    'Missouri S&T': 'Missouri University of Science and Technology',
    'Lincoln Mem': 'Lincoln Memorial University',
    'Palm Beach Atl': 'Palm Beach Atlantic University',
    'MT St-Billings': 'Montana State University Billings',
    'E Stroudsburg': 'East Stroudsburg University',
    'CSU-Pueblo': 'Colorado State University–Pueblo',
    'Roberts Wslyn': 'Roberts Wesleyan University',
    'S New Hampshire': 'Southern New Hampshire University',
    'NW Oklahoma St': 'Northwestern Oklahoma State University',
    'Metro St': 'Metropolitan State University of Denver',
    'S Francisco St': 'San Francisco State University',
    'W Texas A&M': 'West Texas A&M University',
    'Wm Jessup': 'Jessup University',
    'S Connecticut': 'Southern Connecticut State University',
    'Michigan Tech': 'Michigan Technological University',
    'Western St CO': 'Western Colorado University',
    'SW Baptist': 'Southwest Baptist University',
    'SW Minnesota': 'Southwest Minnesota State University',
    "Auburn M'gomery": 'Auburn University at Montgomery',
    'S Wesleyan': 'Southern Wesleyan University',
    'Pitt-Johnstown': 'University of Pittsburgh at Johnstown',
})


# teams absent from the institution lists (left the division or sit in a
# reclassification table with yet another row format) — school-stated specs
MANUAL = {
    'West Florida': {'article': 'University of West Florida',
                     'school': 'University of West Florida', 'nick': 'Argonauts',
                     'city': 'Pensacola', 'st': 'FL'},
    'Azusa Pacific': {'article': 'Azusa Pacific University',
                      'school': 'Azusa Pacific University', 'nick': 'Cougars',
                      'city': 'Azusa', 'st': 'CA'},
}


def parse_d1_list(title):
    """The Division I institutions list uses one-cell-per-line rows
    (School | Common name | Nickname | City | State | ...) rather than the
    scope="row" format parse_list handles. The Common name column is gold:
    it's the same short-name space Massey uses."""
    text = api({'action': 'parse', 'page': title, 'prop': 'wikitext',
                'redirects': 1, 'format': 'json'})['parse']['wikitext']['*']
    out = []
    for block in re.split(r'\n\|-\s*', text):
        lines = [l for l in block.split('\n') if l.startswith('|') and not l.startswith('|}')]
        if len(lines) < 5 or not lines[0].lstrip('|').strip().startswith('[['):
            continue
        cells = [l[1:].strip() for l in lines[:5]]
        school = re.sub(r'[*†‡]+$', '', unwiki(cells[0])).strip()
        article = first_link(cells[0]) or school
        common, nick, city = unwiki(cells[1]), unwiki(cells[2]), unwiki(cells[3])
        m = re.search(r'\[\[[^|\]]+\|([A-Z]{2})\]\]|\[\[([A-Z]{2})\]\]', cells[4])
        st = (m.group(1) or m.group(2)) if m else STATES.get(unwiki(cells[4]).lower())
        if not (school and nick and city and st):
            continue
        out.append({'article': article, 'school': school, 'nick': nick,
                    'city': city, 'st': st, 'common': common})
    return out


def norm_common(s):
    s = deacc(s).lower().replace('.', '').replace("'", '')
    s = re.sub(r'\bst$', 'state', s)
    s = re.sub(r'[^a-z0-9]+', ' ', s).strip()
    return s


def main():
    dpath = os.path.join(ROOT, 'js', 'data.js')
    cur = open(dpath).read()
    clubs = json.loads(re.search(r'export const CLUBS=(\[.*?\]);', cur, re.S).group(1))
    clubs = [c for c in clubs if c['g'] not in ('ncaa1w', 'ncaa2w')]
    taken = {c['id'] for c in clubs}
    # men's college clubs indexed by slug — the clone source
    mens = {c['id']: c for c in clubs if c['g'] in ('ncaa1', 'ncaa2', 'ncaa3', 'naia')}

    mpath = os.path.join(ROOT, 'data', 'massey_college_map.json')
    college_map = json.load(open(mpath)) if os.path.exists(mpath) else {}
    upath = os.path.join(ROOT, 'data', 'college_unmatched.json')
    unmatched_all = json.load(open(upath)) if os.path.exists(upath) else {}

    new_clubs = []
    for div, list_title in LISTS.items():
        rows = json.load(open(os.path.join(ROOT, 'data', MASSEY[div])))
        if div == 'ncaa1w':
            schools = parse_d1_list(list_title)
            by_common = {}
            for s in schools:
                by_common.setdefault(norm_common(s['common']), []).append(s)
        else:
            schools = parse_list(list_title)
            by_common = {}
        print(f'{div}: {len(rows)} massey teams, {len(schools)} listed schools')
        matched, misses = {}, []
        for r in rows:
            hits = by_common.get(norm_common(r['team']), [])
            s = (MANUAL.get(r['team'])
                 or (hits[0] if len(hits) == 1 else match_school(r['team'], schools, div)))
            if s and s['article'] not in {m['article'] for m in matched.values()}:
                matched[r['team']] = s
            else:
                mt_toks = __import__('build_college_layers').toks(r['team'], massey=True)
                tk = __import__('build_college_layers').toks
                near = max(schools, key=lambda sc: len(mt_toks & tk(sc['school'] + ' ' + sc['nick'])), default=None)
                misses.append({'team': r['team'],
                               'nearest': near['school'] if near and mt_toks & tk(near['school'] + ' ' + near['nick']) else None})
        # split matched schools into clone-from-men's vs needs-own-coords
        need_coords = {}
        for mteam, s in matched.items():
            disp = re.sub(r'\s*\([^)]*\)$', '', s['school'])
            mens_id = slugify(f"{disp} {s['nick']}")
            if mens_id not in mens:
                need_coords[mteam] = s
        coords = coords_for({s['article'] for s in need_coords.values()})
        cloned = geo = wiki = 0
        college_map[div] = {}
        for mteam, s in sorted(matched.items()):
            disp = re.sub(r'\s*\([^)]*\)$', '', s['school'])
            n = f"{disp} {s['nick']}"
            mens_id = slugify(n)
            cid = mens_id + '-w'
            if cid in taken:
                misses.append({'team': mteam, 'nearest': s['school'] + ' (slug collision)'})
                continue
            src = mens.get(mens_id)
            if src:
                club = {'n': n, 'g': div, 'x': 'w',
                        **{k: src[k] for k in CLONE_FIELDS if k in src},
                        'id': cid}
                cloned += 1
            else:
                ll = coords.get(s['article'])
                if ll:
                    wiki += 1
                else:
                    ll = nominatim(s['city'], s['st'])
                    time.sleep(1.1)
                    if ll:
                        geo += 1
                if not ll:
                    misses.append({'team': mteam, 'nearest': s['school'] + ' (no coords)'})
                    continue
                club = {'n': n, 'g': div, 'x': 'w', 'la': ll[0], 'lo': ll[1],
                        'st': s['st'], 'ct': s['city'], 'id': cid}
            taken.add(cid)
            new_clubs.append(club)
            college_map[div][mteam] = cid
        unmatched_all[div] = misses
        print(f'{div}: built {len(college_map[div])} clubs '
              f'({cloned} cloned from men\'s, {wiki} wiki coords, {geo} city geocode), '
              f'{len(misses)} unmatched: {[m["team"] for m in misses[:10]]}')

    clubs.extend(new_clubs)
    write_clubs(clubs, cur)
    json.dump(college_map, open(mpath, 'w'), indent=1)
    json.dump(unmatched_all, open(upath, 'w'), indent=1)
    print(f'total clubs now {len(clubs)}')


if __name__ == '__main__':
    main()
