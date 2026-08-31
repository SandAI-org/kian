#!/usr/bin/env python3
"""Mirror the single wheel from each configured dist directory."""
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


def discover_unique(
    machine: str, directories: list[str], expected_distributions: list[str]
) -> list[Endpoint]:
    host = translate_remote(machine, "/").host
    wheels = []
    for directory, expected_distribution in zip(
        directories, expected_distributions, strict=True
    ):
        remote_dir = translate_remote(machine, directory).path
        command = f"find {shlex.quote(remote_dir)} -maxdepth 1 -type f -name '*.whl' -print"
        candidates = [path for path in ssh(host or "", command).splitlines() if path]
        if len(candidates) != 1:
            raise RuntimeError(
                f"Expected exactly one wheel in {machine}:{directory}; "
                f"found {len(candidates)}"
            )
        distribution = wheel_distribution(PurePosixPath(candidates[0]).name)
        if distribution != expected_distribution:
            raise RuntimeError(
                f"Expected {expected_distribution} in {machine}:{directory}; "
                f"found {distribution}"
            )
        wheels.append(Endpoint(host, candidates[0]))
    names = [PurePosixPath(wheel.path).name for wheel in wheels]
    if len(names) != len(set(names)):
        raise RuntimeError("Discovered wheels contain duplicate filenames and would overwrite each other")
    return wheels


def validate_profile(
    profile: dict,
) -> tuple[str, list[str], list[str], str, list[str]]:
    source = str(profile.get("source_machine", "")).strip()
    directories = profile.get("dist_dirs", [])
    destinations = profile.get("destination_machines", [])
    target_dir = str(profile.get("target_dir", "")).strip()
    configured_distributions = profile.get("expected_distributions", [])
    if not source or not target_dir:
        raise RuntimeError("wheel-sync profile requires source_machine and target_dir")
    if not isinstance(directories, list) or not directories:
        raise RuntimeError("wheel-sync profile requires a non-empty dist_dirs list")
    if not isinstance(destinations, list) or not destinations:
        raise RuntimeError("wheel-sync profile requires a non-empty destination_machines list")
    expected_distributions = (
        [str(distribution).strip() for distribution in configured_distributions]
        if isinstance(configured_distributions, list)
        else []
    )
    if not expected_distributions:
        raise RuntimeError("wheel-sync profile requires expected_distributions")
    if any(not distribution for distribution in expected_distributions):
        raise RuntimeError("wheel-sync distribution names must be non-empty")
    if len(expected_distributions) != len(set(expected_distributions)):
        raise RuntimeError("wheel-sync distribution names must be unique")
    if len(expected_distributions) != len(directories):
        raise RuntimeError(
            "wheel-sync requires one expected distribution per dist_dirs entry"
        )
    return (
        source,
        [str(item) for item in directories],
        [str(item) for item in destinations],
        target_dir,
        expected_distributions,
    )


def wheel_distribution(filename: str) -> str:
    distribution, separator, remainder = filename.partition("-")
    if not separator or not distribution or not remainder.endswith(".whl"):
        raise RuntimeError(f"Invalid wheel filename: {filename}")
    return distribution


def remote_sha256(endpoint: Endpoint) -> str:
    if not endpoint.remote:
        raise RuntimeError("remote_sha256 requires a remote endpoint")
    command = f"sha256sum {shlex.quote(endpoint.path)} | awk '{{print $1}}'"
    digest = ssh(endpoint.host or "", command).strip()
    if not digest:
        raise RuntimeError(f"Could not read SHA-256 for {endpoint.host}:{endpoint.path}")
    return digest


def destination_needs_update(
    machine: str, target_dir: str, wheel: Endpoint, source_digest: str
) -> bool:
    destination_dir = translate_remote(machine, target_dir)
    filename = PurePosixPath(wheel.path).name
    target = Endpoint(destination_dir.host, str(PurePosixPath(destination_dir.path) / filename))
    command = (
        f"if test -f {shlex.quote(target.path)}; then "
        f"sha256sum {shlex.quote(target.path)} | awk '{{print $1}}'; fi"
    )
    return ssh(target.host or "", command).strip() != source_digest


