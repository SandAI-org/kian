#!/usr/bin/env python3
"""Discover the newest wheel in each configured dist directory and mirror it."""
from __future__ import annotations

import argparse
import shlex
import tempfile
from pathlib import Path, PurePosixPath

from automation_common import load_config
from file_transfer import Endpoint, direct_transfer, ssh, translate_remote


def load_profile(name: str) -> dict:
    profiles = load_config().get("wheel_sync", {}).get("profiles", {})
    profile = profiles.get(name)
    if not isinstance(profile, dict):
        choices = ", ".join(sorted(profiles)) or "none configured"
        raise RuntimeError(f"Unknown wheel-sync profile {name!r}; choices: {choices}")
    return profile


def discover_latest(machine: str, directories: list[str]) -> list[Endpoint]:
    host = translate_remote(machine, "/").host
    wheels = []
    for directory in directories:
        remote_dir = translate_remote(machine, directory).path
        command = (
            f"find {shlex.quote(remote_dir)} -maxdepth 1 -type f -name '*.whl' "
            "-printf '%T@\\t%p\\n' | sort -nr | head -n 1 | cut -f 2-"
        )
        wheel_path = ssh(host or "", command).strip()
        if not wheel_path:
            raise RuntimeError(f"No wheel found in {machine}:{directory}")
        wheels.append(Endpoint(host, wheel_path))
    names = [PurePosixPath(wheel.path).name for wheel in wheels]
    if len(names) != len(set(names)):
        raise RuntimeError("Discovered wheels contain duplicate filenames and would overwrite each other")
    return wheels


def validate_profile(profile: dict) -> tuple[str, list[str], list[str], str]:
    source = str(profile.get("source_machine", "")).strip()
    directories = profile.get("dist_dirs", [])
    destinations = profile.get("destination_machines", [])
    target_dir = str(profile.get("target_dir", "")).strip()
    if not source or not target_dir:
        raise RuntimeError("wheel-sync profile requires source_machine and target_dir")
    if not isinstance(directories, list) or not directories:
        raise RuntimeError("wheel-sync profile requires a non-empty dist_dirs list")
    if not isinstance(destinations, list) or not destinations:
        raise RuntimeError("wheel-sync profile requires a non-empty destination_machines list")
    return source, [str(item) for item in directories], [str(item) for item in destinations], target_dir


def sync_profile(name: str, discover_only: bool = False) -> None:
    source_machine, directories, destination_machines, target_dir = validate_profile(load_profile(name))
    wheels = discover_latest(source_machine, directories)
    print(f"PROFILE: {name}")
    print(f"SOURCE: {source_machine}")
    for index, wheel in enumerate(wheels, start=1):
        print(f"DISCOVERED {index}/{len(wheels)}: {PurePosixPath(wheel.path).name}")
    if discover_only:
        print(f"DISCOVERY_COMPLETE profile={name} wheels={len(wheels)}")
        return

    with tempfile.TemporaryDirectory(prefix=f"kian-wheels-{name}-") as temporary_dir:
        staged = []
        for index, wheel in enumerate(wheels, start=1):
            local = Endpoint(None, str(Path(temporary_dir) / PurePosixPath(wheel.path).name))
            print(f"\nDOWNLOAD {index}/{len(wheels)}: {wheel.path}", flush=True)
            direct_transfer(wheel, local, False)
            staged.append(local)

        total = len(staged) * len(destination_machines)
        completed = 0
        for destination_machine in destination_machines:
            destination = translate_remote(destination_machine, target_dir)
            for local in staged:
                completed += 1
                print(
                    f"\nUPLOAD {completed}/{total}: {PurePosixPath(local.path).name} -> "
                    f"{destination_machine}:{target_dir}",
                    flush=True,
                )
                direct_transfer(local, destination, True)

    print(
        f"\nALL_WHEELS_SYNCED profile={name} wheels={len(wheels)} "
        f"destinations={len(destination_machines)}"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Mirror the newest wheels for one configured image profile")
    parser.add_argument("profile", help="profile name under wheel_sync.profiles")
    parser.add_argument("--discover-only", action="store_true", help="find and print wheels without transferring")
    args = parser.parse_args()
    sync_profile(args.profile, args.discover_only)


if __name__ == "__main__":
    main()
