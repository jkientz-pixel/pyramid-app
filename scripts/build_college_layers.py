#!/usr/bin/env python3
"""Build the NCAA D3 + NAIA men's club layers from Massey ratings + Wikipedia.

Inputs:  data/massey_d3.json, data/massey_naia.json  (scrape_massey.py)
Sources: Wikipedia 'List of NCAA Division III institutions' /
         'List of NAIA institutions' (school, nickname, city, state) +
         per-article coordinates; OSM Nominatim city fallback for the few
         school articles without coordinates. Locations are school-stated
         (list city/state) — never invented.

Outputs: new CLUBS entries in js/data.js (g=ncaa3 / g=naia, x=m, unrated —
         run apply_massey.py after to rate them), plus
         data/massey_college_map.json  (exact massey-name -> club id, so
         future rescrapes apply deterministically), and
         data/college_unmatched.json   (massey teams left out, for alias work).

Idempotent: existing ncaa3/naia clubs are rebuilt from scratch each run.
"""
import json, os, re, sys, time, urllib.request, urllib.parse
from _datajs import write_clubs

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = {'User-Agent': 'RankXI/0.1 (jkientz@gmail.com; college layer build)'}

LISTS = {'ncaa3': 'List of NCAA Division III institutions',
         'naia': 'List of NAIA institutions'}
MASSEY = {'ncaa3': 'massey_d3.json', 'naia': 'massey_naia.json'}

STATES = {'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR',
          'california': 'CA', 'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE',
          'florida': 'FL', 'georgia': 'GA', 'hawaii': 'HI', 'idaho': 'ID',
          'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA', 'kansas': 'KS',
          'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
          'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS',
          'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV',
          'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
          'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK',
          'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
          'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT',
          'vermont': 'VT', 'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV',
          'wisconsin': 'WI', 'wyoming': 'WY', 'district of columbia': 'DC',
          'puerto rico': 'PR', 'british columbia': 'BC', 'alberta': 'AB',
          'ontario': 'ON', 'manitoba': 'MB', 'saskatchewan': 'SK', 'quebec': 'QC'}


def api(params):
    url = 'https://en.wikipedia.org/w/api.php?' + urllib.parse.urlencode(params)
    for attempt in range(4):
        try:
            return json.load(urllib.request.urlopen(
                urllib.request.Request(url, headers=UA), timeout=30))
        except Exception as e:
            if '429' in str(e):
                time.sleep(15); continue
            raise
    raise RuntimeError('rate limited')


def unwiki(s):
    """[[A|B]] -> B, [[A]] -> A; strip refs/templates/comments/markup.
    {{sort|key|content}} keeps its content — school cells use it heavily."""
    s = re.sub(r'<!--.*?-->', '', s, flags=re.S)
    s = re.sub(r'<ref[^>]*/>|<ref.*?</ref>', '', s, flags=re.S)
    s = re.sub(r'\{\{sort\|[^|}]*\|([^}]*)\}\}', r'\1', s)
    s = re.sub(r'\{\{refn[^}]*\}\}|\{\{[^}]*\}\}', '', s, flags=re.S)
    s = re.sub(r'\[\[([^|\]]*)\|([^\]]*)\]\]', r'\2', s)
    s = re.sub(r'\[\[([^\]]*)\]\]', r'\1', s)
    return re.sub(r"'{2,}", '', s).strip()


def first_link(s):
    m = re.search(r'\[\[([^|\]]+)', s)
    return m.group(1).strip() if m else None


def parse_list(title):
    """Yield {article, school, nick, city, st} rows from an institutions list."""
    text = api({'action': 'parse', 'page': title, 'prop': 'wikitext',
                'redirects': 1, 'format': 'json'})['parse']['wikitext']['*']
    out = []
    for block in re.split(r'\n\|-\s*', text):
        # both !scope=row and |scope=row occur (highlighted transition rows),
        # sometimes behind a row-attribute line like bgcolor=#ffa0a0
        m = re.match(r'\s*(?:[a-z][^\n|!]*\n)?\s*[!|]\s*scope="?row"?\s*\|(.*)', block, re.S)
        if not m:
            continue
        lines = m.group(1).split('\n|', 1)
        school_raw = lines[0]
        cells = re.split(r'\s*\|\|\s*', lines[1]) if len(lines) > 1 else []
        if len(cells) < 4:
            continue
        school = re.sub(r'[*†‡]+$', '', unwiki(school_raw)).strip()
        article = first_link(school_raw) or school
        nick, city, state = unwiki(cells[0]), unwiki(cells[1]), unwiki(cells[2])
        st = state if re.fullmatch(r'[A-Z]{2}', state) else STATES.get(state.lower())
        if not (school and nick and city and st):
            continue
        out.append({'article': article, 'school': school, 'nick': nick,
                    'city': city, 'st': st})
    return out


