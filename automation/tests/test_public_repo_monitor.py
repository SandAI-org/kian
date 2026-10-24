import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

import public_repo_monitor as monitor  # noqa: E402


class PublicRepoMonitorRulesTest(unittest.TestCase):
    def test_html_blog_discovery_deduplicates_and_excludes_navigation(self):
        source = {"index_url": "https://example.test/research", "link_pattern": r"^/research/[^/]+$"}
        document = '''<a href="/research/new"><img></a>
        <a href="/research/new"><strong>New &amp; useful</strong></a>
        <a href="/research/new?tracking=1">Duplicate</a>
        <a href="/research/team/alignment">Team</a>
        <a href="https://evil.test/research/article">Other site</a>'''
        with patch.object(monitor, "web_page_get", return_value=document):
            posts = monitor.discover_blog_posts(source)
        self.assertEqual(len(posts), 1)
        self.assertEqual(posts[0]["title"], "New & useful")
        self.assertEqual(posts[0]["link"], "https://example.test/research/new")
        with patch.object(monitor, "web_page_get", return_value="<p>layout changed</p>"):
            with self.assertRaisesRegex(RuntimeError, "no matching articles"):
                monitor.discover_blog_posts(source)

    def test_independent_blog_baseline_and_new_article_context(self):
        source = {"id": "research", "name": "Research", "index_url": "https://example.test/research", "link_pattern": r"^/research/[^/]+$"}
        post = {"id": "new", "title": "New", "link": "https://example.test/research/new"}
        with patch.object(monitor, "discover_blog_posts", return_value=[post]), patch.object(
            monitor, "web_page_get", return_value="<main>Full article context</main>",
        ) as fetch, patch.object(monitor, "github_get") as github:
            config, blocks, baseline = monitor.collect_source(source, {}, "first")
            self.assertEqual(blocks, [])
            fetch.assert_not_called()
            previous = {"blog_feeds": {source["index_url"]: {"seen": ["old"]}}}
            _, blocks, _ = monitor.collect_source(source, previous, "next")
            self.assertEqual(blocks[0]["body"], "Full article context")
            self.assertEqual(config["repo"], "source:research")
            github.assert_not_called()

    def test_source_only_run_queues_and_preserves_delivery_failure(self):
        source = {"id": "research", "name": "Research", "feed_url": "https://example.test/feed"}
        state = {"sources": {"research": {"last_check": "old"}}}
        config = dict(source, repo="source:research")
        block = {"title": "Article", "body": "Context", "markdown": "Article", "summary_kind": "blog", "summary_key": "blog:1"}
        with tempfile.TemporaryDirectory() as directory, patch.object(
            monitor, "LOCK_FILE", Path(directory) / "watch.lock",
        ), patch.object(monitor, "configure"), patch.object(
            monitor, "WATCH", {"sources": [source]},
        ), patch.object(monitor, "load_state", return_value=state), patch.object(
            monitor, "save_state",
        ), patch.object(monitor, "collect_source", return_value=(config, [block], {"last_check": "new"})), patch.object(
            monitor, "add_chinese_summaries", return_value=["中文摘要"],
        ), patch.object(monitor, "in_quiet_hours", return_value=False), patch.object(
            monitor, "send_card", side_effect=RuntimeError("offline"),
        ) as sender, patch.object(monitor, "github_get") as github:
            monitor.run()
        github.assert_not_called()
        self.assertEqual(sender.call_args.args[0], "🌐 开源仓库与研究博客实时更新")
        self.assertIn("Research blog", sender.call_args.args[1])
        self.assertNotIn("Integration:", sender.call_args.args[1])
        self.assertEqual(len(monitor.pending_events(state["pending_notifications"])), 1)
        self.assertEqual(state["sources"]["research"]["last_check"], "new")

    def test_feed_get_parses_rss_posts_and_strips_html(self):
        payload = b"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel><item><title>TorchComms update</title>
    <link>https://example.test/blog/torchcomms/</link>
    <guid>post-123</guid><pubDate>Thu, 22 Oct 2026 10:00:00 +0000</pubDate>
    <dc:creator>PyTorch Team</dc:creator>
    <description><![CDATA[<p>New <strong>fault tolerance</strong> support.</p>]]></description>
  </item></channel>
