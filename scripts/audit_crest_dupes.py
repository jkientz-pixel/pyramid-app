#!/usr/bin/env python3
"""Crest misattribution detector. Groups crest files by content hash and fails
when byte-identical images are shared by DIFFERENT clubs — the fingerprint of a
matcher that handed one badge to its neighbours (the Aug 2026 flagship bug:
"Illinois" swallowed every directional Illinois school). Same-club repeats
(men's + women's, II/reserve/academy sides) are fine and skipped.

Scope widened 2026-08-22 from college-only to EVERY league. College-only is
exactly why the worst instance in the data survived: eighteen USL2 and USL W
clubs whose names merely contain the word "City" — Hill City, Asheville City,
Port City, Salem City, Steel City, Flint City, Lansing City, Minneapolis City,
Peoria City, San Francisco City — all shipped wearing Ocean City Nor'easters'
badge, in a league the audit never looked at.

Exit 0 clean / 1 findings, so it can gate a sweep."""
from _datajs import load_clubs, write_clubs, ROOT
import hashlib, os, re, sys, unicodedata

COLLEGE = ('ncaa1', 'ncaa2', 'ncaa3', 'ncaa1w', 'ncaa2w', 'ncaa3w', 'naia', 'naiaw')
# Words that vary between a club's entries, or that are so common across
# American club names that sharing one proves nothing about shared identity.
# "city" belongs here for the same reason "united" does: it is the single most
# over-matched token in the dataset and it is what produced the Ocean City
# eighteen. Suffixes that mark a SECOND side of the SAME club (ii, iii, u23,
# reserves, academy, women) are stripped before fingerprinting instead.
NOISE = {'university', 'college', 'of', 'in', 'at', 'the', 'a', 'and', 'st',
         'state', 'saint', 'lady',
         'fc', 'sc', 'afc', 'cf', 'club', 'soccer', 'football', 'athletic',
         'city', 'united', 'town', 'real', 'inter', 'sporting', 'atletico'}
# trailing markers that mean "another side of the club above", not another club
SIDE = re.compile(r'\b(ii|iii|iv|2|3|b|u\d\d|women|womens|reserves?|academy|'
                  r'futures|youth|development)\b')

def deacc(x): return unicodedata.normalize('NFKD', x).encode('ascii', 'ignore').decode()

def inst(name):
    """Club fingerprint: distinctive name tokens, minus the trailing nickname
    (which differs between a school's men's and women's entries) and minus the
    side markers that distinguish a reserve or women's team from its parent."""
    n = SIDE.sub(' ', deacc(name).lower().replace('&', 'and'))
    words = re.findall(r'[a-z0-9]+', n)
    core = [w for w in words if w not in NOISE]
    return frozenset(core[:3]) or frozenset(words[:2])

# renders that legitimately repeat across institutions. Penn State's campus
# slugs (penn-st-abington, -altoona, ...) each serve their own SVG on
# ncaa.com, but all draw the same Nittany Lion, so the 128px renders come out
# byte-identical — that is the source's truth, not a mismatch.
# Groups where one image legitimately serves several entries: a club system
# whose affiliates share a badge, a university whose branch campuses draw the
# same mark, or a duplicate club record we have not tombstoned yet. Verified by
# eye 2026-08-22; anything not listed here is treated as a misattribution.
ALLOW = {
    '358696b9bfb84af5c9cef7de3c586ea0',  # the Nittany Lion render (pre-strip)
    '1552a46f',  # Penn State + its branch campuses, one Nittany Lion
    'c8f17c17',  # Sting Soccer Club affiliates (Austin, Corpus Christi, Nebraska)
    'e7df1a9b',  # San Antonio FC Academy RL Red/Black
    'e88ecb7e',  # DKSC Pro / Pro II / Futuro
    '738b4743',  # GFI Academy under two league entries
    'f3585151',  # Pachuca Georgia first team / reserves / U17
    '2f095ba5',  # Tophat Gold / Navy / Tophat
    '77857e98',  # Seacoast United across MLS Next / GA / GAA
    '43266798',  # Springfield youth club across three league entries
    'af228555',  # HTX across ECNL / GA / GAA
    '14d7d681',  # Cedar Stars organisation
    '9fe1cd00',  # SinCity FC == Sin City FC, a known duplicate club record
    '6c764c34',  # "Miami FL UPSL Test" placeholder record
    '418b652a',  # Tampa Bay United across MLS Next / ECNL G / Pre-ECNL B
    '2f0bb3dc',  # Virginia Revolution across GA / MLS Next / GA Aspire
}
def allowed(h):
    return h in ALLOW or h[:8] in ALLOW

def main():
    blank = '--blank' in sys.argv
    all_clubs = load_clubs()
    clubs = [c for c in all_clubs
             if c.get('img') and not c.get('h')]
    byhash = {}
    for c in clubs:
        p = os.path.join(ROOT, c['img'].split('?')[0])
        if not os.path.exists(p):
            print(f"MISSING FILE {c['n']}: {c['img']}")
            continue
        h = hashlib.md5(open(p, 'rb').read()).hexdigest()
        byhash.setdefault(h, []).append(c)
    bad = 0
    cleared = []
    for h, cs in sorted(byhash.items(), key=lambda kv: -len(kv[1])):
        if allowed(h):
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
        if blank:
            for c in cs:
                c.pop('img', None)
                cleared.append(c['n'])
    print(f"{'FAIL' if bad else 'OK'}: {bad} cross-club shared-crest groups "
          f"across {len(clubs)} clubs (all leagues)")
    if blank and cleared:
        # Every member of a bad group loses its crest, including whichever one
        # legitimately owns the image: we cannot tell the owner from the
        # copies, and a club wearing another club's badge is a worse failure
        # than a club wearing none. The fetchers repopulate from source.
        write_clubs(all_clubs)
        print(f"BLANKED {len(cleared)} crests. Bump CRESTV in js/app.js.")
    sys.exit(1 if bad else 0)

if __name__ == '__main__':
    main()