# --- Massey short-name -> school matching -----------------------------------
STOP = {'university', 'college', 'of', 'the', 'at', 'in', 'a&m', 'am', 'and'}
EXPAND = {'u': 'university', 'univ': 'university', 'col': 'college',
          'coll': 'college', 'inst': 'institute', 'so': 'southern',
          'no': 'northern', 'e': 'eastern', 'w': 'western', 'n': 'north',
          's': 'south', 'mt': 'mount', 'ft': 'fort', 'intl': 'international',
          'psu': 'penn state', 'nvu': 'northern vermont', 'tx': 'texas',
          'wm': 'william', 'js': 'johnson smith', 'tech': 'technology',
          'naz': 'nazarene', 'chris': 'christopher', 'stl': 'saint louis',
          'cal': 'california', 'sw': 'southwestern', 'eng': 'engineering',
          'suny': 'state university new york', 'cent': 'central',
          'val': 'valley', 'chr': 'christian', 'uc': 'university california',
          'mtn': 'mountain', 'gust': 'gustavus', 'psu': 'pennsylvania state',
          'penn': 'pennsylvania', 'mit': 'massachusetts institute technology',
          'nyu': 'new york university', 'caltech': 'california institute technology',
          'pac': 'pacific', 'luth': 'lutheran', 'bap': 'baptist', 'bib': 'bible',
          'meth': 'methodist', 'advt': 'adventist', 'hts': 'heights',
          'nw': 'northwest', 'jos': 'joseph', 'fdu': 'fairleigh dickinson',
          'wash': 'washington', 'jeff': 'jefferson', 'lib': 'liberal',
          'pt': 'point', 'lagr': 'lagrange'}
ABBR2STATE = {v: k for k, v in STATES.items()}
# Massey names too mangled for token matching -> exact school-name anchors
# (verified against the Wikipedia institution lists by hand)
ALIAS = {
    'Sewanee': 'University of the South',
    'R Stockton': 'Stockton University',
    'Worcester Tech': 'Worcester Polytechnic Institute',
    'Claremont M.S.': 'Claremont McKenna College, Harvey Mudd College, and Scripps College',
    'J&W RI': 'Johnson & Wales University',
    'Concordia Mhd': 'Concordia College',
    'Providence GF': 'University of Providence',
    'Oklahoma S&A': 'University of Science and Arts of Oklahoma',
    'Savannah A&D': 'Savannah College of Art and Design',
    "St Joseph's LI": "St. Joseph's University|Patchogue",
    ('naia', 'Fisher'): 'Fisher College',
    'NVU-Johnson': 'Vermont State University–Johnson',
    'NVU-Lyndon': 'Vermont State University–Lyndon',
    'Columbia SC': 'Columbia College (SC)',
    'SUNY Poly': 'State University of New York Polytechnic Institute',
    'Huston-Tillot': 'Huston–Tillotson University',
    'Mid Am Nazarene': 'MidAmerica Nazarene University',
    'W Woods': 'William Woods University',
    'M Hardin-Baylor': 'University of Mary Hardin–Baylor',
    'Embry-Riddle AZ': 'Embry–Riddle Aeronautical University, Prescott',
    'Frank & Marsh': 'Franklin & Marshall College',
    'Hobart & Smith': 'Hobart College',
    'College of NJ': 'The College of New Jersey',
    'Stevens': 'Stevens Institute of Technology',
    'FDU Madison': 'Fairleigh Dickinson University, Florham',
    'Illinois Col': 'Illinois College',
    'E Texas Bap': 'East Texas Baptist University',
    'Le Tourneau': 'LeTourneau University',
    'S Maine': 'University of Southern Maine',
    'S Virginia': 'Southern Virginia University',
    'NJ City': 'New Jersey City University',
    'Anna Maria': 'Anna Maria College',
    'SUNY Poly': 'SUNY Polytechnic Institute',
    'U New England': 'University of New England',
    'Pitt-Greensburg': 'University of Pittsburgh at Greensburg',
    'Pitt-Bradford': 'University of Pittsburgh at Bradford',
    'N England Col': 'New England College',
    'Centenary NJ': 'Centenary University',
    'City Col NY': 'City College of New York',
    'Valley Forge': 'University of Valley Forge',
    'Carlow': 'Carlow University',
    'Regent': 'Regent University',
    'Bob Jones': 'Bob Jones University',
    'Trinity Chr': 'Trinity Christian College',
    'Texas A&M-SA': 'Texas A&M University–San Antonio',
    'TX A&M Texarkana': 'Texas A&M University–Texarkana',
    'Houston-Victoria': 'Texas A&M University–Victoria',
    'TX Wesleyan': 'Texas Wesleyan University',
    'Siena Hts': 'Siena Heights University',
    'Oakland City': 'Oakland City University',
    'Alice Lloyd': 'Alice Lloyd College',
    'Ohio Chr': 'Ohio Christian University',
}


