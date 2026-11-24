#!/usr/bin/env python3
"""Local static preview with the clean /app URL and Cloudflare asset exclusions."""
import argparse
import fnmatch
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit, parse_qs

ROOT = Path(__file__).resolve().parent.parent
EXCLUSIONS = [line.strip() for line in (ROOT / '.assetsignore').read_text().splitlines()
              if line.strip() and not line.lstrip().startswith('#')]


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_not_found(self):
        body = (ROOT / '404.html').read_bytes()
        self.send_response(404)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def send_head(self):
        request = urlsplit(self.path)
        name = unquote(request.path)
        if name.startswith('/_localized/') or name == '/_localized':
            self.send_not_found()
            return None
        if name in ('/impressum', '/datenschutz'):
            name += '.html'
        if name in ('/', '/app'):
            requested = parse_qs(request.query, keep_blank_values=True).get('lang', [''])[0]
            language = requested if requested in ('de', 'en', 'es', 'ar', 'zh') else 'de'
            name = '/_localized/' + language + ('/index.html' if name == '/' else '/app.html')
        path = (ROOT / name.lstrip('/')).resolve()
        try:
            relative = path.relative_to(ROOT)
        except ValueError:
            self.send_not_found()
            return None
        parts = relative.parts
        if (not parts or any(part.startswith('.') for part in parts) or
            any(fnmatch.fnmatchcase(part, pattern) for part in parts for pattern in EXCLUSIONS) or
            not path.is_file()):
            self.send_not_found()
            return None
        # Keep the browser URL (and query string) unchanged while serving the file.
        self.path = '/' + relative.as_posix()
        return super().send_head()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--bind', default='0.0.0.0')
    parser.add_argument('--port', type=int, default=4173)
    args = parser.parse_args()
    ThreadingHTTPServer((args.bind, args.port), Handler).serve_forever()
