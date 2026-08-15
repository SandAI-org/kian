#!/usr/bin/env python3
"""微信群二维码更新提醒（滚动轮次状态机）。

规则：
1) 新轮次从“实际开始日”算起（不是固定锚点自然周）。
2) 未完成时每天提醒一次，直到发布脚本 push 成功。
3) 完成后等待 7 天，次日程触发时自动开启下一轮。
"""
import os
import subprocess
import sys
from datetime import date, datetime, timedelta
from typing import Any, Optional

import json

from automation_common import STATE_DIR, load_config

QR_CONFIG = load_config().get("qr_publish", {})
STATE_PATH = str(STATE_DIR / "qr-reminder-state.json")
ROUND_DAYS = 7


def load_state() -> dict[str, Any]:
    try:
        with open(STATE_PATH, encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, dict):
                return data
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    return {}


def save_state(state: dict[str, Any]) -> None:
    with open(STATE_PATH, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)
        f.write("\n")


def parse_iso_day(value: str) -> Optional[date]:
    if not value:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def next_round_start_from_completed(completed_at: str) -> Optional[date]:
    try:
        completed_day = datetime.fromisoformat(completed_at.replace("Z", "+00:00")).date()
    except ValueError:
        return None
    return completed_day + timedelta(days=ROUND_DAYS)


def new_round_state(today: date, prev_round_index: int) -> dict[str, Any]:
    return {
        "round_index": max(prev_round_index, -1) + 1,
        "round_start": today.isoformat(),
        "completed": False,
        "completed_at": "",
        "last_reminded_at": "",
        "last_publish_commit": "",
    }

today = date.today()
state = load_state()
prev_round_index = int(state.get("round_index", -1)) if isinstance(state.get("round_index", -1), int) else -1

if not state:
    state = new_round_state(today, prev_round_index)
else:
    state.setdefault("round_start", today.isoformat())
    state.setdefault("completed", False)
    state.setdefault("completed_at", "")
    state.setdefault("last_reminded_at", "")
    state.setdefault("last_publish_commit", "")
    if not isinstance(state.get("round_index"), int):
        state["round_index"] = prev_round_index

# 已完成：到达下一轮开始日才开新轮；否则跳过提醒。
if state.get("completed"):
    next_round_start = next_round_start_from_completed(str(state.get("completed_at", "")))
    if next_round_start and today >= next_round_start:
        state = new_round_state(today, int(state.get("round_index", -1)))
    else:
        save_state(state)
        print(
            "SKIP "
            f"(round={state.get('round_index')}, completed_at={state.get('completed_at','')}, "
            f"next_round_start={(next_round_start.isoformat() if next_round_start else 'unknown')})"
        )
        raise SystemExit(0)

round_index = int(state.get("round_index", 0))
round_start = parse_iso_day(str(state.get("round_start", ""))) or today
state["round_start"] = round_start.isoformat()

remind = os.path.join(os.path.dirname(os.path.abspath(__file__)), "feishu_remind.py")
body = QR_CONFIG.get("reminder_body") or (
    "该更新微信群二维码啦！🔄\\n\\n"
    f"当前轮次开始于：`{round_start.isoformat()}`（7 天一轮）\\n"
    f"最近一次提醒日期：`{state.get('last_reminded_at', '') or '无'}`\\n"
    "本轮尚未完成，会每天同一时间提醒，直到你把新二维码图片路径发给我并推送成功。\\n\\n"
    "请：\\n\\n"
    "1️⃣ 去微信群保存最新二维码图片\\n"
    "2️⃣ 把图片路径发给我（默认在 Downloads 下）\\n"
    "3️⃣ 我会自动执行：替换 -> 提交 -> push（push 前 unset 代理） -> 标记本轮完成"
)
title = QR_CONFIG.get("reminder_title", "📱 二维码更新提醒")
subprocess.run([sys.executable, remind, title, body], check=False)
state["last_reminded_at"] = today.isoformat()
save_state(state)
print(f"REMINDED (round={round_index}, round_start={round_start.isoformat()}, completed=false)")
