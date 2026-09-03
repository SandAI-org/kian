#!/usr/bin/env python3
"""Remove a VS Code Remote-SSH host cache identified by pasted output."""
from __future__ import annotations

import argparse
import re
import shutil
from pathlib import Path

DEFAULT_CACHE_ROOT = (
    Path.home()
    / "Library/Application Support/Code/User/globalStorage/ms-vscode-remote.remote-ssh"
)
HASH_PATTERN = re.compile(r"vscode-ssh-host-([0-9a-fA-F]{8,})", re.IGNORECASE)


def extract_short_hash(text: str) -> str:
    match = HASH_PATTERN.search(text)
    if not match:
        raise ValueError("No vscode-ssh-host hash with at least 8 hexadecimal characters found")
    return match.group(1)[:8].lower()


def matching_cache_dirs(cache_root: Path, short_hash: str) -> list[Path]:
    root = cache_root.expanduser().resolve()
    if not root.is_dir():
        return []
    matches = []
    for candidate in root.glob(f"vscode-ssh-host-{short_hash}*"):
        if candidate.is_dir() and candidate.parent.resolve() == root:
            matches.append(candidate)
    return sorted(matches)


def cleanup(text: str, cache_root: Path = DEFAULT_CACHE_ROOT) -> list[str]:
    short_hash = extract_short_hash(text)
    matches = matching_cache_dirs(cache_root, short_hash)
    names = [path.name for path in matches]
    for path in matches:
        shutil.rmtree(path)
    return names


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Remove matching VS Code Remote-SSH host cache directories"
    )
    parser.add_argument("output", help="Pasted Remote-SSH output or path fragment")
    parser.add_argument("--cache-root", type=Path, default=DEFAULT_CACHE_ROOT)
    args = parser.parse_args()

    short_hash = extract_short_hash(args.output)
    removed = cleanup(args.output, args.cache_root)
    if not removed:
        print(f"NO_MATCH hash={short_hash}")
        return
    for name in removed:
        print(f"REMOVED {name}")
    print(f"CLEANED hash={short_hash} count={len(removed)}")
    print("Reload the VS Code window and reconnect.")


if __name__ == "__main__":
    main()
