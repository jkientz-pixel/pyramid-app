#!/usr/bin/env python3
"""Hand review for club claims and club profile submissions (migrations/0009).

Nothing in the claim flow publishes on its own. This is the human half:

  review_claims.py                       # open claims + unapplied submissions
  review_claims.py approve <claim_id>    # verify a pending claim (opens the form for them)
  review_claims.py reject  <claim_id>
  review_claims.py show    <submission_id>          # every field, no crest bytes
  review_claims.py export  <submission_id> [--all]  # crest -> crests/incoming/, payload -> data/club_submissions/
  review_claims.py applied <submission_id>          # mark folded into data

Run from the MAIN checkout, not a worktree (wrangler + D1 memory). Talks to
the remote database through `wrangler d1 execute --json`, same as every other
review script here.

Approving emails the claimant that the form is open when RESEND_API_KEY is in
the environment; otherwise it prints the address so you can send the note by
hand. The app told them "we'll email you", so one of the two has to happen.

Exporting writes the crest exactly as uploaded — PNG/SVG/JPEG, full size —
which is the whole point: a folder of clean, large, club-supplied logos.
Folding the rest into CLUBS (url, cap, socials, city/state, surface, venue)
stays a deliberate edit: `show` prints the fields next to what the record
carries today so the diff is obvious, and the append-only invariant on CLUBS
holds because nothing here writes js/data.js.
"""
import base64
import json
import os
import re
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB = 'rankxi-signups'
WRANGLER = ['npx', '-y', 'wrangler@4.114.0', 'd1', 'execute', DB, '--remote', '--json']
CREST_DIR = ROOT / 'crests' / 'incoming'
PAYLOAD_DIR = ROOT / 'data' / 'club_submissions'
EXT = {'image/png': 'png', 'image/svg+xml': 'svg', 'image/jpeg': 'jpg'}


def q(sql):
    out = subprocess.run(WRANGLER + ['--command', sql], capture_output=True, text=True)
    if out.returncode:
        sys.exit(out.stderr.strip() or out.stdout.strip() or 'wrangler failed')
    # wrangler prints a banner before the JSON; take the last JSON array
    m = re.search(r'\[\s*\{.*\}\s*\]\s*$', out.stdout, re.S)
    if not m:
        sys.exit('unexpected wrangler output:\n' + out.stdout[-800:])
    res = json.loads(m.group(0))
    return res[0].get('results', [])


def lit(v):
    return 'NULL' if v is None else "'" + str(v).replace("'", "''") + "'"


def now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def clubs_by_id():
    text = (ROOT / 'js' / 'data.js').read_text()
    m = re.search(r'export const CLUBS=(\[.*?\]);', text, re.S)
    return {c['id']: c for c in json.loads(m.group(1)) if c.get('id')}


# ---- commands ---------------------------------------------------------------

def cmd_list():
    claims = q("SELECT id, ts, club_id, club_name, email, domain_match, status, rep_name, rep_role, note "
               "FROM club_claims WHERE status='pending' ORDER BY ts")
    print(f'\n== {len(claims)} pending claim(s) ==')
    for c in claims:
        print(f"  #{c['id']:<4} {c['ts'][:10]}  {c['club_name']} ({c['club_id']})")
        print(f"        {c['rep_name']} · {c['rep_role']} · {c['email']}  domain_match={c['domain_match']}")
        if c.get('note'):
            print(f"        note: {c['note']}")
    verified = q("SELECT COUNT(*) AS n FROM club_claims WHERE status='verified'")[0]['n']
    subs = q("SELECT s.id, s.ts, s.club_id, s.logo_mime, s.logo_w, s.logo_h, s.logo_bytes, c.email "
             "FROM club_submissions s JOIN club_claims c ON c.id = s.claim_id "
             "WHERE s.applied=0 ORDER BY s.ts")
    print(f'\n== {len(subs)} submission(s) waiting to be applied  ({verified} verified claims total) ==')
    for s in subs:
        dim = f"{s['logo_w']}x{s['logo_h']}" if s.get('logo_w') else 'vector'
        print(f"  #{s['id']:<4} {s['ts'][:10]}  {s['club_id']}  crest {s['logo_mime']} {dim} {round((s['logo_bytes'] or 0)/1024)}KB  from {s['email']}")
    print('\napprove/reject <claim_id> · show/export/applied <submission_id>\n')


