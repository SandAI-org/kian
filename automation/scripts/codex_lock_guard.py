#!/usr/bin/env python3
"""Release idle Codex writers belonging to replaced VS Code connections."""
from __future__ import annotations

import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import shlex
import signal
import sqlite3
import subprocess
import sys
import time


THREAD = re.compile(r"thread ([0-9a-f-]{36}) already has an active writer")
CONNECTION = re.compile(r"renderer-ExtensionHost-([0-9a-f-]{36})\) was successful")
PROC = Path("/proc")


def tail(path, limit=2 * 1024 * 1024):
    with path.open("rb") as handle:
        handle.seek(max(0, path.stat().st_size - limit))
        return handle.read().decode(errors="replace")


def window_connections(text):
    segments = re.split(r"Started local extension host with pid (\d+)\.", text)
    if len(segments) < 3:
        return None
    pid, current = int(segments[-2]), segments[-1]
    authority = re.search(r"remoteAuthority=([^\s)]+)", current)
    if not authority:
        return None
    host = re.search(r"ssh-remote\+([0-9a-f]+)", authority[1])
    container = re.search(r"attached-container\+([0-9a-f]+)", authority[1])
    if not host:
        return None
    host = json.loads(bytes.fromhex(host[1]))["hostName"]
    container = json.loads(bytes.fromhex(container[1]))["containerName"].lstrip("/") if container else None
    ids = CONNECTION.findall(current)
    if not ids:
        return None
    active = ids[-1][:8]
    old = {i[:8] for i in CONNECTION.findall(text)} - {active}
    return pid, (host, container), active, old


def local_connections(log_root):
    processes = subprocess.check_output(["ps", "-axo", "pid=,comm="], text=True)
    live = {int(line.split(None, 1)[0]) for line in processes.splitlines()
            if "Code Helper (Plugin)" in line}
    sessions = [p for p in log_root.glob("*") if list(p.glob("window*/renderer.log"))]
    if not sessions:
        return {}
    result = {}
    seen = {}
    for path in max(sessions, key=lambda p: p.name).glob("window*/renderer.log"):
        try:
            parsed = window_connections(tail(path))
            if not parsed:
                continue
            pid, key, active, old = parsed
            seen.setdefault(key, set()).update(old | {active})
            if pid not in live:
                continue
            entry = result.setdefault(key, {"active": set(), "replaced": {}})
            entry["active"].add(active)
        except (OSError, ValueError, KeyError):
            continue
    all_active = set().union(*(entry["active"] for entry in result.values()))
    for key, entry in result.items():
        entry["replaced"] = {old: sorted(entry["active"]) for old in seen[key] - all_active}
        entry["active"] = sorted(entry["active"])
    return result


def process_identity(pid):
    proc = PROC / str(pid)
    args = (proc / "cmdline").read_bytes().split(b"\0")
    if not args[0].endswith(b"/bin/linux-x86_64/codex") or b"app-server" not in args:
        raise ValueError("not an extension app-server")
    stat = (proc / "stat").read_text().rsplit(")", 1)[1].split()
    return {"pid": pid, "parent": int(stat[1]), "start": stat[19],
            "namespace": os.readlink(proc / "ns/mnt")}


def backend_logs(parent, server_root):
    paths = set()
    for fd in (PROC / str(parent) / "fd").iterdir():
        try:
            path = Path(os.readlink(fd))
            if path.name == "Codex.log" and path.is_relative_to(server_root / "data/logs"):
                paths.add(path)
        except OSError:
            continue
    if len(paths) != 1:
        raise ValueError("ambiguous extension host log")
    return paths.pop()


def connection_id(log, parent):
    agent = log.parents[2] / "remoteagent.log"
    pattern = re.compile(r"\[([0-9a-f]{8})\]\[ExtensionHostConnection\] <" + str(parent)
                         + r"> Launched Extension Host Process")
    matches = pattern.findall(tail(agent, 8 * 1024 * 1024))
    if len(set(matches)) != 1:
        raise ValueError("unknown connection identity")
    return matches[-1]


def lock_owner(path):
    stat = path.stat()
    if path.is_symlink() or not path.is_file():
        raise ValueError("invalid writer lock")
    device = f"{os.major(stat.st_dev):02x}:{os.minor(stat.st_dev):02x}:{stat.st_ino}"
    owners = []
    for line in (PROC / "locks").read_text().splitlines():
        fields = line.split()
        if len(fields) >= 8 and fields[1:4] == ["FLOCK", "ADVISORY", "WRITE"] and fields[5] == device:
            owners.append(int(fields[4]))
    if len(owners) != 1:
        raise ValueError("no unique live writer")
    return owners[0], stat.st_dev, stat.st_ino


