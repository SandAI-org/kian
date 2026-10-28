#!/usr/bin/env python3
"""Authorize and refresh a private Feishu user token for calendar reading."""

import argparse
import base64
import fcntl
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

from automation_common import STATE_DIR, load_config

TOKEN_FILE = STATE_DIR / "feishu-calendar-user-token.json"
PENDING_FILE = STATE_DIR / "feishu-calendar-auth-pending.json"
TOKEN_URL = "https://accounts.feishu.cn/oauth/v3/token"


def write_private(path, value):
    temporary = path.with_suffix("." + str(os.getpid()) + ".tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w") as handle:
        json.dump(value, handle)
    os.replace(temporary, path)


def request_form(url, values, basic=None):
    from feishu_remind import OPENER
    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    if basic:
        headers["Authorization"] = "Basic " + base64.b64encode(basic.encode()).decode()
    request = urllib.request.Request(url, data=urllib.parse.urlencode(values).encode(), headers=headers)
    try:
        with OPENER.open(request, timeout=25) as response:
            payload = json.load(response)
    except urllib.error.HTTPError as error:
        payload = json.load(error)
    if payload.get("error"):
        raise RuntimeError("Feishu OAuth: " + str(payload["error"]))
    return payload


def token_record(payload, app_id, previous=None):
    previous = previous or {}
    if not payload.get("access_token") or payload.get("token_type", "Bearer").lower() != "bearer":
        raise RuntimeError("Expected a Bearer user token")
    now = time.time()
    return {"access_token": payload["access_token"],
            "refresh_token": payload.get("refresh_token") or previous.get("refresh_token"),
            "expires_at": now + int(payload["expires_in"]),
            "refresh_expires_at": now + int(payload["refresh_token_expires_in"])
            if payload.get("refresh_token_expires_in") else previous.get("refresh_expires_at", now),
            "scope": payload.get("scope", previous.get("scope", "")),
            "token_type": "Bearer", "app_id": app_id}


def user_token():
    feishu = load_config()["feishu"]
    with (STATE_DIR / "feishu-calendar-user-token.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        token = json.loads(TOKEN_FILE.read_text())
        if token["app_id"] != feishu["app_id"]:
            raise RuntimeError("Calendar user token belongs to another app")
        if token["expires_at"] > time.time() + 90:
            return token["access_token"]
        if not token.get("refresh_token") or token.get("refresh_expires_at", 0) <= time.time():
            raise RuntimeError("Calendar user authorization needs renewal")
        payload = request_form(TOKEN_URL, {"grant_type": "refresh_token",
                               "refresh_token": token["refresh_token"],
                               "client_id": feishu["app_id"], "client_secret": feishu["app_secret"]})
        token = token_record(payload, feishu["app_id"], token)
        write_private(TOKEN_FILE, token)
        return token["access_token"]


def begin():
    feishu = load_config()["feishu"]
    payload = request_form("https://accounts.feishu.cn/oauth/v1/device_authorization",
                           {"client_id": feishu["app_id"],
                            "scope": "calendar:calendar:readonly offline_access"},
                           feishu["app_id"] + ":" + feishu["app_secret"])
    payload["created_at"] = time.time()
    write_private(PENDING_FILE, payload)
    return {key: payload.get(key) for key in ["verification_uri_complete", "user_code", "expires_in"]}


def complete():
    from feishu_remind import OPENER
    feishu = load_config()["feishu"]
    flow = json.loads(PENDING_FILE.read_text())
    if time.time() >= flow["created_at"] + flow["expires_in"]:
        raise RuntimeError("Calendar authorization link expired")
    payload = request_form(TOKEN_URL, {"grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                           "device_code": flow["device_code"],
                           "client_id": feishu["app_id"], "client_secret": feishu["app_secret"]})
    request = urllib.request.Request("https://open.feishu.cn/open-apis/authen/v1/user_info",
                                    headers={"Authorization": "Bearer " + payload["access_token"]})
    with OPENER.open(request, timeout=20) as response:
        user = json.load(response)
    if user.get("code") != 0 or user.get("data", {}).get("open_id") != feishu["open_id"]:
        raise RuntimeError("Authorized user differs from reminder recipient")
    with (STATE_DIR / "feishu-calendar-user-token.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        write_private(TOKEN_FILE, token_record(payload, feishu["app_id"]))
    PENDING_FILE.unlink()
    return {"authorized": True, "has_refresh_token": bool(payload.get("refresh_token"))}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["begin", "complete"])
    args = parser.parse_args()
    try:
        print(json.dumps(begin() if args.action == "begin" else complete(), ensure_ascii=False))
    except Exception as error:
        if isinstance(error, RuntimeError):
            print(str(error))
        else:
            print("Calendar authorization failed: " + type(error).__name__)
        raise SystemExit(1)
