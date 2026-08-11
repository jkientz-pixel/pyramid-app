#!/usr/bin/env python3
"""Remove baked-in white/near-white backgrounds from crest PNGs so logos float
on the map instead of sitting in white boxes.

v2 — the first pass only flood-filled from the image border, which missed the
common wayback/wp-content shape: an opaque white matte box sitting INSIDE
transparent padding (the border flood never reaches it across the alpha gap).
Now near-white components are cleared when they either touch the image border
or sit adjacent to transparency while their bounding box spans >=50% of the
image (a matte box), with a one-step 225-threshold halo cleanup around cleared
regions. Small interior whites (shield fills, outline rings, lettering) are
never touched. Idempotent; rerun after every crest sweep.

v3 — colored mattes (`--mattes`): navy/black/grey boxes the white pass never
touches. The matte color is sampled from the four corners (must be opaque and
agree within a small tolerance), then border-connected components of
near-matte pixels are cleared. Guards keep legit full-bleed rectangle logos
intact: the clear must cover >=50% of the opaque border ring, remove >=12% of
the frame, and leave >=6% of the frame opaque — otherwise the file is kept
unchanged and reported for manual review. Same one-step halo cleanup, keyed
to the matte color instead of white.

IMPORTANT: crest URLs are cached immutable and cache-first (sw.js ASSETS).
After any run that changes files, bump CRESTV in js/app.js or returning
browsers keep the old pixels forever.

Needs Pillow+numpy (not in the system python): run via a venv interpreter,
e.g.  $VENV/bin/python scripts/strip_crest_bg.py [--threshold 238]
"""
import os, sys, glob
from collections import deque
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
THRESHOLD = int(sys.argv[sys.argv.index('--threshold') + 1]) if '--threshold' in sys.argv else 238
HALO_THRESHOLD = 225
MATTE_BBOX_FRAC = 0.50


def components(mask):
    """4-connected components of a bool array -> list of (pixel_index_arrays)."""
    h, w = mask.shape
    labels = np.full((h, w), -1, dtype=int)
    comps = []
    for sy in range(h):
        for sx in range(w):
            if not mask[sy, sx] or labels[sy, sx] != -1:
                continue
            idx = len(comps)
            q = deque([(sy, sx)])
            labels[sy, sx] = idx
            pts = []
            while q:
                y, x = q.popleft()
                pts.append((y, x))
                for ny, nx in ((y-1, x), (y+1, x), (y, x-1), (y, x+1)):
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and labels[ny, nx] == -1:
                        labels[ny, nx] = idx
                        q.append((ny, nx))
            comps.append(np.array(pts))
    return comps


def process(path):
    im = Image.open(path).convert('RGBA')
    a = np.asarray(im).copy()
    h, w = a.shape[:2]
    alpha = a[..., 3]
    outside = alpha < 10
    rgb = a[..., :3].astype(int)
    near_white = (rgb.min(axis=2) >= THRESHOLD) & ~outside
    if not near_white.any():
        return 'no-white'
    # pad outside by one step to test adjacency
    adj_outside = np.zeros_like(outside)
    adj_outside[:-1] |= outside[1:]; adj_outside[1:] |= outside[:-1]
    adj_outside[:, :-1] |= outside[:, 1:]; adj_outside[:, 1:] |= outside[:, :-1]
    clear = np.zeros_like(near_white)
    for pts in components(near_white):
        ys, xs = pts[:, 0], pts[:, 1]
        touches_border = ys.min() == 0 or xs.min() == 0 or ys.max() == h-1 or xs.max() == w-1
        bbox_frac = ((ys.max()-ys.min()+1) * (xs.max()-xs.min()+1)) / (h * w)
        matte = adj_outside[ys, xs].any() and bbox_frac >= MATTE_BBOX_FRAC
        if touches_border or matte:
            clear[ys, xs] = True
    if not clear.any():
        return 'kept'
    if clear.mean() > 0.98:
        return 'all-white'  # blank/broken file — leave for manual review
    # one-step halo cleanup: slightly-off-white pixels bordering a cleared region
    halo = (rgb.min(axis=2) >= HALO_THRESHOLD) & ~outside & ~clear
    edge = np.zeros_like(clear)
    edge[:-1] |= clear[1:]; edge[1:] |= clear[:-1]
    edge[:, :-1] |= clear[:, 1:]; edge[:, 1:] |= clear[:, :-1]
    clear |= (halo & edge)
    a[..., 3] = np.where(clear, 0, alpha)
    Image.fromarray(a).save(path, optimize=True)
    return 'stripped'


