import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

import public_repo_monitor as monitor  # noqa: E402


class PublicRepoMonitorRulesTest(unittest.TestCase):
    def test_security_signal_is_always_high_importance(self):
        score, reasons = monitor.importance({
            "title": "Fix remote code execution vulnerability",
            "body": "CVE pending",
            "labels": [],
        }, "issue")
        self.assertGreaterEqual(score, 8)
        self.assertIn("Security", reasons)

    def test_draft_pr_is_penalized(self):
        base = {
            "title": "Optimize CUDA kernel performance",
            "body": "",
            "labels": [],
        }
        normal_score, _ = monitor.importance(base, "pr")
        draft_score, _ = monitor.importance(dict(base, draft=True), "pr")
        self.assertEqual(draft_score, normal_score - 2)

    def test_repository_level_controls_threshold(self):
        self.assertEqual(monitor.threshold({"level": "detailed"}, "pr"), 4)
        self.assertEqual(monitor.threshold({"level": "balanced"}, "pr"), 8)
        self.assertIsNone(monitor.threshold({"level": "essential"}, "pr"))
        self.assertEqual(monitor.threshold({
            "level": "essential", "thresholds": {"pr": 9}
        }, "pr"), 9)

    def test_megatron_can_override_default_integration_branch(self):
        branches = monitor.integration_branches(
            {"integration_branches": ["dev"]},
            {"default_branch": "main"},
        )
        self.assertEqual(branches, ["dev"])

    def test_merge_to_integration_branch_is_always_reported(self):
        block = monitor.pr_outcome_block({
            "number": 42,
            "title": "Routine maintenance",
            "merged_at": "2026-10-20T01:00:00Z",
            "base": {"ref": "main"},
            "html_url": "https://example/pr/42",
        }, ["main"], watched_early=False)
        self.assertIn("合入主开发分支", block)

    def test_unimportant_unmerged_close_is_silent(self):
        block = monitor.pr_outcome_block({
            "number": 42,
            "title": "Routine maintenance",
            "merged_at": None,
            "base": {"ref": "feature"},
            "html_url": "https://example/pr/42",
        }, ["main"], watched_early=False)
        self.assertEqual(block, "")

    def test_custom_text_filter_excludes_amd_and_xpu_work(self):
        config = {
            "exclude": {
                "text_patterns": [r"\b(?:amd|rocm|hip|xpu)\b"],
            },
        }
        excluded, reason = monitor.custom_exclusion(config, {
            "title": "[AMD] Compute the HIP pointer-range bit natively",
            "body": "",
            "labels": [],
        })
        self.assertTrue(excluded)
        self.assertTrue(reason.startswith("text:"))

    def test_path_filter_defaults_to_all_files(self):
        config = {"exclude": {"path_patterns": [r"(^|/)xpu(/|$)"]}}
        item = {"title": "Refactor backend", "body": "", "labels": []}
        excluded, _ = monitor.custom_exclusion(
            config, item, ["torch/xpu/device.py", "test/xpu/test_device.py"]
        )
        self.assertTrue(excluded)
        excluded, _ = monitor.custom_exclusion(
            config, item, ["torch/xpu/device.py", "torch/core.py"]
        )
        self.assertFalse(excluded)

    def test_title_filter_ignores_backend_mentioned_only_in_body(self):
        config = {"exclude": {"title_patterns": [r"\b(?:rocm|hip|xpu)\b"]}}
        excluded, _ = monitor.custom_exclusion(config, {
            "title": "[FSDP2] Separate collective copy preparation from execution",
            "body": "ROCm TransformerEngine is one compatibility scenario.",
            "labels": [],
        })
        self.assertFalse(excluded)

    def test_ghstack_inventory_is_removed_from_summary_input(self):
        body = "Useful explanation.\n\nStack from ghstack:\n* #123\n* #124"
        self.assertEqual(monitor.summary_body(body), "Useful explanation.")

    def test_card_adds_chinese_summary_for_each_event(self):
        blocks = [{
            "markdown": "**PR #1**\n\nTitle\n\n@@KIAN_CHINESE_SUMMARY@@\n\n🏷️ **Signals:** Performance",
            "summary_key": "pr:1",
            "summary_kind": "pr",
            "title": "Optimize matmul",
            "body": "Improve CUDA performance",
        }]
        with patch.object(
            monitor, "copilot_chinese_summaries", return_value={"pr:1": "优化 CUDA 矩阵乘性能。"}
        ):
            rendered = monitor.add_chinese_summaries(blocks)
        self.assertIn("中文摘要", rendered[0])
        self.assertIn("优化 CUDA 矩阵乘性能", rendered[0])
        self.assertNotIn("@@KIAN_CHINESE_SUMMARY@@", rendered[0])
        self.assertLess(rendered[0].index("Title"), rendered[0].index("中文摘要"))
        self.assertLess(rendered[0].index("中文摘要"), rendered[0].index("Signals"))

    def test_open_pr_event_exposes_pin_action(self):
        block = monitor.event_block("body", {
            "number": 123, "state": "open", "title": "Important change",
        }, "pr", 123, repo="owner/repo")
        self.assertEqual(block["pin"], {
            "repo": "owner/repo", "number": 123, "kind": "pr",
        })
        with patch.object(monitor, "load_pin", return_value={}):
            actions = monitor.pin_actions([block, block])
        self.assertEqual(len(actions), 1)
        self.assertEqual(actions[0]["value"]["action"], "pin_public_item")
        self.assertEqual(actions[0]["value"]["kind"], "pr")

    def test_open_issue_event_exposes_pin_action(self):
        block = monitor.event_block("body", {
            "number": 321, "state": "open", "title": "Important bug",
        }, "issue", 321, repo="owner/repo")
        self.assertEqual(block["pin"], {
            "repo": "owner/repo", "number": 321, "kind": "issue",
        })
        with patch.object(monitor, "load_pin", return_value={}):
            actions = monitor.pin_actions([block])
        self.assertEqual(actions[0]["value"]["kind"], "issue")

    def test_signals_merge_reasons_and_labels_without_inline_code(self):
        line = monitor.rendered_signals({
            "labels": [
                {"name": "needs reproduction"}, {"name": "module: crash"},
                {"name": "module: cuda"}, {"name": "triaged"},
            ],
        }, ["Correctness / regression", "Bug / crash"], pinned=True)
        self.assertEqual(
            line,
            "🏷️ **Signals:** pinned · Correctness / regression · Bug / crash · "
            "needs reproduction · module: crash · module: cuda · triaged",
        )
        self.assertNotIn("`", line)
        self.assertNotIn("标签", line)

    def test_card_header_uses_plain_english_metadata(self):
        blocks = [{
            "markdown": "body",
            "summary_key": "pr:1",
            "summary_kind": "pr",
            "title": "Change",
            "body": "Details",
        }]
        with patch.object(monitor, "add_chinese_summaries", return_value=["body"]):
            rendered = monitor.render_card(
                {"repo": "owner/repo", "level": "detailed"},
                {"integration_branches": ["main"]}, blocks,
            )
        self.assertTrue(rendered.startswith(
            "📦 **owner/repo** · Watch level: Detailed · Integration: main"
        ))
        self.assertNotIn("`detailed`", rendered)
        self.assertNotIn("监控级别", rendered)

    def test_pinned_update_and_outcome_show_synthetic_label(self):
        pr = {
            "number": 123, "title": "Important change", "labels": [],
            "html_url": "https://example/pr/123", "base": {"ref": "main"},
            "merged_at": "2026-10-20T01:00:00Z",
        }
        self.assertIn("🏷️ **Signals:** pinned", monitor.pinned_update_block(pr, ["new commit"]))
        self.assertIn("🏷️ **Signals:** pinned", monitor.pr_outcome_block(
            pr, ["main"], watched_early=True, pinned=True,
        ))

    def test_new_commit_messages_start_after_previous_head(self):
        commits = [
            {"sha": "old", "commit": {"message": "old subject\nbody"}},
            {"sha": "new-1", "commit": {"message": "first new subject"}},
            {"sha": "new-2", "commit": {"message": "second new subject"}},
        ]
        with patch.object(monitor, "github_get", return_value=commits):
            messages, force_pushed = monitor.new_pr_commit_messages("owner/repo", 123, "old")
        self.assertEqual(messages, ["first new subject", "second new subject"])
        self.assertFalse(force_pushed)

    def test_pin_state_can_be_completed_without_deleting_history(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(
            monitor, "PINS_DIR", Path(directory),
        ):
            target = monitor.pin_path("owner/repo", 123)
            target.parent.mkdir(parents=True)
            target.write_text('{"active": true}\n', encoding="utf-8")
            monitor.deactivate_pin("owner/repo", 123, "merged")
            state = monitor.load_pin("owner/repo", 123)
        self.assertFalse(state["active"])
        self.assertEqual(state["outcome"], "merged")
        self.assertIn("completed_at", state)

    def test_pinned_pr_head_change_creates_follow_up_even_below_threshold(self):
        responses = {
            "": {"default_branch": "main"},
            "/releases": [],
            "/pulls:closed": [],
            "/pulls:open": [{
                "number": 123, "title": "Routine change", "body": "", "labels": [],
                "state": "open", "updated_at": "2026-10-20T01:00:00Z",
                "head": {"sha": "new"}, "html_url": "https://example/pr/123",
            }],
            "/issues": [],
            "/pulls/123/commits": [
                {"sha": "old", "commit": {"message": "old"}},
                {"sha": "new", "commit": {"message": "new commit"}},
            ],
        }

        def fake_get(_repo, path, params=None):
            if path == "/pulls":
                return responses["/pulls:" + params["state"]]
            return responses[path]

        prior = {
            "last_check": "2026-10-20T00:00:00Z",
            "signals": {"pr:123": {
                "notified": True, "head_sha": "old", "updated_at": "2026-10-19T00:00:00Z",
            }},
        }
        with patch.object(monitor, "github_get", side_effect=fake_get), patch.object(
            monitor, "load_pin", return_value={"active": True},
        ):
            blocks, state = monitor.collect_repo(
                {"repo": "owner/repo", "level": "essential"}, prior,
                "2026-10-20T02:00:00Z",
            )
        self.assertEqual(len(blocks), 1)
        self.assertIn("已关注 PR 更新", blocks[0]["markdown"])
        self.assertIn("🏷️ **Signals:** pinned", blocks[0]["markdown"])
        self.assertEqual(state["signals"]["pr:123"]["head_sha"], "new")

    def test_pinned_issue_comment_creates_follow_up_even_below_threshold(self):
        issue = {
            "number": 321, "title": "Routine issue", "body": "Initial report",
            "labels": [], "comments": 2, "state": "open",
            "updated_at": "2026-10-20T01:00:00Z", "html_url": "https://example/issue/321",
        }
        responses = {
            "": {"default_branch": "main"}, "/releases": [],
            "/pulls:closed": [], "/pulls:open": [], "/issues": [issue],
            "/issues/321/comments": [{"body": "I reproduced this on H100."}],
        }

        def fake_get(_repo, path, params=None):
            if path == "/pulls":
                return responses["/pulls:" + params["state"]]
            return responses[path]

        prior = {
            "last_check": "2026-10-20T00:00:00Z",
            "signals": {"issue:321": {
                "notified": True, "state": "open", "comments": 1,
                "title": "Routine issue", "labels": [],
                "body_digest": monitor.hashlib.sha256(b"Initial report").hexdigest(),
                "updated_at": "2026-10-19T00:00:00Z",
            }},
        }
        with patch.object(monitor, "github_get", side_effect=fake_get), patch.object(
            monitor, "load_pin", return_value={"active": True, "kind": "issue"},
        ):
            blocks, state = monitor.collect_repo(
                {"repo": "owner/repo", "level": "essential"}, prior,
                "2026-10-20T02:00:00Z",
            )
        self.assertEqual(len(blocks), 1)
        self.assertIn("已关注 Issue 更新", blocks[0]["markdown"])
        self.assertIn("1 条新评论", blocks[0]["markdown"])
        self.assertIn("🏷️ **Signals:** pinned", blocks[0]["markdown"])
        self.assertIn("reproduced", blocks[0]["body"])
        self.assertEqual(state["signals"]["issue:321"]["comments"], 2)

    def test_bootstrap_builds_baseline_without_notifications(self):
        responses = {
            "": {"default_branch": "main"},
            "/releases": [{
                "published_at": "2026-10-19T00:00:00Z", "tag_name": "v1", "draft": False,
            }],
            "/pulls:closed": [],
            "/pulls:open": [{
                "number": 1, "title": "Critical security fix", "body": "", "labels": [],
                "state": "open", "updated_at": "2026-10-19T01:00:00Z",
            }],
            "/issues": [],
        }

        def fake_get(_repo, path, params=None):
            if path == "/pulls":
                return responses["/pulls:" + params["state"]]
            return responses[path]

        with patch.object(monitor, "github_get", side_effect=fake_get):
            blocks, state = monitor.collect_repo(
                {"repo": "owner/repo", "level": "detailed"}, {},
                "2026-10-20T00:00:00Z", bootstrap=True,
            )
        self.assertEqual(blocks, [])
        self.assertIn("pr:1", state["signals"])
        self.assertFalse(state["signals"]["pr:1"]["notified"])


if __name__ == "__main__":
    unittest.main()
