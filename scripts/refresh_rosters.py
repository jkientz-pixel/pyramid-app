#!/usr/bin/env python3
"""Pull current MLS squads, coaching staff, and club honours from Wikipedia
into js/rosters.js. Run by GitHub Action on a schedule; safe to run manually."""
import json, re, urllib.request, urllib.parse, time, sys, os

UA = {'User-Agent': 'PyramidConcept/0.1 (jkientz@gmail.com; roster refresh)'}
TITLE_OVERRIDES = {
    'St. Louis City': 'St. Louis City SC',
    'LAFC': 'Los Angeles FC',
    'DC United': 'D.C. United',
    'CF Montreal': 'CF Montréal',
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
    tm = re.search(r'\|\s*mgrtitle\s*=\s*(.+)', text)
    if tm:
        raw = re.sub(r'\[\[|\]\]|\{\{[^}]*\}\}', '', tm.group(1)).strip()
        if raw and len(raw) < 30:
            role = raw.split('|')[-1].title()
    for key in ('head_coach', 'manager'):
        m = re.search(r'\|\s*' + key + r'\s*=\s*(.+)', text)
        if not m:
            continue
        if key == 'head_coach':
            role = 'Head Coach'
        lm = LINK_RE.search(m.group(1))
        if lm:
            return {'name': lm.group(2) or lm.group(1), 'role': role}
        plain = re.sub(r'\{\{[^}]*\}\}|<[^>]+>', '', m.group(1)).strip()
        if plain and len(plain) < 40:
            return {'name': plain, 'role': role}
    return None

def parse_honours(title):
    try:
        secs = api({'action': 'parse', 'page': title, 'prop': 'sections', 'redirects': 1, 'format': 'json'})
        idx = next((s['index'] for s in secs['parse']['sections']
                    if s['line'].lower().startswith(('honours', 'honors'))), None)
        if not idx:
            return []
        text = wikitext(title, idx)
        out = []
        for line in text.split('\n'):
            if not line.lstrip().startswith('*'):
                continue
            lm = LINK_RE.search(line.replace(BOLD3, ''))
            if not lm:
                continue
            comp = (lm.group(2) or lm.group(1)).strip()
            years = re.findall(r'(?:19|20)\d\d(?:–\d\d)?', line)
            if comp and years and len(comp) < 60:
                out.append({'t': comp, 'y': years[:12]})
        return out[:8]
    except Exception:
        return []

def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    data = open(os.path.join(root, 'js', 'data.js')).read()
    clubs = json.loads(re.search(r'export const CLUBS=(\[.*?\]);', data, re.S).group(1))
    targets = [c['n'] for c in clubs if c['g'] == 'mls']
    rosters, coaches, honours = {}, {}, {}
    for name in targets:
        title = TITLE_OVERRIDES.get(name, name)
        try:
            text = wikitext(title)
            squad = parse_squad(text)
            if len(squad) >= 15:
                rosters[name] = squad
                hc = parse_coach(text)
                if hc:
                    coaches[name] = hc
                hon = parse_honours(title)
                if hon:
                    honours[name] = hon
                staff = coaches[name]['role'] + ' ' + coaches[name]['name'] if name in coaches else 'no staff'
                print(f'{name}: {len(squad)} players, {len(hon)} honours, {staff}')
            else:
                print(f'{name}: only {len(squad)} parsed - skipped', file=sys.stderr)
        except Exception as e:
            print(f'{name}: FAILED {e}', file=sys.stderr)
        time.sleep(1.2)
    out = ('// generated by scripts/refresh_rosters.py - do not edit by hand\n'
           'export const ROSTERS=' + json.dumps(rosters, ensure_ascii=False, separators=(',', ':')) +
           ';\nexport const COACHES=' + json.dumps(coaches, ensure_ascii=False) +
           ';\nexport const HONOURS=' + json.dumps(honours, ensure_ascii=False, separators=(',', ':')) + ';\n')
    open(os.path.join(root, 'js', 'rosters.js'), 'w').write(out)
    print(f'wrote js/rosters.js: {len(rosters)} clubs, {sum(len(v) for v in rosters.values())} players, {len(honours)} with honours')

if __name__ == '__main__':
    main()
