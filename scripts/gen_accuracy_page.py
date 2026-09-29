"""/accuracy: the public prediction record, rendered from data/accuracy.json
(written by prediction_ledger.py). Called from gen_seo_pages.py, which passes
in the shared page shell so this page looks and behaves like the others."""
import html, json, os
from datetime import datetime

ESC = html.escape


def pct(x):
    return f'{round(x * 100)}%'


def when(iso):
    d = datetime.fromisoformat(iso.replace('Z', '+00:00'))
    return d.strftime('%b %d').replace(' 0', ' ')


def summary_table(s, label):
    if not s.get('n'):
        return ''
    return f"""<div class="tw"><table><thead><tr><th>{label}</th><th>Games</th><th>Called correctly</th>
<th>Brier score</th><th class="ll">Log loss</th></tr></thead><tbody>
<tr><td>All leagues</td><td>{s['n']:,}</td><td>{pct(s['hit'])}</td><td>{s['brier']:.3f}</td><td class="ll">{s['logloss']:.3f}</td></tr>
{''.join(f"<tr><td>{ESC(lab)}</td><td>{v['n']:,}</td><td>{pct(v['hit'])}</td><td>{v['brier']:.3f}</td><td class='ll'>{v['logloss']:.3f}</td></tr>"
         for lab, v in s['rows'])}
</tbody></table></div>"""


def calibration_table(s):
    rows = [c for c in s.get('cal', []) if c['n'] >= 5]
    if not rows:
        return ''
    return """<div class="tw"><table><thead><tr><th>Our pick's chance</th><th>Games</th><th>Predicted</th>
<th>Happened</th></tr></thead><tbody>""" + ''.join(
        f"<tr><td>{c['band']}</td><td>{c['n']:,}</td><td>{pct(c['predicted'])}</td><td>{pct(c['actual'])}</td></tr>"
        for c in rows) + '</tbody></table></div>'


def recent_table(recent, label_of):
    if not recent:
        return ''
    out = []
    for e in recent:
        o = 0 if e['res'][0] > e['res'][1] else 1 if e['res'][0] == e['res'][1] else 2
        pick = max(range(3), key=lambda i: e['p'][i])
        mark = '✓' if pick == o else '✗'
        out.append(f"<tr><td>{when(e['start'])}</td><td>{ESC(label_of(e['lg']))}</td>"
                   f"<td>{ESC(e['n1'])} v {ESC(e['n2'])}</td>"
                   f"<td>{pct(e['p'][0])} / {pct(e['p'][1])} / {pct(e['p'][2])}</td>"
                   f"<td>{e['res'][0]}–{e['res'][1]} {mark}</td></tr>")
    return ("<div class=\"tw\"><table><thead><tr><th>Date</th><th>League</th><th>Game</th><th>Home / Draw / Away</th>"
            "<th>Result</th></tr></thead><tbody>" + ''.join(out) + '</tbody></table></div>')


def with_rows(s, label_of):
    return {**s, 'rows': [(label_of(lg), v) for lg, v in s.get('leagues', {}).items() if v.get('n')]}


# wide tables scroll inside their own box instead of widening the page on a
# phone; log loss is the least-read column, so it is the one phones drop
EXTRA_STYLE = ('.tw{overflow-x:auto;-webkit-overflow-scrolling:touch;max-width:100%}'
               '.tw table{min-width:0}@media (max-width:520px){.ll{display:none}'
               'td,th{padding:7px 6px}}')


