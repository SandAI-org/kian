import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from automation.scripts import background_tasks as tasks
from automation.scripts import file_transfer as transfer


class TestBackgroundTasks(unittest.TestCase):
    def test_transfer_average_excludes_preparation_and_verification(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(tasks, 'process_start', return_value='identity'), \
                patch.object(tasks.time, 'time', return_value=100) as clock:
            with tasks.BackgroundTask('file', 'file_transfer', directory=directory, total_bytes=1000) as task:
                clock.return_value = 110
                task.update(stage='transferring', bytes_done=0)
                clock.return_value = 115
                task.update(bytes_done=500)
                self.assertEqual(task.data['estimated_remaining_seconds'], 5)
                self.assertEqual(task.data['current_phase_bytes_per_second'], 100)
                clock.return_value = 120
                task.update(bytes_done=1000)
                task.update(stage='verifying')
                clock.return_value = 140
            saved = json.loads(task.path.read_text())
            self.assertEqual(saved['elapsed_seconds'], 40)
            self.assertEqual(saved['transfer_elapsed_seconds'], 10)
            self.assertEqual(saved['average_transfer_bytes_per_second'], 100)
            self.assertEqual(saved['average_effective_bytes_per_second'], 25)
            self.assertNotIn('estimated_remaining_seconds', saved)
            self.assertNotIn('current_phase_bytes_per_second', saved)

    def test_relay_counts_both_transfer_phases_without_counting_byte_resets(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(tasks, 'process_start', return_value='identity'), \
                patch.object(tasks.time, 'time', return_value=100) as clock:
            with tasks.BackgroundTask('relay', 'file_transfer', directory=directory, total_bytes=1000) as task:
                task.update(stage='download_to_staging', phase_index=1, bytes_done=0)
                clock.return_value = 110
                task.update(bytes_done=1000)
                task.update(stage='upload_to_idg', phase_index=2, bytes_done=0)
                self.assertNotIn('estimated_remaining_seconds', task.data)
                self.assertNotIn('current_phase_bytes_per_second', task.data)
                clock.return_value = 130
                task.update(bytes_done=1000)
                task.update(stage='verifying')
            saved = json.loads(task.path.read_text())
            self.assertEqual(saved['transferred_bytes'], 2000)
            self.assertEqual(saved['transfer_elapsed_seconds'], 30)
            self.assertAlmostEqual(saved['average_transfer_bytes_per_second'], 2000 / 30)
            self.assertAlmostEqual(saved['average_effective_bytes_per_second'], 1000 / 30)

    def test_historical_completion_has_fixed_elapsed_and_honest_effective_average(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'legacy.json'
            original = {'status': 'completed', 'started_at': 100, 'completed_at': 140, 'total_bytes': 1000}
            path.write_text(json.dumps(original))
            with patch.object(tasks.time, 'time', return_value=10000):
                item = tasks.read_tasks(directory)[0]
            self.assertEqual(item['elapsed_seconds'], 40)
            self.assertEqual(item['average_effective_bytes_per_second'], 25)
            self.assertNotIn('average_transfer_bytes_per_second', item)
            self.assertEqual(json.loads(path.read_text()), original)

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
