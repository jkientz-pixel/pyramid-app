#!/usr/bin/env python3
"""Single owner of the cache-bust token.

Source files never carry a real token. They carry PLACEHOLDER, and deploy.sh
mints a fresh token at deploy time and stamps it into the *staged* tree only.
Nothing version-related is ever committed.

That is the whole point. When the token lived in the branch, every deploy
rewrote it across 4,400+ files and committed the churn, so master's token
advanced twice a day under the scheduled roster refresh and any branch open
for more than a few hours carried a token master had already shipped. CI had
to grow a guard (check_token_ahead.py) to catch the collision at merge time,
which turned a time-based race into a red build on PRs whose diffs were fine.
A token that is never committed cannot collide, cannot go stale, and cannot
be walked backwards by a merge — so the guard is gone too.

Minted tokens are UTC timestamps: strictly increasing, unique per second, and
still YYYYMMDD-prefixed so index.html's footer can slice a date out of them.

  --placeholder      print the placeholder that source files carry
  --mint             print a fresh token
  --stamp DIR TOKEN  replace the placeholder with TOKEN across DIR
  --check [PATHS]    fail if any path carries a literal token
"""
import sys, os, re, datetime, pathlib

PLACEHOLDER = '__RXIV__'

# the shape deploy.sh used to commit: YYYYMMDD + a serial letter. Nothing may
# ship carrying one of these again — a literal token in source is exactly the
# frozen-asset bug the placeholder exists to prevent, because /js/* and /css/*
# are served immutable for a year.
LEGACY_TOKEN = re.compile(r'2026\d{4}[a-z]')

# text that actually carries the token: page markup and the js modules that
# import other modules with a ?v=. Data JSON and binary assets never do.
STAMPABLE = ('.html', '.js')


def mint():
    return datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d%H%M%S')


def _walk(root):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d != '.git']
        for fn in filenames:
            if fn.endswith(STAMPABLE):
                yield pathlib.Path(dirpath) / fn


def stamp(root, token):
    if not LEGACY_TOKEN.fullmatch(token) and not re.fullmatch(r'\d{14}', token):
        sys.exit(f'FATAL: refusing to stamp malformed token {token!r}')
    files = hits = 0
    for p in _walk(root):
        t = p.read_text(encoding='utf-8', errors='surrogateescape')
        if PLACEHOLDER not in t:
            continue
        p.write_text(t.replace(PLACEHOLDER, token), encoding='utf-8',
                     errors='surrogateescape')
        files += 1
        hits += t.count(PLACEHOLDER)
    if not files:
        sys.exit(f'FATAL: no {PLACEHOLDER} found under {root} — nothing would be '
                 f'cache-busted, so returning browsers would keep the last build')
    print(f'  stamped v{token} into {hits} spot(s) across {files} file(s)')


def check(paths):
    bad = []
    for path in paths:
        p = pathlib.Path(path)
        for f in ([p] if p.is_file() else _walk(p)):
            found = set(LEGACY_TOKEN.findall(
                f.read_text(encoding='utf-8', errors='surrogateescape')))
            if found:
                bad.append(f'{f}: literal token {sorted(found)}')
    return bad


if __name__ == '__main__':
    a = sys.argv[1:]
    if a[:1] == ['--placeholder']:
        print(PLACEHOLDER)
    elif a[:1] == ['--mint']:
        print(mint())
    elif a[:1] == ['--stamp']:
        stamp(a[1], a[2])
    elif a[:1] == ['--check']:
        bad = check(a[1:] or ['.'])
        for b in bad:
            print(b, file=sys.stderr)
        sys.exit(1 if bad else 0)
    else:
        sys.exit(__doc__)
