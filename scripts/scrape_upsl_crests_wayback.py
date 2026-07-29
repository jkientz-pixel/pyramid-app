#!/usr/bin/env python3
"""UPSL crest scraper, Wayback Machine route. upsl.com serves HTML behind an
aggressive Cloudflare that flags even headful Chromium after a few pages —
but the wp-content/uploads image files are NOT challenged. So: take each team
page's HTML from the Wayback Machine (no Cloudflare), extract the
.page__header--logo image URL, then curl the LIVE image (fallback: the
archived image copy via /web/<ts>im_/).

CDX-enumerates archived /teams/<slug>/ pages per subsite (latest snapshot per
URL, cached in data/upsl_wayback_index.json), token-matches slugs to upsl
clubs missing a crest (ambiguity-guarded), throttles Wayback ~1.3s/req with
429/503 backoff. Progress lands in js/data.js every 25 crests; sidecar
data/upsl_crest_progress.json records per-club status so reruns skip done and
known-failed clubs."""
from _datajs import load_clubs, write_clubs, ROOT
import json, os, re, subprocess, sys, time, unicodedata, urllib.parse, urllib.request

SUBS = ['premier', 'division1', 'division2']
IDX_CACHE = os.path.join(ROOT, 'data', 'upsl_wayback_index.json')
PROG = os.path.join(ROOT, 'data', 'upsl_crest_progress.json')
UA = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 RankXI/1.0'}
STOP = {'fc', 'sc', 'cf', 'afc', 'the', 'club', 'soccer', 'football', 'futbol', 'de'}

def deacc(x): return unicodedata.normalize('NFKD', x).encode('ascii', 'ignore').decode()
def slugify(n): return re.sub(r'[^a-z0-9]+', '-', deacc(n).lower()).strip('-')
def toks(s): return set(re.findall(r'[a-z0-9]+', deacc(s).lower())) - STOP

def wb_get(url, tries=5):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            return urllib.request.urlopen(req, timeout=60).read()
        except Exception as e:
            code = getattr(e, 'code', None)
            if code in (429, 503) or 'timed out' in str(e) or 'refused' in str(e).lower():
                time.sleep(15 * (i + 1)); continue
            raise
    raise Exception('wayback: retries exhausted')

def build_index():
    if os.path.exists(IDX_CACHE):
        return json.load(open(IDX_CACHE))
    idx = {}
    for sub in SUBS:
        q = urllib.parse.urlencode({
            'url': f'{sub}.upsl.com/teams/*', 'output': 'json',
            'filter': 'statuscode:200', 'fl': 'timestamp,original'})
        rows = json.loads(wb_get(f'http://web.archive.org/cdx/search/cdx?{q}'))[1:]
        n = 0
        for ts, orig in rows:
            slug = orig.rstrip('/').split('/')[-1]
            if slug in ('teams', 'teams-sitemap.xml') or '/teams/' not in orig or '?' in orig:
                continue
            key = f'{sub}/{slug}'
            if key not in idx or ts > idx[key][0]:
                idx[key] = [ts, orig]; n += 1
        print(f'  {sub}: indexed (cumulative {len(idx)})')
        time.sleep(1.5)
    json.dump(idx, open(IDX_CACHE, 'w'), indent=0)
    return idx

def match(clubs, idx):
    entries = []
    for key, (ts, orig) in idx.items():
        s = re.sub(r'-\d+$', '', key.split('/', 1)[1])
        entries.append({'key': key, 'toks': toks(s.replace('-', ' '))})
    out, ambig = {}, 0
    for c in clubs:
        ct = toks(c['n'])
        scored = []
        for e in entries:
            if not e['toks']: continue
            ov = len(ct & e['toks'])
            if not ov: continue
            scored.append((ov / max(len(ct), len(e['toks'])), e))
        scored.sort(key=lambda x: -x[0])
        if not scored or scored[0][0] < 0.75: continue
        # same slug may exist in several subsites/ids; any tie on different slug-word-sets is ambiguous
        top = [e for s, e in scored if s == scored[0][0]]
        wordsets = {frozenset(e['toks']) for e in top}
        if len(wordsets) > 1:
            ambig += 1; continue
        out[c['id']] = scored[0][1]['key']
    print(f'matched {len(out)} clubs ({ambig} ambiguous)')
    return out

def main():
    clubs = load_clubs()
    todo = [c for c in todo_list(clubs)]
    print(f'{len(todo)} upsl clubs missing crests')
    idx = build_index()
    m = match(todo, idx)
    prog = json.load(open(PROG)) if os.path.exists(PROG) else {}
    got = miss = 0
    for c in todo:
        if prog.get(c['id']) in ('done', 'no-archive', 'no-logo'):
            continue
        key = m.get(c['id'])
        if not key:
            prog[c['id']] = 'no-archive'; miss += 1; continue
        ts, orig = idx[key]
        try:
            html = wb_get(f'https://web.archive.org/web/{ts}id_/{orig}').decode('utf-8', 'replace')
            lm = re.search(r'class="page__header--logo"[^>]*src="([^"]+)"', html) or \
                 re.search(r'src="([^"]+)"[^>]*class="page__header--logo"', html)
            if not lm:
                prog[c['id']] = 'no-logo'; miss += 1
                print(f"  - {c['n']}: no logo in archived page"); continue
            src = lm.group(1)
            if src.startswith('/web/'):  # rewritten anyway — strip to original
                src = re.sub(r'^/web/\d+(?:im_)?/', '', src)
            if src.startswith('//'): src = 'https:' + src
            tmp = os.path.join(ROOT, 'crests', '_raw_tmp')
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
            print(f"  + {c['n']}  [{got}]")
            if got % 10 == 0:
                write_clubs(clubs)
                json.dump(prog, open(PROG, 'w'), indent=0)
                print(f'  ... checkpoint: {got}')
        except Exception as e:
            prog[c['id']] = f'err:{e}'[:80]
            miss += 1
            print(f"  - {c['n']}: {e}")
        time.sleep(2.2)
    json.dump(prog, open(PROG, 'w'), indent=0)
    print(f'got {got}, missed {miss}')
    if got:
        write_clubs(clubs)

def todo_list(clubs):
    return [c for c in clubs if c['g'] == 'upsl' and not c.get('img')]

if __name__ == '__main__':
    main()
