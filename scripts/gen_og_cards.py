#!/usr/bin/env python3
"""Composite a 1200x630 Open Graph share card per rated club at og/<id>.jpg —
dark app theme, crest, club name, rating and ranks — so a shared
/club/<id> link unfurls as that club's card instead of the generic banner.
(Raw crests can't be the og:image directly: most are under the ~200px
minimum that iMessage/WhatsApp/Twitter scrapers require, so 97% would be
silently ignored.)

Runs before gen_club_pages.py in deploy.sh; the page generator points
og:image at og/<id>.jpg when the card exists. Needs Pillow: re-execs into
the repo .venv when the calling python lacks it, and exits cleanly (pages
keep the site-wide /og.png) when neither has it. A sidecar hash cache makes
re-runs cheap — only clubs whose card inputs changed are re-rendered."""
import json, re, os, sys, hashlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    venv_py = os.path.join(ROOT, '.venv', 'bin', 'python')
    if os.path.exists(venv_py) and os.environ.get('OGCARDS_REEXEC') != '1':
        os.environ['OGCARDS_REEXEC'] = '1'
        os.execv(venv_py, [venv_py, os.path.abspath(__file__)] + sys.argv[1:])
    print('gen_og_cards: Pillow unavailable (python3 -m venv .venv && '
          '.venv/bin/pip install pillow) — skipping share cards', file=sys.stderr)
    sys.exit(0)

src = open(os.path.join(ROOT, 'js', 'data.js')).read()
clubs = json.loads(re.search(r'export const CLUBS=(\[.*?\]);', src, re.S).group(1))
leagues = json.loads(re.search(r'export const LEAGUES=(\{.*?\});', src, re.S).group(1))

rated = [c for c in clubs if not c.get('h') and c.get('r') and c.get('id')]
by_sex = {}
for c in rated:
    by_sex.setdefault(c.get('x', 'm'), []).append(c)
for pool in by_sex.values():
    pool.sort(key=lambda c: -c['r'])
nat_rank = {c['id']: i + 1 for pool in by_sex.values() for i, c in enumerate(pool)}
lg_pools = {}
for c in rated:
    lg_pools.setdefault(c['g'], []).append(c)
for pool in lg_pools.values():
    pool.sort(key=lambda c: -c['r'])
lg_rank = {c['id']: i + 1 for pool in lg_pools.values() for i, c in enumerate(pool)}

BG, INK, DIM, ACCENT, GREEN = '#0C1512', '#E8EFEA', '#8FA598', '#C77F1E', '#7FD1A8'
W, H = 1200, 630
CREST_BOX = (100, 155, 420, 475)   # left column
TEXT_X, TEXT_R = 480, 1120

FONT_BOLD = next((p for p in (
    '/System/Library/Fonts/Supplemental/Arial Narrow Bold.ttf',
    '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
    '/System/Library/Fonts/Helvetica.ttc') if os.path.exists(p)), None)
FONT_REG = next((p for p in (
    '/System/Library/Fonts/Supplemental/Arial Narrow.ttf',
    '/System/Library/Fonts/Supplemental/Arial.ttf',
    '/System/Library/Fonts/Helvetica.ttc') if os.path.exists(p)), None)
font = lambda path, size: ImageFont.truetype(path, size) if path else ImageFont.load_default(size)

out_dir = os.path.join(ROOT, 'og')
os.makedirs(out_dir, exist_ok=True)
cache_path = os.path.join(out_dir, '.cards.json')
try:
    cache = json.load(open(cache_path))
except Exception:
    cache = {}


def crest_sig(c):
    p = os.path.join(ROOT, c.get('img') or '')
    if not c.get('img') or not os.path.exists(p):
        return 'none'
    st = os.stat(p)
    return f'{st.st_size}:{int(st.st_mtime)}'


def wrap(draw, text, fnt, width):
    words, lines, cur = text.split(), [], ''
    for w2 in words:
        t = (cur + ' ' + w2).strip()
        if draw.textlength(t, font=fnt) <= width or not cur:
            cur = t
        else:
            lines.append(cur); cur = w2
    if cur:
        lines.append(cur)
    return lines


