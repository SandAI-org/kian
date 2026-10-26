#!/usr/bin/env python3
"""Deterministic PR description manager for Feishu descN/upN commands."""
import base64
import json
import http.client
import fcntl
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date

from automation_common import STATE_DIR, load_config

MANAGED_PATH = str(STATE_DIR / "managed-prs.json")
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def load_json(path, fallback):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return fallback


CONFIG = load_config()
GITHUB = CONFIG.get("github", {})
TOKENS = GITHUB.get("tokens", {})
REPOS = GITHUB.get("repos", [])
PR_MANAGER = CONFIG.get("pr_manager", {})
SPECIAL_LAYOUT_REPO = PR_MANAGER.get("special_layout_repo", "")
SUMMARIZATION = CONFIG.get("summarization", {})

STANDALONE_SOURCE_DIRS = {
    "SandAI-org/MagiAttention": "magi_attention",
    "SandAI-org/MagiFSDP": "magi_fsdp",
    "SandAI-org/MagiMoE": "magi_moe",
    "world-sim-dev/odin": "odin",
}


def request(repo, path, method="GET", payload=None):
    token = TOKENS.get(repo.split("/", 1)[0], "")
    url = f"https://api.github.com/repos/{repo}{path}"
    data = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "kian-copilot-bridge")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    last_error = None
    for attempt in range(3):
        try:
            with OPENER.open(req, timeout=45) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            # Authentication, permission and missing-resource errors are not
            # transient. Preserve them so callers can distinguish a 404 while
            # searching repositories.
            if 400 <= error.code < 500 and error.code != 429:
                raise
            last_error = error
        except (urllib.error.URLError, http.client.IncompleteRead, TimeoutError, ConnectionError) as error:
            last_error = error
        if attempt < 2:
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"GitHub API 请求失败（重试 3 次）: {repo}{path}: {last_error}")


def find_pr(number, managed, requested_repo=None):
    if requested_repo:
        if requested_repo not in REPOS:
            raise RuntimeError(f"仓库 {requested_repo} 不在监控列表中")
        pr = request(requested_repo, f"/pulls/{number}")
        if not isinstance(pr, dict) or pr.get("number") != number:
            raise RuntimeError(f"没有在 {requested_repo} 中找到 PR #{number}")
        return requested_repo, pr
    matches = []
    for key in managed.get("managed", {}):
        repo, raw_number = key.rsplit("#", 1)
        if raw_number == str(number):
            matches.append(repo)
    if len(matches) == 1:
        return matches[0], request(matches[0], f"/pulls/{number}")
    for repo in REPOS:
        try:
            pr = request(repo, f"/pulls/{number}")
            if isinstance(pr, dict) and pr.get("number") == number:
                matches.append(repo)
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise
    unique = list(dict.fromkeys(matches))
    if not unique:
        raise RuntimeError(f"没有在监控仓库中找到 PR #{number}")
    if len(unique) > 1:
        raise RuntimeError(f"PR #{number} 在多个仓库中存在，请发送 desc/up 时带仓库名")
    return unique[0], request(unique[0], f"/pulls/{number}")


def sentence_from_title(title):
    text = re.sub(r"^\s*(?:\[[^]]+\]\s*)?", "", title or "").strip()
    text = re.sub(r"^(?:feat|fix|hotfix|hotfeat|chore|refactor|perf|test)(?:\([^)]*\))?\s*:\s*", "", text, flags=re.I)
    if not text:
        text = "Updated the implementation"
    first = text[0].upper() + text[1:]
    if not first.endswith("."):
        first += "."
    return first


def linked_pr_numbers(commits):
    numbers = []
    for item in commits:
        message = item.get("commit", {}).get("message", "").splitlines()[0]
        for match in re.findall(r"\(#(\d+)\)", message):
            number = int(match)
            if number not in numbers:
                numbers.append(number)
        merge_match = re.search(r"pull request\s+#(\d+)", message, flags=re.I)
        if merge_match:
            number = int(merge_match.group(1))
            if number not in numbers:
                numbers.append(number)
    return numbers


def linked_pr_sentence(title):
    phrase = title_phrase(title)
    if not phrase:
        return "Updated related changes"
    lower = phrase.lower()
    if lower.startswith("fix "):
        return "Fixed " + phrase[4:]
    if lower.startswith("add "):
        return "Added " + phrase[4:]
    if lower.startswith("support "):
        return "Supported " + phrase[8:]
    if lower.startswith("improve "):
        return "Improved " + phrase[8:]
    return sentence_from_title(phrase).rstrip(".")


def render_linked_bullet(linked_pr):
    title = linked_pr_sentence(linked_pr.get("title", ""))
    url = linked_pr.get("html_url", "")
    return f"- {title}, w.r.t. the PR: {url}."


def summarize_magicore_linked_pr(linked_pr, files):
    """Summarize a linked Magicore PR from its actual changes, not its title."""
    filenames = "\n".join(item.get("filename", "") for item in files)
    patches = "\n".join(item.get("patch") or "" for item in files)
    body = linked_pr.get("body") or ""
    searchable = f"{filenames}\n{patches}\n{body}".lower()

    if "use_runtime_adjust_lr_shape" in searchable and "_muon.py" in searchable:
        return (
            "Fixed Muon adjusted-LR scaling to optionally use the runtime layout-hook "
            "matrix shape, while preserving legacy init-time shape behavior and adding "
            "safe fallback handling"
        )
    if "test_singleloss_python_counter_does_not_copy_from_host" in searchable and "-@pytest" in searchable:
        return (
            "Reverted device-side loss and feature-stat counter construction to "
            "`torch.tensor`, and removed the associated H2D profiler regression test"
        )
    if "_check_nonfinite_log_vals" in searchable and "comm_healthcheck.py" in searchable:
        return (
            "Removed loss/statistics CPU and H2D synchronization, added non-finite "
            "training diagnostics and NVTX instrumentation, and introduced communication "
            "health-check and GPU burn tooling"
        )
    if "save_fp32_out_for_bwd" in searchable and "return_fp32_out" in searchable:
        return (
            "Added FP32 FlashAttention-4 outputs for forward/backward accuracy, propagated "
            "the controls through Gaga3 attention configs, and added reproducible patch "
            "application for the installed `flash_attn` package"
        )
    if "dynamic_sources" in searchable and "mark_dynamic(scatter_weight" in searchable:
        return (
            "Eliminated per-iteration attention and MoE-router recompilation by making "
            "variable sequence-length sources symbolic from the first compile and marking "
            "the eager scatter weight dynamic"
        )
    if "max_seqlen_q" in searchable and "multi_head_moe.py" in searchable:
        return (
            "Prevented cold-start `torch.compile` recompilation in attention and MoE paths "
            "by keeping data-dependent sequence-length values out of compiled frame state"
        )

    # A maintained linked PR often already has a useful DONE section. Prefer
    # its concrete bullets over repeating the title, while keeping one compact
    # sentence suitable for a parent PR description.
    done_bullets = []
    for line in body.splitlines():
        match = re.match(r"^\s*-\s+(.+?)\s*$", line)
        if match:
            text = match.group(1).rstrip(".")
            if text and "w.r.t. the pr" not in text.lower():
                done_bullets.append(text)
        if len(done_bullets) == 3:
            break
    if done_bullets:
        return "Implemented " + "; ".join(item[0].lower() + item[1:] for item in done_bullets)

    paths = [item.get("filename", "") for item in files if item.get("filename")]
    if paths:
        scopes = []
        for path in paths:
            parts = path.split("/")
            scope = "/".join(parts[:3]) if len(parts) >= 3 else path
            if scope not in scopes:
                scopes.append(scope)
        return f"Updated the implementation across {', '.join(f'`{scope}`' for scope in scopes[:3])}"
    return linked_pr_sentence(linked_pr.get("title", ""))


def repair_legacy_magicore_linked_bullets(body):
    """Replace low-information title copies emitted by the old generator."""
    replacements = PR_MANAGER.get("legacy_replacements", {})
    repaired = body
    for old, new in replacements.items():
        repaired = repaired.replace(old, new)
    return repaired


def commit_title(item):
    return item.get("commit", {}).get("message", "").splitlines()[0].strip()


def normalize_text(text):
    text = re.sub(r"[`\"'’‘“”]", "", text or "")
    text = re.sub(r"[*_#()]", " ", text)
    text = re.sub(r"[^a-z0-9]+", " ", text.lower())
    return " ".join(text.split())


def title_phrase(title):
    text = re.sub(r"\s*\(#\d+\)\s*$", "", title or "")
    text = re.sub(r"^\s*(?:\[[^]]+\]\s*)?", "", text)
    text = re.sub(r"^(?:feat|fix|hotfix|hotfeat|chore|refactor|perf|test)(?:\([^)]*\))?\s*:\s*", "", text, flags=re.I)
    text = re.sub(r"\s+", " ", text).strip(" .")
    return text


def compact_title(title):
    text = title_phrase(title)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def is_magicore_algo_path(path):
    normalized = (path or "").replace("\\", "/").lower()
    return (
        normalized.startswith("apps/")
        or "/modeling/" in normalized
        or normalized.endswith("modeling.py")
        or normalized.startswith("modeling.py")
        or "/models/" in normalized
    )


def is_magicore_infra_path(path):
    normalized = (path or "").replace("\\", "/").lower()
    return normalized.startswith("pkgs/")


def magicore_bucket_from_paths(paths):
    has_algo = any(is_magicore_algo_path(path) for path in paths)
    has_infra = any(is_magicore_infra_path(path) for path in paths)
    if has_algo:
        return "algo"
    if has_infra:
        return "infra"
    return None


