#!/usr/bin/env python3
"""Coordinate fingerprint: proof-of-copying for the published club dataset.

Club pins are stored to 3-4 decimals. At deploy time the STAGED js/data.js (never
the repo copy) gets two extra digits on every coordinate, at the 5th and 6th
decimal, derived from HMAC(secret key, club id). That moves a pin by at most
~15 m (11 m per axis; 14.2 m worst case measured on the 2026-09-18 data), below the precision of the pins themselves, and nobody without the key
can tell a marked digit pair from noise or reproduce it. If the dataset turns up
somewhere else, `--check` counts how many of those exact values it contains.

What this does NOT do: stop anyone copying, survive a copier who rounds to four
decimals, or mark the static club pages (they publish no coordinates).

This repo is public, so the key lives outside it: env RXI_FINGERPRINT_KEY (CI)
or ~/.config/rankxi/fingerprint-key (local).
"""
import hashlib
import hmac
import json
import os
import pathlib
import re
import sys
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import _datajs  # noqa: E402

MICRO = 1_000_000        # work in whole micro-degrees; floats never see arithmetic
KEPT = 100               # micro-degrees below this are the two digits we own
MARK_VALUES = 99         # marks run 01-99; 00 would be indistinguishable from unmarked


def _digits(club_id, axis, key):
    mac = hmac.new(key.encode(), f'{club_id}|{axis}'.encode(), hashlib.sha256).digest()
    return int.from_bytes(mac[:4], 'big') % MARK_VALUES + 1


def _mark_axis(value, club_id, axis, key):
    micro = round(abs(value) * MICRO)
    marked = micro // KEPT * KEPT + _digits(club_id, axis, key)
    return (-1 if value < 0 else 1) * marked / MICRO


def mark(club_id, la, lo, key):
    """(la, lo) with the key's two digits in the 5th-6th decimal of each."""
    return _mark_axis(la, club_id, 'la', key), _mark_axis(lo, club_id, 'lo', key)


def _has_pin(club):
    return all(isinstance(club.get(k), (int, float)) and not isinstance(club.get(k), bool)
               for k in ('la', 'lo'))


def mark_clubs(clubs, key):
    """New club list with every pinned club marked; unpinned clubs pass through."""
    def marked(club):
        if not (_has_pin(club) and club.get('id')):
            return club
        la, lo = mark(club['id'], club['la'], club['lo'], key)
        return {**club, 'la': la, 'lo': lo}
    return [marked(c) for c in clubs]


def mark_datajs(src, key):
    """data.js source text with its CLUBS array marked and nothing else touched.
    Serialised exactly as _datajs.write_clubs does, so the only byte-level
    difference from the repo copy is the coordinate digits."""
    clubs = mark_clubs(_datajs.load_clubs(src), key)
    body = 'export const CLUBS=' + json.dumps(clubs, ensure_ascii=False, separators=(',', ':')) + ';'
    out, n = _datajs.CLUBS_RE.subn(lambda m: body, src, count=1)
    if n != 1:
        sys.exit(f'FATAL: expected 1 CLUBS marker, matched {n}; nothing marked')
    return out


MIN_MARK_DECIMALS = 5    # a marked value has 5-6 decimals (a trailing 0 is dropped)
_NUMBER_RE = re.compile(r'-?\d{1,3}\.\d{%d,}' % MIN_MARK_DECIMALS)


def check(text, clubs, key):
    """How many pinned clubs' exact marked (la, lo) pairs appear anywhere in `text`.

    Format-agnostic on purpose: a copy may arrive as JSON, CSV or scraped HTML,
    so this reads every decimal number out of the text rather than parsing it.
    Unmarked coordinates carry at most four decimals and can never match; a
    stranger's 6-decimal coordinate matches one club's pair by chance about once
    in 10,000 x 10,000.
    """
    seen = {round(float(n) * MICRO) for n in _NUMBER_RE.findall(text)}
    pinned = [c for c in clubs if _has_pin(c) and c.get('id')]
    matched = [c['id'] for c in pinned
               if all(round(v * MICRO) in seen for v in mark(c['id'], c['la'], c['lo'], key))]
    return {'pinned': len(pinned), 'matched': len(matched), 'matched_ids': matched}


KEY_ENV = 'RXI_FINGERPRINT_KEY'
KEY_FILE = pathlib.Path.home() / '.config' / 'rankxi' / 'fingerprint-key'


def load_key():
    """The secret, or None. Env wins so CI can inject it; never read from the repo."""
    key = os.environ.get(KEY_ENV, '').strip()
    if not key and KEY_FILE.exists():
        key = KEY_FILE.read_text().strip()
    return key or None


def mark_stage(stage_dir, key):
    """Mark <stage_dir>/js/data.js in place. False (file untouched) when there is
    no key: an unmarked deploy is a lost watermark, a blocked deploy is an outage."""
    if not key:
        return False
    staged = pathlib.Path(stage_dir) / 'js' / 'data.js'
    staged.write_text(mark_datajs(staged.read_text(), key))
    return True


def _read(source):
    if source.startswith(('http://', 'https://')):
        req = urllib.request.Request(source, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.read().decode('utf-8', 'replace')
    return pathlib.Path(source).read_text(errors='replace')


def main(argv):
    if len(argv) == 3 and argv[1] == '--stage':
        if mark_stage(argv[2], load_key()):
            print(f'fingerprint: marked {argv[2]}/js/data.js')
        else:
            print(f'WARNING fingerprint: no key in ${KEY_ENV} or {KEY_FILE}; '
                  'shipping UNMARKED coordinates', file=sys.stderr)
        return 0
    if len(argv) == 3 and argv[1] == '--check':
        key = load_key()
        if not key:
            sys.exit(f'FATAL: no key in ${KEY_ENV} or {KEY_FILE}; cannot check')
        report = check(_read(argv[2]), _datajs.load_clubs(), key)
        print(f'{report["matched"]} of {report["pinned"]} pinned clubs carry our mark in {argv[2]}')
        return 0
    sys.exit('usage: fingerprint.py --stage <dir> | --check <file-or-url>')


if __name__ == '__main__':
    sys.exit(main(sys.argv))
