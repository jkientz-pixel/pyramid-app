#!/usr/bin/env python3
"""Open Cup QUALIFYING ties from ussoccer.com -> data/opencup_qual.json.

ESPN's `usa.open` slug carries only the Tournament Proper, so the amateur
Open Division rounds — the part of the Cup our niche actually plays in — never
reached #/opencup. U.S. Soccer publishes every round on one schedule page
(https://www.ussoccer.com/us-open-cup/schedule): a tab per round, each a plain
table of Date | Teams | Time | Venue (| Eastern Time). The page is a Next.js
app; every tab's table ships inside the server-rendered flight payload
(`self.__next_f.push`), so one GET returns all rounds with no JS and no
private API. Scheduled ties read "Host vs. Visitor"; played ties read
"Host 2 - <strong>3 Visitor</strong>" with the winner bold, penalties as
"2 (4) - 2 (2)", and a trailing "(AET)", "(AET & PKs)" or "(Forfeit)".

Rules, same spirit as fetch_opencup_live.py:

  * kickoff, venue and city are recorded AS STATED — never geocoded, never
    guessed (pyramid-app-no-guessed-locations);
  * club names resolve to ids HERE at build time with the same matcher as the
    ESPN feed; an unmatched side stays plain text and no club is ever created
    from this feed (CLUBS is append-only and curated);
  * a host whose matched club sits in a different state than the stated venue
    is dropped to plain text — a same-name club in another state is the wrong
    club, and a missing crest beats the wrong one;
  * failure is soft: any fetch/parse problem keeps the last committed file and
    exits 0, so a ussoccer.com change never blocks the roster refresh.

Edition: the tab label carries it ("THIRD QUALIFYING ROUND (2027)"). Qualifying
is played in the autumn BEFORE the edition year, so Sept-Dec dates belong to
edition-1.
"""
import collections, datetime, html, json, os, re, sys, time, urllib.request
from zoneinfo import ZoneInfo

from fetch_opencup_live import build_resolver
from _datajs import load_clubs, ROOT

URL = 'https://www.ussoccer.com/us-open-cup/schedule'
# a browser-ish UA: unlike ESPN, ussoccer.com serves the full page to it
UA = {'User-Agent': 'Mozilla/5.0 (compatible; RankedXI-fetch/1.0; +https://www.rankedxi.com)'}
OUT = os.path.join(ROOT, 'data', 'opencup_qual.json')

TZ = {'ET': 'America/New_York', 'CT': 'America/Chicago', 'MT': 'America/Denver',
      'PT': 'America/Los_Angeles', 'AKT': 'America/Anchorage', 'HT': 'Pacific/Honolulu'}
