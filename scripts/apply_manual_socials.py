#!/usr/bin/env python3
"""Apply hand-verified club links from data/club_socials_manual.json to js/data.js.

The UPSL scrape only reaches clubs listed in the UPSL portal. A club fielding
sides in several leagues has one entry per league, and the ones outside UPSL end
up with no links at all even though the club plainly has them. This fills those
in by club id, from a file where every row names the page it was read from.

Additive only, like apply_upsl_socials.py: an existing value is never
overwritten, so re-running is a no-op and nothing already curated is lost.
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'js', 'data.js')
SRC = os.path.join(ROOT, 'data', 'club_socials_manual.json')
FIELDS = ('url', 'si', 'sx', 'sf')


def main():
    dry = '--dry' in sys.argv
    cur = open(DATA).read()
    clubs = json.loads(re.search(r'export const CLUBS=(\[.*?\]);', cur, re.S).group(1))
    by_id = {c['id']: c for c in clubs}
    manual = json.load(open(SRC))['clubs']

    added = skipped = 0
    missing = []
    for cid, row in manual.items():
        club = by_id.get(cid)
        if club is None:
            missing.append(cid)
            continue
        for f in FIELDS:
            if not row.get(f):
                continue
            if club.get(f):
                skipped += 1
                continue
            club[f] = row[f]
            added += 1
            print('  %-28s %-4s -> %s' % (cid, f, row[f]))

    print('fields added: %d   left alone (already set): %d' % (added, skipped))
    if missing:
        print('UNKNOWN club ids (nothing applied): %s' % missing)
        return 1
    if dry:
        print('--dry: js/data.js not written')
        return 0
    head = cur[:cur.index('export const CLUBS=')]
    tail = cur[cur.index('export const REGIONS='):]
    open(DATA, 'w').write(head + 'export const CLUBS=' +
                          json.dumps(clubs, ensure_ascii=False, separators=(',', ':')) +
                          ';\n' + tail)
    print('wrote %s' % DATA)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
