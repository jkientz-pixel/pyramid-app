#!/usr/bin/env python3
"""Build data/nt_history.json: historical USA squads for the national teams
on #/nt, scraped from Wikipedia's per-tournament squads pages.

For every FIFA world-tournament edition each team has played — World Cup
(USMNT), Women's World Cup (USWNT), U-20 and U-17 men's and women's world
championships — pull the United States section: shirt number, position, name, birth date, caps/goals where
the page carries them, club at the time, head coach — plus a one-line bio
from the player's own Wikipedia article when one exists.

Minors policy (see rankxi-minors-data-policy): any player who could still be
under 18 today gets name/position/club only — birth date blanked, no bio.

Usage: python3 scripts/fetch_nt_history.py
"""
import json, re, sys, time, urllib.parse, urllib.request, datetime, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
API = 'https://en.wikipedia.org/w/api.php'
UA = 'RankedXI-bot/1.0 (https://rankedxi.com; jkientz@gmail.com)'
MINOR_BIRTH_CUTOFF = datetime.date.today().year - 18  # born this year or later: could be <18
BIO_MAX = 300

def slug(s):
    s = re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')
    return s or 'x'


def api(params):
    q = urllib.parse.urlencode({**params, 'format': 'json'})
    req = urllib.request.Request(f'{API}?{q}', headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)

def page_wikitext(title):
    d = api({'action': 'parse', 'page': title, 'prop': 'wikitext', 'redirects': 1})
    if 'error' in d:
        return None
    return d['parse']['wikitext']['*']

# ---- wikitext helpers -------------------------------------------------------

def split_params(tpl):
    """Split template body on top-level '|' (ignores | inside {{ }} and [[ ]])."""
    parts, depth, cur = [], 0, ''
    i = 0
    while i < len(tpl):
        two = tpl[i:i+2]
        if two in ('{{', '[['):
            depth += 1; cur += two; i += 2; continue
        if two in ('}}', ']]'):
            depth -= 1; cur += two; i += 2; continue
        if tpl[i] == '|' and depth == 0:
            parts.append(cur); cur = ''
        else:
            cur += tpl[i]
        i += 1
    parts.append(cur)
    return parts

def wikilink(s):
    """'[[Target|Display]]' -> (target, display); plain text -> (None, text)."""
    s = s.strip().strip("'")
    m = re.search(r'\[\[([^\]|]+)(?:\|([^\]]+))?\]\]', s)
    if not m:
        return None, re.sub(r"'''?", '', s).strip()
    target = m.group(1).strip()
    display = (m.group(2) or m.group(1)).strip()
    return target, display

def player_name(raw):
    """Name field may carry <ref> tags, bold marks, a wikilink, or
    {{sortname|First|Last[|Article title]}}."""
    s = re.sub(r'<ref[^>]*/>', '', raw)
    s = re.sub(r'<ref[^>]*>.*?</ref>', '', s, flags=re.S).strip()
    m = re.match(r"'*\{\{sortname\|([^|}]+)\|([^|}]+)(?:\|([^}]+))?\}\}", s, re.I)
    if m:
        display = f'{m.group(1).strip()} {m.group(2).strip()}'
        extra = (m.group(3) or '').strip()
        target = None if '=' in extra else (extra or display)
        return target, display
    return wikilink(s)

def parse_birth(agefield):
    """Extract yyyy-mm-dd of birth from {{birth date and age}} (3 numeric
    params: the birth date) or {{birth date and age2}} (6: reference date
    then birth date). Numeric params only — 'age2'/'df=y' must not pollute."""
    nums = [p.strip() for p in re.split(r'[|{}]', agefield) if p.strip().isdigit()]
    if len(nums) >= 6:
        y, m, d = nums[3], nums[4], nums[5]
    elif len(nums) >= 3:
        y, m, d = nums[0], nums[1], nums[2]
    else:
        return None
    y = int(y)
    if 1900 < y < 2030:
        return f'{y:04d}-{int(m):02d}-{int(d):02d}'
    return None

