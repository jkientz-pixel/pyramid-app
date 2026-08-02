#!/usr/bin/env python3
"""Static server that mimics Cloudflare Pages URL handling: /app resolves to
app.html. Internal links are extensionless (the .html forms 308 on Pages —
external audit #5), so a plain `python3 -m http.server` 404s them locally.
Used by playwright.config.js; handy for manual local dev too."""
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class PagesHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        clean = self.path.split('?', 1)[0].split('#', 1)[0]
        fs_path = self.translate_path(clean)
        if not os.path.exists(fs_path) and os.path.isfile(fs_path + '.html'):
            self.path = clean + '.html'
        return super().send_head()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    ThreadingHTTPServer(('', port), PagesHandler).serve_forever()
