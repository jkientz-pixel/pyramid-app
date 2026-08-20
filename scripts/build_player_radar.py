#!/usr/bin/env python3
"""Player radar data for the six ASA-covered pro leagues.

Driblab-style physical radars (high-speed runs, sprint distance) are built on
optical tracking data that nobody publishes for US soccer at any price we can
pay. This is the honest analogue: the same chart grammar over the richest
public per-player signal that does exist — American Soccer Analysis's
goals-added (g+), broken out by the six action types a player can add value
through, plus per-96 shot-creation volume.

Only raw per-96 values are written. Percentiles are computed in the browser so
the minutes floor stays a live control: move the slider and the comparison pool
(and therefore every percentile) recomputes against the players who actually
clear it. Precomputing them here would freeze one arbitrary pool into the file.

Goalkeepers are omitted on purpose: ASA models them through a separate
endpoint with different actions, so a GK on an outfield radar would be six
axes of nothing.

Writes data/player_radar.json.
"""
import json, urllib.request, time, os, sys

B = 'https://app.americansocceranalysis.com/api/v1'
UA = {'User-Agent': 'RankXI/0.1 (jkientz@gmail.com; player radar)'}
# app league key -> (ASA slug, season name, display label). USLS runs fall-spring.
LEAGUES = {
    'mls':   ('mls',   '2026',    'MLS 2026'),
    'nwsl':  ('nwsl',  '2026',    'NWSL 2026'),
    'uslc':  ('uslc',  '2026',    'USL Championship 2026'),
    'usl1':  ('usl1',  '2026',    'USL League One 2026'),
    'mlsnp': ('mlsnp', '2026',    'MLS Next Pro 2026'),
    'usls':  ('usls',  '2025-26', 'USL Super League 2025-26'),
}
# ASA action_type -> short key on the wire. Order here is the radar axis order,
# chosen so related actions sit adjacent: on-ball value first (what you do with
# it), then off-ball (how you get it and what you stop).
ACTIONS = [
    ('Shooting',     'sh'),
    ('Dribbling',    'dr'),
    ('Passing',      'ps'),
    ('Receiving',    'rc'),
    ('Interrupting', 'it'),
    ('Fouling',      'fl'),
]
# Below this a per-96 rate is noise, not signal. It is also the floor the page
# starts at; the slider can go lower but says so.
MIN_MINUTES = 450


def get(path):
    for _ in range(3):
        try:
            req = urllib.request.Request(B + path, headers=UA)
            return json.load(urllib.request.urlopen(req, timeout=45))
        except Exception:
            time.sleep(5)
    return None


def build_league(slug, season):
    teams = get(f'/{slug}/teams');   time.sleep(1)
    players = get(f'/{slug}/players'); time.sleep(1)
    ga = get(f'/{slug}/players/goals-added?season_name={season}'); time.sleep(1)
    xg = get(f'/{slug}/players/xgoals?season_name={season}'); time.sleep(1)
    if not teams or not players or not ga:
        print(f'{slug}: ASA fetch failed', file=sys.stderr)
        return []

    tabbr = {t['team_id']: (t.get('team_abbreviation') or t.get('team_short_name') or '?')
             for t in teams}
    pname = {p['player_id']: (p.get('player_name') or p.get('name'))
             for p in players if p.get('player_id')}
    # xgoals is keyed the same way and carries the volume metrics g+ doesn't.
    vol = {}
    for r in (xg or []):
        pid = r.get('player_id')
        if pid:
            vol[pid] = r

    out = []
    for row in ga:
        pid, mins = row.get('player_id'), row.get('minutes_played') or 0
        if not pid or mins < MIN_MINUTES:
            continue
        name = pname.get(pid)
        pos = (row.get('general_position') or '').upper()
        if not name or pos not in ('CB', 'FB', 'DM', 'CM', 'AM', 'W', 'ST'):
            continue
        # A player traded mid-season carries a list of team_ids; the last one is
        # where they are now, which is what a scouting view wants on the card.
        tid = row.get('team_id')
        if isinstance(tid, list):
            tid = tid[-1] if tid else None

        per96 = 96.0 / mins
        rec = {'id': pid, 'n': name, 't': tabbr.get(tid, '?'), 'p': pos, 'm': mins}
        by_action = {d.get('action_type'): d for d in (row.get('data') or [])}
        for action, key in ACTIONS:
            d = by_action.get(action) or {}
            # above_avg is already positionally adjusted by ASA; per-96 makes it
            # a rate rather than a reward for having played more.
            rec[key] = round((d.get('goals_added_above_avg') or 0.0) * per96, 4)
            rec[key + 'c'] = round((d.get('count_actions') or 0) * per96, 2)
        v = vol.get(pid) or {}
        # Volume metrics travel with the radar so the scatter and the beeswarm
        # can offer them without a second fetch.
        rec['xg'] = round((v.get('xgoals') or 0.0) * per96, 4)
        rec['xa'] = round((v.get('xassists') or 0.0) * per96, 4)
        rec['kp'] = round((v.get('key_passes') or 0) * per96, 3)
        rec['shv'] = round((v.get('shots') or 0) * per96, 3)
        rec['g'] = v.get('goals') or 0
        rec['a'] = v.get('primary_assists') or 0
        # Finishing over/under the model, per 96 — the one place a player's
        # own output is allowed to argue with the expectation.
        rec['gx'] = round((v.get('goals_minus_xgoals') or 0.0) * per96, 4)
        out.append(rec)
    return out


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    payload = {'actions': [{'label': a, 'key': k} for a, k in ACTIONS],
               'min_minutes': MIN_MINUTES, 'leagues': {}}
    total = 0
    for key, (slug, season, label) in LEAGUES.items():
        players = build_league(slug, season)
        if not players:
            print(f'{key}: no players, skipping', file=sys.stderr)
            continue
        payload['leagues'][key] = {'label': label, 'players': players}
        total += len(players)
        print(f'{key}: {len(players)} players')
    if total < 500:
        print(f'refusing to write: only {total} players across all leagues', file=sys.stderr)
        return 1
    path = os.path.join(root, 'data', 'player_radar.json')
    with open(path, 'w') as f:
        json.dump(payload, f, separators=(',', ':'))
    print(f'wrote {path} — {total} players, {os.path.getsize(path) // 1024}KB')
    return 0


if __name__ == '__main__':
    sys.exit(main())
