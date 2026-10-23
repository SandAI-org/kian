import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

import manage_public_watch as manager  # noqa: E402


class PublicWatchManagementTest(unittest.TestCase):
    def test_parse_pr_and_issue_urls(self):
        self.assertEqual(manager.parse_item_url(
            "https://github.com/pytorch/pytorch/pull/123"
        )["kind"], "pr")
        self.assertEqual(manager.parse_item_url(
            "https://github.com/pytorch/pytorch/issues/456"
        )["kind"], "issue")
        with self.assertRaises(ValueError):
            manager.parse_item_url("https://example.com/pytorch/pytorch/pull/1")

    def test_pin_and_unpin_preserve_history(self):
        url = "https://github.com/pytorch/pytorch/pull/123"
        with tempfile.TemporaryDirectory() as directory, patch.object(
            manager, "PINS_DIR", Path(directory)
        ), patch.object(manager, "now_iso", side_effect=[
            "2026-10-23T01:00:00Z", "2026-10-23T02:00:00Z",
        ]):
            pinned = manager.pin(url, "codex")
            self.assertTrue(pinned["active"])
            self.assertEqual(pinned["kind"], "pr")
            self.assertEqual(len(manager.active_pins()), 1)

            unpinned = manager.unpin(url, "codex")
            self.assertFalse(unpinned["active"])
            self.assertEqual(unpinned["pinned_at"], "2026-10-23T01:00:00Z")
            self.assertEqual(unpinned["outcome"], "user_unpinned")
            self.assertEqual(manager.active_pins(), [])


if __name__ == "__main__":
    unittest.main()
