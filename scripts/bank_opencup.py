#!/usr/bin/env python3
"""Bank U.S. Open Cup results (main draw + qualification) from Wikipedia.

Source: per-year Wikipedia articles (CC BY-SA; API is intended for this).
thecup.us is deliberately NOT used — its robots.txt disallows Claude crawlers.

Parses {{football box}} / {{footballbox}} templates: team names, league tags
("(USLC)", "(NPSL)", ...), scores, extra time, penalties, round, date.
Output: data/opencup_matches.json

2020 and 2021 editions were cancelled (COVID) and are skipped.
"""
import json, re, sys, time, urllib.parse, urllib.request

API = 'https://en.wikipedia.org/w/api.php'
UA = 'RankXI-OpenCupBank/1.0 (https://rank-xi.pages.dev; jkientz@gmail.com)'
YEARS = [2016, 2017, 2018, 2019, 2022, 2023, 2024, 2025, 2026]

def api(params):
    q = urllib.parse.urlencode({**params, 'format': 'json'})
    req = urllib.request.Request(f'{API}?{q}', headers={'User-Agent': UA})
    with urllib.request.urlopen(req) as r:
        return json.load(r)

def wikitext(title):
    d = api({'action': 'parse', 'page': title, 'prop': 'wikitext', 'redirects': 1})
    if 'error' in d:
        return None
    return d['parse']['wikitext']['*']

# ---- wikitext helpers -------------------------------------------------------

def split_template(body):
    """Split a template body on top-level pipes (ignores pipes inside [[..]] and {{..}})."""
    parts, depth_sq, depth_br, cur = [], 0, 0, []
    i = 0
    while i < len(body):
        two = body[i:i+2]
        if two == '[[': depth_sq += 1; cur.append(two); i += 2; continue
        if two == ']]': depth_sq -= 1; cur.append(two); i += 2; continue
        if two == '{{': depth_br += 1; cur.append(two); i += 2; continue
        if two == '}}': depth_br -= 1; cur.append(two); i += 2; continue
        if body[i] == '|' and depth_sq == 0 and depth_br == 0:
            parts.append(''.join(cur)); cur = []
        else:
            cur.append(body[i])
        i += 1
    parts.append(''.join(cur))
    return parts

def template_blocks(src, name_re):
    """Yield bodies of top-level {{name ...}} templates matching name_re."""
    for m in re.finditer(r'\{\{\s*(' + name_re + r')\s*[|\n]', src, re.I):
        start = m.start()
        depth, i = 0, start
        while i < len(src) - 1:
            if src[i:i+2] == '{{': depth += 1; i += 2; continue
            if src[i:i+2] == '}}':
                depth -= 1; i += 2
                if depth == 0:
                    yield src[start+2:i-2]
                    break
                continue
            i += 1

def fields(body):
    out = {}
    for part in split_template(body)[1:]:
        if '=' not in part:
            continue
        k, v = part.split('=', 1)
        out[k.strip().lower()] = v.strip()
    return out

TAG_RE = re.compile(r'\((?:[1-5]-)?([A-Z][A-Za-z0-9 .&\'-]{1,14})\)\s*$')

def parse_team(raw):
    """-> (name, league_tag, won_bold). Handles bold winner, flagicons, wikilinks."""
    s = raw.strip()
    won = "'''" in s
    s = s.replace("'''", '')
    s = re.sub(r'\{\{flagicon\|[^}]*\}\}', '', s)
    s = re.sub(r'<[^>]+>', '', s)  # <br>, <small>...
    s = re.sub(r'\{\{[^{}]*\}\}', '', s)  # any leftover template
    s = ' '.join(s.split()).strip("' ")
    league = None
    m = TAG_RE.search(s)
    if m:
        league = m.group(1).strip()
        s = s[:m.start()].strip()
    # resolve [[target|label]] / [[target]]
    def link(mm):
        inner = mm.group(1)
        return inner.split('|')[-1] if '|' in inner else inner
    s = re.sub(r'\[\[([^\]]+)\]\]', link, s).strip(' ,;')
    if league is None:  # tag can sit inside the wikilink label
        m = TAG_RE.search(s)
        if m:
            league = m.group(1).strip()
            s = s[:m.start()].strip(' ,;')
    return s, league, won

SCORE_RE = re.compile(r'(\d+)\s*[–—-]\s*(\d+)')

