import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import papers_cool_watch as papers
import public_repo_monitor as monitor
import repo_inbox as inbox


def page(identifier='2610.12345', title='GPU kernel fusion for transformer inference', day='2026-10-30', total=1):
    return f'''<h1>Computer Science</h1><a class="date">{day}</a>Total: {total}
    <div id="{identifier}" class="panel paper"><h2><a class="title-link notranslate">{title}</a></h2>
    <a class="author notranslate">A &amp; B</a><p class="summary notranslate">A CUDA kernel improves GPU memory use in transformer inference.</p>
    <span class="date-data">2026-10-29 13:00:00 UTC</span></div>'''


class PapersCoolWatchTest(unittest.TestCase):
    def test_parser_keeps_title_abstract_authors_and_source_date(self):
        found, day = papers.parse_page(page(), 'listing')
        self.assertEqual(day, '2026-10-30')
        self.assertEqual(found[0]['author'], 'A & B')
        self.assertEqual(found[0]['published'], '2026-10-29T13:00:00Z')
        self.assertEqual(found[0]['original'], 'https://arxiv.org/abs/2610.12345')

    def test_relevance_requires_system_evidence_and_custom_exclusions_apply(self):
        self.assertGreaterEqual(papers.importance({'title': 'FSDP distributed training', 'body': 'All-reduce overlap on NVIDIA GPU.'}, {})[0], 8)
        self.assertGreaterEqual(papers.importance({'title': 'GPU architecture through microbenchmarking', 'body': 'We study NVIDIA GPU cores.'}, {})[0], 8)
        for title, body in [('An efficient image classifier', 'GPU training gives good accuracy.'),
                            ('A new support vector kernel', 'Machine learning improves a medical task.'),
                            ('Preserving utility in LLM unlearning', 'Our model preserves accuracy by preserving prior learning.')]:
            self.assertEqual(papers.importance({'title': title, 'body': body}, {})[0], 0)
        self.assertEqual(papers.importance({'title': 'AMD GPU kernel fusion', 'body': 'CUDA'}, {'exclude_title_patterns': ['AMD']})[0], 0)

    def test_pagination_fetches_every_page_and_rejects_repeated_pages(self):
        def fetch(url):
            return page('2610.00002' if 'skip=1' in url else '2610.00001', total=2)
        found, _ = papers.listing(fetch, 'https://papers.cool/arxiv/cs.DC')
        self.assertEqual(len(found), 2)
        with self.assertRaises(ValueError):
            papers.listing(lambda _: page(total=2), 'listing')

    def test_cross_lists_versions_titles_and_bootstrap_do_not_repeat(self):
        source = {'arxiv_categories': ['cs.DC', 'cs.LG'], 'venues': [], 'bootstrap_limit': 1}
        selected, state = papers.collect(source, {}, '2026-11-01T00:00:00Z', lambda _: page())
        self.assertEqual(len(selected), 1)
        again, _ = papers.collect(source, state, '2026-11-01T01:00:00Z', lambda _: page('2610.12345v2'))
        self.assertEqual(again, [])
        self.assertEqual(papers.keys(selected[0])[1], papers.keys(dict(selected[0], title='GPU kernel-fusion for transformer inference!'))[1])

    def test_existing_proceedings_are_baselined_and_new_papers_are_emitted(self):
        source = {'arxiv_categories': [], 'venues': ['MLSYS']}
        selected, state = papers.collect(source, {}, 'now', lambda _: page('old@MLSYS'))
        self.assertEqual(selected, [])
        selected, _ = papers.collect(source, state, 'later', lambda _: page('new@MLSYS', title='New GPU kernel fusion for transformers'))
        self.assertEqual(len(selected), 1)

    def test_reconnect_visits_missed_days_without_advancing_on_failure(self):
        urls = []
        def fetch(url):
            urls.append(url)
            day = '2026-10-28' if 'date=2026-10-28' in url else '2026-10-29' if 'date=2026-10-29' in url else '2026-10-30'
            return page('2610.' + day[-2:].zfill(5), title='GPU kernel fusion for transformer inference ' + day, day=day)
        old = {'last_check': 'earlier', 'arxiv_day': '2026-10-28'}
        selected, state = papers.collect({'arxiv_categories': ['cs.DC']}, old, 'now', fetch)
        self.assertEqual(len(selected), 3)
        self.assertEqual(state['arxiv_day'], '2026-10-30')
        self.assertTrue(any('date=2026-10-29' in u for u in urls))
        with self.assertRaises(ValueError):
            papers.collect({'arxiv_categories': ['cs.DC']}, old, 'now', lambda _: '<html>blocked</html>')
        self.assertEqual(old['arxiv_day'], '2026-10-28')

    def test_paper_source_uses_summaries_and_durable_separate_read_channel(self):
        source = {'id': 'infra', 'type': 'papers_cool', 'name': 'Infra', 'arxiv_categories': ['cs.DC']}
        with patch.object(monitor, 'web_page_get', return_value=page()):
            config, blocks, state = monitor.collect_source(source, {}, '2026-11-01T00:00:00Z')
        self.assertEqual(blocks[0]['summary_kind'], 'paper')
        with patch.object(monitor, 'copilot_chinese_summaries', return_value={blocks[0]['summary_key']: '内核融合减少显存访问。'}):
            group = monitor.prepare_notification_group(config, state, blocks)
        self.assertEqual(group['channel'], 'papers')
        with tempfile.TemporaryDirectory() as directory, patch.object(inbox, 'DB_FILE', Path(directory) / 'inbox.sqlite3'):
            self.assertEqual(inbox.archive([group], 'public'), 1)
            item = inbox.snapshot()['events'][0]
            self.assertEqual(item['channel'], 'papers')
            self.assertEqual(item['kind'], 'paper')
            self.assertIn('减少显存', item['summary'])
            inbox.mark_read([item['id']], True)
            self.assertEqual(inbox.archive([group], 'public'), 0)
            self.assertTrue(inbox.snapshot()['events'][0]['is_read'])

    def test_paper_summary_retries_invalid_model_json_once(self):
        block = {'summary_kind': 'paper', 'summary_key': 'paper:one', 'markdown': monitor.SUMMARY_MARKER}
        with patch.object(monitor, 'copilot_chinese_summaries', side_effect=[ValueError('Extra data'), {'paper:one': '中文摘要'}]) as summarize:
            result = monitor.add_chinese_summaries([block])
        self.assertIn('中文摘要', result[0])
        self.assertEqual(summarize.call_count, 2)

    def test_initial_papers_are_queued_and_archived_while_notifications_are_paused(self):
        source = {'id': 'infra', 'type': 'papers_cool', 'name': 'Infra', 'arxiv_categories': ['cs.DC']}
        with patch.object(monitor, 'web_page_get', return_value=page()):
            config, blocks, next_state = monitor.collect_source(source, {}, '2026-11-01T00:00:00Z')
        state = {}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(monitor, 'configure'), patch.object(monitor, 'WATCH', {'sources': [source]}), \
                    patch.object(monitor, 'INBOX_CONFIG', {'services': {'repo_inbox': {'enabled': True}}}), \
                    patch.object(monitor, 'load_state', return_value=state), patch.object(monitor, 'save_state'), \
                    patch.object(monitor, 'STATE_DIR', root), patch.object(monitor, 'LOCK_FILE', root / 'lock'), \
                    patch.object(monitor, 'collect_source', return_value=(config, blocks, next_state)), \
                    patch.object(monitor, 'copilot_chinese_summaries', return_value={blocks[0]['summary_key']: '摘要'}), \
                    patch.object(monitor, 'in_quiet_hours', return_value=True), patch.object(monitor, 'send_card') as send, \
                    patch.object(inbox, 'DB_FILE', root / 'inbox.sqlite3'):
                monitor.run()
                send.assert_not_called()
                self.assertEqual(inbox.snapshot()['events'][0]['channel'], 'papers')
                self.assertEqual(len(state['pending_notifications'][0]['events']), 1)
                self.assertEqual(state['sources']['infra']['arxiv_day'], '2026-10-30')


if __name__ == '__main__':
    unittest.main()
