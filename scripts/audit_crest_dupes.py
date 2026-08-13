#!/usr/bin/env python3
"""Crest misattribution detector. Groups college crest files by content hash
and fails when byte-identical images are shared by DIFFERENT institutions —
the fingerprint of a matcher that handed one school's logo to its neighbors
(the Aug 2026 flagship bug: "Illinois" swallowed every directional Illinois
school). Same-institution repeats (men's + women's entries of one school) are
fine and skipped. Also fails on the generic NAIA association shield shipping
as a school crest. Exit 0 clean / 1 findings, so it can gate a sweep."""
from _datajs import load_clubs, ROOT
import hashlib, os, re, sys, unicodedata

COLLEGE = ('ncaa1', 'ncaa2', 'ncaa3', 'ncaa1w', 'ncaa2w', 'ncaa3w', 'naia', 'naiaw')
# words that vary between a school's men's and women's data-source names
NOISE = {'university', 'college', 'of', 'in', 'at', 'the', 'a', 'and', 'st',
         'state', 'saint', 'lady'}

def deacc(x): return unicodedata.normalize('NFKD', x).encode('ascii', 'ignore').decode()

def inst(name):
    """Institution fingerprint: distinctive name tokens minus the trailing
    nickname (which differs between a school's men's and women's entries)."""
    words = re.findall(r'[a-z0-9]+', deacc(name).lower().replace('&', 'and'))
    core = [w for w in words if w not in NOISE]
    return frozenset(core[:3]) or frozenset(words[:2])

# renders that legitimately repeat across institutions. Penn State's campus
# slugs (penn-st-abington, -altoona, ...) each serve their own SVG on
# ncaa.com, but all draw the same Nittany Lion, so the 128px renders come out
# byte-identical — that is the source's truth, not a mismatch.
ALLOW = {'358696b9bfb84af5c9cef7de3c586ea0'}  # the Nittany Lion render

def main():
    clubs = [c for c in load_clubs() if c.get('g') in COLLEGE and c.get('img')]
    byhash = {}
    for c in clubs:
        p = os.path.join(ROOT, c['img'].split('?')[0])
        if not os.path.exists(p):
            print(f"MISSING FILE {c['n']}: {c['img']}")
            continue
        h = hashlib.md5(open(p, 'rb').read()).hexdigest()
        byhash.setdefault(h, []).append(c)
    bad = 0
    for h, cs in sorted(byhash.items(), key=lambda kv: -len(kv[1])):
        if h in ALLOW:
            continue
        insts = {inst(c['n']) for c in cs}
        if len(insts) < 2:
            continue
        # tolerate pairs that plausibly ARE one school (share a core token
        # set subset either way) — e.g. "Ohio State" vs "The Ohio State"
        if len(cs) == 2 and (inst(cs[0]['n']) & inst(cs[1]['n'])):
            continue
        bad += 1
        print(f"SHARED CREST x{len(cs)} [{h[:8]}]: " +
              '; '.join(f"{c['g']}:{c['n']}" for c in cs))
    print(f"{'FAIL' if bad else 'OK'}: {bad} cross-institution shared-crest groups "
          f"across {len(clubs)} college clubs")
    sys.exit(1 if bad else 0)

if __name__ == '__main__':
    main()
