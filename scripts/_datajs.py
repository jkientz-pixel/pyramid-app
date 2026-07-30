#!/usr/bin/env python3
"""Safe read/write for js/data.js — the file every pipeline script rewrites.

Guards the two ways an in-place regex rewrite fails silently:
  * the CLUBS marker doesn't match -> re.sub returns the string UNCHANGED and
    the script still reports success while nothing was written;
  * the club array shifts position -> legacy numeric /#/club/<i> redirects and
    every `dup` pointer in data.js resolve to the wrong club.
Also keeps a rolling .bak and writes atomically via os.replace.
"""
import json, os, re, pathlib, shutil, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA_JS = ROOT / 'js' / 'data.js'
CLUBS_RE = re.compile(r'export const CLUBS=(\[.*?\]);', re.S)

def load_clubs(src=None):
    src = src if src is not None else DATA_JS.read_text()
    m = CLUBS_RE.search(src)
    if not m:
        sys.exit('FATAL: CLUBS marker not found in js/data.js — refusing to touch it')
    return json.loads(m.group(1))

def write_clubs(clubs, src=None):
    """Replace CLUBS in data.js. Aborts unless the club array order is preserved
    (indices are the legacy-URL redirect map) and exactly one marker matched."""
    src = src if src is not None else DATA_JS.read_text()
    before = load_clubs(src)
    if len(clubs) < len(before):
        sys.exit(f'FATAL: club count shrank {len(before)} -> {len(clubs)}; refusing to write')
    for i, (a, b) in enumerate(zip(before, clubs)):
        # identity = the id slug when both sides have one (display names may be
        # legitimately corrected in place); names are the fallback identity
        same = (a['id'] == b['id']) if a.get('id') and b.get('id') else (a['n'] == b['n'])
        if not same:
            sys.exit(f'FATAL: club order changed at index {i}: {a["n"]!r} -> {b["n"]!r}. '
                     'Array position IS the legacy-URL map — append only, never sort/remove.')
    ids = [c.get('id') for c in clubs]
    if any(not i for i in ids):
        sys.exit(f'FATAL: {sum(1 for i in ids if not i)} clubs missing an "id" slug')
    dupes = {i for i in ids if ids.count(i) > 1}
    if dupes:
        sys.exit(f'FATAL: duplicate club slugs: {sorted(dupes)[:5]}')
    body = 'export const CLUBS=' + json.dumps(clubs, ensure_ascii=False, separators=(',', ':')) + ';'
    out, n = CLUBS_RE.subn(lambda m: body, src, count=1)
    if n != 1:
        sys.exit(f'FATAL: expected 1 CLUBS marker, matched {n}; nothing written')
    shutil.copy2(DATA_JS, DATA_JS.with_suffix('.js.bak'))
    tmp = DATA_JS.with_suffix('.js.tmp')
    tmp.write_text(out)
    os.replace(tmp, DATA_JS)
    print(f'js/data.js written: {len(clubs)} clubs (backup at data.js.bak)', file=sys.stderr)
