#!/usr/bin/env python3
"""Send match-day push alerts to subscribers whose clubs play today.

Usage: .venv/bin/python3 scripts/push_alerts.py [--dry-run]

Run from the MAIN checkout, not a worktree — wrangler resolves its D1 binding
from wrangler.toml relative to the working directory (same rule as traffic.py),
and data/fixtures.json must be the freshly generated one.

Design decisions worth knowing:

· The sender lives HERE, not in a Pages Function. Web-push delivery needs the
  VAPID private key and a pile of ECDH/HKDF crypto; pywebpush does it
  correctly, a hand-rolled Worker implementation would do it wrongly, and
  Pages has no cron anyway. The key stays in ~/.config/rankxi/ and never
  touches the repo or Cloudflare.

· One notification per subscriber per day, a digest, not one per match.
  Anyone following three clubs in one metro would otherwise get three pings
  before breakfast, and iOS treats notification spam as a reason to surface
  the unsubscribe UI.

· "Today" is the subscriber-facing promise, computed in Pacific time because
  that is the timezone the run schedule (launchd, 09:00 PT) is anchored to.
  Fixtures carry UTC ISO starts; a 7 PM PT kickoff is already the next day in
  UTC, so matching on the UTC date would silently drop every West Coast
  evening game.

· A sent-log in ~/.config/rankxi/push_sent.json makes reruns safe: a second
  invocation the same day sends nothing new. The log is pruned as it goes.

· 404/410 from the push service means the subscription is dead (app removed,
  permission revoked). The row is deleted — that is the documented contract
  in migrations/0007_push.sql.
"""
import argparse
import datetime as dt
import hashlib
import json
import pathlib
import subprocess
import sys
import zoneinfo

REPO = pathlib.Path(__file__).resolve().parent.parent
CONF = pathlib.Path.home() / '.config' / 'rankxi'
VAPID_PEM = CONF / 'vapid_private.pem'
SENT_LOG = CONF / 'push_sent.json'
PT = zoneinfo.ZoneInfo('America/Los_Angeles')
CLAIMS = {'sub': 'mailto:hello@rankedxi.com'}
MAX_LIST = 3   # clubs named in the body before "and N more"


def q(sql):
    r = subprocess.run(
        ['npx', 'wrangler', 'd1', 'execute', 'rankxi-signups', '--remote',
         '--command', sql, '--json'],
        capture_output=True, text=True, cwd=REPO)
    if r.returncode != 0:
        sys.exit(f'query failed:\n{r.stderr[-800:]}')
    body = r.stdout[r.stdout.index('['):]
    return json.loads(body)[0]['results']


def todays_fixtures():
    fixtures = json.loads((REPO / 'data' / 'fixtures.json').read_text())
    today = dt.datetime.now(PT).date()
    out = []
    for f in fixtures:
        try:
            start = dt.datetime.fromisoformat(f['start'].replace('Z', '+00:00'))
        except (KeyError, ValueError):
            continue
        if start.astimezone(PT).date() == today:
            out.append({**f, '_start': start})
    return out


def message(matches):
    """One digest per subscriber. Kickoff times in the subscriber's own
    timezone are unknowable server-side, so times stay out of the body and
    the notification links to My XI where fixtures render in local time."""
    if len(matches) == 1:
        m = matches[0]
        return ('Match day', f"{m['t1']} vs {m['t2']} — today. Tap for kickoff time and form.")
    # count followed CLUBS, not matches — a derby between two followed sides
    # is one match but two of "your clubs", and the sentence says clubs
    names = []
    for m in matches:
        names.extend(n for n in (m.get('_mine') or []) if n not in names)
    listed = ', '.join(names[:MAX_LIST])
    more = len(names) - MAX_LIST
    tail = f' and {more} more' if more > 0 else ''
    return ('Match day', f'{len(names)} of your clubs play today: {listed}{tail}.')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true', help='print, send nothing, delete nothing')
    args = ap.parse_args()

    if not VAPID_PEM.exists():
        sys.exit(f'missing VAPID key: {VAPID_PEM}')

    fixtures = todays_fixtures()
    if not fixtures:
        print('no fixtures today — nothing to send')
        return
    print(f'{len(fixtures)} fixtures today')

    # apns:// rows belong to the native iOS app and need the APNs sender
    # (not built until the Apple developer account exists); pywebpush would
    # choke on them, so select web-push rows only.
    subs = q("SELECT id, endpoint, p256dh, auth, clubs FROM push_subs WHERE endpoint LIKE 'https://%'")
    if not subs:
        print('no subscribers')
        return

    today = dt.datetime.now(PT).date().isoformat()
    sent_log = {}
    try:
        sent_log = json.loads(SENT_LOG.read_text())
    except (OSError, ValueError):
        pass
    sent_log = {k: v for k, v in sent_log.items() if v == today}   # prune old days

    from pywebpush import webpush, WebPushException   # after the cheap exits

    sent = skipped = dead = 0
    for sub in subs:
        try:
            clubs = set(json.loads(sub['clubs']))
        except ValueError:
            clubs = set()
        matches = []
        for f in fixtures:
            mine = [f['t1'] if f.get('id1') in clubs else None,
                    f['t2'] if f.get('id2') in clubs else None]
            mine = [m for m in mine if m]
            if mine:
                matches.append({**f, '_mine': mine})
        if not matches:
            continue

        key = hashlib.sha256(sub['endpoint'].encode()).hexdigest()[:16]
        if sent_log.get(key) == today:
            skipped += 1
            continue

        title, body = message(matches)
        payload = json.dumps({'title': title, 'body': body,
                              'url': '/app#/myxi', 'tag': 'rxi-matchday'})
        if args.dry_run:
            print(f'  DRY sub#{sub["id"]}: {body}')
            sent += 1
            continue

        try:
            webpush(
                subscription_info={'endpoint': sub['endpoint'],
                                   'keys': {'p256dh': sub['p256dh'], 'auth': sub['auth']}},
                data=payload,
                vapid_private_key=str(VAPID_PEM),
                vapid_claims=dict(CLAIMS),   # pywebpush mutates the dict it is given
                ttl=12 * 3600,               # a match-day ping is stale by evening
            )
            sent += 1
            sent_log[key] = today
        except WebPushException as e:
            status = getattr(e.response, 'status_code', None)
            if status in (404, 410):
                q(f"DELETE FROM push_subs WHERE id = {int(sub['id'])}")
                dead += 1
            else:
                print(f'  send failed sub#{sub["id"]}: {status} {e}', file=sys.stderr)

    if not args.dry_run:
        try:
            CONF.mkdir(parents=True, exist_ok=True)
            SENT_LOG.write_text(json.dumps(sent_log))
        except OSError as e:
            print(f'  sent-log not saved: {e}', file=sys.stderr)

    print(f'sent {sent}, already-sent {skipped}, dead subscriptions reaped {dead}')


if __name__ == '__main__':
    main()
