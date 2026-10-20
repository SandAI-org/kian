import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from ack_reminder import confirmation_button, due  # noqa: E402


class AckReminderTest(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 10, 20, 13, 0, tzinfo=timezone(timedelta(hours=8)))
        self.reminder = {
            "schedule": {"hour": 13, "minute": 0},
            "repeat_interval_seconds": 300,
            "confirm_button_text": "已服用",
        }

    def test_first_send_is_due_at_scheduled_time(self):
        self.assertTrue(due(self.reminder, {}, self.now))

    def test_repeat_is_due_after_five_minutes(self):
        state = {
            "occurrence": "2026-10-20",
            "last_sent_at": self.now.isoformat(),
        }
        self.assertFalse(due(self.reminder, state, self.now + timedelta(minutes=4)))
        self.assertTrue(due(self.reminder, state, self.now + timedelta(minutes=5)))

    def test_acknowledgement_stops_current_day_only(self):
        state = {"acknowledged_occurrence": "2026-10-20"}
        self.assertFalse(due(self.reminder, state, self.now + timedelta(hours=1)))
        self.assertTrue(due(self.reminder, state, self.now + timedelta(days=1)))

    def test_button_carries_reminder_and_occurrence_identity(self):
        button = confirmation_button("supplement", "2026-10-20", self.reminder)
        self.assertEqual(button["text"]["content"], "已服用")
        self.assertEqual(button["value"], {
            "action": "ack_reminder",
            "reminder_id": "supplement",
            "occurrence": "2026-10-20",
        })


if __name__ == "__main__":
    unittest.main()
