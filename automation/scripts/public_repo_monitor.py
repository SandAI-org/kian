#!/usr/bin/env python3
"""Watch selected public GitHub repositories for high-value events."""

import fcntl
import html
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

from automation_common import STATE_DIR, load_config


WATCH = {}
GITHUB = {}
SUMMARIZATION = {}
STATE_FILE = STATE_DIR / "public-watch-state.json"
LOCK_FILE = STATE_DIR / "public-watch.lock"
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

LEVEL_THRESHOLDS = {
    "detailed": {"pr": 4, "issue": 4},
    "balanced": {"pr": 7, "issue": 7},
    "essential": {"pr": None, "issue": None},
}


def configure(config=None):
    global WATCH, GITHUB, SUMMARIZATION
    config = config or load_config()
    WATCH = config.get("public_watch", {})
    GITHUB = config.get("github", {})
    SUMMARIZATION = config.get("summarization", {})


def send_card(title, body, template):
    # Import lazily so the pure filtering helpers remain testable without a
    # private runtime configuration file.
    from feishu_remind import send
    return send(title, body, template=template)

SEMANTIC_SIGNALS = (
    ("安全", 8, r"\bsecurity\b|vulnerab|\bcve[- ]|remote code|privilege escalat"),
    ("正确性/回归", 5, r"regression|data corruption|wrong result|incorrect|silent error|race condition|deadlock|hang\b|crash\b"),
    ("破坏性/API 变化", 5, r"breaking change|backward incompat|api change|deprecat|remove[sd]? api|abi change"),
    ("性能关键", 4, r"performance|speedup|throughput|latency|memory usage|out of memory|\boom\b|optimi[sz]"),
    ("核心能力/硬件支持", 3, r"blackwell|sm100|hopper|cuda 1[3-9]|fp8|fp4|distributed|collective|compiler|kernel"),
    ("重要修复/功能", 1, r"\bfix(?:es|ed)?\b|bugfix|new feature|support for|implement"),
)

LABEL_SIGNALS = (
    ("security", 8, r"security|vulnerab|cve"),
    ("regression/correctness", 5, r"regression|correctness|data.?loss|critical"),
    ("performance", 4, r"performance|perf|optimization|memory"),
    ("bug", 3, r"(^|[^a-z])bug([^a-z]|$)|crash|hang"),
    ("API", 3, r"api|breaking|deprecat"),
    ("feature", 1, r"feature|enhancement"),
)


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_state():
    try:
        with STATE_FILE.open(encoding="utf-8") as handle:
            data = json.load(handle)
            return data if isinstance(data, dict) else {"version": 1, "repos": {}}
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {"version": 1, "repos": {}}


def save_state(state):
    STATE_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(prefix="public-watch-", suffix=".json", dir=str(STATE_DIR))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(state, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, STATE_FILE)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def resolve_token():
    direct = WATCH.get("token")
    if direct and not str(direct).startswith("REPLACE_WITH_"):
        return str(direct)
    tokens = GITHUB.get("tokens", {})
    preferred = WATCH.get("token_from_owner")
    if preferred and tokens.get(preferred):
        return str(tokens[preferred])
    for token in tokens.values():
        if token and not str(token).startswith("REPLACE_WITH_"):
            return str(token)
    return ""


