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


def main():
    from collections import Counter
    stats = Counter()
    for path in sorted(glob.glob(os.path.join(ROOT, 'crests', '*.png'))):
        try:
            r = process(path)
        except Exception as e:
            r = 'error'
            print(f'  ERROR {os.path.basename(path)}: {e}', file=sys.stderr)
        stats[r] += 1
        if r == 'all-white':
            print(f'  all-white (review): {os.path.basename(path)}', file=sys.stderr)
    print(dict(stats), file=sys.stderr)


if __name__ == '__main__':
    main()
