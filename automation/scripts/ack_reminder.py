#!/usr/bin/env python3
"""Send configured reminders repeatedly until their card action is acknowledged."""

import json
import os
from datetime import datetime
from pathlib import Path

from automation_common import STATE_DIR, load_config
from feishu_remind import send


REMINDER_STATE_DIR = STATE_DIR / "ack-reminders"


def occurrence_for(now):
    return now.date().isoformat()


def state_path(reminder_id):
    return REMINDER_STATE_DIR / f"{reminder_id}.json"


def load_state(reminder_id):
    try:
        return json.loads(state_path(reminder_id).read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}


def write_state(reminder_id, state):
    REMINDER_STATE_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    target = state_path(reminder_id)
    temporary = target.with_suffix(f".{os.getpid()}.tmp")
    temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.chmod(temporary, 0o600)
    os.replace(temporary, target)


def due(reminder, state, now):
    schedule = reminder.get("schedule", {})
    try:
        scheduled = now.replace(
            hour=int(schedule.get("hour", 0)),
            minute=int(schedule.get("minute", 0)),
            second=0,
            microsecond=0,
        )
        repeat_seconds = max(60, int(reminder.get("repeat_interval_seconds", 300)))
    except (TypeError, ValueError):
        return False
    occurrence = occurrence_for(now)
    if now < scheduled or state.get("acknowledged_occurrence") == occurrence:
        return False
    if state.get("occurrence") != occurrence:
        return True
    try:
        last_sent = datetime.fromisoformat(state["last_sent_at"])
    except (KeyError, TypeError, ValueError):
        return True
    if last_sent.tzinfo is None and now.tzinfo is not None:
        last_sent = last_sent.replace(tzinfo=now.tzinfo)
    return (now - last_sent).total_seconds() >= repeat_seconds


def confirmation_button(reminder_id, occurrence, reminder):
    return {
        "tag": "button",
        "type": "primary",
        "text": {
            "tag": "plain_text",
            "content": str(reminder.get("confirm_button_text", "已阅")),
        },
        "value": {
            "action": "ack_reminder",
            "reminder_id": reminder_id,
            "occurrence": occurrence,
        },
    }


def run(now=None, config=None):
    now = now or datetime.now().astimezone()
    config = config or load_config()
    results = []
    for reminder_id, reminder in config.get("reminders", {}).items():
        if not reminder.get("enabled", True):
            continue
        state = load_state(reminder_id)
        if not due(reminder, state, now):
            continue
        occurrence = occurrence_for(now)
        actions = [confirmation_button(reminder_id, occurrence, reminder)] \
            if reminder.get("confirmation_required", False) else None
        response = send(
            str(reminder.get("title", "⏰ 提醒")),
            str(reminder.get("body", "")),
            actions=actions,
        )
        data = response.get("data", {}) if isinstance(response, dict) else {}
        # The user may click very quickly while the send request is returning.
        # Re-read before recording delivery metadata so an acknowledgement
        # written by the bridge cannot be lost to a stale state overwrite.
        state = load_state(reminder_id)
        state.update({
            "occurrence": occurrence,
            "last_sent_at": now.isoformat(),
            "last_message_id": data.get("message_id", ""),
        })
        write_state(reminder_id, state)
        results.append(reminder_id)
    return results


if __name__ == "__main__":
    sent = run()
    print("SENT " + ",".join(sent) if sent else "NOT_DUE")
