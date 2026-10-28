import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from automation.scripts import background_tasks as tasks
from automation.scripts import file_transfer as transfer


class TestBackgroundTasks(unittest.TestCase):
    def test_completion_is_only_recorded_after_context_succeeds(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(tasks, 'process_start', return_value='identity'):
            with tasks.BackgroundTask('file', 'file_transfer', directory=directory) as task:
                task.update(stage='verifying', transfer_percent=100)
                saved = json.loads(task.path.read_text())
                self.assertEqual(saved['status'], 'running')
            self.assertEqual(json.loads(task.path.read_text())['status'], 'completed')
            self.assertEqual(task.path.stat().st_mode & 0o777, 0o600)

    def test_failure_and_abrupt_worker_exit_are_not_success(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(tasks, 'process_start', return_value='identity'):
            with self.assertRaises(ValueError):
                with tasks.BackgroundTask('bad', 'file_transfer', directory=directory) as failed:
                    raise ValueError('checksum mismatch')
            self.assertEqual(json.loads(failed.path.read_text())['status'], 'failed')
            running = tasks.BackgroundTask('running', 'other', directory=directory)
            running.update()
            with patch.object(tasks, 'process_start', return_value='reused-pid-identity'):
                found = {item['id']: item for item in tasks.read_tasks(directory)}
            self.assertEqual(found[running.data['id']]['status'], 'unknown')
            self.assertEqual(found[failed.data['id']]['status'], 'failed')
            self.assertEqual(json.loads(running.path.read_text())['status'], 'running')

    def test_rsync_progress_handles_commas_and_ignores_other_lines(self):
        self.assertEqual(transfer.parse_progress('  1,234,567  42%  3.25MB/s  00:01:20'),
                         {'bytes_done': 1234567, 'transfer_percent': 42, 'speed': '3.25MB/s', 'eta': '00:01:20'})
        self.assertIsNone(transfer.parse_progress('TRANSFER_VERIFIED size=10 sha256=abc'))

    def test_remote_sync_reports_two_distinct_phases(self):
        progress = Mock()
        source = transfer.Endpoint('source-host', '/data/source')
        destination = transfer.Endpoint('destination-host', '/data/destination')
        with patch.object(transfer, 'direct_transfer', return_value={'verification': 'sha256'}) as direct:
            result = transfer.transfer(source, destination, False, progress)
        phases = [call.kwargs for call in progress.update.call_args_list]
        self.assertEqual([x['phase_index'] for x in phases], [1, 2])
        self.assertTrue(all(x['phase_total'] == 2 for x in phases))
        self.assertEqual(direct.call_count, 2)
        self.assertEqual(result['verification'], 'sha256')

    def test_directory_transfer_does_not_claim_sha256_verification(self):
        progress = Mock()
        with patch.object(transfer, 'ensure_target'), patch.object(transfer, 'is_file', return_value=False), \
                patch.object(transfer, 'rsync'), patch.object(transfer, 'verify_file') as verify:
            result = transfer.direct_transfer(transfer.Endpoint(None, '/source'), transfer.Endpoint(None, '/destination'), False, progress)
        verify.assert_not_called()
        self.assertEqual(result['verification'], 'rsync_checks')
        self.assertTrue(any(c.kwargs.get('source_is_file') is False for c in progress.update.call_args_list))


if __name__ == '__main__':
    unittest.main()