def commit_paths(repo, sha, cache):
    if sha in cache:
        return cache[sha]
    data = request(repo, f"/commits/{sha}")
    paths = []
    for item in data.get("files", []) if isinstance(data, dict) else []:
        filename = item.get("filename", "")
        if filename:
            paths.append(filename)
    cache[sha] = paths
    return paths


def linked_pr_paths(repo, number, cache):
    key = f"{repo}#{number}"
    if key in cache:
        return cache[key]
    paths = []
    page = 1
    while True:
        data = request(repo, f"/pulls/{number}/files?per_page=100&page={page}")
        if not isinstance(data, list) or not data:
            break
        for item in data:
            filename = item.get("filename", "")
            if filename:
                paths.append(filename)
        if len(data) < 100:
            break
        page += 1
    cache[key] = paths
    return paths


def pull_request_files(repo, number):
    files = []
    page = 1
    while True:
        data = request(repo, f"/pulls/{number}/files?per_page=100&page={page}")
        if not isinstance(data, list) or not data:
            break
        files.extend(item for item in data if isinstance(item, dict))
        if len(data) < 100:
            break
        page += 1
    return files


def has_unavailable_line_stats(item):
    """Whether GitHub omitted a file's per-file line counters.

    GitHub occasionally returns a complete PR file inventory while reporting
    zero for additions, deletions, and changes on a non-empty text diff.  Do
    not exclude renames here: a rename may also contain edits.
    """
    return not (
        item.get("additions", 0)
        or item.get("deletions", 0)
        or item.get("changes", 0)
    )


def git_blob_bytes(repo, sha):
    data = request(repo, f"/git/blobs/{sha}")
    if not isinstance(data, dict) or data.get("encoding") != "base64":
        raise RuntimeError(f"GitHub 未返回 blob {sha} 的 base64 内容")
    return base64.b64decode(data.get("content", ""))


def numstat_from_blob_bytes(before, after):
    """Use Git's own diff engine to preserve GitHub-compatible line counts."""
    with tempfile.TemporaryDirectory(prefix="kian-pr-numstat-") as directory:
        before_path = os.path.join(directory, "before")
        after_path = os.path.join(directory, "after")
        with open(before_path, "wb") as handle:
            handle.write(before)
        with open(after_path, "wb") as handle:
            handle.write(after)
        result = subprocess.run(
            ["git", "diff", "--no-index", "--numstat", "--", before_path, after_path],
            text=True,
            capture_output=True,
            check=False,
        )
    if result.returncode not in (0, 1):
        raise RuntimeError(f"git diff --numstat 失败: {result.stderr.strip()}")
    line = result.stdout.strip()
    if not line:
        return 0, 0
    fields = line.split("\t", 2)
    if len(fields) < 2 or not fields[0].isdigit() or not fields[1].isdigit():
        raise RuntimeError("二进制文件无法获得精确的逐 scope 行数")
    return int(fields[0]), int(fields[1])


def fill_unavailable_pr_file_stats(repo, pr, files):
    """Recover omitted GitHub file counters from the base/head blobs.

    This is deliberately a targeted fallback: normal PRs keep the lightweight
    files API path, while only files whose three counters are all zero require
    extra requests.  If the base tree is truncated or any blob cannot be read,
    the caller retains the existing conservative rendering.
    """
    missing = [item for item in files if has_unavailable_line_stats(item)]
    if not missing:
        return
    base_sha = pr.get("base", {}).get("sha", "")
    if not base_sha:
        raise RuntimeError("PR 缺少 base SHA，无法补全逐文件行数")
    tree = request(repo, f"/git/trees/{base_sha}?recursive=1")
    if not isinstance(tree, dict) or tree.get("truncated"):
        raise RuntimeError("GitHub base tree 不完整，无法补全逐文件行数")
    base_blobs = {
        entry.get("path"): entry.get("sha")
        for entry in tree.get("tree", [])
        if entry.get("type") == "blob" and entry.get("path") and entry.get("sha")
    }
    blob_shas = set()
    for item in missing:
        status = item.get("status")
        filename = item.get("filename", "")
        previous = item.get("previous_filename") or filename
        if status != "added":
            blob_shas.add(base_blobs.get(previous))
        if status != "removed":
            blob_shas.add(item.get("sha"))
    blob_shas.discard(None)
    with ThreadPoolExecutor(max_workers=min(8, len(blob_shas) or 1)) as executor:
        futures = {sha: executor.submit(git_blob_bytes, repo, sha) for sha in blob_shas}
        blobs = {sha: future.result() for sha, future in futures.items()}
    for item in missing:
        status = item.get("status")
        filename = item.get("filename", "")
        previous = item.get("previous_filename") or filename
        before_sha = base_blobs.get(previous)
        after_sha = item.get("sha")
        before = b"" if status == "added" else blobs[before_sha]
        after = b"" if status == "removed" else blobs[after_sha]
        additions, deletions = numstat_from_blob_bytes(before, after)
        item["additions"] = additions
        item["deletions"] = deletions
        item["changes"] = additions + deletions


def should_build_from_diff(pr, commits):
    """Prefer the actual diff when imported history would dominate a summary."""
    title = (pr.get("title") or "").lower()
    commit_count = pr.get("commits")
    if not isinstance(commit_count, int):
        commit_count = len(commits)
    changed_files = pr.get("changed_files")
    if not isinstance(changed_files, int):
        changed_files = 0
    looks_like_sync = any(marker in title for marker in ("subtree", "sync ", "sync(", "sync:"))
    history_dwarfs_diff = commit_count >= 20 and changed_files > 0 and commit_count >= changed_files * 2
    return looks_like_sync or history_dwarfs_diff


def build_diff_bullets(pr, files):
    """Build a compact feature summary from changed paths and patches."""
    filenames = [item.get("filename", "") for item in files]
    patch_text = "\n".join(item.get("patch") or "" for item in files)
    searchable = ("\n".join(filenames) + "\n" + patch_text).lower()
    additions = sum(item.get("additions", 0) or 0 for item in files)
    deletions = sum(item.get("deletions", 0) or 0 for item in files)
    bullets = []

    title = compact_title(pr.get("title", ""))
    if title:
        bullets.append(
            f"- {sentence_from_title(title).rstrip('.')} based on the actual code diff "
            f"({len(files)} files, {additions} additions and {deletions} deletions)."
        )

    if "mhc_handler.py" in searchable and "sinkhorn_pattern" in searchable:
        detail = "Added configurable row/column Sinkhorn normalization for mHC"
        if "projection_dtype" in searchable:
            detail += " and preserved configurable projection dtypes through forward/backward"
        bullets.append(f"- {detail}, with expanded correctness coverage.")

    if "_grad_utils.py" in searchable or "record_grad_per_param" in searchable:
        details = []
        if "record_grad_per_param" in searchable:
            details.append("distributed per-parameter gradient statistics")
        if "_reduce_dtensor_stats" in searchable or "partial(" in searchable:
            details.append("DTensor-aware reductions across sharded meshes")
        if "fused_grad_norm" in searchable:
            details.append("fused FP32 grad-norm correctness")
        if details:
            bullets.append(f"- Improved optimizer diagnostics and correctness for {'; '.join(details)}.")

    if "_muon.py" in searchable and "runtime_adjust_lr_shape" in searchable:
        bullets.append("- Made Muon adjusted-LR scaling honor the runtime layout-hook matrix shape, with safe fallback behavior.")

    if "_stridedshard" in searchable:
        bullets.append("- Fixed distributed gradient zero-count reduction for strided DTensor shards.")

    if "default-version = \"0.2.2\"" in searchable:
        bullets.append("- Updated the package default version to `0.2.2`.")

    if "test_optimizer_step_func.py" in searchable and "layout_hooks=layout_hooks" in searchable:
        bullets.append("- Fixed the Muon optimizer-step regression test to pass the required layout hooks.")

    if "scan_tree_for_nan" in searchable:
        bullets.append("- Added recursive NaN diagnostics for nested tensor structures, including source-location context.")

    validation_files = [name for name in filenames if name.startswith("tests/")]
    if validation_files and not any("correctness coverage" in bullet for bullet in bullets):
        bullets.append(f"- Expanded regression coverage across {len(validation_files)} test files.")

    dcgm_files = [name for name in filenames if "dcgm" in name.lower()]
    gpu_burn_files = [name for name in filenames if "gpu_burn" in name.lower()]
    if dcgm_files or gpu_burn_files:
        tools = []
        if dcgm_files:
            tools.append("DCGM diagnostics")
        if gpu_burn_files:
            tools.append("GPU burn testing")
        bullets.append(f"- Added install/run automation for {' and '.join(tools)}.")

    if len(bullets) == 1:
        top_dirs = []
        for filename in filenames:
            top = filename.split("/", 1)[0]
            if top and top not in top_dirs:
                top_dirs.append(top)
        if top_dirs:
            bullets.append(f"- Updated the main implementation under {', '.join(f'`{name}/`' for name in top_dirs[:5])}.")
    return [markdown_inline_format(bullet) for bullet in bullets]


def build_diff_body(pr, files):
    bullets = build_diff_bullets(pr, files)
    if not bullets:
        bullets = ["- Updated the implementation based on the actual PR diff."]
    return "## DONE\n\n" + "\n".join(bullets) + "\n"


def diff_scope(filename):
    if filename.startswith("apps/"):
        return "apps/"
    if filename.startswith("pkgs/"):
        return "pkgs/"
    return "others"


