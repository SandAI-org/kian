#!/usr/bin/env python3
"""Gate selected notifications using rest days and a read-only personal calendar."""

import hashlib
import json
import os
from datetime import date, datetime, time, timedelta
import re
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

from automation_common import STATE_DIR, load_config


# State Council 2026 holiday notice: https://www.gov.cn/zhengce/content/202511/content_7047090.htm
HOLIDAYS = {
    2026: {
        "rest": [("01-01", "01-03"), ("02-15", "02-23"), ("04-04", "04-06"),
                 ("05-01", "05-05"), ("06-19", "06-21"), ("09-25", "09-27"),
                 ("10-01", "10-07")],
        "work": ["01-04", "02-14", "02-28", "05-09", "09-20", "10-10"],
    },
}


def statutory_workday(day):
    schedule = HOLIDAYS.get(day.year)
    if schedule is None:
        raise ValueError("Holiday schedule missing for year " + str(day.year))
    short = day.strftime("%m-%d")
    if short in schedule["work"]:
        return True
    if any(start <= short <= end for start, end in schedule["rest"]):
        return False
    return day.weekday() < 5


def event_overlaps_day(event, day, zone):
    def timestamp(value):
        if value.get("date"):
            return datetime.combine(date.fromisoformat(value["date"]), time(), zone).timestamp()
        return float(value["timestamp"])
    start = datetime.combine(day, time(), zone).timestamp()
    end = datetime.combine(day + timedelta(days=1), time(), zone).timestamp()
    return timestamp(event["start_time"]) < end and timestamp(event["end_time"]) > start


def is_leave_event(event, day, zone, patterns):
    if event.get("status") == "cancelled" or event.get("self_rsvp_status") == "decline":
        return False
    if not any(re.search(pattern, event.get("summary", ""), re.I) for pattern in patterns):
        return False
    return event_overlaps_day(event, day, zone)


def schedule_decision(events, day, zone, settings):
    work = any(is_leave_event(event, day, zone, settings["work_title_patterns"]) for event in events)
    rest = any(is_leave_event(event, day, zone, settings["rest_title_patterns"]) for event in events)
    if work and rest:
        raise ValueError("Conflicting work and rest calendar markers")
    return True if work else False if rest else None


def calendar_decision(day, zone, settings, schedule=False):
    from feishu_remind import OPENER
    from feishu_calendar_auth import user_token
    calendar_id = settings["calendar_id"]
    patterns = [settings["work_title_patterns"], settings["rest_title_patterns"]] if schedule \
        else settings["leave_title_patterns"]
    identity = hashlib.sha256(json.dumps([calendar_id, patterns, schedule, str(zone)]).encode()).hexdigest()[:16]
    cache = STATE_DIR / ("work-calendar-" + identity + ".json")
    now = datetime.now().timestamp()
    try:
        previous = json.loads(cache.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        previous = {}
    if previous.get("date") == day.isoformat() and 0 <= now - previous["checked_at"] < 900:
        return previous["workday" if schedule else "has_leave"]
    start = datetime.combine(day, time(), zone)
    query = urllib.parse.urlencode({"start_time": int(start.timestamp()),
                                   "end_time": int((start + timedelta(days=1)).timestamp())})
    base_url = ("https://open.feishu.cn/open-apis/calendar/v4/calendars/"
                + urllib.parse.quote(calendar_id, safe=""))
    headers = {"Authorization": "Bearer " + user_token()}
    request = urllib.request.Request(base_url, headers=headers)
    with OPENER.open(request, timeout=20) as response:
        metadata = json.load(response)
    if metadata.get("code") != 0 or metadata.get("data", {}).get("role") not in {
        "owner", "writer", "reader",
    }:
        raise RuntimeError("Calendar detail-read access unavailable")
    request = urllib.request.Request(base_url + "/events/instance_view?" + query, headers=headers)
    with OPENER.open(request, timeout=20) as response:
        payload = json.load(response)
    if payload.get("code") != 0:
        raise RuntimeError("Calendar API rejected request: " + str(payload.get("code")))
    data = payload["data"]
    if data.get("has_more"):
        raise RuntimeError("Incomplete calendar instance response")
    events = data.get("items") or []
    if any(not event.get("summary") for event in events):
        raise RuntimeError("Calendar event details unavailable")
    decision = schedule_decision(events, day, zone, settings) if schedule \
        else any(is_leave_event(event, day, zone, patterns) for event in events)
    state = {"date": day.isoformat(), "checked_at": now,
             "workday" if schedule else "has_leave": decision}
    temporary = cache.with_suffix("." + str(os.getpid()) + ".tmp")
    temporary.write_text(json.dumps(state) + "\n")
    temporary.chmod(0o600)
    os.replace(temporary, cache)
    return decision


def calendar_leave(day, zone, settings):
    return calendar_decision(day, zone, settings)


def calendar_workday(day, zone, settings):
    return calendar_decision(day, zone, settings, schedule=True)


def notification_allowed(service, config=None, now=None):
    config = load_config() if config is None else config
    settings = config.get("work_calendar", {})
    if not settings.get("enabled", False) or service not in settings.get("services", []):
        return True
    zone = ZoneInfo(settings.get("timezone", "Asia/Shanghai"))
    now = now or datetime.now(zone)
    day = now.astimezone(zone).date()
    override = settings.get("overrides", {}).get(day.isoformat(), {}).get(service)
    if isinstance(override, bool):
        return override
    try:
        calendar = settings.get("feishu_calendar", {})
        schedule = settings.get("schedule_calendar", {})
        if calendar.get("enabled", False) or schedule.get("enabled", False):
            # Keep rotating refresh tokens alive through long holidays too.
            from feishu_calendar_auth import user_token
            user_token()
        workday = statutory_workday(day)
        short = day.strftime("%m-%d")
        if any(start <= short <= end for start, end in HOLIDAYS[day.year]["rest"]):
            return False
        scheduled = calendar_workday(day, zone, schedule) if schedule.get("enabled", False) else None
        if scheduled is not None:
            workday = scheduled
        elif settings.get("weekends_off", True) and day.weekday() >= 5:
            workday = False
        return workday and (not calendar.get("enabled", False) or not calendar_leave(day, zone, calendar))
    except Exception as error:
        # Uncertain calendar access must not accidentally send on a leave day.
        print("WORK_CALENDAR_DEFERRED " + service + " " + type(error).__name__, flush=True)
        return False