def parse_box(body, year, comp, rnd):
    f = fields(body)
    t1_raw, t2_raw = f.get('team1', ''), f.get('team2', '')
    if not t1_raw or not t2_raw:
        return None
    t1, l1, w1 = parse_team(t1_raw)
    t2, l2, w2 = parse_team(t2_raw)
    sm = SCORE_RE.search(f.get('score', ''))
    if not sm:
        return None  # unplayed/walkover/TBD
    g1, g2 = int(sm.group(1)), int(sm.group(2))
    pens = None
    pm = SCORE_RE.search(f.get('penaltyscore', ''))
    if pm:
        pens = [int(pm.group(1)), int(pm.group(2))]
    if g1 != g2:
        winner = 1 if g1 > g2 else 2
    elif pens:
        winner = 1 if pens[0] > pens[1] else 2
    elif w1 != w2:
        winner = 1 if w1 else 2
    else:
        winner = 0  # draw with no resolution recorded
    date = re.sub(r'\[\[|\]\]', '', f.get('date', '')).strip()
    rec = {'year': year, 'comp': comp, 'round': rnd, 'date': date,
           't1': t1, 'l1': l1, 't2': t2, 'l2': l2,
           'score': [g1, g2], 'winner': winner}
    if f.get('aet', '').strip().lower() in ('y', 'yes'):
        rec['aet'] = True
    if pens:
        rec['pens'] = pens
    return rec

HEAD_RE = re.compile(r'^(={2,4})\s*(.*?)\s*\1\s*$', re.M)

def parse_article(src, year, comp):
    """Walk headings; every football box under the most recent heading gets that round name."""
    matches = []
    # build (pos, heading) list
    heads = [(m.start(), m.group(2)) for m in HEAD_RE.finditer(src)]
    def round_at(pos):
        cur = None
        for p, h in heads:
            if p > pos:
                break
            cur = h
        return re.sub(r"'''?|\[\[|\]\]", '', cur or '').strip()
    for m in re.finditer(r'\{\{\s*(football\s*box(?:\s+collapsible)?|footballbox(?:\s+collapsible)?)\s*[|\n]', src, re.I):
        start = m.start()
        depth, i = 0, start
        body = None
        while i < len(src) - 1:
            if src[i:i+2] == '{{': depth += 1; i += 2; continue
            if src[i:i+2] == '}}':
                depth -= 1; i += 2
                if depth == 0:
                    body = src[start+2:i-2]
                    break
                continue
            i += 1
        if body is None:
            continue
        rec = parse_box(body, year, comp, round_at(start))
        if rec:
            matches.append(rec)
    return matches

def main():
    all_matches = []
    pages = []
    for y in YEARS:
        pages.append((f'{y} U.S. Open Cup', y, 'usoc'))
        pages.append((f'{y} U.S. Open Cup qualification', y, 'usoc-q'))
    for title, year, comp in pages:
        src = wikitext(title)
        if src is None:
            print(f'  !! missing article: {title}', file=sys.stderr)
            continue
        got = parse_article(src, year, comp)
        print(f'  {title}: {len(got)} matches', file=sys.stderr)
        all_matches.extend(got)
        time.sleep(1)
    # propagate leagues: a team untagged in one round inherits its tag from
    # another appearance in the same year (later rounds often drop the labels)
    known = {}
    for m in all_matches:
        for t, l in ((m['t1'], m['l1']), (m['t2'], m['l2'])):
            if l:
                known.setdefault((m['year'], t), l)
    filled = 0
    for m in all_matches:
        for tk, lk in (('t1', 'l1'), ('t2', 'l2')):
            if not m[lk] and (m['year'], m[tk]) in known:
                m[lk] = known[(m['year'], m[tk])]
                filled += 1
    print(f'propagated {filled} league tags (same year)', file=sys.stderr)
    # second pass: nearest-year tag (late-round entrants — mostly MLS/USLC — are
    # never tagged in modern articles; league membership is stable enough near-term)
    by_team = {}
    for m in all_matches:
        for t, l in ((m['t1'], m['l1']), (m['t2'], m['l2'])):
            if l:
                by_team.setdefault(t, {})[m['year']] = l
    filled2 = 0
    for m in all_matches:
        for tk, lk in (('t1', 'l1'), ('t2', 'l2')):
            if not m[lk] and m[tk] in by_team:
                yrs = by_team[m[tk]]
                best = min(yrs, key=lambda y: (abs(y - m['year']), -y))
                m[lk] = yrs[best]
                filled2 += 1
    print(f'propagated {filled2} league tags (nearest year)', file=sys.stderr)
    out = {'source': 'en.wikipedia.org (CC BY-SA 4.0)', 'fetched': time.strftime('%Y-%m-%d'),
           'years': YEARS, 'matches': all_matches}
    with open('data/opencup_matches.json', 'w') as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(',', ':'))
    print(f'banked {len(all_matches)} matches -> data/opencup_matches.json', file=sys.stderr)

if __name__ == '__main__':
    main()
