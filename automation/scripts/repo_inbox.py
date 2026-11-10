#!/usr/bin/env python3
"""Durable reading inbox, independent of notification checkpoints."""
from contextlib import contextmanager
import hashlib
import json
import os
import re
import sqlite3
from datetime import datetime, timezone
from urllib.parse import urlsplit
from automation_common import STATE_DIR

DB_FILE = STATE_DIR / 'repo-inbox.sqlite3'


def enabled(config):
    return config.get('services', {}).get('repo_inbox', {}).get('enabled', False)


@contextmanager
def connect():
    DB_FILE.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    db = sqlite3.connect(str(DB_FILE), timeout=20)
    os.chmod(DB_FILE, 0o600)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA journal_mode=WAL')
    db.execute('''CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY, channel TEXT NOT NULL, repo TEXT NOT NULL,
        source_name TEXT NOT NULL, markdown TEXT NOT NULL, title TEXT NOT NULL,
        summary TEXT NOT NULL, url TEXT NOT NULL, kind TEXT NOT NULL,
        required INTEGER NOT NULL, score INTEGER, captured_at TEXT,
        imported_at TEXT NOT NULL, is_read INTEGER NOT NULL DEFAULT 0, read_at TEXT)''')
    db.execute('CREATE INDEX IF NOT EXISTS inbox_channel_repo ON events(channel,repo)')
    db.execute('CREATE TABLE IF NOT EXISTS event_dates (event_id TEXT PRIMARY KEY, event_at TEXT NOT NULL, date_source TEXT NOT NULL)')
    db.execute('CREATE TABLE IF NOT EXISTS source_dates_cache (url TEXT PRIMARY KEY, payload TEXT NOT NULL)')
    try:
        with db:
            yield db
    finally:
        db.close()


def plain(text):
    text = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', text)
    return re.sub(r'[*`]', '', text).strip()


def fields(markdown):
    links = re.findall(r'\[[^\]]+\]\((https?://[^\s)]+)\)', markdown)
    url = next((u for u in links if re.search(r'/(pull|issues)/\d+', u)), links[-1] if links else '')
    match = re.search(r'📌\s*(?:\*\*)?([^\n]+)', markdown)
    title = plain(match[1]) if match else plain(next((s for s in markdown.splitlines() if s.strip()), ''))
    lines = [plain(s) for s in markdown.splitlines() if s.strip()]
    summary = next((s.split('：', 1)[-1].strip() for s in lines if '中文摘要' in s), '')
    kind = 'paper' if 'papers.cool/' in url or 'arxiv.org/abs/' in url else 'pr' if '/pull/' in url else 'issue' if '/issues/' in url else 'release' if '/releases/' in url else 'article'
    return title, summary, url, kind


def event_id(channel, repo, markdown):
    return hashlib.sha256(json.dumps([channel, repo, markdown], ensure_ascii=False).encode()).hexdigest()


