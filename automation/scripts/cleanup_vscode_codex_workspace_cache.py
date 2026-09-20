#!/usr/bin/env python3
"""Remove stale Codex session indexes from one VS Code workspace."""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sqlite3
import subprocess
from datetime import datetime
from pathlib import Path
from urllib.parse import unquote

DEFAULT_STORAGE_ROOT = (
    Path.home() / "Library/Application Support/Code/User/workspaceStorage"
)
DEFAULT_BACKUP_ROOT = Path(
    os.environ.get("KIAN_AUTOMATION_HOME", "~/.config/kian-automation")
).expanduser() / "backups/codex-session-cache"
ENCODED_AUTHORITY = re.compile(r"(?:attached-container|ssh-remote)(?:\+|%2B)([0-9a-fA-F]+)")


def decode_workspace_uri(uri: str) -> str:
    decoded = unquote(uri)
    for match in reversed(list(ENCODED_AUTHORITY.finditer(decoded))):
        try:
            value = bytes.fromhex(match.group(1)).decode()
        except (ValueError, UnicodeDecodeError):
            continue
        decoded = decoded[: match.start(1)] + value + decoded[match.end(1) :]
    return decoded


def find_workspace(storage_root: Path, host: str, workspace: str) -> tuple[Path, str]:
    matches = []
    expected_path = workspace.rstrip("/")
    for metadata in storage_root.expanduser().glob("*/workspace.json"):
        payload = json.loads(metadata.read_text())
        uri = payload.get("folder", "")
        decoded = decode_workspace_uri(uri)
        if f'"hostName":"{host}"' in decoded and decoded.rstrip("/").endswith(expected_path):
            database = metadata.with_name("state.vscdb")
            if database.is_file():
                matches.append((database, decoded))
    if len(matches) != 1:
        raise ValueError(
            f"Expected exactly one workspace for host={host} path={workspace}, found {len(matches)}"
        )
    return matches[0]


def codex_entry(item: object) -> bool:
    if not isinstance(item, dict):
        return False
    return item.get("providerType") == "openai-codex" or str(
        item.get("resource", "")
    ).startswith("openai-codex:")


def inspect_database(database: Path) -> dict[str, int]:
    result = {}
    with sqlite3.connect(f"file:{database}?mode=ro", uri=True) as connection:
        for key in ("agentSessions.model.cache", "agentSessions.state.cache"):
            row = connection.execute(
                "SELECT value FROM ItemTable WHERE key = ?", (key,)
            ).fetchone()
            entries = json.loads(row[0]) if row else []
            result[key] = sum(codex_entry(item) for item in entries)
    return result


def ensure_database_closed(database: Path) -> None:
    lsof = shutil.which("lsof")
    if not lsof:
        return
    result = subprocess.run(
        [lsof, str(database)], capture_output=True, text=True, check=False
    )
    if result.returncode == 0 and result.stdout.strip():
        raise RuntimeError("The matching VS Code workspace is still using state.vscdb")


def cleanup_database(database: Path, backup_root: Path) -> tuple[Path, dict[str, int]]:
    ensure_database_closed(database)
    before = inspect_database(database)
    backup_root.mkdir(parents=True, exist_ok=True)
    backup = backup_root / (
        f"{database.parent.name}-state.vscdb-before-codex-cleanup-"
        f"{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    )
    with sqlite3.connect(database) as source, sqlite3.connect(backup) as destination:
        source.backup(destination)
    with sqlite3.connect(database) as connection:
        for key in ("agentSessions.model.cache", "agentSessions.state.cache"):
            row = connection.execute(
                "SELECT value FROM ItemTable WHERE key = ?", (key,)
            ).fetchone()
            if not row:
                continue
            entries = json.loads(row[0])
            retained = [item for item in entries if not codex_entry(item)]
            connection.execute(
                "UPDATE ItemTable SET value = ? WHERE key = ?",
                (json.dumps(retained, ensure_ascii=False, separators=(",", ":")), key),
            )
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise RuntimeError(f"SQLite integrity check failed: {integrity}")
    return backup, before


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Clean stale Codex indexes from one closed VS Code remote workspace"
    )
    parser.add_argument("--host", required=True, help="SSH host alias")
    parser.add_argument("--workspace", required=True, help="Remote workspace path")
    parser.add_argument("--storage-root", type=Path, default=DEFAULT_STORAGE_ROOT)
    parser.add_argument("--backup-root", type=Path, default=DEFAULT_BACKUP_ROOT)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    database, decoded_uri = find_workspace(args.storage_root, args.host, args.workspace)
    counts = inspect_database(database)
    print(f"WORKSPACE {decoded_uri}")
    print(f"DATABASE {database}")
    print(f"CODEX_ENTRIES {sum(counts.values())}")
    if not args.apply:
        print("DRY_RUN close this VS Code window, then rerun with --apply")
        return
    backup, removed = cleanup_database(database, args.backup_root)
    remaining = sum(inspect_database(database).values())
    print(f"BACKUP {backup}")
    print(f"REMOVED {sum(removed.values())}")
    print(f"REMAINING {remaining}")
    print("CLEANED reopen the VS Code window")


if __name__ == "__main__":
    main()
