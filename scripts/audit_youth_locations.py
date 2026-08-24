#!/usr/bin/env python3
"""Cross-league location audit for youth clubs with no league-stated city.

EA publishes its club list with no locations (JPEG transcription) and the
MLS NEXT Academy Division member page is names-only. But most of these
orgs also field teams in leagues whose OFFICIAL directories state a city:
the ECNL family on Total Global Sports (ECNL B/G, ECNL RL B/G, Pre-ECNL
B/G — orgIDs 12/9, 16/13, 22/21) and the Girls Academy pages (GA members +
GA Aspire). A city stated by a league's own club record is not a guess —
it satisfies the no-guessed-locations policy, with the source recorded.

Matching is conservative:
  * normalized-name equality, AND
  * state agreement when the queue side knows the state, AND
  * when the queue side has NO state, the name must resolve to exactly ONE
    (city, st) across every source — any ambiguity stays unresolved.

Outputs data/youth_location_audit.json:
  {"resolved": {league: {club name: {city, st, source}}},
   "unresolved": {league: [names]}}
build_youth_layers.parse_ea consults the resolved block for EA nulls.
The MLS NEXT Academy block waits on its layer being built.
"""
import json, os, re, sys, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_youth_layers import norm, parse_ga, GAA_URL, UA, TGS_API
from _datajs import load_clubs

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'youth_location_audit.json')

TGS_ORGS = [(12, 'ECNL Boys directory (TGS)'),
            (9, 'ECNL Girls directory (TGS)'),
            (16, 'ECNL RL Boys directory (TGS)'),
            (13, 'ECNL RL Girls directory (TGS)'),
            (22, 'Pre-ECNL Boys directory (TGS)'),
            (21, 'Pre-ECNL Girls directory (TGS)')]


def tgs_rows(org_id):
    req = urllib.request.Request(TGS_API % org_id,
                                 headers={**UA, 'Accept': 'application/json'})
    data = json.load(urllib.request.urlopen(req, timeout=30))
    for c in data.get('data') or []:
        name = (c.get('clubFullName') or c.get('clubName') or '').strip()
        city = (c.get('city') or '').strip()
        st = (c.get('stateCode') or '').strip().upper()
        if name and city and re.fullmatch(r'[A-Z]{2}', st):
            yield name, city, st


def build_candidates():
    """norm name -> list of {city, st, source} (deduped per (city, st))."""
    cand = {}

    def add(name, city, st, source):
        rows = cand.setdefault(norm(name), [])
        if not any(r['city'] == city and r['st'] == st for r in rows):
            rows.append({'city': city, 'st': st, 'source': source})

    for org_id, label in TGS_ORGS:
        for name, city, st in tgs_rows(org_id):
            add(name, city, st, label)
    for r in parse_ga():
        add(r['name'], r['city'], r['st'], 'GA members directory')
    for r in parse_ga(GAA_URL):
        add(r['name'], r['city'], r['st'], 'GA Aspire directory')
    return cand


def build_fallback():
    """Our own map, as a SECOND-tier directory.

    Plenty of these organisations are already pinned, because they field a team
    in a league that does state a city — the club is on the map, it just isn't
    credited with its MLS NEXT or EA membership. That makes our club record a
    usable source, but not a peer of the league directories: it is derived, and
    where the two disagree the league's own record of its own member wins.
    Consulted only when no official directory knows the name at all.

    Tiering matters. Treated as a peer, these records contradicted six clubs the
    directories had already settled — Kings Hammer Cincinnati is Covington KY to
    Pre-ECNL and something else to us, and a club on a state line will do that
    all day — and the ambiguity rule then threw all six away. As a fallback they
    add reach without ever overruling a primary source.

    Only verified locations (acc == 'v') qualify: an approximate pin is not a
    league-stated city and must not be laundered into one by passing through
    here."""
    cand = {}
    for c in load_clubs():
        if c.get('h') or c.get('acc') != 'v':
            continue
        if not (c.get('ct') and c.get('st')):
            continue
        rows = cand.setdefault(norm(c['n']), [])
        if not any(r['city'] == c['ct'] and r['st'] == c['st'] for r in rows):
            rows.append({'city': c['ct'], 'st': c['st'],
                         'source': f"Ranked XI club record ({c['g']})"})
    return cand


def resolve(name, st, cand, fallback=None):
    def pick(src):
        rows = src.get(norm(name), [])
        if st:
            rows = [r for r in rows if r['st'] == st]
        # unique (city, st) required — cross-state chains stay unresolved
        if len({(r['city'], r['st']) for r in rows}) == 1:
            return rows[0]
        return None
    hit = pick(cand)
    if hit:
        return hit
    # only when NO official directory carries the name — never to break a tie
    if fallback is not None and not cand.get(norm(name)):
        return pick(fallback)
    return None


def main():
    cand = build_candidates()
    fallback = build_fallback()
    resolved, unresolved = {}, {}

    ea = json.load(open(os.path.join(ROOT, 'data', 'ea_clubs_2026.json')))
    resolved['ea'], unresolved['ea'] = {}, []
    for c in ea['clubs']:
        if c.get('city'):
            continue
        hit = resolve(c['n'], c.get('st'), cand, fallback)
        (resolved['ea'].__setitem__(c['n'], hit) if hit
         else unresolved['ea'].append(c['n']))

    mn = json.load(open(os.path.join(ROOT, 'data', 'mlsnext_academy_2026.json')))
    resolved['mlsnext_academy'], unresolved['mlsnext_academy'] = {}, []
    for c in mn.get('needs_location', []):
        name = c['n'] if isinstance(c, dict) else c
        st = c.get('st') if isinstance(c, dict) else None
        hit = resolve(name, st, cand, fallback)
        (resolved['mlsnext_academy'].__setitem__(name, hit) if hit
         else unresolved['mlsnext_academy'].append(name))

    # Club-website resolutions (scripts write data/youth_location_sites.json:
    # {league: {name: {city, st, source: 'club website <url>', url}}}). A city
    # the club states about itself on its own site is club-stated, not
    # guessed — the source URL is recorded per club. Applied last so an
    # official league directory always wins when both exist.
    sp = os.path.join(ROOT, 'data', 'youth_location_sites.json')
    if os.path.exists(sp):
        sites = json.load(open(sp))
        for lg in resolved:
            hits = sites.get(lg, {})
            still = []
            for name in unresolved[lg]:
                hit = hits.get(name)
                if hit and hit.get('city') and hit.get('st'):
                    resolved[lg][name] = {'city': hit['city'], 'st': hit['st'],
                                          'source': hit['source']}
                else:
                    still.append(name)
            unresolved[lg] = still

    json.dump({'_source': 'cross-league join against official league club '
                          'directories (TGS orgIDs 12/9/16/13/22/21, GA, GA '
                          'Aspire) plus verified-location club records already '
                          'on the Ranked XI map; every city is league-stated, '
                          'source recorded per club',
               'resolved': resolved, 'unresolved': unresolved},
              open(OUT, 'w'), indent=1)
    for lg in resolved:
        print(f"{lg}: {len(resolved[lg])} resolved, "
              f"{len(unresolved[lg])} still need club-site lookups")


if __name__ == '__main__':
    main()
