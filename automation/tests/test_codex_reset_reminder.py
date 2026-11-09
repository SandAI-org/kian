import copy
import asyncio
from contextlib import redirect_stdout
from datetime import datetime
from pathlib import Path
import sys
import unittest
from unittest.mock import AsyncMock, Mock, patch
import json
import io
import tempfile
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import codex_reset_reminder as reminder
import work_calendar


class TestLiveSnapshot(unittest.TestCase):
    def process(self, responses):
        process = Mock(returncode=None)
        process.stdin.drain = AsyncMock()
        process.stdout.readline = AsyncMock(side_effect=[
            (json.dumps(response) + '\n').encode() for response in responses])
        process.wait = AsyncMock(return_value=0)
        return process

    def test_reads_live_without_starting_chat_or_redeeming(self):
        snapshot = {'accountId': 'test-account', 'rateLimitResetCredits': {'credits': []}}
        process = self.process([{'id': 1, 'result': {}},
                                {'method': 'account/updated'}, {'id': 2, 'result': snapshot}])
        with patch.object(asyncio, 'create_subprocess_exec', AsyncMock(return_value=process)):
            self.assertEqual(asyncio.run(reminder.read_live_snapshot('codex')), snapshot)
        methods = [json.loads(call.args[0])['method'] for call in process.stdin.write.call_args_list]
        self.assertEqual(methods, ['initialize', 'initialized', 'account/rateLimits/read'])
        process.terminate.assert_called_once()

    def test_auth_error_stops_and_closes_own_backend(self):
        process = self.process([{'id': 1, 'result': {}},
                                {'id': 2, 'error': {'code': -1, 'message': 'unauthorized'}}])
        with patch.object(asyncio, 'create_subprocess_exec', AsyncMock(return_value=process)):
            with self.assertRaisesRegex(RuntimeError, 'account read failed'):
                asyncio.run(reminder.read_live_snapshot('codex'))
        process.terminate.assert_called_once()


class TestScheduledResetReminder(unittest.TestCase):
    def test_failed_check_retries_success_is_not_repeated(self):
        now = datetime(2026, 11, 30, 23, 0, tzinfo=ZoneInfo('Asia/Shanghai'))
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(reminder, 'STATE_DIR', Path(directory)), \
                patch.object(sys, 'argv', ['codex_reset_reminder.py', '--scheduled']), \
                patch.object(reminder, 'load_config', return_value={'codex_reset_reminder': {'enabled': True}}), \
                patch.object(reminder, 'datetime') as clock, \
                patch.object(reminder, 'read_live_snapshot', AsyncMock(return_value={})), \
                patch.object(reminder, 'evaluate', side_effect=[RuntimeError('calendar offline'), {'sent': 0}]) as evaluate, \
                redirect_stdout(io.StringIO()):
            clock.now.return_value = now
            state = Path(directory) / 'codex-reset-reminder.json'
            with self.assertRaisesRegex(RuntimeError, 'calendar offline'):
                reminder.main()
            self.assertFalse(state.exists())
            reminder.main()
            self.assertEqual(json.loads(state.read_text())['checked_on'], '2026-11-30')
            reminder.main()
            self.assertEqual(evaluate.call_count, 2)


