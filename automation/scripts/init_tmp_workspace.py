#!/usr/bin/env python3
"""Initialize the standard ignored .tmp workspace structure."""
from __future__ import annotations

import argparse
import shlex
from pathlib import Path, PurePosixPath

try:
    from .file_transfer import Endpoint, parse_endpoint, ssh
except ImportError:
    from file_transfer import Endpoint, parse_endpoint, ssh


TMP_DIRECTORIES = (
    ".tmp_cache",
    ".tmp_chats",
    ".tmp_configs",
    ".tmp_data",
    ".tmp_libs",
    ".tmp_logs",
    ".tmp_notes",
    ".tmp_patches",
    ".tmp_scripts",
    ".tmp_tests",
    ".tmp_worktrees",
)


def initialize_local(workspace: Path) -> Path:
    if not workspace.is_dir():
        raise FileNotFoundError(f"Workspace does not exist: {workspace}")
    tmp_dir = workspace / ".tmp"
    if tmp_dir.is_symlink():
        raise RuntimeError(f"Refusing symlinked .tmp directory: {tmp_dir}")
    for name in TMP_DIRECTORIES:
        (tmp_dir / name).mkdir(parents=True, exist_ok=True)
    gitignore = tmp_dir / ".gitignore"
    if gitignore.is_symlink():
        raise RuntimeError(f"Refusing symlinked .gitignore: {gitignore}")
    if not gitignore.exists():
        gitignore.write_text("**\n", encoding="utf-8")
    elif "**" not in gitignore.read_text(encoding="utf-8").splitlines():
        with gitignore.open("a", encoding="utf-8") as handle:
            handle.write("\n**\n")
    return tmp_dir


def initialize_remote(workspace: Endpoint) -> str:
    tmp_dir = str(PurePosixPath(workspace.path) / ".tmp")
    gitignore = str(PurePosixPath(tmp_dir) / ".gitignore")
    directories = " ".join(
        shlex.quote(str(PurePosixPath(tmp_dir) / name)) for name in TMP_DIRECTORIES
    )
    command = "\n".join(
        (
            f"test -d {shlex.quote(workspace.path)} || {{ echo 'Workspace does not exist' >&2; exit 2; }}",
            f"test ! -L {shlex.quote(tmp_dir)} || {{ echo 'Refusing symlinked .tmp directory' >&2; exit 3; }}",
            f"mkdir -p {directories}",
            f"test ! -L {shlex.quote(gitignore)} || {{ echo 'Refusing symlinked .gitignore' >&2; exit 4; }}",
            f"if test ! -e {shlex.quote(gitignore)}; then printf '%s\\n' '**' > {shlex.quote(gitignore)}; "
            f"elif ! grep -Fqx '**' {shlex.quote(gitignore)}; then printf '\\n%s\\n' '**' >> {shlex.quote(gitignore)}; fi",
        )
    )
    ssh(workspace.host or "", command)
    return tmp_dir


def initialize(workspace: Endpoint) -> str:
    if workspace.remote:
        return initialize_remote(workspace)
    return str(initialize_local(Path(workspace.path)))


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Initialize the standard ignored .tmp directories in a workspace"
    )
    parser.add_argument("workspace", help="local path or configured-machine:/workspace/path")
    args = parser.parse_args()
    workspace = parse_endpoint(args.workspace, local_default_downloads=False)
    initialized = initialize(workspace)
    print(f"TMP_WORKSPACE_INITIALIZED path={initialized}")
    print("directories=" + ",".join(TMP_DIRECTORIES))
    print("gitignore=**")


if __name__ == "__main__":
    main()