MONTH = {m: i + 1 for i, m in enumerate(
    ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'])}
# AP-style state names as the schedule prints them -> postal codes
STATE = {
    'ala': 'AL', 'alaska': 'AK', 'ariz': 'AZ', 'ark': 'AR', 'calif': 'CA', 'colo': 'CO',
    'conn': 'CT', 'del': 'DE', 'fla': 'FL', 'ga': 'GA', 'hawaii': 'HI', 'idaho': 'ID',
    'ill': 'IL', 'ind': 'IN', 'iowa': 'IA', 'kan': 'KS', 'ky': 'KY', 'la': 'LA',
    'maine': 'ME', 'md': 'MD', 'mass': 'MA', 'mich': 'MI', 'minn': 'MN', 'miss': 'MS',
    'mo': 'MO', 'mont': 'MT', 'neb': 'NE', 'nev': 'NV', 'n.h': 'NH', 'n.j': 'NJ',
    'n.m': 'NM', 'n.y': 'NY', 'n.c': 'NC', 'n.d': 'ND', 'ohio': 'OH', 'okla': 'OK',
    'ore': 'OR', 'pa': 'PA', 'r.i': 'RI', 's.c': 'SC', 's.d': 'SD', 'tenn': 'TN',
    'texas': 'TX', 'utah': 'UT', 'vt': 'VT', 'va': 'VA', 'wash': 'WA', 'w.va': 'WV',
    'wis': 'WI', 'wyo': 'WY', 'd.c': 'DC',
}
ROUND_RE = re.compile(r'^(FIRST|SECOND|THIRD|FOURTH|FINAL)\s+QUALIFYING\s+ROUND\s*\((\d{4})\)$', re.I)
SCORE_RE = re.compile(
    r'^(?P<a>.+?)\s+(?P<s1>\d+)(?:\s*\((?P<p1>\d+)\))?\s*-\s*(?P<s2>\d+)(?:\s*\((?P<p2>\d+)\))?'
    r'\s+(?P<b>.+?)(?:\s*\((?P<note>[^()]*)\))?$')


def fetch(url=URL):
    req = urllib.request.Request(url, headers=UA)
    return urllib.request.urlopen(req, timeout=60).read().decode('utf-8', 'replace')


def flight_payload(page):
    """The page's React flight stream, decoded to one string."""
    chunks = re.findall(r'self\.__next_f\.push\(\[1,"(.*?)"\]\)</script>', page, flags=re.S)
    return ''.join(json.loads('"' + c + '"') for c in chunks)


def tabs(page):
    """[(label, table_html)] in tab order. The stream lists the labels and then
    one table per tab in the same order; a count mismatch means the layout
    changed, and we refuse to guess which table is which round."""
    flight = flight_payload(page)
    m = re.search(r'"labels":(\[[^\]]*\])', flight)
    if not m:
        raise ValueError('no tab labels in the flight stream')
    labels = json.loads(m.group(1))
    tables = re.findall(r'<table.*?</table>', flight, flags=re.S)
    if len(tables) != len(labels):
        raise ValueError(f'{len(labels)} tab labels but {len(tables)} tables')
    return list(zip(labels, tables))


def cells(table):
    out = []
    for tr in re.findall(r'<tr[^>]*>(.*?)</tr>', table, flags=re.S):
        tds = re.findall(r'<td[^>]*>(.*?)</td>', tr, flags=re.S)
        if tds:
            out.append(tds)
    return out


def text(s):
    return ' '.join(html.unescape(re.sub(r'<[^>]+>', ' ', s)).split())


def round_name(label):
    m = ROUND_RE.match(label.strip())
    return (m.group(1).capitalize() + ' Qualifying Round', int(m.group(2))) if m else None


def parse_day(txt, edition):
    """'Oct. 31' -> date. Autumn (Sep-Dec) belongs to the year before the
    edition; Jan-Aug to the edition year itself."""
    m = re.match(r'([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})', txt.strip())
    if not m or m.group(1).lower() not in MONTH:
        return None
    mon = MONTH[m.group(1).lower()]
    try:
        return datetime.date(edition - 1 if mon >= 9 else edition, mon, int(m.group(2)))
    except ValueError:
        return None


def parse_time(txt):
    """'3:30 p.m. ET' -> (hour, minute, tz name) or None."""
    m = re.match(r'(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?\s*([A-Z]{2,3})', txt.strip(), re.I)
    if not m or m.group(4).upper() not in TZ:
        return None
    h = int(m.group(1)) % 12 + (12 if m.group(3).lower() == 'p' else 0)
    return h, int(m.group(2) or 0), m.group(4).upper()


def kickoff(day, tm):
    if not day or not tm:
        return None
    local = datetime.datetime(day.year, day.month, day.day, tm[0], tm[1], tzinfo=ZoneInfo(TZ[tm[2]]))
    return local.astimezone(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:00.000Z')


def split_venue(txt):
    """'Britland Park; Fall River, Mass.' -> (venue, city text, state code).
    All as stated; a lone '-' means the source gave nothing."""
    txt = txt.strip()
    if not txt or txt == '-':
        return None, None, None
    venue, _, rest = txt.partition(';')
    city = rest.strip() or None
    st = None
    if city and ',' in city:
        key = city.rsplit(',', 1)[1].strip().lower().rstrip('.')
        st = STATE.get(key)
    return venue.strip() or None, city, st


def parse_teams(raw):
    """The Teams cell -> dict(t1, t2, [score, pens, winner, aet, forfeit])."""
    plain = text(raw)
    if ' vs. ' in plain and not re.search(r'\d\s*-\s*\d', plain):
        a, _, b = plain.partition(' vs. ')
        return {'t1': a.strip(), 't2': b.strip()}
    # a note is usually parenthesised, but one row printed a bare trailing "AET"
    bare = re.search(r'\s+(AET(?:\s*&\s*PKs)?)$', plain)
    if bare:
        plain = plain[:bare.start()] + f' ({bare.group(1)})'
    m = SCORE_RE.match(plain)
    if not m:
        return None
    rec = {'t1': m['a'].strip(), 't2': m['b'].strip(),
           'score': [int(m['s1']), int(m['s2'])]}
    if m['p1'] is not None and m['p2'] is not None:
        rec['pens'] = [int(m['p1']), int(m['p2'])]
    note = (m['note'] or '').upper()
    if 'AET' in note:
        rec['aet'] = True
    if 'FORFEIT' in note:
        rec['forfeit'] = True
    # the bold side won; fall back to the result when the source bolds nothing
    bold = [text(x) for x in re.findall(r'<(?:strong|b)>(.*?)</(?:strong|b)>', raw, flags=re.S)]
    bold = ' '.join(bold)
    s1, s2 = rec['score']
    if bold:
        in1 = rec['t1'].lower() in bold.lower()
        in2 = rec['t2'].lower() in bold.lower()
        rec['winner'] = 1 if in1 and not in2 else 2 if in2 and not in1 else 0
    if not rec.get('winner'):
        pw = rec.get('pens')
        rec['winner'] = (1 if s1 > s2 else 2 if s2 > s1 else
                         (1 if pw and pw[0] > pw[1] else 2 if pw and pw[1] > pw[0] else 0))
    return rec


def parse_page(page, resolve, clubs_by_id):
    """-> (edition, ties, unresolved Counter, skipped rows)."""
    ties, unresolved, skipped, editions = [], collections.Counter(), [], set()
    for label, table in tabs(page):
        rn = round_name(label)
        if not rn:
            continue
        name, edition = rn
        editions.add(edition)
        for row in cells(table):
            if len(row) < 4:
                skipped.append(text(' '.join(row)))
                continue
            day = parse_day(text(row[0]), edition)
            teams = parse_teams(row[1])
            if not teams:
                skipped.append(text(' '.join(row)))
                continue
            tm = parse_time(text(row[2]))
            venue, city, vst = split_venue(text(row[3]))
            rec = {'round': name, 't1': teams['t1'], 't2': teams['t2']}
            if day:
                rec['date'] = day.isoformat()
            ko = kickoff(day, tm)
            if ko:
                rec['start'] = ko
                rec['tz'] = tm[2]
            if venue:
                rec['venue'] = venue
            if city:
                rec['city'] = city
            for k in ('score', 'pens', 'winner', 'aet', 'forfeit'):
                if k in teams:
                    rec[k] = teams[k]
            rec['state'] = 'post' if 'score' in teams else 'pre'
            id1, id2 = resolve(teams['t1']), resolve(teams['t2'])
            host = clubs_by_id.get(id1)
            if host and vst and host.get('st') and host['st'] != vst:
                print(f'  state mismatch, dropping host match: {teams["t1"]} '
                      f'({host["id"]} is {host["st"]}, venue says {vst})', file=sys.stderr)
                id1 = None
            for nm, got in ((teams['t1'], id1), (teams['t2'], id2)):
                if not got:
                    unresolved[nm] += 1
            if id1:
                rec['id1'] = id1
            if id2:
                rec['id2'] = id2
            ties.append(rec)
    if not editions:
        raise ValueError('no qualifying-round tabs on the page')
    return max(editions), ties, unresolved, skipped


def main():
    try:
        page = fetch()
        clubs = load_clubs()
        edition, ties, unresolved, skipped = parse_page(
            page, build_resolver(clubs), {c['id']: c for c in clubs if c.get('id')})
    except Exception as e:  # noqa: BLE001 — any fetch/parse problem is the same to us
        print(f'WARNING: ussoccer.com qualifying fetch failed ({e}); keeping the last file',
              file=sys.stderr)
        return 0
    if not ties:
        print('WARNING: qualifying page parsed to zero ties; keeping the last file', file=sys.stderr)
        return 0
    ties.sort(key=lambda t: (t.get('start') or t.get('date') or '9', t['t1']))
    both = sum(1 for t in ties if t.get('id1') and t.get('id2'))
    rounds = collections.Counter(t['round'] for t in ties)
    json.dump({'year': edition, 'fetched': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
               'source': 'ussoccer.com U.S. Open Cup schedule & results', 'ties': ties},
              open(OUT, 'w'), separators=(',', ':'))
    print(f'{len(ties)} {edition} qualifying ties -> data/opencup_qual.json '
          f'({both} with both clubs resolved); ' + ', '.join(f'{k}: {v}' for k, v in rounds.items()))
    if skipped:
        print(f'skipped {len(skipped)} unparseable rows: ' + ' | '.join(skipped[:5]), file=sys.stderr)
    if unresolved:
        print('unresolved: ' + ', '.join(f'{n} x{k}' for n, k in unresolved.most_common()))
    return 0


if __name__ == '__main__':
    sys.exit(main())
