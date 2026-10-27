import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import Mock

SCRIPT = Path(__file__).parents[1] / 'scripts' / 'codex_activity_monitor.py'
spec = importlib.util.spec_from_file_location('codex_activity_monitor', SCRIPT)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def turn(status='inProgress', started=90, ident='one'):
    return dict(thread_id='thread', turn_id=ident, status=status, started_at=started,
                completed_at=110 if status in m.TERMINAL else None,
                name='Kato Test Workspace', cwd='/work', summary='Done')


class TestCompletionTransitions(unittest.TestCase):
    def setUp(self):
        self.state = {}
        self.target = dict(id='test', host='host')

    def poll(self, turns, now=100):
        m.ingest(self.state, self.target, dict(turns=turns, observed_at=now))

    def test_initial_history_suppressed_but_running_turn_is_tracked(self):
        self.poll([turn('completed', ident='old'), turn()])
        self.assertFalse(self.state.get('outbox'))
        self.poll([turn('completed')], 120)
        self.assertEqual(len(self.state['outbox']), 1)

    def test_short_turn_between_polls_and_multiple_completions(self):
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
        titles = [m.card(t)[0] for t in self.state['outbox'].values()]
        self.assertTrue(any('执行失败' in t for t in titles))
        self.assertTrue(any('已中断' in t for t in titles))

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
        m.deliver(self.state, persist, sender)
        self.assertEqual(len(self.state['outbox']), 1)
        sender.side_effect = None
        sender.return_value = {'code': 123, 'msg': 'rejected'}
        m.deliver(self.state, persist, sender)
        self.assertEqual(len(self.state['outbox']), 1)
        sender.return_value = {'code': 0, 'data': {'message_id': 'received'}}
        m.deliver(self.state, persist, sender)
        self.assertEqual(sender.call_args.kwargs['message_uuid'], before)
        self.assertFalse(self.state['outbox'])
        persist.assert_called_once()
        self.poll([turn('completed', 101)], 150)
        self.assertFalse(self.state['outbox'])


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
                db.execute('CREATE TABLE thread_turns(thread_id,turn_id,status,started_at,completed_at,error_json,final_agent_item_id,rollout_ordinal)')
                db.execute('CREATE TABLE thread_items(thread_id,item_id,item_json)')
                db.execute('INSERT INTO thread_turns VALUES(?,?,?,?,?,?,?,?)',
                           ('yes', 'one', 'completed', 100, 110, None, 'final', 1))
                db.execute('INSERT INTO thread_items VALUES(?,?,?)',
                           ('yes', 'final', json.dumps(dict(type='agentMessage', text='public final'))))
                db.execute('INSERT INTO thread_items VALUES(?,?,?)',
                           ('yes', 'private', json.dumps(dict(type='reasoning', text='private reasoning'))))
                db.execute('INSERT INTO thread_turns VALUES(?,?,?,?,?,?,?,?)',
                           ('yes', 'orphan', 'inProgress', 1, None, None, None, 0))
            before = {p.name: p.read_bytes() for p in home.glob('*.sqlite')}
            snapshot = m.collect(home, ['/work'], 90)
            self.assertEqual([t['id'] for t in snapshot['threads']], ['yes'])
            self.assertEqual(snapshot['turns'][0]['summary'], 'public final')
            self.assertNotIn('private reasoning', json.dumps(snapshot))
            self.assertEqual(before, {p.name: p.read_bytes() for p in home.glob('*.sqlite')})
            self.assertFalse(m.collect(home, ['/work'], 200)['turns'])


if __name__ == '__main__':
    unittest.main()
