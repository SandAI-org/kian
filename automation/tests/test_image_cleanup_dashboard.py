import json
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


if __name__ == '__main__':
    unittest.main()
