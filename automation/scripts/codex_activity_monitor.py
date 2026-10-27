#!/usr/bin/env python3
"""Read allowlisted remote Codex turn history and deliver durable completion cards."""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
import fcntl
import json
import os
from pathlib import Path
import shlex
import sqlite3
import subprocess
import time
import uuid
from zoneinfo import ZoneInfo

TERMINAL = {'completed', 'failed', 'interrupted'}


def collect(home, workspaces, since):
    """Executed remotely with only SQLite read-only connections, no Codex client."""
    home = Path(home)
    state = sorted(home.glob('state_*.sqlite'))
    history = sorted(home.glob('thread_history_*.sqlite'))
    if not state or not history:
        raise RuntimeError('Codex state/history database unavailable')
    def connect(path):
        db = sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True, timeout=5)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA query_only=ON')
        return db
    with connect(state[-1]) as db, connect(history[-1]) as hist:
        threads = [dict(r) for r in db.execute(
            "SELECT id,name,title,cwd FROM threads WHERE archived=0 AND name LIKE 'Kato %'")
                   if r['cwd'].rstrip('/') in workspaces]
        turns = []
        for thread in threads:
            latest_user = hist.execute(
                "SELECT MAX(rollout_ordinal) FROM thread_items WHERE thread_id=? "
                "AND item_type='userMessage'", (thread['id'],)).fetchone()[0]
            for row in hist.execute(
                'SELECT turn_id,status,started_at,completed_at,error_json,final_agent_item_id,'
                'rollout_end_ordinal FROM thread_turns WHERE thread_id=? AND '
                '(started_at>=? OR completed_at>=? OR status=?) AND '
                "(status!='inProgress' OR rollout_ordinal=(SELECT MAX(t.rollout_ordinal) "
                'FROM thread_turns t WHERE t.thread_id=thread_turns.thread_id)) '
                'ORDER BY rollout_ordinal',
                (thread['id'], since, since, 'inProgress')):
                turn = dict(row)
                turn.update(thread_id=thread['id'], name=thread['name'], cwd=thread['cwd'])
                turn['summary'] = ''
                turn['reply_ordinal'] = turn.pop('rollout_end_ordinal')
                turn['latest_user_ordinal'] = latest_user
                if turn['final_agent_item_id']:
                    item = hist.execute('SELECT item_json,rollout_ordinal FROM thread_items '
                                        'WHERE thread_id=? AND item_id=?',
                                        (thread['id'], turn['final_agent_item_id'])).fetchone()
                    if item:
                        turn['reply_ordinal'] = item[1]
                        content = json.loads(item[0])
                        if content.get('type') == 'agentMessage':
                            turn['summary'] = content.get('text', '')[:3000]
                turn.pop('final_agent_item_id')
                # Do not ship raw tool output, reasoning, credentials or error payloads.
                turn['has_error'] = bool(turn.pop('error_json'))
                turns.append(turn)
    return {'observed_at': time.time(), 'threads': threads, 'turns': turns}


def remote_snapshot(target, since):
    import inspect
    source = 'import json,sqlite3,time\nfrom pathlib import Path\n' + inspect.getsource(collect)
    args = [target.get('codex_home', '/root/.codex'), target['workspaces'], since]
    source += '\nprint(json.dumps(collect(*json.loads(' + repr(json.dumps(args)) + ')),ensure_ascii=False))\n'
    command = ['python3', '-']
    if target.get('container'):
        command = ['docker', 'exec', '-i', target['container'], *command]
    result = subprocess.run(
        ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
         target['host'], shlex.join(command)], input=source, text=True,
        capture_output=True, timeout=35)
    if result.returncode:
        raise RuntimeError(f"SSH/collector failed ({result.returncode})")
    return json.loads(result.stdout)


def event_key(target_id, turn):
    return f"{target_id}/{turn['thread_id']}/{turn['turn_id']}"


def ingest(state, target, snapshot):
    target_id = target['id']
    previous = state.setdefault('targets', {}).get(target_id)
    initial = previous is None
    previous = previous or {'baseline': snapshot['observed_at'], 'active': {}, 'seen': {}}
    for turn in snapshot['turns']:
        key = event_key(target_id, turn)
        if turn['status'] == 'inProgress':
            previous['active'][key] = turn.get('started_at') or previous['baseline']
        elif turn['status'] in TERMINAL:
            watched = key in previous['active']
            new = (turn.get('started_at') or 0) >= previous['baseline']
            if not initial and (watched or new) and key not in previous['seen']:
                state.setdefault('outbox', {})[key] = dict(
                    turn, target=target.get('label', target_id), host=target['host'],
                    container=target.get('container'), uuid=str(uuid.uuid5(uuid.NAMESPACE_URL, key)))
                previous['seen'][key] = turn['status']
            previous['active'].pop(key, None)
    previous['last_poll'] = snapshot['observed_at']
    state['targets'][target_id] = previous


