#!/usr/bin/env python3
"""Match Massey Ratings college soccer power ratings (data/massey_d1.json /
massey_d2.json, scraped from masseyratings.com) to NCAA clubs in js/data.js
and apply scaled ratings with rr=3 (external results model). Unmatched or
ambiguous names are left demo and logged."""
from _datajs import load_clubs, write_clubs
import json, re, os, sys, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def deacc(x): return unicodedata.normalize('NFKD', x).encode('ascii', 'ignore').decode()
EXPAND = {'u': 'university', 'cs': 'california state', 'col': 'college', 'univ': 'university', 'so': 'southern',
          'no': 'northern', 'e': 'eastern', 'w': 'western', 'n': 'north', 's': 'south',
          'intl': 'international', 'coll': 'college', 'inst': 'institute'}
STOP = {'university', 'college', 'of', 'the', 'at', 'in', 'a&m', 'am', 'state'}

def toks(s, keep_state=True):
    s = deacc(s).lower().replace('&', ' and ')
    out = set()
    for w in re.findall(r"[a-z0-9']+", s):
        w = w.strip("'")
        for ww in EXPAND.get(w, w).split():
            out.add(ww)
    return out

ALIAS = {
    'nc state': 'north carolina state', 'ucla': 'california los angeles bruins',
    'smu': 'southern methodist', 'ucf': 'central florida', 'unc': 'north carolina',
    'fiu': 'florida international', 'vcu': 'virginia commonwealth',
    'uic': 'illinois chicago', 'umbc': 'maryland baltimore county',
    'utrgv': 'texas rio grande valley', 'fgcu': 'florida gulf coast',
    'liu': 'long island', 'penn': 'pennsylvania', 'pitt': 'pittsburgh',
    'uconn': 'connecticut', 'umass': 'massachusetts', 'ualbany': 'albany',
    'missouri kc': 'missouri kansas city', 'utsa': 'texas san antonio',
    'fl': 'florida', 'georgia st': 'georgia state',
    'virginia tech': 'virginia polytechnic', 'cal poly': 'california polytechnic',
    'cal baptist': 'california baptist', 'loy marymount': 'loyola marymount',
    'wisconsin': 'wisconsin madison', 'penn st': 'pennsylvania state',
    'georgetown': 'georgetown hoyas', 'missouri kc': 'missouri kansas city kangaroos',
    'unc greensboro': 'north carolina greensboro', 'ga southern': 'georgia southern',
    'unc wilmington': 'north carolina wilmington', 'unc asheville': 'north carolina asheville',
    'james madison': 'james madison dukes', 'boston u': 'boston university terriers',
    'miami': 'miami hurricanes', 'indiana': 'indiana bloomington hoosiers',
    'unlv': 'nevada las vegas', 'il chicago': 'illinois chicago',
    'col charleston': 'college of charleston cougars', 'american univ': 'american university eagles',
    "st mary's ca": "st mary's california gaels",
    # D1 abbreviations / disambiguations (Massey csoc2025 sweep, 2026-07-29)
    'maryland': 'maryland college park', 'san diego': 'san diego toreros',
    'north carolina': 'north carolina chapel hill', 'virginia': 'virginia cavaliers',
    'charlotte': 'charlotte 49ers', 'michigan': 'michigan wolverines',
    'california': 'california berkeley', 'penn': 'pennsylvania quakers',
    'kentucky': 'kentucky wildcats', 'connecticut': 'connecticut huskies',
    'massachusetts': 'massachusetts amherst', 'boston college': 'boston eagles',
    'south carolina': 'south carolina gamecocks', 'uab': 'alabama birmingham',
    'ne omaha': 'nebraska omaha', 'boston univ': 'boston terriers',
    'f dickinson': 'fairleigh dickinson', 'n illinois': 'northern illinois',
    'houston chr': 'houston christian', 'cent arkansas': 'central arkansas',
    'suny albany': 'albany great danes', 'army': 'military academy black knights',
    'njit': 'new jersey institute technology', 'coastal car': 'coastal carolina',
    'wi milwaukee': 'wisconsin milwaukee', 'siue': 'southern illinois edwardsville',
    'wi green bay': 'wisconsin green bay', 'queens nc': 'queens royals',
    'liu brooklyn': 'long island sharks', 'ma lowell': 'massachusetts lowell',
    'etsu': 'east tennessee state', 'pfw': 'purdue fort wayne',
    'st thomas mn': 'thomas tommies', 'loyola md': 'loyola maryland',
    'iupui': 'indiana indianapolis jaguars', 'n kentucky': 'northern kentucky norse',
    'sc upstate': 'south carolina upstate', 'navy': 'naval academy midshipmen',
    "mt st mary's": "mount st mary's mountaineers", 'central conn': 'central connecticut blue devils',
    'vmi': 'virginia military institute',
    # D2 abbreviations (Massey csoc2025 sweep, 2026-07-29)
    'al huntsville': 'alabama huntsville chargers', 'anderson sc': 'anderson trojans',
    "auburn m'gomery": 'auburn montgomery', 'csu east bay': 'california state east bay',
    'cal st la': 'california state los angeles', 'cs san bern.': 'california state san bernardino',
    'chr brothers': 'christian brothers', 'colorado chr': 'colorado christian',
    'co mesa': 'colorado mesa', 'csu pueblo': 'colorado state pueblo',
    'dallas bap': 'dallas baptist', 'dist columbia': 'district of columbia firebirds',
    'dominican ca': 'dominican california penguins', 'dominican ny': 'dominican new york chargers',
    'e stroudsburg': 'east stroudsburg', 'embry riddle fl': 'embry riddle aeronautical',
    'emmanuel ga': 'emmanuel lions', 'florida tech': 'florida institute technology',
    'ft lewis': 'fort lewis', 'georgia sw': 'georgia southwestern',
    'wm jessup': 'jessup warriors', 'ky wesleyan': 'kentucky wesleyan',
    'lewis': 'lewis flyers', 'lincoln mo': 'lincoln blue tigers',
    'lincoln mem': 'lincoln memorial', 'lubbock chr': 'lubbock christian',
    'maryville mo': 'maryville saints', 'metro st': 'metropolitan state denver',
    'midwest tx st': 'midwestern state mustangs', 'missouri s&t': 'missouri science and technology',
    'mo st louis': 'missouri st louis', 'mt olive': 'mount olive',
    'newman': 'newman jets', 'ne oklahoma': 'northeastern state riverhawks',
    'n michigan': 'northern michigan', 'nw nazarene': 'northwest nazarene',
    'northwood mi': 'northwood timberwolves', 'nova se': 'nova southeastern',
    'oh dominican': 'ohio dominican', 'oklahoma chr': 'oklahoma christian',
    'palm beach atl': 'palm beach atlantic', 'california pa': 'pennsylvania western california',
    'pitt johnstown': 'pittsburgh johnstown', 'regis co': 'regis rangers',
    'roberts wslyn': 'roberts wesleyan', 'saginaw val': 'saginaw valley',
    "st mary's tx": "st mary's rattlers", 'sc aiken': 'south carolina aiken',
    'sd mines': 'south dakota mines', 's connecticut': 'southern connecticut',
    's new hampshire': 'southern new hampshire', 's wesleyan': 'southern wesleyan',
    'sw baptist': 'southwest baptist', 'ut dallas': 'texas dallas',
    'ut tyler': 'texas tyler', 't jefferson': 'thomas jefferson',
    'trevecca naz': 'trevecca nazarene', 'w texas a&m': 'west texas a&m',
    'wv wesleyan': 'west virginia wesleyan', 'westminster ut': 'westminster griffins',
    'wm jewell': 'william jewell', 'wilmington de': 'wilmington wildcats',
    'wi parkside': 'wisconsin parkside', 'shaw nc': 'shaw bears',
}

