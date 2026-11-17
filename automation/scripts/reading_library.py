#!/usr/bin/env python3
"""Source-addressed reading guides and explicit, idempotent library imports."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import mimetypes
import re
import subprocess
from urllib.parse import urlsplit, urlunsplit, unquote, quote
import repo_inbox


def source_key(url):
    parts = urlsplit(url)
    host = (parts.hostname or '').lower()
    if host in ('arxiv.org', 'www.arxiv.org', 'export.arxiv.org', 'papers.cool'):
        match = re.search(r'(?:abs/|pdf/|html/|arxiv/)(\d{4}\.\d{4,5})(?:v\d+)?', parts.path)
        if match:
            return 'arxiv:' + match[1]
    if host == 'github.com':
        match = re.match(r'(/[^/]+/[^/]+/(?:pull|issues)/\d+)', parts.path)
        if match:
            return 'https://github.com' + match[1].lower()
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path.rstrip('/'), parts.query, ''))


def require_url(url):
    parts = urlsplit(url)
    if parts.scheme not in ('http', 'https') or not parts.hostname or parts.username or parts.password:
        raise ValueError('A public HTTP(S) source URL is required')


def save_guide(url, title, markdown, assets=(), key='reading'):
    require_url(url)
    identity = hashlib.sha256((source_key(url) + '\n' + key).encode()).hexdigest()
    now = datetime.now(timezone.utc).isoformat()
    prepared = []
    for name, mime, content in assets:
        if not re.fullmatch(r'[A-Za-z0-9_.-]+', name) or mime not in ('image/png', 'image/jpeg', 'image/webp', 'text/plain') or len(content) > 10 * 1024 * 1024:
            raise ValueError('Invalid guide asset')
        prepared.append((identity, name, mime, content))
    with repo_inbox.connect() as db:
        db.execute('INSERT INTO reading_guides VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,markdown=excluded.markdown,updated_at=excluded.updated_at',
                   (identity, source_key(url), title, markdown, now))
        db.executemany('INSERT INTO guide_assets VALUES (?,?,?,?) ON CONFLICT(guide_id,name) DO UPDATE SET mime=excluded.mime,content=excluded.content', prepared)
    return identity


def get_guide(identity):
    with repo_inbox.connect() as db:
        row = db.execute('SELECT * FROM reading_guides WHERE id=?', (identity,)).fetchone()
    if not row:
        return None
    guide = dict(row)
    key = guide.pop('source_key')
    guide['events'] = [dict(id=e['id'], title=e['title'], url=e['url'], is_read=e['is_read'], is_favorite=e['is_favorite'])
                       for e in repo_inbox.snapshot()['events'] if source_key(e['url']) == key]
    return guide


def get_asset(identity, name):
    with repo_inbox.connect() as db:
        row = db.execute('SELECT mime,content FROM guide_assets WHERE guide_id=? AND name=?', (identity, name)).fetchone()
    return (row['mime'], row['content']) if row else None


def save_document(path):
    if path.suffix.lower() != '.pdf' or path.stat().st_size > 10 * 1024 * 1024:
        raise ValueError('Import a PDF of at most 10 MiB')
    content = path.read_bytes()
    if not content.startswith(b'%PDF-') or len(content) > 10 * 1024 * 1024:
        raise ValueError('Invalid PDF document')
    identity = hashlib.sha256(content).hexdigest()
    with repo_inbox.connect() as db:
        db.execute('INSERT OR IGNORE INTO library_documents VALUES (?,?)', (identity, content))
    return identity


def get_document(identity):
    with repo_inbox.connect() as db:
        row = db.execute('SELECT content FROM library_documents WHERE id=?', (identity,)).fetchone()
    return row['content'] if row else None


def register_markdown(url, title, path, key='reading'):
    markdown = path.read_text()
    markdown = re.sub(r'\A---\n.*?\n---\n', '', markdown, count=1, flags=re.S)
    assets = []
    identity = hashlib.sha256((source_key(url) + '\n' + key).encode()).hexdigest()
    root = path.parent.resolve()
    def image(match):
        target = match[2].strip('<>')
        if urlsplit(target).scheme or target.startswith('/'):
            return match[0]
        file = (root / unquote(target)).resolve()
        if not file.is_relative_to(root) or not file.is_file():
            raise ValueError('Missing or out-of-directory guide image: ' + target)
        name = hashlib.sha256(target.encode()).hexdigest()[:12] + file.suffix.lower()
        mime = mimetypes.guess_type(file.name)[0]
        assets.append((name, mime, file.read_bytes()))
        return '![' + match[1] + '](/guide-assets/' + identity + '/' + name + ')'
    markdown = re.sub(r'!\[([^\]]*)\]\((<[^>]+>|[^\s)]+)\)', image, markdown)
    repository = next((p for p in (root, *root.parents) if (p / '.git').exists()), None)
    if repository:
        remote = subprocess.run(['git', '-C', str(repository), 'remote', 'get-url', 'origin'], check=True, capture_output=True, text=True).stdout.strip()
        github = re.fullmatch(r'(?:https://(?:[^@]+@)?github.com/|git@github.com:)([\w.-]+/[\w.-]+?)(?:\.git)?', remote)
        branch = subprocess.run(['git', '-C', str(repository), 'rev-parse', '--abbrev-ref', 'HEAD'], check=True, capture_output=True, text=True).stdout.strip()
        if github:
            def link(match):
                target = match[2].strip('<>')
                parts = urlsplit(target)
                if parts.scheme or target.startswith(('/', '#')):
                    return match[0]
                file = (root / unquote(parts.path)).resolve()
                if not file.is_relative_to(repository):
                    raise ValueError('Out-of-repository guide link: ' + target)
                href = 'https://github.com/' + github[1] + '/blob/' + quote(branch, safe='/') + '/' + quote(str(file.relative_to(repository)), safe='/')
                if parts.fragment:
                    href += '#' + parts.fragment
                return '[' + match[1] + '](' + href + ')'
            markdown = re.sub(r'\[([^\]]*)\]\((<[^>]+>|[^\s)]+)\)', link, markdown)
    return save_guide(url, title, markdown, assets, key)


def import_entries(entries):
    now = datetime.now(timezone.utc).isoformat()
    for entry in entries:
        require_url(entry['url'])
        if not isinstance(entry['is_read'], bool) or not isinstance(entry['is_favorite'], bool) or not entry['title'].strip():
            raise ValueError('Explicit title/read/favorite state is required')
    result = []
    with repo_inbox.connect() as db:
        existing = list(db.execute('SELECT id,url FROM events ORDER BY imported_at DESC,id'))
        for entry in entries:
            key = source_key(entry['url'])
            previous = db.execute('SELECT event_id FROM library_entries WHERE source_key=?', (key,)).fetchone()
            if previous:
                result.append(dict(url=entry['url'], id=previous['event_id'], action='already-imported'))
                continue
            identity = next((r['id'] for r in existing if source_key(r['url']) == key), None)
            action = 'matched' if identity else 'created'
            if not identity:
                identity = hashlib.sha256(('library:' + key).encode()).hexdigest()
                channel = entry.get('channel', 'papers')
                repo = entry.get('repo', 'library:toread')
                md = '📌 ' + entry['title'] + '\n\n' + entry.get('summary', '') + '\n\n[原文 / Source](' + entry['url'] + ')'
                db.execute('INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                           (identity, channel, repo, entry.get('source_name', 'TOREAD'), md, entry['title'], entry.get('summary', ''), entry['url'], entry.get('kind', 'paper'), 0, None, now, now, 0, None))
                existing.append(dict(id=identity, url=entry['url']))
            if entry['is_read']:
                db.execute('UPDATE events SET is_read=1,read_at=COALESCE(read_at,?) WHERE id=?', (entry.get('read_at'), identity))
            if entry['is_favorite']:
                db.execute('INSERT OR IGNORE INTO event_favorites VALUES (?,?)', (identity, now))
            metadata = {k: entry[k] for k in ('categories', 'versions', 'provenance') if k in entry}
            db.execute('INSERT INTO library_entries VALUES (?,?,?)', (key, identity, json.dumps(metadata, ensure_ascii=False)))
            result.append(dict(url=entry['url'], id=identity, action=action))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    imports = commands.add_parser('import', help='Import an explicit JSON item manifest; safe to repeat')
    imports.add_argument('manifest', type=Path)
    document = commands.add_parser('document', help='Explicitly import a private local PDF; no arbitrary file serving')
    document.add_argument('path', type=Path)
    document.add_argument('--title', required=True)
    document.add_argument('--favorite', action='store_true')
    guide = commands.add_parser('guide', help='Register a Markdown guide for an existing source URL')
    guide.add_argument('--source', required=True)
    guide.add_argument('--title', required=True)
    guide.add_argument('--markdown', type=Path, required=True)
    guide.add_argument('--key', default='reading')
    args = parser.parse_args()
    if args.command == 'import':
        print(json.dumps(import_entries(json.loads(args.manifest.read_text())), ensure_ascii=False, indent=2))
    elif args.command == 'document':
        from automation_common import load_config
        identity = save_document(args.path)
        port = int(load_config().get('repo_inbox', {}).get('port', 8768))
        url = f'http://127.0.0.1:{port}/library-document/{identity}.pdf'
        print(json.dumps(import_entries([dict(title=args.title, url=url, is_read=False,
            is_favorite=args.favorite, repo='library:documents', source_name='Local documents', kind='article')]), ensure_ascii=False, indent=2))
    else:
        identity = register_markdown(args.source, args.title, args.markdown, key=args.key)
        print('/guide/' + identity)


if __name__ == '__main__':
    main()