def card(turn):
    status = turn['status']
    label = {'completed': '本轮结束', 'failed': '执行失败', 'interrupted': '已中断'}[status]
    icon = {'completed': '✅', 'failed': '❌', 'interrupted': '⏹'}[status]
    def clock(value):
        return datetime.fromtimestamp(value, ZoneInfo('Asia/Shanghai')).strftime('%m-%d %H:%M:%S') if value else '未知'
    summary = turn.get('summary') or '未记录最终回复，请回到对应 workspace 查看。'
    context = f"**{turn['target']}**\nWorkspace 路径：{turn['cwd']}"
    timing = (f"**状态：** {label}\n"
              f"**开始：** {clock(turn.get('started_at'))}\n"
              f"**结束：** {clock(turn.get('completed_at'))}（北京时间）")
    elements = [
        {"tag": "markdown", "content": context},
        {"tag": "markdown", "content": timing},
        {"tag": "hr"},
        {"tag": "markdown", "content": "**💬 Agent 回复**"},
        {"tag": "markdown", "content": summary},
        {"tag": "hr"},
        {"tag": "note", "elements": [{"tag": "plain_text", "content":
            f"Turn：{turn['turn_id']}\n以上为远程 Agent 本轮回复；后台任务可能仍在运行。"}]},
    ]
    return f"{icon} Codex 工作通知 · {turn['name']}", elements


def save(path, state):
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(state, ensure_ascii=False, indent=2) + '\n')
    temp.chmod(0o600)
    os.replace(temp, path)


def acknowledged(turn):
    reply = turn.get('reply_ordinal')
    user = turn.get('latest_user_ordinal')
    return reply is not None and user is not None and user > reply


def stale_before_send(target, pending):
    snapshot = remote_snapshot(target, pending.get('started_at') or 0)
    for turn in snapshot['turns']:
        if (turn['thread_id'], turn['turn_id']) == (pending['thread_id'], pending['turn_id']):
            if turn['status'] not in TERMINAL:
                raise RuntimeError('Turn no longer terminal')
            if turn.get('reply_ordinal') is None:
                raise RuntimeError('Cannot confirm reply position')
            return acknowledged(turn)
    raise RuntimeError('Cannot confirm pending turn')


def deliver(state, persist, sender, is_stale):
    for key, turn in list(state.get('outbox', {}).items()):
        try:
            if is_stale(key, turn):
                del state['outbox'][key]
                persist()
                print(f'DROPPED_ACKNOWLEDGED {key}', flush=True)
                continue
            title, elements = card(turn)
            response = sender(title, "", elements=elements, template='green' if turn['status'] == 'completed' else 'orange',
                              message_uuid=turn['uuid'])
            if not isinstance(response, dict) or response.get('code') != 0:
                raise RuntimeError('Feishu rejected card')
        except Exception as exc:
            print(f'DELIVERY_PENDING {key} {type(exc).__name__}', flush=True)
            continue
        del state['outbox'][key]
        persist()
        print(f'DELIVERED {key}', flush=True)


def run(config, path, dry_run=False):
    from feishu_remind import send
    state = json.loads(path.read_text()) if path.exists() else {'targets': {}, 'outbox': {}}
    targets = [t for t in config['codex_activity_monitor']['targets'] if t.get('enabled', True)]
    def poll(target):
        old = state.get('targets', {}).get(target['id'], {})
        since = min([old.get('last_poll', time.time()) - 120, *old.get('active', {}).values()])
        try:
            return target, remote_snapshot(target, since), None
        except Exception as exc:
            return target, None, type(exc).__name__
    with ThreadPoolExecutor(max_workers=4) as pool:
        for target, snapshot, error in pool.map(poll, targets):
            if error:
                print(f"UNAVAILABLE {target['id']} {error}", flush=True)
                continue
            ingest(state, target, snapshot)
            print(f"OBSERVED {target['id']} threads={len(snapshot['threads'])} "
                  f"working={sum(t['status']=='inProgress' for t in snapshot['turns'])}", flush=True)
    if dry_run:
        print(json.dumps({'active': {k: len(v['active']) for k, v in state['targets'].items()},
                          'pending': len(state.get('outbox', {}))}))
        return
    persist = lambda: save(path, state)
    persist()  # Commit observation and pending notifications before contacting Feishu.
    by_id = {t['id']: t for t in targets}
    def is_stale(key, turn):
        target_id = key.split('/')[0]
        if target_id not in by_id:
            raise RuntimeError('Target disabled or removed')
        return stale_before_send(by_id[target_id], turn)
    deliver(state, persist, send, is_stale)


def main():
    from automation_common import STATE_DIR, load_config
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dry-run', action='store_true', help='read status without state writes or notifications')
    args = parser.parse_args()
    config = load_config()
    if not config.get('services', {}).get('codex_activity_monitor', {}).get('enabled', False):
        return
    path = STATE_DIR / 'codex-activity-monitor.json'
    with (STATE_DIR / 'codex-activity-monitor.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        run(config, path, args.dry_run)


if __name__ == '__main__':
    main()
