#!/usr/bin/env python3
"""One-shot, persistent GPU availability watches delivered through Kian/Feishu."""
import argparse
import fcntl
import json
import math
import re
import subprocess
import time
import uuid
import xml.etree.ElementTree as ET

from automation_common import STATE_DIR

STATE = STATE_DIR / 'gpu-idle-watches.json'
COPY = {
    'zh': {
        'title': 'GPU 已空闲 · {label} · {count}/{total} 张',
        'body': '**机器：** {host}\n**已稳定空闲：** GPU {indices}\n**确认时长：** 连续 {seconds} 秒\n\n这些卡无 GPU 进程、显存 ≤ {memory} MiB、利用率 ≤ 1%。本次条件为至少 {required} 张，已满足。\n\n本次提醒已结束；未预占 GPU，使用前请再次确认。',
    },
    'en': {
        'title': 'GPUs available · {label} · {count}/{total}',
        'body': '**Host:** {host}\n**Stably idle:** GPU {indices}\n**Confirmed for:** {seconds} seconds\n\nNo GPU processes, memory ≤ {memory} MiB and utilization ≤ 1%. The requested threshold of {required} GPU(s) is met.\n\nThis one-shot watch has ended. GPUs are not reserved; check again before use.',
    },
}


def parse_snapshot(raw):
    root = ET.fromstring(raw)
    cards = []
    for gpu in root.findall('gpu'):
        processes = gpu.find('processes')
        if processes is None or (processes.text or '').strip() == 'N/A':
            raise ValueError('GPU process information unavailable')
        memory = float(gpu.findtext('fb_memory_usage/used').split()[0])
        utilization = float(gpu.findtext('utilization/gpu_util').split()[0])
        ident = gpu.findtext('uuid')
        index = gpu.findtext('minor_number')
        if not ident or index is None or not math.isfinite(memory) or not math.isfinite(utilization):
            raise ValueError('Incomplete GPU snapshot')
        cards.append(dict(uuid=ident, index=index, memory_mib=memory, utilization=utilization,
                          processes=len(processes.findall('process_info')),
                          mig=gpu.findtext('mig_mode/current_mig') == 'Enabled'))
    if (not cards or len({g['uuid'] for g in cards}) != len(cards) or
            int(root.findtext('attached_gpus', str(len(cards)))) != len(cards)):
        raise ValueError('Missing or duplicate GPUs')
    return cards


def snapshot(host):
    result = subprocess.run(
        ['ssh', '-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8',
         '-o', 'ServerAliveInterval=5', '-o', 'ServerAliveCountMax=2', host, 'nvidia-smi -q -x'],
        capture_output=True, text=True, timeout=35, check=True)
    # Some hosts prepend an SSH login banner to stdout.
    offset = result.stdout.find('<?xml')
    if offset < 0:
        offset = result.stdout.find('<nvidia_smi_log')
    if offset < 0:
        raise ValueError('No NVIDIA XML snapshot')
    return parse_snapshot(result.stdout[offset:])


def evaluate(job, cards, now):
    identities = sorted(g['uuid'] for g in cards)
    if job.setdefault('gpu_uuids', identities) != identities:
        raise ValueError('GPU inventory changed; require a complete original snapshot')
    previous = job.get('last_sample')
    since = job.setdefault('idle_since', {})
    if previous is None or not 0 < now - previous <= 150:
        since.clear()
    job['last_sample'] = now
    current = {g['uuid'] for g in cards}
    since_keys = list(since)
    for ident in since_keys:
        if ident not in current:
            del since[ident]
    ready = []
    for gpu in cards:
        idle = (not gpu['mig'] and gpu['processes'] == 0 and
                gpu['memory_mib'] <= job['max_memory_mib'] and gpu['utilization'] <= 1)
        if not idle:
            since.pop(gpu['uuid'], None)
            continue
        since.setdefault(gpu['uuid'], now)
        if now - since[gpu['uuid']] >= job['stable_seconds']:
            ready.append(gpu)
    job['gpu_total'] = len(cards)
    job['stable_free_indices'] = [g['index'] for g in ready]
    required = len(cards) if job['min_free'] == 'all' else job['min_free']
    return ready if len(ready) >= required else []