def idle_thread(home, thread, workspaces, quiet_seconds):
    with sqlite3.connect(f"file:{home}/state_5.sqlite?mode=ro", uri=True, timeout=2) as db:
        row = db.execute("SELECT cwd,rollout_path FROM threads WHERE id=?", (thread,)).fetchone()
    if not row or row[0].rstrip("/") not in workspaces:
        raise ValueError("thread outside allowlist")
    with sqlite3.connect(f"file:{home}/thread_history_1.sqlite?mode=ro", uri=True, timeout=2) as db:
        turn = db.execute("SELECT status FROM thread_turns WHERE thread_id=? "
                          "ORDER BY rollout_ordinal DESC LIMIT 1", (thread,)).fetchone()
    if not turn or turn[0] not in {"completed", "failed", "interrupted"}:
        raise ValueError("thread active or unknown")
    rollout = Path(row[1])
    if not rollout.resolve().is_relative_to((home / "sessions").resolve()) or rollout.is_symlink():
        raise ValueError("unexpected rollout path")
    stat = rollout.stat()
    if time.time() - stat.st_mtime < quiet_seconds:
        raise ValueError("recent session activity")
    return {"cwd": row[0], "rollout_size": stat.st_size, "rollout_mtime_ns": stat.st_mtime_ns}


def latest_conflicts(text):
    conflicts = set()
    for line in text.splitlines():
        match = THREAD.search(line)
        if match and "Request failed" in line and "method=thread/resume" in line:
            conflicts.add(match[1])
        if "maybe_resume_success" in line:
            match = re.search(r"conversationId=([0-9a-f-]{36})", line)
            if match:
                conflicts.discard(match[1])
    return conflicts


def idle_children(pid):
    children = {}
    for proc in PROC.iterdir():
        if not proc.name.isdigit():
            continue
        try:
            fields = (proc / "stat").read_text().rsplit(")", 1)[1].split()
            children.setdefault(int(fields[1]), []).append(int(proc.name))
        except (OSError, ValueError, IndexError):
            continue
    for child in children.get(pid, []):
        try:
            args = (PROC / str(child) / "cmdline").read_bytes().split(b"\0")
            if not args[0].endswith(b"/codex-code-mode-host") or children.get(child):
                return False
        except OSError:
            return False
    return True


def candidates(request):
    home = Path(request["codex_home"])
    server = Path(request["server_root"])
    links = request["connections"]
    if not links["active"] or not links["replaced"]:
        return []
    backends = {}
    namespace = os.readlink(PROC / "self/ns/mnt")
    for proc in PROC.iterdir():
        if not proc.name.isdigit():
            continue
        try:
            identity = process_identity(int(proc.name))
            if identity["namespace"] != namespace:
                continue
            log = backend_logs(identity["parent"], server)
            connection = connection_id(log, identity["parent"])
            identity.update(connection=connection, log=str(log))
            backends[identity["pid"]] = identity
        except (OSError, ValueError):
            continue
    locks = home / "thread-writer-locks"
    results = []
    for current in backends.values():
        if current["connection"] not in links["active"]:
            continue
        for thread in latest_conflicts(tail(Path(current["log"]))):
            try:
                path = locks / (thread + ".lock")
                owner, device, inode = lock_owner(path)
                previous = backends.get(owner)
                if not previous or owner == current["pid"]:
                    continue
                if int(previous["start"]) >= int(current["start"]) or not idle_children(owner):
                    continue
                replacements = links["replaced"].get(previous["connection"], [])
                if current["connection"] not in replacements or previous["connection"] in links["active"]:
                    continue
                # Killing one backend must not interrupt another thread it owns.
                owned = []
                for lock in locks.glob("*.lock"):
                    if lock.name.startswith("."):
                        continue
                    try:
                        if lock_owner(lock)[0] == owner:
                            owned.append(lock.stem)
                    except ValueError:
                        continue
                if owned != [thread]:
                    continue
                idle = idle_thread(home, thread, request["workspaces"], request["quiet_seconds"])
                key = f"{owner}:{previous['start']}:{device}:{inode}:{thread}:{current['pid']}:{current['start']}"
                results.append({"key": key, "thread": thread, "old": previous,
                                "current": current, "device": device, "inode": inode, **idle})
            except (OSError, ValueError, sqlite3.Error):
                continue
    return results


def remote_main(request):
    approved = {item["key"]: item for item in request.get("approved", [])}
    found = candidates(request)
    actions = []
    if approved:
        if not hasattr(os, "pidfd_open") or not hasattr(signal, "pidfd_send_signal"):
            raise RuntimeError("pidfd signaling is required")
        for item in found:
            if approved.get(item["key"]) != item:
                continue
            fd = os.pidfd_open(item["old"]["pid"])
            try:
                # Recheck all gates after opening a PID-stable process handle.
                fresh = {c["key"]: c for c in candidates(request)}
                if fresh.get(item["key"]) != item:
                    continue
                signal.pidfd_send_signal(fd, signal.SIGTERM)
                actions.append({"thread": item["thread"], "pid": item["old"]["pid"],
                                "signal": "SIGTERM", "result": "signal_sent"})
            finally:
                os.close(fd)
    return {"candidates": found, "actions": actions}


