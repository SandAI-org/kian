#!/usr/bin/env python3
"""GitHub 多仓库监控脚本。
用法:
  python3 github_monitor.py realtime   # 实时检查更新（新评论/新PR/新commits），有更新则推送飞书
  python3 github_monitor.py daily      # 每日全貌总结，推送飞书
"""
import json
import os
import re
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta

from automation_common import STATE_DIR, load_config

CONFIG = load_config()

FEISHU = CONFIG["feishu"]
GITHUB = CONFIG.get("github", {})
TOKENS = GITHUB.get("tokens", {})
REPOS = GITHUB.get("repos", [])
OPENROUTER = CONFIG.get("summarization", {})
STATE_FILE = str(STATE_DIR / "github-monitor-state.json")
MANAGED_FILE = str(STATE_DIR / "managed-prs.json")

# Do not let a stale desktop proxy break launchd jobs. All service APIs are
# public HTTPS endpoints and can be reached directly.
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def load_managed():
    """返回受管理 desc 的 PR 集合，键为 'owner/repo#num'。"""
    if os.path.exists(MANAGED_FILE):
        try:
            return set(json.load(open(MANAGED_FILE)).get("managed", {}).keys())
        except Exception:
            return set()
    return set()


def desc_hint(repo, num):
    """根据 PR 是否受管理，返回一行 desc 提醒文字（纯文本，非按钮）。"""
    key = f"{repo}#{num}"
    if key in load_managed():
        return f"\n\n💬 回复 `up{num}` 更新描述"
    return f"\n\n💬 回复 `desc{num}` 让我写/polish 这个 PR 的描述"


def unmanage_pr(repo, num):
    """把已 merge/closed 的 PR 从受管理清单移除。"""
    if not os.path.exists(MANAGED_FILE):
        return
    try:
        d = json.load(open(MANAGED_FILE))
    except Exception:
        return
    key = f"{repo}#{num}"
    if key in d.get("managed", {}):
        d["managed"].pop(key, None)
        json.dump(d, open(MANAGED_FILE, "w"), ensure_ascii=False, indent=2)


def llm_summarize(text, kind, concise=False):
    """用 LLM 把 PR/Issue/评论正文精炼成简洁生动的中文摘要。
    失败时抛出异常（不降级），由调用方决定不推送半成品、下次重试。
    concise=True 时用于每日总结，只输出一句话概括。"""
    text = (text or "").strip()
    if not text:
        return "(无正文)"
    api_key = OPENROUTER.get("api_key")
    if not api_key or str(api_key).startswith("REPLACE_WITH_"):
        lines = [line.strip(" #-\t") for line in text.splitlines() if line.strip()]
        if concise:
            summary = (lines[0] if lines else text)[:80]
            return summary + ("…" if len(summary) == 80 else "")
        return "\n".join(f"• {line[:180]}" for line in lines[:5]) or "• (无正文)"
    # 重要：PR desc 常用 ## DONE / ## TODO in this PR / ## TODO in the future 结构，
    # 必须区分已完成（DONE）与待办（TODO），不能把 TODO 当成已做完的成果。
    structure_note = (
        "【重要】若正文包含 DONE / TODO in this PR / TODO in the future 等分区，"
        "必须严格区分状态：DONE 下的才是已完成（用‘已/完成’），"
        "TODO 下的是尚未完成的计划（用‘计划/待/将’，绝不能写成已完成）。"
        "若 DONE 为空而只有 TODO，则说明这是一个刚建、尚未开始实现的 PR。"
    )
    if concise:
        prompt = (
            f"下面是一个 GitHub {kind} 的正文。请用一句中文（不超过 40 字）概括其核心内容，"
            f"可适当加 1 个 emoji，关键词用 **加粗**，只输出这句话本身。\n{structure_note}\n\n正文：\n{text[:2000]}"
        )
        max_tok = 120
    else:
        prompt = (
            f"下面是一个 GitHub {kind} 的正文内容。请用中文把它精炼成简洁生动的摘要，"
            f"要求：1) 3-5 个要点，每点一行以 • 开头；2) 关键部分用 **加粗**；"
            f"3) 适当加 emoji 让内容生动；4) 如果有 DONE 和 TODO 之分，请分别标明（如‘✅已完成’、‘📋 计划中’）；"
            f"5) 只输出摘要本身，不要额外说明。\n{structure_note}\n\n正文：\n{text[:4000]}"
        )
        max_tok = 500
    body = json.dumps({
        "model": OPENROUTER.get("model", "anthropic/claude-opus-4.6"),
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tok,
    }).encode()
    import time
    last_err = None
    for attempt in range(4):
        req = urllib.request.Request(
            "https://openrouter.ai/api/v1/chat/completions",
            data=body,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "https://github.com",
                "X-Title": "Kian GitHub Monitor",
            },
        )
        try:
            with OPENER.open(req, timeout=60) as resp:
                data = json.load(resp)
                return data["choices"][0]["message"]["content"].strip()
        except urllib.error.HTTPError as e:
            last_err = e
            if e.code in (403, 429, 500, 502, 503):
                time.sleep(3 * (attempt + 1))  # 退避重试
                continue
            break
        except Exception as e:
            last_err = e
            time.sleep(3 * (attempt + 1))
    # 摘要服务不可用不应阻断仓库监控。使用确定性的本地摘要继续推送，
    # 避免时间戳长期停滞并在服务恢复前反复处理同一批更新。
    print(f"[warn] LLM 摘要失败，使用本地摘要: {last_err}", file=sys.stderr)
    lines = [line.strip(" #-\t") for line in text.splitlines() if line.strip()]
    if concise:
        summary = (lines[0] if lines else text)[:80]
        return summary + ("…" if len(summary) == 80 else "")
    if not lines:
        return "• (无正文)"
    return "\n".join(f"• {line[:180]}" for line in lines[:5])