def diff_summary_group(filename, special_layout=False):
    """Return a fair-sharing group for representative patch excerpts."""
    if special_layout:
        if filename.startswith("apps/"):
            return "apps/"
        if filename.startswith("pkgs/"):
            parts = filename.split("/", 2)
            return "/".join(parts[:2]) + "/" if len(parts) >= 2 else "pkgs/"
        return "others"
    return filename.split("/", 1)[0] or "root"


def diff_summary_payload(files, limit=120000, special_layout=False):
    """Serialize a complete inventory plus fairly sampled final-diff excerpts.

    GitHub returns PR files in path order. Appending full patches in that order made
    early directories consume the entire prompt budget, so a large Magicore PR could
    omit every ``pkgs/`` change. Keep every file in a compact inventory, then select
    bounded excerpts round-robin across apps, each package, and other files.
    """
    inventory = ["COMPLETE FILE INVENTORY (all changed files):\n"]
    for item in files:
        inventory.append(
            f"FILE {item.get('filename', '')} status={item.get('status', '')} "
            f"additions={item.get('additions', 0)} deletions={item.get('deletions', 0)}\n"
        )
    inventory_text = "".join(inventory)
    if len(inventory_text) >= limit:
        return inventory_text[:limit]

    groups = {}
    for item in files:
        filename = item.get("filename", "")
        groups.setdefault(diff_summary_group(filename, special_layout), []).append(item)

    chunks = [inventory_text, "\nREPRESENTATIVE FINAL-DIFF PATCH EXCERPTS:\n"]
    size = sum(len(chunk) for chunk in chunks)
    indexes = {name: 0 for name in groups}
    max_excerpt = 4000
    while size < limit:
        progressed = False
        for group, items in groups.items():
            index = indexes[group]
            if index >= len(items):
                continue
            item = items[index]
            indexes[group] += 1
            progressed = True
            patch = item.get("patch") or "(patch unavailable; infer only from inventory statistics)"
            chunk = (
                f"\nPATCH EXCERPT scope={group} file={item.get('filename', '')}\n"
                f"{patch[:max_excerpt]}\n"
            )
            remaining = limit - size
            if remaining <= 0:
                break
            chunks.append(chunk[:remaining])
            size += min(len(chunk), remaining)
        if not progressed:
            break
    return "".join(chunks)


def magicore_scope_stats(files, pr=None):
    stats = {
        scope: {"files": 0, "additions": 0, "deletions": 0}
        for scope in ("apps/", "pkgs/", "others")
    }
    for item in files:
        values = stats[diff_scope(item.get("filename", ""))]
        values["files"] += 1
        values["additions"] += item.get("additions", 0) or 0
        values["deletions"] += item.get("deletions", 0) or 0
    complete = True
    if pr:
        reported_additions = sum(value["additions"] for value in stats.values())
        reported_deletions = sum(value["deletions"] for value in stats.values())
        expected_additions = pr.get("additions")
        expected_deletions = pr.get("deletions")
        if (
            isinstance(expected_additions, int)
            and isinstance(expected_deletions, int)
            and (reported_additions, reported_deletions)
            != (expected_additions, expected_deletions)
        ):
            incomplete_scopes = {
                diff_scope(item.get("filename", ""))
                for item in files
                if item.get("status") != "renamed"
                and not (item.get("additions", 0) or 0)
                and not (item.get("deletions", 0) or 0)
                and not (item.get("changes", 0) or 0)
            }
            missing_additions = expected_additions - reported_additions
            missing_deletions = expected_deletions - reported_deletions
            if (
                len(incomplete_scopes) == 1
                and missing_additions >= 0
                and missing_deletions >= 0
            ):
                scope = next(iter(incomplete_scopes))
                stats[scope]["additions"] += missing_additions
                stats[scope]["deletions"] += missing_deletions
            else:
                complete = False
    return stats, complete


def render_change_scope(files, pr=None):
    stats, complete = magicore_scope_stats(files, pr)
    if not complete:
        return (
            f"> **Change scope:** **total** {pr.get('changed_files', len(files)):,} files "
            f"(+{pr.get('additions', 0):,}/−{pr.get('deletions', 0):,}) · "
            + " · ".join(
                f"`{scope}` {stats[scope]['files']:,} files"
                for scope in ("apps/", "pkgs/", "others")
            )
            + " · per-scope line counts unavailable from GitHub"
        )
    rendered = []
    for scope in ("apps/", "pkgs/", "others"):
        values = stats[scope]
        file_label = "file" if values["files"] == 1 else "files"
        rendered.append(
            f"`{scope}` {values['files']:,} {file_label} "
            f"(+{values['additions']:,}/−{values['deletions']:,})"
        )
    return "> **Change scope:** " + " · ".join(rendered)


def standalone_diff_scope(filename, source_dir):
    top_level = filename.split("/", 1)[0]
    if top_level == source_dir:
        return "src/"
    if top_level == "tests":
        return "tests/"
    return "others/"


def render_standalone_change_scope(files, repo):
    source_dir = STANDALONE_SOURCE_DIRS.get(repo, repo.rsplit("/", 1)[-1].lower())
    stats = {
        scope: {"files": 0, "additions": 0, "deletions": 0}
        for scope in ("src/", "tests/", "others/")
    }
    for item in files:
        values = stats[standalone_diff_scope(item.get("filename", ""), source_dir)]
        values["files"] += 1
        values["additions"] += item.get("additions", 0) or 0
        values["deletions"] += item.get("deletions", 0) or 0
    rendered = []
    for scope in ("src/", "tests/", "others/"):
        values = stats[scope]
        file_label = "file" if values["files"] == 1 else "files"
        rendered.append(
            f"`{scope}` {values['files']:,} {file_label} "
            f"(+{values['additions']:,}/−{values['deletions']:,})"
        )
    return "> **Change scope:** " + " · ".join(rendered)


SYNC_PACKAGE_NAMES = {
    "magiattn": "magi_attention",
    "magiattention": "magi_attention",
    "magifsdp": "magi_fsdp",
    "magimoe": "magi_moe",
    "odin": "odin",
}


def package_sync_records(commits):
    pattern = re.compile(
        r"\bsync\s+(?P<package>[A-Za-z0-9_.-]+)\s+(?:on\s+)?"
        r"(?P<branch>.+?)\s+branch\s+at\s+commit\s+(?P<commit>[0-9a-f]{7,40})"
        r"(?=\s*(?:&\s*sync\b|$))",
        flags=re.I,
    )
    latest = {}
    for item in commits:
        subject = item.get("commit", {}).get("message", "").splitlines()[0].strip()
        for match in pattern.finditer(subject):
            raw_package = match.group("package").lower()
            version = ""
            version_match = re.match(r"(.+?)(-v\d[0-9A-Za-z.-]*)$", raw_package)
            if version_match:
                raw_name, version = version_match.groups()
            else:
                raw_name = raw_package
            identity = SYNC_PACKAGE_NAMES.get(raw_name.replace("_", ""), raw_name)
            latest[identity] = {
                "package": identity + version,
                "branch": match.group("branch").strip(),
                "commit": match.group("commit").lower(),
            }
    return list(latest.values())


def apply_package_sync_overrides(records, repo):
    overrides = PR_MANAGER.get("sync_source_overrides", {}).get(repo, {})
    resolved = []
    for record in records:
        current = dict(record)
        override = overrides.get(current["package"], {})
        if override and override.get("when_commit") == current["commit"]:
            current["branch"] = override["branch"]
            current["commit"] = override["commit"]
        resolved.append(current)
    return resolved


def sync_bullet_prefix(record):
    return (
        f"Sync `{record['package']}` on `{record['branch']}` branch at commit "
        f"`{record['commit']}`, to "
    )


def normalize_and_validate_summary(summary, linked_prs, package_syncs=None):
    package_syncs = package_syncs or []

    def ensure_bold(value):
        if re.search(r"\*\*[^*]+\*\*", value):
            return value
        boundary = re.search(r"(?:,|:|\s+(?:by|via|with|through|using|while)\s+)", value)
        end = boundary.start() if boundary and boundary.start() >= 12 else min(len(value), 72)
        return f"**{value[:end].rstrip()}**{value[end:]}"

    normalized = {}
    for bucket in ("algo", "infra", "general"):
        values = summary.get(bucket, [])
        normalized[bucket] = []
        for value in values:
            raw = str(value).strip().lstrip("- ")
            if not raw:
                continue
            sync_prefix = next(
                (
                    prefix
                    for prefix in map(sync_bullet_prefix, package_syncs)
                    if raw.startswith(prefix)
                ),
                "",
            )
            formatted = (
                sync_prefix + markdown_inline_format(raw[len(sync_prefix):])
                if sync_prefix
                else markdown_inline_format(raw)
            )
            normalized[bucket].append(ensure_bold(formatted))
    if not any(normalized.values()):
        raise RuntimeError("摘要后端返回了空的 diff 摘要")
    rendered_values = "\n".join(
        value for values in normalized.values() for value in values
    )
    missing_urls = [
        item.get("html_url", "")
        for item in linked_prs
        if item.get("html_url") and item.get("html_url") not in rendered_values
    ]
    if missing_urls:
        raise ValueError(f"摘要后端遗漏了关联 PR 来源: {', '.join(missing_urls)}")
    for value in rendered_values.splitlines():
        attributed_urls = re.findall(r"https://github\.com/[^\s,]+/pull/\d+", value)
        if len(attributed_urls) > 1 and "w.r.t. the PRs:" not in value:
            raise ValueError("多个关联 PR 必须合并为一个 `w.r.t. the PRs:` 后缀")
        if len(attributed_urls) == 1 and "w.r.t. the PR:" not in value:
            raise ValueError("单个关联 PR 必须使用 `w.r.t. the PR:` 后缀")
    for record in package_syncs:
        prefix = sync_bullet_prefix(record)
        matches = [value for value in normalized["infra"] if value.startswith(prefix)]
        if len(matches) != 1:
            raise ValueError(
                f"Infra 必须包含且仅包含一条精确同步记录: {prefix.strip()}"
            )
    return normalized