def deacc(x):
    import unicodedata
    return unicodedata.normalize('NFKD', x).encode('ascii', 'ignore').decode()


def toks(s, massey=False):
    """Token set for matching. 'st' is ambiguous (Saint vs State): school
    names keep BOTH readings (supersets are harmless on the candidate side);
    Massey names use position — LAST word = State ('Shawnee St'), any other
    position = Saint ('Mt St Vincent'). Dashes normalize BEFORE deacc — NFKD
    drops en dashes outright, which would weld 'Wisconsin–Eau' together."""
    s = re.sub(r'[-–—]', ' ', s)
    s = deacc(s).lower().replace('a&m', 'am').replace('&', ' and ').replace('.', ' ')
    out = set()
    words = re.findall(r"[a-z0-9']+", s)
    for i, w in enumerate(words):
        w = w.strip("'")
        if w == 'st':
            if massey:
                out.add('state' if i == len(words) - 1 else 'saint')
            else:
                out.update(('saint', 'state'))
            continue
        for ww in EXPAND.get(w, w).split():
            out.add(ww)
    return out - STOP


def match_school(mteam, schools, div=''):
    """Return the unique school matching a Massey short name, else None."""
    name = mteam
    st_hint = None
    m = re.search(r'\s([A-Z]{2})$', name)
    if m and m.group(1) in STATES.values():
        st_hint = m.group(1)
        name = name[:m.end() - 3]
    # leading state abbreviation is part of the name ('CT College', 'WI Eau
    # Claire') — expand it; trailing was a disambiguator, handled above
    lead = re.match(r'([A-Z]{2})\s+(.+)', name)
    if lead and lead.group(1) in STATES.values():
        name = ABBR2STATE[lead.group(1)] + ' ' + lead.group(2)
    alias = ALIAS.get((div, mteam), ALIAS.get(mteam))
    if alias:
        want, _, want_city = alias.partition('|')
        want = deacc(want).lower()
        hits = [s for s in schools if deacc(s['school']).lower() == want
                and (not want_city or s['city'] == want_city)]
        return hits[0] if len(hits) == 1 else None
    pool = [s for s in schools if s['st'] == st_hint] if st_hint else schools
    mt = toks(name, massey=True)
    if not mt:
        return None
    # exact subset, then 1-token slack
    for pred in (lambda sk: mt <= sk,
                 lambda sk: len(mt & sk) >= len(mt) - 1
                 and len(mt & sk) / len(mt) >= 0.75):
        cands = [s for s in pool if pred(toks(s['school'] + ' ' + s['nick']))]
        if len(cands) == 1:
            return cands[0]
        if len(cands) > 1:
            # 'Williams' means Williams College, not Roger Williams:
            # prefer the candidate with the fewest leftover tokens
            scored = sorted(cands, key=lambda s: len(toks(s['school'] + ' ' + s['nick']) - mt))
            a, b = (len(toks(s['school'] + ' ' + s['nick']) - mt) for s in scored[:2])
            if a < b:
                return scored[0]
    return None


def slugify(n):
    return re.sub(r'-+', '-', re.sub(r'[^a-z0-9]+', '-', deacc(n).lower())).strip('-')


