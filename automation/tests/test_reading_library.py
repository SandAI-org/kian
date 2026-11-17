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
import reading_library as library
import repo_inbox_dashboard as dashboard


class ReadingLibraryTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        override = patch.object(inbox, 'DB_FILE', self.root / 'inbox.sqlite3')
        override.start()
        self.addCleanup(override.stop)
        self.entry = dict(title='A paper', url='https://arxiv.org/abs/2501.12084v2', is_read=False, is_favorite=True, categories=['Infra / hardware'])

    def test_source_identity_handles_arxiv_variants_and_pr_updates(self):
        for url in ['https://arxiv.org/pdf/2501.12084v2.pdf#page=3', 'https://papers.cool/arxiv/2501.12084', 'https://arxiv.org/html/2501.12084v3']:
            self.assertEqual(library.source_key(url), library.source_key(self.entry['url']))
        self.assertEqual(library.source_key('https://github.com/PyTorch/PyTorch/pull/1/files#x'), 'https://github.com/pytorch/pytorch/pull/1')

    def test_import_deduplicates_existing_source_and_preserves_later_user_changes(self):
        inbox.archive([dict(repo='papers', channel='papers', events=[dict(markdown='📌 Existing\n[Original](https://arxiv.org/pdf/2501.12084v1)')])], 'papers')
        result = library.import_entries([self.entry, self.entry])
        self.assertEqual([r['action'] for r in result], ['matched', 'already-imported'])
        event = inbox.snapshot()['events'][0]
        self.assertTrue(event['is_favorite'])
        self.assertFalse(event['is_read'])
        inbox.mark_read([event['id']], True)
        inbox.mark_favorite([event['id']], False)
        library.import_entries([self.entry])
        after = inbox.snapshot()['events']
        self.assertEqual(len(after), 1)
        self.assertTrue(after[0]['is_read'])
        self.assertFalse(after[0]['is_favorite'])
        self.assertEqual(after[0]['library']['categories'], self.entry['categories'])

    def test_done_does_not_imply_favorite_or_invent_read_date(self):
        library.import_entries([dict(self.entry, is_read=True, is_favorite=False)])
        event = inbox.snapshot()['events'][0]
        self.assertTrue(event['is_read'])
        self.assertIsNone(event['read_at'])
        self.assertFalse(event['is_favorite'])

    def test_later_collector_discovery_reuses_imported_paper_and_read_gate(self):
        library.import_entries([dict(self.entry, is_read=True)])
        groups = [dict(repo='papers', channel='papers', events=[dict(markdown='📌 A paper\n中文摘要： New abstract\n[Paper](https://arxiv.org/abs/2501.12084)\n[🔗 papers.cool](https://papers.cool/arxiv/2501.12084)', event_at='2025-01-20T00:00:00Z')])]
        self.assertEqual(inbox.archive(groups, 'papers'), 0)
        events = inbox.snapshot()['events']
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]['summary'], 'New abstract')
        self.assertEqual(inbox.unread_groups(groups, 'papers'), [])
        inbox.mark_read([events[0]['id']], False)
        self.assertEqual(inbox.unread_groups(groups, 'papers'), groups)

    def test_private_pdf_is_explicitly_registered_and_independent_of_original_path(self):
        source = self.root / 'private.pdf'
        source.write_bytes(b'%PDF-1.7\nprivate fixture')
        identity = library.save_document(source)
        self.assertEqual(library.save_document(source), identity)
        source.unlink()
        self.assertEqual(library.get_document(identity), b'%PDF-1.7\nprivate fixture')
        self.assertIsNone(library.get_document('0' * 64))
        source.write_text('not a PDF')
        with self.assertRaises(ValueError):
            library.save_document(source)

    def test_invalid_import_cannot_partially_write_or_register_credentials(self):
        with self.assertRaises(ValueError):
            library.import_entries([self.entry, dict(self.entry, url='file:///etc/passwd')])
        self.assertEqual(inbox.snapshot()['events'], [])
        with self.assertRaises(ValueError):
            library.save_guide('https://user:secret@example.com/', 'bad', '')

    def test_guides_follow_all_updates_and_replace_without_resetting_read_state(self):
        groups = [dict(repo='example/repo', events=[dict(markdown='📌 Title\n[PR](https://github.com/example/repo/pull/1)')])]
        inbox.archive(groups, 'public')
        identity = inbox.snapshot()['events'][0]['id']
        inbox.mark_read([identity], True)
        guide = library.save_guide('https://github.com/Example/Repo/pull/1/files', 'Explanation', '# First')
        groups[0]['events'][0]['markdown'] += '\nUpdated'
        inbox.archive(groups, 'public')
        self.assertEqual(library.save_guide('https://github.com/example/repo/pull/1', 'Explanation', '# Revised'), guide)
        events = inbox.snapshot()['events']
        self.assertTrue(all(e['guides'][0]['id'] == guide for e in events))
        self.assertEqual(sum(e['is_read'] for e in events), 1)
        self.assertEqual(library.get_guide(guide)['markdown'], '# Revised')
        self.assertEqual(len(library.get_guide(guide)['events']), 2)

    def test_relative_images_are_copied_and_path_escape_is_rejected(self):
        image = self.root / 'figure.png'
        image.write_bytes(b'private image')
        md = self.root / 'README.md'
        md.write_text('![Figure](figure.png)')
        guide = library.register_markdown(self.entry['url'], 'Guide', md)
        content = library.get_guide(guide)['markdown']
        name = content.split('/')[-1].rstrip(')')
        self.assertEqual(library.get_asset(guide, name), ('image/png', b'private image'))
        md.write_text('![Bad](../outside.png)')
        with self.assertRaises(ValueError):
            library.register_markdown(self.entry['url'], 'Guide', md)
        self.assertEqual(library.get_guide(guide)['markdown'], content)
        with self.assertRaises(ValueError):
            library.save_guide(self.entry['url'], 'Guide', '', [('bad.svg', 'image/svg+xml', b'<script/>')])

    def test_web_guide_and_asset_are_allowlisted_and_read_writes_still_need_token(self):
        library.import_entries([self.entry])
        guide = library.save_guide(self.entry['url'], 'Guide', '# Test', [('figure.png', 'image/png', b'image')])
        pdf = self.root / 'source.pdf'
        pdf.write_bytes(b'%PDF-1.7\nregistered source')
        document = library.save_document(pdf)
        pdf.unlink()
        server = ThreadingHTTPServer(('127.0.0.1', 0), dashboard.make_handler(0))
        port = server.server_port
        server.RequestHandlerClass = dashboard.make_handler(port)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        base = 'http://127.0.0.1:' + str(port)
        for route, mime in [('/library-document/'+document+'.pdf', 'application/pdf'), ('/guide/'+guide, 'text/html'), ('/api/guide/'+guide, 'application/json'), ('/guide-assets/'+guide+'/figure.png', 'image/png'), ('/guide.js', 'text/javascript'), ('/vendor/markdown-it/dist/browser/markdown-it.umd.min.js', 'text/javascript'), ('/vendor/katex/dist/katex.min.js', 'text/javascript'), ('/vendor/markdown-it-texmath/texmath.js', 'text/javascript')]:
            with urllib.request.urlopen(base+route) as response:
                self.assertIn(mime, response.headers['Content-Type'])
                if route.startswith('/api/'):
                    data = json.load(response)
                    self.assertEqual(data['markdown'], '# Test')
                    self.assertNotIn('source_key', data)
                if route.startswith('/guide/'):
                    self.assertIn("script-src 'self'", response.headers['Content-Security-Policy'])
        for route in ['/library-document/'+'f'*64+'.pdf', '/library-document/../../etc/passwd', '/api/guide/'+'f'*64, '/guide-assets/'+guide+'/secret.txt', '/vendor/../../reading_library.py', '/guide-assets/'+guide+'/../../reading_library.py']:
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(base+route)
            self.assertEqual(error.exception.code, 404)
        request = urllib.request.Request(base+'/api/read', data=json.dumps({'ids':[data['events'][0]['id']], 'is_read':True}).encode(), headers={'Content-Type':'application/json'}, method='POST')
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(request)
        self.assertEqual(error.exception.code, 403)


if __name__ == '__main__':
    unittest.main()
