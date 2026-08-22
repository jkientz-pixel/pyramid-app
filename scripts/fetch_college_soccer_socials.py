#!/usr/bin/env python3
"""Harvest per-PROGRAM men's/women's soccer social handles for college clubs.

The old college socials came from a Wikidata/ncaa.com join that mis-matched
badly: 52 US schools ended up pointing at the University of Oxford, and many
others at the school's men's basketball account. This replaces that with a
self-verifying scrape.

Nearly every NCAA/NAIA athletics site runs on SIDEARM, whose global nav emits
one social link per sport carrying an explicit aria-label:

    <a href="//x.com/DukeMSOC" ... aria-label="Men's Soccer Twitter, ...">

so a handle is only accepted when the site itself labels it as that sport and
gender. A wrong athletics domain yields nothing rather than a wrong handle.

Athletics domains come from the club's existing url (when it isn't a plain
.edu) and from the external links on the school's Wikipedia article.

Stages to data/college_socials.json (sidecar, keyed by school name); applied by
scripts/apply_college_socials.py. Resumable: staged schools are skipped.
"""
from _datajs import load_clubs, ROOT
import concurrent.futures as cf
import html as htmllib
import json, os, re, sys, threading, time, urllib.parse, urllib.request

OUT = os.path.join(ROOT, 'data', 'college_socials.json')
MEN = ('ncaa1', 'ncaa2', 'ncaa3', 'naia')
WOMEN = ('ncaa1w', 'ncaa2w')
GROUPS = MEN + WOMEN

BROWSER = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
           'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'}
WIKI_UA = {'User-Agent': 'RankXI/1.0 (jkientz@gmail.com) college athletics site resolver'}

# domains the broken join produced, plus aggregators that are never a school's
# own athletics site
JUNK_DOMAIN = re.compile(
    r'ox\.ac\.uk|st-andrews\.ac\.uk|ehu\.eus|oxford|wikipedia|wikimedia|ncaa\.(com|org)'
    r'|naia\.org|\.gov$|espn|sports-reference|maxpreps|prestosports\.com$'
    r'|amazonaws|cloudfront|facebook|instagram|twitter|x\.com|youtube', re.I)
# conference sites answer for many schools at once — never a single school's site
CONF_DOMAIN = re.compile(r'bigwest|mvc-sports|conference|athletics?conf|-conf\.|ivyleague'
                         r'|bigten|big12|sec sports|accsports|cstv\.com', re.I)

SOCIAL = re.compile(
    r'href="((?:https?:)?//(?:www\.)?(?:x|twitter|instagram)\.com/@?[A-Za-z0-9_.]{1,30})"'
    r'[^>]{0,600}?aria-label="([^"]{0,140})"', re.I | re.S)
WSOC = re.compile(r"women'?s\s+soccer", re.I)
MSOC = re.compile(r"men'?s\s+soccer", re.I)

# Older SIDEARM templates emit no aria-labels. They inline the page's own sport
# as JSON instead, with the program's accounts on it:
#   window.associated_sport = {"title":"Men's Soccer","gender":"m",
#                              "twitter":"AdelphiMSoccer","instagram":"AdelphiMSoccer"}
ASSOC = re.compile(r'associated_sport\s*=\s*(\{.{0,3000}?\})\s*;', re.S)

STOP_TOK = {'university', 'college', 'the', 'of', 'at', 'state', 'saint', 'st',
            'community', 'institute', 'technology', 'school', 'and'}


_lock = threading.Lock()


def wiki(params):
    url = 'https://en.wikipedia.org/w/api.php?' + urllib.parse.urlencode(params)
    for _ in range(3):
        try:
            req = urllib.request.Request(url, headers=WIKI_UA)
            return json.load(urllib.request.urlopen(req, timeout=30))
        except Exception as e:
            if '429' in str(e) or '503' in str(e):
                time.sleep(8); continue
            return None
    return None


def domain_of(u):
    return re.sub(r'^(https?:)?//(www\.)?', '', u.strip()).split('/')[0].lower().rstrip('.')


def wiki_domains(name):
    """External-link domains from the school's Wikipedia article, best first."""
    r = wiki({'action': 'query', 'generator': 'search', 'gsrsearch': name, 'gsrlimit': 1,
              'prop': 'extlinks', 'ellimit': 500, 'format': 'json', 'formatversion': 2})
    if not r or 'query' not in r:
        return []
    out = []
    for pg in r['query'].get('pages', []):
        for e in pg.get('extlinks', []):
            d = domain_of(e['url'])
            if not d or JUNK_DOMAIN.search(d) or CONF_DOMAIN.search(d) or d in out:
                continue
            out.append(d)
    # athletics sites look like goduke.com / radfordathletics.com / sienasaints.com
    rank = lambda d: (0 if re.search(r'athletic|^go[a-z]|sports?\.com$', d) else
                      1 if d.endswith('.com') else 2)
    return sorted(out, key=rank)[:4]


def school_tokens(name):
    """Distinctive lowercase tokens of a club name, for site-ownership checks."""
    n = re.sub(r'[^a-z0-9 ]', ' ', name.lower())
    return {t for t in n.split() if len(t) >= 4 and t not in STOP_TOK}