def gh_get(repo, path, params=None):
    org = repo.split("/")[0]
    token = TOKENS.get(org)
    url = f"https://api.github.com/repos/{repo}{path}"
    if params:
        url += "?" + "&".join(f"{k}={v}" for k, v in params.items())
    req = urllib.request.Request(url)
    req.add_header("Authorization", f"token {token}")
    req.add_header("Accept", "application/vnd.github+json")
    # 重试 3 次，应对偶发 SSL/网络错误；全部失败则抛出异常，由调用方决定是否推进时间戳
    last_err = None
    for attempt in range(3):
        try:
            with OPENER.open(req, timeout=30) as resp:
                return json.load(resp)
        except urllib.error.HTTPError as e:
            # 4xx 类错误（如 404/403）重试无意义，直接视为空结果
            if 400 <= e.code < 500:
                print(f"[warn] {repo}{path} -> {e.code} (skip)", file=sys.stderr)
                return []
            last_err = e
        except Exception as e:
            last_err = e
        import time
        time.sleep(2 * (attempt + 1))
    print(f"[error] {repo}{path} -> {last_err} (after retries)", file=sys.stderr)
    raise RuntimeError(f"GitHub API failed: {repo}{path}: {last_err}")


def gh_get_pr_commits(repo, number, expected_count=None):
    """Return the complete ordered commit list for an open PR.

    GitHub caps each response at 100 commits. A truncated list can contain the
    previous head on page 1 but omit every newly pushed commit on later pages,
    which makes a normal push look like a head-only force-push/rebase event.
    """
    commits = []
    page = 1
    while True:
        batch = gh_get(
            repo,
            f"/pulls/{number}/commits",
            {"per_page": "100", "page": str(page)},
        )
        if not isinstance(batch, list):
            break
        commits.extend(commit for commit in batch if isinstance(commit, dict))
        if len(batch) < 100 or (expected_count is not None and len(commits) >= expected_count):
            break
        page += 1
    return commits


def feishu_token():
    data = json.dumps({"app_id": FEISHU["app_id"], "app_secret": FEISHU["app_secret"]}).encode()
    req = urllib.request.Request(
        "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
        data=data, headers={"Content-Type": "application/json"})
    with OPENER.open(req, timeout=30) as resp:
        return json.load(resp)["tenant_access_token"]