def summarize_with_copilot_cli(prompt):
    configured_command = str(SUMMARIZATION.get("command", "copilot"))
    command = shutil.which(configured_command) or (
        configured_command if os.path.isfile(configured_command) else ""
    )
    if not command:
        raise RuntimeError("未找到 Copilot CLI；请安装并执行 `copilot login`")
    env = os.environ.copy()
    for key in ("http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY"):
        env.pop(key, None)
    result = subprocess.run(
        [
            command,
            "-p",
            prompt,
            "--silent",
            "--no-color",
            "--no-auto-update",
            "--disable-builtin-mcps",
            "--available-tools=",
            "--no-custom-instructions",
            "--no-ask-user",
            "--model",
            str(SUMMARIZATION.get("model", "auto")),
        ],
        env=env,
        text=True,
        capture_output=True,
        timeout=180,
        check=False,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip().splitlines()
        raise RuntimeError(
            "Copilot CLI 摘要失败: " + (detail[0] if detail else "unknown error")
        )
    content = result.stdout.strip()
    content = re.sub(r"^```(?:json)?\s*|\s*```$", "", content, flags=re.I)
    return json.loads(content)


def summarize_current_diff(
    pr,
    files,
    existing_body,
    special_layout=False,
    linked_prs=None,
    concise=False,
    package_syncs=None,
):
    """Use the final PR diff to rewrite DONE as a coherent current-state summary."""
    linked_prs = linked_prs or []
    package_syncs = package_syncs or []
    schema = (
        '{"algo":["..."],"infra":["..."],"general":["..."]}'
        if special_layout
        else '{"algo":[],"infra":[],"general":["..."]}'
    )
    linked_context = "\n".join(
        f"- {item.get('html_url', '')} | {item.get('title', '')}"
        for item in linked_prs
    ) or "(none)"
    sync_context = "\n".join(
        f"- {sync_bullet_prefix(record)}<final imported behavior from the diff>"
        for record in package_syncs
    ) or "(none)"
    detail_requirement = (
        "- Produce concise English bullets focused on user-visible outcomes or major architectural effects. "
        "Use as many bullets as the diff needs: each bullet must cover one coherent, independently understandable change, "
        "and unrelated changes must remain separate instead of being compressed into one bullet. "
        "Consolidate only changes that naturally belong together. Omit low-level implementation details, "
        "secondary edge cases, and validation unless essential to understand the change."
        if concise
        else "- Produce 3-8 concise but specific English bullets. Explain behavior, important implementation choices, and validation where the diff supports them."
    )
    prompt = f"""Rewrite the DONE section of a GitHub pull request description.

Requirements:
- Analyze the CURRENT FINAL DIFF below. Commit messages are not provided as behavioral evidence. PACKAGE SYNC PROVENANCE contains only structured source metadata extracted from explicit sync commits.
- Describe the net behavior that exists at the current head. If later work replaced earlier work, describe only the final result.
- Treat the existing description only as context. Remove stale, duplicated, chronological, or unsupported claims.
- Preserve provenance for changes merged from another pull request. For EVERY URL in MERGED PR PROVENANCE below, place that exact URL on the bullet describing its final net effect. Use `w.r.t. the PR: <URL>.` when a bullet maps to one PR, and one grouped `w.r.t. the PRs: <URL>, <URL>, <URL>.` suffix when it maps to multiple PRs. Never repeat multiple singular suffixes on one bullet. Do not infer behavior from the titles; titles are attribution metadata only.
{detail_requirement}
- Do not mention file/addition/deletion counts or say merely that files were updated.
- Every bullet must use Markdown bold (`**...**`) for 1-3 important outcomes, mechanisms, or keywords.
- Use Markdown backticks for identifiers and paths, but do not include a leading dash in strings.
- Return JSON only with this exact shape: {schema}
- Algo means application/model behavior under apps/. Infra means reusable implementation under pkgs/. General is for cross-cutting items.
- The file inventory is complete, while patch bodies are representative excerpts. Cover every materially changed scope; for this layout, do not let CI or other changes eclipse substantial `apps/` or `pkgs/` work. If multiple `pkgs/<package>/` groups changed materially, summarize their distinct net effects.
- For EVERY record in PACKAGE SYNC PROVENANCE, emit exactly one Infra string beginning with the exact supplied prefix, then complete its `to ...` clause with a grammatical infinitive verb phrase describing the package's final imported behavior supported by the current diff (for example, `to add ...` or `to integrate ...`; never write `to` followed directly by a noun phrase). Preserve package, branch, and source commit exactly. Do not turn a package sync into a generic feature bullet, and do not duplicate the same imported behavior in another Infra bullet.

PR title: {pr.get('title', '')}

Existing description:
{existing_body[:12000]}

MERGED PR PROVENANCE (exact URLs are mandatory):
{linked_context}

PACKAGE SYNC PROVENANCE (exact Infra prefixes are mandatory):
{sync_context}

CURRENT FINAL DIFF:
{diff_summary_payload(files, special_layout=special_layout)}
"""
    return generate_description_json(
        prompt, lambda value: normalize_and_validate_summary(value, linked_prs, package_syncs)
    )


def generate_description_json(prompt, validate, max_tokens=1800):
    backend = SUMMARIZATION.get("backend", "openrouter")
    api_key = SUMMARIZATION.get("api_key")
    if backend == "copilot_cli":
        last_error = None
        for attempt in range(3):
            try:
                return validate(summarize_with_copilot_cli(prompt))
            except (
                json.JSONDecodeError,
                OSError,
                subprocess.SubprocessError,
                RuntimeError,
                ValueError,
            ) as error:
                last_error = error
                if attempt < 2:
                    time.sleep(attempt + 1)
        raise RuntimeError(f"无法通过 Copilot CLI 重构 PR 描述: {last_error}")
    if backend != "openrouter":
        raise RuntimeError(f"不支持的摘要后端: {backend}")
    if not api_key or str(api_key).startswith("REPLACE_WITH_"):
        raise RuntimeError("OpenRouter 摘要模式缺少 API key")
    payload = json.dumps({
        "model": SUMMARIZATION.get("model", "anthropic/claude-opus-4.6"),
        "messages": [{"role": "user", "content": prompt}],
        "response_format": {"type": "json_object"},
        "max_tokens": max_tokens,
    }).encode()
    last_error = None
    for attempt in range(3):
        req = urllib.request.Request(
            "https://openrouter.ai/api/v1/chat/completions",
            data=payload,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "https://github.com",
                "X-Title": "Kian PR Description Manager",
            },
        )
        try:
            with OPENER.open(req, timeout=120) as response:
                result = json.load(response)
            content = result["choices"][0]["message"]["content"].strip()
            content = re.sub(r"^```(?:json)?\s*|\s*```$", "", content, flags=re.I)
            summary = json.loads(content)
            return validate(summary)
        except urllib.error.HTTPError as error:
            if error.code in (401, 403):
                raise RuntimeError(
                    "摘要服务凭据已失效；为避免低质量本地摘要覆盖现有 desc，已停止更新"
                ) from error
            last_error = error
            if attempt < 2:
                time.sleep(3 * (attempt + 1))
        except (KeyError, TypeError, ValueError, urllib.error.URLError, TimeoutError) as error:
            last_error = error
            if attempt < 2:
                time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"无法根据当前 diff 重构 PR 描述: {last_error}")


def render_rewritten_done(summary, special_layout=False, files=None, repo=None, pr=None):
    def bullets(values):
        return "\n".join(
            f"- {value}" if value.endswith((".", "。")) else f"- {value}."
            for value in values
        )

    if special_layout:
        sections = ["## DONE", ""]
        if files is not None:
            sections.extend([render_change_scope(files, pr), ""])
        sections.extend(["### Algo CodeBreak", ""])
        if summary["algo"]:
            sections.extend([bullets(summary["algo"]), ""])
        sections.extend(["### Infra CodeBreak", ""])
        if summary["infra"]:
            sections.extend([bullets(summary["infra"]), ""])
        if summary["general"]:
            sections.extend([bullets(summary["general"]), ""])
        return "\n".join(sections).rstrip() + "\n"
    values = summary["general"] + summary["algo"] + summary["infra"]
    sections = ["## DONE", ""]
    if files is not None and repo:
        sections.extend([render_standalone_change_scope(files, repo), ""])
    sections.append(bullets(values))
    return "\n".join(sections).rstrip() + "\n"


def replace_done_section(existing_body, rewritten_done):
    marker = re.search(
        r"^##\s+(?:TODO in this PR|TODO in the future|End2End Alignment)\s*$",
        existing_body,
        flags=re.M | re.I,
    )
    suffix = existing_body[marker.start():].lstrip() if marker else ""
    return rewritten_done.rstrip() + ("\n\n" + suffix.rstrip() if suffix else "") + "\n"


