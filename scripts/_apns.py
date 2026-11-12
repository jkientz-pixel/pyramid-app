"""Apple Push Notification service (APNs) sender for the native iOS app.

Used by scripts/push_alerts.py for push_subs rows whose endpoint is
apns://<device token> (written by /api/push when the iOS shell registers).

Why it looks like this:

· Token-based auth (.p8 key), not certificates. One key works for every app
  on the team, never expires, and is the only kind Apple still recommends.
  It lives in ~/.config/rankxi/ beside the VAPID key, never in the repo.

· No new dependencies. APNs requires HTTP/2, which neither urllib nor
  requests speak. macOS curl is built with nghttp2, so each send is one curl
  call; the JWT is signed with `cryptography`, already in .venv for
  pywebpush. One subscriber per day means a process per send is nothing.

· Production first, sandbox second. TestFlight and App Store builds hand out
  production tokens; a build run straight from Xcode hands out sandbox ones,
  and production rejects those with 400 BadDeviceToken. Retrying the sandbox
  host means a developer's own phone keeps getting alerts instead of being
  reaped as dead, and a token is only declared dead when Apple says so on
  the host that issued it.

Config: ~/.config/rankxi/apns.json
    {"key_id": "ABC123DEFG", "team_id": "XYZ987TEAM", "key_file": "AuthKey_ABC123DEFG.p8"}
"""
import base64
import json
import pathlib
import subprocess
import tempfile
import time

CONF = pathlib.Path.home() / '.config' / 'rankxi'
CONFIG_FILE = CONF / 'apns.json'
TOPIC = 'com.rankedxi.app'
HOSTS = ('api.push.apple.com', 'api.sandbox.push.apple.com')
JWT_TTL = 50 * 60          # Apple rejects tokens older than an hour; refresh before that
DEAD_REASONS = {'Unregistered', 'BadDeviceToken', 'DeviceTokenNotForTopic'}
CURL_TIMEOUT = 20


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b'=').decode()


def der_to_raw(der: bytes, size: int = 32) -> bytes:
    """ES256 JWTs carry the signature as r||s (64 bytes); cryptography emits
    DER. Decode the two INTEGERs rather than trusting fixed offsets."""
    from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
    r, s = decode_dss_signature(der)
    return r.to_bytes(size, 'big') + s.to_bytes(size, 'big')


def make_jwt(key_pem: bytes, key_id: str, team_id: str, now: int | None = None) -> str:
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    key = serialization.load_pem_private_key(key_pem, password=None)
    header = b64url(json.dumps({'alg': 'ES256', 'kid': key_id}, separators=(',', ':')).encode())
    claims = b64url(json.dumps({'iss': team_id, 'iat': int(now or time.time())},
                               separators=(',', ':')).encode())
    signing_input = f'{header}.{claims}'.encode()
    sig = key.sign(signing_input, ec.ECDSA(hashes.SHA256()))
    return f'{header}.{claims}.{b64url(der_to_raw(sig))}'


def load_config() -> dict | None:
    """None when APNs is not configured yet -- the caller skips iOS rows
    instead of failing the whole run (web push must keep working)."""
    try:
        cfg = json.loads(CONFIG_FILE.read_text())
        key_file = CONF / cfg['key_file']
        return {'key_id': cfg['key_id'], 'team_id': cfg['team_id'], 'key_pem': key_file.read_bytes()}
    except (OSError, ValueError, KeyError):
        return None


def payload(title: str, body: str, url: str) -> dict:
    return {'aps': {'alert': {'title': title, 'body': body}, 'sound': 'default',
                    'thread-id': 'rxi-matchday'},
            'url': url}


def _curl(host: str, token: str, body: dict, jwt: str, expires_at: int) -> tuple[int, str]:
    """Returns (http status, APNs reason or ''). Status 0 = transport failure."""
    with tempfile.NamedTemporaryFile('w+', suffix='.json') as out:
        cmd = ['/usr/bin/curl', '-sS', '--http2', '--max-time', str(CURL_TIMEOUT),
               '-o', out.name, '-w', '%{http_code}',
               '-H', f'authorization: bearer {jwt}',
               '-H', f'apns-topic: {TOPIC}',
               '-H', 'apns-push-type: alert',
               '-H', 'apns-priority: 10',
               '-H', f'apns-expiration: {expires_at}',
               '-H', 'apns-collapse-id: rxi-matchday',
               '--data-binary', '@-',
               f'https://{host}/3/device/{token}']
        r = subprocess.run(cmd, input=json.dumps(body), capture_output=True, text=True)
        try:
            status = int(r.stdout.strip() or 0)
        except ValueError:
            status = 0
        reason = ''
        try:
            reason = json.loads(pathlib.Path(out.name).read_text() or '{}').get('reason', '')
        except ValueError:
            pass
        if status == 0:
            reason = (r.stderr or 'curl failed').strip()[-200:]
        return status, reason


def send(token: str, body: dict, jwt: str, ttl_s: int, curl=_curl) -> str:
    """Deliver one notification. Returns 'sent', 'dead' (delete the row) or
    'error:<detail>' (keep the row, try again tomorrow)."""
    expires_at = int(time.time()) + ttl_s
    for host in HOSTS:
        status, reason = curl(host, token, body, jwt, expires_at)
        if status == 200:
            return 'sent'
        if status == 410 or (status == 400 and reason in DEAD_REASONS):
            continue          # maybe a token from the other environment
        return f'error:{status} {reason}'
    return 'dead'


def token_of(endpoint: str) -> str | None:
    if not endpoint.startswith('apns://'):
        return None
    t = endpoint[len('apns://'):]
    return t if len(t) == 64 and all(c in '0123456789abcdef' for c in t) else None