def render(c):
    im = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, W, 8), fill=ACCENT)

    has_crest = False
    if c.get('img'):
        cp = os.path.join(ROOT, c['img'])
        if os.path.exists(cp):
            try:
                crest = Image.open(cp).convert('RGBA')
                bw, bh = CREST_BOX[2] - CREST_BOX[0], CREST_BOX[3] - CREST_BOX[1]
                # cap upscale at 3x — a 70px crest blown to 320 is mud
                sc = min(bw / crest.width, bh / crest.height, 3.0)
                crest = crest.resize((max(1, int(crest.width * sc)), max(1, int(crest.height * sc))), Image.LANCZOS)
                cx = CREST_BOX[0] + (bw - crest.width) // 2
                cy = CREST_BOX[1] + (bh - crest.height) // 2
                im.paste(crest, (cx, cy), crest)
                has_crest = True
            except Exception:
                pass

    # no crest → the text owns the whole card instead of orbiting a hole
    tx = TEXT_X if has_crest else 100
    tw = TEXT_R - tx

    lg = leagues.get(c['g'], {})
    lg_label = lg.get('label', c['g'].upper())
    loc = f"{c.get('ct', '')}, {c['st']}" if c.get('ct') else c.get('st', '')
    sexw = c.get('x') == 'w'

    # club name — autofit: biggest size that wraps to <= 3 tidy lines,
    # hard ellipsis past that (a handful of combined-college mouthfuls)
    name = c['n'].upper()
    for size in range(92, 39, -6):
        f = font(FONT_BOLD, size)
        lines = wrap(d, name, f, tw)
        if len(lines) <= (2 if size > 62 else 3):
            break
    if len(lines) > 3:
        lines = lines[:3]
        while lines[2] and d.textlength(lines[2] + '…', font=f) > tw:
            lines[2] = lines[2][:-1].rstrip()
        lines[2] += '…'
    block = int(size * 1.08) * len(lines)
    y = max(70, 240 - block // 2)
    for ln in lines:
        d.text((tx, y), ln, font=f, fill=INK)
        y += int(size * 1.08)

    sub = ' · '.join(x for x in (lg_label.upper(), loc.upper(), "WOMEN'S GAME" if sexw else "MEN'S GAME") if x)
    d.text((tx, y + 8), sub, font=font(FONT_REG, 34), fill=DIM)
    y += 8 + 52

    d.text((tx, y + 14), str(c['r']), font=font(FONT_BOLD, 84), fill=ACCENT)
    rx = tx + d.textlength(str(c['r']), font=font(FONT_BOLD, 84)) + 26
    d.text((rx, y + 30), f"#{lg_rank[c['id']]} {lg_label.upper()}", font=font(FONT_BOLD, 40), fill=INK)
    d.text((rx, y + 78), f"#{nat_rank[c['id']]} NATIONAL ({'W' if sexw else 'M'})",
           font=font(FONT_REG, 30), fill=DIM)

    d.text((100, 545), 'RANKED XI', font=font(FONT_BOLD, 40), fill=GREEN)
    d.text((100 + d.textlength('RANKED XI', font=font(FONT_BOLD, 40)) + 22, 552),
           'every club · one map · one table · rankedxi.com', font=font(FONT_REG, 30), fill=DIM)
    return im


made = skipped = 0
for c in rated:
    sig = hashlib.md5('|'.join([c['n'], c['g'], str(c['r']), str(lg_rank[c['id']]),
        str(nat_rank[c['id']]), c.get('ct', ''), c.get('st', ''), crest_sig(c), 'v2']).encode()).hexdigest()
    out = os.path.join(out_dir, f"{c['id']}.jpg")
    if cache.get(c['id']) == sig and os.path.exists(out):
        skipped += 1
        continue
    render(c).save(out, 'JPEG', quality=82, optimize=True)
    cache[c['id']] = sig
    made += 1

json.dump(cache, open(cache_path, 'w'))
print(f'og cards: {made} rendered, {skipped} unchanged, {len(rated)} total')
