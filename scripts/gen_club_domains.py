#!/usr/bin/env python3
"""Emit lib/club_domains.json: the server-side truth for club claims.

/api/claim decides whether a claimant's email domain is the club's own domain.
That comparison must not trust anything the browser sends — a claimant could
post url=gmail.com and match their own address — so the endpoint needs its
own copy of club -> website host. Pages Functions cannot import the 1 MB
js/data.js module, hence this small map, regenerated from CLUBS on every
deploy and checked by preflight so it can never drift from the live data.

Shape: { "<club id>": {"n": "<name>", "d": "<host or null>"} }
`d` is the website host with a leading www. stripped, lower-cased. Hidden
(tombstoned, h:1) clubs are skipped: nobody may claim a page that no longer
renders.
"""
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'js' / 'data.js'
OUT = ROOT / 'lib' / 'club_domains.json'


def clubs():
    text = SRC.read_text()
    m = re.search(r'export const CLUBS=(\[.*?\]);', text, re.S)
    if not m:
        sys.exit('gen_club_domains: could not find CLUBS in js/data.js')
    return json.loads(m.group(1))


def host_of(url):
    if not url:
        return None
    try:
        h = (urlsplit(url.strip()).hostname or '').lower()
    except ValueError:
        return None
    h = h[4:] if h.startswith('www.') else h
    return h or None


def build():
    out = {}
    for c in clubs():
        if c.get('h') or not c.get('id'):
            continue
        out[c['id']] = {'n': c['n'], 'd': host_of(c.get('url'))}
    return out


def render(data):
    return json.dumps(data, separators=(',', ':'), ensure_ascii=False, sort_keys=True) + '\n'


if __name__ == '__main__':
    data = build()
    text = render(data)
    if '--check' in sys.argv:
        if not OUT.exists() or OUT.read_text() != text:
            sys.exit('lib/club_domains.json is stale — run scripts/gen_club_domains.py')
        print(f'  club_domains: {len(data)} clubs, in sync')
    else:
        OUT.parent.mkdir(exist_ok=True)
        OUT.write_text(text)
        with_d = sum(1 for v in data.values() if v['d'])
        print(f'wrote {OUT.relative_to(ROOT)}: {len(data)} clubs, {with_d} with a website domain')
