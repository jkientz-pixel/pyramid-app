#!/usr/bin/env python3
"""Build data/players.json: photo, career path, national team, honours,
and official socials for every real rostered player, from Wikipedia.
One wikitext call per player + batched photo lookups. Run after
refresh_rosters.py; scheduled with the same cadence."""
import json, re, urllib.request, urllib.parse, time, os, sys

UA = {'User-Agent': 'RankXI/0.1 (jkientz@gmail.com; player profiles)'}

def api(params):
    url = 'https://en.wikipedia.org/w/api.php?' + urllib.parse.urlencode(params)
    for _ in range(4):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20))
        except Exception as e:
            if '429' in str(e):
                time.sleep(12); continue
            raise
    raise RuntimeError('rate limited')

def field(text, name):
    m = re.search(r'\|\s*' + name + r'\s*=\s*(.*)', text)
    if not m: return None
    v = re.sub(r'<[^>]+>', '', m.group(1)).strip()
    return v or None

LINK = re.compile(r'\[\[([^\]|]+)(?:\|([^\]]+))?\]\]')
def linktext(v):
    if not v: return None
    m = LINK.search(v)
    if m:
        out = (m.group(2) or m.group(1)).strip()
    else:
        out = re.sub(r'\{\{[^}]*\}\}', '', v).strip()
    if not out or any(ch in out for ch in '|={}<>'):
        return None
    return out[:60]

def parse_player(text):
    p = {}
    img = field(text, 'image')
    if img:
        p['imgfile'] = re.sub(r'^(File|Image):', '', img).split('|')[0].strip()
    career = []
    for i in range(1, 12):
        club = linktext(field(text, f'clubs{i}'))
        if not club: break
        yrs = re.sub(r'\{\{[^}]*\}\}|<[^>]+>', '', field(text, f'years{i}') or '').strip()
        caps = field(text, f'caps{i}'); goals = field(text, f'goals{i}')
        career.append({'club': club, 'years': yrs,
                       'apps': re.sub(r'\D', '', caps or '')[:3] or None,
                       'goals': re.sub(r'\D', '', goals or '')[:3] or None})
    if career: p['career'] = career
    youth = []
    for i in range(1, 5):
        yc = linktext(field(text, f'youthclubs{i}'))
        if yc: youth.append(yc)
    single_yc = linktext(field(text, 'youthclubs'))
    if single_yc and not youth: youth = [single_yc]
    if youth: p['youth'] = youth
    college = linktext(field(text, 'college'))
    if college: p['college'] = college
    nat = []
    for i in range(1, 5):
        team = linktext(field(text, f'nationalteam{i}'))
        if not team: break
        ncaps = field(text, f'nationalcaps{i}'); ngoals = field(text, f'nationalgoals{i}')
        yrsn = re.sub(r'\{\{[^}]*\}\}|<[^>]+>', '', field(text, f'nationalyears{i}') or '').strip()
        nat.append({'team': team, 'years': yrsn,
                    'caps': re.sub(r'\D', '', ncaps or '')[:3] or None,
                    'goals': re.sub(r'\D', '', ngoals or '')[:3] or None})
    if nat: p['nat'] = nat
    tw = re.search(r'\{\{\s*Twitter\s*\|\s*(?:id\s*=\s*)?([^}|]+)', text, re.I)
    ig = re.search(r'\{\{\s*Instagram\s*\|\s*(?:id\s*=\s*)?([^}|]+)', text, re.I)
    ow = re.search(r'\{\{\s*Official website\s*\|\s*(?:url\s*=\s*)?([^}|]+)', text, re.I)
    if tw: p['x'] = 'https://x.com/' + tw.group(1).strip()
    if ig: p['ig'] = 'https://www.instagram.com/' + ig.group(1).strip()
    if ow:
        u = ow.group(1).strip()
        p['site'] = u if u.startswith('http') else 'https://' + u
    hon = []
    hm = re.search(r'==+\s*Honou?rs[^=\n]*==+(.*?)(?:\n==[^=]|\Z)', text, re.S | re.I)
    if hm:
        for line in hm.group(1).split('\n'):
            if not line.lstrip().startswith('*'): continue
            lt = LINK.search(line.replace("'''", ''))
            if not lt: continue
            comp = (lt.group(2) or lt.group(1)).strip()
            years = re.findall(r'(?:19|20)\d\d(?:–\d\d)?', line)
            if comp and len(comp) < 60:
                hon.append({'t': comp, 'y': years[:8]})
    if hon: p['honours'] = hon[:10]
    return p

def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    rosters = json.loads(re.search(r'export const ROSTERS=(\{.*?\});',
        open(os.path.join(root, 'js', 'rosters.js')).read(), re.S).group(1))
    targets = {}
    for club, players in rosters.items():
        for pl in players:
            if pl.get('wiki'):
                title = urllib.parse.unquote(pl['wiki'].split('/wiki/')[-1]).replace('_', ' ')
                targets[pl['name']] = title
    print(f'{len(targets)} players with articles', file=sys.stderr)
    profiles = {}
    done = 0
    for name, title in targets.items():
        try:
            q = api({'action': 'parse', 'page': title, 'prop': 'wikitext', 'redirects': 1, 'format': 'json'})
            profiles[name] = parse_player(q['parse']['wikitext']['*'])
        except Exception as e:
            profiles[name] = {}
        done += 1
        if done % 50 == 0:
            print(f'{done}/{len(targets)}', flush=True)
        time.sleep(1.1)
    # batched photos
    titles = list(targets.values())
    t2n = {v: k for k, v in targets.items()}
    for i in range(0, len(titles), 50):
        batch = titles[i:i+50]
        try:
            q = api({'action': 'query', 'titles': '|'.join(batch), 'prop': 'pageimages',
                     'pithumbsize': 240, 'pilicense': 'any', 'redirects': 1, 'format': 'json'})
            redir = {r['to']: r['from'] for r in q['query'].get('redirects', [])}
            for page in q['query']['pages'].values():
                t = page.get('title'); orig = redir.get(t, t)
                nm = t2n.get(orig) or t2n.get(t)
                thumb = page.get('thumbnail', {}).get('source')
                if nm and thumb and nm in profiles:
                    profiles[nm]['photo'] = thumb
        except Exception as e:
            print(f'photo batch {i}: {e}', file=sys.stderr)
        time.sleep(1.5)
    with_photo = sum(1 for p in profiles.values() if p.get('photo'))
    json.dump(profiles, open(os.path.join(root, 'data', 'players.json'), 'w'),
              ensure_ascii=False, separators=(',', ':'))
    print(f'wrote data/players.json: {len(profiles)} profiles, {with_photo} photos')

if __name__ == '__main__':
    main()
