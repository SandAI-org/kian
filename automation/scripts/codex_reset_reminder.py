#!/usr/bin/env python3
"""Warn before a Codex reset card expires during the user's rest period."""
import argparse
import copy
from datetime import datetime, time, timedelta
import fcntl
import hashlib
import json
import os
from pathlib import Path
import sys
import uuid
from zoneinfo import ZoneInfo

from automation_common import STATE_DIR, load_config
from work_calendar import notification_allowed

SERVICE = 'codex_reset_reminder'
COPY = {
    'zh': {
        'title': '⏳ Codex 重置卡 · 休息时段内到期',
        'body': '**到期时间：{expiry}（北京时间）**\n\n这张重置卡将在夜间或休息日过期，提前在上一个工作日 23:00 提醒。\n当前周额度：{remaining}。\n\n如需使用，请在到期前兑换；用卡可能重启额度周期，不会叠加余额。本提醒不会自动兑换。',
        'remaining': '剩余 {value}%',
        'unknown': '暂不可用',
    },
    'en': {
        'title': '⏳ Codex reset · Expires during rest time',
        'body': '**Expires: {expiry} (Asia/Shanghai)**\n\nThis reset expires overnight or on a rest day. This is the preceding workday’s 23:00 reminder.\nCurrent weekly allowance: {remaining}.\n\nRedeem before expiry if useful. A reset can restart the usage period; it does not stack allowance. This reminder does not redeem it.',
        'remaining': '{value}% remaining',
        'unknown': 'unavailable',
    },
}


def reminder_at(expiry, is_workday):
    if expiry.hour >= 10 and is_workday(expiry.date()):
        return None
    day = expiry.date() - timedelta(days=1)
    for _ in range(60):
        if is_workday(day):
            return datetime.combine(day, time(23), expiry.tzinfo)
        day -= timedelta(days=1)
    raise RuntimeError('No preceding workday found within 60 days')


def weekly_remaining(snapshot):
    buckets = snapshot.get('rateLimitsByLimitId')
    buckets = buckets.values() if buckets else [snapshot.get('rateLimits') or {}]
    for bucket in buckets:
        for key in ('primary', 'secondary'):
            window = bucket.get(key) or {}
            if window.get('windowDurationMins') == 10080 and window.get('usedPercent') is not None:
                return max(0, min(100, 100 - window['usedPercent']))
    return None


def evaluate(snapshot, config, now, state, sender, persist, dry_run=False, workday=None):
    settings = config.get(SERVICE, {})
    if not settings.get('enabled', False):
        return {'status': 'disabled', 'sent': 0}
    zone = ZoneInfo('Asia/Shanghai')
    now = now.astimezone(zone)
    calendar = copy.deepcopy(config)
    if not calendar.get('work_calendar', {}).get('enabled', False):
        raise RuntimeError('Work calendar must be enabled for reset-card reminders')
    calendar['work_calendar'].setdefault('services', []).append(SERVICE)
    days = {}
    def is_workday(day):
        if day not in days:
            days[day] = (workday(day) if workday is not None else notification_allowed(
                SERVICE, calendar, datetime.combine(day, time(12), zone), raise_on_error=True))
        return days[day]
    if now.hour < 10 or not is_workday(now.date()):
        return {'status': 'rest_time', 'sent': 0}
    credits = snapshot.get('rateLimitResetCredits')
    if credits is None or credits.get('credits') is None:
        raise RuntimeError('Live reset-card details unavailable')
    account = snapshot.get('accountId')
    if not account:
        raise RuntimeError('Live account identity unavailable')
    language = settings.get('language', 'zh')
    words = COPY[language]
    remaining = weekly_remaining(snapshot)
    remaining = words['unknown'] if remaining is None else words['remaining'].format(value=remaining)
    sent = 0
    plans = []
    for card in credits['credits']:
        if card.get('status') != 'available' or card.get('expiresAt') is None:
            continue
        expiry = datetime.fromtimestamp(card['expiresAt'], zone)
        if expiry <= now:
            continue
        due = reminder_at(expiry, is_workday)
        if due is None:
            continue
        key = hashlib.sha256(f"{account}/{card['id']}/{card['expiresAt']}".encode()).hexdigest()
        if key in state.setdefault('sent', {}):
            continue
        plans.append({'expires_at': expiry.isoformat(), 'remind_at': due.isoformat(), 'due': now >= due})
        if now < due or dry_run:
            continue
        response = sender(words['title'], words['body'].format(
            expiry=expiry.strftime('%Y-%m-%d %H:%M'), remaining=remaining),
            template='orange', message_uuid=str(uuid.uuid5(uuid.NAMESPACE_URL, key)))
        if not isinstance(response, dict) or response.get('code') != 0:
            raise RuntimeError('Feishu rejected reset reminder')
        state['sent'][key] = {'expires_at': expiry.isoformat(), 'sent_at': now.isoformat()}
        persist(state)
        sent += 1
    return {'status': 'dry_run' if dry_run else 'checked', 'sent': sent, 'plans': plans}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', required=True, help='Fresh get_usage_limits JSON file, or - for stdin')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    snapshot = json.loads(sys.stdin.read() if args.snapshot == '-' else Path(args.snapshot).read_text())
    from feishu_remind import send
    state_path = STATE_DIR / 'codex-reset-reminder.json'
    def save(state):
        temporary = state_path.with_suffix('.tmp')
        temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2) + '\n')
        temporary.chmod(0o600)
        temporary.replace(state_path)
    with (STATE_DIR / 'codex-reset-reminder.lock').open('a+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        state = json.loads(state_path.read_text()) if state_path.exists() else {'sent': {}}
        result = evaluate(snapshot, load_config(), datetime.now(ZoneInfo('Asia/Shanghai')),
                          state, send, save, args.dry_run)
        print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    os.umask(0o077)
    main()
