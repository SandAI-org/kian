#!/usr/bin/env python3
"""Safely merge VS Code Copilot Chat History between Dev Containers on macOS."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import datetime as dt
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import time
from typing import Any, Iterable
from urllib.parse import unquote, urlsplit

INDEX_KEY = "chat.ChatSessionStore.index"
CHAT_DIR_NAMES = ("chatSessions", "chatEditingSessions", "chatSessionSnapshots")
CODE_MAIN_PATTERN = "/Applications/Visual Studio Code.app/Contents/MacOS/Code"


@dataclass(frozen=True)
class WorkspaceIdentity:
    container_name: str
    remote_host: str
    workspace_path: str
    authority: str


def log(message: str) -> None:
    print(f"[{dt.datetime.now().isoformat(timespec='seconds')}] {message}", flush=True)


def normalize_container_name(name: str) -> str:
    return name.strip().lstrip("/")


def decode_hex_json(token: str) -> dict[str, Any]:
    if len(token) % 2:
        return {}
    try:
        value = json.loads(bytes.fromhex(token).decode("utf-8"))
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def workspace_identity(workspace: Path) -> WorkspaceIdentity | None:
    descriptor = workspace / "workspace.json"
    if not descriptor.is_file():
        return None
    try:
        metadata = json.loads(descriptor.read_text(errors="replace"))
    except json.JSONDecodeError:
        return None
    uri = metadata.get("folder")
    if not isinstance(uri, str):
        return None

    raw_parts = urlsplit(uri)
    if raw_parts.scheme != "vscode-remote" or not raw_parts.netloc:
        return None
    authority = raw_parts.netloc
    decoded_authority = unquote(authority)

    container_match = re.search(
        r"(?:dev-container|attached-container)\+([0-9a-fA-F]+)", decoded_authority
    )
    host_match = re.search(r"ssh-remote\+([0-9a-fA-F]+)", decoded_authority)
    if not container_match or not host_match:
        return None

    container = decode_hex_json(container_match.group(1))
    host = decode_hex_json(host_match.group(1))
    container_name = container.get("containerName") or container.get("name")
    remote_host = host.get("hostName")
    if not isinstance(container_name, str) or not isinstance(remote_host, str):
        return None

    workspace_path = unquote(raw_parts.path).rstrip("/") or "/"
    return WorkspaceIdentity(
        container_name=normalize_container_name(container_name),
        remote_host=remote_host,
        workspace_path=workspace_path,
        authority=authority,
    )


def code_is_running() -> bool:
    result = subprocess.run(
        ["pgrep", "-f", CODE_MAIN_PATTERN],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    return result.returncode == 0


def wait_for_code_exit(timeout_seconds: int) -> None:
    deadline = time.monotonic() + timeout_seconds
    announced = False
    while code_is_running():
        if not announced:
            log("等待 Visual Studio Code 完全退出……")
            announced = True
        if time.monotonic() >= deadline:
            raise RuntimeError("等待 VS Code 退出超时；未修改任何数据")
        time.sleep(1)
    time.sleep(3)


def discover(root: Path, container_name: str) -> list[Path]:
    expected = normalize_container_name(container_name)
    matches = []
    for workspace in root.iterdir():
        if not workspace.is_dir():
            continue
        identity = workspace_identity(workspace)
        if identity and identity.container_name == expected:
            matches.append(workspace)
    return sorted(matches, key=lambda path: path.stat().st_mtime, reverse=True)


def filter_workspace_identity(
    candidates: list[Path], workspace_path: str, remote_host: str | None
) -> list[Path]:
    expected_path = workspace_path.rstrip("/") or "/"
    return [
        workspace
        for workspace in candidates
        if (identity := workspace_identity(workspace))
        and identity.workspace_path == expected_path
        and (remote_host is None or identity.remote_host == remote_host)
    ]


def session_file_count(workspace: Path) -> int:
    session_dir = workspace / "chatSessions"
    if not session_dir.is_dir():
        return 0
    return sum(
        1
        for path in session_dir.iterdir()
        if path.is_file() and path.suffix in {".json", ".jsonl"}
    )


def workspace_score(path: Path) -> tuple[int, float]:
    return session_file_count(path), path.stat().st_mtime


def read_index(workspace: Path) -> dict[str, Any]:
    db = workspace / "state.vscdb"
    if not db.exists():
        return {}
    try:
        with sqlite3.connect(f"file:{db}?mode=ro", uri=True) as conn:
            row = conn.execute(
                "SELECT value FROM ItemTable WHERE key=?", (INDEX_KEY,)
            ).fetchone()
        if not row or not row[0]:
            return {}
        value = row[0].decode() if isinstance(row[0], bytes) else row[0]
        parsed = json.loads(value)
        if parsed.get("version") != 1 or not isinstance(parsed.get("entries"), dict):
            raise RuntimeError(f"{workspace}: unsupported chat index format")
        return parsed
    except (sqlite3.Error, json.JSONDecodeError) as exc:
        raise RuntimeError(f"cannot read {db}: {exc}") from exc


def choose_target(candidates: list[Path]) -> Path:
    if not candidates:
        raise RuntimeError("没有找到目标容器对应的本地 workspaceStorage")
    return max(candidates, key=workspace_score)


def useful_source(workspace: Path) -> bool:
    return session_file_count(workspace) > 0 or bool(read_index(workspace).get("entries"))


def choose_sources(candidates: list[Path], target: Path) -> list[Path]:
    target_identity = workspace_identity(target)
    if target_identity is None:
        raise RuntimeError("无法解析目标 workspace identity")

    same_workspace = []
    rejected = []
    for source in candidates:
        if source == target or not useful_source(source):
            continue
        identity = workspace_identity(source)
        if identity is None:
            continue
        if (
            identity.remote_host == target_identity.remote_host
            and identity.workspace_path == target_identity.workspace_path
        ):
            same_workspace.append(source)
        else:
            rejected.append(
                f"{source.name} ({identity.remote_host}:{identity.workspace_path})"
            )

    if not same_workspace:
        details = f"；已排除不同主机/目录：{', '.join(rejected)}" if rejected else ""
        raise RuntimeError(f"没有找到同一物理服务器、同一工作目录的可迁移源工作区{details}")
    return same_workspace


def write_index(workspace: Path, index: dict[str, Any]) -> None:
    db = workspace / "state.vscdb"
    if not db.exists():
        raise RuntimeError(f"目标数据库不存在：{db}")
    value = json.dumps(index, ensure_ascii=False, separators=(",", ":"))
    with sqlite3.connect(db) as conn:
        conn.execute("PRAGMA busy_timeout=5000")
        conn.execute(
            "INSERT INTO ItemTable(key,value) VALUES(?,?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (INDEX_KEY, value),
        )
        conn.commit()
        result = conn.execute("PRAGMA integrity_check").fetchone()
        if not result or result[0] != "ok":
            raise RuntimeError(f"目标数据库完整性校验失败：{result}")


def authority_replacements(old: str, new: str) -> list[tuple[str, str]]:
    pairs = [(old, new), (unquote(old), unquote(new))]
    return [(source, target) for source, target in pairs if source != target]


def rewrite(value: Any, old_authorities: Iterable[str], new_authority: str) -> Any:
    if isinstance(value, str):
        for old in old_authorities:
            for source, target in authority_replacements(old, new_authority):
                value = value.replace(
                    f"vscode-remote://{source}", f"vscode-remote://{target}"
                )
        return value
    if isinstance(value, list):
        return [rewrite(item, old_authorities, new_authority) for item in value]
    if isinstance(value, dict):
        return {
            key: rewrite(item, old_authorities, new_authority)
            for key, item in value.items()
        }
    return value


def rewrite_bytes(data: bytes, old_authorities: Iterable[str], new_authority: str) -> bytes:
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return data
    return rewrite(text, old_authorities, new_authority).encode("utf-8")


def copy_tree_merge(
    source: Path,
    target: Path,
    old_authorities: Iterable[str],
    new_authority: str,
) -> int:
    copied = 0
    if not source.exists():
        return copied
    for src in source.rglob("*"):
        relative = src.relative_to(source)
        dst = target / relative
        if src.is_dir():
            dst.mkdir(parents=True, exist_ok=True)
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        data = rewrite_bytes(src.read_bytes(), old_authorities, new_authority)
        if (
            dst.exists()
            and dst.read_bytes() != data
            and dst.stat().st_mtime >= src.stat().st_mtime
        ):
            continue
        dst.write_bytes(data)
        os.utime(dst, (src.stat().st_atime, src.stat().st_mtime))
        copied += 1
    return copied


def existing_session_ids(workspace: Path) -> set[str]:
    session_dir = workspace / "chatSessions"
    if not session_dir.is_dir():
        return set()
    return {
        path.stem
        for path in session_dir.iterdir()
        if path.is_file() and path.suffix in {".json", ".jsonl"}
    }


def merge_indexes(
    source_data: list[tuple[dict[str, Any], set[str]]],
    target_index: dict[str, Any],
    old_authorities: list[str],
    new_authority: str,
) -> tuple[dict[str, Any], int, int]:
    merged = target_index or {"version": 1, "entries": {}}
    merged.setdefault("version", 1)
    merged.setdefault("entries", {})
    added = 0
    skipped_missing = 0
    for source_index, available_ids in source_data:
        for session_id, source_entry in source_index.get("entries", {}).items():
            if session_id not in available_ids:
                skipped_missing += 1
                continue
            source_entry = rewrite(source_entry, old_authorities, new_authority)
            target_entry = merged["entries"].get(session_id)
            source_date = (
                source_entry.get("lastMessageDate", 0)
                if isinstance(source_entry, dict)
                else 0
            )
            target_date = (
                target_entry.get("lastMessageDate", 0)
                if isinstance(target_entry, dict)
                else 0
            )
            if target_entry is None or source_date > target_date:
                if target_entry is None:
                    added += 1
                merged["entries"][session_id] = source_entry
    return merged, added, skipped_missing


def backup_workspaces(paths: Iterable[Path], backup_root: Path) -> None:
    backup_root.mkdir(parents=True, exist_ok=False)
    seen: set[Path] = set()
    for path in paths:
        if path in seen:
            continue
        seen.add(path)
        shutil.copytree(path, backup_root / path.name, copy_function=shutil.copy2)


def describe(workspace: Path) -> str:
    identity = workspace_identity(workspace)
    if identity is None:
        return workspace.name
    return (
        f"{workspace.name} container={identity.container_name} "
        f"host={identity.remote_host} path={identity.workspace_path}"
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-container", required=True)
    parser.add_argument("--target-container", required=True)
    parser.add_argument(
        "--workspace-dir",
        help="exact absolute workspace path inside both containers",
    )
    parser.add_argument(
        "--remote-host",
        help="exact SSH hostName stored in the VS Code remote authority",
    )
    parser.add_argument(
        "--workspace-storage",
        type=Path,
        default=Path.home() / "Library/Application Support/Code/User/workspaceStorage",
    )
    parser.add_argument("--wait-for-vscode-exit", action="store_true")
    parser.add_argument("--wait-timeout", type=int, default=1800)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if normalize_container_name(args.source_container) == normalize_container_name(
        args.target_container
    ):
        raise RuntimeError("源容器和目标容器不能相同")

    root = args.workspace_storage.expanduser().resolve()
    if not root.is_dir():
        raise RuntimeError(f"workspaceStorage 不存在：{root}")

    source_candidates = discover(root, args.source_container)
    target_candidates = discover(root, args.target_container)
    if args.workspace_dir:
        if not args.workspace_dir.startswith("/"):
            raise RuntimeError("--workspace-dir 必须是容器内绝对路径")
        source_candidates = filter_workspace_identity(
            source_candidates, args.workspace_dir, args.remote_host
        )
        target_candidates = filter_workspace_identity(
            target_candidates, args.workspace_dir, args.remote_host
        )

    target = choose_target(target_candidates)
    sources = choose_sources(source_candidates, target)
    target_identity = workspace_identity(target)
    if target_identity is None:
        raise RuntimeError("无法解析目标 workspace identity")

    log("源候选：")
    for source in sources:
        log(f"  {describe(source)} sessions={session_file_count(source)}")
    log(f"目标：{describe(target)} sessions={session_file_count(target)}")

    if args.dry_run:
        log("dry-run 完成；未修改数据")
        return 0

    if args.wait_for_vscode_exit:
        wait_for_code_exit(args.wait_timeout)
    elif code_is_running():
        raise RuntimeError(
            "VS Code 仍在运行。请完全退出后重试，或使用 --wait-for-vscode-exit"
        )

    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    backup_root = Path.home() / "vscode-copilot-migration-backups" / stamp
    backup_workspaces([*sources, target], backup_root)
    log(f"完整备份：{backup_root}")

    old_authorities = []
    for source in sources:
        identity = workspace_identity(source)
        if identity:
            old_authorities.append(identity.authority)

    copied = 0
    for source in sources:
        for dirname in CHAT_DIR_NAMES:
            copied += copy_tree_merge(
                source / dirname,
                target / dirname,
                old_authorities,
                target_identity.authority,
            )

    source_data = [
        (read_index(source), existing_session_ids(source)) for source in sources
    ]
    target_index = read_index(target)
    merged_index, added, skipped_missing = merge_indexes(
        source_data,
        target_index,
        old_authorities,
        target_identity.authority,
    )
    write_index(target, merged_index)

    expected_ids = set().union(*(ids for _, ids in source_data))
    target_ids = existing_session_ids(target)
    if not expected_ids.issubset(target_ids):
        raise RuntimeError("目标会话文件校验失败")
    if not all(
        session_id in merged_index["entries"]
        for index, ids in source_data
        for session_id in index.get("entries", {})
        if session_id in ids
    ):
        raise RuntimeError("目标聊天索引合并校验失败")

    log(
        "迁移完成："
        f"copied_files={copied}, added_index_entries={added}, "
        f"skipped_missing_sessions={skipped_missing}"
    )
    log(
        "目标校验："
        f"session_files={session_file_count(target)}, "
        f"index_entries={len(merged_index.get('entries', {}))}"
    )
    log("现在可重新打开目标 Dev Container。")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        log(f"ERROR: {exc}")
        raise SystemExit(1)
