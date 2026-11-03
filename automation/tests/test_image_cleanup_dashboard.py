import json
import subprocess
import shutil
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from automation.scripts import image_cleanup_dashboard as dashboard


class TestImageCleanupDashboard(unittest.TestCase):
    def test_snapshot_only_returns_curated_remote_status(self):
        settings = {'host': 'test-host', 'state_dir': '/private/batch'}
        expected = {'planned': 2, 'processed': 1, 'counts': {'completed': 1}}
        with patch.object(dashboard.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout=json.dumps(expected))) as run:
            self.assertEqual(dashboard.snapshot(settings), expected)
        args, kwargs = run.call_args
        self.assertIn('BatchMode=yes', args[0])
        self.assertEqual(args[0][-2:], ['test-host', 'python3 -'])
        self.assertIn("STATE_DIR='/private/batch'", kwargs['input'])
        self.assertNotIn('original-inspect', kwargs['input'])
        self.assertNotIn('Config', kwargs['input'])

    def test_failed_connection_does_not_become_zero_progress(self):
        with patch.object(dashboard.subprocess, 'run', return_value=SimpleNamespace(returncode=255, stdout='')):
            with self.assertRaisesRegex(RuntimeError, 'unavailable'):
                dashboard.snapshot({'host': 'host', 'state_dir': '/batch'})


    def test_live_metrics_distinguish_directory_scan_and_verification(self):
        node = shutil.which('node')
        if node is None:
            self.skipTest('Node.js unavailable')
        script = dashboard.TASK_HTML.split('<script>')[1].split('</script>')[0]
        texts = script.split('const texts=', 1)[1].split(';\nconst t=', 1)[0]
        helpers = script[script.index('function bytes('):script.index('function element(')]
        metrics = script[script.index('function transferMetrics('):script.index('function card(')]
        cases = [
            {'stage': 'upload_to_idg', 'source_is_file': False},
            {'stage': 'sha256_verification', 'source_is_file': False, 'speed': 'stale', 'eta': '00:01:00'},
            {'stage': 'transferring', 'source_is_file': False, 'speed': '3.25MB/s', 'eta': '00:01:20'},
            {'stage': 'transferring', 'source_is_file': True, 'current_phase_bytes_per_second': 1024, 'estimated_remaining_seconds': 5},
            {'kind': 'git-clone', 'stage': 'transferring', 'speed': '900 KiB/s', 'progress_percent': 20},
            {'kind': 'git-clone', 'stage': 'transferring', 'total_bytes': 1024, 'estimated_remaining_seconds': 7},
            {'kind': 'git-clone', 'stage': 'transferring', 'eta_is_rough': True, 'estimated_remaining_seconds': 60},
            {'kind': 'git-clone', 'stage': 'transferring', 'eta_is_rough': True, 'estimate_size_exceeded': True},
        ]
        source = 'const texts=' + texts + ';const t=texts.en;\n' + helpers + metrics
        source += '\nconsole.log(JSON.stringify(' + json.dumps(cases) + '.map(transferMetrics)))'
        result = subprocess.run([node, '-e', source], text=True, capture_output=True, check=True)
        scan, verify, directory_file, file, git_unknown, git_known, rough, exceeded = json.loads(result.stdout)
        self.assertEqual(scan[0][1], 'Delta sync; ETA unavailable')
        self.assertEqual(scan[1][1], 'No transfer-speed sample yet')
        self.assertEqual(verify[1][1], 'No transfer in this stage')
        self.assertNotIn('stale', json.dumps(verify))
        self.assertEqual(directory_file[0][0], 'Current file ETA')
        self.assertEqual(directory_file[1][1], '3.25MB/s')
        self.assertEqual(file[0][1], '5s')
        self.assertEqual(file[1][1], '1.0 KiB/s')
        self.assertEqual(git_unknown[0][1], 'Git transfer size unknown; ETA unavailable')
        self.assertEqual(git_unknown[1][1], '900 KiB/s')
        self.assertEqual(git_known[0][1], '7s')
        self.assertEqual(rough[0], ['Current phase ETA (rough)', '1m'])
        self.assertEqual(exceeded[0][1], 'Reference size exceeded; ETA unavailable')


if __name__ == '__main__':
    unittest.main()
