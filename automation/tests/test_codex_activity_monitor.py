import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import Mock, patch

SCRIPT = Path(__file__).parents[1] / 'scripts' / 'codex_activity_monitor.py'
spec = importlib.util.spec_from_file_location('codex_activity_monitor', SCRIPT)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def turn(status='inProgress', started=90, ident='one'):
    return dict(thread_id='thread', turn_id=ident, status=status, started_at=started,
                completed_at=started + 60 if status in m.TERMINAL else None,
                name='Kato Test Workspace', cwd='/work', summary='Done')


class TestCompletionTransitions(unittest.TestCase):
    def setUp(self):
        self.state = {}
        self.target = dict(id='test', host='host')

    def poll(self, turns, now=100):
        m.ingest(self.state, self.target, dict(turns=turns, observed_at=now))

    def test_reply_preview_keeps_short_text_and_prefers_long_reply_tail(self):
        for text in ['', '简短回复', '字' * 600]:
            self.assertEqual(m.reply_preview(text), text)
        text = '开' * 200 + '中' * 1000 + '尾' * 395
        preview = m.reply_preview(text)
        self.assertEqual(preview, '开' * 200 + '\n...\n' + '尾' * 395)
        self.assertEqual(len(preview), 600)
        self.assertEqual(m.reply_preview(preview), preview)
        item = dict(turn('completed'), target='Test', summary=text)
        _, elements = m.card(item)
        self.assertIn({'tag': 'markdown', 'content': preview}, elements)

    def test_send_refresh_recovers_tail_from_fresh_remote_reply(self):
        pending = dict(turn('completed'), reply_ordinal=20, summary='legacy prefix')
        fresh = dict(pending, latest_user_ordinal=10, summary='fresh head ... fresh tail')
        with patch.object(m, 'remote_snapshot', return_value={'turns': [fresh]}):
            self.assertFalse(m.stale_before_send(self.target, pending))
        self.assertEqual(pending['summary'], fresh['summary'])

    def test_initial_history_suppressed_but_running_turn_is_tracked(self):
        self.poll([turn('completed', ident='old'), turn()])
        self.assertFalse(self.state.get('outbox'))
        self.poll([turn('completed')], 120)
        self.assertEqual(len(self.state['outbox']), 1)

    def test_turn_between_polls_and_multiple_completions(self):
        self.poll([])
        self.poll([turn('completed', 101), turn('completed', 102, 'two')], 120)
        self.assertEqual(len(self.state['outbox']), 2)

    def test_restart_and_repeated_snapshot_do_not_duplicate(self):
        self.poll([turn()])
        self.state = json.loads(json.dumps(self.state))
        self.poll([turn('completed')], 120)
        self.poll([turn('completed')], 140)
        self.assertEqual(len(self.state['outbox']), 1)

    def test_quiet_or_missing_turn_does_not_mean_complete(self):
        self.poll([turn()])
        self.poll([], 1000)
        self.assertEqual(len(self.state['targets']['test']['active']), 1)
        self.assertFalse(self.state.get('outbox'))

    def test_failure_and_interruption_are_not_success(self):
        self.poll([])
        self.poll([turn('failed', 101), turn('interrupted', 102, 'two')], 120)
        cards = [json.dumps(m.card(t), ensure_ascii=False) for t in self.state['outbox'].values()]
        self.assertTrue(any('执行失败' in c for c in cards))
        self.assertTrue(any('已中断' in c for c in cards))

    def test_unobserved_old_completion_is_not_replayed(self):
        self.poll([])
        self.poll([turn('completed', 50)], 120)
        self.assertFalse(self.state.get('outbox'))

    def test_uuid_stable_and_delivery_retry_is_durable(self):
        self.poll([])
        self.poll([turn('completed', 101)], 120)
        before = next(iter(self.state['outbox'].values()))['uuid']
        persist = Mock()
        sender = Mock(side_effect=TimeoutError())
        m.deliver(self.state, persist, sender, lambda key, item: False)
        self.assertEqual(len(self.state['outbox']), 1)
        sender.side_effect = None
        sender.return_value = {'code': 123, 'msg': 'rejected'}
        m.deliver(self.state, persist, sender, lambda key, item: False)
        self.assertEqual(len(self.state['outbox']), 1)
        sender.return_value = {'code': 0, 'data': {'message_id': 'received'}}
        m.deliver(self.state, persist, sender, lambda key, item: False)
        self.assertEqual(sender.call_args.kwargs['message_uuid'], before)
        self.assertFalse(self.state['outbox'])
        persist.assert_called_once()
        self.poll([turn('completed', 101)], 150)
        self.assertFalse(self.state['outbox'])

    def test_acknowledged_pending_card_is_dropped_without_sending(self):
        self.poll([])
        self.poll([turn('completed', 101)], 120)
        sender, persist = Mock(), Mock()
        m.deliver(self.state, persist, sender, lambda key, item: True)
        sender.assert_not_called()
        persist.assert_called_once()
        self.assertFalse(self.state['outbox'])
        self.poll([turn('completed', 101)], 140)
        self.assertFalse(self.state['outbox'])

    def test_reconnect_rechecks_user_reply_before_retry(self):
        self.poll([])
        self.poll([turn('completed', 101)], 120)
        sender = Mock()
        def unavailable(key, item):
            raise TimeoutError()
        m.deliver(self.state, Mock(), sender, unavailable)
        self.assertEqual(len(self.state['outbox']), 1)
        sender.assert_not_called()
        m.deliver(self.state, Mock(), sender, lambda key, item: True)
        self.assertFalse(self.state['outbox'])
        sender.assert_not_called()

    def test_only_a_user_message_after_the_reply_acknowledges(self):
        self.assertFalse(m.acknowledged({'reply_ordinal': 20, 'latest_user_ordinal': 10}))
        self.assertFalse(m.acknowledged({'reply_ordinal': 20, 'latest_user_ordinal': 20}))
        self.assertFalse(m.acknowledged({'reply_ordinal': 20, 'latest_user_ordinal': None}))
        self.assertTrue(m.acknowledged({'reply_ordinal': 20, 'latest_user_ordinal': 21}))

    def test_freshness_reads_remote_reply_not_pending_snapshot(self):
        pending = turn('completed', 101)
        fresh = dict(pending, reply_ordinal=10, latest_user_ordinal=11)
        with patch.object(m, 'remote_snapshot', return_value={'turns': [fresh]}) as query:
            self.assertTrue(m.stale_before_send(self.target, pending))
            query.assert_called_once_with(self.target, 101)
        with patch.object(m, 'remote_snapshot', return_value={'turns': []}):
            with self.assertRaises(RuntimeError):
                m.stale_before_send(self.target, pending)

    def test_waits_five_minutes_from_completion_not_poll_time(self):
        self.poll([])
        self.poll([turn('completed', 101)], 200)
        sender = Mock(return_value={'code': 0})
        stale = Mock(return_value=False)
        m.deliver(self.state, Mock(), sender, stale, now=460)
        sender.assert_not_called()
        stale.assert_not_called()
        self.assertEqual(len(self.state['outbox']), 1)
        m.deliver(self.state, Mock(), sender, stale, now=461)
        sender.assert_called_once()
        stale.assert_called_once()
        self.assertFalse(self.state['outbox'])

    def test_reply_during_grace_suppresses_card_after_restart(self):
        self.poll([])
        self.poll([turn('completed', 101)], 120)
        sender = Mock()
        m.deliver(self.state, Mock(), sender, Mock(return_value=False), now=200)
        self.state = json.loads(json.dumps(self.state))
        m.deliver(self.state, Mock(), sender, Mock(return_value=True), now=461)
        sender.assert_not_called()
        self.assertFalse(self.state['outbox'])

    def test_missing_completion_time_starts_a_persisted_grace_period(self):
        self.poll([])
        item = turn('interrupted', 101)
        item['completed_at'] = None
        self.poll([item], 120)
        sender, persist = Mock(return_value={'code': 0}), Mock()
        m.deliver(self.state, persist, sender, Mock(return_value=False), now=200)
        sender.assert_not_called()
        persist.assert_called_once()
        self.state = json.loads(json.dumps(self.state))
        m.deliver(self.state, Mock(), sender, Mock(return_value=False), now=499)
        sender.assert_not_called()
        m.deliver(self.state, Mock(), sender, Mock(return_value=False), now=500)
        sender.assert_called_once()

    def test_short_terminal_turns_are_dropped_before_grace_and_retry(self):
        for status in sorted(m.TERMINAL):
            with self.subTest(status=status):
                self.state = {}
                self.poll([])
                item = dict(turn(status, 101), completed_at=160.999)
                self.poll([item], 200)
                # An existing durable outbox must receive the new policy too.
                self.state = json.loads(json.dumps(self.state))
                sender, stale, persist = Mock(), Mock(), Mock()
                m.deliver(self.state, persist, sender, stale, now=201)
                sender.assert_not_called()
                stale.assert_not_called()
                persist.assert_called_once()
                self.assertFalse(self.state['outbox'])
                self.poll([item], 500)
                self.assertFalse(self.state['outbox'])

    def test_exact_minute_sends_and_missing_or_invalid_duration_is_not_assumed_short(self):
        for started, completed in [(101, 161), (None, 161), (101, None), (200, 161)]:
            with self.subTest(started=started, completed=completed):
                item = dict(turn('completed', 101), started_at=started, completed_at=completed,
                            completion_observed_at=161, target='test', uuid='stable')
                state = {'outbox': {'pending': item}}
                sender = Mock(return_value={'code': 0})
                m.deliver(state, Mock(), sender, Mock(return_value=False), now=500)
                sender.assert_called_once()
                self.assertFalse(state['outbox'])