def clean_old_wheels(
    machine: str, target_dir: str, wheels: list[Endpoint], *, remove_current: bool = False
) -> None:
    destination = translate_remote(machine, target_dir)
    host = destination.host or ""
    ssh(host, f"mkdir -p {shlex.quote(destination.path)}")
    for wheel in wheels:
        filename = PurePosixPath(wheel.path).name
        distribution = wheel_distribution(filename)
        command = (
            f"find {shlex.quote(destination.path)} -maxdepth 1 -type f "
            f"-name {shlex.quote(distribution + '-*.whl')} "
        )
        if not remove_current:
            command += f"! -name {shlex.quote(filename)} "
        command += "-print -delete"
        removed = ssh(host, command)
        for old_path in removed.splitlines():
            if old_path:
                print(f"REMOVED_OLD_WHEEL {machine}:{old_path}")


def sync_profile(name: str, discover_only: bool = False) -> None:
    (
        source_machine,
        directories,
        destination_machines,
        target_dir,
        expected_distributions,
    ) = validate_profile(load_profile(name))
    wheels = discover_unique(source_machine, directories, expected_distributions)
    print(f"PROFILE: {name}")
    print(f"SOURCE: {source_machine}")
    print("SELECTION_MODE: unique-wheel")
    for index, wheel in enumerate(wheels, start=1):
        print(f"DISCOVERED {index}/{len(wheels)}: {PurePosixPath(wheel.path).name}")
    if discover_only:
        print(f"DISCOVERY_COMPLETE profile={name} wheels={len(wheels)}")
        return

    source_digests = {wheel: remote_sha256(wheel) for wheel in wheels}
    pending_by_destination = {}
    for destination_machine in destination_machines:
        pending = [
            wheel
            for wheel in wheels
            if destination_needs_update(
                destination_machine, target_dir, wheel, source_digests[wheel]
            )
        ]
        pending_by_destination[destination_machine] = pending
        pending_names = {PurePosixPath(wheel.path).name for wheel in pending}
        for wheel in wheels:
            filename = PurePosixPath(wheel.path).name
            if filename not in pending_names:
                print(f"UNCHANGED {destination_machine}:{filename}")

    wheels_to_stage = [
        wheel
        for wheel in wheels
        if any(wheel in pending for pending in pending_by_destination.values())
    ]
    if not wheels_to_stage:
        print(f"ALL_WHEELS_CURRENT profile={name} wheels={len(wheels)}")
        return

    with tempfile.TemporaryDirectory(prefix=f"kian-wheels-{name}-") as temporary_dir:
        staged = {}
        for index, wheel in enumerate(wheels_to_stage, start=1):
            local = Endpoint(None, str(Path(temporary_dir) / PurePosixPath(wheel.path).name))
            print(f"\nDOWNLOAD {index}/{len(wheels_to_stage)}: {wheel.path}", flush=True)
            direct_transfer(wheel, local, False)
            staged[wheel] = local

        total = sum(len(pending) for pending in pending_by_destination.values())
        completed = 0
        for destination_machine in destination_machines:
            pending = pending_by_destination[destination_machine]
            if not pending:
                continue
            destination = translate_remote(destination_machine, target_dir)
            for wheel in pending:
                local = staged[wheel]
                completed += 1
                print(
                    f"\nUPLOAD {completed}/{total}: {PurePosixPath(local.path).name} -> "
                    f"{destination_machine}:{target_dir}",
                    flush=True,
                )
                direct_transfer(local, destination, True)
                clean_old_wheels(destination_machine, target_dir, [wheel])

    print(
        f"\nUPDATED_WHEELS_SYNCED profile={name} wheels={len(wheels_to_stage)} "
        f"destinations={len(destination_machines)}"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Mirror the unique wheel from each dist directory")
    parser.add_argument("profile", help="profile name under wheel_sync.profiles")
    parser.add_argument("--discover-only", action="store_true", help="find and print wheels without transferring")
    args = parser.parse_args()
    sync_profile(args.profile, args.discover_only)


if __name__ == "__main__":
    main()