def build_incremental_diff_bullets(commits, files):
    """Summarize only changes introduced since the last managed PR head."""
    searchable = (
        "\n".join(item.get("filename", "") for item in files)
        + "\n"
        + "\n".join(item.get("patch") or "" for item in files)
    ).lower()
    bullets = []
    if "_stridedshard" in searchable:
        bullets.append("- Fixed distributed gradient zero-count reduction for strided DTensor shards.")
    if "default-version = \"0.2.2\"" in searchable:
        bullets.append("- Updated the package default version to `0.2.2`.")
    if "test_optimizer_step_func.py" in searchable and "layout_hooks=layout_hooks" in searchable:
        bullets.append("- Fixed the Muon optimizer-step regression test to pass the required layout hooks.")

    covered_terms = ("strided shard", "default version", "layout hooks")
    for item in commits:
        title = commit_title(item)
        if not title or any(term in title.lower() for term in covered_terms):
            continue
        changed = [
            file_item.get("filename", "")
            for file_item in files
            if file_item.get("filename")
        ]
        scope = ", ".join(f"`{name}`" for name in changed[:3])
        bullet = f"- {markdown_inline_format(sentence_from_title(title))}"
        if scope:
            bullet = bullet.rstrip(".") + f" based on the diff in {scope}."
        if bullet not in bullets:
            bullets.append(bullet)
    return bullets


def hydrate_incremental_files(repo, commits, comparison_files):
    """Fill patches omitted by GitHub's compare/files payload from commits."""
    hydrated = list(comparison_files)
    searchable = "\n".join(item.get("patch") or "" for item in hydrated).lower()
    for item in commits:
        title = commit_title(item).lower()
        needs_patch = (
            ("strided shard" in title and "_stridedshard" not in searchable)
            or ("default version" in title and "default-version" not in searchable)
            or ("layout hooks" in title and "layout_hooks=layout_hooks" not in searchable)
        )
        if not needs_patch:
            continue
        sha = item.get("sha", "")
        if not sha:
            continue
        commit_data = request(repo, f"/commits/{sha}")
        commit_files = commit_data.get("files", []) if isinstance(commit_data, dict) else []
        hydrated.extend(file_item for file_item in commit_files if isinstance(file_item, dict))
        searchable += "\n" + "\n".join(file_item.get("patch") or "" for file_item in commit_files).lower()
    return hydrated


def markdown_inline_format(text):
    if not text:
        return text

    placeholders = []

    def protect(pattern, replacement, value):
        def repl(match):
            placeholders.append(match.group(0))
            return f"__MD_PLACEHOLDER_{len(placeholders) - 1}__"

        return re.sub(pattern, repl, value)

    formatted = text
    formatted = protect(r"https?://\S+", "url", formatted)
    formatted = protect(r"`[^`]+`", "code", formatted)
    formatted = protect(r"\[[^\]]+\]\([^\)]+\)", "link", formatted)

    def wrap_pattern(pattern, value):
        def repl(match):
            token = match.group(0)
            if token.startswith("__MD_PLACEHOLDER_"):
                return token
            return f"`{token}`"

        return re.sub(rf"(?<!`){pattern}(?!`)", repl, value)

    formatted = wrap_pattern(r"\b(?:[A-Za-z0-9_.-]+/)+[A-Za-z0-9_.-]+\b", formatted)
    formatted = wrap_pattern(r"\b[A-Za-z0-9_.-]+\.(?:py|ts|tsx|js|mjs|cjs|cpp|cu|cuh|h|hpp|cc|go|rs|java|yaml|yml|json|md)\b", formatted)
    formatted = wrap_pattern(r"\b(?:Dockerfile|dockerfile|Makefile|CMakeLists\.txt|pyproject\.toml|requirements\.txt|setup\.py)\b", formatted)
    formatted = wrap_pattern(r"\b[a-z][a-z0-9]*_[a-z0-9_]*\b", formatted)
    formatted = wrap_pattern(r"\b[a-z]{2,}_[a-z0-9_]*\b", formatted)
    formatted = wrap_pattern(r"\b(?:nvtx|h2d|d2h|allreduce|all-reduce|fp8|bf16|fp16|gpu_burn|cuda|triton|nccl)\b", formatted)

    for index, original in enumerate(placeholders):
        formatted = formatted.replace(f"__MD_PLACEHOLDER_{index}__", original)
    return formatted


def polish_body_markdown(body):
    lines = body.splitlines()
    polished_lines = []
    for line in lines:
        match = re.match(r"^(\s*-)\s+(.*)$", line)
        if not match:
            polished_lines.append(line)
            continue
        prefix, content = match.groups()
        polished_lines.append(f"{prefix} {markdown_inline_format(content)}")
    suffix = "\n" if body.endswith("\n") else ""
    return "\n".join(polished_lines) + suffix


def is_noise_commit_message(title):
    text = (title or "").strip().lower()
    return text.startswith("merge pull request") or text.startswith("revert ")


def commit_covered_by_body(item, body):
    phrase = title_phrase(commit_title(item))
    normalized_phrase = normalize_text(phrase)
    if not normalized_phrase:
        return False
    return normalized_phrase in normalize_text(body)


def summarize_commits(commits):
    phrases = []
    for item in commits:
        raw_title = commit_title(item)
        if is_noise_commit_message(raw_title):
            continue
        phrase = compact_title(raw_title)
        if phrase and phrase not in phrases:
            phrases.append(phrase)
    if not phrases:
        return "Minor fixes."
    if len(phrases) == 1:
        return markdown_inline_format(sentence_from_title(phrases[0]))
    if len(phrases) <= 3:
        return markdown_inline_format(f"Refined the implementation around {', '.join(phrases)}.")
    head = ", ".join(phrases[:3])
    tail = ", etc" if len(phrases) > 3 else ""
    return markdown_inline_format(f"Refined the implementation around {head}{tail}.")


def title_looks_sparse(title):
    text = compact_title(title)
    if not text:
        return True
    words = text.split()
    return len(text) < 24 or len(words) <= 3


def summarize_commit_from_diff(item):
    title = commit_title(item)
    if not title_looks_sparse(title):
        return markdown_inline_format(sentence_from_title(title))
    short_sha = item.get("sha", "")[:7]
    return markdown_inline_format(f"Updated implementation around commit {short_sha}.")


def save_managed(managed, key):
    directory = os.path.dirname(MANAGED_PATH)
    os.makedirs(directory, exist_ok=True)
    with open(f"{MANAGED_PATH}.lock", "a+", encoding="utf-8") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        current = load_json(MANAGED_PATH, {"managed": {}})
        current.setdefault("managed", {})[key] = managed["managed"][key]
        fd, temporary_path = tempfile.mkstemp(prefix="managed-prs-", suffix=".json", dir=directory)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(current, f, ensure_ascii=False, indent=2)
                f.write("\n")
                f.flush()
                os.fsync(f.fileno())
            os.replace(temporary_path, MANAGED_PATH)
        finally:
            if os.path.exists(temporary_path):
                os.unlink(temporary_path)


def append_before_future_sections(body, bullets):
    if not bullets:
        return body
    addition = "\n".join(bullets)
    markers = ["\n## TODO in this PR", "\n## TODO in the future", "\n## End2End Alignment"]
    positions = [body.find(marker) for marker in markers if body.find(marker) >= 0]
    if positions:
        pos = min(positions)
        return body[:pos].rstrip() + "\n" + addition + "\n\n" + body[pos:].lstrip("\n")
    return body.rstrip() + "\n" + addition + "\n"


def insert_magicore_section_bullets(body, section_heading, bullets):
    if not bullets:
        return body
    start = body.find(section_heading)
    if start < 0:
        return append_before_future_sections(body, bullets)
    next_markers = ["### Algo CodeBreak", "### Infra CodeBreak", "## TODO in this PR", "## TODO in the future", "## End2End Alignment"]
    search_from = start + len(section_heading)
    end_candidates = [body.find(marker, search_from) for marker in next_markers if marker != section_heading]
    end_candidates = [position for position in end_candidates if position >= 0]
    end = min(end_candidates) if end_candidates else len(body)
    section = body[start:end].rstrip()
    addition = "\n".join(bullets)
    if section.endswith(section_heading):
        new_section = section + "\n\n" + addition + "\n"
    else:
        new_section = section + "\n" + addition + "\n"
    return body[:start] + new_section + body[end:]


def magicore_section_bucket_from_text(text):
    normalized = (text or "").lower()
    if any(marker in normalized for marker in ("`modeling.py`", "modeling.py", "`apps/", "apps/", "/modeling/", "/models/")):
        return "algo"
    if any(marker in normalized for marker in ("`pkgs/", "pkgs/", "odin", "magi_fsdp", "magi_attention", "magi_moe")):
        return "infra"
    return None


def commit_bullet_for_magicore(item, commit_cache):
    title = commit_title(item)
    if is_noise_commit_message(title):
        return None, None
    title = re.sub(r"\s*\(#\d+\)\s*$", "", title)
    paths = commit_paths(SPECIAL_LAYOUT_REPO, item.get("sha", ""), commit_cache)
    bucket = magicore_bucket_from_paths(paths)
    if bucket is None:
        bucket = magicore_section_bucket_from_text(title)
    if bucket == "algo":
        return f"- {markdown_inline_format(sentence_from_title(title))}", "algo"
    if bucket == "infra":
        return f"- {markdown_inline_format(sentence_from_title(title))}", "infra"
    return f"- {markdown_inline_format(summarize_commit_from_diff(item))}", None


