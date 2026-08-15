#!/usr/bin/env python3
"""Shared paths and configuration for the portable automation scripts."""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


def automation_home() -> Path:
    configured = os.environ.get("KIAN_AUTOMATION_HOME", "~/.config/kian-automation")
    return Path(configured).expanduser().resolve()


HOME = automation_home()
CONFIG_PATH = HOME / "config" / "config.json"
STATE_DIR = HOME / "state"
LOG_DIR = HOME / "logs"


def ensure_runtime_dirs() -> None:
    for directory in (CONFIG_PATH.parent, STATE_DIR, LOG_DIR):
        directory.mkdir(parents=True, exist_ok=True)


def load_config() -> dict[str, Any]:
    try:
        with CONFIG_PATH.open(encoding="utf-8") as handle:
            data = json.load(handle)
    except FileNotFoundError as exc:
        raise RuntimeError(
            f"Private configuration not found at {CONFIG_PATH}; run automation/bin/install.sh first"
        ) from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid JSON in private configuration {CONFIG_PATH}: {exc}") from exc
    if not isinstance(data, dict):
        raise RuntimeError(f"Private configuration must be a JSON object: {CONFIG_PATH}")
    return data


ensure_runtime_dirs()