def coords_for(articles):
    """Batched Wikipedia coordinates; returns {article: (la, lo)}."""
    out = {}
    arts = list(articles)
    for i in range(0, len(arts), 50):
        batch = arts[i:i + 50]
        r = api({'action': 'query', 'prop': 'coordinates', 'redirects': 1,
                 'titles': '|'.join(batch), 'colimit': 'max', 'format': 'json'})
        redir = {x['from']: x['to'] for x in r['query'].get('redirects', [])}
        by_title = {p['title']: p for p in r['query']['pages'].values()}
        for a in batch:
            p = by_title.get(redir.get(a, a))
            if p and p.get('coordinates'):
                c = p['coordinates'][0]
                out[a] = (round(c['lat'], 3), round(c['lon'], 3))
        time.sleep(0.5)
    return out


def nominatim(city, st):
    url = 'https://nominatim.openstreetmap.org/search?' + urllib.parse.urlencode(
        {'q': f'{city}, {st}, USA', 'format': 'json', 'limit': 1})
    try:
        r = json.load(urllib.request.urlopen(
            urllib.request.Request(url, headers=UA), timeout=30))
        if r:
            return round(float(r[0]['lat']), 3), round(float(r[0]['lon']), 3)
    except Exception:
        pass
    return None


def main():
    dpath = os.path.join(ROOT, 'js', 'data.js')
    cur = open(dpath).read()
    clubs = json.loads(re.search(r'export const CLUBS=(\[.*?\]);', cur, re.S).group(1))
    clubs = [c for c in clubs if c['g'] not in ('ncaa3', 'naia')]
    taken = {c['id'] for c in clubs}

    name_map, unmatched = {}, {}
    new_clubs = []
    for div, list_title in LISTS.items():
        rows = json.load(open(os.path.join(ROOT, 'data', MASSEY[div])))
        schools = parse_list(list_title)
        print(f'{div}: {len(rows)} massey teams, {len(schools)} listed schools')
        matched = {}
        misses = []
        for r in rows:
            s = match_school(r['team'], schools, div)
            if s and s['article'] not in {m['article'] for m in matched.values()}:
                matched[r['team']] = s
            else:
                # a nearest-candidate hint makes each leftover a one-line
                # ALIAS fix instead of a research task
                mt = toks(r['team'], massey=True)
                near = max(schools, key=lambda sc: len(mt & toks(sc['school'] + ' ' + sc['nick'])), default=None)
                misses.append({'team': r['team'],
                               'nearest': near['school'] if near and mt & toks(near['school'] + ' ' + near['nick']) else None})
        arts = {s['article'] for s in matched.values()}
        coords = coords_for(arts)
        geo_fallback = 0
        name_map[div] = {}
        for mteam, s in sorted(matched.items()):
            ll = coords.get(s['article'])
            if not ll:
                ll = nominatim(s['city'], s['st'])
                time.sleep(1.1)
                if ll:
                    geo_fallback += 1
            if not ll:
                misses.append({'team': mteam, 'nearest': s['school'] + ' (no coords)'})
                continue
            disp = re.sub(r'\s*\([^)]*\)$', '', s['school'])
            n = f"{disp} {s['nick']}"
            cid = slugify(n)
            if cid in taken:
                misses.append({'team': mteam, 'nearest': s['school'] + ' (slug collision)'})
                continue
            taken.add(cid)
            new_clubs.append({'n': n, 'g': div, 'x': 'm', 'la': ll[0], 'lo': ll[1],
                              'st': s['st'], 'ct': s['city'], 'id': cid})
            name_map[div][mteam] = cid
        unmatched[div] = misses
        print(f'{div}: built {len(name_map[div])} clubs '
              f'({geo_fallback} via city geocode), {len(misses)} unmatched: '
              f'{misses[:10]}')

    clubs.extend(new_clubs)
    write_clubs(clubs, cur)
    json.dump(name_map, open(os.path.join(ROOT, 'data', 'massey_college_map.json'), 'w'), indent=1)
    json.dump(unmatched, open(os.path.join(ROOT, 'data', 'college_unmatched.json'), 'w'), indent=1)
    print(f'total clubs now {len(clubs)}')


if __name__ == '__main__':
    main()