def build(root, page_head, style, header, footer, write, S, site, today, today_h, leagues):
    path = os.path.join(root, 'data', 'accuracy.json')
    rep = json.load(open(path)) if os.path.exists(path) else {'live': {'n': 0}, 'backtest': {'n': 0}, 'recent': []}
    label_of = lambda g: (leagues.get(g) or {}).get('label', g.upper())
    live, bt = with_rows(rep['live'], label_of), with_rows(rep['backtest'], label_of)

    crumbs = [('Ranked XI', '/'), ('Prediction accuracy', None)]
    title = 'Prediction Accuracy: Every Call on the Record — Ranked XI'
    desc = ('Every Ranked XI match prediction is frozen before kickoff and scored against the '
            'result. Hit rate, Brier score and calibration for MLS, USL and NWSL, nothing deleted.')
    ld = S.graph(S.organization(), S.website(),
                 {'@type': 'WebPage', '@id': f'{site}/accuracy#page', 'url': f'{site}/accuracy',
                  'name': 'Prediction accuracy', 'description': desc, 'dateModified': today,
                  'publisher': {'@id': S.ORG_ID}, 'isPartOf': {'@id': S.SITE_ID}},
                 S.breadcrumb(crumbs))

    if live.get('n'):
        live_html = (f"<p class=\"lead\">{live['n']:,} games scored since {when(live['since'])}. "
                     f"The most likely result happened in <strong>{pct(live['hit'])}</strong> of them, "
                     f"with a Brier score of <strong>{live['brier']:.3f}</strong> "
                     f"(always guessing a third each scores {rep['baseline_brier']:.3f}; lower is better).</p>"
                     + summary_table(live, 'League') + calibration_table(live)
                     + '<h2>Latest scored predictions</h2>' + recent_table(rep['recent'], label_of))
    else:
        pending = live.get('pending', 0)
        waiting = (f"{pending} {'prediction is' if pending == 1 else 'predictions are'} frozen and "
                   "waiting for kickoff. " if pending else
                   "It starts with the next professional game day: each game's odds are frozen 24 to "
                   "36 hours before kickoff. ")
        live_html = (f"<p class=\"lead\">{waiting}Each game is scored the morning after it is played, "
                     "and this section fills in as they are. Until then, the replay below shows how "
                     "the same engine has done this season.</p>")

    write('accuracy.html', page_head(title, desc, '/accuracy', ld, style + EXTRA_STYLE,
                                     'Ranked XI prediction accuracy record') + f"""
{header}
{S.crumbs_html(crumbs)}
<h1 class="disp">Prediction accuracy</h1>
<p class="sub">Every call on the record · updated {today_h}</p>
<p class="lead"><strong>Every match prediction Ranked XI shows is frozen before kickoff and scored
against the result.</strong> The frozen odds, the ratings they came from and the time they were
frozen are stored together and never edited. A game that never gets played is marked void, not
deleted.</p>
<p class="note">Predictions cover the professional leagues only: MLS, the USL Championship,
USL League One, MLS Next Pro, NWSL and the USL Super League. We don't publish odds on amateur,
college or youth games, so there's nothing to score there.</p>
<section><h2>Live record</h2>
{live_html}
</section>
<section><h2>This season, replayed</h2>
<p>Before the live record has a full season in it, here is the same odds engine replayed over
every professional game this season: each game predicted using only the games before it.
Teams start the season level here, while the live model carries ratings over from last season,
so this is the harder test.</p>
{summary_table(bt, 'League')}
{calibration_table(bt)}
</section>
<section><h2>How to read this</h2>
<p><strong>Called correctly</strong> counts how often the result we rated most likely (home win,
draw or away win) actually happened. Professional soccer is close to a coin toss with a draw in
the middle, so no honest model gets near 100%.</p>
<p><strong>Brier score</strong> measures the whole forecast, not just the pick: a confident call
that goes wrong costs more than a hesitant one. 0 is perfect; saying one-in-three for every
outcome scores {rep.get('baseline_brier', 0.667):.3f}.</p>
<p><strong>Calibration</strong> asks whether our numbers mean what they say: of the games where
our pick had a 60-70% chance, did about 65% of them go our way?</p>
<p class="note">How the ratings behind these odds are built: <a href="/methodology">Methodology</a>.
Probabilities are estimates for analysis, never betting advice.</p>
</section>
{footer}""")
