#!/usr/bin/env python3
"""Completed pro matches with box-score stats -> data/match_stats.json.

Companion to fetch_fixtures.py (same ESPN scoreboard, same plain User-Agent,
same club resolution — imported, not copied). For every match that finished
in the last LOOKBACK_DAYS across the four pro leagues ESPN carries, the
summary endpoint is read for the two-team box score: possession, shots,
on target, corners, fouls, cards, saves, offsides, passing — plus the
scorers from keyEvents and attendance from gameInfo. College is skipped:
ESPN publishes scores but no box score for it.

A team's stats block is kept only when it actually carries numbers; a match
with no box score still ships with the score alone, and the app shows it
as a plain result row rather than an empty comparison.

Every match is also upserted (by ESPN event id) into
data/match_stats_archive.json — an append-only season bank that survives the
14-day window rolling forward and any later scrape failure. It is committed,
never served: deploy.sh only ships files the app fetches. Fetch failures
never delete from it.

Output rows:
  {lg, date, venue, att, h:{n,id,g,s:{...}}, a:{...}, goals:[{side,who,min}]}
"""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _datajs import load_clubs, ROOT
import collections
from fetch_fixtures import ALIAS, API, FEEDS, fetch, strip

SUMMARY = 'https://site.api.espn.com/apis/site/v2/sports/soccer/%s/summary?event=%s'
LOOKBACK_DAYS = 14
PRO = {'mls', 'uslc', 'usl1', 'nwsl'}
# ESPN stat name -> our short key
KEEP = {'possessionPct': 'pos', 'totalShots': 'sh', 'shotsOnTarget': 'sot', 'wonCorners': 'ck',
        'foulsCommitted': 'fl', 'yellowCards': 'yc', 'redCards': 'rc', 'saves': 'sv',
        'offsides': 'off', 'accuratePasses': 'pa', 'totalPasses': 'pt'}


def num(v):
    try:
        f = float(str(v).replace('%', ''))
        return int(f) if f.is_integer() else round(f, 1)
    except (TypeError, ValueError):
        return None


def team_stats(t):
    out = {}
    for s in t.get('statistics') or []:
        k = KEEP.get(s.get('name'))
        if k is None:
            continue
        v = num(s.get('displayValue', s.get('value')))
        if v is not None:
            out[k] = v
    return out


def goals(summary):
    res = []
    for ev in summary.get('keyEvents') or []:
        if not ev.get('scoringPlay'):
            continue
        who = ''
        for p in ev.get('participants') or []:
            who = ((p.get('athlete') or {}).get('displayName') or '')
            if who:
                break
        side = 'h' if (ev.get('team') or {}).get('id') == summary.get('_home_tid') else 'a'
        minute = ((ev.get('clock') or {}).get('displayValue') or '').replace("'", '')
        txt = (ev.get('type') or {}).get('text') or ''
        res.append({'side': side, 'who': who, 'min': minute,
                    **({'og': 1} if 'own' in txt.lower() else {}),
                    **({'pen': 1} if 'penalty' in txt.lower() else {})})
    return res


def main():
    clubs = [c for c in load_clubs() if not c.get('h')]
    end = time.strftime('%Y%m%d', time.gmtime())
    start = time.strftime('%Y%m%d', time.gmtime(time.time() - LOOKBACK_DAYS * 86400))
    out, failed, unmatched = [], [], collections.Counter()
    for slug, lg, pool, _ in FEEDS:
        if lg not in PRO:
            continue
        idx = collections.defaultdict(list)
        for c in clubs:
            if c['g'] in pool:
                idx[strip(c['n'])].append(c)

        def resolve(name):
            hit = idx.get(strip(ALIAS.get((name or '').lower(), name)))
            return hit[0]['id'] if hit and len(hit) == 1 else None

        try:
            data = fetch(API % (slug, f'{start}-{end}'))
        except Exception as e:
            print(f'  ! {slug}: {e}'); failed.append(slug); continue
        kept = 0
        for e in data.get('events', []):
            st = ((e.get('status') or {}).get('type') or {})
            if st.get('state') != 'post' or not st.get('completed', True):
                continue
            comp = (e.get('competitions') or [{}])[0]
            sides = {t.get('homeAway'): t for t in comp.get('competitors', [])}
            h, a = sides.get('home'), sides.get('away')
            if not h or not a:
                continue
            hn = (h.get('team') or {}).get('displayName', '')
            an = (a.get('team') or {}).get('displayName', '')
            row = {'lg': lg, 'date': (e.get('date') or '')[:10], 'eid': e.get('id'),
                   'venue': ((comp.get('venue') or {}).get('fullName') or ''),
                   'h': {'n': hn, 'g': num(h.get('score'))}, 'a': {'n': an, 'g': num(a.get('score'))}}
            for side, nm in (('h', hn), ('a', an)):
                cid = resolve(nm)
                if cid: row[side]['id'] = cid
                else: unmatched[f'{lg}: {nm}'] += 1
            try:
                summ = fetch(SUMMARY % (slug, e['id']))
                summ['_home_tid'] = (h.get('team') or {}).get('id')
                teams = {(t.get('homeAway') or ''): t for t in (summ.get('boxscore') or {}).get('teams', [])}
                for side, key in (('h', 'home'), ('a', 'away')):
                    s = team_stats(teams.get(key) or {})
                    if s: row[side]['s'] = s
                gl = goals(summ)
                if gl: row['goals'] = gl
                att = num(((summ.get('gameInfo') or {}).get('attendance')))
                if att: row['att'] = att
                time.sleep(0.3)
            except Exception as ex:
                print(f'  ! summary {e.get("id")}: {ex}')
            out.append(row); kept += 1
        print(f'  {lg:<6} {kept} completed matches')
        time.sleep(0.4)
    if failed and len(failed) == len(PRO):
        sys.exit('FAIL: every feed errored — refusing to publish an empty match_stats file')
    # season bank: upsert by event id, keep everything ever seen
    arc_path = os.path.join(ROOT, 'data', 'match_stats_archive.json')
    try:
        archive = {r['eid']: r for r in json.load(open(arc_path))}
    except (OSError, ValueError):
        archive = {}
    before = len(archive)
    for r in out:
        if r.get('eid'):
            archive[r['eid']] = r
    arc = sorted(archive.values(), key=lambda r: (r['date'], r['lg']))
    json.dump(arc, open(arc_path, 'w'), separators=(',', ':'))
    print(f'archive: {len(arc)} matches ({len(arc) - before} new) -> data/match_stats_archive.json')

    out.sort(key=lambda r: (r['date'], r['lg']), reverse=True)
    with_stats = sum(1 for r in out if r['h'].get('s') and r['a'].get('s'))
    json.dump(out, open(os.path.join(ROOT, 'data', 'match_stats.json'), 'w'), separators=(',', ':'))
    print(f'\n{len(out)} matches -> data/match_stats.json ({with_stats} with box scores)')
    if unmatched:
        print('unmatched:', dict(unmatched))


if __name__ == '__main__':
    main()