def feishu_send_card(title, md_content, template="orange"):
    # GitHub comments may embed ordinary Markdown images. Feishu cards treat
    # every image as an uploaded card resource and reject the whole card when
    # no image_key is supplied. Preserve the label/link but render it as text.
    md_content = re.sub(r"!\[([^\]]*)\]\(([^)]+)\)", r"[\1](\2)", md_content)
    token = feishu_token()
    actions = []
    current_repo = ""
    for line in md_content.splitlines():
        repo_match = re.fullmatch(r"\*\*📦 ([^*]+)\*\*", line.strip())
        if repo_match:
            current_repo = repo_match.group(1).strip()
            continue
        for command in re.findall(r"`((?:desc|up)\d+)`", line):
            action = "up" if command.startswith("up") else "desc"
            number = int(command[len(action):])
            item = (current_repo, action, number)
            if item not in actions:
                actions.append(item)
    elements = [{"tag": "markdown", "content": md_content}]
    if actions:
        buttons = []
        for repo, action, number in actions:
            buttons.append({
                "tag": "button",
                "text": {
                    "tag": "plain_text",
                    "content": (
                        f"更新 PR #{number} 描述"
                        if action == "up"
                        else f"生成 PR #{number} 描述"
                    ),
                },
                "type": "primary",
                "value": {"action": action, "pr": number, "repo": repo},
            })
            buttons.append({
                "tag": "button",
                "text": {
                    "tag": "plain_text",
                    "content": (
                        f"更新 PR #{number} 完整版"
                        if action == "up"
                        else f"生成 PR #{number} 简略版"
                    ),
                },
                "value": {
                    "action": action,
                    "pr": number,
                    "repo": repo,
                    "mode": "full" if action == "up" else "simple",
                },
            })
        elements.extend(
            {"tag": "action", "actions": buttons[index:index + 5]}
            for index in range(0, len(buttons), 5)
        )
    card = {
        "config": {"wide_screen_mode": True},
        "header": {"title": {"tag": "plain_text", "content": title}, "template": template},
        "elements": elements,
    }
    body = json.dumps({
        "receive_id": FEISHU["open_id"],
        "msg_type": "interactive",
        "content": json.dumps(card, ensure_ascii=False),
    }, ensure_ascii=False).encode()
    req = urllib.request.Request(
        "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id",
        data=body, headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    try:
        with OPENER.open(req, timeout=30) as resp:
            result = json.load(resp)
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Feishu HTTP {e.code}: {detail}") from e
    if result.get("code", 0) != 0:
        raise RuntimeError(f"Feishu API rejected message: {result}")
    return result


def load_state():
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE) as f:
            return json.load(f)
    return {}


def save_state(state):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def cleanup_managed():
    """兑底：检查受管理清单里所有 PR 的当前状态，已 merge/closed 的直接清掉（不依赖 merge 事件窗口）。"""
    if not os.path.exists(MANAGED_FILE):
        return
    try:
        d = json.load(open(MANAGED_FILE))
    except Exception:
        return
    changed = False
    for key in list(d.get("managed", {}).keys()):
        try:
            repo, num = key.rsplit("#", 1)
            pr = gh_get(repo, f"/pulls/{num}")
            if isinstance(pr, dict) and pr.get("state") == "closed":
                d["managed"].pop(key, None)
                changed = True
        except Exception:
            continue
    if changed:
        json.dump(d, open(MANAGED_FILE, "w"), ensure_ascii=False, indent=2)


