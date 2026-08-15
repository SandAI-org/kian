#!/usr/bin/env python3
"""发布微信群二维码并结束当前提醒轮次。

用法：
  python3 qr_update_publish.py /abs/path/to/new_qr.png

动作：
1) 覆盖私有配置指定的目标图片
2) git add/commit
3) push 前显式 unset http_proxy/https_proxy（含大小写）
4) git push origin main
5) 写入 qr-reminder-state.json 标记本轮 completed=true
6) 发送飞书回执
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from automation_common import STATE_DIR, load_config

BASE = Path(__file__).resolve().parent
CONFIG = load_config().get("qr_publish", {})
STATE_PATH = STATE_DIR / "qr-reminder-state.json"
REMIND_SCRIPT = BASE / "feishu_remind.py"
REPO_DIR = Path(CONFIG.get("repo_dir", "")).expanduser()
TARGET_FILE = REPO_DIR / CONFIG.get("target_file", "")
BRANCH = CONFIG.get("branch", "main")


def run(cmd: list[str], cwd: Path | None = None, env: dict[str, str] | None = None) -> str:
    proc = subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or proc.stdout.strip() or f"command failed: {' '.join(cmd)}")
    return proc.stdout.strip()


def load_state() -> dict:
    try:
        return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_state(state: dict) -> None:
    STATE_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def notify(title: str, body: str) -> None:
    run([sys.executable, str(REMIND_SCRIPT), title, body])


def main() -> None:
    if len(sys.argv) != 2:
        raise RuntimeError("用法: qr_update_publish.py /abs/path/to/new_qr.png")
    for key in ("repo_dir", "target_file", "branch"):
        value = str(CONFIG.get(key, ""))
        if not value or value.startswith("REPLACE_WITH_"):
            raise RuntimeError(f"私有配置 qr_publish.{key} 尚未设置")

    src = Path(sys.argv[1]).expanduser().resolve()
    if not src.exists() or not src.is_file():
        raise RuntimeError(f"图片不存在: {src}")

    if not REPO_DIR.exists():
        raise RuntimeError(f"仓库不存在: {REPO_DIR}")

    shutil.copyfile(src, TARGET_FILE)

    run(["git", "add", str(CONFIG["target_file"])], cwd=REPO_DIR)

    commit_msg = CONFIG.get("commit_message", "chore: update QR code ({date})").format(
        date=datetime.now().strftime("%Y-%m-%d")
    )
    diff_exit = subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=str(REPO_DIR)).returncode
    if diff_exit != 0:
        run(["git", "commit", "-m", commit_msg], cwd=REPO_DIR)

    # push 前显式 unset 代理
    env = os.environ.copy()
    for key in ("http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY"):
        env.pop(key, None)

    run(["git", "push", "origin", BRANCH], cwd=REPO_DIR, env=env)
    head = run(["git", "log", "-1", "--oneline"], cwd=REPO_DIR)

    state = load_state()
    state["completed"] = True
    state["completed_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    state["last_publish_commit"] = head.split(" ")[0]
    save_state(state)

    notify(
        "✅ 二维码已发布",
        "微信群二维码已完成替换并推送。\\n\\n"
        f"图片来源：`{src}`\\n"
        f"提交：`{head}`\\n"
        f"目标文件：`{TARGET_FILE}`",
    )

    print("PUBLISHED")
    print(head)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        try:
            notify("❌ 二维码发布失败", f"二维码发布失败：{exc}")
        except Exception:
            pass
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
