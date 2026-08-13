#!/usr/bin/env python3
"""Second NCAA crest pass: explicit club-name -> ncaa.com slug overrides for
the 84 clubs the token matcher left ambiguous/missed (campus-qualifier noise:
UC Berkeley vs California (PA), Union (TN) vs Union (NY), ...). Every slug was
probe-verified 200 against images/logos/schools/bgl/<slug>.svg on 2026-07-29.
Monroe University (NY) and Lackawanna College have no ncaa.com logo. Same
download+rasterize path as fetch_crests_ncaa.py."""
from _datajs import load_clubs, write_clubs, ROOT
from fetch_crests_ncaa import slugify, LOGO, UA, fetch_svg, rasterize_svg
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
    # Aug 2026 flagship-bug repair: schools the strict matcher now abstains
    # on (the index abbreviates them past recognition) or was mis-claiming.
    # Slugs read from the cached schools index; SIUE/TAMIU/Corpus sit under
    # non-obvious slugs there. A&M-Texarkana has no ncaa.com logo.
    'Milwaukee School of Engineering Raiders': 'msoe',
    'Boston University Terriers': 'boston-u',
    'United States Naval Academy Midshipmen': 'navy',
    'United States Military Academy Black Knights': 'army',
    'Michigan Technological University Huskies': 'michigan-tech',
    'Illinois Institute of Technology Scarlet Hawks': 'iit',
    'Illinois College Blueboys and Lady Blues': 'illinois-col',
    'Florida Institute of Technology Panthers': 'florida-tech',
    'Rhode Island College Anchormen': 'rhode-island-col',
    'Connecticut College Camels': 'connecticut-col',
    'Washington College Shoremen': 'washington-col',
    'Georgia College & State University Bobcats': 'georgia-college',
    'Colorado State University–Pueblo ThunderWolves': 'colorado-st-pueblo',
    'Southern Illinois University Edwardsville Cougars': 'siu-edwardsville',
    'Southern Illinois University Carbondale Salukis': 'southern-ill',
    'Texas A&M International University Dustdevils': 'tex-am-intl',
    'Texas A&M University–Corpus Christi Islanders': 'am-corpus-chris',
    'Texas A&M University Aggies': 'texas-am',
    'University of Illinois Urbana-Champaign Fighting Illini': 'illinois',
    'University of Nevada, Reno Wolf Pack': 'nevada',
    'Texas Southern University Tigers': 'texas-southern',
    'Saint Francis University Red Flash': 'st-francis-pa',
    'Texas State University Bobcats': 'texas-st',
    "St. Edward's University Hilltoppers": 'st-edwards',
    'East Texas A&M University Lions': 'tex-am-commerce',
    'Southern New Hampshire University Penmen': 'southern-nh',
    'Black Hills State University Yellow Jackets': 'black-hills-st',
    'Metropolitan State University of Denver Roadrunners': 'metro-st',
    'Colorado State University Rams': 'colorado-st',
    "St. Mary's College of Maryland Seahawks": 'st-marys-md',
    'Dickinson College Red Devils': 'dickinson',
    'Pennsylvania State University, Abington Nittany Lions': 'penn-st-abington',
    'Pennsylvania State University, Altoona Lions': 'penn-st-altoona',
    'Pennsylvania State University, Behrend Lions': 'penn-st-behrend',
    'Pennsylvania State University, Berks College Nittany Lions': 'penn-st-berks',
    'Pennsylvania State University, Harrisburg Lions': 'penn-st-harrisburg',
    'The Pennsylvania State University Nittany Lions': 'penn-st',
    'University of North Carolina at Charlotte 49ers': 'charlotte',
    'University of North Carolina at Asheville Bulldogs': 'unc-asheville',
    'University of North Carolina Wilmington Seahawks': 'unc-wilmington',
    'University of North Carolina at Wilmington Seahawks': 'unc-wilmington',
    'University of North Carolina at Greensboro Spartans': 'unc-greensboro',
    'University of North Carolina at Pembroke Braves': 'unc-pembroke',
    'University of California, San Diego Tritons': 'uc-san-diego',
    'Georgia Southwestern State University Hurricanes': 'ga-southwestern',
    'The Citadel, The Military College of South Carolina Bulldogs': 'citadel',
    'University of South Carolina Beaufort Sand Sharks': 'usc-beaufort',
    'San Francisco State University Gators': 'san-fran-st',
    'New England College Pilgrims': 'new-england-col',
    'Western New England University Golden Bears': 'western-new-eng',
    'Virginia Polytechnic Institute and State University Hokies': 'virginia-tech',
    'Virginia State University Trojans': 'virginia-st',
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
            if c['g'] not in ('ncaa1', 'ncaa2', 'ncaa3', 'ncaa1w', 'ncaa2w') or c.get('img'):
                continue
            slug = OVERRIDES.get(c['n'])
            if not slug:
                print(f"  - no override: {c['n']}"); miss += 1; continue
            unused.pop(c['n'], None)
            try:
                fn = f"crests/{c['g']}-{slugify(c['n'])}.png"
                dest = os.path.join(ROOT, fn)
                rasterize_svg(page, fetch_svg(slug, svgdir), dest)
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
