#!/usr/bin/env python3
"""Pull current MLS + USL Super League squads, coaching staff, and club honours
from Wikipedia into js/rosters.js. Run by GitHub Action on a schedule; safe to
run manually. ALWAYS run scripts/fetch_asa.py afterwards — this script rebuilds
rosters.js from scratch, and fetch_asa.py re-adds the ASA-only leagues + stats."""
import json, re, urllib.request, urllib.parse, time, sys, os

UA = {'User-Agent': 'PyramidConcept/0.1 (jkientz@gmail.com; roster refresh)'}
TITLE_OVERRIDES = {
    'St. Louis City': 'St. Louis City SC',
    'LAFC': 'Los Angeles FC',
    'DC United': 'D.C. United',
    'CF Montreal': 'CF Montréal',
    # USL Super League women's sides (Brooklyn FC's article has no squad
    # template, so that club stays ASA-built; Lexington SC shares the men's
    # club article and is handled by the women's-section lookup)
    'Carolina Ascent': 'Carolina Ascent FC',
    'Dallas Trinity': 'Dallas Trinity FC',
    'Fort Lauderdale United': 'Fort Lauderdale United FC',
    'Spokane Zephyr': 'Spokane Zephyr FC',
    'Tampa Bay Sun': 'Tampa Bay Sun FC',
    'DC Power': 'DC Power FC',
}

def api(params):
    url = 'https://en.wikipedia.org/w/api.php?' + urllib.parse.urlencode(params)
    for attempt in range(4):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20))
        except Exception as e:
            if '429' in str(e):
                time.sleep(15)
                continue
            raise
    raise RuntimeError('rate limited')

def wikitext(title, section=None):
    p = {'action': 'parse', 'page': title, 'prop': 'wikitext', 'redirects': 1, 'format': 'json'}
    if section is not None:
        p['section'] = section
    return api(p)['parse']['wikitext']['*']

def split_params(text):
    parts, buf, curly, square = [], [], 0, 0
    i = 0
    while i < len(text):
        two = text[i:i+2]
        if two == '{{': curly += 1; buf.append(two); i += 2; continue
        if two == '}}': curly -= 1; buf.append(two); i += 2; continue
        if two == '[[': square += 1; buf.append(two); i += 2; continue
        if two == ']]': square -= 1; buf.append(two); i += 2; continue
        if text[i] == '|' and curly == 0 and square == 0:
            parts.append(''.join(buf)); buf = []
        else:
            buf.append(text[i])
        i += 1
    parts.append(''.join(buf))
    return parts

PLAYER_RE = re.compile(r'\{\{(?:fs player|football squad player)\s*\|([^}]*)\}\}', re.I)
LINK_RE = re.compile(r'\[\[([^\]|]+)(?:\|([^\]]+))?\]\]')
BOLD3 = "'''"

def parse_squad(text):
    players = []
    for m in PLAYER_RE.finditer(text):
        fields = {}
        for part in split_params(m.group(1)):
            if '=' in part:
                k, v = part.split('=', 1)
                fields[k.strip().lower()] = v.strip()
        name_raw = fields.get('name', '')
        wiki = None
        sm = re.match(r'\{\{\s*sortname\s*\|([^|}]+)\|([^|}]+)(?:\|([^}|]+))?', name_raw, re.I)
        lm = LINK_RE.match(name_raw)
        if sm:
            display = (sm.group(1).strip() + ' ' + sm.group(2).strip()).strip()
            wiki = (sm.group(3) or display).strip()
            if wiki.lower().startswith('nolink'):
                wiki = None
        elif lm:
            wiki = lm.group(1)
            display = lm.group(2) or lm.group(1)
        else:
            display = re.sub(r'\{\{[^}]*\}\}', '', name_raw).strip()
        pos = fields.get('pos', '').upper()
        if pos not in ('GK', 'DF', 'MF', 'FW') or not display:
            continue
        players.append({
            'num': fields.get('no', '').strip() or None,
            'pos': pos, 'name': display, 'nat': fields.get('nat', '').strip() or None,
            'wiki': ('https://en.wikipedia.org/wiki/' + urllib.parse.quote(wiki.replace(' ', '_'))) if wiki else None,
        })
    return players