class TestCodexResetReminder(unittest.TestCase):
    def setUp(self):
        self.zone = ZoneInfo('Asia/Shanghai')
        self.config = {'codex_reset_reminder': {'enabled': True},
                       'work_calendar': {'enabled': True, 'services': []}}
        self.sender = Mock(return_value={'code': 0})
        self.persist = Mock()
        self.state = {'sent': {}}

    def at(self, value):
        return datetime.fromisoformat(value).replace(tzinfo=self.zone)

    def snapshot(self, expiry):
        return {'accountId': 'test-account', 'rateLimitResetCredits': {'availableCount': 1,
                'credits': [{'id': 'test-card', 'status': 'available',
                             'expiresAt': int(self.at(expiry).timestamp())}]},
                'rateLimitsByLimitId': {'codex': {'primary': {
                    'usedPercent': 40, 'windowDurationMins': 10080}}}}

    def evaluate(self, snapshot, now, **kwargs):
        return reminder.evaluate(snapshot, self.config, self.at(now), self.state,
                                 self.sender, self.persist,
                                 workday=lambda d: d.weekday() < 5, **kwargs)

    def test_overnight_boundary_and_worktime_expiry(self):
        work = lambda d: d.weekday() < 5
        self.assertEqual(reminder.reminder_at(self.at('2026-12-01T03:54'), work),
                         self.at('2026-11-30T23:00'))
        self.assertIsNone(reminder.reminder_at(self.at('2026-12-01T10:00'), work))
        self.assertIsNone(reminder.reminder_at(self.at('2026-12-01T23:59'), work))

    def test_weekend_leave_holiday_and_working_saturday(self):
        expiry = self.at('2026-11-08T14:00')
        self.assertEqual(reminder.reminder_at(expiry, lambda d: d.weekday() < 5),
                         self.at('2026-11-06T23:00'))
        self.assertEqual(reminder.reminder_at(expiry, lambda d: d.weekday() != 6),
                         self.at('2026-11-07T23:00'))
        self.assertIsNone(reminder.reminder_at(self.at('2026-11-07T14:00'), lambda d: True))
        self.assertEqual(reminder.reminder_at(self.at('2026-10-05T14:00'),
                         lambda d: d.isoformat() == '2026-09-30'), self.at('2026-09-30T23:00'))
        self.assertEqual(reminder.reminder_at(self.at('2026-12-02T14:00'),
                         lambda d: d.isoformat() == '2026-12-01'), self.at('2026-12-01T23:00'))

    def test_send_once_and_stable_retry_identity(self):
        snapshot = self.snapshot('2026-12-01T03:54')
        self.assertEqual(self.evaluate(snapshot, '2026-11-30T22:59')['sent'], 0)
        self.assertEqual(self.evaluate(snapshot, '2026-11-30T23:00')['sent'], 1)
        self.assertEqual(self.evaluate(snapshot, '2026-11-30T23:30')['sent'], 0)
        self.sender.assert_called_once()
        self.assertIn('60%', self.sender.call_args.args[1])
        first_uuid = self.sender.call_args.kwargs['message_uuid']
        self.state = {'sent': {}}
        self.evaluate(snapshot, '2026-11-30T23:30')
        self.assertEqual(first_uuid, self.sender.call_args.kwargs['message_uuid'])

    def test_no_expired_redeemed_daytime_or_rest_time_alert(self):
        self.assertEqual(self.evaluate(self.snapshot('2026-12-01T03:54'), '2026-12-01T10:00')['sent'], 0)
        used = self.snapshot('2026-12-01T03:54');used['rateLimitResetCredits']['credits'][0]['status'] = 'used'
        self.assertEqual(self.evaluate(used, '2026-11-30T23:00')['sent'], 0)
        self.assertEqual(self.evaluate(self.snapshot('2026-12-01T15:00'), '2026-11-30T23:00')['sent'], 0)
        self.assertEqual(self.evaluate(self.snapshot('2026-12-01T03:54'), '2026-12-01T01:00')['sent'], 0)
        self.assertEqual(self.evaluate(self.snapshot('2026-11-08T14:00'), '2026-11-07T23:00')['sent'], 0)
        self.sender.assert_not_called()

    def test_dry_run_and_send_failure_do_not_acknowledge(self):
        snapshot = self.snapshot('2026-12-01T03:54')
        self.assertEqual(self.evaluate(snapshot, '2026-11-30T23:00', dry_run=True)['sent'], 0)
        self.sender.assert_not_called()
        self.sender.side_effect = RuntimeError('offline')
        with self.assertRaises(RuntimeError):self.evaluate(snapshot, '2026-11-30T23:00')
        self.assertEqual(self.state, {'sent': {}})
        self.persist.assert_not_called()

    def test_unknown_calendar_is_not_misclassified_as_rest(self):
        config = copy.deepcopy(self.config)
        config['work_calendar']['schedule_calendar'] = {'enabled': True}
        with patch.object(work_calendar, 'calendar_workday', side_effect=RuntimeError('offline')):
            with self.assertRaises(RuntimeError):
                reminder.evaluate(self.snapshot('2026-12-01T03:54'), config,
                                  self.at('2026-11-30T23:00'), self.state, self.sender, self.persist)
        self.sender.assert_not_called()

    def test_unknown_reset_details_stop_without_sending(self):
        with self.assertRaises(RuntimeError):self.evaluate({'rateLimitResetCredits': None}, '2026-11-30T23:00')
        self.sender.assert_not_called()


if __name__ == '__main__':
    unittest.main()