class TestReadOnlyCollector(unittest.TestCase):
    def test_exact_allowlist_kato_name_and_final_message_only(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            with sqlite3.connect(home / 'state_5.sqlite') as db:
                db.execute('CREATE TABLE threads(id,name,title,cwd,archived)')
                db.executemany('INSERT INTO threads VALUES(?,?,?,?,?)', [
                    ('yes', 'Kato Test Workspace', 't', '/work', 0),
                    ('other', 'Someone else', 't', '/work', 0),
                    ('wrong', 'Kato Other Workspace', 't', '/work-other', 0)])
            with sqlite3.connect(home / 'thread_history_1.sqlite') as db:
                db.execute('CREATE TABLE thread_turns(thread_id,turn_id,status,started_at,completed_at,error_json,final_agent_item_id,rollout_ordinal,rollout_end_ordinal)')
                db.execute('CREATE TABLE thread_items(thread_id,item_id,item_json,rollout_ordinal,item_type)')
                db.execute('INSERT INTO thread_turns VALUES(?,?,?,?,?,?,?,?,?)',
                           ('yes', 'one', 'completed', 100, 110, None, 'final', 1, 10))
                db.execute('INSERT INTO thread_items VALUES(?,?,?,?,?)',
                           ('yes', 'final', json.dumps(dict(type='agentMessage', text='public final')), 9, 'agentMessage'))
                db.execute('INSERT INTO thread_items VALUES(?,?,?,?,?)',
                           ('yes', 'private', json.dumps(dict(type='reasoning', text='private reasoning')), 8, 'reasoning'))
                db.execute('INSERT INTO thread_turns VALUES(?,?,?,?,?,?,?,?,?)',
                           ('yes', 'orphan', 'inProgress', 1, None, None, None, 0, None))
            before = {p.name: p.read_bytes() for p in home.glob('*.sqlite')}
            snapshot = m.collect(home, ['/work'], 90)
            self.assertEqual([t['id'] for t in snapshot['threads']], ['yes'])
            self.assertEqual(snapshot['turns'][0]['summary'], 'public final')
            bound = m.collect(home, ['/registered'], 90, {'yes': '/registered'})
            self.assertEqual([t['id'] for t in bound['threads']], ['yes'])
            self.assertEqual(bound['turns'][0]['cwd'], '/registered')
            self.assertEqual(bound['turns'][0]['session_cwd'], '/work')
            with self.assertRaises(ValueError):
                m.collect(home, ['/registered'], 90, {'yes': '/outside'})
            self.assertNotIn('private reasoning', json.dumps(snapshot))
            self.assertEqual(before, {p.name: p.read_bytes() for p in home.glob('*.sqlite')})
            self.assertFalse(m.collect(home, ['/work'], 200)['turns'])
            self.assertFalse(m.acknowledged(snapshot['turns'][0]))
            with sqlite3.connect(home / 'thread_history_1.sqlite') as db:
                db.execute('INSERT INTO thread_items VALUES(?,?,?,?,?)',
                           ('yes', 'next-user', '{"text":"private user reply"}', 11, 'userMessage'))
            refreshed = m.collect(home, ['/work'], 90)
            self.assertTrue(m.acknowledged(refreshed['turns'][0]))
            self.assertNotIn('private user reply', json.dumps(refreshed))


if __name__ == '__main__':
    unittest.main()
