import sys
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
        self.assertIn("安全", reasons)

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
        self.assertEqual(monitor.threshold({"level": "balanced"}, "pr"), 7)
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
