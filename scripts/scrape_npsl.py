#!/usr/bin/env python3
"""Pull NPSL teams, results, and league tables from npsl.com's open
SportsPress REST API into data/npsl.json. No HTML scraping needed."""
import json, re, urllib.request, urllib.parse, time, os, html

BASE = 'https://www.npsl.com/wp-json/sportspress/v2/'
UA = {'User-Agent': 'RankXI/0.1 (jkientz@gmail.com; data pipeline)'}

def get(endpoint, **params):
    params.setdefault('per_page', 100)
    out, page = [], 1
    while True:
        params['page'] = page
        url = BASE + endpoint + '?' + urllib.parse.urlencode(params)
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=20) as r:
                batch = json.load(r)
        except Exception as e:
            if page == 1:
                raise
            break
        if not isinstance(batch, list) or not batch:
            break
        out += batch
        if len(batch) < params['per_page']:
            break
        page += 1
        time.sleep(0.6)
    return out

def clean(s):
    return html.unescape(re.sub(r'<[^>]+>', '', s or '')).strip()

def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.makedirs(os.path.join(root, 'data'), exist_ok=True)

    teams = get('teams')
    team_by_id = {}
    for t in teams:
        team_by_id[t['id']] = {
            'id': t['id'], 'name': clean(t['title']['rendered']),
            'slug': t['slug'], 'link': t.get('link'), 'url': t.get('url') or None,
            'abbr': t.get('abbreviation') or None,
        }
    print(f'teams: {len(team_by_id)}')

    events = get('events')
    results = []
    for e in events:
        raw_teams = e.get('teams') or []
        res = e.get('results') or {}
        main_res = e.get('main_results') or []
        row = {
            'id': e['id'], 'date': e.get('date'),
            'title': clean(e['title']['rendered']),
            'status': e.get('status'),
            'teams': raw_teams,
            'score': main_res if main_res else None,
            'day': e.get('day'),
        }
        results.append(row)
    print(f'events: {len(results)}')

    tables = get('tables')
    tabs = [{'id': t['id'], 'title': clean(t['title']['rendered']),
             'data': t.get('data')} for t in tables]
    print(f'tables: {len(tabs)}')

    out = {'fetched': None, 'teams': list(team_by_id.values()),
           'events': results, 'tables': tabs}
    open(os.path.join(root, 'data', 'npsl.json'), 'w').write(
        json.dumps(out, ensure_ascii=False))
    print('wrote data/npsl.json')

if __name__ == '__main__':
    main()
