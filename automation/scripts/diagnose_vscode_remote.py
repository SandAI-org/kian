#!/usr/bin/env python3
"""Diagnose a slow VS Code remote workspace across network, host, and storage."""
from __future__ import annotations

import argparse
import json
import select
import shlex
import statistics
import subprocess
import sys
import time
from dataclasses import dataclass


REMOTE_PROBE = r'''
import glob
import json
import os
import re
import subprocess
import sys
import tempfile
import time

workspace = os.path.realpath(sys.argv[1])
result = {"workspace": workspace}

def read(path):
    try:
        with open(path, encoding="utf-8", errors="replace") as handle:
            return handle.read()
    except OSError:
        return ""

def pressure(kind):
    match = re.search(r"some avg10=([0-9.]+)", read("/proc/pressure/" + kind))
    return float(match.group(1)) if match else None

result["cpu_count"] = os.cpu_count() or 1
result["load_1m"] = os.getloadavg()[0]
mem = read("/proc/meminfo")
total = re.search(r"^MemTotal:\s+(\d+)", mem, re.M)
available = re.search(r"^MemAvailable:\s+(\d+)", mem, re.M)
result["memory_available_pct"] = (
    round(int(available.group(1)) * 100 / int(total.group(1)), 2)
    if total and available else None
)
result["pressure"] = {name: pressure(name) for name in ("cpu", "memory", "io")}

try:
    mount = subprocess.run(
        ["findmnt", "-T", workspace, "-n", "-o", "SOURCE,FSTYPE,TARGET"],
        text=True, capture_output=True, timeout=5
    )
    result["mount"] = mount.stdout.strip()
except (OSError, subprocess.TimeoutExpired):
    result["mount"] = ""

stat_ms = []
for _ in range(12):
    started = time.perf_counter()
    os.stat(workspace)
    stat_ms.append((time.perf_counter() - started) * 1000)
result["storage_stat_median_ms"] = round(sorted(stat_ms)[len(stat_ms) // 2], 3)
result["storage_stat_max_ms"] = round(max(stat_ms), 3)

probe_path = None
try:
    started = time.perf_counter()
    fd, probe_path = tempfile.mkstemp(prefix=".kian-vscode-probe-", dir=workspace)
    block = b"\0" * (1024 * 1024)
    with os.fdopen(fd, "wb", closefd=True) as handle:
        for _ in range(8):
            handle.write(block)
        handle.flush()
        os.fsync(handle.fileno())
    write_seconds = time.perf_counter() - started
    started = time.perf_counter()
    with open(probe_path, "rb") as handle:
        while handle.read(1024 * 1024):
            pass
    read_seconds = time.perf_counter() - started
    result["storage_write_fsync_ms"] = round(write_seconds * 1000, 2)
    result["storage_write_mib_s"] = round(8 / write_seconds, 2)
    result["storage_read_mib_s"] = round(8 / read_seconds, 2)
except OSError as error:
    result["storage_error"] = f"{type(error).__name__}: {error}"
finally:
    if probe_path:
        try:
            os.unlink(probe_path)
        except OSError:
            pass

processes = []
try:
    output = subprocess.run(
        ["ps", "-eo", "pid=,ppid=,stat=,pcpu=,pmem=,rss=,etime=,args="],
        text=True, capture_output=True, timeout=5, check=True
    ).stdout
    for line in output.splitlines():
        if not re.search(r"\.vscode-server|extensionHost|remoteExtensionHost|code-server", line, re.I):
            continue
        fields = line.strip().split(None, 7)
        if len(fields) == 8:
            processes.append({
                "pid": int(fields[0]), "ppid": int(fields[1]), "state": fields[2],
                "cpu_pct": float(fields[3]), "memory_pct": float(fields[4]),
                "rss_mib": round(int(fields[5]) / 1024, 1), "elapsed": fields[6],
                "command": fields[7][:240],
            })
except (OSError, subprocess.SubprocessError, ValueError):
    pass
result["vscode_processes"] = processes
result["vscode_cpu_total_pct"] = round(sum(item["cpu_pct"] for item in processes), 2)
result["vscode_cpu_max_pct"] = round(max((item["cpu_pct"] for item in processes), default=0), 2)
result["vscode_rss_total_mib"] = round(sum(item["rss_mib"] for item in processes), 1)

patterns = re.compile(r"unresponsive|extension host.*(slow|crash|terminate)|EIO|ETIMEDOUT|ENOSPC", re.I)
log_hits = []
logs = glob.glob(os.path.expanduser("~/.vscode-server/data/logs/**/*"), recursive=True)
logs = [path for path in logs if os.path.isfile(path)]
for path in sorted(logs, key=lambda item: os.path.getmtime(item), reverse=True)[:30]:
    try:
        if time.time() - os.path.getmtime(path) > 3600:
            continue
        with open(path, encoding="utf-8", errors="replace") as handle:
            tail = handle.read()[-200000:]
        count = len(patterns.findall(tail))
        if count:
            log_hits.append({"file": path, "hits": count})
    except OSError:
        pass
result["recent_vscode_log_hits"] = log_hits
print(json.dumps(result, ensure_ascii=False))
'''


