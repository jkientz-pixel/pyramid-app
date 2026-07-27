#!/usr/bin/env python3
"""Second-pass standings matcher: fuzzy-joins season standings rows to
clubs still unrated in usl2/uslwl/wpsl/uws (exact-norm join happened at
ingest). Token-overlap >= 60% on distinctive tokens, unique best match."""
import json, re, os, sys, unicodedata
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from add_leagues_2026 import wikitext, standings_rows, SOURCES

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def deacc(x): return unicodedata.normalize('NFKD', x).encode('ascii', 'ignore').decode()
def toks(s):
    return set(re.findall(r"[a-z0-9]+", deacc(s).lower())) - {'fc', 'sc', 'cf', 'afc', 'the', 'of', 'club', 'soccer', 'football', 'womens', 'women', 'w'}

SRC = dict(SOURCES)
SRC['uws'] = {**SRC['uws'], 'standings': "2026 United Women's Soccer Season"}

def main():
    dpath = os.path.join(ROOT, 'js', 'data.js')
    cur = open(dpath).read()
    clubs = json.loads(re.search(r'export const CLUBS=(\[.*?\]);', cur, re.S).group(1))
    import time
    for g in ('usl2', 'uslwl', 'wpsl', 'uws'):
        meta = SRC[g]
        if not meta['standings']: continue
        rows = standings_rows(wikitext(meta['standings']))
        time.sleep(1)
        pool = [c for c in clubs if c['g'] == g and not c.get('rr')]
        used = set()
        hit = 0
        for c in pool:
            ct = toks(c['n'])
            best = None
            for i, r in enumerate(rows):
                if i in used: continue
                rt = toks(r['name'])
                if not ct or not rt: continue
                ov = len(ct & rt) / min(len(ct), len(rt))
                if ov >= 0.6 and (best is None or ov > best[0]):
                    best = (ov, i, r)
            if best:
                _, i, r = best
                used.add(i)
                val = meta['base'] + r['pts'] * meta['mult'] + r['gd']
                c['r'] = int(max(1420, min(1780, val))); c['rr'] = 2
                hit += 1
        print(f"{g}: fuzzy-rated {hit} of {len(pool)} unrated (standings rows: {len(rows)})", file=sys.stderr)
    cur = re.sub(r'export const CLUBS=\[.*?\];',
                 lambda m: 'export const CLUBS=' + json.dumps(clubs, ensure_ascii=False, separators=(',', ':')) + ';',
                 cur, count=1, flags=re.S)
    open(dpath, 'w').write(cur)
    from collections import Counter
    print('rr now:', Counter(c.get('rr', 0) for c in clubs), file=sys.stderr)

if __name__ == '__main__':
    main()