def save(state):
    tmp = STATE.with_suffix('.tmp')
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2) + '\n')
    tmp.chmod(0o600)
    tmp.replace(STATE)


def check_jobs(state, persist, probe, sender, now=None):
    for job in state['jobs']:
        if job['status'] != 'watching':
            continue
        try:
            cards = probe(job['host'])
            ready = evaluate(job, cards, time.time() if now is None else now)
            job.pop('last_error', None)
        except (subprocess.SubprocessError, OSError, ValueError, AttributeError, ET.ParseError):
            job['idle_since'] = {}
            job.pop('last_sample', None)
            job['stable_free_indices'] = []
            job['last_error'] = 'GPU snapshot unavailable; stability window reset'
            persist(state)
            continue
        persist(state)
        if not ready:
            continue
        values = dict(label=job['label'], host=job['host'], count=len(ready), total=len(cards),
                      indices=', '.join(g['index'] for g in ready), seconds=job['stable_seconds'],
                      memory=job['max_memory_mib'],
                      required=len(cards) if job['min_free'] == 'all' else job['min_free'])
        copy = COPY[job['language']]
        try:
            result = sender(copy['title'].format(**values), copy['body'].format(**values),
                            message_uuid=job['id'])
            if result.get('code', 0) != 0:
                raise RuntimeError('Feishu rejected GPU availability notice')
        except Exception:
            job['last_error'] = 'Feishu delivery failed; retry after a fresh GPU snapshot'
            persist(state)
            continue
        job.update(status='notified', notified_at=time.time() if now is None else now,
                   notified_indices=values['indices'], message_id=result.get('data', {}).get('message_id'))
        persist(state)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command')
    add = commands.add_parser('add')
    add.add_argument('--host', required=True)
    add.add_argument('--label')
    add.add_argument('--min-free', default='all')
    add.add_argument('--stable-seconds', type=int, default=180)
    add.add_argument('--max-memory-mib', type=int, default=256)
    add.add_argument('--language', choices=COPY, default='zh')
    commands.add_parser('list')
    cancel = commands.add_parser('cancel')
    cancel.add_argument('id')
    args = parser.parse_args()
    STATE.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with STATE.with_suffix('.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        state = json.loads(STATE.read_text()) if STATE.exists() else {'jobs': []}
        if args.command == 'add':
            if not re.fullmatch(r'[A-Za-z0-9_@.][A-Za-z0-9_@.\-]*', args.host):
                parser.error('Invalid SSH host alias')
            try:
                required = 'all' if args.min_free == 'all' else int(args.min_free)
            except ValueError:
                parser.error('--min-free must be all or a positive integer')
            if required != 'all' and required < 1 or args.stable_seconds < 60 or args.max_memory_mib < 0:
                parser.error('Use a positive GPU count, stability >= 60 seconds and nonnegative memory')
            cards = snapshot(args.host)
            if required != 'all' and required > len(cards):
                parser.error('Requested count exceeds visible physical GPUs')
            job = dict(id=str(uuid.uuid4()), status='watching', host=args.host,
                       label=args.label or args.host, min_free=required,
                       stable_seconds=args.stable_seconds, max_memory_mib=args.max_memory_mib,
                       language=args.language, created_at=time.time())
            evaluate(job, cards, time.time())
            state['jobs'].append(job)
            save(state)
            print(json.dumps(job, ensure_ascii=False))
        elif args.command == 'list':
            print(json.dumps(state, ensure_ascii=False, indent=2))
        elif args.command == 'cancel':
            job = next(j for j in state['jobs'] if j['id'] == args.id)
            job['status'] = 'cancelled'
            save(state)
        else:
            from feishu_remind import send
            check_jobs(state, save, snapshot, send)


if __name__ == '__main__':
    main()