def realtime():
    state = load_state()
    last_check = state.get("last_check")
    if not last_check:
        last_check = (datetime.now(timezone.utc) - timedelta(minutes=5)).strftime("%Y-%m-%dT%H:%M:%SZ")
    previous_pr_heads = state.get("pr_heads", {})
    current_pr_heads = {}

    cleanup_managed()  # 每轮先清理已关闭的受管理 PR

    all_updates = []  # (repo, block)
    capture_time = now_iso()  # 先记录本轮开始时间，全部成功后才用它推进

    try:
      for repo in REPOS:
        # New issue comments
        for c in gh_get(repo, "/issues/comments", {"sort": "created", "direction": "desc", "since": last_check, "per_page": "30"}):
            if isinstance(c, dict) and c.get("created_at", "") > last_check:
                num = c["issue_url"].split("/")[-1]
                user = c["user"]["login"]
                summary = llm_summarize(c.get("body", ""), "评论")
                block = (
                    f"**💬 评论** on #{num} · 👤 {user}\n\n"
                    f"{summary}\n\n"
                    f"[🔗 查看评论]({c.get('html_url', '')})"
                )
                all_updates.append((repo, block))

        # New PR review comments
        for c in gh_get(repo, "/pulls/comments", {"sort": "created", "direction": "desc", "since": last_check, "per_page": "30"}):
            if isinstance(c, dict) and c.get("created_at", "") > last_check:
                num = c["pull_request_url"].split("/")[-1]
                user = c["user"]["login"]
                summary = llm_summarize(c.get("body", ""), "PR代码评论")
                block = (
                    f"**💬 PR评论** on PR #{num} · 👤 {user}\n\n"
                    f"{summary}\n\n"
                    f"[🔗 查看评论]({c.get('html_url', '')})"
                )
                all_updates.append((repo, block))

        # New PRs + new commits on open PRs
        prs = gh_get(repo, "/pulls", {"state": "open", "sort": "updated", "direction": "desc", "per_page": "100"})
        for pr in prs:
            if not isinstance(pr, dict):
                continue
            num = pr["number"]
            title = pr["title"]
            pr_key = f"{repo}#{num}"
            head_sha = pr.get("head", {}).get("sha", "")
            if head_sha:
                current_pr_heads[pr_key] = head_sha
            if pr.get("created_at", "") > last_check:
                user = pr["user"]["login"]
                summary = llm_summarize(pr.get("body", ""), "Pull Request")
                block = (
                    f"**🆕 新 PR #{num}** · 👤 {user}\n\n"
                    f"📌 **{title}**\n\n"
                    f"{summary}\n\n"
                    f"[🔗 查看 PR]({pr.get('html_url', '')})"
                    f"{desc_hint(repo, num)}"
                )
                all_updates.append((repo, block))
            else:
                # Compare the PR head SHA instead of relying only on commit dates.
                # Commit author/committer dates can be much older than the actual
                # push (cherry-pick, rebase, force-push), which previously caused
                # those updates to be missed.
                commits = gh_get_pr_commits(repo, num, pr.get("commits"))
                previous_head = previous_pr_heads.get(pr_key)
                head_changed = bool(previous_head and head_sha and previous_head != head_sha)
                new_commits = []
                if head_changed:
                    old_index = next(
                        (index for index, commit in enumerate(commits)
                         if isinstance(commit, dict) and commit.get("sha") == previous_head),
                        None,
                    )
                    # If the old head disappeared, this was likely a force-push or
                    # rebase. Show the newest commits without treating all history
                    # as newly authored work.
                    new_commits = commits[old_index + 1:] if old_index is not None else commits[-10:]
                elif previous_head is None:
                    # Migration path for the old state format: preserve the former
                    # timestamp behavior for one run while recording every head.
                    new_commits = [
                        commit for commit in commits
                        if isinstance(commit, dict)
                        and commit.get("commit", {}).get("committer", {}).get("date", "") > last_check
                    ]
                new_msgs = [
                    commit.get("commit", {}).get("message", "").split("\n")[0][:150]
                    for commit in new_commits if isinstance(commit, dict)
                ]
                if new_msgs:
                    n = len(new_msgs)
                    # commit 少时直接列；多时用 LLM 归纳成几条要点，避免刷屏
                    if n <= 5:
                        commits_md = "\n".join(f"• {m}" for m in new_msgs)
                    else:
                        joined = "\n".join(f"- {m}" for m in new_msgs)
                        commits_md = llm_summarize(joined, f"PR 的 {n} 条新 commit 消息列表（请归纳成几个主题要点，不要逐条罗列）")
                    block = (
                        f"**📝 PR 分支已更新** on PR #{num}（{n} 条 commit）\n\n"
                        f"📌 **{title}**\n\n"
                        f"{commits_md}\n\n"
                        f"[🔗 查看 PR]({pr.get('html_url', '')})"
                        f"{desc_hint(repo, num)}"
                    )
                    all_updates.append((repo, block))
                elif head_changed:
                    # A head change without visible new commits is still a real
                    # force-push/rebase event and must not be silently ignored.
                    all_updates.append((repo, (
                        f"**📝 PR 分支已更新** on PR #{num}\n\n"
                        f"📌 **{title}**\n\n"
                        f"• 检测到 head SHA 变化（可能为 rebase / force-push）\n\n"
                        f"[🔗 查看 PR]({pr.get('html_url', '')})"
                        f"{desc_hint(repo, num)}"
                    )))

        # PR 状态变化：合并 / 关闭（查最近更新的 closed PR）
        for pr in gh_get(repo, "/pulls", {"state": "closed", "sort": "updated", "direction": "desc", "per_page": "20"}):
            if not isinstance(pr, dict):
                continue
            num = pr["number"]
            title = pr["title"]
            merged_at = pr.get("merged_at")
            closed_at = pr.get("closed_at")
            # 已 merge/closed 的 PR 自动移出受管理清单
            if merged_at or closed_at:
                unmanage_pr(repo, num)
            # 合并
            if merged_at and merged_at > last_check:
                block = (
                    f"**✅ PR 已合并 #{num}**\n\n"
                    f"📌 **{title}**\n\n"
                    f"👤 由 {pr.get('user',{}).get('login','')} 提交\n\n"
                    f"[🔗 查看 PR]({pr.get('html_url', '')})"
                )
                all_updates.append((repo, block))
            # 关闭但未合并
            elif closed_at and closed_at > last_check and not merged_at:
                block = (
                    f"**⛔ PR 已关闭 #{num}**（未合并）\n\n"
                    f"📌 **{title}**\n\n"
                    f"[🔗 查看 PR]({pr.get('html_url', '')})"
                )
                all_updates.append((repo, block))
            # closed PR 按 updated 降序，一旦遇到早于 last_check 的就可提前停
            elif pr.get("updated_at", "") <= last_check:
                break

        # Issue 状态变化：关闭 / 重新打开（含新建 issue）
        for iss in gh_get(repo, "/issues", {"state": "all", "sort": "updated", "direction": "desc", "per_page": "20"}):
            if not isinstance(iss, dict) or "pull_request" in iss:
                continue
            num = iss["number"]
            title = iss["title"]
            if iss.get("updated_at", "") <= last_check:
                break
            # 新建 issue
            if iss.get("created_at", "") > last_check:
                summary = llm_summarize(iss.get("body", ""), "Issue")
                block = (
                    f"**🆕 新 Issue #{num}** · 👤 {iss.get('user',{}).get('login','')}\n\n"
                    f"📌 **{title}**\n\n"
                    f"{summary}\n\n"
                    f"[🔗 查看 Issue]({iss.get('html_url', '')})"
                )
                all_updates.append((repo, block))
            # 关闭
            elif iss.get("state") == "closed" and iss.get("closed_at") and iss["closed_at"] > last_check:
                block = (
                    f"**✅ Issue 已关闭 #{num}**\n\n"
                    f"📌 **{title}**\n\n"
                    f"[🔗 查看 Issue]({iss.get('html_url', '')})"
                )
                all_updates.append((repo, block))

    except RuntimeError as e:
        # 任何仓库查询失败：不推进时间戳，下次重试。已收集的更新本轮不推送，避免重复
        print(f"ABORTED (will retry next run): {e}", file=sys.stderr)
        print("ABORTED")
        return

    # 没有更新：直接推进时间戳
    if not all_updates:
        state["last_check"] = capture_time
        state["pr_heads"] = current_pr_heads
        save_state(state)
        print("NO_UPDATES")
        return

    # Group by repo
    by_repo = {}
    for repo, block in all_updates:
        by_repo.setdefault(repo, []).append(block)

    md = ""
    for repo, items in by_repo.items():
        md += f"**📦 {repo}**\n\n"
        md += "\n\n---\n\n".join(items)
        md += "\n\n"
    md = md.rstrip()

    # 先推送，成功后才推进时间戳；推送失败则不保存，下次重试
    try:
        feishu_send_card("🔔 仓库实时更新", md, "orange")
    except Exception as e:
        print(f"PUSH_FAILED (will retry next run): {e}", file=sys.stderr)
        print("PUSH_FAILED")
        return

    state["last_check"] = capture_time
    state["pr_heads"] = current_pr_heads
    save_state(state)
    print(f"PUSHED {len(all_updates)} updates")


