#!/usr/bin/env python3
"""Publish and distribute a Git alias setup script without executing it."""
from __future__ import annotations

import argparse
import subprocess
from pathlib import Path
from typing import Any

try:
    from .automation_common import load_config
    from .file_transfer import Endpoint, direct_transfer, translate_remote
except ImportError:
    from automation_common import load_config
    from file_transfer import Endpoint, direct_transfer, translate_remote


def run(command: list[str], *, cwd: Path | None = None, capture: bool = False) -> str:
    result = subprocess.run(
        command,
        cwd=cwd,
        check=True,
        text=True,
        stdout=subprocess.PIPE if capture else None,
    )
    return result.stdout.strip() if capture else ""


def require_config(config: dict[str, Any]) -> tuple[Path, Path, list[dict[str, str]]]:
    section = config.get("git_alias_sync")
    if not isinstance(section, dict):
        raise RuntimeError("Private configuration is missing git_alias_sync")
    source = Path(str(section.get("source_script", ""))).expanduser().resolve()
    repo = Path(str(section.get("source_repo", ""))).expanduser().resolve()
    targets = section.get("targets")
    if not source.is_file() or not repo.is_dir():
        raise RuntimeError("git_alias_sync source_script or source_repo is invalid")
    if not isinstance(targets, list) or not targets:
        raise RuntimeError("git_alias_sync.targets must be a non-empty list")
    normalized_targets = []
    for target in targets:
        if not isinstance(target, dict) or not target.get("machine") or not target.get("path"):
            raise RuntimeError("Each git_alias_sync target requires machine and path")
        normalized_targets.append({"machine": str(target["machine"]), "path": str(target["path"])})
    return source, repo, normalized_targets


def publish(repo: Path, source: Path, message: str) -> None:
    relative_source = source.relative_to(repo)
    run(["git", "add", "--", str(relative_source)], cwd=repo)
    changed = subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=repo).returncode != 0
    if changed:
        run(["git", "commit", "-m", message], cwd=repo)
    env_command = ["git", "-c", "http.proxy=", "-c", "https.proxy=", "push"]
    run(env_command, cwd=repo)
    print(f"SOURCE_PUBLISHED changed={str(changed).lower()}")


def sync(source: Path, targets: list[dict[str, str]]) -> None:
    run(["bash", "-n", str(source)])
    local = Endpoint(None, str(source))
    for index, target in enumerate(targets, start=1):
        machine = target["machine"]
        destination = translate_remote(machine, target["path"])
        print(f"SYNC {index}/{len(targets)} machine={machine}")
        direct_transfer(local, destination, False)
        print(f"RUN_COMMAND machine={machine} command=bash {target['path']}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync a Git alias script without executing it")
    parser.add_argument("--commit-message", help="commit and push the source script before syncing")
    args = parser.parse_args()
    source, repo, targets = require_config(load_config())
    if args.commit_message:
        publish(repo, source, args.commit_message)
    sync(source, targets)
    print(f"RUN_COMMAND machine=local command=bash {source}")
    print(f"GIT_ALIAS_SYNC_COMPLETE targets={len(targets)}")


if __name__ == "__main__":
    main()