def notify(email, club_name, club_id):
    key = os.environ.get('RESEND_API_KEY')
    link = f'https://www.rankedxi.com/app#/claim/{club_id}'
    subject = f'Your Ranked XI claim for {club_name} is verified'
    text = (f'Your claim for {club_name} on Ranked XI has been verified.\n\n'
            f'The club form is open now: {link}\n\n'
            f'Upload the clean, full-size crest and fill in the ground, surface, capacity and links. '
            f'A person reviews what you send before the page changes.\n')
    if not key:
        print(f'  RESEND_API_KEY not set — email {email} by hand:\n  Subject: {subject}\n{text}')
        return
    req = urllib.request.Request('https://api.resend.com/emails', method='POST',
        data=json.dumps({'from': os.environ.get('MAIL_FROM', 'Ranked XI <no-reply@rankedxi.com>'),
                         'to': [email], 'subject': subject, 'text': text}).encode(),
        headers={'authorization': f'Bearer {key}', 'content-type': 'application/json'})
    with urllib.request.urlopen(req) as r:
        print(f'  emailed {email} ({r.status})')


def cmd_status(claim_id, status):
    rows = q(f"SELECT club_id, club_name, email, status FROM club_claims WHERE id={int(claim_id)}")
    if not rows:
        sys.exit(f'no claim #{claim_id}')
    c = rows[0]
    q(f"UPDATE club_claims SET status={lit(status)}, reviewed_ts={lit(now())} WHERE id={int(claim_id)}")
    print(f"  claim #{claim_id} {c['club_name']}: {c['status']} -> {status}")
    if status == 'verified':
        notify(c['email'], c['club_name'], c['club_id'])


def fetch_sub(sub_id, with_logo=False):
    cols = 'id, ts, claim_id, club_id, user_id, payload, logo_mime, logo_name, logo_bytes, logo_w, logo_h, applied'
    if with_logo:
        cols += ', logo_b64'
    rows = q(f"SELECT {cols} FROM club_submissions WHERE id={int(sub_id)}")
    if not rows:
        sys.exit(f'no submission #{sub_id}')
    return rows[0]


def cmd_show(sub_id):
    s = fetch_sub(sub_id)
    club = clubs_by_id().get(s['club_id'], {})
    payload = json.loads(s['payload'])
    print(f"\n#{s['id']}  {s['club_id']}  {s['ts']}  applied={s['applied']}")
    dim = f"{s['logo_w']}x{s['logo_h']}" if s.get('logo_w') else 'vector'
    print(f"crest: {s['logo_mime']} {dim} {round((s['logo_bytes'] or 0)/1024)}KB  ({s['logo_name']})  current img: {club.get('img')}")
    # what the live record carries today, for the fields that map straight across
    live = {'website': club.get('url'), 'capacity': club.get('cap'), 'venueCity': club.get('ct'),
            'venueState': club.get('st'), 'instagram': club.get('si'), 'x': club.get('sx'), 'facebook': club.get('sf')}
    print(f"{'field':<16} {'submitted':<50} live")
    for k, v in payload.items():
        cur = live.get(k)
        flag = '' if cur is None else ('  =' if str(cur) == str(v) else f'  was: {cur}')
        print(f'{k:<16} {str(v)[:50]:<50}{flag}')
    print()


def export_one(s):
    CREST_DIR.mkdir(parents=True, exist_ok=True)
    PAYLOAD_DIR.mkdir(parents=True, exist_ok=True)
    ext = EXT.get(s['logo_mime'], 'bin')
    crest = CREST_DIR / f"{s['club_id']}.{ext}"
    crest.write_bytes(base64.b64decode(s['logo_b64']))
    meta = {k: s[k] for k in ('id', 'ts', 'club_id', 'claim_id', 'logo_mime', 'logo_name', 'logo_bytes', 'logo_w', 'logo_h')}
    meta['payload'] = json.loads(s['payload'])
    meta['crest_file'] = str(crest.relative_to(ROOT))
    out = PAYLOAD_DIR / f"{s['club_id']}-{s['id']}.json"
    out.write_text(json.dumps(meta, indent=2, ensure_ascii=False) + '\n')
    print(f"  #{s['id']} {s['club_id']}: {crest.relative_to(ROOT)} ({round(len(s['logo_b64'])*3/4/1024)}KB) + {out.relative_to(ROOT)}")


def cmd_export(arg):
    if arg == '--all':
        ids = [r['id'] for r in q("SELECT id FROM club_submissions WHERE applied=0 ORDER BY ts")]
    else:
        ids = [int(arg)]
    for i in ids:
        export_one(fetch_sub(i, with_logo=True))
    print('crests land in crests/incoming/ — review by eye, then move into crests/ and bump CRESTV.')


def cmd_applied(sub_id):
    q(f"UPDATE club_submissions SET applied=1 WHERE id={int(sub_id)}")
    print(f'  submission #{sub_id} marked applied')


if __name__ == '__main__':
    args = sys.argv[1:]
    if not args:
        cmd_list()
    elif args[0] == 'approve':
        cmd_status(args[1], 'verified')
    elif args[0] == 'reject':
        cmd_status(args[1], 'rejected')
    elif args[0] == 'show':
        cmd_show(args[1])
    elif args[0] == 'export':
        cmd_export(args[1])
    elif args[0] == 'applied':
        cmd_applied(args[1])
    else:
        sys.exit(__doc__)