def linked_pr_bullet_for_magicore(repo, linked_number, linked_pr_cache, file_cache):
    linked_pr = request(repo, f"/pulls/{linked_number}")
    title = linked_pr.get("title", "")
    files = pull_request_files(repo, linked_number)
    paths = [item.get("filename", "") for item in files if item.get("filename")]
    bucket = magicore_bucket_from_paths(paths)
    if bucket is None:
        bucket = magicore_section_bucket_from_text(title)
    summary = markdown_inline_format(summarize_magicore_linked_pr(linked_pr, files))
    return f"- {summary}, w.r.t. the PR: {linked_pr.get('html_url', '')}.", bucket


def build_magicore_body(algo_bullets, infra_bullets, general_bullets=None):
    body = "## DONE\n\n### Algo CodeBreak\n\n"
    if algo_bullets:
        body += "\n".join(algo_bullets).rstrip() + "\n\n"
    body += "### Infra CodeBreak\n\n"
    if infra_bullets:
        body += "\n".join(infra_bullets).rstrip() + "\n\n"
    if general_bullets:
        body += "\n".join(general_bullets).rstrip() + "\n\n"
    body += (
        "## TODO in this PR\n\n\n## TODO in the future\n\n\n"
        "## End2End Alignment\n\n### Correctness Alignment with Main\n\n"
        "> deterministic mode | blue line: main | red line: commit\n\n"
        "- **loss**:\n\n- **grad_norm**:\n\n- **num_zeros_in_grad**:\n\n"
        "### Performance Alignment with Main\n\n"
        "> non-deterministic mode | blue line: main | red line: commit\n\n"
        "- **iter_time**:\n"
    )
    return body


def build_initial_body(repo, commits):
    bullets = []
    algo_bullets = []
    infra_bullets = []
    general_bullets = []
    commit_cache = {}
    for item in commits:
        title = item.get("commit", {}).get("message", "").splitlines()[0]
        if is_noise_commit_message(title):
            continue
        title = re.sub(r"\s*\(#\d+\)\s*$", "", title)
        bullet = f"- {markdown_inline_format(sentence_from_title(title))}"
        if bullet in bullets:
            continue
        bullets.append(bullet)
        if repo == SPECIAL_LAYOUT_REPO:
            bucket = magicore_bucket_from_paths(commit_paths(repo, item.get("sha", ""), commit_cache))
            if bucket == "algo":
                algo_bullets.append(bullet)
            elif bucket == "infra":
                infra_bullets.append(bullet)
            else:
                general_bullets.append(bullet)
    if not bullets:
        bullets = ["- Initial implementation."]
    if repo == SPECIAL_LAYOUT_REPO:
        return build_magicore_body(algo_bullets or ["- Initial implementation."], infra_bullets, general_bullets)
    done = "\n".join(bullets)
    return f"## DONE\n\n{done}\n\n## TODO in this PR\n\n\n## TODO in the future\n"


def build_simple_body(commits):
    bullets = []
    for item in commits:
        title = item.get("commit", {}).get("message", "").splitlines()[0]
        if is_noise_commit_message(title):
            continue
        title = re.sub(r"\s*\(#\d+\)\s*$", "", title)
        bullet = f"- {markdown_inline_format(sentence_from_title(title))}"
        if bullet not in bullets:
            bullets.append(bullet)
    if not bullets:
        bullets = ["- Initial implementation."]
    return "## DONE\n\n" + "\n".join(bullets) + "\n"


def expand_to_full_body(repo, body, commits):
    if not body.strip():
        return build_initial_body(repo, commits)
    result = body.rstrip()
    if not re.search(r"^##\s+DONE\s*$", result, re.M | re.I):
        result = "## DONE\n\n" + result
    if repo == SPECIAL_LAYOUT_REPO:
        sections = [
            ("## TODO in this PR", ""),
            ("## TODO in the future", ""),
            (
                "## End2End Alignment",
                "### Correctness Alignment with Main\n\n"
                "> deterministic mode | blue line: main | red line: commit\n\n"
                "- **loss**:\n\n- **grad_norm**:\n\n- **num_zeros_in_grad**:\n\n"
                "### Performance Alignment with Main\n\n"
                "> non-deterministic mode | blue line: main | red line: commit\n\n"
                "- **iter_time**:",
            ),
        ]
    else:
        sections = [("## TODO in this PR", ""), ("## TODO in the future", "")]
    for heading, content in sections:
        if not re.search(rf"^{re.escape(heading)}\s*$", result, re.M | re.I):
            result += f"\n\n{heading}\n"
            if content:
                result += f"\n{content}\n"
    return result.rstrip() + "\n"


