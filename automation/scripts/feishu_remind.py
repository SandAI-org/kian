#!/usr/bin/env python3
"""飞书提醒脚本。用法:
  python3 feishu_remind.py "标题" "正文(支持markdown, 用\\n换行)"
读取 KIAN_AUTOMATION_HOME 下私有 config/config.json 的飞书凭证。"""
import json
import os
import sys
import urllib.request

from automation_common import load_config

FEISHU = load_config()["feishu"]

# Kian may inherit a stale local proxy (for example 127.0.0.1:7890) after the
# proxy app exits. These automations should connect to Feishu directly.
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def feishu_token():
    data = json.dumps({"app_id": FEISHU["app_id"], "app_secret": FEISHU["app_secret"]}).encode()
    req = urllib.request.Request(
        "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
        data=data, headers={"Content-Type": "application/json"})
    with OPENER.open(req, timeout=30) as resp:
        return json.load(resp)["tenant_access_token"]


def send(title, body_md):
    token = feishu_token()
    card = {
        "config": {"wide_screen_mode": True},
        "header": {"title": {"tag": "plain_text", "content": title}, "template": "green"},
        "elements": [{"tag": "markdown", "content": body_md}],
    }
    payload = json.dumps({
        "receive_id": FEISHU["open_id"],
        "msg_type": "interactive",
        "content": json.dumps(card, ensure_ascii=False),
    }, ensure_ascii=False).encode()
    req = urllib.request.Request(
        "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id",
        data=payload, headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    with OPENER.open(req, timeout=30) as resp:
        return json.load(resp)


if __name__ == "__main__":
    title = sys.argv[1] if len(sys.argv) > 1 else "⏰ 提醒"
    body = sys.argv[2] if len(sys.argv) > 2 else ""
    body = body.replace("\\n", "\n")
    send(title, body)
    print("SENT")
