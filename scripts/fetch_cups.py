#!/usr/bin/env python3
"""Fetch historical champions for US tournaments and league titles from
Wikipedia into data/cups.json — open cups, pro and amateur league
championships, and the College Cups.

Each entry lists candidate page titles tried in order (league histories
live under different article names), and a per-cup `min` editions floor:
below it the parse is treated as failed and the cup is DROPPED rather
than shipped wrong — a missing trophy case is honest, a wrong champion
is not. New leagues with short histories set min to their real count."""
import json, re, urllib.request, urllib.parse, time, os, sys, html

UA = {'User-Agent': 'RankXI/0.1 (jkientz@gmail.com; tournament history)'}
CUPS = [
    {'key': 'opencup', 'titles': ['List of U.S. Open Cup finals'], 'label': 'U.S. Open Cup', 'kind': 'open', 'min': 50},
    {'key': 'amateurcup', 'titles': ['National Amateur Cup', 'National Amateur Cup (United States)'], 'label': 'National Amateur Cup', 'kind': 'open', 'min': 20},
    # the 'MLS Cup' article has no linkable finals list — its champions table
    # skips re-linking repeat winners and the MVP table poisons the parse
    # (shipped v20260801m listed Messi as the 2025 champion because of it)
    {'key': 'mlscup', 'titles': ['List of MLS Cup finals'], 'label': 'MLS Cup', 'kind': 'pro', 'min': 20},
    {'key': 'shield', 'titles': ["Supporters' Shield"], 'label': "Supporters' Shield", 'kind': 'pro', 'min': 20, 'noru': True},
    {'key': 'uslc', 'titles': ['USL Championship Final', 'List of USL Championship seasons', 'USL Championship'], 'label': 'USL Championship Final', 'kind': 'pro', 'min': 8},
    {'key': 'usl1', 'titles': ['USL League One Final', 'USL League One'], 'label': 'USL League One Final', 'kind': 'pro', 'min': 5},
    {'key': 'mnp', 'titles': ['MLS Next Pro Cup', 'MLS Next Pro'], 'label': 'MLS Next Pro Cup', 'kind': 'pro', 'min': 3},
    {'key': 'nwsl', 'titles': ['NWSL Championship'], 'label': 'NWSL Championship', 'kind': 'pro', 'min': 10},
    {'key': 'nwslshield', 'titles': ['NWSL Shield'], 'label': 'NWSL Shield', 'kind': 'pro', 'min': 10},
    {'key': 'uslsuper', 'titles': ['USL Super League'], 'label': 'USL Super League Final', 'kind': 'pro', 'min': 1},
    # noru: champions-list tables — the 2025 row parsed 'FC Motown STA' as
    # runner-up when the real finalist was Ballard FC (verified 2026-08-01)
    {'key': 'usl2', 'titles': ['USL League Two', 'List of USL League Two champions', 'Premier Development League'], 'label': 'USL League Two Championship', 'kind': 'am', 'min': 15, 'noru': True},
    {'key': 'npsl', 'titles': ['National Premier Soccer League', 'List of National Premier Soccer League champions'], 'label': 'NPSL National Championship', 'kind': 'am', 'min': 10},
    # UPSL deliberately absent: two seasons per year, gap years, and the
    # Wikipedia table parses with wrong winners — no data beats bad data

    {'key': 'wpsl', 'titles': ["Women's Premier Soccer League", "List of Women's Premier Soccer League champions"], 'label': 'WPSL Championship', 'kind': 'am', 'min': 10, 'noru': True},
    {'key': 'uws', 'titles': ["United Women's Soccer", "UWS League One"], 'label': 'UWS National Championship', 'kind': 'am', 'min': 4},
    {'key': 'ncaam', 'titles': ["NCAA Division I Men's Soccer Championship", "NCAA Division I Men's Soccer Tournament"], 'label': "College Cup · Men (NCAA DI)", 'kind': 'college', 'min': 30},
    {'key': 'ncaaw', 'titles': ["NCAA Division I Women's Soccer Championship", "NCAA Division I Women's Soccer Tournament"], 'label': "College Cup · Women (NCAA DI)", 'kind': 'college', 'min': 20},
]

def api_html(title):
    url = 'https://en.wikipedia.org/w/api.php?' + urllib.parse.urlencode(
        {'action': 'parse', 'page': title, 'prop': 'text', 'redirects': 1, 'format': 'json'})
    for _ in range(3):
        try:
            r = json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=25))
            if 'error' in r: return None
            return r['parse']['text']['*']
        except Exception as e:
            if '429' in str(e): time.sleep(12); continue
            return None
    return None