@dataclass(frozen=True)
class Finding:
    score: int
    cause: str
    evidence: str


def ssh_latencies(host: str, samples: int) -> tuple[list[float], list[str]]:
    latencies = []
    errors = []
    echo_program = (
        "import sys\n"
        "for line in sys.stdin.buffer:\n"
        " sys.stdout.buffer.write(line); sys.stdout.buffer.flush()"
    )
    command = f"python3 -u -c {shlex.quote(echo_program)}"
    process = subprocess.Popen(
        [
            "ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8",
            "-o", "ConnectionAttempts=1", host, command,
        ],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, bufsize=1,
    )
    assert process.stdin is not None and process.stdout is not None
    try:
        process.stdin.write("warmup\n")
        process.stdin.flush()
        if not select.select([process.stdout], [], [], 12)[0] or process.stdout.readline() != "warmup\n":
            stderr = process.stderr.read()[-300:] if process.poll() is not None and process.stderr else ""
            return [], [stderr or "SSH echo probe warmup timed out"]
        for index in range(samples):
            payload = f"probe-{index}\n"
            started = time.perf_counter()
            process.stdin.write(payload)
            process.stdin.flush()
            if not select.select([process.stdout], [], [], 5)[0]:
                errors.append("SSH echo probe timed out")
                continue
            if process.stdout.readline() != payload:
                errors.append("SSH echo probe returned unexpected data")
                continue
            latencies.append(round((time.perf_counter() - started) * 1000, 2))
    finally:
        process.terminate()
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            process.kill()
    return latencies, errors


def run_remote_probe(host: str, workspace: str, container: str | None) -> dict:
    if container:
        command = ["docker", "exec", "-i", container, "python3", "-", workspace]
    else:
        command = ["python3", "-", workspace]
    completed = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", host, *command],
        input=REMOTE_PROBE, text=True, capture_output=True, timeout=45,
    )
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip() or "remote probe failed")
    return json.loads(completed.stdout)


def classify(network_ms: list[float], probe: dict) -> list[Finding]:
    findings = []
    median_ssh = statistics.median(network_ms) if network_ms else float("inf")
    if median_ssh >= 500:
        findings.append(Finding(95, "network/SSH", f"median SSH data round trip {median_ssh:.0f} ms"))
    elif median_ssh >= 200:
        findings.append(Finding(65, "network/SSH", f"median SSH data round trip {median_ssh:.0f} ms"))

    stat_max = probe.get("storage_stat_max_ms", 0)
    fsync_ms = probe.get("storage_write_fsync_ms", 0)
    write_speed = probe.get("storage_write_mib_s", float("inf"))
    if stat_max >= 500 or fsync_ms >= 3000 or write_speed < 8:
        findings.append(Finding(95, "workspace shared storage", f"stat max {stat_max} ms; 8 MiB write+fsync {fsync_ms} ms ({write_speed} MiB/s)"))
    elif stat_max >= 100 or fsync_ms >= 1000 or write_speed < 25:
        findings.append(Finding(70, "workspace shared storage", f"stat max {stat_max} ms; 8 MiB write+fsync {fsync_ms} ms ({write_speed} MiB/s)"))

    cpu_ratio = probe.get("load_1m", 0) / max(probe.get("cpu_count", 1), 1)
    cpu_pressure = (probe.get("pressure") or {}).get("cpu") or 0
    io_pressure = (probe.get("pressure") or {}).get("io") or 0
    memory_pressure = (probe.get("pressure") or {}).get("memory") or 0
    memory_available = probe.get("memory_available_pct")
    if cpu_ratio >= 1 or cpu_pressure >= 20:
        findings.append(Finding(85, "remote CPU saturation", f"load/core {cpu_ratio:.2f}; CPU pressure avg10 {cpu_pressure:.1f}%"))
    if io_pressure >= 15:
        findings.append(Finding(80, "remote I/O contention", f"I/O pressure avg10 {io_pressure:.1f}%"))
    if (memory_available is not None and memory_available < 5) or memory_pressure >= 10:
        findings.append(Finding(85, "remote memory pressure", f"available {memory_available}%; memory pressure avg10 {memory_pressure:.1f}%"))

    vscode_cpu = probe.get("vscode_cpu_total_pct", 0)
    vscode_max = probe.get("vscode_cpu_max_pct", 0)
    log_hits = sum(item.get("hits", 0) for item in probe.get("recent_vscode_log_hits", []))
    if vscode_max >= 80 or vscode_cpu >= 150:
        findings.append(Finding(90, "VS Code server/extension process", f"VS Code CPU total {vscode_cpu:.1f}%, hottest process {vscode_max:.1f}%"))
    elif log_hits >= 3:
        findings.append(Finding(65, "VS Code server/extension process", f"{log_hits} recent unresponsive/I/O/error log matches"))
    return sorted(findings, key=lambda item: item.score, reverse=True)