def remote_call(target, request):
    arguments = ["python3", "-", "--remote", json.dumps(request, separators=(",", ":"))]
    if target.get("container"):
        arguments = ["docker", "exec", "-i", target["container"], *arguments]
    command = ["/usr/bin/ssh", "-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8",
               "-o", "ServerAliveInterval=5", "-o", "ServerAliveCountMax=2",
               target["host"], shlex.join(arguments)]
    result = subprocess.run(command, input=Path(__file__).read_text(), text=True,
                            capture_output=True, timeout=30)
    if result.returncode:
        raise RuntimeError(f"remote check exited {result.returncode}")
    lines = [line for line in result.stdout.splitlines() if line.startswith('{"candidates":')]
    if len(lines) != 1:
        raise RuntimeError("invalid remote response")
    return json.loads(lines[0])


def eligible(previous, item, now, confirmation_seconds):
    return (previous and previous.get("candidate") == item
            and now - previous["first_seen"] >= confirmation_seconds
            and now - previous["last_seen"] <= 150)


def frontend_history(connections, targets, previous, now):
    all_active = {i for entry in connections.values() for i in entry["active"]}
    history = {}
    for target in targets:
        key = (target["host"], target.get("container"))
        recent = {i: when for i, when in previous.get(target["id"], {}).items()
                  if 0 <= now - when <= 10800}
        entry = connections.get(key)
        if entry:
            for old in recent.keys() - all_active:
                entry["replaced"][old] = sorted(entry["active"])
            recent.update({i: now for i in entry["active"]})
        history[target["id"]] = recent
    return history


def run_local(apply):
    from automation_common import HOME, load_config

    config = load_config()
    if not config.get("services", {}).get("codex_lock_guard", {}).get("enabled"):
        return
    settings = config["codex_lock_guard"]
    state_path = HOME / "state/codex-lock-guard.json"
    log_path = HOME / "logs/codex-lock-guard-audit.jsonl"
    lock = (HOME / "state/codex-lock-guard.lock").open("a")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        return
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    log_root = Path.home() / "Library/Application Support/Code/logs"
    connections = local_connections(log_root)
    now = time.time()
    history = frontend_history(connections, settings["targets"], state.get("_frontend_history", {}), now)
    observations = {}
    for target in settings["targets"]:
        label = target["id"]
        links = connections.get((target["host"], target.get("container")))
        if not links or not links["replaced"]:
            continue
        request = {"codex_home": target["codex_home"], "server_root": target["server_root"],
                   "workspaces": target["workspaces"], "connections": links,
                   "quiet_seconds": max(120, settings.get("quiet_seconds", 120))}
        try:
            result = remote_call(target, request)
            approved = []
            for item in result["candidates"]:
                key = label + ":" + item["key"]
                old = state.get(key)
                unchanged = old and old.get("candidate") == item and now - old["last_seen"] <= 150
                observations[key] = {"candidate": item, "first_seen": old["first_seen"] if unchanged else now,
                                     "last_seen": now}
                if apply and eligible(old, item, now, max(60, settings.get("confirmation_seconds", 60))):
                    approved.append(item)
            actions = []
            if approved:
                # Re-read local frontend ownership immediately before the remote mutation.
                fresh_connections = local_connections(log_root)
                frontend_history(fresh_connections, settings["targets"], state.get("_frontend_history", {}), time.time())
                fresh_links = fresh_connections.get((target["host"], target.get("container")))
                if fresh_links == links:
                    result = remote_call(target, {**request, "approved": approved})
                    actions = result["actions"]
                    for action in actions:
                        for key in list(observations):
                            if key.startswith(label + ":") and observations[key]["candidate"]["thread"] == action["thread"]:
                                del observations[key]
            record = {"time": now, "target": label, "mode": "apply" if apply else "dry_run",
                      "candidates": len(result["candidates"]), "actions": actions}
        except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as exc:
            record = {"time": now, "target": label, "error": type(exc).__name__}
        with log_path.open("a") as handle:
            handle.write(json.dumps(record) + "\n")
        print(json.dumps(record), flush=True)
    if apply:
        observations["_frontend_history"] = history
        temporary = state_path.with_suffix(".tmp")
        temporary.write_text(json.dumps(observations))
        temporary.chmod(0o600)
        temporary.replace(state_path)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--remote")
    parser.add_argument("--apply", action="store_true")
    arguments = parser.parse_args()
    os.umask(0o077)
    if arguments.remote:
        print(json.dumps(remote_main(json.loads(arguments.remote))))
    else:
        run_local(arguments.apply)
