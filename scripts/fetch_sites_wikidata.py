#!/usr/bin/env python3
"""Harvest official websites (P856) + socials (P2002 twitter / P2003 instagram)
from Wikidata for clubs lacking a url. Stages results to data/sites_wikidata.json
(does NOT write data.js — applied separately to avoid concurrent-writer clobber).
Match guard: candidate label must share >=50% of the club-name tokens."""
import json, re, os, sys, time, urllib.request, urllib.parse, unicodedata

UA = {'User-Agent': 'RankXI/1.0 (jkientz@gmail.com; sites harvest)'}
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'sites_wikidata.json')

def deacc(x): return unicodedata.normalize('NFKD', x).encode('ascii', 'ignore').decode()
def toks(s): return set(re.findall(r'[a-z0-9]+', deacc(s).lower())) - {'fc','sc','cf','afc','the','of','club'}

def api(params):
    url = 'https://www.wikidata.org/w/api.php?' + urllib.parse.urlencode({**params, 'format': 'json'})
    for _ in range(3):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30))
        except Exception as e:
            time.sleep(3)
    return {}

def search(name):
    r = api({'action': 'wbsearchentities', 'search': name, 'language': 'en', 'type': 'item', 'limit': 3})
    best = None
    nt = toks(name)
    for hit in r.get('search', []):
        label = hit.get('label', '') + ' ' + hit.get('description', '')
        ht = toks(hit.get('label', ''))
        if not nt or not ht: continue
        overlap = len(nt & ht) / max(1, min(len(nt), len(ht)))
        desc = hit.get('description', '').lower()
        bonus = 0.3 if any(k in desc for k in ('soccer', 'football', 'athletic', 'university', 'college', 'sports')) else 0
        score = overlap + bonus
        if len(nt & ht) >= max(1, len(nt) // 2) and (best is None or score > best[0]):
            best = (score, hit['id'])
    return best[1] if best else None

def main():
    dpath = os.path.join(ROOT, 'js', 'data.js')
    clubs = json.loads(re.search(r'export const CLUBS=(\[.*?\]);', open(dpath).read(), re.S).group(1))
    staged = json.load(open(OUT)) if os.path.exists(OUT) else {}
    targets = [c for c in clubs if not c.get('url') and c['n'] not in staged]
    only = set(sys.argv[1].split(',')) if len(sys.argv) > 1 else None
    if only: targets = [c for c in targets if c['g'] in only]
    print(f'{len(targets)} clubs to look up', file=sys.stderr)

    qids = {}
    for i, c in enumerate(targets):
        name = c['n']
        q = search(name)
        if not q and c['g'] in ('ncaa1', 'ncaa2'):
            # try without trailing nickname words (last 2 tokens)
            words = name.split()
            if len(words) > 3: q = search(' '.join(words[:-2]))
        qids[name] = q
        if i % 40 == 0: print(f'  search {i}/{len(targets)}', file=sys.stderr)
        time.sleep(0.6)

    found = {k: v for k, v in qids.items() if v}
    print(f'matched {len(found)}/{len(targets)} entities', file=sys.stderr)
    ids = sorted(set(found.values()))
    claims = {}
    for i in range(0, len(ids), 50):
        r = api({'action': 'wbgetentities', 'ids': '|'.join(ids[i:i+50]), 'props': 'claims'})
        claims.update(r.get('entities', {}))
        time.sleep(1)

    def cv(ent, prop):
        try: return ent['claims'][prop][0]['mainsnak']['datavalue']['value']
        except Exception: return None

    n_url = n_soc = 0
    for name, qid in found.items():
        ent = claims.get(qid)
        if not ent: continue
        rec = {}
        u = cv(ent, 'P856')
        tw = cv(ent, 'P2002'); ig = cv(ent, 'P2003')
        if u: rec['url'] = u; n_url += 1
        if tw: rec['sx'] = 'https://x.com/' + tw
        if ig: rec['si'] = 'https://www.instagram.com/' + ig
        if tw or ig: n_soc += 1
        if rec: staged[name] = rec
    json.dump(staged, open(OUT, 'w'), indent=0)
    print(f'staged: {n_url} urls, {n_soc} with socials -> data/sites_wikidata.json (total staged {len(staged)})', file=sys.stderr)

if __name__ == '__main__':
    main()