def pre(s):
    x = re.sub(r'[\u2013\u2014\u2010/,\-]', ' ', s)
    x = deacc(x).lower().strip()
    x = re.sub(r'\s+', ' ', x)
    x = ALIAS.get(x, x)
    x = re.sub(r'\bst$', 'state', x)          # trailing "St" = State
    x = re.sub(r'^st\.?\s', 'saint ', x)      # leading "St." = Saint
    x = re.sub(r'\bfl\b', 'florida', x)
    x = re.sub(r'\bso\b', 'southern', x)
    x = re.sub(r'\buc\b', 'california', x)
    return x

STATE_SUFFIX = {'nj', 'ca', 'ny', 'md', 'pa', 'oh', 'il', 'wv', 'va', 'tn'}
def sig(s):
    """distinctive tokens: drop generic institution words"""
    t = toks(pre(s)) - {'university', 'college', 'of', 'the', 'at', 'in'}
    return (t - STATE_SUFFIX) or t

def main(band_d1=(1355, 1610), band_d2=(1285, 1505),
         band_d3=(1205, 1410), band_naia=(1225, 1430),
         band_d1w=(1500, 1755), band_d2w=(1430, 1650)):
    # MEN'S RE-BAND 2026-08-01 (uniform -145 from the original bands): the old
    # D1 ceiling (1755) put top college programs above 24 of 25 professional
    # USL Championship clubs. No varsity side plays in the Open Cup, so college
    # has no cross-league results anchoring it — the band IS the editorial
    # placement. New ceiling 1610 sits below the USL-C floor (~1628) and a
    # notch above the best USL League Two sides (~1536), whose summer rosters
    # are these same college players. D2-D3-NAIA keep their relative overlaps.
    # WOMEN'S BANDS UNCHANGED and now separate: college is the women's game's
    # development tier (NWSL drafts straight from it) — top D1w (~1755) just
    # under the NWSL floor (~1761), D2w interlocking with USL W/WPSL, is the
    # intended placement.
    dpath = os.path.join(ROOT, 'js', 'data.js')
    cur = open(dpath).read()
    clubs = json.loads(re.search(r'export const CLUBS=(\[.*?\]);', cur, re.S).group(1))
    # build_college_layers.py records the exact massey-name -> club-id map for
    # the layers it creates; exact hits skip fuzzy matching entirely
    mpath = os.path.join(ROOT, 'data', 'massey_college_map.json')
    college_map = json.load(open(mpath)) if os.path.exists(mpath) else {}

    for div, fname, band in [('ncaa1', 'massey_d1.json', band_d1), ('ncaa2', 'massey_d2.json', band_d2),
                             ('ncaa3', 'massey_d3.json', band_d3), ('naia', 'massey_naia.json', band_naia),
                             ('ncaa1w', 'massey_d1w.json', band_d1w), ('ncaa2w', 'massey_d2w.json', band_d2w)]:
        path = os.path.join(ROOT, 'data', fname)
        if not os.path.exists(path):
            print(f'{div}: {fname} missing, skipped', file=sys.stderr); continue
        rows = [r for r in json.load(open(path))
                if isinstance(r, dict) and isinstance(r.get('rat'), (int, float)) and 0 < r['rat'] < 20]
        if not rows:
            print(f'{div}: no usable rows', file=sys.stderr); continue
        rats = sorted(r['rat'] for r in rows)
        # Floor is winsorized at the 2nd percentile (a couple of hopeless
        # sides must not stretch the band), but the CEILING is the true best
        # rating: clipping at the 98th percentile stacked the top 2% of every
        # division on the band's max — 5 D1 men tied at 1608, 8 D1 women at
        # 1755, 10 D3 sides at 1410 (found 2026-08-25). One club sits at the
        # band ceiling; everyone else spreads below it.
        lo_r, hi_r = rats[int(.02 * len(rats))], rats[-1]
        span = (hi_r - lo_r) or 1
        pool = [c for c in clubs if c['g'] == div]
        by_id = {c['id']: c for c in pool}
        dmap = college_map.get(div, {})
        matched = amb = 0
        unmatched = []
        for m in rows:
            c = by_id.get(dmap.get(m['team']))
            if c is not None:
                frac = max(0.0, min(1.0, (m['rat'] - lo_r) / span))
                c['r'] = int(band[0] + frac * (band[1] - band[0]))
                c['rr'] = 3
                matched += 1
                continue
            if dmap:
                # mapped layer: an unmapped row is a new/unmatched team, not
                # fuzzy-match material — log it for build_college_layers work
                unmatched.append(m['team'])
                continue
            mt = sig(m['team'])
            if not mt: continue
            cands = [c for c in pool if mt <= sig(c['n'])]
            if len(cands) != 1:
                # fallback: allow one missing token (e.g. 'u' quirks) if unique superset-ish
                cands = [c for c in pool if len(mt & sig(c['n'])) >= max(1, len(mt) - 1) and len(mt & sig(c['n'])) >= 1 and mt and (len(mt & sig(c['n'])) / len(mt)) >= 0.75]
            if len(cands) == 1:
                c = cands[0]
                frac = max(0.0, min(1.0, (m['rat'] - lo_r) / span))
                c['r'] = int(band[0] + frac * (band[1] - band[0]))
                c['rr'] = 3
                matched += 1
            elif len(cands) > 1:
                amb += 1
            else:
                unmatched.append(m['team'])
        print(f'{div}: matched {matched}/{len(rows)} massey rows to {len(pool)} clubs '
              f'({amb} ambiguous)', file=sys.stderr)
        if unmatched[:12]:
            print(f'  unmatched sample: {unmatched[:12]}', file=sys.stderr)

    write_clubs(clubs, cur)
    from collections import Counter
    print('rr now:', Counter(c.get('rr', 0) for c in clubs), file=sys.stderr)

if __name__ == '__main__':
    main()
