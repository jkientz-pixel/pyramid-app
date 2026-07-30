#!/usr/bin/env python3
"""Pre-deploy gate. Run by deploy.sh; exits non-zero on anything that would
ship a broken or stale build. Checks:
  1. js/data.js + js/rosters.js parse, and club slugs are present + unique;
  2. the cache-bust token is identical across app.html, index.html, js/app.js
     and sw.js VERSION (drift = users served stale code);
  3. every data/*.json the app fetches exists and parses.
"""
import json, re, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
fail = []

src = (ROOT / 'js' / 'data.js').read_text()
m = re.search(r'export const CLUBS=(\[.*?\]);', src, re.S)
if not m:
    fail.append('data.js: CLUBS marker missing')
else:
    try:
        clubs = json.loads(m.group(1))
        ids = [c.get('id') for c in clubs]
        if any(not i for i in ids):
            fail.append(f'data.js: {sum(1 for i in ids if not i)} clubs missing an id slug')
        if len(set(ids)) != len(ids):
            fail.append('data.js: duplicate club slugs')
        broken = [c['id'] for c in clubs
                  if c.get('img') and not (ROOT / c['img']).exists()]
        if broken:
            fail.append(f'data.js: {len(broken)} img paths point at missing crest files: {broken[:10]}')
        print(f'  data.js OK — {len(clubs)} clubs, slugs unique, crest paths resolve')
    except Exception as e:
        fail.append(f'data.js: CLUBS does not parse ({e})')

r = (ROOT / 'js' / 'rosters.js').read_text()
for marker in ('ROSTERS', 'HONOURS'):
    mm = re.search(r'export const %s=(\{.*?\});' % marker, r, re.S)
    if not mm:
        fail.append(f'rosters.js: {marker} marker missing'); continue
    try:
        json.loads(mm.group(1))
    except Exception as e:
        fail.append(f'rosters.js: {marker} does not parse ({e})')
print('  rosters.js OK')

vers = set()
for f in ('app.html', 'index.html'):
    vers |= set(re.findall(r'v=(2026[0-9a-z]+)', (ROOT / f).read_text()))
vers |= set(re.findall(r'v=(2026[0-9a-z]+)', (ROOT / 'js' / 'app.js').read_text()))
vers |= set(re.findall(r"VERSION = 'rankxi-v(2026[0-9a-z]+)'", (ROOT / 'sw.js').read_text()))
if len(vers) != 1:
    fail.append(f'cache-bust drift across app.html/index.html/app.js/sw.js: {sorted(vers)}')
else:
    print(f'  cache version consistent: {vers.pop()}')

for jf in re.findall(r"fetch\('(data/[^?']+)", (ROOT / 'js' / 'app.js').read_text()):
    p = ROOT / jf
    if not p.exists():
        fail.append(f'{jf}: fetched by app.js but missing'); continue
    try:
        json.loads(p.read_text())
    except Exception as e:
        fail.append(f'{jf}: invalid JSON ({e})')
print('  fetched data/*.json OK')

if fail:
    print('\nPREFLIGHT FAILED:', file=sys.stderr)
    for f in fail: print('  ✗', f, file=sys.stderr)
    sys.exit(1)
print('preflight passed')
