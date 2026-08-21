#!/usr/bin/env python3
"""Merge scraped UPSL club socials into js/data.js (url/si/sx/sf).

Input is data/upsl_socials.json, produced by scrape_upsl_socials.py: every
handle there carries the source_url it was scraped from, and only handles
graded 'high' (they share a word or an acronym with the club name) are applied.
Handles sitting in needs_review.txt -- shirt sponsors, site vendors, the
neighbouring club -- are graded 'review' and never land here.

Additive only: an existing value on a club is never overwritten, matching the
CLUBS append-only invariant. Re-running is a no-op once applied.
"""
import json, os, re, sys, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'js', 'data.js')
SRC = os.path.join(ROOT, 'data', 'upsl_socials.json')
FIELD = {'instagram': ('si', 'https://www.instagram.com/'),
         'twitter':   ('sx', 'https://x.com/'),
         'facebook':  ('sf', 'https://www.facebook.com/')}


def fold(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]', '', s)


def variants(name):
    """Fold, plus a suffix-stripped form so 'Bellevue Athletic' reaches
    'Bellevue Athletic FC' and 'Philadelphia Lone Star II' reaches its parent."""
    f = fold(name)
    out = {f}
    for suf in ('fc', 'sc', 'cf', 'ii', '2', 'soccerclub', 'sa', 'usa'):
        if f.endswith(suf) and len(f) > len(suf) + 3:
            out.add(f[:-len(suf)])
    out.add(f + 'fc')
    out.add(f + 'sc')
    return out


def main():
    dry = '--dry' in sys.argv
    cur = open(DATA).read()
    clubs = json.loads(re.search(r'export const CLUBS=(\[.*?\]);', cur, re.S).group(1))
    upsl = [c for c in clubs if c.get('g') == 'upsl']

    index = {}
    for c in upsl:
        index.setdefault(fold(c['n']), c)
    for c in upsl:                      # looser keys only fill gaps
        for v in variants(c['n']):
            index.setdefault(v, c)

    rows = json.load(open(SRC))
    stats = {'clubs': 0, 'unmatched': [], 'fields': {'url': 0, 'si': 0, 'sx': 0, 'sf': 0},
             'skipped_existing': 0}
    for r in rows:
        hi = {k: v for k, v in r.get('socials', {}).items()
              if v.get('confidence') == 'high'}
        if not hi:
            continue
        club = next((index[v] for v in variants(r['name']) if v in index), None)
        if club is None:
            stats['unmatched'].append(r['name'])
            continue
        touched = False
        if r.get('website') and not club.get('url'):
            club['url'] = r['website']
            stats['fields']['url'] += 1
            touched = True
        for plat, val in hi.items():
            key, base = FIELD[plat]
            if club.get(key):
                stats['skipped_existing'] += 1
                continue
            club[key] = base + val['handle']
            stats['fields'][key] += 1
            touched = True
        stats['clubs'] += touched

    print('clubs updated      : %d' % stats['clubs'])
    for k, v in stats['fields'].items():
        print('  %-4s added        : %d' % (k, v))
    print('left alone (had one): %d' % stats['skipped_existing'])
    print('unmatched clubs    : %d %s' % (len(stats['unmatched']), stats['unmatched'][:8]))
    if dry:
        print('\n--dry: js/data.js not written')
        return

    head = cur[:cur.index('export const CLUBS=')]
    tail = cur[cur.index('export const REGIONS='):]
    open(DATA, 'w').write(
        head + 'export const CLUBS=' +
        json.dumps(clubs, ensure_ascii=False, separators=(',', ':')) + ';\n' + tail)
    print('\nwrote %s' % DATA)


if __name__ == '__main__':
    main()