def parse_squad_section(section):
    players = []
    for m in re.finditer(r'\{\{(?:nat fs(?: g)? player|National football squad player|fs player)[^|]*\|(.*)', section, re.I):
        # template runs to end of line; nested {{ }} stay on one line on these pages
        line = m.group(1)
        line = line[:line.rfind('}}')] if '}}' in line else line
        fields = {}
        for part in split_params(line):
            if '=' in part:
                k, _, v = part.partition('=')
                fields[k.strip().lower()] = v.strip()
        if 'name' not in fields:
            continue
        target, display = player_name(fields['name'])
        _, club = wikilink(fields.get('club', ''))
        p = {'name': display, 'pos': re.sub(r'\[\[[^\]]*\|', '', fields.get('pos', '')).replace(']]', '').replace('[[', '').strip()}
        if fields.get('no', '').isdigit():
            p['no'] = int(fields['no'])
        dob = parse_birth(fields.get('age', ''))
        if dob:
            p['dob'] = dob
        if club:
            p['club'] = club
        if fields.get('clubnat'):
            p['clubnat'] = fields['clubnat'].strip().upper()[:3]
        for k in ('caps', 'goals'):
            v = re.sub(r'\D', '', fields.get(k, ''))
            if v:
                p[k] = int(v)
        if 'captain' in fields.get('other', '').lower():
            p['captain'] = True
        if target:
            p['_wiki'] = target
        players.append(p)
    return players

POS_HEAD = {'goalkeepers': 'GK', 'defenders': 'DF', 'midfielders': 'MF',
            'forwards': 'FW', 'strikers': 'FW', 'attackers': 'FW'}

def parse_squad_table(section):
    """Fallback for early-2000s squads pages that use raw wikitables
    (# | Name | Club | DOB | Pld | Goals ...) with position header rows."""
    players, pos = [], None
    for line in section.split('\n'):
        hm = re.search(r'!colspan[^|]*\|\s*([A-Za-z]+)', line)
        if hm:
            pos = POS_HEAD.get(hm.group(1).strip().lower(), pos if hm.group(1).lower() != 'coach' else None)
            if hm.group(1).strip().lower() == 'coach':
                pos = None
            continue
        if not line.startswith('|') or '||' not in line:
            continue
        cells = [c.strip() for c in line.lstrip('|').split('||')]
        if len(cells) < 4 or not pos:
            continue
        no = re.sub(r'\D', '', cells[0])
        target, display = player_name(re.sub(r'align=\w+\|', '', cells[1]))
        if not display:
            continue
        clubcell = re.sub(r'align=\w+\|', '', cells[2])
        cn = re.search(r'\{\{flagicon\|([A-Za-z]+)\}\}', clubcell)
        _, club = wikilink(re.sub(r'\{\{flagicon\|[^}]*\}\}', '', clubcell))
        p = {'name': display, 'pos': pos}
        if no:
            p['no'] = int(no)
        dob = parse_birth(cells[3])
        if dob:
            p['dob'] = dob
        if club:
            p['club'] = club
        if cn:
            p['clubnat'] = cn.group(1).strip().upper()[:3]
        if len(cells) > 5:
            g = re.sub(r'\D', '', cells[5])
            if g and int(g) > 0:
                p['goals'] = int(g)
        if target:
            p['_wiki'] = target
        players.append(p)
    return players

def usa_section(wikitext):
    """USA headings vary: '===United States===', '==={{fbu|20|USA}}===',
    '==={{flagicon|USA}} [[...|United States]]===' — match any level-2/3
    heading naming the USA, slice to the next heading."""
    head = re.compile(r'^={2,4}[^=\n]*(?:United States|\{\{fbu?(?:-rt)?\|(?:\d+\|)?USA[|}])[^\n]*={2,4}\s*$',
                      re.M | re.I)
    m = head.search(wikitext)
    if not m:
        return None
    nxt = re.compile(r'^={2,4}[^=\n]', re.M).search(wikitext, m.end())
    return wikitext[m.end():nxt.start() if nxt else len(wikitext)]

def coach_of(section):
    m = re.search(r"Head coach:?\s*(?:{{[^}]*}}\s*)?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]", section)
    if m:
        return (m.group(2) or m.group(1)).strip()
    m = re.search(r'Head coach:?\s*([A-Z][^\n<{]+)', section)
    return m.group(1).strip() if m else None

