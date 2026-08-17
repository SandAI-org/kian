#!/usr/bin/env python3
"""Mirror pinned stable or newest development wheels for a configured profile."""
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


def discover_stable(
    machine: str, directories: list[str], stable_versions: dict[str, str]
) -> list[Endpoint]:
    host = translate_remote(machine, "/").host
    wheels = []
    for directory in directories:
        remote_dir = translate_remote(machine, directory).path
        command = f"find {shlex.quote(remote_dir)} -maxdepth 1 -type f -name '*.whl' -print"
        remote_wheels = [path for path in ssh(host or "", command).splitlines() if path]
        stable_prefixes = tuple(
            f"{distribution}-{version}-" for distribution, version in stable_versions.items()
        )
        candidates = [
            path
            for path in remote_wheels
            if PurePosixPath(path).name.startswith(stable_prefixes)
        ]
        if len(candidates) != 1:
            raise RuntimeError(
                f"Expected exactly one pinned stable wheel in {machine}:{directory}; "
                f"found {len(candidates)}"
            )
        wheels.append(Endpoint(host, candidates[0]))
    names = [PurePosixPath(wheel.path).name for wheel in wheels]
    if len(names) != len(set(names)):
        raise RuntimeError("Discovered wheels contain duplicate filenames and would overwrite each other")
    discovered_distributions = {wheel_distribution(name) for name in names}
    if discovered_distributions != set(stable_versions):
        raise RuntimeError(
            "Pinned stable distributions do not match dist directories: "
            f"expected {sorted(stable_versions)}, found {sorted(discovered_distributions)}"
        )
    return wheels


def discover_latest(
    machine: str, directories: list[str], expected_distributions: list[str]
) -> list[Endpoint]:
    host = translate_remote(machine, "/").host
    wheels = []
    for directory, distribution in zip(directories, expected_distributions, strict=True):
        remote_dir = translate_remote(machine, directory).path
        pattern = f"{distribution}-*.whl"
        command = (
            f"find {shlex.quote(remote_dir)} -maxdepth 1 -type f "
            f"-name {shlex.quote(pattern)} -printf '%T@\\t%p\\n' "
            "| sort -nr | head -n 1 | cut -f 2-"
        )
        wheel_path = ssh(host or "", command).strip()
        if not wheel_path:
            raise RuntimeError(
                f"No development wheel for {distribution} in {machine}:{directory}"
            )
        wheels.append(Endpoint(host, wheel_path))
    names = [PurePosixPath(wheel.path).name for wheel in wheels]
    if len(names) != len(set(names)):
        raise RuntimeError("Discovered wheels contain duplicate filenames and would overwrite each other")
    discovered_distributions = [wheel_distribution(name) for name in names]
    if discovered_distributions != expected_distributions:
        raise RuntimeError(
            "Development wheel distributions do not match configuration: "
            f"expected {expected_distributions}, found {discovered_distributions}"
        )
    return wheels


def validate_profile(
    profile: dict,
) -> tuple[str, list[str], list[str], str, str, dict[str, str], list[str]]:
    source = str(profile.get("source_machine", "")).strip()
    directories = profile.get("dist_dirs", [])
    destinations = profile.get("destination_machines", [])
    target_dir = str(profile.get("target_dir", "")).strip()
    selection_mode = str(profile.get("selection_mode", "stable")).strip().lower()
    configured_versions = profile.get("stable_versions", {})
    configured_distributions = profile.get("expected_distributions", [])
    if not source or not target_dir:
        raise RuntimeError("wheel-sync profile requires source_machine and target_dir")
    if not isinstance(directories, list) or not directories:
        raise RuntimeError("wheel-sync profile requires a non-empty dist_dirs list")
    if not isinstance(destinations, list) or not destinations:
        raise RuntimeError("wheel-sync profile requires a non-empty destination_machines list")
    if selection_mode not in {"stable", "latest"}:
        raise RuntimeError("wheel-sync selection_mode must be stable or latest")
    stable_versions = {
        str(distribution).strip(): str(version).strip()
        for distribution, version in configured_versions.items()
    } if isinstance(configured_versions, dict) else {}
    expected_distributions = (
        [str(distribution).strip() for distribution in configured_distributions]
        if isinstance(configured_distributions, list)
        else []
    )
    if selection_mode == "stable" and not stable_versions:
        raise RuntimeError("stable wheel-sync profile requires a non-empty stable_versions mapping")
    if selection_mode == "latest" and not expected_distributions:
        raise RuntimeError("latest wheel-sync profile requires expected_distributions")
    if selection_mode == "latest" and "dev" not in PurePosixPath(target_dir).parts:
        raise RuntimeError("latest wheel-sync profile target_dir must contain a dev directory")
    selected_distributions = list(stable_versions) if selection_mode == "stable" else expected_distributions
    if any(not distribution for distribution in selected_distributions):
        raise RuntimeError("wheel-sync distribution names must be non-empty")
    if len(selected_distributions) != len(set(selected_distributions)):
        raise RuntimeError("wheel-sync distribution names must be unique")
    if selection_mode == "stable" and any(not version for version in stable_versions.values()):
        raise RuntimeError("wheel-sync stable version values must be non-empty")
    if len(selected_distributions) != len(directories):
        raise RuntimeError(
            "wheel-sync requires one selected distribution per dist_dirs entry"
        )
    return (
        source,
        [str(item) for item in directories],
        [str(item) for item in destinations],
        target_dir,
        selection_mode,
        stable_versions,
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
        selection_mode,
        stable_versions,
        expected_distributions,
    ) = validate_profile(load_profile(name))
    wheels = (
        discover_stable(source_machine, directories, stable_versions)
        if selection_mode == "stable"
        else discover_latest(source_machine, directories, expected_distributions)
    )
    print(f"PROFILE: {name}")
    print(f"SOURCE: {source_machine}")
    print(f"SELECTION_MODE: {selection_mode}")
    if selection_mode == "stable":
        for distribution, version in sorted(stable_versions.items()):
            print(f"PINNED_STABLE_VERSION {distribution}={version}")
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
    parser = argparse.ArgumentParser(description="Mirror stable or development wheels for one profile")
    parser.add_argument("profile", help="profile name under wheel_sync.profiles")
    parser.add_argument("--discover-only", action="store_true", help="find and print wheels without transferring")
    args = parser.parse_args()
    sync_profile(args.profile, args.discover_only)


if __name__ == "__main__":
    main()
