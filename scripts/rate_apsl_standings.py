#!/usr/bin/env python3
"""Refresh APSL ratings from the current apslsoccer.com league tables.

scrape_apsl.py is a one-time ingest: it adds new clubs and SKIPS every club
already in data.js, so existing APSL ratings never moved after 7/28 (audit
2026-09-23). The site also moved its tables to a script-rendered TeamPass
widget, so the plain-HTML parser there now finds nothing. This script renders
the page in Chromium and only re-rates clubs that already exist.

Method (same shape as rate_upsl_standings.py):

  record   = current-season record + 0.5 x 2025/26 record (data/apsl.json)
  strength = points-per-game + 0.25 * clamp(goal-difference-per-game, -3, 3)
  z        = (strength - pool mean) / pool sd, shrunk by gp / (gp + K)
  rating   = current APSL mean + z * current APSL sd

Mean and spread are held at their current values: recalibrate2.py owns the
APSL-vs-other-leagues placement, this script only reorders clubs within APSL.

Writes data/apsl_current.json (the scraped tables, with season label) so the
freshness gate can check what season we hold.
"""
import json, re, sys, pathlib
from datetime import date

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from _datajs import load_clubs, write_clubs, stored_nudges, ROOT
from scrape_apsl import norm, BASE

PRIOR_WEIGHT = 0.5
K = 6
MIN_ROWS = 60  # fewer team rows than this = a broken render, not a real table
OUT = ROOT / 'data' / 'apsl_current.json'

EXTRACT = r"""() => {
  const out = [];
  const season = (document.body.innerText.match(/SEASON\s*\n?\s*(20\d\d\/20\d\d)/) || [])[1] || '';
  document.querySelectorAll('table').forEach(t => {
    // header text is mixed case ("Team") and upper-cased by CSS
    const head = [...(t.rows[0] ? t.rows[0].cells : [])].map(c => c.textContent.trim().toUpperCase());
    if (!head.includes('MP') || !head.includes('TEAM')) return;
    let label = '', n = t;
    for (let i = 0; i < 10 && n && !label; i++) {
      n = n.previousElementSibling || n.parentElement;
      const txt = n && n.innerText ? n.innerText.trim() : '';
      const m = txt.match(/[A-Z][A-Z &()\-'.]*(CONFERENCE|CUP|DIVISION|LEAGUE)[A-Z &()\-'.]*/);
      if (m) label = m[0].trim();
    }
    const rows = [];
    for (let r = 1; r < t.rows.length; r++) {
      const c = Object.fromEntries([...t.rows[r].cells].map((x, i) => [head[i], x.textContent.trim()]));
      // the team cell also holds the rank badge; the name is the team link
      const link = t.rows[r].querySelector('.tp-team-link');
      c.TEAM = link ? link.textContent.trim() : '';
      if (c.TEAM && /^\d+$/.test(c.MP || '')) rows.push(c);
    }
    if (rows.length) out.push({label, rows});
  });
  return {season, tables: out};
}"""


def scrape():
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto(BASE + '/APSL/Tables/', wait_until='domcontentloaded', timeout=60000)
        page.wait_for_selector('table', timeout=45000)
        page.wait_for_timeout(3000)
        got = page.evaluate(EXTRACT)
        browser.close()
    return got


def records(tables, weight):
    """{norm(name): weighted record}, league tables only (cups are excluded)."""
    agg = {}
    for t in tables:
        if 'CUP' in t['label'].upper():
            continue
        for r in t['rows']:
            try:
                mp, w, d = int(r['MP']), int(r['W']), int(r['D'])
                gd = int(r['GF']) - int(r['GA'])
            except (KeyError, ValueError):
                continue
            a = agg.setdefault(norm(r['TEAM']), {'gp': 0, 'pts': 0, 'gd': 0})
            a['gp'] += mp * weight; a['pts'] += (3 * w + d) * weight; a['gd'] += gd * weight
    return agg


def prior_records():
    old = json.load(open(ROOT / 'data' / 'apsl.json'))['standings']
    return {k: {'gp': v['mp'] * PRIOR_WEIGHT, 'pts': (3 * v['w'] + v['d']) * PRIOR_WEIGHT,
                'gd': (v['gf'] - v['ga']) * PRIOR_WEIGHT} for k, v in old.items() if v['mp']}


def strength(r):
    return r['pts'] / r['gp'] + 0.25 * max(-3.0, min(3.0, r['gd'] / r['gp']))


def main():
    dry = '--dry' in sys.argv
    got = scrape()
    n_rows = sum(len(t['rows']) for t in got['tables'])
    if n_rows < MIN_ROWS:
        sys.exit(f'FATAL: APSL render gave {n_rows} team rows — refusing to write')
    json.dump({'fetched': date.today().isoformat(), **got}, open(OUT, 'w'), indent=1)
    print(f"APSL {got['season']}: {len(got['tables'])} tables, {n_rows} rows", file=sys.stderr)

    rows = prior_records()
    for k, r in records(got['tables'], 1.0).items():
        p = rows.get(k)
        rows[k] = {f: r[f] + (p[f] if p else 0) for f in ('gp', 'pts', 'gd')}

    src = (ROOT / 'js' / 'data.js').read_text()
    clubs = load_clubs(src)
    apsl = [c for c in clubs if c.get('g') == 'apsl' and not c.get('h')]
    matched = {c['id']: rows[norm(c['n'])] for c in apsl if rows.get(norm(c['n']), {}).get('gp', 0) >= 2}
    if len(matched) < 40:
        sys.exit(f'FATAL: only {len(matched)} APSL clubs matched — refusing to write')

    cur = [c['r'] for c in apsl if c.get('rr') == 2]
    mu_r = sum(cur) / len(cur)
    sd_r = (sum((v - mu_r) ** 2 for v in cur) / len(cur)) ** 0.5
    raws = {cid: strength(r) for cid, r in matched.items()}
    mu = sum(raws.values()) / len(raws)
    sd = (sum((v - mu) ** 2 for v in raws.values()) / len(raws)) ** 0.5 or 1.0

    nudges = stored_nudges()
    moved = 0
    for c in apsl:
        if c['id'] not in matched:
            continue
        gp = matched[c['id']]['gp']
        z = (raws[c['id']] - mu) / sd * gp / (gp + K)
        r = round(mu_r + z * sd_r + nudges.get(c['id'], 0.0))
        moved += r != c.get('r')
        c['r'], c['rr'] = r, 2
    new_teams = sorted(set(records(got['tables'], 1.0)) - {norm(c['n']) for c in apsl})
    print(f'APSL: {len(matched)} rated, {moved} moved; {len(new_teams)} table teams not in data.js '
          f'(add with scrape_apsl.py): {new_teams[:12]}', file=sys.stderr)
    if dry:
        print('DRY RUN — nothing written', file=sys.stderr)
        return
    write_clubs(clubs, src)


if __name__ == '__main__':
    main()
