#!/usr/bin/env python3
"""Manage public repository follow state for agent-driven workflows.

Users interact through natural language. Agents use this small utility after
updating the matching ai-agent-contexts item so Kian's runtime state mirrors
the durable intent.
"""

import argparse
import json
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from automation_common import STATE_DIR


PINS_DIR = STATE_DIR / "public-watch-pins"
GITHUB_ITEM = re.compile(
    r"^/(?P<owner>[A-Za-z0-9_.-]+)/(?P<name>[A-Za-z0-9_.-]+)/"
    r"(?P<section>pull|issues)/(?P<number>[1-9][0-9]*)/?$"
)


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_item_url(value):
    parsed = urlparse(value.strip())
    if parsed.scheme != "https" or parsed.netloc.lower() not in ("github.com", "www.github.com"):
        raise ValueError("仅支持 GitHub PR/Issue 的 HTTPS 链接")
    match = GITHUB_ITEM.fullmatch(parsed.path)
    if not match:
        raise ValueError("链接必须形如 https://github.com/<owner>/<repo>/pull/<n> 或 /issues/<n>")
    values = match.groupdict()
    return {
        "repo": "{0}/{1}".format(values["owner"], values["name"]),
        "number": int(values["number"]),
        "kind": "pr" if values["section"] == "pull" else "issue",
        "url": "https://github.com/{0}/{1}/{2}/{3}".format(
            values["owner"], values["name"], values["section"], values["number"],
        ),
    }


def state_path(item):
    owner, name = item["repo"].split("/", 1)
    return PINS_DIR / owner / name / (str(item["number"]) + ".json")


def load(path):
    try:
        with path.open(encoding="utf-8") as handle:
            value = json.load(handle)
        return value if isinstance(value, dict) else {}
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor, temporary = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def pin(url, actor="agent"):
    item = parse_item_url(url)
    path = state_path(item)
    previous = load(path)
    value = dict(previous)
    value.update({
        "active": True,
        "repo": item["repo"],
        "number": item["number"],
        "kind": item["kind"],
        "url": item["url"],
        "pinned_at": now_iso(),
        "pinned_by": actor,
    })
    for key in ("completed_at", "outcome", "unpinned_at"):
        value.pop(key, None)
    save(path, value)
    return value


def unpin(url, actor="agent"):
    item = parse_item_url(url)
    path = state_path(item)
    value = load(path)
    value.update({
        "active": False,
        "repo": item["repo"],
        "number": item["number"],
        "kind": item["kind"],
        "url": item["url"],
        "unpinned_at": now_iso(),
        "unpinned_by": actor,
        "outcome": "user_unpinned",
    })
    save(path, value)
    return value


def active_pins():
    if not PINS_DIR.exists():
        return []
    values = []
    for path in sorted(PINS_DIR.glob("*/*/*.json")):
        value = load(path)
        if value.get("active"):
            values.append(value)
    return values


def main():
    parser = argparse.ArgumentParser(description="Manage Kian public repository follows")
    subparsers = parser.add_subparsers(dest="command", required=True)
    for command in ("pin", "unpin"):
        child = subparsers.add_parser(command)
        child.add_argument("url")
        child.add_argument("--actor", default="agent")
    subparsers.add_parser("list")
    args = parser.parse_args()

    if args.command == "list":
        print(json.dumps(active_pins(), ensure_ascii=False, indent=2))
        return
    value = pin(args.url, args.actor) if args.command == "pin" else unpin(args.url, args.actor)
    print(json.dumps(value, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