def github_get(repo, path, params=None):
    url = "https://api.github.com/repos/{0}{1}".format(repo, path)
    if params:
        url += "?" + urllib.parse.urlencode(params)
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "kian-public-repo-monitor",
    }
    token = resolve_token()
    if token:
        headers["Authorization"] = "Bearer " + token
    request = urllib.request.Request(url, headers=headers)
    try:
        with OPENER.open(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as cause:
        remaining = cause.headers.get("X-RateLimit-Remaining", "unknown")
        raise RuntimeError(
            "GitHub {0} for {1}{2} (rate remaining: {3})".format(
                cause.code, repo, path, remaining
            )
        ) from cause
    except Exception as cause:
        raise RuntimeError("GitHub request failed for {0}{1}: {2}".format(repo, path, cause)) from cause


def label_names(item):
    result = []
    for label in item.get("labels", []):
        name = label.get("name", "") if isinstance(label, dict) else str(label)
        if name:
            result.append(name)
    return result


def importance(item, kind):
    text = "{0}\n{1}".format(item.get("title", ""), item.get("body", "") or "").lower()
    labels = label_names(item)
    labels_text = " ".join(labels).lower()
    score = 0
    reasons = []
    for reason, points, pattern in SEMANTIC_SIGNALS:
        if re.search(pattern, text, re.I):
            score += points
            reasons.append(reason)
    for reason, points, pattern in LABEL_SIGNALS:
        if re.search(pattern, labels_text, re.I):
            score += points
            reasons.append("标签:" + reason)
    association = str(item.get("author_association", "")).upper()
    if association in ("OWNER", "MEMBER", "COLLABORATOR"):
        score += 2
        reasons.append("维护者提交")
    comments = int(item.get("comments", 0) or 0)
    reactions = item.get("reactions", {}) or {}
    reaction_count = int(reactions.get("total_count", 0) or 0)
    if comments >= 25:
        score += 4
        reasons.append("高讨论度")
    elif comments >= 10:
        score += 3
        reasons.append("较高讨论度")
    elif comments >= 5:
        score += 1
        reasons.append("已有讨论")
    if reaction_count >= 20:
        score += 3
        reasons.append("高关注度")
    elif reaction_count >= 5:
        score += 1
        reasons.append("已有关注")
    if kind == "pr" and item.get("draft"):
        score -= 2
        reasons.append("草稿降权")
    return max(0, score), list(dict.fromkeys(reasons))


def threshold(repo_config, kind):
    overrides = repo_config.get("thresholds", {})
    if kind in overrides:
        value = overrides[kind]
        return None if value is None else int(value)
    level = repo_config.get("level", "balanced")
    return LEVEL_THRESHOLDS.get(level, LEVEL_THRESHOLDS["balanced"])[kind]


def compact_body(value, limit=280):
    text = html.unescape(value or "")
    text = re.sub(r"```.*?```", " ", text, flags=re.S)
    text = re.sub(r"!\[[^]]*\]\([^)]+\)", " ", text)
    text = re.sub(r"\[([^]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"[#>*_`|~-]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit] + ("…" if len(text) > limit else "")


def custom_exclusion(repo_config, item, file_paths=None):
    rules = repo_config.get("exclude", {})
    searchable = "\n".join([
        str(item.get("title", "")),
        str(item.get("body", "") or ""),
    ])
    for pattern in rules.get("text_patterns", []):
        if re.search(pattern, searchable, re.I):
            return True, "text:" + pattern
    labels = "\n".join(label_names(item))
    for pattern in rules.get("label_patterns", []):
        if re.search(pattern, labels, re.I):
            return True, "label:" + pattern
    path_patterns = rules.get("path_patterns", [])
    if path_patterns and file_paths is not None:
        matches = [
            any(re.search(pattern, path, re.I) for pattern in path_patterns)
            for path in file_paths
        ]
        mode = rules.get("path_match", "all")
        if matches and ((mode == "any" and any(matches)) or (mode != "any" and all(matches))):
            return True, "paths:" + mode
    return False, ""


def pr_file_paths(repo, number):
    paths = []
    page = 1
    while True:
        batch = github_get(repo, "/pulls/{0}/files".format(number), {
            "per_page": 100, "page": page,
        })
        if not isinstance(batch, list):
            break
        paths.extend(item.get("filename", "") for item in batch if item.get("filename"))
        if len(batch) < 100:
            break
        page += 1
    return paths


def excluded_event(repo_config, repo, item, kind):
    excluded, reason = custom_exclusion(repo_config, item)
    if excluded or kind != "pr" or not repo_config.get("exclude", {}).get("path_patterns"):
        return excluded, reason
    return custom_exclusion(repo_config, item, pr_file_paths(repo, item["number"]))


def event_block(markdown, item, kind, identity):
    return {
        "markdown": markdown,
        "summary_key": "{0}:{1}".format(kind, identity),
        "summary_kind": kind,
        "title": str(item.get("title") or item.get("name") or item.get("tag_name") or ""),
        "body": str(item.get("body") or ""),
    }


def copilot_chinese_summaries(blocks):
    if not blocks:
        return {}
    configured = str(SUMMARIZATION.get("command", "copilot"))
    command = shutil.which(configured) or (configured if os.path.isfile(configured) else "")
    if not command:
        raise RuntimeError("Copilot CLI is unavailable")
    payload = [
        {
            "key": block["summary_key"],
            "kind": block["summary_kind"],
            "title": block["title"][:300],
            "body": compact_body(block["body"], 1200),
        }
        for block in blocks
    ]
    prompt = """请为下面的 GitHub 公共仓库事件生成中文摘要。要求：
1. 每项用 1-2 句中文，不超过 90 个汉字；说明改了什么、为什么重要或解决什么问题。
2. 不要只翻译标题；结合正文，但不要臆测正文没有的信息。
3. 保留 CUDA、FP8、API 等技术名词。不要 Markdown、不要 emoji。
4. 只输出一个 JSON object，key 必须与输入 key 完全一致，value 为摘要字符串。

输入：
""" + json.dumps(payload, ensure_ascii=False)
    environment = os.environ.copy()
    for name in ("http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY"):
        environment.pop(name, None)
    result = subprocess.run(
        [
            command, "-p", prompt, "--silent", "--no-color", "--no-auto-update",
            "--disable-builtin-mcps", "--available-tools=", "--no-custom-instructions",
            "--no-ask-user", "--model", str(SUMMARIZATION.get("model", "auto")),
        ],
        env=environment,
        text=True,
        capture_output=True,
        timeout=180,
        check=False,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip().splitlines()
        raise RuntimeError(detail[0] if detail else "Copilot CLI failed")
    content = re.sub(r"^```(?:json)?\s*|\s*```$", "", result.stdout.strip(), flags=re.I)
    parsed = json.loads(content)
    if not isinstance(parsed, dict):
        raise RuntimeError("Copilot CLI returned a non-object summary")
    return {str(key): str(value).strip() for key, value in parsed.items() if str(value).strip()}


def add_chinese_summaries(blocks):
    try:
        summaries = copilot_chinese_summaries(blocks)
    except Exception as cause:
        print("[warn] Chinese summary failed: {0}".format(cause), file=sys.stderr)
        summaries = {}
    rendered = []
    for block in blocks:
        summary = summaries.get(block["summary_key"])
        if not summary:
            summary = "中文摘要暂时生成失败，请通过原始标题和链接查看详情。"
        rendered.append(block["markdown"] + "\n\n📝 **中文摘要：** " + summary)
    return rendered


def integration_branches(repo_config, metadata):
    configured = repo_config.get("integration_branches")
    if configured:
        return [str(branch) for branch in configured]
    return [str(metadata.get("default_branch") or "main")]


def signal_key(kind, number):
    return "{0}:{1}".format(kind, number)


def importance_block(kind, item, score, reasons):
    icon = "🔀" if kind == "pr" else "🐛"
    noun = "PR" if kind == "pr" else "Issue"
    labels = label_names(item)
    lines = [
        "**{0} 重要{1}早期信号 #{2}** · 评分 {3}".format(icon, noun, item["number"], score),
        "",
        "📌 **{0}**".format(item.get("title", "")),
        "",
        "判断依据：{0}".format("、".join(reasons) if reasons else "自定义阈值"),
    ]
    if labels:
        lines.extend(["", "标签：`{0}`".format("` `".join(labels[:8]))])
    body = compact_body(item.get("body", ""))
    if body:
        lines.extend(["", body])
    lines.extend(["", "[🔗 查看{0}]({1})".format(noun, item.get("html_url", ""))])
    return "\n".join(lines)


def release_block(release):
    title = release.get("name") or release.get("tag_name") or "未命名版本"
    badge = "（预发布）" if release.get("prerelease") else ""
    body = compact_body(release.get("body", ""))
    result = "**🚀 新版本 {0} {1}**\n\n📌 **{2}**".format(
        release.get("tag_name", ""), badge, title
    )
    if body:
        result += "\n\n" + body
    return result + "\n\n[🔗 查看 Release]({0})".format(release.get("html_url", ""))


def pr_outcome_block(pr, branches, watched_early):
    number = pr["number"]
    base = pr.get("base", {}).get("ref", "")
    if pr.get("merged_at"):
        if base in branches:
            heading = "**✅ PR 合入主开发分支 #{0} → `{1}`**".format(number, base)
        elif watched_early:
            heading = "**✅ 已关注的重要 PR 合入 #{0} → `{1}`**".format(number, base)
        else:
            return ""
    elif watched_early:
        heading = "**⛔ 已关注的重要 PR 关闭但未合入 #{0}**".format(number)
    else:
        return ""
    return "{0}\n\n📌 **{1}**\n\n[🔗 查看 PR]({2})".format(
        heading, pr.get("title", ""), pr.get("html_url", "")
    )


def issue_outcome_block(issue, previous):
    if not previous or not previous.get("notified"):
        return ""
    old_state = previous.get("state")
    new_state = issue.get("state")
    if old_state == new_state:
        return ""
    heading = "✅ 已关注的重要 Issue 已关闭" if new_state == "closed" else "♻️ 已关注的重要 Issue 重新打开"
    return "**{0} #{1}**\n\n📌 **{2}**\n\n[🔗 查看 Issue]({3})".format(
        heading, issue["number"], issue.get("title", ""), issue.get("html_url", "")
    )


def remember_signal(signals, key, item, score, notified=None):
    old = signals.get(key, {})
    signals[key] = {
        "score": score,
        "notified": old.get("notified", False) if notified is None else bool(notified),
        "state": item.get("state", "open"),
        "updated_at": item.get("updated_at", ""),
    }


def trim_signals(signals, limit=600):
    if len(signals) <= limit:
        return signals
    ordered = sorted(signals.items(), key=lambda pair: pair[1].get("updated_at", ""), reverse=True)
    return dict(ordered[:limit])


def collect_repo(repo_config, repo_state, capture_time, bootstrap=False):
    repo = repo_config["repo"]
    metadata = github_get(repo, "")
    branches = integration_branches(repo_config, metadata)
    last_check = repo_state.get("last_check", "")
    signals = dict(repo_state.get("signals", {}))
    blocks = []

    releases = github_get(repo, "/releases", {"per_page": 20})
    for release in reversed(releases if isinstance(releases, list) else []):
        published = release.get("published_at", "")
        if release.get("draft") or not published:
            continue
        if not bootstrap and published > last_check:
            blocks.append(event_block(
                release_block(release), release, "release", release.get("tag_name", published)
            ))

    closed_prs = github_get(repo, "/pulls", {
        "state": "closed", "sort": "updated", "direction": "desc", "per_page": 100,
    })
    for pr in closed_prs if isinstance(closed_prs, list) else []:
        if pr.get("updated_at", "") <= last_check and not bootstrap:
            break
        key = signal_key("pr", pr["number"])
        previous = signals.get(key, {})
        event_time = pr.get("merged_at") or pr.get("closed_at") or ""
        if not bootstrap and event_time > last_check:
            is_excluded, reason = excluded_event(repo_config, repo, pr, "pr")
            block = "" if is_excluded else pr_outcome_block(
                pr, branches, previous.get("notified", False)
            )
            if block:
                blocks.append(event_block(block, pr, "pr", pr["number"]))
            elif is_excluded:
                print("[filter] {0} PR #{1} excluded by {2}".format(repo, pr["number"], reason))
        remember_signal(signals, key, pr, previous.get("score", 0), previous.get("notified", False))

    open_prs = github_get(repo, "/pulls", {
        "state": "open", "sort": "updated", "direction": "desc", "per_page": 100,
    })
    pr_threshold = threshold(repo_config, "pr")
    for pr in open_prs if isinstance(open_prs, list) else []:
        key = signal_key("pr", pr["number"])
        previous = signals.get(key, {})
        score, reasons = importance(pr, "pr")
        changed = pr.get("updated_at", "") > last_check
        should_notify = (
            not bootstrap and changed and pr_threshold is not None
            and score >= pr_threshold and not previous.get("notified", False)
        )
        if should_notify:
            is_excluded, reason = excluded_event(repo_config, repo, pr, "pr")
            if is_excluded:
                should_notify = False
                print("[filter] {0} PR #{1} excluded by {2}".format(repo, pr["number"], reason))
            else:
                blocks.append(event_block(
                    importance_block("pr", pr, score, reasons), pr, "pr", pr["number"]
                ))
        remember_signal(signals, key, pr, score, previous.get("notified", False) or should_notify)

    issues = github_get(repo, "/issues", {
        "state": "all", "sort": "updated", "direction": "desc", "per_page": 100,
    })
    issue_threshold = threshold(repo_config, "issue")
    for issue in issues if isinstance(issues, list) else []:
        if "pull_request" in issue:
            continue
        key = signal_key("issue", issue["number"])
        previous = signals.get(key, {})
        changed = issue.get("updated_at", "") > last_check
        outcome = "" if bootstrap or not changed else issue_outcome_block(issue, previous)
        if outcome:
            is_excluded, reason = custom_exclusion(repo_config, issue)
            if is_excluded:
                outcome = ""
                print("[filter] {0} Issue #{1} excluded by {2}".format(repo, issue["number"], reason))
            else:
                blocks.append(event_block(outcome, issue, "issue", issue["number"]))
        score, reasons = importance(issue, "issue")
        should_notify = (
            not bootstrap and changed and issue.get("state") == "open"
            and issue_threshold is not None and score >= issue_threshold
            and not previous.get("notified", False)
        )
        if should_notify:
            is_excluded, reason = custom_exclusion(repo_config, issue)
            if is_excluded:
                should_notify = False
                print("[filter] {0} Issue #{1} excluded by {2}".format(repo, issue["number"], reason))
            else:
                blocks.append(event_block(
                    importance_block("issue", issue, score, reasons), issue, "issue", issue["number"]
                ))
        remember_signal(
            signals, key, issue, score,
            previous.get("notified", False) or should_notify,
        )

    return blocks, {
        "last_check": capture_time,
        "default_branch": metadata.get("default_branch", ""),
        "integration_branches": branches,
        "level": repo_config.get("level", "balanced"),
        "signals": trim_signals(signals),
    }


def render_card(repo_config, repo_state, blocks):
    branches = "`, `".join(repo_state.get("integration_branches", []))
    level = repo_config.get("level", "balanced")
    intro = "**📦 {0}** · 监控级别 `{1}` · 主开发分支 `{2}`".format(
        repo_config["repo"], level, branches
    )
    rendered_blocks = add_chinese_summaries(blocks)
    return intro + "\n\n---\n\n" + "\n\n---\n\n".join(rendered_blocks)


def run():
    configure()
    repositories = [item for item in WATCH.get("repositories", []) if item.get("enabled", True)]
    if not repositories:
        print("NO_REPOSITORIES")
        return
    STATE_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    with LOCK_FILE.open("a+", encoding="utf-8") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("ALREADY_RUNNING")
            return
        state = load_state()
        repo_states = state.setdefault("repos", {})
        capture_time = now_iso()
        bootstrapped = 0
        pushed = 0
        failures = 0
        for repo_config in repositories:
            repo = repo_config["repo"]
            previous = repo_states.get(repo, {})
            bootstrap = not bool(previous.get("last_check"))
            try:
                blocks, next_state = collect_repo(repo_config, previous, capture_time, bootstrap)
                if bootstrap:
                    bootstrapped += 1
                elif blocks:
                    send_card(
                        "🌐 Public 仓库重要更新",
                        render_card(repo_config, next_state, blocks),
                        template="purple",
                    )
                    pushed += len(blocks)
                repo_states[repo] = next_state
                save_state(state)
            except Exception as cause:
                failures += 1
                print("[error] {0}: {1}".format(repo, cause), file=sys.stderr)
        print("DONE bootstrapped={0} pushed={1} failures={2}".format(bootstrapped, pushed, failures))
        if failures:
            raise SystemExit(1)


if __name__ == "__main__":
    run()
