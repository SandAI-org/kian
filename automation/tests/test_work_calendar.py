import copy
import io
import json
from datetime import date, datetime
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import work_calendar as calendar
import ack_reminder


class WorkCalendarTest(unittest.TestCase):
    def setUp(self):
        self.config = {"work_calendar": {"enabled": True,
                       "services": ["supplement", "public_watch"], "overrides": {}}}
        self.zone = ZoneInfo("Asia/Shanghai")
        token = patch("feishu_calendar_auth.user_token", return_value="test-token")
        token.start()
        self.addCleanup(token.stop)

    def at(self, value):
        return datetime.fromisoformat(value).replace(tzinfo=self.zone)

    def test_weekends_holidays_and_makeup_workdays(self):
        for day in ["2026-10-31", "2026-11-01", "2026-10-01", "2026-02-23"]:
            self.assertFalse(calendar.statutory_workday(date.fromisoformat(day)))
        for day in ["2026-10-28", "2026-10-10", "2026-09-20", "2026-01-04"]:
            self.assertTrue(calendar.statutory_workday(date.fromisoformat(day)))

    def test_disabled_and_unselected_services_remain_unchanged(self):
        self.assertTrue(calendar.notification_allowed("supplement", {}, self.at("2026-10-31")))
        self.assertTrue(calendar.notification_allowed("qr", self.config, self.at("2026-10-31")))

    def test_overrides_apply_to_one_service_and_date_only(self):
        self.config["work_calendar"]["overrides"] = {"2026-10-31": {"public_watch": True}}
        self.assertTrue(calendar.notification_allowed("public_watch", self.config, self.at("2026-10-31")))
        self.assertFalse(calendar.notification_allowed("supplement", self.config, self.at("2026-10-31")))
        self.assertFalse(calendar.notification_allowed("public_watch", self.config, self.at("2026-11-01")))
        self.config["work_calendar"]["overrides"]["2026-10-28"] = {"supplement": False}
        self.assertFalse(calendar.notification_allowed("supplement", self.config, self.at("2026-10-28")))

    def test_date_is_interpreted_in_beijing_timezone(self):
        # Friday UTC evening is already Saturday in Beijing.
        now = datetime.fromisoformat("2026-10-30T18:00:00+00:00")
        self.assertFalse(calendar.notification_allowed("supplement", self.config, now))

    def test_weekend_default_stays_quiet_even_for_a_makeup_workday(self):
        self.assertFalse(calendar.notification_allowed("supplement", self.config, self.at("2026-10-10")))
        self.config["work_calendar"]["weekends_off"] = False
        self.assertTrue(calendar.notification_allowed("supplement", self.config, self.at("2026-10-10")))

    def test_shared_schedule_marks_next_saturday_as_working_without_inferring_parity(self):
        self.config["work_calendar"]["schedule_calendar"] = {"enabled": True}
        with patch.object(calendar, "calendar_workday", return_value=None):
            self.assertFalse(calendar.notification_allowed("supplement", self.config, self.at("2026-10-31")))
        with patch.object(calendar, "calendar_workday", return_value=True):
            self.assertTrue(calendar.notification_allowed("supplement", self.config, self.at("2026-11-07")))
            self.assertTrue(calendar.notification_allowed("public_watch", self.config, self.at("2026-11-07")))

    def test_leave_and_statutory_holiday_still_suppress_a_marked_workday(self):
        self.config["work_calendar"]["schedule_calendar"] = {"enabled": True}
        self.config["work_calendar"]["feishu_calendar"] = {"enabled": True}
        with patch.object(calendar, "calendar_workday", return_value=True), \
                patch.object(calendar, "calendar_leave", return_value=True):
            self.assertFalse(calendar.notification_allowed("supplement", self.config, self.at("2026-11-07")))
        with patch.object(calendar, "calendar_workday") as schedule:
            self.assertFalse(calendar.notification_allowed("supplement", self.config, self.at("2026-10-01")))
        schedule.assert_not_called()

    def test_schedule_rest_marker_and_unreadable_schedule_hold_sending(self):
        self.config["work_calendar"]["schedule_calendar"] = {"enabled": True}
        with patch.object(calendar, "calendar_workday", return_value=False):
            self.assertFalse(calendar.notification_allowed("public_watch", self.config, self.at("2026-10-28")))
        with patch.object(calendar, "calendar_workday", side_effect=TimeoutError):
            self.assertFalse(calendar.notification_allowed("public_watch", self.config, self.at("2026-11-07")))

    def test_schedule_ignores_activity_events_and_cancelled_work_markers(self):
        settings = {"work_title_patterns": ["^工作日$"], "rest_title_patterns": ["^休息日$"]}
        event = {"summary": "羽毛球活动日", "start_time": {"date": "2026-11-07"},
                 "end_time": {"date": "2026-11-08"}}
        day = date(2026, 11, 7)
        self.assertIsNone(calendar.schedule_decision([event], day, self.zone, settings))
        work = dict(event, summary="工作日")
        self.assertTrue(calendar.schedule_decision([work], day, self.zone, settings))
        self.assertIsNone(calendar.schedule_decision([dict(work, status="cancelled")], day, self.zone, settings))
        rest = dict(event, summary="休息日")
        self.assertFalse(calendar.schedule_decision([rest], day, self.zone, settings))
        with self.assertRaisesRegex(ValueError, "Conflicting"):
            calendar.schedule_decision([work, rest], day, self.zone, settings)

    def test_leave_and_calendar_outage_hold_notifications(self):
        self.config["work_calendar"]["feishu_calendar"] = {"enabled": True}
        with patch.object(calendar, "calendar_leave", return_value=True):
            self.assertFalse(calendar.notification_allowed("supplement", self.config, self.at("2026-10-28")))
        with patch.object(calendar, "calendar_leave", side_effect=TimeoutError):
            self.assertFalse(calendar.notification_allowed("public_watch", self.config, self.at("2026-10-28")))
        with patch.object(calendar, "calendar_leave", return_value=False):
            self.assertTrue(calendar.notification_allowed("public_watch", self.config, self.at("2026-10-28")))

    def test_unknown_holiday_year_is_not_assumed_to_be_a_workday(self):
        self.assertFalse(calendar.notification_allowed("supplement", self.config, self.at("2027-01-04")))

    def test_leave_filter_ignores_meetings_cancelled_and_declined_events(self):
        event = {"summary": "请假中(全天)", "start_time": {"date": "2026-10-28"},
                 "end_time": {"date": "2026-10-29"}}
        patterns = [r"^请假中"]
        day = date(2026, 10, 28)
        self.assertTrue(calendar.is_leave_event(event, day, self.zone, patterns))
        self.assertFalse(calendar.is_leave_event(event, date(2026, 10, 29), self.zone, patterns))
        for fields in [{"summary": "例会"}, {"status": "cancelled"}, {"self_rsvp_status": "decline"}]:
            self.assertFalse(calendar.is_leave_event(dict(event, **fields), day, self.zone, patterns))

    def test_half_day_leave_suppresses_that_day_only(self):
        event = {"summary": "Time off", "start_time": {"timestamp": self.at("2026-10-28T14:00").timestamp()},
                 "end_time": {"timestamp": self.at("2026-10-28T18:00").timestamp()}}
        self.assertTrue(calendar.is_leave_event(event, date(2026, 10, 28), self.zone, [r"^Time off"]))
        self.assertFalse(calendar.is_leave_event(event, date(2026, 10, 29), self.zone, [r"^Time off"]))

    def test_supplement_rest_day_is_skipped_without_writing_or_sending(self):
        config = copy.deepcopy(self.config)
        config["reminders"] = {"supplement": {"schedule": {"hour": 13}}}
        with patch.object(ack_reminder, "send") as send, patch.object(ack_reminder, "write_state") as write:
            self.assertEqual(ack_reminder.run(self.at("2026-10-31T13:00"), config), [])
        send.assert_not_called()
        write.assert_not_called()

    def test_calendar_reader_caches_only_decision_and_uses_read_only_requests(self):
        settings = {"calendar_id": "personal", "leave_title_patterns": ["^请假中"]}
        event = {"summary": "请假中(全天)", "start_time": {"date": "2026-10-28"},
                 "end_time": {"date": "2026-10-29"}}
        responses = [io.StringIO(json.dumps({"code": 0, "data": {"role": "reader"}})),
                     io.StringIO(json.dumps({"code": 0, "data": {"items": [event]}}))]
        with tempfile.TemporaryDirectory() as directory, patch.object(calendar, "STATE_DIR", Path(directory)), \
                patch("feishu_calendar_auth.user_token", return_value="test-token"), \
                patch("feishu_remind.OPENER.open", side_effect=responses) as request:
            self.assertTrue(calendar.calendar_leave(date(2026, 10, 28), self.zone, settings))
            self.assertTrue(calendar.calendar_leave(date(2026, 10, 28), self.zone, settings))
            self.assertEqual(request.call_count, 2)
            self.assertTrue(all(call.args[0].get_method() == "GET" for call in request.call_args_list))
            stored = next(Path(directory).glob("*.json")).read_text()
            self.assertNotIn(event["summary"], stored)
            self.assertNotIn("test-token", stored)
            self.assertEqual(set(json.loads(stored)), {"date", "checked_at", "has_leave"})

    def test_free_busy_only_access_is_not_treated_as_no_leave(self):
        settings = {"calendar_id": "personal", "leave_title_patterns": ["^请假中"]}
        response = io.StringIO(json.dumps({"code": 0, "data": {"role": "free_busy_reader"}}))
        with tempfile.TemporaryDirectory() as directory, patch.object(calendar, "STATE_DIR", Path(directory)), \
                patch("feishu_calendar_auth.user_token", return_value="test-token"), \
                patch("feishu_remind.OPENER.open", return_value=response) as request:
            with self.assertRaisesRegex(RuntimeError, "detail-read access"):
                calendar.calendar_leave(date(2026, 10, 28), self.zone, settings)
            self.assertEqual(request.call_count, 1)
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_successful_empty_calendar_response_may_omit_items(self):
        settings = {"calendar_id": "personal", "leave_title_patterns": ["^请假中"]}
        for data in [{}, {"items": None}, {"items": []}]:
            responses = [io.StringIO(json.dumps({"code": 0, "data": {"role": "reader"}})),
                         io.StringIO(json.dumps({"code": 0, "data": data}))]
            with self.subTest(data=data), tempfile.TemporaryDirectory() as directory, \
                    patch.object(calendar, "STATE_DIR", Path(directory)), \
                    patch("feishu_remind.OPENER.open", side_effect=responses):
                self.assertFalse(calendar.calendar_leave(date(2026, 10, 28), self.zone, settings))


if __name__ == "__main__":
    unittest.main()
