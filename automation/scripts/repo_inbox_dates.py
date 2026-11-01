#!/usr/bin/env python3
"""Recover source dates while keeping collection dates and read state untouched."""
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
import json
import re
import sqlite3
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

import repo_inbox


def source_time(markdown, item, cutoff=None, historical=False):
    heading = markdown.split('\n')[0]
    def available(value):
        return value and (not cutoff or value <= cutoff)
    if '重新打开' in heading:
        times = [e['createdAt'] for e in item.get('timeline', [])
                 if e.get('__typename') == 'ReopenedEvent' and available(e.get('createdAt'))]
        if times:
            return max(times), 'github.reopened_event'
    elif '关闭' in heading:
        times = [e['createdAt'] for e in item.get('timeline', [])
                 if e.get('__typename') == 'ClosedEvent' and available(e.get('createdAt'))]
        if times:
            return max(times), 'github.closed_event'
        if available(item.get('closed_at')):
            return item['closed_at'], 'github.closed_at'
    elif '合入' in heading or '已合并' in heading:
        if available(item.get('merged_at')):
            return item['merged_at'], 'github.merged_at'
    if available(item.get('published_at')):
        return item['published_at'], 'source.published_at'
    if ('新 PR' in heading or '新PR' in heading or '新 Issue' in heading) and available(item.get('created_at')):
        return item['created_at'], 'github.created_at'
    for field in ('updated_at', 'created_at'):
        if available(item.get(field)):
            return item[field], 'github.' + field + ('.reference' if historical else '')
    return None, None


def graphql_batch(repo, targets):
    import public_repo_monitor as monitor
    owner, name = repo.split('/', 1)
    selections = []
    for kind, number, url in targets:
        extra = 'mergedAt' if kind == 'pull' else '''timelineItems(last:100,itemTypes:[CLOSED_EVENT,REOPENED_EVENT]) {
            nodes { __typename ... on ClosedEvent { createdAt } ... on ReopenedEvent { createdAt } } }'''
        selections.append(f'{kind}{number}: {"pullRequest" if kind == "pull" else "issue"}(number:{number}) {{ createdAt updatedAt closedAt {extra} }}')
    query = 'query { repository(owner:' + json.dumps(owner) + ',name:' + json.dumps(name) + ') {' + ' '.join(selections) + '} }'
    request = urllib.request.Request('https://api.github.com/graphql', data=json.dumps({'query': query}).encode(), headers={
        'Authorization': 'Bearer ' + monitor.resolve_token(), 'Content-Type': 'application/json', 'User-Agent': 'kian-repo-inbox'})
    with monitor.OPENER.open(request, timeout=45) as response:
        data = json.load(response)
    repository = (data.get('data') or {}).get('repository') or {}
    result = {}
    for kind, number, url in targets:
        node = repository.get(f'{kind}{number}')
        if node:
            result[url] = {field: node.get(source) for field, source in [
                ('created_at', 'createdAt'), ('updated_at', 'updatedAt'), ('closed_at', 'closedAt'), ('merged_at', 'mergedAt')]}
            result[url]['timeline'] = node.get('timelineItems', {}).get('nodes', [])
    return result


def backfill():
    import public_repo_monitor as monitor
    monitor.configure()
    events = [e for e in repo_inbox.snapshot()['events'] if not e.get('event_at') and not e.get('captured_at')]
    backup = repo_inbox.DB_FILE.with_name('repo-inbox-before-source-dates.sqlite3')
    if not backup.exists():
        with repo_inbox.connect() as db, sqlite3.connect(str(backup)) as target:
            db.backup(target)
        backup.chmod(0o600)
    with repo_inbox.connect() as db:
        cache = {row['url']: json.loads(row['payload']) for row in db.execute('SELECT * FROM source_dates_cache')}
    grouped = {}
    other = set()
    for event in events:
        url = event['url']
        if url in cache:
            continue
        match = re.fullmatch(r'https://github.com/([^/]+/[^/]+)/(pull|issues)/(\d+)(?:#.*)?', url)
        if match:
            repo, kind, number = match.groups()
            grouped.setdefault(repo, set()).add(('pull' if kind == 'pull' else 'issue', int(number), url))
        else:
            other.add(url)
    jobs = [(repo, list(targets)[i:i+35]) for repo, targets in grouped.items() for i in range(0, len(targets), 35)]
    failures = 0
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(graphql_batch, repo, targets): (repo, targets) for repo, targets in jobs}
        for future in as_completed(futures):
            repo, targets = futures[future]
            try:
                result = future.result()
                with repo_inbox.connect() as db:
                    db.executemany('INSERT OR REPLACE INTO source_dates_cache VALUES (?,?)', [(url, json.dumps(payload)) for url, payload in result.items()])
                cache.update(result)
                print(f'METADATA {repo} {len(result)}/{len(targets)}', flush=True)
            except Exception as error:
                failures += 1
                print(f'METADATA_FAILED {repo} {type(error).__name__}', flush=True)
    for url in other:
        match = re.fullmatch(r'https://github.com/([^/]+/[^/]+)/releases/tag/(.+)', url)
        try:
            if match:
                release = monitor.github_get(match[1], '/releases/tags/' + urllib.parse.quote(urllib.parse.unquote(match[2]), safe=''))
                cache[url] = {'published_at': release.get('published_at')}
            elif url.startswith('https://docs.nvidia.com/deeplearning/frameworks/pytorch-release-notes/'):
                document = monitor.web_page_get(url)
                match = re.search(r'<meta\s+name="nv-pub-date"\s+content="([^"]+)"', document)
                if match:
                    value = match[1]
                    local = datetime.strptime(re.sub(r' (?:EDT|EST) ', ' ', value), '%a %b %d %H:%M:%S %Y').replace(tzinfo=ZoneInfo('America/New_York'))
                    cache[url] = {'published_at': local.astimezone(ZoneInfo('UTC')).strftime('%Y-%m-%dT%H:%M:%SZ')}
            if url in cache:
                with repo_inbox.connect() as db:
                    db.execute('INSERT OR REPLACE INTO source_dates_cache VALUES (?,?)', (url, json.dumps(cache[url])))
        except Exception as error:
            failures += 1
            print('SOURCE_DATE_FAILED ' + type(error).__name__, flush=True)
    changed = 0
    for event in events:
        value, source = source_time(event['markdown'], cache.get(event['url'], {}), cutoff=event['imported_at'], historical=True)
        if value:
            with repo_inbox.connect() as db:
                changed += db.execute('INSERT OR IGNORE INTO event_dates VALUES (?,?,?)', (event['id'], value, source)).rowcount
    remaining = sum(not e.get('captured_at') and not e.get('event_at') for e in repo_inbox.snapshot()['events'])
    print(f'DATES_BACKFILLED {changed} UNRESOLVED {remaining} REQUEST_FAILURES {failures}', flush=True)


if __name__ == '__main__':
    backfill()
