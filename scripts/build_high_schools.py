#!/usr/bin/env python3
"""Build data/high_schools.json — the high-school DIRECTORY layer.

Official government sources only (no MaxPreps, no SBLive, no state-association
scraping — Jeremy, 2026-09-08: "lets not infringe upon anti scraping"):

  * NCES Common Core of Data, school directory, SY 2024-25 preliminary
    (ccd_sch_029_2425_w_0a_051425.csv) — name, city, state, grade span,
    school type, operating status, charter flag.
  * NCES EDGE geocodes, SY 2024-25 (EDGE_GEOCODE_PUBLICSCH_2425.TXT) —
    official lat/lon per public school. No Nominatim, no guessing
    (pyramid-app-no-guessed-locations).
  * NCES Private School Universe Survey 2021-22 public-use file
    (pss2122_pu.csv) — the newest PSS with a public-use release; carries its
    own LATITUDE22/LONGITUDE22.

What a row means: "a school that teaches grade 12 exists here". It does NOT
mean the school fields a soccer team. NFHS counts ~13.1k schools with boys
soccer and ~12.6k with girls (2025-26) against ~25k regular high schools, so
roughly half of these have no programme. The app copy says so, and schools are
never counted as clubs or teams.

Output shape (compact, ~2 MB raw, fetched lazily by the map toggle only):
  {"src": "...", "n": <count>, "cols": ["n","la","lo","st","ct","k","id"],
   "rows": [["Albertville High School",34.2618,-86.2049,"AL","Albertville","p","ccd:010000500871"], ...]}
  k: p = public, c = public charter, v = private (independent)

Usage:
  python3 scripts/build_high_schools.py --fetch     # download the three NCES files into data/nces_raw/ (gitignored, ~150 MB)
  python3 scripts/build_high_schools.py             # build from data/nces_raw/
"""
import argparse, collections, csv, io, json, re, sys, urllib.request, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'data' / 'nces_raw'
OUT = ROOT / 'data' / 'high_schools.json'

CCD_ZIP = ('https://nces.ed.gov/sites/default/files/data-asset/ccd-common-core-data/2025/08/'
           '2024-25-common-core-data-ccd-preliminary-directory-files/'
           '2025046%20Preliminary%20Data%20Release%20CCD%20Nonfiscal_0.zip')
CCD_CSV = 'ccd_sch_029_2425_w_0a_051425.csv'
EDGE_ZIP = 'https://nces.ed.gov/programs/edge/data/EDGE_GEOCODE_PUBLICSCH_2425.zip'
EDGE_TXT = 'EDGE_GEOCODE_PUBLICSCH_2425.TXT'
PSS_ZIP = 'https://nces.ed.gov/surveys/pss/zip/pss2122_pu_csv.zip'
PSS_CSV = 'pss2122_pu.csv'

OK_STATUS = {'Open', 'New', 'Reopened', 'Added', 'Changed Boundary/Agency'}
US_ST = set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY '
            'NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR VI GU'.split())
