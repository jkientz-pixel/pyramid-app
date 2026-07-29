#!/usr/bin/env python3
"""Remove baked-in white/near-white backgrounds from crest PNGs so logos float
on the map instead of sitting in white boxes.

Flood-fills from the image border: only near-white pixels CONNECTED to the
edge become transparent, so white elements inside a shield survive. Images
that already use their alpha channel meaningfully (>2% transparent pixels)
are left untouched. Idempotent; rerunnable after every crest sweep.

Needs Pillow+numpy (not in the system python): run via a venv interpreter,
e.g.  $VENV/bin/python scripts/strip_crest_bg.py [--threshold 242]
"""
import os, sys, glob
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
THRESHOLD = int(sys.argv[sys.argv.index('--threshold') + 1]) if '--threshold' in sys.argv else 242


def edge_connected_white(mask):
    """BFS flood fill of True cells reachable from any border cell."""
    h, w = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    stack = [(y, x) for x in range(w) for y in (0, h - 1) if mask[y, x]]
    stack += [(y, x) for y in range(h) for x in (0, w - 1) if mask[y, x]]
    for y, x in stack:
        seen[y, x] = True
    while stack:
        y, x = stack.pop()
        for ny, nx in ((y-1, x), (y+1, x), (y, x-1), (y, x+1)):
            if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                stack.append((ny, nx))
    return seen


def process(path):
    im = Image.open(path).convert('RGBA')
    a = np.asarray(im).copy()
    alpha = a[..., 3]
    if (alpha < 250).mean() > 0.02:
        return 'has-alpha'
    rgb = a[..., :3].astype(int)
    near_white = (rgb.min(axis=2) >= THRESHOLD)
    bg = edge_connected_white(near_white)
    frac = bg.mean()
    if frac < 0.01:
        return 'no-white-edge'
    if frac > 0.98:
        return 'all-white'  # blank/broken file — leave for manual review
    a[..., 3] = np.where(bg, 0, alpha)
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
