import copy
import unittest
from contextlib import ExitStack
from unittest import mock

from test_pr_desc_manager import manager


class DescriptionPolicyTest(unittest.TestCase):
    body = ('## DONE\n\n- **Old behavior**.\n\n### Validation\n\n'
            '| Suite | Result |\n| Core | 121 passed |\n\n## TODO in the future\n\n- Follow up.\n')

    def test_automatic_detection_and_sticky_preservation(self):
        self.assertEqual(manager.resolve_description_policy({}, ''), 'rewrite')
        self.assertEqual(manager.resolve_description_policy({}, self.body), 'preserve')
        entry = {'last_body_snapshot': self.body}
        self.assertEqual(manager.resolve_description_policy(entry, self.body), 'rewrite')
        self.assertEqual(manager.resolve_description_policy(entry, self.body + 'human edit'), 'preserve')
        entry['description_effective_mode'] = 'preserve'
        self.assertEqual(manager.resolve_description_policy(entry, self.body), 'preserve')
        entry['description_policy'] = 'rewrite'
        self.assertEqual(manager.resolve_description_policy(entry, self.body + 'human edit'), 'rewrite')
        entry['description_policy'] = 'preserve'
        self.assertEqual(manager.resolve_description_policy(entry, ''), 'preserve')

    def test_targeted_edit_retains_validation_and_future_sections_exactly(self):
        result = manager.apply_preserved_edits(self.body, {
            'edits': [{'old': '- **Old behavior**.', 'new': '- **Updated behavior**.'}],
            'additions': ['- New **feature**.'],
        })
        self.assertIn('- **Updated behavior**.', result)
        self.assertIn('- New **feature**.', result)
        self.assertEqual(manager.editable_description(result)[1], manager.editable_description(self.body)[1])

    def test_unanchored_edits_protected_records_and_injected_sections_are_rejected(self):
        for old, new in [('| Core | 121 passed |', '| Core | 122 passed |'),
                         ('- Follow up.', '- Removed.'),
                         ('## DONE', '## Changed'),
                         ('- missing', '- added'),
                         ('- **Old behavior**.', '## Replacement')]:
            with self.subTest(old=old), self.assertRaises(ValueError):
                manager.apply_preserved_edits(self.body, {'edits': [{'old': old, 'new': new}], 'additions': []})
        with self.assertRaises(ValueError):
            manager.apply_preserved_edits(self.body, {'edits': [], 'additions': ['- X\n## Validation\npassed']})

    def test_repeated_additions_do_not_duplicate_update_heading(self):
        first = manager.apply_preserved_edits(self.body, {'edits': [], 'additions': ['- New **feature**.']})
        second = manager.apply_preserved_edits(first, {'edits': [], 'additions': ['- Another **feature**.']})
        self.assertEqual(second.count('### Incremental Updates'), 1)
        self.assertEqual(manager.editable_description(first)[1], manager.editable_description(second)[1])

    def run_update(self, mode='default', entry=None, latest_changed=False, compare_status='ahead', files=None):
        state = {'managed': {'example/repo#610': copy.deepcopy(entry or {
            'last_head_sha': 'old', 'last_body_snapshot': self.body, 'description_policy': 'preserve'
        })}}
        pr = {'number': 610, 'state': 'open', 'body': self.body, 'head': {'sha': 'new'}, 'title': 'Test'}
        calls = []
        def request(repo, endpoint, method='GET', payload=None):
            calls.append((endpoint, method, payload))
            if method == 'PATCH':
                return {'number': 610, 'body': payload['body']}
            if '/compare/' in endpoint:
                return {'status': compare_status, 'files': files or [{'filename': 'src/x.py', 'patch': '+new'}]}
            if endpoint.endswith('/commits?per_page=100'):
                return []
            current = copy.deepcopy(pr)
            if latest_changed:
                current['body'] += '\nConcurrent manual change'
            return current
        with ExitStack() as stack:
            stack.enter_context(mock.patch.object(manager, 'load_json', return_value=state))
            stack.enter_context(mock.patch.object(manager, 'find_pr', return_value=('example/repo', pr)))
            stack.enter_context(mock.patch.object(manager, 'pull_request_files', return_value=[]))
            stack.enter_context(mock.patch.object(manager, 'request', side_effect=request))
            stack.enter_context(mock.patch.object(manager, 'save_managed'))
            rewrite = stack.enter_context(mock.patch.object(manager, 'summarize_current_diff'))
            generated = stack.enter_context(mock.patch.object(manager, 'generate_description_json', side_effect=lambda prompt, validate, **kw: validate({
                'edits': [{'old': '- **Old behavior**.', 'new': '- **Updated behavior**.'}], 'additions': []
            })))
            try:
                result = manager._update('up', 610, 'example/repo', mode)
            finally:
                self.requests = calls
            return result, state, rewrite, generated

    def test_all_card_rendering_modes_honor_preserve_and_use_incremental_diff(self):
        for mode in ['default', 'simple', 'full']:
            with self.subTest(mode=mode):
                result, state, rewrite, generated = self.run_update(mode)
                self.assertTrue(result[1])
                rewrite.assert_not_called()
                self.assertIn('+new', generated.call_args.args[0])
                self.assertTrue(any('/compare/old...new' in p for p, _, _ in self.requests))
                body = next(payload['body'] for _, method, payload in self.requests if method == 'PATCH')
                self.assertIn('observed at `old`', body)
                self.assertTrue(body.endswith(manager.editable_description(self.body)[1]))
                self.assertEqual(state['managed']['example/repo#610']['last_head_sha'], 'new')

    def test_unchanged_head_never_calls_model_or_writes_pr(self):
        result, state, rewrite, generated = self.run_update(entry={
            'last_head_sha': 'new', 'last_body_snapshot': self.body, 'description_policy': 'preserve'
        })
        self.assertFalse(result[1])
        generated.assert_not_called()
        rewrite.assert_not_called()
        self.assertEqual(self.requests, [])

    def test_concurrent_human_edit_blocks_overwrite(self):
        with self.assertRaisesRegex(RuntimeError, '已变化'):
            self.run_update(latest_changed=True)
        self.assertFalse(any(method == 'PATCH' for _, method, _ in self.requests))

    def test_diverged_or_truncated_comparison_never_rewrites(self):
        for kwargs in [{'compare_status': 'diverged'}, {'files': [{}] * 300}]:
            with self.subTest(kwargs=kwargs), self.assertRaises(RuntimeError):
                self.run_update(**kwargs)
            self.assertFalse(any(method == 'PATCH' for _, method, _ in self.requests))

    def test_explicit_policy_switch_is_persistent_and_does_not_edit_github(self):
        state = {'managed': {}}
        pr = {'body': self.body, 'head': {'sha': 'current'}}
        with mock.patch.object(manager, 'load_json', return_value=state), mock.patch.object(
            manager, 'find_pr', return_value=('example/repo', pr)
        ), mock.patch.object(manager, 'save_managed') as save, mock.patch.object(manager, 'request') as api:
            for policy in ['preserve', 'rewrite', 'auto']:
                manager._set_description_policy(610, 'example/repo', policy)
                self.assertEqual(state['managed']['example/repo#610']['description_policy'], policy)
            self.assertEqual(save.call_count, 3)
            api.assert_not_called()
            self.assertEqual(state['managed']['example/repo#610']['validation_observed_head'], 'current')

    def test_preserve_prompt_contains_complete_human_description_and_no_rewrite_instruction(self):
        body = self.body + ('x' * 13000)
        with mock.patch.object(manager, 'generate_description_json', return_value=body) as generate:
            manager.preserve_description({'number': 610, 'head': {'sha': 'new'}}, body, [], 'old', 'example/repo')
        self.assertIn(body[-13000:], generate.call_args.args[0])
        self.assertIn('No stylistic rewrite', generate.call_args.args[0])