def update_append_only_legacy(command, number, requested_repo=None, mode="default"):
    managed = load_json(MANAGED_PATH, {"managed": {}})
    repo, pr = find_pr(number, managed, requested_repo)
    if pr.get("state") != "open":
        raise RuntimeError(f"{repo}#{number} 当前不是开放 PR")
    commits = request(repo, f"/pulls/{number}/commits?per_page=100")
    summarize_from_diff = should_build_from_diff(pr, commits)
    diff_files = pull_request_files(repo, number) if summarize_from_diff else []
    body = pr.get("body") or ""
    original_body = body
    added = []
    if repo == SPECIAL_LAYOUT_REPO:
        repaired_body = repair_legacy_magicore_linked_bullets(body)
        if repaired_body != body:
            body = repaired_body
            added.append("修正了旧版生成器产生的标题复述条目")
    newly_linked_prs = []
    full_structure_was_current = False
    key = f"{repo}#{number}"
    managed_entry = managed.get("managed", {}).get(key, {})
    current_head_sha = pr.get("head", {}).get("sha", "")
    previous_head_sha = managed_entry.get("last_head_sha", "")
    if body.strip():
        managed_entry["last_body_snapshot"] = body
    processed_linked_prs = set(managed_entry.get("processed_linked_prs", []))
    processed_commits = set(managed_entry.get("processed_commits", []))
    if not processed_commits:
        for item in commits:
            sha = item.get("sha", "")
            if sha and commit_covered_by_body(item, body):
                processed_commits.add(sha)
    if summarize_from_diff and command == "up":
        if previous_head_sha and current_head_sha == previous_head_sha:
            return repo, False, "当前同步 PR head 未变化，描述已是最新状态"
        if previous_head_sha and current_head_sha and previous_head_sha != current_head_sha:
            comparison = request(repo, f"/compare/{previous_head_sha}...{current_head_sha}")
            incremental_commits = comparison.get("commits", []) if isinstance(comparison, dict) else []
            incremental_files = comparison.get("files", []) if isinstance(comparison, dict) else []
            incremental_files = hydrate_incremental_files(repo, incremental_commits, incremental_files)
            incremental_bullets = build_incremental_diff_bullets(incremental_commits, incremental_files)
            new_bullets = [bullet for bullet in incremental_bullets if bullet not in body]
            if new_bullets:
                body = append_before_future_sections(body, new_bullets)
                added.append(f"根据增量 diff 归纳了 {len(incremental_commits)} 条新 commits")
            else:
                return repo, False, "检测到新 head，但增量 diff 没有产生新的描述要点"
        else:
            diff_body = build_diff_body(pr, diff_files)
            if body.strip() != diff_body.strip():
                body = diff_body
                added.append("根据最新实际 diff 更新了同步 PR 描述")
            else:
                if current_head_sha and previous_head_sha != current_head_sha:
                    entry = managed.setdefault("managed", {}).setdefault(
                        key, {"added": date.today().isoformat(), "note": pr.get("title", "")}
                    )
                    entry["last_head_sha"] = current_head_sha
                    save_managed(managed, key)
                return repo, False, "当前同步 PR 描述已与最新实际 diff 一致"
    elif command == "desc" and mode == "simple":
        if summarize_from_diff:
            diff_body = build_diff_body(pr, diff_files)
            if body.strip() != diff_body.strip():
                body = diff_body
                added.append("根据实际 diff 生成了简略描述，忽略同步引入的 commit 历史")
        elif body.strip():
            polished = polish_body_markdown(expand_to_full_body(repo, body, commits))
            if polished != body:
                body = polished
                added.append("保留现有 desc，并补齐了结构与 markdown 样式")
        else:
            simple_body = build_simple_body(commits)
            if body.strip() == simple_body.strip():
                return repo, False, "当前已经是最新的简略版描述"
            body = simple_body
            added.append("根据当前 commits 生成了仅含 DONE 的简略版描述")
    elif command == "up" and mode == "full":
        expanded = polish_body_markdown(expand_to_full_body(repo, body, commits))
        if expanded != body:
            body = expanded
            added.append("补齐了完整版描述结构与 markdown 样式")
        else:
            full_structure_was_current = True
    elif command == "desc":
        if body.strip():
            polished = polish_body_markdown(expand_to_full_body(repo, body, commits))
            if polished != body:
                body = polished
                added.append("保留现有 desc，并补齐了结构与 markdown 样式")
        else:
            body = build_initial_body(repo, commits)
            added.append("根据当前 commits 生成了初始描述")
    commit_cache = {}
    linked_pr_cache = {}
    if not summarize_from_diff and not (command == "desc" and mode == "simple"):
        linked_numbers = []
        for linked_number in linked_pr_numbers(commits):
            if linked_number != number and linked_number not in linked_numbers:
                linked_numbers.append(linked_number)
        magicore_algo_bullets = []
        magicore_infra_bullets = []
        magicore_general_bullets = []
        for linked_number in linked_numbers:
            canonical_link = f"https://github.com/{repo}/pull/{linked_number}"
            if canonical_link in body:
                processed_linked_prs.add(linked_number)
                continue
            if linked_number in processed_linked_prs:
                continue
            try:
                if repo == SPECIAL_LAYOUT_REPO:
                    linked_bullet, bucket = linked_pr_bullet_for_magicore(repo, linked_number, linked_pr_cache, commit_cache)
                else:
                    linked_pr = request(repo, f"/pulls/{linked_number}")
                    linked_bullet, bucket = render_linked_bullet(linked_pr), None
            except urllib.error.HTTPError:
                continue
            if repo == SPECIAL_LAYOUT_REPO and bucket in ("algo", "infra"):
                if bucket == "algo":
                    magicore_algo_bullets.append(linked_bullet)
                else:
                    magicore_infra_bullets.append(linked_bullet)
            else:
                body = append_before_future_sections(body, [linked_bullet])
            added.append(f"关联 PR #{linked_number}")
            processed_linked_prs.add(linked_number)
            newly_linked_prs.append(linked_number)
        # Linked PR bullets for magicore are bucketed while scanning so they
        # can be placed in the correct section. Insert them even when there are
        # no ordinary unprocessed commits; previously this insertion only ran
        # inside the unprocessed_commits branch, causing a false UPDATED result
        # while the PR body remained unchanged.
        if repo == SPECIAL_LAYOUT_REPO:
            if magicore_algo_bullets:
                body = insert_magicore_section_bullets(body, "### Algo CodeBreak", magicore_algo_bullets)
            if magicore_infra_bullets:
                body = insert_magicore_section_bullets(body, "### Infra CodeBreak", magicore_infra_bullets)
        unprocessed_commits = []
        for item in commits:
            sha = item.get("sha", "")
            if not sha or sha in processed_commits:
                continue
            if linked_pr_numbers([item]):
                processed_commits.add(sha)
                continue
            unprocessed_commits.append(item)
        if unprocessed_commits:
            if repo == SPECIAL_LAYOUT_REPO:
                for item in unprocessed_commits:
                    bullet, bucket = commit_bullet_for_magicore(item, commit_cache)
                    if not bullet:
                        continue
                    if bucket == "algo":
                        if bullet not in magicore_algo_bullets:
                            magicore_algo_bullets.append(bullet)
                    elif bucket == "infra":
                        if bullet not in magicore_infra_bullets:
                            magicore_infra_bullets.append(bullet)
                    else:
                        if bullet not in magicore_general_bullets:
                            magicore_general_bullets.append(bullet)
                # Linked PR bullets were inserted above. Only insert bullets
                # discovered from ordinary commits here to avoid duplicates.
                commit_algo_bullets = [
                    bullet for bullet in magicore_algo_bullets
                    if bullet not in body
                ]
                commit_infra_bullets = [
                    bullet for bullet in magicore_infra_bullets
                    if bullet not in body
                ]
                if commit_algo_bullets:
                    body = insert_magicore_section_bullets(body, "### Algo CodeBreak", commit_algo_bullets)
                if commit_infra_bullets:
                    body = insert_magicore_section_bullets(body, "### Infra CodeBreak", commit_infra_bullets)
                if magicore_general_bullets:
                    body = append_before_future_sections(body, magicore_general_bullets)
                added.append(f"归纳了 {len(unprocessed_commits)} 条新 commits")
            else:
                summary = summarize_commits(unprocessed_commits)
                bullet = f"- {summary}"
                if bullet not in body:
                    body = append_before_future_sections(body, [bullet])
                    added.append(f"归纳了 {len(unprocessed_commits)} 条新 commits")
            for item in unprocessed_commits:
                sha = item.get("sha", "")
                if sha:
                    processed_commits.add(sha)
    if not added:
        if (
            processed_linked_prs != set(managed_entry.get("processed_linked_prs", []))
            or processed_commits != set(managed_entry.get("processed_commits", []))
        ):
            entry = managed.setdefault("managed", {}).setdefault(
                key, {"added": date.today().isoformat(), "note": pr.get("title", "")}
            )
            entry["processed_linked_prs"] = sorted(processed_linked_prs)
            entry["processed_commits"] = [
                item.get("sha", "")
                for item in commits
                if item.get("sha", "") in processed_commits
            ]
            save_managed(managed, key)
        if command == "up" and mode == "full" and full_structure_was_current:
            return repo, False, "当前描述已是完整版结构，且没有发现尚未写入的关联 PR 更新"
        if command == "desc" and mode == "simple":
            return repo, False, "当前描述已经是最新的简略版"
        return repo, False, "没有发现需要归纳写入 desc 的新关联 PR 或 commits 更新"
    if body == original_body:
        # Never report success or advance state when generation did not alter
        # the actual description. This also lets a later retry recover from a
        # classification/insertion bug instead of silently losing updates.
        return repo, False, "生成结果与 GitHub 当前 desc 相同，未推进处理状态"
    result = request(repo, f"/pulls/{number}", method="PATCH", payload={"body": body})
    if result.get("number") != number:
        raise RuntimeError("GitHub 未返回预期的 PR 更新结果")
    updated_body = result.get("body") or ""
    missing_linked_prs = [
        linked_number
        for linked_number in newly_linked_prs
        if f"https://github.com/{repo}/pull/{linked_number}" not in updated_body
    ]
    if missing_linked_prs:
        missing = "、".join(f"#{linked_number}" for linked_number in missing_linked_prs)
        raise RuntimeError(f"GitHub 返回的 desc 缺少预期关联 PR：{missing}；未推进处理状态")
    entry = managed.setdefault("managed", {}).setdefault(
        key, {"added": date.today().isoformat(), "note": pr.get("title", "")}
    )
    entry["last_body_snapshot"] = updated_body
    if summarize_from_diff and current_head_sha:
        entry["last_head_sha"] = current_head_sha
    entry["processed_linked_prs"] = sorted(processed_linked_prs)
    entry["processed_commits"] = [
        item.get("sha", "")
        for item in commits
        if item.get("sha", "") in processed_commits
    ]
    save_managed(managed, key)
    return repo, True, "、".join(added)


def resolve_description_policy(entry, body):
    policy = entry.get("description_policy", "auto")
    if policy in ("preserve", "rewrite"):
        return policy
    if not body.strip():
        return "rewrite"
    if entry.get("description_effective_mode") == "preserve":
        return "preserve"
    snapshot = entry.get("last_body_snapshot")
    return "rewrite" if snapshot is not None and body == snapshot else "preserve"


