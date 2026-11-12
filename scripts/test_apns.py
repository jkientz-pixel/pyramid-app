#!/usr/bin/env python3
"""Behaviour tests for the APNs sender.

    .venv/bin/python3 -m unittest scripts/test_apns.py -v
"""
import base64
import json
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import _apns  # noqa: E402

from cryptography.hazmat.primitives import hashes, serialization  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import ec  # noqa: E402
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature  # noqa: E402

TOKEN = 'ab' * 32


def unb64(s):
    return base64.urlsafe_b64decode(s + '=' * (-len(s) % 4))


class SigningTheProviderToken(unittest.TestCase):
    def setUp(self):
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.pem = self.key.private_bytes(serialization.Encoding.PEM,
                                          serialization.PrivateFormat.PKCS8,
                                          serialization.NoEncryption())

    def test_jwt_has_apples_header_and_claims_and_verifies_with_the_key(self):
        jwt = _apns.make_jwt(self.pem, 'KEY1234567', 'TEAM123456', now=1_800_000_000)
        h, c, s = jwt.split('.')
        self.assertEqual(json.loads(unb64(h)), {'alg': 'ES256', 'kid': 'KEY1234567'})
        self.assertEqual(json.loads(unb64(c)), {'iss': 'TEAM123456', 'iat': 1_800_000_000})
        raw = unb64(s)
        self.assertEqual(len(raw), 64)
        der = encode_dss_signature(int.from_bytes(raw[:32], 'big'), int.from_bytes(raw[32:], 'big'))
        self.key.public_key().verify(der, f'{h}.{c}'.encode(), ec.ECDSA(hashes.SHA256()))


class Delivering(unittest.TestCase):
    def fake(self, answers):
        calls = []

        def curl(host, token, body, jwt, exp):
            calls.append(host)
            return answers[host]
        return curl, calls

    def test_production_success_sends_once(self):
        curl, calls = self.fake({'api.push.apple.com': (200, '')})
        self.assertEqual(_apns.send(TOKEN, {}, 'j', 60, curl=curl), 'sent')
        self.assertEqual(calls, ['api.push.apple.com'])

    def test_a_sandbox_token_is_delivered_not_reaped(self):
        curl, calls = self.fake({'api.push.apple.com': (400, 'BadDeviceToken'),
                                 'api.sandbox.push.apple.com': (200, '')})
        self.assertEqual(_apns.send(TOKEN, {}, 'j', 60, curl=curl), 'sent')
        self.assertEqual(len(calls), 2)

    def test_dead_only_when_both_environments_reject_the_token(self):
        curl, _ = self.fake({'api.push.apple.com': (410, 'Unregistered'),
                             'api.sandbox.push.apple.com': (400, 'BadDeviceToken')})
        self.assertEqual(_apns.send(TOKEN, {}, 'j', 60, curl=curl), 'dead')

    def test_auth_or_server_errors_keep_the_row(self):
        curl, calls = self.fake({'api.push.apple.com': (403, 'InvalidProviderToken')})
        self.assertTrue(_apns.send(TOKEN, {}, 'j', 60, curl=curl).startswith('error:403'))
        self.assertEqual(calls, ['api.push.apple.com'])


class Rows(unittest.TestCase):
    def test_only_well_formed_apns_endpoints_yield_a_token(self):
        self.assertEqual(_apns.token_of('apns://' + TOKEN), TOKEN)
        self.assertIsNone(_apns.token_of('https://fcm.googleapis.com/x'))
        self.assertIsNone(_apns.token_of('apns://nothex'))

    def test_payload_carries_alert_and_deep_link(self):
        p = _apns.payload('Match day', 'LAFC vs Galaxy', '/app#/myxi')
        self.assertEqual(p['aps']['alert'], {'title': 'Match day', 'body': 'LAFC vs Galaxy'})
        self.assertEqual(p['url'], '/app#/myxi')


if __name__ == '__main__':
    unittest.main()