def clean(c): return html.unescape(re.sub(r'<[^>]+>', '', c)).strip()

THIS_YEAR = time.gmtime().tm_year
# link texts that are never a club: match annotations, venues leak in via
# the runner-up guard instead (ru must differ from winner)
NOISE = re.compile(r'^(a\.e\.t|aet$|g\.g|o\.t|extra time|penalt|replay|golden goal|final|semifinal|overtime|shoot)', re.I)
# real scorelines only — '2025–26' season spans must not count as a score
SCORE = re.compile(r'^\d{1,2}[–\-]\d{1,2}(?!\d)')

def parse_finals(page):
    """Champions tables merged per identical header, then the single best
    header group wins — merging every table on the page let MVP/coach/host
    columns shadow real finals (Wikipedia lists them with the same year
    keys). Quality = rows that carry a score or a distinct runner-up."""
    groups = {}
    for tbl in re.findall(r'<table[^>]*wikitable[^>]*>(.*?)</table>', page, re.S):
        h = None
        for tr in re.findall(r'<tr[^>]*>(.*?)</tr>', tbl, re.S)[:3]:
            cand = [clean(x).lower() for x in re.findall(r'<th[^>]*>(.*?)</th>', tr, re.S)]
            if len(cand) >= 3: h = cand; break
        if not h or not any(k in x for x in h for k in ('year', 'season', 'edition', 'date')): continue
        if not any('winn' in x or 'champion' in x or x == 'final' for x in h): continue
        rows_out = []
        for row in re.findall(r'<tr[^>]*>(.*?)</tr>', tbl, re.S)[1:]:
            cells = re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', row, re.S)
            if len(cells) < 2: continue
            ym = None
            for c2 in cells[:3]:
                ym = re.search(r'(19|20)\d\d', clean(c2))
                if ym: break
            if not ym: continue
            year = ym.group(0)
            links = re.findall(r'<a href="/wiki/[^"#]+"[^>]*>([^<]+)</a>', row)
            links = [l for l in links if not re.match(r'^\d', l) and len(l) > 3 and not NOISE.match(l)]
            if not links: continue
            winner = links[0]
            runner = next((l for l in links[1:] if l != winner), None)
            score = next((m.group(0) for c2 in cells for m in [SCORE.match(clean(c2))] if m), None)
            rows_out.append({'y': year, 'w': winner, 'ru': runner, 's': score})
        if rows_out: groups.setdefault(tuple(h), []).extend(rows_out)
    if not groups: return []
    # scores outrank runner-ups when ranking table groups: an MVP table can
    # fake runner-ups (every player links a club) but never fakes scorelines.
    # Years fill best-group-first, so era-split finals tables union cleanly
    # while a junk table can only contribute years no better table covers.
    ranked = sorted(groups.values(), key=lambda rows: (
        sum(1 for r in rows if r['s']),
        sum(1 for r in rows if r['ru'] and r['ru'] != r['w']), len(rows)), reverse=True)
    dedup = {}
    for rows in ranked:
        for r in rows:
            if r['y'] not in dedup: dedup[r['y']] = r
    # a future year is a scheduled host, not a champion; a current-year row
    # with no score is a placeholder for a final not yet played
    out = [r for r in dedup.values()
           if int(r['y']) < THIS_YEAR or (int(r['y']) == THIS_YEAR and r['s'])]
    return sorted(out, key=lambda r: -int(r['y']))

def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = {}
    for cup in CUPS:
        finals, src = [], None
        for title in cup['titles']:
            page = api_html(title)
            time.sleep(1.2)
            if not page:
                continue
            finals = parse_finals(page)
            if len(finals) >= cup['min']:
                src = title; break
        if src:
            if cup.get('noru'):
                # this cup's table has no runner-up column — whatever link
                # landed there (usually the coach) is not a losing finalist
                finals = [{**r, 'ru': None} for r in finals]
            out[cup['key']] = {'label': cup['label'], 'kind': cup['kind'], 'finals': finals}
            print(f"{cup['label']}: {len(finals)} editions via '{src}', latest {finals[0]['y']}: {finals[0]['w']}")
        else:
            print(f"{cup['label']}: DROPPED — best parse {len(finals)} < min {cup['min']}", file=sys.stderr)
    json.dump(out, open(os.path.join(root, 'data', 'cups.json'), 'w'),
              ensure_ascii=False, separators=(',', ':'))
    print(f"wrote data/cups.json: {len(out)} tournaments")

if __name__ == '__main__':
    main()
