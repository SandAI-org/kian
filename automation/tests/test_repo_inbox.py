import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
import urllib.request
import urllib.error
from http.server import ThreadingHTTPServer

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import repo_inbox as inbox
import repo_inbox_dashboard as dashboard
import public_repo_monitor as public
import github_monitor as owned
from datetime import datetime
from zoneinfo import ZoneInfo


class RepoInboxTest(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        for name, value in [('DB_FILE', self.root / 'inbox.sqlite3'), ('STATE_DIR', self.root)]:
            p = patch.object(inbox, name, value)
            p.start()
            self.addCleanup(p.stop)
        self.groups = [{'repo': 'example/repo', 'events': [{'markdown': '**New PR**\n\n📌 **A kernel**\n\n📝 **中文摘要：** 一个摘要\n\n[PR](https://github.com/example/repo/pull/1)', 'required': True}]}]

    def test_reimport_preserves_read_state_and_later_changes_are_unread(self):
        self.assertEqual(inbox.archive(self.groups, 'public'), 1)
        event = inbox.snapshot()['events'][0]
        self.assertEqual(event['title'], 'A kernel')
        inbox.mark_read([event['id']], True)
        self.assertEqual(inbox.archive(self.groups, 'public'), 0)
        self.assertTrue(inbox.snapshot()['events'][0]['is_read'])
        self.groups[0]['events'][0]['markdown'] += '\nNew revision'
        self.assertEqual(inbox.archive(self.groups, 'public'), 1)
        self.assertEqual(sum(e['is_read'] for e in inbox.snapshot()['events']), 1)

    def test_import_does_not_consume_delivery_queue_or_invent_timestamps(self):
        p = self.root / 'public-watch-state.json'
        text = json.dumps({'pending_notifications': self.groups})
        p.write_text(text)
        inbox.import_pending()
        self.assertEqual(p.read_text(), text)
        self.assertIsNone(inbox.snapshot()['events'][0]['captured_at'])
        self.assertFalse(inbox.snapshot()['events'][0]['is_read'])

    def test_summary_card_contains_counts_and_link_not_item_body(self):
        body = inbox.notification_body(self.groups, {}, 'public')
        self.assertIn('example/repo', body)
        self.assertIn('127.0.0.1:8768', body)
        self.assertNotIn('A kernel', body)
        self.assertNotIn('一个摘要', body)

    def test_same_origin_read_write_and_cross_origin_denial(self):
        inbox.archive(self.groups, 'public')
        server = ThreadingHTTPServer(('127.0.0.1', 0), dashboard.make_handler(0))
        port = server.server_port
        server.RequestHandlerClass = dashboard.make_handler(port)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        base = f'http://127.0.0.1:{port}'
        with urllib.request.urlopen(base + '/api/inbox') as response:
            data = json.load(response)
        payload = json.dumps({'ids': [data['events'][0]['id']], 'is_read': True}).encode()
        for origin, expected in [(base, 200), ('https://untrusted.example', 403)]:
            request = urllib.request.Request(base + '/api/read', data=payload, headers={
                'Content-Type': 'application/json', 'Origin': origin, 'X-Inbox-Token': data['token']})
            try:
                with urllib.request.urlopen(request) as response:
                    status = response.status
            except urllib.error.HTTPError as error:
                status = error.code
            self.assertEqual(status, expected)
        self.assertTrue(inbox.snapshot()['events'][0]['is_read'])

    def test_public_archives_on_quiet_day_without_consuming_pending(self):
        state = {'pending_notifications': self.groups, 'repos': {}}
        config = {'services': {'repo_inbox': {'enabled': True}}}
        with patch.object(public, 'configure'), patch.object(public, 'INBOX_CONFIG', config), \
                patch.object(public, 'WATCH', {'repositories': [{'repo': 'example/repo'}]}), \
                patch.object(public, 'LOCK_FILE', self.root / 'lock'), \
                patch.object(public, 'load_state', return_value=state), \
                patch.object(public, 'scan_is_due', return_value=False), \
                patch.object(public, 'in_quiet_hours', return_value=True), \
                patch.object(public, 'send_card') as send:
            public.run()
        send.assert_not_called()
        self.assertEqual(len(state['pending_notifications']), 1)
        self.assertEqual(len(inbox.snapshot()['events']), 1)

    def test_public_delivery_failure_keeps_pending_and_read_state(self):
        state = {'pending_notifications': self.groups, 'repos': {}}
        config = {'services': {'repo_inbox': {'enabled': True}}}
        inbox.archive(self.groups, 'public')
        inbox.mark_read([inbox.snapshot()['events'][0]['id']], True)
        with patch.object(public, 'configure'), patch.object(public, 'INBOX_CONFIG', config), \
                patch.object(public, 'WATCH', {'repositories': [{'repo': 'example/repo'}]}), \
                patch.object(public, 'LOCK_FILE', self.root / 'lock'), \
                patch.object(public, 'load_state', return_value=state), \
                patch.object(public, 'scan_is_due', return_value=False), \
                patch.object(public, 'in_quiet_hours', return_value=False), \
                patch.object(public, 'notification_allowed', return_value=True), \
                patch.object(public, 'send_card', side_effect=TimeoutError):
            public.run()
        self.assertEqual(len(state['pending_notifications']), 1)
        self.assertTrue(inbox.snapshot()['events'][0]['is_read'])


    def test_owned_daily_creates_individual_items_and_retries_without_losing_reads(self):
        overview = "**daily**\n\n---\n\n**📦 example/repo** (2)\n\n🔀 **PR [#1](https://github.com/example/repo/pull/1)** [open]\n First title\n ↳ Summary\n\n🔀 **PR [#2](https://github.com/example/repo/pull/2)** [open]\n Second title\n ↳ Another summary"
        config = {'services': {'repo_inbox': {'enabled': True}}}
        now = datetime(2026, 11, 2, 10, tzinfo=ZoneInfo('Asia/Shanghai'))
        with patch.object(owned, 'CONFIG', config), patch.object(owned, 'STATE_FILE', str(self.root / 'owned.json')), \
                patch.object(owned, 'DAILY_STAMP', str(self.root / 'daily.json')), \
                patch.object(owned, 'owned_notifications_paused', return_value=False), \
                patch.object(owned, '_build_daily_md', return_value=overview) as build, \
                patch.object(owned, 'feishu_send_card', side_effect=[TimeoutError, None]) as sender:
            owned.daily(now)
            self.assertEqual(len(inbox.snapshot()['events']), 2)
            first = inbox.snapshot()['events'][0]
            inbox.mark_read([first['id']], True)
            self.assertFalse((self.root / 'daily.json').exists())
            owned.daily(now)
            self.assertEqual(len(inbox.snapshot()['events']), 2)
            self.assertEqual(sum(e['is_read'] for e in inbox.snapshot()['events']), 1)
            self.assertEqual(build.call_count, 1)
            self.assertNotIn('First title', sender.call_args.args[1])
            self.assertTrue((self.root / 'daily.json').exists())


if __name__ == '__main__':
    unittest.main()
