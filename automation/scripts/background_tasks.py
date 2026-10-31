#!/usr/bin/env python3
"""Private progress records shared by Kian background operations and their dashboard."""
import json
import os
from pathlib import Path
import subprocess
import time
import uuid

try:
    from .automation_common import STATE_DIR
except ImportError:
    from automation_common import STATE_DIR


def process_start(pid):
    result = subprocess.run(['ps', '-p', str(pid), '-o', 'lstart='], capture_output=True, text=True,
                            env={**os.environ, 'LC_ALL': 'C'})
    return result.stdout.strip() if result.returncode == 0 else None


TRANSFER_STAGES = {'transferring', 'download_to_staging', 'upload_from_staging', 'upload_to_idg'}


def task_metrics(item, now):
    end = item.get('completed_at', now)
    if item.get('started_at') is not None:
        item['elapsed_seconds'] = max(0, end - item['started_at'])
    seconds = item.get('transfer_seconds', 0)
    transferred = item.get('transferred_bytes', 0)
    if item.get('transfer_started_at') is not None:
        seconds += max(0, end - item['transfer_started_at'])
        transferred += max(0, item.get('bytes_done', 0) - item.get('transfer_bytes_at_start', 0))
    item['transfer_elapsed_seconds'] = seconds
    if seconds > 0 and transferred > 0 and item.get('source_is_file') is not False:
        item['average_transfer_bytes_per_second'] = transferred / seconds
    size = item.get('total_bytes')
    if item.get('status') == 'completed' and size is not None and item.get('elapsed_seconds', 0) > 0:
        item['average_effective_bytes_per_second'] = size / item['elapsed_seconds']
    item.pop('current_phase_bytes_per_second', None)
    item.pop('estimated_remaining_seconds', None)
    if item.get('transfer_started_at') is not None and size is not None and item.get('source_is_file') is not False:
        phase_seconds = max(0, end - item['transfer_started_at'])
        phase_bytes = max(0, item.get('bytes_done', 0) - item.get('transfer_bytes_at_start', 0))
        if phase_seconds > 0 and phase_bytes > 0:
            item['current_phase_bytes_per_second'] = phase_bytes / phase_seconds
            item['estimated_remaining_seconds'] = max(0, size - item.get('bytes_done', 0)) * phase_seconds / phase_bytes
    return item


class BackgroundTask:
    def __init__(self, title, kind, directory=None, **details):
        self.directory = Path(directory) if directory is not None else STATE_DIR / 'background-tasks'
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path = self.directory / (str(uuid.uuid4()) + '.json')
        self.data = {'id': self.path.stem, 'title': title, 'kind': kind, 'status': 'running',
                     'started_at': time.time(), 'pid': os.getpid(), 'pid_start': process_start(os.getpid()),
                     **details}
        self.last_write = 0

    def update(self, force=True, **values):
        now = time.time()
        previous = (self.data.get('stage'), self.data.get('phase_index'), self.data.get('attempt'))
        previous_bytes = self.data.get('bytes_done', 0)
        self.data.update(values)
        current = (self.data.get('stage'), self.data.get('phase_index'), self.data.get('attempt'))
        transferring = self.data.get('status') == 'running' and current[0] in TRANSFER_STAGES
        if self.data.get('transfer_started_at') is not None and (current != previous or not transferring):
            self.data['transfer_seconds'] = self.data.get('transfer_seconds', 0) + max(0, now - self.data.pop('transfer_started_at'))
            # A new phase/retry may reset bytes_done to zero; finish the old counter first.
            done = previous_bytes if current != previous else self.data.get('bytes_done', 0)
            self.data['transferred_bytes'] = self.data.get('transferred_bytes', 0) + max(0, done - self.data.pop('transfer_bytes_at_start', 0))
        if transferring and self.data.get('transfer_started_at') is None:
            self.data['transfer_started_at'] = now
            self.data['transfer_bytes_at_start'] = self.data.get('bytes_done', 0)
        task_metrics(self.data, now)
        if not force and now - self.last_write < 1:
            return
        self.data['updated_at'] = now
        temporary = self.path.with_suffix('.tmp')
        temporary.write_text(json.dumps(self.data, ensure_ascii=False, indent=2) + '\n')
        temporary.chmod(0o600)
        temporary.replace(self.path)
        self.last_write = now

    def __enter__(self):
        self.update()
        return self

    def __exit__(self, kind, value, traceback):
        if kind is not None:
            status = 'interrupted' if issubclass(kind, (KeyboardInterrupt, SystemExit)) else 'failed'
            self.update(status=status, completed_at=time.time(), error=kind.__name__)
        else:
            self.update(status='completed', completed_at=time.time())


def read_tasks(directory=None, limit=100):
    directory = Path(directory) if directory is not None else STATE_DIR / 'background-tasks'
    paths = sorted(directory.glob('*.json'), key=lambda p: p.stat().st_mtime, reverse=True)[:limit]
    tasks = []
    for path in paths:
        try:
            item = json.loads(path.read_text())
            if item.get('status') == 'running':
                started = process_start(item['pid'])
                if started is None or (item.get('pid_start') and started != item['pid_start']):
                    item['status'] = 'unknown'
                    item['error'] = 'WorkerExited'
            task_metrics(item, time.time() if item.get('status') == 'running' else item.get('completed_at', item.get('updated_at', time.time())))
            tasks.append(item)
        except (OSError, ValueError, KeyError):
            continue
    return tasks