def host_of(tournament_title):
    """Host country from the tournament article's infobox |country= param."""
    try:
        d = api({'action': 'parse', 'page': tournament_title, 'prop': 'wikitext',
                 'section': 0, 'redirects': 1})
        w = d['parse']['wikitext']['*']
    except Exception:
        return None
    m = re.search(r'\|\s*(?:country|host)\s*=\s*([^\n]+)', w)
    if not m:
        return None
    raw = re.sub(r'<!--.*?(?:-->|$)', '', m.group(1))  # comments hide stale values
    raw = re.sub(r'\{\{efn\|[^}]*\}\}', '', raw)
    # value may be plain text, a wikilink, or {{flag|X}} lists (co-hosts)
    names = re.findall(r'\{\{(?:flag|flagicon|fb)\|([^}|]+)', raw) or \
        [wikilink(raw)[1].split('|')[-1].strip('{} ')]
    names = [n.strip() for n in names if n.strip()]
    return ' & '.join(names[:2]) if names else None

# ---- editions ---------------------------------------------------------------

def u20_editions():
    for y in range(1977, 2027, 2):
        if y == 2021:  # cancelled (COVID)
            continue
        comp = 'FIFA World Youth Championship' if y <= 2005 else 'FIFA U-20 World Cup'
        yield y, comp, f'{y} {comp} squads'

def u17_editions():
    years = list(range(1985, 2020, 2)) + [2023, 2025]
    for y in years:
        if y <= 1989:
            comp = 'FIFA U-16 World Championship'
        elif y <= 2005:
            comp = 'FIFA U-17 World Championship'
        else:
            comp = 'FIFA U-17 World Cup'
        yield y, comp, f'{y} {comp} squads'

def wc_editions():
    for y in list(range(1930, 1939, 4)) + list(range(1950, 2027, 4)):
        yield y, 'FIFA World Cup', f'{y} FIFA World Cup squads'

def wwc_editions():
    for y in range(1991, 2027, 4):
        yield y, "FIFA Women's World Cup", f"{y} FIFA Women's World Cup squads"

def u20w_editions():
    for y in [2002, 2004]:
        yield y, "FIFA U-19 Women's World Championship", f"{y} FIFA U-19 Women's World Championship squads"
    yield 2006, "FIFA U-20 Women's World Championship", "2006 FIFA U-20 Women's World Championship squads"
    for y in [2008, 2010, 2012, 2014, 2016, 2018, 2022, 2024, 2026]:
        yield y, "FIFA U-20 Women's World Cup", f"{y} FIFA U-20 Women's World Cup squads"

def u17w_editions():
    for y in [2008, 2010, 2012, 2014, 2016, 2018, 2022, 2024, 2025, 2026]:
        yield y, "FIFA U-17 Women's World Cup", f"{y} FIFA U-17 Women's World Cup squads"

# ---- bios -------------------------------------------------------------------

def fetch_bios(titles):
    bios = {}
    titles = sorted(set(titles))
    for i in range(0, len(titles), 20):
        chunk = titles[i:i+20]
        d = api({'action': 'query', 'prop': 'extracts', 'exintro': 1,
                 'explaintext': 1, 'redirects': 1, 'titles': '|'.join(chunk)})
        redir = {r['from']: r['to'] for r in d['query'].get('redirects', [])}
        norm = {n['from']: n['to'] for n in d['query'].get('normalized', [])}
        by_title = {p.get('title'): p.get('extract', '') for p in d['query']['pages'].values()}
        for t in chunk:
            resolved = redir.get(norm.get(t, t), norm.get(t, t))
            ext = (by_title.get(resolved) or '').strip()
            if not ext:
                continue
            # first sentences up to BIO_MAX, cut at a sentence boundary
            bio = ext[:BIO_MAX * 2].split('\n')[0]
            if len(bio) > BIO_MAX:
                cut = bio.rfind('. ', 0, BIO_MAX)
                bio = bio[:cut + 1] if cut > 60 else bio[:BIO_MAX].rstrip() + '…'
            bios[t] = bio
        time.sleep(0.3)
        print(f'  bios {min(i+20, len(titles))}/{len(titles)}', file=sys.stderr)
    return bios

# ---- main -------------------------------------------------------------------

def build_team(editions):
    out, wiki_titles = [], []
    for year, comp, title in editions:
        try:
            w = page_wikitext(title)
        except Exception as e:
            print(f'  {title}: fetch failed ({e})', file=sys.stderr)
            continue
        if not w:
            print(f'  {title}: no page', file=sys.stderr)
            continue
        sec = usa_section(w)
        if not sec:
            print(f'  {year}: USA not present', file=sys.stderr)
            continue
        squad = parse_squad_section(sec) or parse_squad_table(sec)
        if not squad:
            print(f'  {year}: USA section but no parsed players', file=sys.stderr)
            continue
        host = host_of(f'{year} {comp}')
        ed = {'year': year, 'comp': comp, 'squad': squad}
        if host:
            ed['host'] = host
        coach = coach_of(sec)
        if coach:
            ed['coach'] = coach
        out.append(ed)
        wiki_titles += [p['_wiki'] for p in squad if '_wiki' in p]
        print(f'  {year} {comp}: {len(squad)} players' + (f', coach {coach}' if coach else ''), file=sys.stderr)
        time.sleep(0.3)
    return out, wiki_titles

