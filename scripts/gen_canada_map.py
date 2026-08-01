#!/usr/bin/env python3
"""Generate a simplified Canada silhouette for the club map.

Decodes Natural Earth 50m countries topojson (world-atlas@2), projects
Canada through the same conic constants the app uses (PROJ in js/usmap.js),
keeps only rings near the viewport, simplifies them, and injects the result
into js/usmap.js as a <g class="canada"> group drawn beneath the states.

Usage: python3 scripts/gen_canada_map.py path/to/countries-50m.json
"""
import json
import math
import re
import sys

USMAP_JS = 'js/usmap.js'
# rings whose projected points all fall outside this window are dropped
WINDOW_X = (-120, 1120)
WINDOW_Y_MIN = -170
SIMPLIFY_TOL = 0.7   # map units; US state paths are drawn at ~1-unit detail
MIN_RING_SPAN = 6.0  # drop islets smaller than this after projection


def load_proj():
    src = open(USMAP_JS).read()
    m = re.search(r'PROJ=\{([^}]+)\}', src)
    return dict(kv.split(':') for kv in m.group(1).split(',')), src


def project(proj, lon, lat):
    n, C, r0, l0 = (float(proj[k]) for k in ('n', 'C', 'r0', 'l0'))
    minx, maxy, s, ox, oy = (float(proj[k]) for k in ('minx', 'maxy', 's', 'ox', 'oy'))
    f, l = math.radians(lat), math.radians(lon)
    rho = math.sqrt(C - 2 * n * math.sin(f)) / n
    th = n * (l - l0)
    return ((rho * math.sin(th) - minx) * s + ox,
            (maxy - (r0 - rho * math.cos(th))) * s + oy)


def decode_arcs(topo):
    sx, sy = topo['transform']['scale']
    tx, ty = topo['transform']['translate']
    arcs = []
    for arc in topo['arcs']:
        pts, x, y = [], 0, 0
        for dx, dy in arc:
            x += dx
            y += dy
            pts.append((x * sx + tx, y * sy + ty))
        arcs.append(pts)
    return arcs


def ring_coords(ring, arcs):
    pts = []
    for idx in ring:
        seg = arcs[idx] if idx >= 0 else arcs[~idx][::-1]
        pts.extend(seg if not pts else seg[1:])
    return pts


def simplify(pts, tol):
    """Iterative Douglas-Peucker."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = pts[a]
        bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        norm = math.hypot(dx, dy)
        best, besti = 0.0, -1
        for i in range(a + 1, b):
            # closed rings start and end on the same point: with a zero-length
            # baseline, fall back to distance from the anchor so the farthest
            # point survives and recursion can proceed
            d = (abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / norm
                 if norm > 1e-9 else math.hypot(pts[i][0] - ax, pts[i][1] - ay))
            if d > best:
                best, besti = d, i
        if best > tol:
            keep[besti] = True
            stack.extend([(a, besti), (besti, b)])
    return [p for p, k in zip(pts, keep) if k]


def main(topo_path):
    proj, src = load_proj()
    topo = json.load(open(topo_path))
    arcs = decode_arcs(topo)
    canada = next(g for g in topo['objects']['countries']['geometries']
                  if g.get('properties', {}).get('name') == 'Canada')
    polys = canada['arcs'] if canada['type'] == 'MultiPolygon' else [canada['arcs']]
    parts = []
    kept = dropped = 0
    for poly in polys:
        for ring in poly:
            pts = [project(proj, lon, lat) for lon, lat in ring_coords(ring, arcs)]
            xs, ys = [p[0] for p in pts], [p[1] for p in pts]
            near = any(WINDOW_X[0] < x < WINDOW_X[1] and y > WINDOW_Y_MIN
                       for x, y in pts)
            if not near or (max(xs) - min(xs) < MIN_RING_SPAN and
                            max(ys) - min(ys) < MIN_RING_SPAN):
                dropped += 1
                continue
            sim = simplify(pts, SIMPLIFY_TOL)
            # rounding to 1 decimal matches the state paths; drop collapsed points
            out, last = [], None
            for x, y in sim:
                p = (round(x, 1), round(y, 1))
                if p != last:
                    out.append(p)
                    last = p
            if len(out) >= 3:
                kept += 1
                parts.append('M' + ' '.join(f'{x} {y}' for x, y in out) + ' Z')
    group = '<g class="canada"><path d="' + ''.join(parts) + '"></path></g>'
    if '<g class="canada">' in src:
        src = re.sub(r'<g class="canada">.*?</g>', group, src, count=1, flags=re.S)
    else:
        src = src.replace('USMAP=`', 'USMAP=`' + group, 1)
    open(USMAP_JS, 'w').write(src)
    print(f'rings kept {kept}, dropped {dropped}, path bytes {len(group)}')


if __name__ == '__main__':
    main(sys.argv[1])