def parse_coach(text):
    role = 'Head Coach'
    tm = re.search(r'\|\s*mgrtitle\s*=[ \t]*(.+)', text)
    if tm:
        raw = re.sub(r'\[\[|\]\]|\{\{[^}]*\}\}', '', tm.group(1)).strip()
        if raw and len(raw) < 30:
            role = raw.split('|')[-1].title()
    for key in ('head_coach', 'manager'):
        # [ \t]* (not \s*) after '=' so an empty field doesn't swallow the next line
        m = re.search(r'\|\s*' + key + r'\s*=[ \t]*(.+)', text)
        if not m:
            continue
        if key == 'head_coach':
            role = 'Head Coach'
        lm = LINK_RE.search(m.group(1))
        if lm:
            nm = lm.group(2) or lm.group(1)
            if not re.search(r'league|soccer|football|\bUSL\b|\bTBD\b|vacant', nm, re.I):
                return {'name': nm, 'role': role}
            continue
        plain = re.sub(r'\{\{[^}]*\}\}|<[^>]+>', '', m.group(1)).strip()
        if plain and len(plain) < 40 and not re.search(r'league|soccer|football|\bUSL\b|\bTBD\b|vacant', plain, re.I):
            return {'name': plain, 'role': role}
    return None

YEAR_RE = re.compile(r'(?:19|20)\d\d(?:[–-]\d\d)?(?![\d-])')
SKIP_RE = re.compile(r'runners?[-\s]?up|second place|third place|finalist', re.I)
ATTR_RE = re.compile(r'^\s*(?:style|colspan|rowspan|align|width|scope|class)\s*=\s*"[^"]*"\s*', re.I)


def _strip_refs(cell):
    cell = re.sub(r'<ref[^>]*/>', '', cell)
    cell = re.sub(r'<ref.*?</ref>', '', cell, flags=re.S)
    cell = re.sub(r'\{\{[^{}]*\}\}', '', cell)
    while True:
        stripped = ATTR_RE.sub('', cell)
        if stripped == cell:
            break
        cell = stripped
    return cell.lstrip('|! ').strip()


def _clean_comp(cell):
    """Competition name from a wikitext cell: link label wins, markup dropped."""
    cell = _strip_refs(cell)
    m = LINK_RE.search(cell.replace(BOLD3, ''))
    name = (m.group(2) or m.group(1)) if m else cell
    name = re.sub(r"'''|''|\[\[|\]\]", '', name).strip()
    # "[[MLS Western Conference|Western Conference]] (Playoffs)" keeps its qualifier
    tail = cell.split(']]')[-1].strip(" '|") if ']]' in cell else ''
    if tail.startswith('(') and len(name) + len(tail) < 58:
        name = name + ' ' + tail
    return re.sub(r'\s+', ' ', name).strip()


def _years(cell):
    out = []
    for y in YEAR_RE.findall(_strip_refs(cell)):
        if y not in out:
            out.append(y)
    return out


def _honours_from_table(text):
    """Many clubs (Seattle, LA Galaxy, ...) list honours in a wikitable with
    Competition | Titles | Seasons columns — the bullet parser sees none of it."""
    out = []
    for block in re.findall(r'\{\|.*?\n\|\}', text, re.S):
        for row in re.split(r'\n\|-+', block):
            cells = [c for c in re.split(r'\n[!|]', row) if c.strip()]
            if len(cells) < 2:
                continue
            comp = _clean_comp(cells[0])
            if not comp or len(comp) > 58 or len(comp) < 3 or YEAR_RE.fullmatch(comp):
                continue
            if SKIP_RE.search(row):
                continue
            years = []
            for c in cells[1:]:
                for y in _years(c):
                    if y not in years:
                        years.append(y)
            if years:
                out.append({'t': comp, 'y': years[:12]})
    return out[:8]


