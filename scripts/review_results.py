#!/usr/bin/env python3
"""Review community result submissions (D1 `results`) and promote approved
rows into data/community_results.json.

Run from the MAIN checkout (wrangler needs wrangler.toml + the D1 binding):

  python3 scripts/review_results.py            # interactive: y / n / s(kip) / q
  python3 scripts/review_results.py --list     # just print what's pending
  python3 scripts/review_results.py --approve 12 14 --reject 13

Approved rows are appended to data/community_results.json:
  {"results": [{"id", "date", "home_id", "away_id", "hg", "ag", "comp", "src"}]}
and the club page lists them under "Community results · verified". They are
NOT fed to Elo by this script — that is a modelling decision (K, tier weight)
taken in the recalibration pipeline, deliberately separate from moderation.

Commit data/community_results.json and deploy for approved results to show.
"""
import argparse, datetime, json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'community_results.json')
WRANGLER = ['npx', '-y', 'wrangler@4.114.0', 'd1', 'execute', 'rankxi-signups', '--remote', '--json']


def d1(sql):
    r = subprocess.run(WRANGLER + ['--command', sql], cwd=ROOT, capture_output=True, text=True)
    if r.returncode:
        sys.exit(f'wrangler failed:\n{r.stderr[-800:]}')
    m = re.search(r'\[\s*\{.*\}\s*\]', r.stdout, re.S)
    out = json.loads(m.group(0)) if m else []
    return out[0].get('results', []) if out else []


def club_names():
    src = open(os.path.join(ROOT, 'js', 'data.js')).read()
    clubs = json.loads(re.search(r'export const CLUBS=(\[.*?\]);', src, re.S).group(1))
    return {c['id']: c['n'] for c in clubs if c.get('id')}


def load_out():
    try:
        with open(OUT) as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {'results': []}


def show(row, names):
    flag = '' if row['home_id'] in names and row['away_id'] in names else '  !! unknown club id'
    print(f"#{row['id']}  {row['date']}  {row['home']} {row['hg']}–{row['ag']} {row['away']}"
          f"  [{row.get('comp') or '?'}]{flag}")
    if row.get('src'): print(f"      src: {row['src']}")
    if row.get('note'): print(f"      note: {row['note']}")
    if row.get('contact'): print(f"      contact: {row['contact']}")
    print(f"      submitted {row['ts'][:16]} from {row.get('page') or '?'}")


def decide(ids, status, pending, out):
    if not ids: return
    now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')
    by = {r['id']: r for r in pending}
    for i in ids:
        r = by.get(i)
        if not r: print(f'#{i}: not pending, skipped'); continue
        if status == 'approved' and not any(x['id'] == i for x in out['results']):
            out['results'].append({k: r[k] for k in ('id', 'date', 'home_id', 'away_id', 'hg', 'ag', 'comp', 'src')})
        d1(f"UPDATE results SET status='{status}', reviewed='{now}' WHERE id={int(i)}")
        print(f'#{i}: {status}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--list', action='store_true')
    ap.add_argument('--approve', nargs='*', type=int, default=[])
    ap.add_argument('--reject', nargs='*', type=int, default=[])
    a = ap.parse_args()
    names = club_names()
    pending = d1("SELECT * FROM results WHERE status='pending' ORDER BY ts")
    print(f'{len(pending)} pending')
    out = load_out()
    if a.list or a.approve or a.reject:
        for r in pending: show(r, names)
        decide(a.approve, 'approved', pending, out)
        decide(a.reject, 'rejected', pending, out)
    else:
        for r in pending:
            show(r, names)
            ans = input('  approve? [y/n/s/q] ').strip().lower()
            if ans == 'q': break
            if ans == 'y': decide([r['id']], 'approved', pending, out)
            elif ans == 'n': decide([r['id']], 'rejected', pending, out)
    out['results'].sort(key=lambda x: (x['date'], x['id']))
    with open(OUT, 'w') as fh:
        json.dump(out, fh, separators=(',', ':'), indent=None)
    print(f'{len(out["results"])} approved results in {os.path.relpath(OUT, ROOT)} — commit + deploy to publish')


if __name__ == '__main__':
    main()
