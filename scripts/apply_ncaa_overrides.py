#!/usr/bin/env python3
"""Second NCAA crest pass: explicit club-name -> ncaa.com slug overrides for
the 84 clubs the token matcher left ambiguous/missed (campus-qualifier noise:
UC Berkeley vs California (PA), Union (TN) vs Union (NY), ...). Every slug was
probe-verified 200 against images/logos/schools/bgl/<slug>.svg on 2026-07-29.
Monroe University (NY) and Lackawanna College have no ncaa.com logo. Same
download+rasterize path as fetch_crests_ncaa.py."""
from _datajs import load_clubs, write_clubs, ROOT
from fetch_crests_ncaa import slugify, LOGO, UA
import os, time, urllib.request

OVERRIDES = {
    # ncaa1
    'New Jersey Institute of Technology Highlanders': 'njit',
    'Loyola University Chicago Ramblers': 'loyola-chicago',
    "Saint Joseph's University Hawks": 'saint-josephs',
    'Saint Louis University Billikens': 'saint-louis',
    'University of California, Berkeley Golden Bears': 'california',
    'University of Notre Dame Fighting Irish': 'notre-dame',
    'University of Central Arkansas Bears': 'central-ark',
    'Queens University of Charlotte[Queens] Royals': 'queens-nc',
    'University of West Florida&#91;k&#93; Argonauts': 'west-florida',
    'Gardner–Webb University Runnin\' Bulldogs': 'gardner-webb',
    'Indiana University Bloomington Hoosiers': 'indiana',
    'Pennsylvania State University Nittany Lions': 'penn-st',
    'University of California, Los Angeles Bruins': 'ucla',
    'University of Wisconsin–Madison Badgers': 'wisconsin',
    'California State University, Bakersfield Roadrunners': 'bakersfield',
    'University of California, Irvine Anteaters': 'uc-irvine',
    'Monmouth University Hawks': 'monmouth',
    'University of Detroit Mercy Titans': 'detroit',
    'University of Wisconsin–Green Bay Phoenix': 'green-bay',
    'Indiana University Indianapolis&#91;p&#93; Jaguars': 'iu-indy',
    'University of Wisconsin–Milwaukee Panthers': 'milwaukee',
    'Cornell University Big Red': 'cornell',
    'University of Pennsylvania Quakers': 'penn',
    "Mount St. Mary's University Mountaineers / The Mount": 'mt-st-marys',
    "Saint Peter's University Peacocks": 'st-peters',
    'University of Illinois Chicago Flames': 'ill-chicago',
    'University of California, Davis Aggies': 'uc-davis',
    'University of New Haven&#91;ab&#93; Chargers': 'new-haven',
    'Eastern Illinois University Panthers': 'eastern-ill',
    'University of the Incarnate Word Cardinals': 'incarnate-word',
    'University of Southern Indiana Screaming Eagles': 'southern-ind',
    'California Baptist University Lancers': 'california-baptist',
    'California Polytechnic State University, San Luis Obispo Mustangs': 'cal-poly',
    'University of California, Riverside Highlanders': 'uc-riverside',
    'University of Missouri–Kansas City Roos': 'umkc',
    'University of Nebraska Omaha Mavericks': 'neb-omaha',
    'University of St. Thomas Tommies': 'st-thomas-mn',
    'Coastal Carolina University Chanticleers': 'coastal-caro',
    'University of Central Florida Knights': 'ucf',
    'University of the Pacific Tigers': 'pacific',
    "Saint Mary's College of California Gaels": 'st-marys-ca',
    # ncaa2
    'American International College Yellow Jackets': 'american-intl',
    'Anderson University Trojans': 'anderson-sc',
    'California State Polytechnic University, Humboldt Lumberjacks': 'humboldt-st',
    'California State Polytechnic University, Pomona Broncos': 'cal-poly-pomona',
    'California State University, Los Angeles Golden Eagles': 'cal-st-la',
    'California State University, San Bernardino Coyotes': 'cal-st-san-bdino',
    'University of California, Merced Golden Bobcats': 'california-merced',
    'Carson–Newman University Eagles': 'carson-newman',
    'Christian Brothers University Buccaneers': 'christian-bros',
    'Concordia University–Irvine Eagles': 'concordia-irvine',
    'Dominican University of California Penguins': 'dominican-ca',
    'Dominican University New York Chargers': 'dominican-ny',
    "D'Youville University Saints": 'dyouville',
    'Embry–Riddle Aeronautical University Eagles': 'embry-riddle-fl',
    'Emmanuel University Lions': 'emmanuel-ga',
    'Goldey–Beacom College Lightning': 'goldey-beacom',
    'University of Illinois at Springfield Prairie Stars': 'ill-springfield',
    'University of Jamestown Jimmies': 'jamestown',
    'Kentucky Wesleyan College Panthers': 'ky-wesleyan',
    'Lees–McRae College Bobcats': 'lees-mcrae',
    'Lenoir–Rhyne University Bears': 'lenoir-rhyne',
    'Lincoln University Blue Tigers': 'lincoln-mo',
    'Maryville University Saints': 'maryville-mo',
    'Midwestern State University Mustangs': 'midwestern-st',
    # renamed from Mississippi College 2026; ncaa.com logo still under the old slug
    'Mississippi Christian University Choctaws': 'mississippi-col',
    'University of North Georgia Nighthawks': 'north-georgia',
    'Pennsylvania Western University, California Vulcans': 'california-pa',
    'Point Park University Pioneers': 'point-park',
    'Queens College Knights': 'queens-ny',
    'Regis University Rangers': 'regis-co',
    'Saint Leo University Lions': 'saint-leo',
    "Saint Martin's University Saints": 'saint-martins',
    "Saint Michael's College Purple Knights": 'saint-michaels',
    'Salem University Tigers': 'salem-intl',
    'Southern Connecticut State University Fighting Owls': 'southern-conn-st',
    'Thomas Jefferson University Rams': 'philadelphia-u',
    'Union University Bulldogs': 'union-tn',
    'Vanguard University Lions': 'vanguard',
    'Westminster University Griffins': 'westminster-ut',
    'Wilmington University Wildcats': 'wilmington-de',
    'University of Wisconsin–Parkside Rangers': 'wis-parkside',
}