def report(host: str, container: str | None, latencies: list[float], errors: list[str], probe: dict) -> None:
    findings = classify(latencies, probe)
    print(f"TARGET host={host} container={container or '-'} workspace={probe['workspace']}")
    print(f"SSH samples_ms={','.join(str(value) for value in latencies) or '-'} failures={len(errors)}")
    print(
        "REMOTE "
        f"load={probe.get('load_1m')}/{probe.get('cpu_count')} "
        f"memory_available={probe.get('memory_available_pct')}% "
        f"pressure={probe.get('pressure')}"
    )
    print(
        "STORAGE "
        f"mount={probe.get('mount') or '-'} stat_median={probe.get('storage_stat_median_ms')}ms "
        f"stat_max={probe.get('storage_stat_max_ms')}ms "
        f"write_fsync={probe.get('storage_write_fsync_ms', '-')}ms "
        f"write={probe.get('storage_write_mib_s', '-')}MiB/s read={probe.get('storage_read_mib_s', '-')}MiB/s"
    )
    print(
        "VSCODE "
        f"processes={len(probe.get('vscode_processes', []))} "
        f"cpu_total={probe.get('vscode_cpu_total_pct')}% "
        f"cpu_max={probe.get('vscode_cpu_max_pct')}% "
        f"rss_total={probe.get('vscode_rss_total_mib')}MiB "
        f"recent_log_files_with_hits={len(probe.get('recent_vscode_log_hits', []))}"
    )
    if findings:
        primary = findings[0]
        confidence = "high" if primary.score >= 85 else "medium"
        print(f"ROOT_CAUSE cause={primary.cause} confidence={confidence} evidence={primary.evidence}")
        for finding in findings[1:]:
            print(f"SECONDARY cause={finding.cause} evidence={finding.evidence}")
    else:
        print("ROOT_CAUSE cause=inconclusive confidence=low evidence=no threshold exceeded during this sample")


def main() -> None:
    parser = argparse.ArgumentParser(description="Diagnose a slow VS Code remote workspace")
    parser.add_argument("--host", required=True, help="SSH config host alias")
    parser.add_argument("--workspace", required=True, help="workspace path in the measured environment")
    parser.add_argument("--container", help="Docker container containing VS Code and the workspace")
    parser.add_argument("--ssh-samples", type=int, default=5)
    parser.add_argument("--json", action="store_true", help="emit raw measurements as JSON")
    args = parser.parse_args()
    latencies, errors = ssh_latencies(args.host, args.ssh_samples)
    if not latencies:
        raise RuntimeError(f"all SSH probes failed: {errors[-1] if errors else 'unknown error'}")
    probe = run_remote_probe(args.host, args.workspace, args.container)
    if args.json:
        print(json.dumps({"ssh_ms": latencies, "ssh_errors": errors, "remote": probe}, ensure_ascii=False, indent=2))
    else:
        report(args.host, args.container, latencies, errors, probe)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, subprocess.TimeoutExpired, json.JSONDecodeError) as error:
        print(f"DIAGNOSIS_FAILED {error}", file=sys.stderr)
        raise SystemExit(1)
