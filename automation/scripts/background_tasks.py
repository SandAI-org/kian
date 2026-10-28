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
        self.data.update(values)
        now = time.time()
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
            tasks.append(item)
        except (OSError, ValueError, KeyError):
            continue
    return tasks
