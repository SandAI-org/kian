from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import repo_inbox
from repo_inbox_dates import source_time


class SourceDatesTest(unittest.TestCase):
    def test_close_heading_does_not_misclassify_unmerged_as_merged(self):
        item = {'closed_at': '2026-10-29T12:00:00Z', 'merged_at': '2026-10-30T12:00:00Z'}
        self.assertEqual(source_time('closed 关闭但未合入', item), (item['closed_at'], 'github.closed_at'))
        self.assertEqual(source_time('PR 合入', item), (item['merged_at'], 'github.merged_at'))

    def test_reopen_uses_timeline_before_import_not_later_activity(self):
        item = {'timeline': [{'__typename': 'ReopenedEvent', 'createdAt': '2026-10-29T12:00:00Z'},
                             {'__typename': 'ReopenedEvent', 'createdAt': '2026-11-02T12:00:00Z'}]}
        self.assertEqual(source_time('Issue 重新打开', item, '2026-11-01T12:00:00Z'),
                         ('2026-10-29T12:00:00Z', 'github.reopened_event'))

    def test_historical_reference_is_labelled_and_does_not_use_later_updates(self):
        item = {'created_at': '2026-10-01T12:00:00Z', 'updated_at': '2026-11-02T12:00:00Z'}
        self.assertEqual(source_time('early signal', item, '2026-11-01T12:00:00Z', True),
                         (item['created_at'], 'github.created_at.reference'))
        self.assertEqual(source_time('early signal', item, historical=True),
                         (item['updated_at'], 'github.updated_at.reference'))

    def test_source_date_enrichment_preserves_event_identity_and_user_read_state(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(repo_inbox, 'DB_FILE', Path(folder) / 'inbox.sqlite3'):
            groups = [{'repo': 'example/repo', 'events': [{'markdown': 'same event'}]}]
            repo_inbox.archive(groups, 'public')
            event = repo_inbox.snapshot()['events'][0]
            repo_inbox.mark_read([event['id']], True)
            groups[0]['events'][0].update(event_at='2026-10-29T12:00:00Z', date_source='github.merged_at')
            self.assertEqual(repo_inbox.archive(groups, 'public'), 0)
            updated = repo_inbox.snapshot()['events'][0]
            self.assertEqual(updated['id'], event['id'])
            self.assertEqual(updated['event_at'], '2026-10-29T12:00:00Z')
            self.assertEqual(updated['is_read'], 1)
            self.assertIsNone(updated['captured_at'])


if __name__ == '__main__':
    unittest.main()
