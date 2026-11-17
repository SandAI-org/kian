#!/usr/bin/env python3
"""Loopback reader with explicit same-origin read-state writes."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import secrets
from urllib.parse import urlsplit
import re
from automation_common import load_config
import repo_inbox
import reading_library

ASSETS = Path(__file__).with_name('repo_inbox_web')


def make_handler(port, language='zh', repositories=()):
    token = secrets.token_urlsafe(32)

    class Handler(BaseHTTPRequestHandler):
        def reply(self, code, payload, content_type='application/json; charset=utf-8'):
            data = payload if isinstance(payload, bytes) else json.dumps(payload, ensure_ascii=False).encode()
            self.send_response(code)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            styles = "'self' 'unsafe-inline'" if re.fullmatch(r'/guide/[a-f0-9]{64}', urlsplit(self.path).path) else "'self'"
            self.send_header('Content-Security-Policy', f"default-src 'self'; script-src 'self'; style-src {styles}; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
            self.end_headers()
            self.wfile.write(data)

        def valid_host(self):
            return self.headers.get('Host') in (f'127.0.0.1:{port}', f'localhost:{port}')

        def do_GET(self):
            if not self.valid_host():
                return self.reply(403, {'error': 'Invalid host'})
            route = urlsplit(self.path).path
            if route == '/api/inbox':
                return self.reply(200, dict(repo_inbox.snapshot(), token=token, language=language, repositories=[{"repo": repo, "channel": "owned"} for repo in repositories]))
            match = re.fullmatch(r'/api/guide/([a-f0-9]{64})', route)
            if match:
                guide = reading_library.get_guide(match[1])
                return self.reply(200, dict(guide, token=token)) if guide else self.reply(404, {'error': 'Not found'})
            match = re.fullmatch(r'/guide-assets/([a-f0-9]{64})/([A-Za-z0-9_.-]+)', route)
            if match:
                asset = reading_library.get_asset(*match.groups())
                return self.reply(200, asset[1], asset[0]) if asset else self.reply(404, {'error': 'Not found'})
            match = re.fullmatch(r'/library-document/([a-f0-9]{64})\.pdf', route)
            if match:
                document = reading_library.get_document(match[1])
                return self.reply(200, document, 'application/pdf') if document else self.reply(404, {'error': 'Not found'})
            if re.fullmatch(r'/guide/[a-f0-9]{64}', route):
                return self.reply(200, (ASSETS / 'guide.html').read_bytes(), 'text/html; charset=utf-8')
            if route.startswith('/vendor/'):
                target = (ASSETS / route.lstrip('/')).resolve()
                if not target.is_relative_to((ASSETS / 'vendor').resolve()) or not target.is_file():
                    return self.reply(404, {'error': 'Not found'})
                mime = {'.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf'}.get(target.suffix)
                return self.reply(200, target.read_bytes(), mime) if mime else self.reply(404, {'error': 'Not found'})
            assets = {'/': ('index.html', 'text/html; charset=utf-8'), '/favicon.svg': ('favicon.svg', 'image/svg+xml'), '/app.js': ('app.js', 'text/javascript; charset=utf-8'), '/timeline.js': ('timeline.js', 'text/javascript; charset=utf-8'), '/style.css': ('style.css', 'text/css; charset=utf-8')}
            assets.update({'/guide.js': ('guide.js', 'text/javascript; charset=utf-8'), '/guide.css': ('guide.css', 'text/css; charset=utf-8')})
            if route not in assets:
                return self.reply(404, {'error': 'Not found'})
            name, mime = assets[route]
            return self.reply(200, (ASSETS / name).read_bytes(), mime)

        def do_POST(self):
            origin = self.headers.get('Origin')
            if (not self.valid_host() or origin not in (f'http://127.0.0.1:{port}', f'http://localhost:{port}')
                    or self.headers.get('X-Inbox-Token') != token):
                return self.reply(403, {'error': 'Invalid origin or token'})
            if self.path not in ('/api/read', '/api/favorite'):
                return self.reply(404, {'error': 'Not found'})
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 1000000:
                    raise ValueError('Invalid request length')
                body = json.loads(self.rfile.read(length))
                if self.path == '/api/read':
                    repo_inbox.mark_read(body['ids'], body['is_read'])
                else:
                    repo_inbox.mark_favorite(body['ids'], body['is_favorite'])
            except (ValueError, KeyError, TypeError):
                return self.reply(400, {'error': 'Invalid request'})
            return self.reply(200, {'ok': True})

        def log_message(self, *_):
            pass

    return Handler


def main():
    config = load_config()
    if not repo_inbox.enabled(config):
        return
    repo_inbox.import_pending()
    settings = config.get('repo_inbox', {})
    port = int(settings.get('port', 8768))
    ThreadingHTTPServer(('127.0.0.1', port), make_handler(port, settings.get('language', 'zh'), config.get('github', {}).get('repos', []))).serve_forever()


if __name__ == '__main__':
    main()
