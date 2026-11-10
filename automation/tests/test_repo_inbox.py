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
import feishu_remind as remind
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

    def test_favorites_persist_independently_of_read_and_reimport(self):
        inbox.archive(self.groups, 'public')
        identity = inbox.snapshot()['events'][0]['id']
        inbox.mark_favorite([identity, 'missing-event'], True)
        saved = inbox.snapshot()['events'][0]
        self.assertTrue(saved['is_favorite'])
        self.assertFalse(saved['is_read'])
        self.assertIsNotNone(saved['favorited_at'])
        inbox.mark_read([identity], True)
        inbox.archive(self.groups, 'public')
        inbox.mark_favorite([identity], True)
        self.assertEqual(inbox.snapshot()['events'][0]['favorited_at'], saved['favorited_at'])
        inbox.mark_favorite([identity], False)
        final = inbox.snapshot()['events'][0]
        self.assertFalse(final['is_favorite'])
        self.assertTrue(final['is_read'])
        self.assertEqual(len(inbox.snapshot()['events']), 1)
        with self.assertRaises(ValueError):inbox.mark_favorite([identity], 'yes')

    def test_import_does_not_consume_delivery_queue_or_invent_timestamps(self):
        p = self.root / 'public-watch-state.json'
        text = json.dumps({'pending_notifications': self.groups})
        p.write_text(text)
        inbox.import_pending()
        self.assertEqual(p.read_text(), text)
        self.assertIsNone(inbox.snapshot()['events'][0]['captured_at'])
        self.assertFalse(inbox.snapshot()['events'][0]['is_read'])

    def test_public_card_contains_brief_reading_preview_and_link(self):
        body = inbox.notification_card(self.groups, {}, 'public')['body']
        self.assertIn('example/repo', body)
        self.assertIn('127.0.0.1:8768', body)
        self.assertIn('A kernel', body)
        self.assertIn('一个摘要', body)
        self.assertIn('关注点：', body)
        self.assertNotIn('A kernel', inbox.notification_card(self.groups, {}, 'owned')['body'])

    def test_bracketed_titles_are_not_nested_or_escaped_link_labels(self):
        for title in ['[RFE]: layout-aware FSDP2', '[Common] Use .shared::cta']:
            groups = [{'repo': 'example/repo', 'events': [{'markdown':
                f'New PR\n📌 **{title}**\n📝 中文摘要： 摘要\n[PR](https://github.com/example/repo/pull/1)'}]}]
            card = inbox.notification_card(groups, {}, 'public')
            text = json.dumps(card, ensure_ascii=False)
            self.assertIn(f'**{title}**', text)
            self.assertIn('[查看原文](https://github.com/example/repo/pull/1)', text)
            self.assertNotIn('\\[', text)
            self.assertNotIn('[' + title + '](', text)

    def test_highlights_limit_diversity_deduplication_and_priority(self):
        def event(number, score, required=False):
            return {'markdown': f'📌 Kernel {number}\n📝 中文摘要： 摘要 {number}\nSignals: Performance\n[PR](https://github.com/example/repo/pull/{number})',
                    'score': score, 'required': required}
        groups = [{'repo': 'example/one', 'events': [event(1, 100), event(2, 99)]},
                  {'repo': 'example/two', 'events': [event(3, 8, True), event(1, 100)]},
                  {'repo': 'example/three', 'events': [event(4, 9)]},
                  {'repo': 'papers', 'channel': 'papers', 'events': [event(5, 1000)]}]
        card = inbox.notification_card(groups, {}, 'all')
        previews = [e['content'] for e in card['elements'] if e['tag'] == 'markdown' and '关注点：' in e['content']]
        self.assertEqual(len(previews), 3)
        self.assertIn('Kernel 3', previews[0])
        self.assertTrue(any('Kernel 1' in p for p in previews))
        self.assertTrue(any('Kernel 4' in p for p in previews))
        self.assertFalse(any('Kernel 5' in p or 'Kernel 2' in p for p in previews))
        self.assertTrue(all('性能优化' in p for p in previews))

    def test_previews_exclude_read_items_and_keep_summary_short(self):
        self.groups[0]['events'][0]['markdown'] += '\nStack from ghstack: irrelevant full body'
        self.groups[0]['events'].append({'markdown': '📌 Long summary\n📝 中文摘要： ' + '长摘要' * 200 +
                                      '\n[PR](https://github.com/example/repo/pull/2)'})
        inbox.archive(self.groups, 'public')
        first = next(e for e in inbox.snapshot()['events'] if e['title'] == 'A kernel')
        inbox.mark_read([first['id']], True)
        card = inbox.notification_card(self.groups, {}, 'public')
        self.assertNotIn('A kernel', card['body'])
        self.assertNotIn('ghstack', card['body'])
        self.assertIn('Long summary', card['body'])
        self.assertNotIn('长摘要' * 60, card['body'])
        self.assertEqual(sum(e['is_read'] for e in inbox.snapshot()['events']), 1)
        english = inbox.notification_card(self.groups, {'repo_inbox': {'language': 'en'}}, 'public')
        self.assertIn('Selected reading', english['body'])
        self.assertIn('Why read:', english['body'])

    def test_summary_counts_only_unread_across_public_and_paper_channels(self):
        papers = {'repo': 'paper:infra', 'channel': 'papers', 'source_name': 'Infra Papers',
                  'events': [{'markdown': '📌 A paper\n[Paper](https://arxiv.org/abs/2610.12345)'}]}
        groups = self.groups + [papers]
        inbox.archive(groups, 'public')
        read = next(e for e in inbox.snapshot()['events'] if e['channel'] == 'public')
        inbox.mark_read([read['id']], True)
        body = inbox.notification_card(groups, {}, 'all')['body']
        self.assertIn('1 条未读', body)
        self.assertIn('Infra Papers', body)
        self.assertNotIn('example/repo', body)
        inbox.mark_read([e['id'] for e in inbox.snapshot()['events']], True)
        self.assertEqual(inbox.notification_card(groups, {}, 'all')['body'], '')
        self.assertEqual(inbox.notification_card(groups, {}, 'all')['elements'], [])
        inbox.mark_read([read['id']], False)
        body = inbox.notification_card(groups, {'repo_inbox': {'language': 'en'}}, 'all')['body']
        self.assertIn('1 unread items', body)
        self.assertIn('example/repo', body)
        self.assertEqual(len(groups), 2)

    def test_native_digest_has_stats_two_columns_and_one_reader_action(self):
        groups = self.groups + [
            {'repo': 'world-sim-dev/magicore', 'events': [{'markdown': 'A'}]},
            {'repo': 'world-sim-dev/odin', 'events': [{'markdown': 'B'}]},
        ]
        card = inbox.notification_card(groups, {}, 'owned')
        stats = card['elements'][0]
        self.assertEqual(stats['background_style'], 'grey')
        self.assertEqual(len(stats['columns']), 2)
        self.assertIn('**3**', json.dumps(stats, ensure_ascii=False))
        rows = [e for e in card['elements'][1:] if e['tag'] == 'column_set']
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(len(row['columns']) == 2 for row in rows))
        text = json.dumps(card['elements'], ensure_ascii=False)
        self.assertIn('**Magicore**', text)
        self.assertIn('**Odin**', text)
        self.assertNotIn('•', text)
        action = next(e for e in card['elements'] if e['tag'] == 'action')
        self.assertEqual(len(action['actions']), 1)
        self.assertEqual(action['actions'][0]['url'], 'http://127.0.0.1:8768/?channel=owned')
        self.assertNotIn('value', action['actions'][0])
        english = inbox.notification_card(groups, {'repo_inbox': {'language': 'en'}}, 'owned')
        self.assertIn('Open reading room', json.dumps(english['elements']))

    def test_card_preserves_repository_identity_when_short_names_collide(self):
        groups = [{'repo': owner + '/same', 'events': [{'markdown': owner}]} for owner in ['one', 'two']]
        text = json.dumps(inbox.notification_card(groups, {}, 'public')['elements'])
        self.assertIn('one/same', text)
        self.assertIn('two/same', text)

    def test_custom_digest_elements_reach_both_senders_without_pr_buttons(self):
        elements = inbox.notification_card(self.groups, {}, 'owned')['elements']
        for module, call in [(remind, remind.send), (owned, owned.feishu_send_card)]:
            with patch.object(module, 'feishu_token', return_value='test-token'), patch.object(module.OPENER, 'open') as send:
                send.return_value.__enter__.return_value.read.return_value = b'{"code":0}'
                call('Digest', '`desc1`', elements=elements)
                payload = json.loads(send.call_args.args[0].data)
                self.assertEqual(json.loads(payload['content'])['elements'], elements)

    def test_feishu_rejection_is_reported_for_delivery_retry(self):
        with patch.object(remind, 'feishu_token', return_value='test-token'), patch.object(remind.OPENER, 'open') as send:
            send.return_value.__enter__.return_value.read.return_value = b'{"code":230099,"msg":"invalid card"}'
            with self.assertRaisesRegex(RuntimeError, 'invalid card'):
                remind.send('Digest', 'Body', elements=[])

    def test_same_origin_read_write_and_cross_origin_denial(self):
        inbox.archive(self.groups, 'public')
        server = ThreadingHTTPServer(('127.0.0.1', 0), dashboard.make_handler(0))
        port = server.server_port
        server.RequestHandlerClass = dashboard.make_handler(port, repositories=["example/empty-repo"])
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        base = f'http://127.0.0.1:{port}'
        with urllib.request.urlopen(base + '/api/inbox') as response:
            data = json.load(response)
        self.assertEqual(data['repositories'], [{'repo': 'example/empty-repo', 'channel': 'owned'}])
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

        favorite_payload = json.dumps({'ids': [data['events'][0]['id']], 'is_favorite': True}).encode()
        for origin, token, expected in [(base, data['token'], 200),
                                        ('https://untrusted.example', data['token'], 403), (base, 'wrong', 403)]:
            request = urllib.request.Request(base + '/api/favorite', data=favorite_payload, headers={
                'Content-Type': 'application/json', 'Origin': origin, 'X-Inbox-Token': token})
            try:
                with urllib.request.urlopen(request) as response:status = response.status
            except urllib.error.HTTPError as error:status = error.code
            self.assertEqual(status, expected)
        self.assertTrue(inbox.snapshot()['events'][0]['is_favorite'])
        self.assertTrue(inbox.snapshot()['events'][0]['is_read'])

    def test_public_archives_on_quiet_day_without_consuming_pending(self):
        state = {'pending_notifications': self.groups, 'repos': {}}
        config = {'services': {'repo_inbox': {'enabled': True}}}
        with patch.object(public, 'configure'), patch.object(public, 'INBOX_CONFIG', config), \
                patch.object(public, 'WATCH', {'repositories': [{'repo': 'example/repo'}], 'daily_digest': {'enabled': True}}), \
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
        self.groups[0]['events'].append({'markdown': '📌 Another kernel\n[PR](https://github.com/example/repo/pull/2)'})
        state = {'pending_notifications': self.groups, 'repos': {}}
        config = {'services': {'repo_inbox': {'enabled': True}}}
        inbox.archive(self.groups, 'public')
        read = next(e for e in inbox.snapshot()['events'] if e['title'] == 'A kernel')
        inbox.mark_read([read['id']], True)
        with patch.object(public, 'configure'), patch.object(public, 'INBOX_CONFIG', config), \
                patch.object(public, 'WATCH', {'repositories': [{'repo': 'example/repo'}]}), \
                patch.object(public, 'LOCK_FILE', self.root / 'lock'), \
                patch.object(public, 'load_state', return_value=state), \
                patch.object(public, 'scan_is_due', return_value=False), \
                patch.object(public, 'in_quiet_hours', return_value=False), \
                patch.object(public, 'notification_allowed', return_value=True), \
                patch.object(public, 'send_card', side_effect=TimeoutError) as sender:
            public.run()
        self.assertEqual(len(state['pending_notifications']), 1)
        self.assertIn('1 条未读', sender.call_args.args[1])
        self.assertEqual(sum(e['is_read'] for e in inbox.snapshot()['events']), 1)

    def test_public_all_read_drains_queue_without_sending_or_resetting_reads(self):
        self.groups[0]['events'][0]['complete_pin'] = {'repo': 'example/repo', 'number': 1, 'outcome': 'merged'}
        state = {'pending_notifications': self.groups, 'repos': {}}
        inbox.archive(self.groups, 'public')
        inbox.mark_read([inbox.snapshot()['events'][0]['id']], True)
        with patch.object(public, 'configure'), patch.object(public, 'INBOX_CONFIG', {'services': {'repo_inbox': {'enabled': True}}}), \
                patch.object(public, 'WATCH', {'repositories': [{'repo': 'example/repo'}]}), \
                patch.object(public, 'LOCK_FILE', self.root / 'lock'), patch.object(public, 'save_state'), \
                patch.object(public, 'load_state', return_value=state), patch.object(public, 'scan_is_due', return_value=False), \
                patch.object(public, 'in_quiet_hours', return_value=False), patch.object(public, 'notification_allowed', return_value=True), \
                patch.object(public, 'send_card') as sender, patch.object(public, 'deactivate_pin') as complete:
            public.run()
            public.run()
        sender.assert_not_called()
        complete.assert_called_once_with('example/repo', 1, 'merged')
        self.assertEqual(state['pending_notifications'], [])
        self.assertTrue(inbox.snapshot()['events'][0]['is_read'])


    def test_public_daily_includes_read_counts_backlog_and_preserves_paper_queue(self):
        now = datetime(2026, 11, 3, 10, 30, tzinfo=ZoneInfo('Asia/Shanghai'))
        public_groups = self.groups + [{'repo': 'example/read', 'events': [{'markdown': 'Read item'}]}]
        papers = {'repo': 'papers', 'channel': 'papers', 'events': [{'markdown': 'A paper'}]}
        inbox.archive(public_groups + [papers], 'public')
        with inbox.connect() as db:
            db.execute("UPDATE events SET imported_at='2026-11-02T03:00:00+00:00'")
            db.execute("UPDATE events SET imported_at='2026-10-20T03:00:00+00:00' WHERE repo='example/repo'")
        read = next(e for e in inbox.snapshot()['events'] if e['repo'] == 'example/read')
        inbox.mark_read([read['id']], True)
        state = {'pending_notifications': public_groups + [papers],
                 'daily_digest': {'date': '2026-11-02', 'through': '2026-11-02T02:30:00Z'}}
        with patch.object(public, 'WATCH', {'daily_digest': {'enabled': True}}), \
                patch.object(public, 'INBOX_CONFIG', {}), patch.object(public, 'save_state'), \
                patch.object(public, 'send_card') as sender:
            self.assertFalse(public.daily_digest_due(state, now.replace(minute=29)))
            self.assertTrue(public.daily_digest_due(state, now))
            with patch.object(inbox, 'reading_highlights', wraps=inbox.reading_highlights) as highlights:
                public.deliver_daily_digest(state, now)
                event = next(g for g in highlights.call_args.args[0] if g['repo'] == 'example/repo')['events'][0]
                self.assertTrue(event['required'])
            self.assertFalse(public.daily_digest_due(state, now))
        self.assertIn('1 条未读', sender.call_args.args[1])
        self.assertIn('1 条已读', sender.call_args.args[1])
        self.assertIn('example/read', sender.call_args.args[1])
        self.assertNotIn('A paper', sender.call_args.args[1])
        self.assertEqual(state['pending_notifications'], [papers])
        self.assertEqual(sum(e['is_read'] for e in inbox.snapshot()['events']), 1)

    def test_public_daily_failure_retries_and_all_read_settles_silently(self):
        inbox.archive(self.groups, 'public')
        now = datetime.now(ZoneInfo('Asia/Shanghai'))
        state = {'pending_notifications': list(self.groups)}
        with patch.object(public, 'WATCH', {'daily_digest': {'enabled': True}}), \
                patch.object(public, 'INBOX_CONFIG', {}), patch.object(public, 'save_state'), \
                patch.object(public, 'send_card', side_effect=TimeoutError) as sender:
            with self.assertRaises(TimeoutError):
                public.deliver_daily_digest(state, now)
            self.assertNotIn('daily_digest', state)
            self.assertEqual(state['pending_notifications'], self.groups)
            inbox.mark_read([e['id'] for e in inbox.snapshot()['events']], True)
            public.deliver_daily_digest(state, now)
            sender.assert_called_once()
        self.assertFalse(state['daily_digest']['notified'])
        self.assertEqual(state['pending_notifications'], [])
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
            self.assertIn('1 条未读', sender.call_args.args[1])

    def test_owned_daily_read_after_failure_skips_retry_and_clears_deferred_queue(self):
        config = {'services': {'repo_inbox': {'enabled': True}}}
        event = {'repo': self.groups[0]['repo'], **self.groups[0]['events'][0]}
        file = self.root / 'owned.json'
        file.write_text(json.dumps({'deferred_updates': [event]}))
        now = datetime(2026, 11, 2, 10, tzinfo=ZoneInfo('Asia/Shanghai'))
        with patch.object(owned, 'CONFIG', config), patch.object(owned, 'STATE_FILE', str(file)), \
                patch.object(owned, 'DAILY_STAMP', str(self.root / 'daily.json')), \
                patch.object(owned, 'owned_notifications_paused', return_value=False), \
                patch.object(owned, '_build_daily_md', return_value='No new snapshot') as build, \
                patch.object(owned, 'feishu_send_card', side_effect=TimeoutError) as sender:
            owned.daily(now)
            self.assertEqual(len(owned.load_state()['deferred_updates']), 1)
            inbox.mark_read([e['id'] for e in inbox.snapshot()['events']], True)
            owned.daily(now)
            owned.daily(now)
            sender.assert_called_once()
            build.assert_called_once()
        self.assertEqual(json.loads(file.read_text())['deferred_updates'], [])
        self.assertTrue((self.root / 'daily.json').exists())
        self.assertTrue(inbox.snapshot()['events'][0]['is_read'])

    def test_owned_realtime_all_read_skips_send_and_advances_checkpoint(self):
        comment = {'created_at': '2026-11-02T02:00:00Z', 'pull_request_url': 'https://api.github.com/repos/example/repo/pulls/1',
                   'user': {'login': 'author'}, 'body': 'Comment', 'html_url': 'https://github.com/example/repo/pull/1#discussion_r1'}
        file = self.root / 'owned.json'
        file.write_text(json.dumps({'last_check': '2026-11-02T01:00:00Z'}))
        def archive_and_read(groups, channel):
            inbox.archive(groups, channel)
            inbox.mark_read([e['id'] for e in inbox.snapshot()['events']], True)
        with patch.object(owned, 'CONFIG', {'services': {'repo_inbox': {'enabled': True}}}), \
                patch.object(owned, 'STATE_FILE', str(file)), patch.object(owned, 'REPOS', ['example/repo']), \
                patch.object(owned, 'cleanup_managed'), patch.object(owned, 'now_iso', return_value='2026-11-02T02:01:00Z'), \
                patch.object(owned, 'owned_notifications_paused', return_value=False), \
                patch.object(owned, 'gh_get', side_effect=lambda repo, path, params: [comment] if path == '/pulls/comments' else []), \
                patch.object(owned, 'llm_summarize', return_value='Summary'), patch.object(owned, 'inbox_archive', side_effect=archive_and_read), \
                patch.object(owned, 'feishu_send_card') as sender:
            owned.realtime()
        sender.assert_not_called()
        self.assertEqual(json.loads(file.read_text())['last_check'], '2026-11-02T02:01:00Z')


if __name__ == '__main__':
    unittest.main()
