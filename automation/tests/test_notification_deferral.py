from datetime import datetime
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import github_monitor as github
import qr_reminder as qr


class NotificationDeferralTest(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name)
        self.config = {"work_calendar": {"enabled": True, "services": ["github", "qr"]}}
        for module, name, value in [(github, "STATE_FILE", str(self.root / "github.json")),
                                    (github, "DAILY_STAMP", str(self.root / "stamp.json")),
                                    (github, "CONFIG", self.config),
                                    (qr, "STATE_PATH", str(self.root / "qr.json")),
                                    (qr, "CONFIG", self.config), (qr, "QR_CONFIG", {})]:
            context = patch.object(module, name, value)
            context.start()
            self.addCleanup(context.stop)
        self.now = datetime(2026, 11, 2, 10, tzinfo=ZoneInfo("Asia/Shanghai"))
        self.event = {"repo": "owner/repo", "markdown": "old comment https://github.com/owner/repo/issues/1",
                      "captured_at": "2026-10-30T18:00:00Z"}

    def test_night_rest_and_workday_delivery_windows(self):
        with patch.object(github, "notification_allowed", return_value=True):
            self.assertTrue(github.owned_notifications_paused(self.now.replace(hour=9, minute=59)))
            self.assertFalse(github.owned_notifications_paused(self.now))
            self.assertTrue(github.owned_notifications_paused(
                datetime.fromisoformat("2026-11-01T18:00:00+00:00")))
        with patch.object(github, "notification_allowed", return_value=False):
            self.assertTrue(github.owned_notifications_paused(self.now))

    def test_daily_rest_day_leaves_queue_and_stamp_untouched(self):
        github.save_state({"deferred_updates": [self.event]})
        before = Path(github.STATE_FILE).read_bytes()
        with patch.object(github, "notification_allowed", return_value=False), \
                patch.object(github, "feishu_send_card") as send, patch.object(github, "_build_daily_md") as build:
            github.daily(self.now)
        send.assert_not_called()
        build.assert_not_called()
        self.assertEqual(Path(github.STATE_FILE).read_bytes(), before)
        self.assertFalse(Path(github.DAILY_STAMP).exists())

    def test_daily_combines_old_backlog_and_overview_then_deduplicates(self):
        github.save_state({"deferred_updates": [self.event]})
        with patch.object(github, "notification_allowed", return_value=True), \
                patch.object(github, "_build_daily_md", return_value="recent overview"), \
                patch.object(github, "feishu_send_card") as send:
            github.daily(self.now)
            github.daily(self.now)
        send.assert_called_once()
        self.assertIn("recent overview", send.call_args.args[1])
        self.assertIn(self.event["markdown"], send.call_args.args[1])
        self.assertEqual(github.load_state()["deferred_updates"], [])
        self.assertEqual(json.loads(Path(github.DAILY_STAMP).read_text())["date"], "2026-11-02")

    def test_failed_daily_retains_backlog_and_reuses_message_uuid(self):
        github.save_state({"deferred_updates": [self.event]})
        with patch.object(github, "notification_allowed", return_value=True), \
                patch.object(github, "_build_daily_md", side_effect=["first wording", "retry wording"]), \
                patch.object(github, "feishu_send_card", side_effect=TimeoutError) as send:
            github.daily(self.now)
            github.daily(self.now)
        self.assertEqual(github.load_state()["deferred_updates"], [self.event])
        self.assertFalse(Path(github.DAILY_STAMP).exists())
        self.assertEqual(send.call_args_list[0].kwargs["message_uuid"], send.call_args_list[1].kwargs["message_uuid"])

    def test_large_backlog_drains_without_repeating_overview(self):
        github.save_state({"deferred_updates": [dict(self.event, markdown=f"event {n}") for n in range(12)]})
        with patch.object(github, "notification_allowed", return_value=True), \
                patch.object(github, "_build_daily_md", return_value="overview") as build, \
                patch.object(github, "feishu_send_card") as send:
            github.daily(self.now)
            self.assertEqual(len(github.load_state()["deferred_updates"]), 2)
            self.assertFalse(Path(github.DAILY_STAMP).exists())
            github.daily(self.now)
        build.assert_called_once()
        self.assertEqual(send.call_count, 2)
        self.assertNotIn("overview", send.call_args_list[1].args[1])
        self.assertEqual(github.load_state()["deferred_updates"], [])

    def test_realtime_queues_without_sending_and_advances_checkpoint_atomically(self):
        github.save_state({"last_check": "2026-10-30T16:00:00Z", "pr_heads": {}})
        comment = {"created_at": "2026-10-30T17:00:00Z", "issue_url": "https://api.github.com/repos/owner/repo/issues/1",
                   "html_url": "https://github.com/owner/repo/issues/1#issuecomment-1",
                   "user": {"login": "alice"}, "body": "comment"}
        def response(repo, path, params=None):
            return [comment] if path == "/issues/comments" else []
        with patch.object(github, "REPOS", ["owner/repo"]), \
                patch.object(github, "cleanup_managed"), patch.object(github, "gh_get", side_effect=response), \
                patch.object(github, "llm_summarize", return_value="summary"), \
                patch.object(github, "now_iso", return_value="2026-10-30T18:00:00Z"), \
                patch.object(github, "owned_notifications_paused", return_value=True), \
                patch.object(github, "feishu_send_card") as send:
            github.realtime()
            github.realtime()
        send.assert_not_called()
        saved = github.load_state()
        self.assertEqual(len(saved["deferred_updates"]), 1)
        self.assertEqual(saved["last_check"], "2026-10-30T18:00:00Z")
        self.assertEqual(Path(github.STATE_FILE).stat().st_mode & 0o777, 0o600)

    def test_qr_pending_rest_day_resumes_on_next_workday(self):
        state = qr.new_round_state(self.now.date(), 0)
        qr.save_state(state)
        with patch.object(qr, "notification_allowed", return_value=False), patch.object(qr.subprocess, "run") as send:
            qr.run(self.now)
        send.assert_not_called()
        self.assertEqual(qr.load_state(), state)
        with patch.object(qr, "notification_allowed", return_value=True), patch.object(qr.subprocess, "run") as send:
            qr.run(self.now)
        send.assert_called_once()
        self.assertEqual(qr.load_state()["last_reminded_at"], "2026-11-02")

    def test_qr_new_round_waits_for_a_workday_after_seven_calendar_days(self):
        state = qr.new_round_state(self.now.date(), 0)
        state.update(completed=True, completed_at="2026-10-24T12:00:00+08:00")
        qr.save_state(state)
        with patch.object(qr, "notification_allowed", return_value=False), patch.object(qr.subprocess, "run") as send:
            qr.run(self.now.replace(month=10, day=31))
        send.assert_not_called()
        self.assertEqual(qr.load_state(), state)
        with patch.object(qr, "notification_allowed", return_value=True), patch.object(qr.subprocess, "run"):
            qr.run(self.now)
        self.assertEqual(qr.load_state()["round_start"], "2026-11-02")


if __name__ == "__main__":
    unittest.main()
