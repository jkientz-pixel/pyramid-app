#!/usr/bin/env python3
"""Results wire for the ASA-covered pro leagues: fetch completed games, run a
results-only Elo walk per league (same K / home-edge / margin model as the NPSL
walk in compute_elo.py), and emit data/wire_asa.json for The Wire screen.

The same walk now also PRODUCES the club ratings for USLC/USL1/MLSNP/NWSL/USLS
(rr=1): final Elo is anchored to each league's band center so the cross-league
pyramid holds, but within a league the order is pure results.

MLS is the exception by design: its displayed ranking stays standings-derived
(rr=2) because the league table is the official record everyone can check —
the results-Elo lands in a secondary field (re) shown smaller with a
disclaimer. UPSL stays standings-derived: no match-level feed exists for it."""
import json, re, urllib.request, time, os, sys, math, unicodedata

B = 'https://app.americansocceranalysis.com/api/v1'
UA = {'User-Agent': 'RankXI/0.1 (jkientz@gmail.com; results wire)'}
# app league key -> (ASA slug, season name); USLS runs fall-spring
LEAGUES = {'mls': ('mls', '2026'), 'uslc': ('uslc', '2026'), 'usl1': ('usl1', '2026'),
           'mnp': ('mlsnp', '2026'), 'nwsl': ('nwsl', '2026'), 'uslw': ('usls', '2025-26')}
# band center each league's Elo is anchored to (display r = elo - 1500 + anchor).
# Men's cup-anchored leagues use the measured Open Cup offsets (mls_mean 1886 +
# offset from data/opencup_offsets.json) — these previously held stale
# pre-recalibration means (uslc 1763 / usl1 1709 / mnp 1662), which re-inflated
# the bands every refresh. recalibrate2.py re-centers precisely afterward;
# keeping these on-target just means the site is never wrong in between.
# NWSL/USLS are outside the cup calibration and keep their display bands.
ANCHOR = {'mls': 1886, 'uslc': 1692, 'usl1': 1597, 'mnp': 1524, 'nwsl': 1886, 'uslw': 1818}
MIN_GAMES = 3

def get(path):
    for _ in range(3):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(B + path, headers=UA), timeout=30))
        except Exception:
            time.sleep(5)
    return None

def deacc(x): return unicodedata.normalize('NFKD', x).encode('ascii', 'ignore').decode()
def norm(n): return re.sub(r'\b(fc|sc|cf|afc|cd|club|the)\b', '', deacc(n).lower()).replace(' ', '').replace('.', '')

BRIDGE = {'losangeles': 'lafc', 'newyorkcity': 'nycfc', 'montreal': 'cfmontreal'}

def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    cur = open(os.path.join(root, 'js', 'data.js')).read()
    clubs = json.loads(re.search(r'export const CLUBS=(\[.*?\]);', cur, re.S).group(1))
    club_by_norm = {}
    for c in clubs:
        club_by_norm.setdefault(c['g'] + ':' + norm(c['n']), c)

    def resolve_club(g, asa_name):
        """Map an ASA team name to our club object (or None)."""
        club = club_by_norm.get(g + ':' + norm(asa_name))
        if not club:
            club = club_by_norm.get(g + ':' + BRIDGE.get(norm(asa_name), ''))
        if not club:
            cand = [c2 for k2, c2 in club_by_norm.items()
                    if k2.startswith(g + ':') and (norm(asa_name)[:7] in k2 or k2.split(':')[1][:7] in norm(asa_name))]
            club = cand[0] if len(cand) == 1 else None
        return club

    def resolve(g, asa_name):
        """Display name for wire rows: our club name when matched, ASA name otherwise."""
        club = resolve_club(g, asa_name)
        return club['n'] if club else asa_name

    wire = []
    K = 32  # backtested 2026-07-27: pro parity-league optimum (was 40)
    for g, (asa, season) in LEAGUES.items():
        teams = get(f'/{asa}/teams'); time.sleep(1)
        games = get(f'/{asa}/games?season_name={season}'); time.sleep(1)
        if not teams or not games:
            print(f'{g}: ASA fetch failed', file=sys.stderr); continue
        tname = {t['team_id']: t['team_name'] for t in teams}
        rows = [x for x in games if x.get('status') == 'FullTime'
                and isinstance(x.get('home_score'), int) and isinstance(x.get('away_score'), int)]
        rows.sort(key=lambda x: x.get('date_time_utc') or '')
        elo, played = {}, {}
        n = 0
        for x in rows:
            h, a = x['home_team_id'], x['away_team_id']
            if h not in tname or a not in tname: continue
            hg, ag = x['home_score'], x['away_score']
            rh, ra = elo.get(h, 1500), elo.get(a, 1500)
            eh = 1 / (1 + 10 ** ((ra - (rh + 65)) / 400))  # +65 home edge, backtested
            sh = 1.0 if hg > ag else 0.0 if hg < ag else 0.5
            margin = math.log(abs(hg - ag) + 1) or 1
            delta = K * margin * (sh - eh)
            wire.append({'d': (x.get('date_time_utc') or '')[:10], 'lg': g,
                         't1': resolve(g, tname[h]), 't2': resolve(g, tname[a]),
                         's1': hg, 's2': ag, 'dr': round(delta), 'ph': round(eh, 2),
                         'gp': min(played.get(h, 0), played.get(a, 0))})
            elo[h] = rh + delta; elo[a] = ra - delta
            played[h] = played.get(h, 0) + 1; played[a] = played.get(a, 0) + 1
            n += 1
        print(f'{g}: {n} rated results')
        # apply ratings from this walk — MLS keeps its standings rating (official
        # record) and carries the results-Elo as a secondary 're' field instead
        applied = 0
        for t, r in elo.items():
            if played.get(t, 0) < MIN_GAMES: continue
            club = resolve_club(g, tname[t])
            if not club: continue
            disp = max(1400, min(2080, round(r - 1500 + ANCHOR[g])))
            if g == 'mls':
                club['re'] = disp
            else:
                club['r'] = disp; club['rr'] = 1; club.pop('re', None)
            applied += 1
        print(f'{g}: {"secondary results-Elo (re)" if g == "mls" else "results-Elo ratings"} on {applied} clubs')
    json.dump(wire, open(os.path.join(root, 'data', 'wire_asa.json'), 'w'), separators=(',', ':'))
    print(f'wrote data/wire_asa.json: {len(wire)} rows')
    out = cur[:cur.index('export const CLUBS=')] + 'export const CLUBS=' + \
        json.dumps(clubs, ensure_ascii=False, separators=(',', ':')) + ';\n' + \
        cur[cur.index('export const REGIONS='):]
    open(os.path.join(root, 'js', 'data.js'), 'w').write(out)
    print('wrote js/data.js')

if __name__ == '__main__':
    main()
