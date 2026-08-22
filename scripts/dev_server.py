#!/usr/bin/env python3
"""Static server that mimics Cloudflare Pages URL handling: /app resolves to
app.html. Internal links are extensionless (the .html forms 308 on Pages —
external audit #5), so a plain `python3 -m http.server` 404s them locally.
Used by playwright.config.js; handy for manual local dev too.

It also answers /api/auth/session the way production answers a visitor with no
session cookie. That endpoint is fetched on every app boot (js/account.js), and
a 404 for it is not a neutral local-dev wart: tests/smoke.spec.js asserts that a
page load produces no HTTP errors at all, so an unhandled /api route turned 86
passing tests red at once. Pages Functions do not run under this server, so the
choice is between stubbing the logged-out answer or teaching every test to
ignore 404s — and the second one blinds the suite to real missing files.

Only the logged-out shape is stubbed. Signing in locally needs `wrangler pages
dev`, which runs the real functions against a real D1.
"""
import json
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

SESSION_ROUTE = '/api/auth/session'


class PagesHandler(SimpleHTTPRequestHandler):
    def _clean(self):
        return self.path.split('?', 1)[0].split('#', 1)[0]

    def _stub_logged_out(self):
        payload = json.dumps({'ok': True, 'signedIn': False}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(payload)

    def do_GET(self):
        if self._clean() == SESSION_ROUTE:
            return self._stub_logged_out()
        return super().do_GET()

    def do_HEAD(self):
        if self._clean() == SESSION_ROUTE:
            return self._stub_logged_out()
        return super().do_HEAD()

    def send_head(self):
        clean = self._clean()
        fs_path = self.translate_path(clean)
        if not os.path.exists(fs_path) and os.path.isfile(fs_path + '.html'):
            self.path = clean + '.html'
        return super().send_head()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    ThreadingHTTPServer(('', port), PagesHandler).serve_forever()
