#!/usr/bin/env python3
"""Crest sweep pass 6: retry 'no-logo' UPSL clubs against OLDER Wayback
snapshots. The pass-5 wayback run only read the LATEST snapshot per team page
(data/upsl_wayback_index.json keeps one [ts, url] per key); upsl.com changed
its team-page markup in 2024/25 so late snapshots lack .page__header--logo,
while 2022-23 snapshots carry it. For each club still missing a crest whose
progress status is 'no-logo', walk that page's full snapshot list (exact-URL
CDX, no wildcard) newest->oldest, grab the first .page__header--logo src,
fetch the live wp-content image (not Cloudflare-challenged; archived im_ copy
as fallback), stage to crests/upsl-<slug>.png at 128px and set the club img.
Ambiguity rule unchanged: clubs whose name tokens match several distinct
team slugs stay untouched."""
from _datajs import load_clubs, write_clubs, ROOT
import gzip, json, os, re, subprocess, sys, time, unicodedata, urllib.parse, urllib.request

IDX_CACHE = os.path.join(ROOT, 'data', 'upsl_wayback_index.json')
PROG = os.path.join(ROOT, 'data', 'upsl_crest_progress.json')
UA = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 RankXI/1.0'}
STOP = {'fc', 'sc', 'cf', 'afc', 'the', 'club', 'soccer', 'football', 'futbol', 'de'}
MAX_SNAPSHOTS = 8

def deacc(x): return unicodedata.normalize('NFKD', x).encode('ascii', 'ignore').decode()
def slugify(n): return re.sub(r'[^a-z0-9]+', '-', deacc(n).lower()).strip('-')
def toks(s): return set(re.findall(r'[a-z0-9]+', deacc(s).lower())) - STOP

def wb_get(url, tries=4):
    for i in range(tries):
        try:
            body = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read()
            if body[:2] == b'\x1f\x8b':
                body = gzip.decompress(body)
            return body
        except Exception as e:
            code = getattr(e, 'code', None)
            if code in (429, 503) or 'timed out' in str(e) or 'refused' in str(e).lower():
                time.sleep(12 * (i + 1)); continue
            raise
    raise Exception('wayback: retries exhausted')

def match(clubs, idx):
    entries = [{'key': k, 'toks': toks(re.sub(r'-\d+$', '', k.split('/', 1)[1]).replace('-', ' '))}
               for k in idx]
    out = {}
    for c in clubs:
        ct = toks(c['n'])
        scored = []
        for e in entries:
            if not e['toks']: continue
            ov = len(ct & e['toks'])
            if ov:
                scored.append((ov / max(len(ct), len(e['toks'])), e))
        scored.sort(key=lambda x: -x[0])
        if not scored or scored[0][0] < 0.75: continue
        top = [e for s, e in scored if s == scored[0][0]]
        if len({frozenset(e['toks']) for e in top}) > 1: continue
        out[c['id']] = scored[0][1]['key']
    return out

def snapshots(orig):
    q = urllib.parse.urlencode({'url': orig, 'output': 'json',
                                'filter': 'statuscode:200', 'fl': 'timestamp',
                                'collapse': 'timestamp:6'})
    rows = json.loads(wb_get(f'http://web.archive.org/cdx/search/cdx?{q}'))
    return sorted((r[0] for r in rows[1:]), reverse=True)

def find_logo(orig):
    for ts in snapshots(orig)[:MAX_SNAPSHOTS]:
        time.sleep(1.3)
        try:
            html = wb_get(f'https://web.archive.org/web/{ts}id_/{orig}').decode('utf-8', 'replace')
        except Exception as e:
            print(f'    snap {ts}: {e}'); continue
        lm = re.search(r'class="page__header--logo"[^>]*src="([^"]+)"', html) or \
             re.search(r'src="([^"]+)"[^>]*class="page__header--logo"', html)
        if lm:
            src = re.sub(r'^/web/\d+(?:im_)?/', '', lm.group(1))
            if src.startswith('//'): src = 'https:' + src
            return ts, src
    return None, None

def main():
    clubs = load_clubs()
    prog = json.load(open(PROG))
    todo = [c for c in clubs if c['g'] == 'upsl' and not c.get('img')
            and prog.get(c['id']) == 'no-logo']
    print(f'{len(todo)} no-logo clubs to retry')
    idx = json.load(open(IDX_CACHE))
    m = match(todo, idx)
    got = 0
    for c in todo:
        key = m.get(c['id'])
        if not key:
            print(f"  ? {c['n']}: no unambiguous archived page"); continue
        ts_latest, orig = idx[key]
        ts, src = find_logo(orig)
        if not src:
            print(f"  - {c['n']}: no logo in any of last {MAX_SNAPSHOTS} snapshots"); continue
        tmp = os.path.join(ROOT, 'crests', '_raw_tmp')
        try:
            try:
                open(tmp, 'wb').write(wb_get(src, tries=2))
            except Exception:
                open(tmp, 'wb').write(wb_get(f'https://web.archive.org/web/{ts}im_/{src}'))
            fn = f"crests/upsl-{slugify(c['n'])}.png"
            dest = os.path.join(ROOT, fn)
            subprocess.run(['sips', '-s', 'format', 'png', '-Z', '128', tmp, '--out', dest],
                           capture_output=True)
            if not (os.path.exists(dest) and os.path.getsize(dest) > 500):
                raise Exception('sips produced nothing')
            c['img'] = fn
            prog[c['id']] = 'done'
            got += 1
            print(f"  + {c['n']}  ({src.split('/')[-1]}, snap {ts})")
        except Exception as e:
            print(f"  - {c['n']}: {e}")
        time.sleep(1.3)
    if os.path.exists(os.path.join(ROOT, 'crests', '_raw_tmp')):
        os.remove(os.path.join(ROOT, 'crests', '_raw_tmp'))
    if got:
        write_clubs(clubs)
    json.dump(prog, open(PROG, 'w'), indent=0)
    print(f'got {got}')

if __name__ == '__main__':
    main()