def set_description_policy(number, requested_repo, policy):
    with open(STATE_DIR / f"pr-description-{number}.lock", "a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        return _set_description_policy(number, requested_repo, policy)


def _set_description_policy(number, requested_repo, policy):
    if policy not in ("auto", "preserve", "rewrite"):
        raise RuntimeError("描述策略仅支持 auto、preserve 或 rewrite")
    managed = load_json(MANAGED_PATH, {"managed": {}})
    repo, pr = find_pr(number, managed, requested_repo)
    key = f"{repo}#{number}"
    entry = managed.setdefault("managed", {}).setdefault(key, {})
    entry["description_policy"] = policy
    entry.pop("description_effective_mode", None)
    effective = resolve_description_policy(entry, pr.get("body") or "")
    # Explicit preserve adopts the current description/head as its incremental base.
    if policy == "preserve":
        entry["last_head_sha"] = pr["head"]["sha"]
        entry["last_body_snapshot"] = pr.get("body") or ""
        entry["validation_observed_head"] = pr["head"]["sha"]
    entry["description_effective_mode"] = effective
    save_managed(managed, key)
    return repo, False, f"已设置 desc 策略: {policy}（当前 {effective}）；未修改 GitHub 描述"


def editable_description(body):
    # Everything from validation/coverage/future work onward remains byte-for-byte intact.
    protected = re.search(
        r"^#{1,6}\s+.*(?:validat|test|coverage|TODO|End2End|alignment|验证|测试|覆盖|后续|未来).*$",
        body, re.M | re.I,
    )
    return (body[:protected.start()], body[protected.start():]) if protected else (body, "")


def apply_preserved_edits(body, result):
    if not isinstance(result, dict) or set(result) != {"edits", "additions"}:
        raise ValueError("保留模式必须返回 edits 和 additions")
    prefix, protected = editable_description(body)
    if not isinstance(result["edits"], list) or not isinstance(result["additions"], list):
        raise ValueError("保留模式 edits/additions 必须是列表")
    paragraphs = prefix.split("\n\n")
    replacements = {}
    for edit in result["edits"]:
        if not isinstance(edit, dict) or set(edit) != {"old", "new"}:
            raise ValueError("无效的保留模式编辑")
        old, new = edit["old"], edit["new"]
        if (not isinstance(old, str) or not isinstance(new, str) or not old.strip()
                or not new.strip() or old not in paragraphs or prefix.count(old) != 1
                or old in replacements or re.search(r"^\s*[#><|]", old, re.M)
                or re.search(r"^\s*[#><|]", new, re.M) or "\n\n" in new):
            raise ValueError("编辑必须精确匹配唯一内容段落，禁止修改标题、表格或验证记录")
        replacements[old] = new
    prefix = "\n\n".join(replacements.get(part, part) for part in paragraphs)
    for addition in result["additions"]:
        if (not isinstance(addition, str) or not addition.startswith("- ")
                or "\n" in addition or len(addition) > 4000):
            raise ValueError("新增条目必须是单行 Markdown bullet")
    additions = list(dict.fromkeys(item for item in result["additions"] if item not in body))
    if additions:
        separator = "\n" if "### Incremental Updates\n" in prefix else "\n\n### Incremental Updates\n\n"
        prefix = prefix.rstrip() + separator + "\n".join(additions) + "\n\n"
    return prefix + protected


def preserve_description(pr, body, files, baseline, repo):
    if len(body) > 80000:
        raise RuntimeError("现有描述过长，保留模式停止而不截断；请人工整理")
    editable, protected = editable_description(body)
    prompt = f"""Update a human-authored GitHub PR description with minimal, evidence-based edits.
The human description is authoritative for intent, structure, emphasis and reported validation.
Return JSON only: {{"edits":[{{"old":"exact existing paragraph","new":"updated paragraph"}}],"additions":["- New **outcome**."]}}.
- Edit only paragraphs whose claims are changed or invalidated by the supplied diff; otherwise preserve verbatim.
- old must be an exact complete blank-line-separated paragraph in EDITABLE CONTENT. Do not edit headings, tables or blockquotes.
- No stylistic rewrite, translation, compression, deletion, or moving unrelated content. Update superseded behavior in place instead of adding contradictory claims.
- additions are concise English Markdown bullets for genuinely new changes not already covered. Use backticks for identifiers and bold for key outcomes. Do not duplicate existing items.
- Do not infer that any tests were rerun, update test counts, or assert new validation. Protected records are historical evidence, not proof for new commits.
- Preserve provenance URLs. If the diff is already described, return empty edits/additions.
- Change scope statistics are managed separately. Do not produce them.
PR: {repo}#{pr['number']} {pr.get('title', '')}
Diff basis: {baseline or 'no saved baseline; current final PR diff, reconcile conservatively'} -> {pr['head']['sha']}
EDITABLE CONTENT:
{editable}
PROTECTED RECORDS (read-only):
{protected}
DIFF:
{diff_summary_payload(files, special_layout=repo == SPECIAL_LAYOUT_REPO)}
"""
    return generate_description_json(prompt, lambda value: apply_preserved_edits(body, value), max_tokens=6000)


def refresh_change_scope(body, files, repo, pr):
    scope = (render_change_scope(files, pr) if repo == SPECIAL_LAYOUT_REPO
             else render_standalone_change_scope(files, repo) if repo in STANDALONE_SOURCE_DIRS else "")
    if not scope:
        return body
    pattern = r"^> \*\*Change scope:\*\*[^\n]*"
    if re.search(pattern, body, re.M):
        return re.sub(pattern, lambda match: scope, body, count=1, flags=re.M)
    done = re.search(r"^## DONE[^\n]*\n", body, re.M)
    if done:
        return body[:done.end()] + "\n" + scope + "\n" + body[done.end():]
    return scope + "\n\n" + body


def update(command, number, requested_repo=None, mode="default"):
    with open(STATE_DIR / f"pr-description-{number}.lock", "a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        return _update(command, number, requested_repo, mode)


def _update(command, number, requested_repo=None, mode="default"):
    """Update with the remembered policy; explicit rendering modes never override it."""
    managed = load_json(MANAGED_PATH, {"managed": {}})
    repo, pr = find_pr(number, managed, requested_repo)
    if pr.get("state") != "open":
        raise RuntimeError(f"{repo}#{number} 当前不是开放 PR")

    key = f"{repo}#{number}"
    current_body = pr.get("body") or ""
    current_head_sha = pr.get("head", {}).get("sha", "")
    entry = managed.setdefault("managed", {}).setdefault(
        key, {"added": date.today().isoformat(), "note": pr.get("title", "")}
    )
    policy = resolve_description_policy(entry, current_body)
    baseline = entry.get("last_head_sha")
    entry["description_effective_mode"] = policy
    if policy == "preserve" and baseline == current_head_sha:
        entry["last_body_snapshot"] = current_body
        entry.setdefault("validation_observed_head", current_head_sha)
        save_managed(managed, key)
        return repo, False, "保留人工描述；head 未变化，无需重写"
    files = pull_request_files(repo, number)
    if repo == SPECIAL_LAYOUT_REPO:
        try:
            fill_unavailable_pr_file_stats(repo, pr, files)
        except (RuntimeError, urllib.error.URLError, OSError, subprocess.SubprocessError):
            # Rendering the total-only fallback is preferable to failing a
            # description update merely because GitHub withheld one file's
            # patch/blob metadata.
            pass
    commits = request(repo, f"/pulls/{number}/commits?per_page=100")
    linked_prs = []
    for linked_number in linked_pr_numbers(commits):
        if linked_number == number:
            continue
        try:
            linked_prs.append(request(repo, f"/pulls/{linked_number}"))
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise
    if policy == "preserve":
        incremental_files = files
        if baseline:
            comparison = request(repo, f"/compare/{baseline}...{current_head_sha}")
            if comparison.get("status") not in ("ahead", "identical"):
                raise RuntimeError("保留模式基线不再是 head 的祖先；请重新确认基线，未覆盖描述")
            incremental_files = comparison.get("files", [])
            if len(incremental_files) >= 300:
                raise RuntimeError("GitHub 增量 diff 可能超过 300 文件限制；未覆盖人工描述")
        body = preserve_description(pr, current_body, incremental_files, baseline, repo)
        body = refresh_change_scope(body, files, repo, pr)
        observed = entry.setdefault("validation_observed_head", baseline or current_head_sha)
        if observed != current_head_sha and "<!-- kian:validation-observed " not in body:
            prefix, protected = editable_description(body)
            if protected:
                note = (f"<!-- kian:validation-observed {observed} -->\n"
                        f"> **Validation provenance:** The records below were retained from the description "
                        f"observed at `{observed[:12]}`; they do not establish validation of later commits.\n\n")
                body = prefix.rstrip() + "\n\n" + note + protected
    else:
        summary = summarize_current_diff(
            pr,
            files,
            current_body,
            repo == SPECIAL_LAYOUT_REPO,
            linked_prs,
            mode != "full",
            package_syncs=(
                apply_package_sync_overrides(package_sync_records(commits), repo)
                if repo == SPECIAL_LAYOUT_REPO
                else []
            ),
        )
        rewritten_done = render_rewritten_done(
            summary, repo == SPECIAL_LAYOUT_REPO, files=files, repo=repo, pr=pr
        )
        body = rewritten_done if mode == "simple" else replace_done_section(current_body, rewritten_done)
        if mode == "full":
            body = expand_to_full_body(repo, body, commits)
    expected_links = [item.get("html_url", "") for item in linked_prs if item.get("html_url")]
    missing_links = [url for url in expected_links if url not in body]
    if missing_links and policy == "rewrite":
        raise RuntimeError(
            f"整体重构遗漏了关联 PR 来源: {', '.join(missing_links)}；未更新 GitHub"
        )

    entry = managed.setdefault("managed", {}).setdefault(
        key, {"added": date.today().isoformat(), "note": pr.get("title", "")}
    )
    if body.strip() == current_body.strip():
        entry["last_head_sha"] = current_head_sha
        entry["last_body_snapshot"] = current_body
        save_managed(managed, key)
        return repo, False, "当前 desc 已与最新最终 diff 一致"

    latest = request(repo, f"/pulls/{number}")
    if (latest.get("body") or "") != current_body or latest.get("head", {}).get("sha") != current_head_sha:
        raise RuntimeError("生成期间 PR 描述或 head 已变化；未覆盖，请重试")
    result = request(repo, f"/pulls/{number}", method="PATCH", payload={"body": body})
    if result.get("number") != number:
        raise RuntimeError("GitHub 未返回预期的 PR 更新结果")
    updated_body = result.get("body") or ""
    if updated_body.strip() != body.strip():
        raise RuntimeError("GitHub 返回的 desc 与整体重构结果不一致；未推进处理状态")
    entry["last_head_sha"] = current_head_sha
    entry["last_body_snapshot"] = updated_body
    entry["processed_linked_prs"] = sorted(
        item.get("number") for item in linked_prs if item.get("number")
    )
    entry["processed_commits"] = [item.get("sha", "") for item in commits if item.get("sha")]
    save_managed(managed, key)
    return repo, True, ("已保留人工描述并按增量 diff 更新相关条目" if policy == "preserve" else
                        "已基于当前最终 diff 整体重构 desc；仅将显式 sync commit 用作来源元数据")


def main():
    if len(sys.argv) not in (2, 3, 4):
        raise RuntimeError("用法: pr_desc_manager.py desc123|up123 [owner/repo] [default|simple|full] 或 policy123 owner/repo auto|preserve|rewrite")
    match = re.fullmatch(r"(desc|up|policy)(\d+)", sys.argv[1].strip(), re.I)
    if not match:
        raise RuntimeError("仅支持 desc<PR号>、up<PR号> 或 policy<PR号>")
    command, raw_number = match.groups()
    requested_repo = sys.argv[2].strip() if len(sys.argv) == 3 else None
    if len(sys.argv) == 4:
        requested_repo = sys.argv[2].strip()
        mode = sys.argv[3].strip().lower()
    else:
        mode = "default"
    if command.lower() == "policy":
        repo, changed, details = set_description_policy(int(raw_number), requested_repo, mode)
        print(json.dumps({"status": "NO_CHANGE", "repo": repo, "number": int(raw_number), "details": details}, ensure_ascii=False))
        return
    if mode not in ("default", "simple", "full"):
        raise RuntimeError("描述模式仅支持 default、simple 或 full")
    repo, changed, details = update(command.lower(), int(raw_number), requested_repo, mode)
    status = "UPDATED" if changed else "NO_CHANGE"
    print(json.dumps({"status": status, "repo": repo, "number": int(raw_number), "details": details}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"status": "ERROR", "error": str(error)}, ensure_ascii=False))
        sys.exit(1)
