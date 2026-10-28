import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import feishu_calendar_auth as auth


class CalendarUserAuthTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.file = self.root / "token.json"
        self.token = {"app_id": "app", "access_token": "old", "refresh_token": "refresh-old",
                      "expires_at": 900, "refresh_expires_at": 9000, "scope": "calendar"}
        self.file.write_text(json.dumps(self.token))
        for target, value in [("STATE_DIR", self.root), ("TOKEN_FILE", self.file)]:
            mock = patch.object(auth, target, value)
            mock.start()
            self.addCleanup(mock.stop)
        config = patch.object(auth, "load_config", return_value={"feishu": {"app_id": "app", "app_secret": "secret"}})
        config.start()
        self.addCleanup(config.stop)
        clock = patch.object(auth.time, "time", return_value=1000)
        clock.start()
        self.addCleanup(clock.stop)

    def test_expired_access_rotates_and_persists_refresh_token(self):
        payload = {"access_token": "new", "refresh_token": "refresh-new",
                   "expires_in": 7200, "refresh_token_expires_in": 604800, "token_type": "Bearer"}
        with patch.object(auth, "request_form", return_value=payload):
            self.assertEqual(auth.user_token(), "new")
        saved = json.loads(self.file.read_text())
        self.assertEqual(saved["refresh_token"], "refresh-new")
        self.assertEqual(saved["expires_at"], 8200)
        self.assertEqual(self.file.stat().st_mode & 0o777, 0o600)
        with patch.object(auth, "request_form") as refresh:
            self.assertEqual(auth.user_token(), "new")
        refresh.assert_not_called()

    def test_failed_refresh_keeps_original_credentials_for_retry(self):
        before = self.file.read_bytes()
        with patch.object(auth, "request_form", side_effect=TimeoutError):
            with self.assertRaises(TimeoutError):
                auth.user_token()
        self.assertEqual(self.file.read_bytes(), before)

    def test_expired_refresh_needs_reauthorization(self):
        self.token["refresh_expires_at"] = 900
        self.file.write_text(json.dumps(self.token))
        with patch.object(auth, "request_form") as refresh:
            with self.assertRaisesRegex(RuntimeError, "renewal"):
                auth.user_token()
        refresh.assert_not_called()

    def test_another_apps_token_is_rejected(self):
        self.token["app_id"] = "other"
        self.file.write_text(json.dumps(self.token))
        with self.assertRaisesRegex(RuntimeError, "another app"):
            auth.user_token()


if __name__ == "__main__":
    unittest.main()