def apply_policy(editions, age_lo, age_hi):
    """Sanity-bound parsed birth dates, apply the minors policy, and stamp a
    stable pid on every row (wiki-title slug when the player has an article,
    name+birth-year slug otherwise) so the app can aggregate a player's
    appearances across teams and link a profile page."""
    minor_pids = set()
    for ed in editions:
        for p in ed['squad']:
            # a template variant could make parse_birth slice the wrong numbers
            # into a plausible-looking date; an implausible age at tournament
            # must fall back to the cautious path, never be trusted by the
            # minors gate below
            if 'dob' in p and not (age_lo <= ed['year'] - int(p['dob'][:4]) <= age_hi):
                del p['dob']
            by = int(p['dob'][:4]) if 'dob' in p else None
            minor_risk = (by >= MINOR_BIRTH_CUTOFF) if by is not None else \
                ed['year'] >= datetime.date.today().year - 3  # unknown DOB on a recent edition: assume cautious
            p['pid'] = slug(p['_wiki']) if '_wiki' in p else \
                slug(p['name']) + (f'-{by}' if by else '')
            if minor_risk:
                p.pop('dob', None)  # minors policy: name only, birth year blanked
                p.pop('_wiki', None)
                minor_pids.add(p['pid'])
    return minor_pids

TEAMS = (
    #  id        name                                  editions        min  age range
    ('usmnt',  "U.S. Men's National Team",             wc_editions,     8, (15, 45)),
    ('u20mnt', "U.S. Under-20 Men's National Team",    u20_editions,   15, (13, 23)),
    ('u17mnt', "U.S. Under-17 Men's National Team",    u17_editions,   15, (12, 20)),
    ('uswnt',  "U.S. Women's National Team",           wwc_editions,    8, (15, 45)),
    ('u20wnt', "U.S. Under-20 Women's National Team",  u20w_editions,   7, (13, 23)),
    ('u17wnt', "U.S. Under-17 Women's National Team",  u17w_editions,   5, (12, 20)),
)

def main():
    teams, players, minor_pids = {}, {}, set()
    for tid, name, gen, min_eds, (lo, hi) in TEAMS:
        print(f'== {tid}', file=sys.stderr)
        editions, wiki_titles = build_team(gen())
        # partial scrapes must fail loudly, not overwrite good data with gaps
        if len(editions) < min_eds:
            sys.exit(f'FATAL: only {len(editions)} editions scraped for {tid} (need {min_eds}) — refusing to write')
        minor_pids |= apply_policy(editions, lo, hi)
        editions.sort(key=lambda e: -e['year'])
        teams[tid] = {'name': name, 'editions': editions, '_titles': wiki_titles}
    all_titles = [t for v in teams.values() for t in v.pop('_titles')]
    print(f'== bios for {len(set(all_titles))} linked players', file=sys.stderr)
    bios = fetch_bios(all_titles)
    # bios live once per player in a top-level map (a U-17 alum reappears on
    # the U-20s and seniors); rows carry only the pid. A player flagged as a
    # possible minor anywhere gets no bio at all.
    for v in teams.values():
        for ed in v['editions']:
            for p in ed['squad']:
                w = p.pop('_wiki', None)
                if w and p['pid'] not in minor_pids and bios.get(w):
                    players.setdefault(p['pid'], {})['bio'] = bios[w]
    out = {'updated': datetime.date.today().isoformat(),
           'source': 'Wikipedia per-tournament squads pages',
           'teams': teams, 'players': players}
    dst = ROOT / 'data' / 'nt_history.json'
    dst.write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')) + '\n')
    n = sum(len(e['squad']) for v in teams.values() for e in v['editions'])
    print(f'wrote {dst} — {sum(len(v["editions"]) for v in teams.values())} editions, {n} player rows, {len(players)} player bios')

if __name__ == '__main__':
    main()