def archive(groups, channel, captured_at=None):
    now = datetime.now(timezone.utc).isoformat()
    added = 0
    with connect() as db:
        for group in groups:
            for event in group.get('events', []):
                md = event['markdown']
                event_channel = group.get('channel', channel)
                identity = event_id(event_channel, group['repo'], md)
                title, summary, url, kind = fields(md)
                if event_channel == 'papers':
                    kind = 'paper'
                cursor = db.execute('''INSERT OR IGNORE INTO events
                    (id,channel,repo,source_name,markdown,title,summary,url,kind,required,score,captured_at,imported_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                    (identity, event_channel, group['repo'], group.get('source_name', ''), md, title, summary, url, kind,
                     bool(event.get('required', False)), event.get('score'), event.get('captured_at', captured_at), now))
                added += cursor.rowcount
                if event.get("event_at"):
                    db.execute('INSERT OR IGNORE INTO event_dates VALUES (?,?,?)',
                               (identity, event['event_at'], event.get('date_source', 'source.timestamp')))
    return added


def import_pending():
    counts = {}
    for filename, channel in [('public-watch-state.json', 'public'), ('github-monitor-state.json', 'owned')]:
        try:
            state = json.loads((STATE_DIR / filename).read_text())
        except FileNotFoundError:
            continue
        groups = state.get('pending_notifications', []) if channel == 'public' else [
            {'repo': e['repo'], 'events': [e]} for e in state.get('deferred_updates', [])]
        counts[channel] = archive(groups, channel)
    return counts


def snapshot():
    with connect() as db:
        events = [dict(r) for r in db.execute('SELECT events.*,event_dates.event_at,event_dates.date_source FROM events LEFT JOIN event_dates ON events.id=event_dates.event_id ORDER BY imported_at DESC,id')]
    return {'events': events, 'observed_at': datetime.now(timezone.utc).isoformat()}


def mark_read(ids, is_read):
    if not isinstance(ids, list) or not 1 <= len(ids) <= 10000 or any(not isinstance(i, str) for i in ids):
        raise ValueError('Invalid item IDs')
    if not isinstance(is_read, bool):
        raise ValueError('Invalid read state')
    with connect() as db:
        db.executemany('UPDATE events SET is_read=?,read_at=? WHERE id=?',
                       [(is_read, datetime.now(timezone.utc).isoformat() if is_read else None, i) for i in ids])


def unread_groups(groups, channel):
    channel = 'public' if channel == 'all' else channel
    with connect() as db:
        read_ids = {row['id'] for row in db.execute('SELECT id FROM events WHERE is_read=1')}
    result = []
    for group in groups:
        events = [event for event in group.get('events', [])
                  if event_id(group.get('channel', channel), group['repo'], event['markdown']) not in read_ids]
        if events:
            result.append(dict(group, events=events))
    return result


def reading_highlights(groups, en=False):
    from public_repo_monitor import SEMANTIC_SIGNALS
    signals = [('Security', '安全风险', r'安全|漏洞'),
               ('Correctness / regression', '正确性与回归', r'错误|死锁|竞态|挂起|越界|正确性|驱动异常'),
               ('Breaking / API change', 'API 兼容性', r'不兼容|弃用|接口变更'),
               ('Performance', '性能优化', r'性能|吞吐|延迟|显存|优化|提速|减少.*(?:拷贝|开销)'),
               ('Core capability / hardware', '内核与硬件能力', r'内核|SM\d+|TMA|GEMM|FSDP|通信')]
    patterns = {name: pattern for name, points, pattern in SEMANTIC_SIGNALS}
    candidates = []
    for group in groups:
        if group.get('channel', 'public') != 'public':
            continue
        for event in group.get('events', []):
            title, summary, url, kind = fields(event['markdown'])
            if not url or not summary or '中文摘要暂时生成失败' in summary:
                continue
            reasons = [a if en else b for a, b, pattern in signals
                       if a in event['markdown'] or re.search(pattern + '|' + patterns[a], title + ' ' + summary, re.I)][:2]
            if not reasons:
                reasons = [('Release' if en else '版本发布') if kind == 'release' else
                           ('Tracked repository update' if en else '关注仓库的变更')]
            candidates.append({'repo': group['repo'], 'name': group.get('source_name') or group['repo'],
                               'event': event, 'title': title, 'summary': summary, 'url': url,
                               'context': next((plain(s) for s in event['markdown'].splitlines() if s.strip()), ''),
                               'reason': ' · '.join(reasons)})
    candidates.sort(key=lambda c: c['event'].get('captured_at') or '', reverse=True)
    candidates.sort(key=lambda c: ('pinned' not in c['event']['markdown'].lower(),
                                  not c['event'].get('required', False), -(c['event'].get('score') or 0)))
    selected = []
    for diverse in (True, False):
        for candidate in candidates:
            if len(selected) == 3:
                break
            if any(c['url'] == candidate['url'] for c in selected):
                continue
            if diverse and any(c['repo'] == candidate['repo'] for c in selected):
                continue
            selected.append(candidate)
    def short(text, limit):
        text = re.sub(r'\s+', ' ', plain(text))
        return text if len(text) <= limit else text[:limit - 1] + '…'
    return [f"**{short(c['name'], 60)}** · {short(c['context'], 80)}\n"
            + '**' + short(c['title'], 110) + '** · [' + ('Read source' if en else '查看原文') + f"]({c['url']})\n"
            + short(c['summary'], 160) + '\n' + ('Why read: ' if en else '关注点：') + c['reason']
            for c in selected]


def notification_card(groups, config, channel, daily=False):
    from collections import Counter
    unread = unread_groups(groups, channel)
    if not unread:
        return {'body': '', 'elements': []}
    all_totals = Counter()
    for group in groups:
        all_totals[group.get('source_name') or group['repo']] += len(group.get('events', []))
    totals = Counter()
    for group in unread:
        totals[group.get('source_name') or group['repo']] += len(group.get('events', []))
    en = config.get('repo_inbox', {}).get('language', 'zh') == 'en'
    highlights = reading_highlights(unread, en) if channel in ('public', 'all') else []
    heading = ('Repository daily digest' if daily else 'Repository updates') if en else ('本次每日总结已整理' if daily else '有新的仓库更新')
    if channel in ('papers', 'all') and not daily:
        heading = 'New reading updates' if en else '有新的阅读动态'
    body = f'**{heading}** · {sum(totals.values())} ' + ('unread items' if en else '条未读') + '\n\n'
    read_count = sum(all_totals.values()) - sum(totals.values())
    if daily:
        body = body.rstrip() + f" · {read_count:,} " + ('read items' if en else '条已读') + '\n\n'
    displayed = all_totals if daily else totals
    def status(name):
        count = totals[name]
        text = f"{count:,} " + ('unread' if en else '条未读')
        if daily:
            text += f" · {all_totals[name] - count:,} " + ('read' if en else '条已读')
        return text
    body += '\n'.join(f'**{repo}** · {status(repo)}' for repo in displayed)
    if highlights:
        body += '\n\n**' + ('Selected reading' if en else '本次精选') + '**\n\n' + '\n\n'.join(highlights)
    settings = config.get('repo_inbox', {})
    url = settings.get('reader_url') or f"http://127.0.0.1:{int(settings.get('port', 8768))}/"
    if urlsplit(url).scheme not in ('http', 'https'):
        raise ValueError('Invalid reader URL')
    target = url + ('&' if urlsplit(url).query else '?') + 'channel=' + channel
    body += '\n\n[' + ('Open reading inbox' if en else '打开阅读收件箱') + f']({target})'
    body += '\n\n' + ('Read status is saved in the inbox.' if en else '详细内容与已读状态保存在网页中。')
    if urlsplit(url).hostname in ('127.0.0.1', 'localhost'):
        body += '\n' + ('This link opens on this computer; phone access is not configured.' if en else '此链接在这台电脑打开；尚未配置手机访问。')
    labels = {'pytorch': 'PyTorch', 'triton': 'Triton', 'cutlass': 'CUTLASS', 'nccl': 'NCCL', 'magicore': 'Magicore', 'odin': 'Odin'}
    names = {name: labels.get(name.rsplit('/', 1)[-1], name.rsplit('/', 1)[-1]) for name in displayed}
    duplicates = Counter(names.values())
    for name, label in list(names.items()):
        if duplicates[label] > 1:
            names[name] = name
    def column(content):
        return {'tag': 'column', 'width': 'weighted', 'weight': 1,
                'elements': [{'tag': 'div', 'text': {'tag': 'lark_md', 'content': content}}]}
    elements = [{'tag': 'column_set', 'flex_mode': 'bisect', 'background_style': 'grey', 'columns': [
        column(f"**{sum(totals.values()):,}**\n" + ('Unread updates' if en else '未读更新')),
        column(f"**{read_count:,}**\n" + ('Read updates' if en else '已读更新')) if daily else
        column(f"**{len(totals)}**\n" + ('Repositories / sources' if en else '仓库 / 来源')),
    ]}, {'tag': 'hr'}]
    entries = [] if highlights else list(displayed.items())
    for offset in range(0, len(entries), 2):
        columns = [column(f"**{names[name]}**\n{status(name)}")
                   for name, count in entries[offset:offset + 2]]
        if len(columns) == 1:
            columns.append(column(' '))
        elements.append({'tag': 'column_set', 'flex_mode': 'bisect', 'background_style': 'default', 'columns': columns})
    if highlights:
        elements.append({'tag': 'markdown', 'content': '**' + ('Selected reading' if en else '本次精选') + '**'})
        for index, highlight in enumerate(highlights):
            if index:
                elements.append({'tag': 'hr'})
            elements.append({'tag': 'markdown', 'content': highlight})
        remaining = sum(totals.values()) - len(highlights)
        if remaining:
            elements.append({'tag': 'note', 'elements': [{'tag': 'plain_text', 'content':
                (f'{remaining} more unread updates in the reading room.' if en else f'另有 {remaining} 条未读，完整列表见阅读空间。')}]})
    elements.extend([{'tag': 'hr'}, {'tag': 'action', 'actions': [{
        'tag': 'button', 'type': 'primary', 'text': {'tag': 'plain_text', 'content': 'Open reading room' if en else '打开阅读空间'},
        'url': target,
    }]}])
    note = 'Read progress is saved in the reading room.' if en else '阅读进度保存在网页中。'
    if urlsplit(url).hostname in ('127.0.0.1', 'localhost'):
        note += ' Local access only.' if en else '仅本机访问。'
    elements.append({'tag': 'note', 'elements': [{'tag': 'plain_text', 'content': note}]})
    return {'body': body, 'elements': elements}
