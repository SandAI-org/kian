#!/usr/bin/env python3
"""Reliable daily file transfer using SSH config aliases and rsync progress.

Endpoint syntax:
  local path:  file.patch, /absolute/path, local:/absolute/path
    remote path: example-machine:/remote/project

Remote-to-remote transfers are staged through a local temporary directory so
neither server needs SSH access to the other.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

try:
    from .automation_common import load_config
    from .background_tasks import BackgroundTask
except ImportError:
    from automation_common import load_config
    from background_tasks import BackgroundTask

TRANSFER_CONFIG = load_config().get("file_transfer", {})
DOWNLOADS = Path(TRANSFER_CONFIG.get("downloads", "~/Downloads")).expanduser()
MACHINES: dict[str, tuple[str, tuple[tuple[str, str], ...]]] = {}
for name, machine in TRANSFER_CONFIG.get("machines", {}).items():
    if not isinstance(machine, dict):
        continue
    host = str(machine.get("ssh_host", "")).strip()
    mappings = tuple(
        (str(item["from"]), str(item["to"]))
        for item in machine.get("path_mappings", [])
        if isinstance(item, dict) and "from" in item and "to" in item
    )
    if host:
        MACHINES[name] = (host, mappings)


@dataclass(frozen=True)
class Endpoint:
    host: str | None
    path: str

    @property
    def remote(self) -> bool:
        return self.host is not None

    def rsync_value(self) -> str:
        return f"{self.host}:{shlex.quote(self.path)}" if self.host else self.path


def translate_remote(machine: str, path: str) -> Endpoint:
    if machine not in MACHINES:
        raise ValueError(f"Unknown machine {machine!r}; choices: {', '.join(sorted(MACHINES))}")
    host, mappings = MACHINES[machine]
    normalized = str(PurePosixPath(path))
    for container, host_mount in sorted(mappings, key=lambda item: len(item[0]), reverse=True):
        if normalized == container or normalized.startswith(container + "/"):
            normalized = host_mount + normalized[len(container):]
            break
    return Endpoint(host, normalized)


def parse_endpoint(value: str, *, local_default_downloads: bool) -> Endpoint:
    if value.startswith("local:"):
        value = value[6:]
    elif ":" in value:
        machine, path = value.split(":", 1)
        if machine in MACHINES:
            return translate_remote(machine, path)
    path = Path(value).expanduser()
    if not path.is_absolute() and local_default_downloads:
        path = DOWNLOADS / path
    return Endpoint(None, str(path))


def parse_progress(line: str):
    match = re.match(r"^\s*([\d,]+)\s+(\d+)%\s+([\d.]+\s*[kMGT]?B/s)\s+(\d+:\d+:\d+)", line)
    if not match:
        return None
    return dict(bytes_done=int(match[1].replace(',', '')), transfer_percent=int(match[2]),
                speed=match[3], eta=match[4])


def run(command: list[str], progress=None) -> None:
    print("+", " ".join(shlex.quote(part) for part in command), flush=True)
    last_error = None
    for attempt in range(3):
        try:
            if progress is None:
                subprocess.run(command, check=True)
            else:
                progress.update(stage='transferring', attempt=attempt + 1)
                with subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                      text=True, bufsize=1) as child:
                    try:
                        for line in child.stdout:
                            print(line, end='', flush=True)
                            values = parse_progress(line)
                            if values:
                                progress.update(force=False, **values)
                        if child.wait():
                            raise subprocess.CalledProcessError(child.returncode, command)
                    except BaseException:
                        if child.poll() is None:
                            child.terminate()
                            try:
                                child.wait(timeout=10)
                            except subprocess.TimeoutExpired:
                                child.kill()
                                child.wait()
                        raise
            return
        except subprocess.CalledProcessError as error:
            last_error = error
            if attempt < 2:
                if progress:
                    progress.update(stage='retrying', attempt=attempt + 2)
                print(f"RETRY {attempt + 2}/3 after transfer connection failure", flush=True)
                time.sleep(2 * (attempt + 1))
    raise last_error or RuntimeError("command failed")


def ssh(host: str, command: str) -> str:
    last_error = None
    for attempt in range(3):
        try:
            result = subprocess.run(
                ["ssh", "-o", "ConnectTimeout=15", "-o", "ConnectionAttempts=3", host, command],
                check=True,
                text=True,
                stdout=subprocess.PIPE,
            )
            return result.stdout.strip()
        except subprocess.CalledProcessError as error:
            last_error = error
            if attempt < 2:
                print(f"SSH_RETRY {attempt + 2}/3 host={host}", flush=True)
                time.sleep(2 * (attempt + 1))
    raise last_error or RuntimeError(f"SSH command failed: {host}")


def ensure_target(endpoint: Endpoint, into_dir: bool) -> None:
    target_dir = endpoint.path if into_dir else str(PurePosixPath(endpoint.path).parent)
    if endpoint.remote:
        ssh(endpoint.host or "", f"mkdir -p {shlex.quote(target_dir)}")
    else:
        Path(target_dir).mkdir(parents=True, exist_ok=True)


def rsync(source: Endpoint, destination: Endpoint, into_dir: bool, source_is_file: bool, progress=None) -> None:
    source_value = source.rsync_value()
    # For an exact directory destination, copy the directory contents rather
    # than nesting the source basename again when the destination exists.
    if not source_is_file and not into_dir and not source_value.endswith("/"):
        source_value += "/"
    target = destination.path
    if into_dir and not target.endswith("/"):
        target += "/"
    dest = Endpoint(destination.host, target)
    run(["rsync", "-ah", "--partial", "--progress", "-e", "ssh", source_value, dest.rsync_value()], progress)


def local_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def target_file(source: Endpoint, destination: Endpoint, into_dir: bool) -> Endpoint:
    if not into_dir:
        return destination
    name = PurePosixPath(source.path.rstrip("/")).name
    return Endpoint(destination.host, str(PurePosixPath(destination.path) / name))


def verify_file(source: Endpoint, destination: Endpoint, into_dir: bool):
    src = source
    dst = target_file(source, destination, into_dir)
    if src.remote:
        src_meta = ssh(src.host or "", f"stat -c '%s' {shlex.quote(src.path)}; sha256sum {shlex.quote(src.path)} | awk '{{print $1}}'").splitlines()
    else:
        path = Path(src.path)
        src_meta = [str(path.stat().st_size), local_sha256(path)]
    if dst.remote:
        dst_meta = ssh(dst.host or "", f"stat -c '%s' {shlex.quote(dst.path)}; sha256sum {shlex.quote(dst.path)} | awk '{{print $1}}'").splitlines()
    else:
        path = Path(dst.path)
        dst_meta = [str(path.stat().st_size), local_sha256(path)]
    if src_meta[:2] != dst_meta[:2]:
        raise RuntimeError(f"Verification failed: source={src_meta[:2]}, destination={dst_meta[:2]}")
    print(f"TRANSFER_VERIFIED size={dst_meta[0]} sha256={dst_meta[1]}")
    return {'verification': 'sha256', 'size': int(dst_meta[0]), 'sha256': dst_meta[1]}


def is_file(endpoint: Endpoint) -> bool:
    if endpoint.remote:
        return ssh(endpoint.host or "", f"if test -f {shlex.quote(endpoint.path)}; then echo yes; else echo no; fi") == "yes"
    return Path(endpoint.path).is_file()


def direct_transfer(source: Endpoint, destination: Endpoint, into_dir: bool, progress=None):
    if progress:
        progress.update(stage='preparing', transfer_percent=None, bytes_done=0, speed=None, eta=None)
    ensure_target(destination, into_dir)
    source_is_file = is_file(source)
    if progress:
        size = (int(ssh(source.host, f"stat -c '%s' {shlex.quote(source.path)}")) if source.remote
                else Path(source.path).stat().st_size) if source_is_file else None
        progress.update(total_bytes=size, source_is_file=source_is_file)
    rsync(source, destination, into_dir, source_is_file, progress)
    if source_is_file:
        if progress:
            progress.update(stage='verifying', transfer_percent=100)
        result = verify_file(source, destination, into_dir)
    else:
        print("TRANSFER_COMPLETE directory transferred with rsync item checks")
        result = {'verification': 'rsync_checks'}
    if progress:
        progress.update(**result)
    return result


def transfer(source: Endpoint, destination: Endpoint, into_dir: bool, progress=None):
    if not (source.remote and destination.remote):
        if progress:
            progress.update(phase_index=1, phase_total=1)
        return direct_transfer(source, destination, into_dir, progress)
    basename = PurePosixPath(source.path.rstrip("/")).name
    with tempfile.TemporaryDirectory(prefix="kian-transfer-") as temp_dir:
        staging = Endpoint(None, str(Path(temp_dir) / basename))
        print(f"STAGE 1/2: {source.host} -> local temporary storage")
        if progress:
            progress.update(phase_index=1, phase_total=2, phase='download_to_staging')
        direct_transfer(source, staging, False, progress)
        print(f"STAGE 2/2: local temporary storage -> {destination.host}")
        if progress:
            progress.update(phase_index=2, phase_total=2, phase='upload_from_staging')
        return direct_transfer(staging, destination, into_dir, progress)


def main() -> None:
    parser = argparse.ArgumentParser(description="Upload, download, or sync files with visible progress")
    parser.add_argument("source", help="local path or machine:path")
    parser.add_argument("destination", help="local path or machine:path")
    parser.add_argument("--into-dir", action="store_true", help="treat destination as a directory")
    args = parser.parse_args()
    source = parse_endpoint(args.source, local_default_downloads=True)
    destination = parse_endpoint(args.destination, local_default_downloads=True)
    direction = 'sync' if source.remote and destination.remote else 'download' if source.remote else 'upload' if destination.remote else 'copy'
    title = PurePosixPath(source.path.rstrip('/')).name if args.into_dir else PurePosixPath(destination.path.rstrip('/')).name
    with BackgroundTask(title, 'file_transfer', direction=direction,
                        source=source.rsync_value(), destination=destination.rsync_value()) as progress:
        if not source.remote and not Path(source.path).exists():
            raise FileNotFoundError(source.path)
        print(f"SOURCE:      {source.rsync_value()}")
        print(f"DESTINATION: {destination.rsync_value()}")
        transfer(source, destination, args.into_dir, progress)


if __name__ == "__main__":
    main()