def main():
    from playwright.sync_api import sync_playwright
    clubs = load_clubs()
    svgdir = os.path.join(ROOT, 'crests', '_svg_tmp')
    os.makedirs(svgdir, exist_ok=True)
    got = miss = 0
    unused = dict(OVERRIDES)
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        page = b.new_page(viewport={'width': 160, 'height': 160})
        for c in clubs:
            if c['g'] not in ('ncaa1', 'ncaa2') or c.get('img'):
                continue
            slug = OVERRIDES.get(c['n'])
            if not slug:
                print(f"  - no override: {c['n']}"); miss += 1; continue
            unused.pop(c['n'], None)
            svg = os.path.join(svgdir, slug + '.svg')
            try:
                if not os.path.exists(svg):
                    req = urllib.request.Request(LOGO.format(slug=slug), headers=UA)
                    data = urllib.request.urlopen(req, timeout=30).read()
                    if b'<svg' not in data[:600]: raise Exception('not svg')
                    open(svg, 'wb').write(data)
                    time.sleep(0.3)
                fn = f"crests/{c['g']}-{slugify(c['n'])}.png"
                dest = os.path.join(ROOT, fn)
                page.set_content(f'<body style="margin:0"><img src="file://{svg}" '
                                 'style="width:128px;height:128px;object-fit:contain"></body>')
                page.locator('img').screenshot(path=dest, omit_background=True)
                assert os.path.getsize(dest) > 500
                c['img'] = fn
                got += 1
                print(f"  + {c['n']} <- {slug}.svg")
            except Exception as e:
                miss += 1
                print(f"  - {c['n']}: {e}")
        b.close()
    if unused:
        print('overrides that matched no club (name drift?):', list(unused)[:5])
    print(f'got {got}, missed {miss}')
    if got:
        write_clubs(clubs)

if __name__ == '__main__':
    main()