DAILY_STAMP = str(STATE_DIR / "daily-sent.json")


def daily():
    """生成并推送每日总结。只有当内容完整（所有 LLM 摘要成功）且推送成功时，
    才标记今日已发。任何环节失败则不发、不标记，下次重试。
    该任务从 10:00 起每 5 分钟跑一次，幂等：当天成功发过一次后就不再重发。"""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if os.path.exists(DAILY_STAMP):
        with open(DAILY_STAMP) as f:
            if json.load(f).get("date") == today:
                print("DAILY_ALREADY_SENT")
                return
    # 生成内容（LLM 摘要失败会抛异常）
    try:
        md = _build_daily_md()
    except Exception as e:
        print(f"DAILY_BUILD_FAILED (will retry): {e}", file=sys.stderr)
        print("DAILY_BUILD_FAILED")
        return
    # 推送
    try:
        feishu_send_card("📦 仓库每日总结", md, "blue")
    except Exception as e:
        print(f"DAILY_PUSH_FAILED (will retry): {e}", file=sys.stderr)
        print("DAILY_PUSH_FAILED")
        return
    with open(DAILY_STAMP, "w") as f:
        json.dump({"date": today, "sent_at": now_iso()}, f)
    print("DAILY_PUSHED")


def _build_daily_md():
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=24)).strftime("%Y-%m-%dT%H:%M:%SZ")
    md = f"**📅 {datetime.now(timezone.utc).strftime('%Y-%m-%d')} 每日总结** · 最近 24h\n\n"
    total = 0
    repo_sections = []

    for repo in REPOS:
        repo_lines = []
        # PRs updated in last 24h
        for pr in gh_get(repo, "/pulls", {"state": "all", "sort": "updated", "direction": "desc", "per_page": "15"}):
            if not isinstance(pr, dict):
                continue
            if pr.get("updated_at", "") >= cutoff:
                num = pr["number"]
                title = pr["title"][:120]
                if pr.get("merged_at"):
                    st = "✅已合并"
                elif pr["state"] == "closed":
                    st = "⛔已关闭"
                else:
                    st = "🟢开放中"
                brief = llm_summarize(pr.get("body", ""), "Pull Request", concise=True)
                repo_lines.append(
                    f"🔀 **PR [#{num}]({pr.get('html_url','')})** [{st}] · {pr['user']['login']}\n"
                    f"　{title}\n"
                    f"　↳ {brief}"
                )
        # Issues updated in last 24h
        for iss in gh_get(repo, "/issues", {"state": "all", "sort": "updated", "direction": "desc", "per_page": "15"}):
            if not isinstance(iss, dict) or "pull_request" in iss:
                continue
            if iss.get("updated_at", "") >= cutoff:
                num = iss["number"]
                title = iss["title"][:120]
                st = "🟢开放" if iss["state"] == "open" else "⛔已关闭"
                brief = llm_summarize(iss.get("body", ""), "Issue", concise=True)
                repo_lines.append(
                    f"🐛 **Issue [#{num}]({iss.get('html_url','')})** [{st}] · {iss['user']['login']}\n"
                    f"　{title}\n"
                    f"　↳ {brief}"
                )

        if repo_lines:
            total += len(repo_lines)
            section = f"**📦 {repo}** ({len(repo_lines)})\n\n" + "\n\n".join(repo_lines)
            repo_sections.append(section)

    if repo_sections:
        md += "\n\n---\n\n".join(repo_sections)
    else:
        md += "_所有仓库最近 24 小时内无更新。_"
    return md


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "realtime"
    if mode == "realtime":
        realtime()
    elif mode == "daily":
        daily()
    else:
        print("Unknown mode", file=sys.stderr)
        sys.exit(1)