</rss>"""
        response = MagicMock()
        response.read.return_value = payload
        response.__enter__.return_value = response
        with patch.object(monitor.OPENER, "open", return_value=response):
            posts = monitor.feed_get("https://example.test/feed/")
        self.assertEqual(posts[0]["id"], "post-123")
        self.assertEqual(posts[0]["author"], "PyTorch Team")
        self.assertEqual(posts[0]["body"], "New fault tolerance support.")

    def test_new_blog_feed_builds_baseline_without_replaying_posts(self):
        posts = [{
            "id": "old-post", "title": "Existing post",
            "link": "https://example.test/blog/old", "body": "Existing",
            "author": "", "published": "",
        }]
        config = {
            "repo": "owner/repo",
            "blogs": [{"name": "Project Blog", "feed_url": "https://example.test/feed/"}],
        }
        with patch.object(monitor, "feed_get", return_value=posts):
            blocks, state = monitor.collect_blog_posts(config, {})
        self.assertEqual(blocks, [])
        self.assertEqual(
            state["https://example.test/feed/"]["seen"], ["old-post"],
        )

    def test_new_blog_post_is_grouped_as_blog_event(self):
        posts = [
            {
                "id": "new-post", "title": "Modern NCCL backend",
                "link": "https://example.test/blog/new", "body": "A new backend.",
                "author": "PyTorch Team", "published": "",
            },
            {
                "id": "old-post", "title": "Existing post",
                "link": "https://example.test/blog/old", "body": "Existing",
                "author": "", "published": "",
            },
        ]
        feed_url = "https://example.test/feed/"
        config = {
            "repo": "owner/repo",
            "blogs": [{"name": "Project Blog", "feed_url": feed_url}],
        }
        previous = {"blog_feeds": {feed_url: {"seen": ["old-post"]}}}
        with patch.object(monitor, "feed_get", return_value=posts):
            blocks, state = monitor.collect_blog_posts(config, previous)
        self.assertEqual(len(blocks), 1)
        self.assertEqual(blocks[0]["summary_kind"], "blog")
        self.assertIn("Project Blog 新文章", blocks[0]["markdown"])
        self.assertIn("Modern NCCL backend", blocks[0]["markdown"])
        self.assertEqual(state[feed_url]["seen"][:2], ["new-post", "old-post"])

    def test_blog_post_honors_repository_title_exclusion(self):
        post = {
            "id": "amd-post", "title": "Accelerating PyTorch on AMD GPUs",
            "link": "https://example.test/blog/amd", "body": "FlyDSL details.",
            "author": "", "published": "",
        }
        feed_url = "https://example.test/feed/"
        config = {
            "repo": "pytorch/pytorch",
            "blogs": [{"name": "PyTorch Blog", "feed_url": feed_url}],
            "exclude": {"title_patterns": [r"\bamd\b"]},
        }
        previous = {"blog_feeds": {feed_url: {"seen": ["old-post"]}}}
        with patch.object(monitor, "feed_get", return_value=[post]):
            blocks, state = monitor.collect_blog_posts(config, previous)
        self.assertEqual(blocks, [])
        self.assertEqual(state[feed_url]["seen"][0], "amd-post")

    def test_discovers_versioned_release_links_from_html_index(self):
        source = {
            "index_url": "https://docs.example.test/releases/index.html",
            "link_pattern": r"rel-(?P<version>[0-9]{2}-[0-9]{2})\.html",
        }
        document = """
        <a href="rel-26-10.html#rel-26-10">Release 26.10</a>
        <a href="rel-26-09.html#rel-26-09">Release 26.09</a>
        <a href="rel-26-10.html">Duplicate</a>
        """
        with patch.object(monitor, "web_page_get", return_value=document):
            releases = monitor.discover_web_releases(source)
        self.assertEqual([item["id"] for item in releases], ["26-10", "26-09"])
        self.assertEqual(releases[0]["version"], "26.10")
        self.assertEqual(
            releases[0]["link"],
            "https://docs.example.test/releases/rel-26-10.html#rel-26-10",
        )

    def test_new_web_release_builds_baseline_without_replay(self):
        index_url = "https://docs.example.test/releases/index.html"
        releases = [{
            "id": "26-09", "version": "26.09",
            "link": "https://docs.example.test/releases/rel-26-09.html",
        }]
        config = {
            "repo": "owner/repo",
            "web_releases": [{"name": "Vendor Runtime", "index_url": index_url}],
        }
        with patch.object(monitor, "discover_web_releases", return_value=releases), patch.object(
            monitor, "release_note_summary",
        ) as summary:
            blocks, state = monitor.collect_web_releases(config, {})
        self.assertEqual(blocks, [])
        summary.assert_not_called()
        self.assertEqual(state[index_url]["seen"], ["26-09"])

    def test_new_web_release_fetches_notes_and_creates_release_event(self):
        index_url = "https://docs.example.test/releases/index.html"
        releases = [
            {
                "id": "26-10", "version": "26.10",
                "link": "https://docs.example.test/releases/rel-26-10.html",
            },
            {
                "id": "26-09", "version": "26.09",
                "link": "https://docs.example.test/releases/rel-26-09.html",
            },
        ]
        config = {
            "repo": "pytorch/pytorch",
            "web_releases": [{"name": "NVIDIA PyTorch NGC", "index_url": index_url}],
        }
        previous = {"web_releases": {index_url: {"seen": ["26-09"]}}}
        with patch.object(monitor, "discover_web_releases", return_value=releases), patch.object(
            monitor, "release_note_summary", return_value="PyTorch and CUDA versions.",
        ):
            blocks, state = monitor.collect_web_releases(config, previous)
        self.assertEqual(len(blocks), 1)
        self.assertEqual(blocks[0]["summary_kind"], "web_release")
        self.assertIn("NVIDIA PyTorch NGC 新版本 `26.10`", blocks[0]["markdown"])
        self.assertEqual(blocks[0]["body"], "PyTorch and CUDA versions.")
        self.assertEqual(state[index_url]["seen"][:2], ["26-10", "26-09"])

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

    def test_open_pr_event_has_no_card_action_metadata(self):
        block = monitor.event_block("body", {
            "number": 123, "state": "open", "title": "Important change",
        }, "pr", 123, repo="owner/repo")
        self.assertNotIn("pin", block)

    def test_open_issue_event_has_no_card_action_metadata(self):
        block = monitor.event_block("body", {
            "number": 321, "state": "open", "title": "Important bug",
        }, "issue", 321, repo="owner/repo")
        self.assertNotIn("pin", block)

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

    def test_beijing_quiet_hours_end_at_1030(self):
        settings = {
            "quiet_hours": {
                "enabled": True,
                "timezone": "Asia/Shanghai",
                "start": "00:00",
                "end": "10:30",
            },
        }
        with patch.object(monitor, "WATCH", settings):
            self.assertFalse(monitor.in_quiet_hours(
                datetime(2026, 10, 20, 15, 59, tzinfo=timezone.utc)
            ))
            self.assertTrue(monitor.in_quiet_hours(
                datetime(2026, 10, 20, 16, 0, tzinfo=timezone.utc)
            ))
            self.assertTrue(monitor.in_quiet_hours(
                datetime(2026, 10, 21, 2, 29, tzinfo=timezone.utc)
            ))
            self.assertFalse(monitor.in_quiet_hours(
                datetime(2026, 10, 21, 2, 30, tzinfo=timezone.utc)
            ))

    def test_notification_batch_merges_repeated_repository_sections(self):
        groups = [
            {
                "repo": "owner/one", "level": "balanced",
                "integration_branches": ["main"],
                "events": [{"markdown": "first"}],
            },
            {
                "repo": "owner/two", "level": "detailed",
                "integration_branches": ["dev"],
                "events": [{"markdown": "second"}],
            },
            {
                "repo": "owner/one", "level": "balanced",
                "integration_branches": ["main"],
                "events": [{"markdown": "third"}],
            },
        ]
        rendered = monitor.render_notification_batch(groups)
        self.assertEqual(rendered.count("📦 **owner/one**"), 1)
        self.assertEqual(rendered.count("📦 **owner/two**"), 1)
        self.assertLess(rendered.index("first"), rendered.index("third"))
        self.assertEqual(len(monitor.pending_events(groups)), 3)

    def test_pending_batch_limits_one_card_and_preserves_remainder(self):
        groups = [{
            "repo": "owner/repo", "events": [
                {"markdown": "event-{0}".format(index)} for index in range(30)
            ],
        }]
        batch, remaining = monitor.take_pending_batch(groups, limit=25)
        self.assertEqual(len(monitor.pending_events(batch)), 25)
        self.assertEqual(len(monitor.pending_events(remaining)), 5)
        self.assertEqual(remaining[0]["events"][0]["markdown"], "event-25")

    def test_scan_interval_is_hourly_while_retry_runs_can_be_frequent(self):
        state = {"last_scan_at": "2026-10-21T02:00:00Z"}
        with patch.object(monitor, "PUBLIC_SERVICE", {"interval_seconds": 3600}):
            self.assertFalse(monitor.scan_is_due(
                state, datetime(2026, 10, 21, 2, 59, tzinfo=timezone.utc)
            ))
            self.assertTrue(monitor.scan_is_due(
                state, datetime(2026, 10, 21, 3, 0, tzinfo=timezone.utc)
            ))

    def test_quiet_run_persists_events_without_sending(self):
        state = {"repos": {"owner/repo": {"last_check": "old"}}}
        block = {
            "markdown": "event", "summary_key": "pr:1", "summary_kind": "pr",
            "title": "Change", "body": "Details",
        }
        next_state = {"last_check": "new", "integration_branches": ["main"]}
        sender = MagicMock()
        with tempfile.TemporaryDirectory() as directory, patch.object(
            monitor, "LOCK_FILE", Path(directory) / "watch.lock",
        ), patch.object(monitor, "configure"), patch.object(
            monitor, "WATCH", {"repositories": [{"repo": "owner/repo"}]},
        ), patch.object(monitor, "load_state", return_value=state), patch.object(
            monitor, "save_state",
        ), patch.object(
            monitor, "collect_repo", return_value=([block], next_state),
        ), patch.object(
            monitor, "add_chinese_summaries", return_value=["rendered event"],
        ), patch.object(monitor, "in_quiet_hours", return_value=True), patch.object(
            monitor, "send_card", sender,
        ):
            monitor.run()
        sender.assert_not_called()
        self.assertEqual(len(state["pending_notifications"]), 1)
        self.assertEqual(
            state["pending_notifications"][0]["events"][0]["markdown"],
            "rendered event",
        )

    def test_daytime_run_sends_multiple_repositories_in_one_card(self):
        repositories = [{"repo": "owner/one"}, {"repo": "owner/two"}]
        state = {"repos": {
            "owner/one": {"last_check": "old"},
            "owner/two": {"last_check": "old"},
        }}

        def collect(config, _previous, _capture_time, _bootstrap):
            repo = config["repo"]
            return ([{
                "markdown": repo, "summary_key": repo, "summary_kind": "issue",
                "title": repo, "body": "Details",
            }], {"last_check": "new", "integration_branches": ["main"]})

        sender = MagicMock()
        with tempfile.TemporaryDirectory() as directory, patch.object(
            monitor, "LOCK_FILE", Path(directory) / "watch.lock",
        ), patch.object(monitor, "configure"), patch.object(
            monitor, "WATCH", {"repositories": repositories},
        ), patch.object(monitor, "load_state", return_value=state), patch.object(
            monitor, "save_state",
        ), patch.object(monitor, "collect_repo", side_effect=collect), patch.object(
            monitor, "add_chinese_summaries", side_effect=lambda blocks: [
                block["markdown"] for block in blocks
            ],
        ), patch.object(monitor, "in_quiet_hours", return_value=False), patch.object(
            monitor, "send_card", sender,
        ):
            monitor.run()
        sender.assert_called_once()
        title, body = sender.call_args.args[:2]
        self.assertEqual(title, "🌐 开源仓库实时更新")
        self.assertIn("owner/one", body)
        self.assertIn("owner/two", body)
        self.assertNotIn("actions", sender.call_args.kwargs)
        self.assertEqual(state["pending_notifications"], [])

    def test_failed_delivery_keeps_queue_for_retry(self):
        state = {
            "repos": {"owner/repo": {"last_check": "2026-10-21T02:00:00Z"}},
            "last_scan_at": "2026-10-21T02:00:00Z",
            "pending_notifications": [{
                "repo": "owner/repo", "level": "balanced",
                "integration_branches": ["main"],
                "events": [{"markdown": "queued event"}],
            }],
        }
        sender = MagicMock(side_effect=RuntimeError("offline"))
        with tempfile.TemporaryDirectory() as directory, patch.object(
            monitor, "LOCK_FILE", Path(directory) / "watch.lock",
        ), patch.object(monitor, "configure"), patch.object(
            monitor, "WATCH", {"repositories": [{"repo": "owner/repo"}]},
        ), patch.object(monitor, "load_state", return_value=state), patch.object(
            monitor, "save_state",
        ), patch.object(monitor, "scan_is_due", return_value=False), patch.object(
            monitor, "in_quiet_hours", return_value=False,
        ), patch.object(monitor, "send_card", sender):
            monitor.run()
        sender.assert_called_once()
        self.assertEqual(len(monitor.pending_events(state["pending_notifications"])), 1)

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