def page_identity(page):
    """Site name / title text an athletics site uses to identify its school."""
    bits = re.findall(r'<meta[^>]+property="og:site_name"[^>]+content="([^"]{0,120})"', page, re.I)
    bits += re.findall(r'<title[^>]*>([^<]{0,160})</title>', page, re.I)
    return htmllib.unescape(' '.join(bits)).lower()


def fetch(url):
    try:
        req = urllib.request.Request(url, headers=BROWSER)
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.read(2_000_000).decode('utf-8', 'replace')
    except Exception:
        return None


def _url_for(net, handle):
    handle = handle.rstrip('/').rsplit('/', 1)[-1].lstrip('@').split('?')[0]
    if not handle or not re.fullmatch(r'[A-Za-z0-9_.]{1,30}', handle):
        return None
    return ('https://www.instagram.com/' if net == 'si' else 'https://x.com/') + handle


def _put(found, gender, net, raw):
    u = _url_for(net, raw)
    if u:
        found.setdefault(gender, {}).setdefault(net, u)


def extract(page):
    """Soccer accounts the page itself labels as men's or women's soccer."""
    found = {}
    # newer template: one social link per sport, each aria-labelled
    for u, label in SOCIAL.findall(page):
        label = htmllib.unescape(label)
        gender = 'w' if WSOC.search(label) else 'm' if MSOC.search(label) else None
        if gender:
            _put(found, gender, 'si' if 'instagram' in u.lower() else 'sx', u)
    # older template: the page's own sport object carries the accounts
    for blob in ASSOC.findall(page):
        title = re.search(r'"title":"([^"]{0,60})"', blob)
        title = htmllib.unescape(title.group(1)) if title else ''
        g = re.search(r'"gender":"([mw])"', blob)
        gender = g.group(1) if g else ('w' if WSOC.search(title) else 'm' if MSOC.search(title) else None)
        if not gender or not (WSOC.search(title) or MSOC.search(title)):
            continue
        for net, key in (('sx', 'twitter'), ('si', 'instagram')):
            v = re.search(r'"%s":"([^"]{1,120})"' % key, blob)
            if v:
                _put(found, gender, net, v.group(1))
    return found


def scrape_domain(dom, toks):
    """Return {'m': {...}, 'w': {...}} of soccer accounts this site claims.

    Rejects a site whose own title/og:site_name never names this school, which
    stops a bad Wikipedia hit walking a club onto another school's account.
    The men's path also bypasses the splash screen some SIDEARM sites show.
    """
    found, checked = {}, False
    for path in ('/sports/mens-soccer', '/sports/womens-soccer', '/'):
        if found.get('m') and found.get('w'):
            break
        if path == '/' and checked:
            break
        page = fetch('https://' + dom + path)
        if not page or len(page) < 40_000:
            continue
        if not checked:
            if toks and not any(t in page_identity(page) for t in toks):
                return {}
            checked = True
        for gender, nets in extract(page).items():
            for net, u in nets.items():
                found.setdefault(gender, {}).setdefault(net, u)
    return found


def resolve(name, seed_domains):
    toks = school_tokens(name)
    for dom in seed_domains:
        got = scrape_domain(dom, toks)
        if got:
            return dom, got
    return (seed_domains[0] if seed_domains else None), {}


def main():
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    clubs = load_clubs()
    schools = {}
    for c in clubs:
        if c.get('g') not in GROUPS or c.get('h'):
            continue
        s = schools.setdefault(c['n'], {'genders': set(), 'urls': []})
        s['genders'].add('w' if c['g'] in WOMEN else 'm')
        u = c.get('url')
        if u:
            d = domain_of(u)
            if d and not d.endswith('.edu') and not JUNK_DOMAIN.search(d) \
                    and not CONF_DOMAIN.search(d) and d not in s['urls']:
                s['urls'].append(d)

    staged = json.load(open(OUT)) if os.path.exists(OUT) else {}
    todo = [n for n in sorted(schools) if n not in staged]
    if limit:
        todo = todo[:limit]
    print(f'{len(schools)} schools, {len(staged)} already staged, {len(todo)} to do', flush=True)

    done = [0]

    def work(name):
        seeds = list(schools[name]['urls'])
        for d in wiki_domains(name):
            if d not in seeds:
                seeds.append(d)
        dom, found = resolve(name, seeds[:3])
        rec = {'domain': dom, 'socials': found}
        with _lock:
            staged[name] = rec
            done[0] += 1
            if found:
                bits = ' '.join(f'{g}:{v.get("sx", v.get("si", "")).rsplit("/", 1)[-1]}'
                                for g, v in sorted(found.items()))
                print(f'  [{done[0]}/{len(todo)}] {name[:44]:<46} {dom} -> {bits}', flush=True)
            if done[0] % 25 == 0:
                json.dump(staged, open(OUT, 'w'), indent=0)
        return name

    with cf.ThreadPoolExecutor(max_workers=14) as ex:
        list(ex.map(work, todo))

    json.dump(staged, open(OUT, 'w'), indent=0)
    hit = sum(1 for v in staged.values() if v.get('socials'))
    print(f'\nstaged {len(staged)} schools, {hit} with at least one soccer handle -> {OUT}')


if __name__ == '__main__':
    main()
