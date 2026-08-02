#!/usr/bin/env python3
"""Generate a simplified Canada silhouette for the club map.

Decodes Natural Earth 50m countries topojson (world-atlas@2), projects
Canada through the same conic constants the app uses (PROJ in js/usmap.js),
keeps only rings near the viewport, simplifies them, and injects the result
into js/usmap.js as a <g class="canada"> group drawn beneath the states.

The --provinces mode reads Natural Earth 50m admin1 geojson
(ne_50m_admin_1_states_provinces_lakes.geojson), finds the boundary
segments shared by exactly two Canadian provinces (drawing each province
polygon separately would double-stroke and sliver the shared borders),
chains them into polylines, and injects them as a stroke-only
<path class="prov"> inside the canada group.

Usage:
  python3 scripts/gen_canada_map.py path/to/countries-50m.json
  python3 scripts/gen_canada_map.py --provinces path/to/ne_50m_admin_1_states_provinces_lakes.geojson
"""
import json
import math
import re
import sys
from collections import defaultdict

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


def geo_rings(geom):
    if geom['type'] == 'Polygon':
        yield from geom['coordinates']
    elif geom['type'] == 'MultiPolygon':
        for poly in geom['coordinates']:
            yield from poly


def internal_borders(feats):
    """Segments (as lon/lat point pairs) that two provinces share."""
    count = defaultdict(int)
    for f in feats:
        for ring in geo_rings(f['geometry']):
            for a, b in zip(ring, ring[1:]):
                pa, pb = (round(a[0], 6), round(a[1], 6)), (round(b[0], 6), round(b[1], 6))
                if pa != pb:
                    count[(pa, pb) if pa < pb else (pb, pa)] += 1
    return [seg for seg, n in count.items() if n >= 2]


def chain(segs):
    """Join undirected segments into maximal polylines."""
    adj = defaultdict(list)
    for i, (a, b) in enumerate(segs):
        adj[a].append((b, i))
        adj[b].append((a, i))
    used, lines = set(), []

    def walk(start):
        for nxt, i in adj[start]:
            if i in used:
                continue
            used.add(i)
            line, prev, cur = [start, nxt], start, nxt
            while len(adj[cur]) == 2:
                (n1, i1), (n2, i2) = adj[cur]
                nxt2, j = (n2, i2) if i1 in used else (n1, i1)
                if j in used:
                    break
                used.add(j)
                line.append(nxt2)
                prev, cur = cur, nxt2
            lines.append(line)

    # branch/end nodes first so chains span junction to junction, then cycles
    for node in adj:
        if len(adj[node]) != 2:
            walk(node)
    for node in adj:
        walk(node)
    return lines


def provinces(admin1_path):
    proj, src = load_proj()
    feats = [f for f in json.load(open(admin1_path))['features']
             if f['properties'].get('admin') == 'Canada']
    if not feats:
        sys.exit('FATAL: no Canada features in ' + admin1_path)
    parts = []
    kept = dropped = 0
    for line in chain(internal_borders(feats)):
        pts = [project(proj, lon, lat) for lon, lat in line]
        if not any(WINDOW_X[0] < x < WINDOW_X[1] and y > WINDOW_Y_MIN
                   for x, y in pts):
            dropped += 1
            continue
        out, last = [], None
        for x, y in simplify(pts, SIMPLIFY_TOL):
            p = (round(x, 1), round(y, 1))
            if p != last:
                out.append(p)
                last = p
        if len(out) >= 2:
            kept += 1
            parts.append('M' + ' '.join(f'{x} {y}' for x, y in out))
    path = '<path class="prov" d="' + ''.join(parts) + '"></path>'
    if 'class="prov"' in src:
        src = re.sub(r'<path class="prov" d="[^"]*"></path>', path, src, count=1)
    else:
        m = re.search(r'<g class="canada">.*?(?=</g>)', src, re.S)
        if not m:
            sys.exit('FATAL: no <g class="canada"> in ' + USMAP_JS +
                     ' — generate the silhouette first')
        src = src[:m.end()] + path + src[m.end():]
    open(USMAP_JS, 'w').write(src)
    print(f'border chains kept {kept}, dropped {dropped}, path bytes {len(path)}')


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
    if sys.argv[1] == '--provinces':
        provinces(sys.argv[2])
    else:
        main(sys.argv[1])
