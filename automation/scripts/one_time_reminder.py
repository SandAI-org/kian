#!/usr/bin/env python3
"""Send one scheduled Feishu reminder, then remove its LaunchAgent."""

import json
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path

from automation_common import STATE_DIR
from feishu_remind import send


def main():
    if len(sys.argv) != 6:
        raise SystemExit(
            "usage: one_time_reminder.py LABEL PLIST_PATH ISO_TIME TITLE BODY"
        )

    label, plist_path, scheduled_at, title, body = sys.argv[1:]
    if not label.startswith("com.kian.reminder-"):
        raise RuntimeError("invalid reminder label")

    trigger = datetime.fromisoformat(scheduled_at)
    now = datetime.now().astimezone()
    if trigger.tzinfo is None:
        trigger = trigger.replace(tzinfo=now.tzinfo)
    if now < trigger:
        print("NOT_DUE")
        return

    marker_dir = STATE_DIR / "one-time-reminders"
    marker_dir.mkdir(parents=True, exist_ok=True)
    marker = marker_dir / f"{label}.json"
    if marker.exists():
        print("ALREADY_SENT")
        return

    send(title, body.replace("\\n", "\n"))
    temporary = marker.with_suffix(".tmp")
    temporary.write_text(
        json.dumps({"label": label, "sent_at": now.isoformat()}, ensure_ascii=False)
        + "\n",
        encoding="utf-8",
    )
    os.replace(temporary, marker)
    Path(plist_path).unlink(missing_ok=True)
    print("SENT")

    subprocess.Popen(
        ["/bin/launchctl", "bootout", f"gui/{os.getuid()}/{label}"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


if __name__ == "__main__":
    main()