GRADES = ['PK', 'KG', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13']
# The preliminary CCD file has no VIRTUAL column, so virtual / correctional /
# hospital programmes are screened by name. A school that teaches online has
# no pitch; a school inside a detention centre has no interscholastic season.
NOT_A_CAMPUS = re.compile(r'\b(virtual|online|hybrid|cyber|e-?school|distance|correspondence|home ?school|'
                          r'independent study|adult|juvenile|detention|correctional|jail|prison|'
                          r'youth authority|hospital|treatment|residential treatment)\b', re.I)
MIN_PRIVATE_ENROLL = 60   # a private school of 20 pupils does not field eleven
SMALL_WORDS = {'of', 'the', 'and', 'for', 'at', 'on', 'in', 'de', 'la', 'del', 'y'}


def smart_title(s):
    """CCD/PSS names are often ALL CAPS. Title-case them without mangling
    Mc/Mac, apostrophes, or hyphens, and keep short acronyms as they are."""
    words = []
    for i, w in enumerate(s.strip().split()):
        if len(w) <= 3 and w.isupper() and w.isalpha() and i > 0 and w.lower() not in SMALL_WORDS:
            words.append(w)          # "JFK", "STEM", "AB"
            continue
        parts = re.split(r"([-'’/])", w.lower())
        parts = [p[:1].upper() + p[1:] if p and p not in "-'’/" else p for p in parts]
        w2 = ''.join(parts)
        w2 = re.sub(r"^Mc(\w)", lambda m: 'Mc' + m.group(1).upper(), w2)
        if i > 0 and w2.lower() in SMALL_WORDS:
            w2 = w2.lower()
        words.append(w2)
    return ' '.join(words)


def fetch_all():
    RAW.mkdir(parents=True, exist_ok=True)
    for url, member in ((CCD_ZIP, CCD_CSV), (EDGE_ZIP, EDGE_TXT), (PSS_ZIP, PSS_CSV)):
        dest = RAW / member
        if dest.exists():
            print(f'  have {member}'); continue
        print(f'  fetching {url}')
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (rankedxi build)'})
        blob = urllib.request.urlopen(req, timeout=300).read()
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            z.extract(member, RAW)
        print(f'  wrote {dest} ({dest.stat().st_size:,} bytes)')


def load_geo():
    geo = {}
    with open(RAW / EDGE_TXT, encoding='latin-1') as f:
        for line in f:
            p = line.rstrip('\n').split('|')
            if len(p) < 14 or p[0] == 'NCESSCH':
                continue
            try:
                geo[p[0]] = (round(float(p[12]), 4), round(float(p[13]), 4))
            except ValueError:
                pass
    return geo


def public_rows(geo, drops):
    rows = []
    with open(RAW / CCD_CSV, encoding='latin-1') as f:
        for r in csv.DictReader(f):
            if r['SY_STATUS_TEXT'] not in OK_STATUS: drops['closed/inactive'] += 1; continue
            if r['SCH_TYPE_TEXT'] != 'Regular School': drops['alternative/special/CTE'] += 1; continue
            if r['LSTATE'] not in US_ST: drops['non-US'] += 1; continue
            lo, hi, lev = r['GSLO'], r['GSHI'], r['LEVEL']
            if hi not in ('12', '13'): drops['no grade 12'] += 1; continue
            k12 = lev == 'Other' and lo in GRADES and GRADES.index(lo) <= GRADES.index('09')
            if lev not in ('High', 'Secondary') and not k12: drops['level'] += 1; continue
            if NOT_A_CAMPUS.search(r['SCH_NAME']): drops['virtual/institutional by name'] += 1; continue
            ll = geo.get(r['NCESSCH'])
            if not ll: drops['no EDGE geocode'] += 1; continue
            rows.append([smart_title(r['SCH_NAME']), ll[0], ll[1], r['LSTATE'], smart_title(r['LCITY']),
                         'c' if r['CHARTER_TEXT'] == 'Yes' else 'p', 'ccd:' + r['NCESSCH']])
    return rows


def private_rows(drops):
    rows = []
    with open(RAW / PSS_CSV, encoding='latin-1') as f:
        for r in csv.DictReader(f):
            if r['HIGR2022'] != '17': drops['pss: no grade 12'] += 1; continue      # 17 = 12th grade
            if r['TYPOLOGY'] == '9': drops['pss: special education'] += 1; continue
            if r['PSTABB'] not in US_ST: drops['pss: non-US'] += 1; continue
            try:
                n = int(float(r['NUMSTUDS']))
            except ValueError:
                n = 0
            if n < MIN_PRIVATE_ENROLL: drops[f'pss: under {MIN_PRIVATE_ENROLL} pupils'] += 1; continue
            if NOT_A_CAMPUS.search(r['PINST']): drops['pss: virtual/institutional by name'] += 1; continue
            try:
                la, lo = round(float(r['LATITUDE22']), 4), round(float(r['LONGITUDE22']), 4)
            except ValueError:
                drops['pss: no geocode'] += 1; continue
            rows.append([smart_title(r['PINST']), la, lo, r['PSTABB'], smart_title(r['PCITY']), 'v', 'pss:' + r['PPIN']])
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--fetch', action='store_true', help='download the NCES source files first')
    a = ap.parse_args()
    if a.fetch:
        fetch_all()
    for m in (CCD_CSV, EDGE_TXT, PSS_CSV):
        if not (RAW / m).exists():
            sys.exit(f'missing {RAW / m} — run with --fetch')
    drops = collections.Counter()
    rows = public_rows(load_geo(), drops) + private_rows(drops)
    # one pin per (name, city, state): the CCD carries a few campus twins
    seen, uniq = set(), []
    for r in rows:
        key = (r[0].lower(), r[4].lower(), r[3])
        if key in seen: drops['duplicate name+city'] += 1; continue
        seen.add(key); uniq.append(r)
    uniq.sort(key=lambda r: (r[3], r[4], r[0]))
    out = {'src': 'NCES CCD 2024-25 (public) + EDGE 2024-25 geocodes + PSS 2021-22 (private); directory only, no soccer data',
           'n': len(uniq), 'cols': ['n', 'la', 'lo', 'st', 'ct', 'k', 'id'], 'rows': uniq}
    OUT.write_text(json.dumps(out, separators=(',', ':'), ensure_ascii=False) + '\n')
    kinds = collections.Counter(r[5] for r in uniq)
    print(f'wrote {OUT} — {len(uniq):,} schools ({kinds["p"]:,} public, {kinds["c"]:,} charter, {kinds["v"]:,} private), '
          f'{OUT.stat().st_size:,} bytes')
    for k, v in sorted(drops.items(), key=lambda kv: -kv[1]):
        print(f'  dropped {v:>7,}  {k}')


if __name__ == '__main__':
    main()
