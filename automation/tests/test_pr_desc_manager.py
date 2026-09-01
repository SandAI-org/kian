import importlib.util
import os
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest import mock


SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPT_DIR))
os.environ.setdefault("KIAN_AUTOMATION_HOME", tempfile.mkdtemp())
config_path = Path(os.environ["KIAN_AUTOMATION_HOME"]) / "config" / "config.json"
config_path.parent.mkdir(parents=True, exist_ok=True)
config_path.write_text('{"github":{"tokens":{},"repos":[]}}')
spec = importlib.util.spec_from_file_location("pr_desc_manager", SCRIPT_DIR / "pr_desc_manager.py")
manager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(manager)


class PrDescriptionRewriteTest(unittest.TestCase):
    def test_diff_payload_contains_only_final_file_diff(self):
        files = [{"filename": "src/a.py", "status": "modified", "additions": 1, "deletions": 1, "patch": "+final = True"}]
        payload = manager.diff_summary_payload(files)
        self.assertIn("+final = True", payload)
        self.assertNotIn("commit message", payload.lower())

    def test_replaces_entire_done_and_preserves_future_sections(self):
        body = "## DONE\n\n- Old implementation.\n- Another stale commit.\n\n## TODO in this PR\n\n- Keep this.\n"
        rewritten = "## DONE\n\n- Final net behavior.\n"
        result = manager.replace_done_section(body, rewritten)
        self.assertNotIn("Old implementation", result)
        self.assertNotIn("stale commit", result)
        self.assertIn("Final net behavior", result)
        self.assertIn("- Keep this.", result)

    def test_special_layout_renders_coherent_sections(self):
        summary = {"algo": ["Added **final behavior**"], "infra": ["Hardened **writer synchronization**"], "general": []}
        result = manager.render_rewritten_done(summary, special_layout=True)
        self.assertIn("### Algo CodeBreak", result)
        self.assertIn("### Infra CodeBreak", result)
        self.assertEqual(result.count("Added **final behavior**"), 1)

    def test_invalid_summary_credentials_fail_immediately_without_overwrite(self):
        error = urllib.error.HTTPError(
            "https://openrouter.ai/api/v1/chat/completions",
            401,
            "Unauthorized",
            {},
            None,
        )
        with mock.patch.object(manager, "SUMMARIZATION", {"api_key": "invalid", "model": "test"}), mock.patch.object(
            manager.OPENER, "open", side_effect=error
        ) as open_request:
            with self.assertRaisesRegex(RuntimeError, "摘要服务凭据已失效"):
                manager.summarize_current_diff(
                    {"title": "Test"},
                    [{"filename": "src/a.py", "patch": "+value = True"}],
                    "## DONE\n\n- Existing high-quality description.\n",
                )
        self.assertEqual(open_request.call_count, 1)

    def test_copilot_cli_backend_uses_oauth_login_without_api_key(self):
        response = '{"algo":[],"infra":[],"general":["Added **final behavior**"]}'
        completed = mock.Mock(returncode=0, stdout=response, stderr="")
        with mock.patch.object(
            manager,
            "SUMMARIZATION",
            {"backend": "copilot_cli", "command": "/usr/local/bin/copilot", "model": "auto"},
        ), mock.patch.object(manager.os.path, "isfile", return_value=True), mock.patch.object(
            manager.subprocess, "run", return_value=completed
        ) as run:
            summary = manager.summarize_current_diff(
                {"title": "Test"},
                [{"filename": "src/a.py", "patch": "+value = True"}],
                "## DONE\n",
            )
        self.assertEqual(summary["general"], ["Added **final behavior**"])
        self.assertIn("--available-tools=", run.call_args.args[0])
        self.assertNotIn("api_key", manager.SUMMARIZATION)

    def test_copilot_cli_adds_missing_markdown_emphasis(self):
        response = mock.Mock(
            returncode=0,
            stdout='{"algo":[],"infra":[],"general":["Missing bold"]}',
            stderr="",
        )
        with mock.patch.object(
            manager,
            "SUMMARIZATION",
            {"backend": "copilot_cli", "command": "/usr/local/bin/copilot", "model": "auto"},
        ), mock.patch.object(manager.os.path, "isfile", return_value=True), mock.patch.object(
            manager.subprocess, "run", return_value=response
        ) as run, mock.patch.object(manager.time, "sleep"):
            summary = manager.summarize_current_diff(
                {"title": "Test"},
                [{"filename": "src/a.py", "patch": "+value = True"}],
                "## DONE\n",
            )
        self.assertEqual(summary["general"], ["**Missing bold**"])
        self.assertEqual(run.call_count, 1)

    def test_simple_mode_requests_short_outcome_focused_summary(self):
        response = mock.Mock(
            returncode=0,
            stdout='{"algo":[],"infra":[],"general":["Added **final behavior**"]}',
            stderr="",
        )
        with mock.patch.object(
            manager,
            "SUMMARIZATION",
            {"backend": "copilot_cli", "command": "/usr/local/bin/copilot", "model": "auto"},
        ), mock.patch.object(manager.os.path, "isfile", return_value=True), mock.patch.object(
            manager.subprocess, "run", return_value=response
        ) as run:
            manager.summarize_current_diff(
                {"title": "Test"},
                [{"filename": "src/a.py", "patch": "+value = True"}],
                "## DONE\n",
                concise=True,
            )
        prompt = run.call_args.args[0][2]
        self.assertIn("Produce 2-4 short English bullets", prompt)
        self.assertIn("Omit low-level implementation details", prompt)

    def test_linked_pr_numbers_support_squash_and_merge_commits(self):
        commits = [
            {"commit": {"message": "feat: add final behavior (#123)\n\nDetails"}},
            {"commit": {"message": "Merge pull request #456 from topic"}},
        ]
        self.assertEqual(manager.linked_pr_numbers(commits), [123, 456])

    def test_summary_rejects_missing_linked_pr_provenance(self):
        response = mock.MagicMock()
        response.__enter__.return_value = response
        response.__exit__.return_value = False
        response_data = {
            "choices": [{"message": {"content": '{"algo":[],"infra":[],"general":["Added **final behavior**"]}'}}]
        }
        response.read.return_value = __import__("json").dumps(response_data).encode()
        with mock.patch.object(manager, "SUMMARIZATION", {"api_key": "valid", "model": "test"}), mock.patch.object(
            manager.OPENER, "open", return_value=response
        ):
            with self.assertRaisesRegex(RuntimeError, "遗漏了关联 PR 来源"):
                manager.summarize_current_diff(
                    {"title": "Test"},
                    [{"filename": "src/a.py", "patch": "+value = True"}],
                    "## DONE\n",
                    linked_prs=[{"html_url": "https://github.com/example/repo/pull/123", "title": "Metadata only"}],
                )

    def test_summary_rejects_repeated_singular_suffixes_for_multiple_prs(self):
        content = (
            '{"algo":[],"infra":[],"general":['
            '"Added **final behavior**, w.r.t. the PR: https://github.com/example/repo/pull/123. '
            'w.r.t. the PR: https://github.com/example/repo/pull/456."'
            ']}'
        )
        response = mock.MagicMock()
        response.__enter__.return_value = response
        response.__exit__.return_value = False
        response_data = {"choices": [{"message": {"content": content}}]}
        response.read.return_value = __import__("json").dumps(response_data).encode()
        linked_prs = [
            {"html_url": "https://github.com/example/repo/pull/123", "title": "One"},
            {"html_url": "https://github.com/example/repo/pull/456", "title": "Two"},
        ]
        with mock.patch.object(manager, "SUMMARIZATION", {"api_key": "valid", "model": "test"}), mock.patch.object(
            manager.OPENER, "open", return_value=response
        ):
            with self.assertRaisesRegex(RuntimeError, "w.r.t. the PRs"):
                manager.summarize_current_diff(
                    {"title": "Test"},
                    [{"filename": "src/a.py", "patch": "+value = True"}],
                    "## DONE\n",
                    linked_prs=linked_prs,
                )


if __name__ == "__main__":
    unittest.main()