#!/usr/bin/env python3
"""Observe a running PyTorch Ninja extension build without restarting it."""
import argparse
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import time


def compile_outputs(text):
    outputs = set()
    for line in text.splitlines():
        match = re.match(r'^build (.+): (?:cuda_compile|compile)(?: |$)', line)
        if match:
            # PyTorch extensions use these two rules and one output per edge.
            outputs.add(match[1].replace('$ ', ' ').replace('$:', ':').replace('$$', '$'))
    return outputs


def finished_outputs(text, expected):
    return {fields[3] for line in text.splitlines()
            if len(fields := line.split('\t')) >= 5 and fields[3] in expected}


def snapshot(prefix, status_path):
    parent = json.loads(Path(status_path).read_text())
    result = {'parent': parent, 'observed_at': time.time()}
    matches = []
    for proc in Path('/proc').iterdir():
        if not proc.name.isdigit():
            continue
        try:
            if (proc / 'comm').read_text().strip() != 'ninja':
                continue
            cwd = os.readlink(proc / 'cwd')
            if not (cwd == prefix or cwd.startswith(prefix.rstrip('/') + '/')):
                continue
            stat = (proc / 'stat').read_text().rsplit(')', 1)[1].split()
            matches.append((proc, cwd, stat[19]))
        except (OSError, ValueError):
            continue
    if len(matches) != 1:
        return {**result, 'state': 'ambiguous' if matches else 'not_found'}
    proc, cwd, started = matches[0]
    directory = proc / 'root' / cwd.lstrip('/')
    expected = compile_outputs((directory / 'build.ninja').read_text())
    log = directory / '.ninja_log'
    done = finished_outputs(log.read_text() if log.exists() else '', expected)
    return {**result, 'state': 'compiling', 'pid': int(proc.name),
            'process_start': started, 'build_directory': cwd,
            'total': len(expected), 'done': len(done)}


def parent_step(label):
    match = re.search(r'\[stage-\d+\s+(\d+)/(\d+)\]', label or '')
    return int(match[1]) if match else None


def monitor(args):
    from background_tasks import BackgroundTask
    zh = args.language == 'zh'
    with BackgroundTask(args.title, 'ninja-build', source=args.host,
                        destination=args.cwd_prefix) as task:
        seen = None
        while True:
            command = shlex.join(['python3', '-', '--remote', '--cwd-prefix', args.cwd_prefix,
                                  '--build-status', args.build_status])
            try:
                remote = subprocess.run(
                    ['ssh', '-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8',
                     '-o', 'ServerAliveInterval=5', '-o', 'ServerAliveCountMax=2',
                     args.host, command], input=Path(__file__).read_text(),
                    capture_output=True, text=True, timeout=30)
                remote.check_returncode()
                current = json.loads(remote.stdout)
            except (subprocess.SubprocessError, json.JSONDecodeError):
                task.update(stage='running', progress_percent=None,
                            count_label='连接重试，远端编译不受影响' if zh else 'Reconnecting; remote build is independent')
                time.sleep(10)
                continue
            parent = current['parent']
            if parent['status'] == 'failed':
                task.update(error_detail=parent.get('label'), progress_percent=None)
                raise RuntimeError('ParentBuildFailed')
            if seen and (parent['build_sha'], parent['started_at']) != (seen['parent']['build_sha'], seen['parent']['started_at']):
                task.update(error_detail='Parent build changed; attach a new observer')
                raise RuntimeError('ParentBuildChanged')
            if current['state'] == 'compiling' and current['total']:
                seen = current
                percent = round(100 * current['done'] / current['total'], 1)
                label = (f"{current['done']} / {current['total']} 个编译单元 · {percent}%（不含链接/安装）"
                         if zh else f"{current['done']} / {current['total']} compile units · {percent}% (excludes link/install)")
                task.update(stage='running', progress_percent=percent, count_label=label,
                            compile_done=current['done'], compile_total=current['total'],
                            remote_ninja_pid=current['pid'], remote_observed_at=current['observed_at'])
                if current['done'] == current['total']:
                    break
            elif seen and current['state'] == 'not_found':
                step = parent_step(parent.get('label'))
                previous = parent_step(seen['parent'].get('label'))
                if parent['status'] == 'completed' or (step and previous and step > previous):
                    task.update(stage='completed', progress_percent=100,
                                compile_done=seen['total'], compile_total=seen['total'],
                                count_label='编译阶段已完成，父镜像构建继续' if zh else 'Compile stage completed; parent build continues')
                    break
                task.update(stage='running', progress_percent=None,
                            count_label='等待确认编译阶段结果' if zh else 'Waiting to confirm compile stage result')
            else:
                if parent['status'] == 'completed':
                    task.update(stage='completed', progress_percent=None,
                                count_label='父构建已完成，未采集到编译计数' if zh else 'Parent finished; compilation counts were not observed')
                    break
                task.update(stage='running', progress_percent=None,
                            count_label='尚未发现唯一 Ninja 编译进程' if zh else 'No unique Ninja compiler found yet')
            time.sleep(10)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--remote', action='store_true')
    parser.add_argument('--host')
    parser.add_argument('--cwd-prefix', required=True)
    parser.add_argument('--build-status', required=True)
    parser.add_argument('--title', default='FA3 Ninja compilation')
    parser.add_argument('--language', choices=['zh', 'en'], default='zh')
    args = parser.parse_args()
    if args.remote:
        print(json.dumps(snapshot(args.cwd_prefix, args.build_status)))
    else:
        if not args.host:
            parser.error('--host is required')
        monitor(args)
