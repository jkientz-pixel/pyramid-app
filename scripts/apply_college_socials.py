#!/usr/bin/env python3
"""Replace the broken college socials in js/data.js with verified program accounts.

Reads the sidecar staged by fetch_college_soccer_socials.py and, for every
college club:

  1. sets sx/si to that school's OWN men's/women's soccer account when the
     athletics site labelled one for that gender;
  2. otherwise drops the existing value when it is provably wrong --
     cross-school (the same handle claimed by a different school), a generic
     university/administrative account, or another sport's account;
  3. repairs url the same way, preferring the verified athletics domain.

Values that survive are single-school and plausible, so a club keeps its
athletics-department account when no soccer-specific one exists. Non-college
clubs are never touched: handles shared there are legitimate (one club in
several leagues, or a club's men's and women's sides).

Writes data/college_socials_audit.json describing every change.
"""
from _datajs import load_clubs, write_clubs, ROOT
import collections, json, os, re

SIDECAR = os.path.join(ROOT, 'data', 'college_socials.json')
AUDIT = os.path.join(ROOT, 'data', 'college_socials_audit.json')
MEN = ('ncaa1', 'ncaa2', 'ncaa3', 'naia')
WOMEN = ('ncaa1w', 'ncaa2w')
GROUPS = MEN + WOMEN

# another team's account: a school handle ending in / containing a sport code
WRONG_SPORT = re.compile(
    r'(mbb|wbb|bball|basketball|hoops|fball|football|_fb$|fb$|baseball|bsb$|softball'
    r'|sball|tfxc|track|xc$|wrestl|volley|vball|_vb$|vb$|lax|lacrosse|swim|dive|tennis'
    r'|golf|hockey|_mih$|rowing|crew$|gym)', re.I)
# the university's own institutional account rather than anything athletic
GENERIC = re.compile(r'^(uniof|univof|university|the)|^[a-z]{2,7}(u|edu)$|news$|social$|^go[a-z]{0,3}$', re.I)


def handle(u):
    return u.rstrip('/').rsplit('/', 1)[-1].lstrip('@').lower()


def domain(u):
    return re.sub(r'^https?://(www\.)?', '', u).split('/')[0].lower()


def main():
    staged = json.load(open(SIDECAR))
    clubs = load_clubs()
    college = [c for c in clubs if c.get('g') in GROUPS and not c.get('h')]

    # how many DISTINCT schools claim each value -> >1 means the join was wrong
    owners = {f: collections.defaultdict(set) for f in ('sx', 'si', 'url')}
    for c in college:
        for f, key in (('sx', handle), ('si', handle), ('url', domain)):
            if c.get(f):
                owners[f][key(c[f])].add(c['n'])

    audit = []
    stats = collections.Counter()
    for c in college:
        gender = 'w' if c['g'] in WOMEN else 'm'
        rec = staged.get(c['n']) or {}
        found = (rec.get('socials') or {}).get(gender) or {}
        verified_domain = rec.get('domain') if rec.get('socials') else None
        changes = {}

        for f, key in (('sx', handle), ('si', handle)):
            old = c.get(f)
            new = found.get(f)
            if new:
                if old != new:
                    changes[f] = (old, new)
                    stats['replaced_with_program' if old else 'added_program'] += 1
                continue
            if not old:
                continue
            k = key(old)
            why = ('cross-school' if len(owners[f][k]) > 1 else
                   'wrong-sport' if WRONG_SPORT.search(k) else
                   'generic-university' if GENERIC.search(k) else None)
            if why:
                changes[f] = (old, None)
                stats[f'dropped_{why}'] += 1

        old_url = c.get('url')
        if old_url and len(owners['url'][domain(old_url)]) > 1:
            new_url = f'https://{verified_domain}/' if verified_domain else None
            changes['url'] = (old_url, new_url)
            stats['url_repaired' if new_url else 'url_dropped'] += 1
        elif not old_url and verified_domain:
            changes['url'] = (None, f'https://{verified_domain}/')
            stats['url_added'] += 1

        for f, (old, new) in changes.items():
            if new:
                c[f] = new
            else:
                c.pop(f, None)
        if changes:
            audit.append({'club': c['n'], 'group': c['g'],
                          'changes': {f: {'from': o, 'to': n} for f, (o, n) in changes.items()}})

    write_clubs(clubs)
    json.dump(audit, open(AUDIT, 'w'), indent=1)

    with_sx = sum(1 for c in college if c.get('sx'))
    program = sum(1 for c in college
                  if (staged.get(c['n'], {}).get('socials') or {}).get('w' if c['g'] in WOMEN else 'm', {}).get('sx'))
    print(f'college clubs: {len(college)}  |  clubs changed: {len(audit)}')
    for k, v in sorted(stats.items()):
        print(f'  {k:<28}{v:>6}')
    print(f'\ncollege clubs with an X handle: {with_sx} ({program} are the actual soccer program)')
    print(f'audit -> {AUDIT}')


if __name__ == '__main__':
    main()