MATTE_TOL = 34          # per-channel distance from the corner color
MATTE_HALO_TOL = 60     # looser tolerance for the one-step halo cleanup
MATTE_MIN_CLEARED = 0.12
MATTE_MIN_REMAIN = 0.06
MATTE_MIN_BORDER = 0.50
CORNER_STD_MAX = 12


def process_matte(path):
    im = Image.open(path).convert('RGBA')
    a = np.asarray(im).copy()
    h, w = a.shape[:2]
    if h < 8 or w < 8:
        return 'tiny'
    alpha = a[..., 3]
    rgb = a[..., :3].astype(int)
    corners = np.array([a[0, 0], a[0, -1], a[-1, 0], a[-1, -1]], dtype=int)
    if (corners[:, 3] < 200).any():
        return 'floats'          # transparent corner: nothing boxed here
    crgb = corners[:, :3]
    if crgb.std(axis=0).max() > CORNER_STD_MAX:
        return 'no-matte'        # corners disagree: not a uniform backdrop
    matte = crgb.mean(axis=0)
    if matte.min() >= THRESHOLD:
        return 'white'           # the white pass owns near-white mattes
    near = (np.abs(rgb - matte).max(axis=2) <= MATTE_TOL) & (alpha >= 200)
    clear = np.zeros_like(near)
    for pts in components(near):
        ys, xs = pts[:, 0], pts[:, 1]
        if ys.min() == 0 or xs.min() == 0 or ys.max() == h - 1 or xs.max() == w - 1:
            clear[ys, xs] = True
    if not clear.any():
        return 'kept'
    border = np.zeros((h, w), dtype=bool)
    border[0] = border[-1] = True
    border[:, 0] = border[:, -1] = True
    opaque_border = border & (alpha >= 200)
    remain = (alpha >= 200) & ~clear
    if (clear[opaque_border].mean() < MATTE_MIN_BORDER
            or clear.mean() < MATTE_MIN_CLEARED
            or remain.mean() < MATTE_MIN_REMAIN):
        return 'kept-guard'      # full-bleed artwork or broken file — hands off
    # one-step halo: near-matte fringe pixels bordering a cleared region
    halo = (np.abs(rgb - matte).max(axis=2) <= MATTE_HALO_TOL) & (alpha >= 200) & ~clear
    edge = np.zeros_like(clear)
    edge[:-1] |= clear[1:]; edge[1:] |= clear[:-1]
    edge[:, :-1] |= clear[:, 1:]; edge[:, 1:] |= clear[:, :-1]
    clear |= (halo & edge)
    a[..., 3] = np.where(clear, 0, alpha)
    Image.fromarray(a).save(path, optimize=True)
    return 'stripped'


def main():
    from collections import Counter
    matte_mode = '--mattes' in sys.argv
    stats = Counter()
    for path in sorted(glob.glob(os.path.join(ROOT, 'crests', '*.png'))):
        if os.path.basename(path).startswith('brand-'):
            continue             # UI assets, not club crests
        try:
            r = process_matte(path) if matte_mode else process(path)
        except Exception as e:
            r = 'error'
            print(f'  ERROR {os.path.basename(path)}: {e}', file=sys.stderr)
        stats[r] += 1
        if r in ('all-white', 'kept-guard'):
            print(f'  {r} (review): {os.path.basename(path)}', file=sys.stderr)
    print(dict(stats), file=sys.stderr)


if __name__ == '__main__':
    main()