def _honours_from_bullets(text):
    """Bullet form: '* Competition' with '** Winners (n): years' beneath.
    Taking the first wikilink on every bullet made the YEAR the trophy name on
    12 clubs (CF Montreal, Atlanta United, ...); anchor years to the parent."""
    out, cur = [], None
    for line in text.split('\n'):
        st = line.lstrip()
        if not st.startswith('*'):
            continue
        depth = len(st) - len(st.lstrip('*'))
        if SKIP_RE.search(line):
            if depth == 1:
                cur = None
            continue
        comp = _clean_comp(st.lstrip('*'))
        if comp and YEAR_RE.fullmatch(comp):
            comp = ''
        if depth == 1:
            cur = {'t': comp, 'y': []} if (comp and 2 < len(comp) < 58) else None
            if cur:
                out.append(cur)
        if cur:
            for y in _years(line):
                if y not in cur['y']:
                    cur['y'].append(y)
    return [h for h in out if h['y'] and not YEAR_RE.fullmatch(h['t'])][:8]


def parse_honours(title):
    try:
        secs = api({'action': 'parse', 'page': title, 'prop': 'sections', 'redirects': 1, 'format': 'json'})
        idx = next((s['index'] for s in secs['parse']['sections']
                    if s['line'].lower().startswith(('honours', 'honors'))), None)
        if not idx:
            return []
        text = wikitext(title, idx)
        return _honours_from_table(text) or _honours_from_bullets(text)
    except Exception:
        return []


def womens_section_text(title):
    """For articles shared between a men's and a women's team (e.g. Lexington SC),
    return the wikitext of the women's roster section only. Returns None when the
    article has no separate women's squad section (dedicated women's articles)."""
    secs = api({'action': 'parse', 'page': title, 'prop': 'sections', 'redirects': 1, 'format': 'json'})
    for s in secs['parse']['sections']:
        if not re.search(r'women|super league|gainbridge', s['line'], re.I):
            continue
        # skip combined sections like "Men and women's rosters" — the standalone
        # word "men" (not the one inside "women") marks a mixed section
        if re.search(r"\bmen(?:'s)?\b", s['line'], re.I):
            continue
        text = wikitext(title, s['index'])
        if len(parse_squad(text)) >= 12:
            return text
    return None

def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    data = open(os.path.join(root, 'js', 'data.js')).read()
    clubs = json.loads(re.search(r'export const CLUBS=(\[.*?\]);', data, re.S).group(1))
    targets = [c for c in clubs if c['g'] in ('mls', 'uslw')]
    dup_names = {n for n in {c['n'] for c in clubs}
                 if len({c2['g'] for c2 in clubs if c2['n'] == n}) > 1}
    rosters, coaches, honours = {}, {}, {}
    for club in targets:
        name, g = club['n'], club['g']
        key = g + ':' + name if name in dup_names else name
        title = TITLE_OVERRIDES.get(name, name)
        try:
            text = wikitext(title)
            shared_article = False
            if g == 'uslw':
                sec = womens_section_text(title)
                if sec is not None:
                    text = sec
                    shared_article = True
            squad = parse_squad(text)
            min_squad = 15 if g == 'mls' else 12
            if len(squad) >= min_squad:
                rosters[key] = squad
                # on shared articles the infobox coach and honours belong to the
                # men's team, so only dedicated articles contribute them
                hc = None if shared_article else parse_coach(text)
                if hc:
                    coaches[key] = hc
                hon = [] if shared_article else parse_honours(title)
                if hon:
                    honours[key] = hon
                staff = coaches[key]['role'] + ' ' + coaches[key]['name'] if key in coaches else 'no staff'
                print(f'{key}: {len(squad)} players, {len(hon)} honours, {staff}')
            else:
                print(f'{key}: only {len(squad)} parsed - skipped', file=sys.stderr)
        except Exception as e:
            print(f'{key}: FAILED {e}', file=sys.stderr)
        time.sleep(1.2)
    out = ('// generated by scripts/refresh_rosters.py - do not edit by hand\n'
           'export const ROSTERS=' + json.dumps(rosters, ensure_ascii=False, separators=(',', ':')) +
           ';\nexport const COACHES=' + json.dumps(coaches, ensure_ascii=False) +
           ';\nexport const HONOURS=' + json.dumps(honours, ensure_ascii=False, separators=(',', ':')) + ';\n')
    open(os.path.join(root, 'js', 'rosters.js'), 'w').write(out)
    print(f'wrote js/rosters.js: {len(rosters)} clubs, {sum(len(v) for v in rosters.values())} players, {len(honours)} with honours')

if __name__ == '__main__':
    main()
