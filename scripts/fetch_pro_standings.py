#!/usr/bin/env python3
"""Real 2026 standings for pro leagues from Wikipedia season articles
(conference-table templates or inline sports-table params). Applies
standings-derived ratings (rr=2) to js/data.js."""
import json, re, urllib.request, urllib.parse, time, os, sys, unicodedata

UA = {'User-Agent': 'RankXI/0.1 (jkientz@gmail.com; pro standings)'}
LEAGUES = [
    ('uslc', '2026 USL Championship season', 1700, 2.8),
    ('usl1', '2026 USL League One season', 1620, 2.8),
    ('mnp',  '2026 MLS Next Pro season', 1600, 2.5),
    ('nwsl', '2026 National Women\'s Soccer League season', 1820, 3.0),
    ('uslw', '2026 USL Super League season', 1720, 2.8),
]

def wikitext(title):
    url = 'https://en.wikipedia.org/w/api.php?' + urllib.parse.urlencode(
        {'action': 'parse', 'page': title, 'prop': 'wikitext', 'redirects': 1, 'format': 'json'})
    for _ in range(3):
        try:
            r = json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=25))
            if 'error' in r: return None
            return r['parse']['wikitext']['*']
        except Exception as e:
            if '429' in str(e): time.sleep(12); continue
            return None
    return None

def rows_from(text):
    out = []
    for c in set(re.findall(r'\|\s*win_([A-Za-z0-9]{2,6})\s*=', text)):
        def g(k):
            m = re.search(r'\|\s*' + k + '_' + c + r'\s*=\s*([\-\d]+)', text)
            return int(m.group(1)) if m else None
        m = re.search(r'\|\s*name_' + c + r'\s*=\s*(.+)', text)
        if not m: continue
        lm = re.search(r'\[\[([^\]|]+)(?:\|([^\]]+))?\]\]', m.group(1))
        nm = (lm.group(2) or lm.group(1)).strip() if lm else m.group(1).strip()
        w, d, l = g('win'), g('draw'), g('loss')
        gf, ga = g('gf'), g('ga')
        if w is None or l is None: continue
        d = d or 0
        out.append({'name': nm, 'pts': 3 * w + d,
                    'gd': (gf - ga) if (gf is not None and ga is not None) else 0})
    return out

def deacc(x): return unicodedata.normalize('NFKD', x).encode('ascii', 'ignore').decode()
def norm(n): return re.sub(r'\b(fc|sc|cf|afc|cd|club|the)\b', '', deacc(n).lower()).replace(' ', '').replace('.', '')

def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    dpath = os.path.join(root, 'js', 'data.js')
    cur = open(dpath).read()
    clubs = json.loads(re.search(r'export const CLUBS=(\[.*?\]);', cur, re.S).group(1))
    for g, article, base, mult in LEAGUES:
        text = wikitext(article)
        time.sleep(1.0)
        if not text:
            print(f'{g}: article missing', file=sys.stderr); continue
        rows = rows_from(text)
        for tpl in re.findall(r'\{\{((?:[^{}]|\{\{[^{}]*\}\})*?table[^{}|]*)', text):
            pass
        if len(rows) < 5:
            tpls = [t.strip() for t in set(re.findall(r'\{\{([^|}\n]+)', text))
                    if re.search(r'table', t, re.I) and str(2026) in t]
            for t in tpls:
                tt = wikitext('Template:' + t)
                time.sleep(1.0)
                if tt: rows += rows_from(tt)
        if len(rows) < 5:
            print(f'{g}: only {len(rows)} rows', file=sys.stderr); continue
        seen = {}
        for r in rows: seen[r['name']] = r
        srows = {norm(r['name']): r for r in seen.values()}
        applied = 0
        for c in clubs:
            if c['g'] != g: continue
            k = norm(c['n'])
            r = srows.get(k)
            if not r:
                cand = [v for kk, v in srows.items() if (len(k) > 7 and k[:8] in kk) or (len(kk) > 7 and kk[:8] in k)]
                r = cand[0] if len(cand) == 1 else None
            if r:
                c['r'] = base + r['pts'] * mult + r['gd']; c['rr'] = 2; applied += 1
        print(f'{g}: {len(seen)} table rows, applied to {applied} clubs')
    cur = cur[:cur.index('export const CLUBS=')] + 'export const CLUBS=' + \
        json.dumps(clubs, ensure_ascii=False, separators=(',', ':')) + ';\n' + \
        cur[cur.index('export const REGIONS='):]
    open(dpath, 'w').write(cur)

if __name__ == '__main__':
    main()
