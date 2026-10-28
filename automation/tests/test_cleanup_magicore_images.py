import copy
import contextlib
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from automation.scripts import cleanup_magicore_images as cleanup


class TestMagicoreImageCleanup(unittest.TestCase):
    def test_verified_alias_resume_does_not_reject_its_old_inventory_digest(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            audit = root / 'items/latest'
            audit.mkdir(parents=True)
            receipt = {'tag': 'latest', 'new_digest': 'clean-digest', 'verified': True, 'status': 'completed'}
            (audit / 'receipt.json').write_text(json.dumps(receipt))
            registry = Mock()
            registry.manifest.return_value = ({'layers': []}, 'clean-digest')
            args = SimpleNamespace(state_dir=root, repository='registry/project/image')
            with patch.object(cleanup, 'Registry', return_value=registry), patch.object(cleanup, 'command') as command:
                self.assertEqual(cleanup.process_image(args, {'tag': 'latest', 'expected_digest': 'old-digest'}, Mock()), receipt)
            command.assert_not_called()
            registry.publish.assert_not_called()

    def test_special_aliases_require_individual_authorization(self):
        items = [{'tag': '465cdek', 'commit': None}]
        with self.assertRaisesRegex(ValueError, 'unauthorized'):
            cleanup.validate_plan(items, [])
        cleanup.validate_plan(items, ['465cdek'])
        with self.assertRaisesRegex(ValueError, 'unauthorized'):
            cleanup.validate_plan([{'tag': 'latest', 'commit': None}], ['465cdek'])
        with self.assertRaisesRegex(ValueError, 'alias'):
            cleanup.validate_plan([], ['../escape'])
        cleanup.validate_plan([{'tag': 'abc1234', 'commit': 'a'*40}], [])

    def test_manifest_conversion_preserves_blob_identity_and_input(self):
        manifest = {'schemaVersion': 2, 'mediaType': 'application/vnd.oci.image.manifest.v1+json',
                    'config': {'digest': 'sha256:config', 'size': 10, 'mediaType': 'application/vnd.oci.image.config.v1+json'},
                    'layers': [{'digest': 'sha256:layer', 'size': 20, 'mediaType': 'application/vnd.oci.image.layer.v1.tar+gzip'}]}
        before = copy.deepcopy(manifest)
        converted = cleanup.docker_manifest(manifest)
        self.assertEqual(manifest, before)
        self.assertEqual(converted['mediaType'], cleanup.DOCKER_MANIFEST)
        self.assertEqual(converted['layers'][0]['digest'], manifest['layers'][0]['digest'])
        self.assertEqual(converted['config']['digest'], manifest['config']['digest'])
        self.assertEqual(converted['layers'][0]['mediaType'], cleanup.DOCKER_LAYER)
        with self.assertRaises(ValueError):
            cleanup.docker_manifest({'schemaVersion': 2, 'manifests': []})
        manifest['layers'][0]['mediaType'] = 'application/vnd.oci.image.layer.v1.tar+zstd'
        with self.assertRaises(ValueError):
            cleanup.docker_manifest(manifest)

    def test_preview_rejects_runtime_or_base_layer_changes(self):
        original = {'Config': {'Entrypoint': ['entry'], 'Cmd': None, 'Env': ['A=B']},
                    'RootFS': {'Layers': ['base']}, 'Os': 'linux', 'Architecture': 'amd64'}
        preview = copy.deepcopy(original)
        preview['RootFS']['Layers'].append('deletions')
        preview['Config']['Cmd'] = []
        cleanup.verify_preview(original, preview)
        preview['Config']['Env'] = ['A=C']
        with self.assertRaisesRegex(ValueError, 'configuration'):
            cleanup.verify_preview(original, preview)
        preview['Config']['Env'] = ['A=B']
        preview['RootFS']['Layers'][0] = 'other-base'
        with self.assertRaisesRegex(ValueError, 'layers'):
            cleanup.verify_preview(original, preview)

    def test_cleanup_preserves_untracked_tools_and_rejects_wrong_checkout(self):
        namespace = {}
        exec(cleanup.CLEANUP, namespace)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ['apps', '.git', 'Mooncake', 'nccl-tests', 'unfamiliar-base-tool']:
                (root / name).mkdir()
                (root / name / 'content').write_text(name)
            (root / 'README.md').write_text('source')
            item = {'commit': 'a' * 40, 'tracked_roots': ['apps', 'README.md']}
            path = lambda name: root if name == '/workspace' else Path(name)
            with patch.dict(namespace, {'Path': path}), patch.object(namespace['subprocess'], 'check_output', return_value='b' * 40):
                with self.assertRaisesRegex(ValueError, 'checkout'):
                    namespace['cleanup'](item)
            self.assertTrue((root / 'apps').exists())
            with patch.dict(namespace, {'Path': path}), patch.object(namespace['subprocess'], 'check_output', return_value='a' * 40), contextlib.redirect_stdout(io.StringIO()):
                namespace['cleanup'](item)
            self.assertEqual(sorted(p.name for p in root.iterdir()), ['nccl-tests', 'unfamiliar-base-tool'])
            self.assertEqual((root / 'nccl-tests/content').read_text(), 'nccl-tests')

    def test_manual_source_inventory_mismatch_blocks_deletion(self):
        namespace = {}
        exec(cleanup.CLEANUP, namespace)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'apps').mkdir()
            (root / 'nccl-tests').mkdir()
            item = {'commit': None, 'tracked_roots': ['apps'],
                    'source_review': {'workspace_entries': ['apps']}}
            path = lambda name: root if name == '/workspace' else Path(name)
            with patch.dict(namespace, {'Path': path}):
                with self.assertRaisesRegex(ValueError, 'inventory changed'):
                    namespace['cleanup'](item)
                self.assertTrue((root / 'apps').exists())
                item['source_review']['workspace_entries'].append('nccl-tests')
                with contextlib.redirect_stdout(io.StringIO()):
                    namespace['cleanup'](item)
            self.assertEqual(sorted(p.name for p in root.iterdir()), ['nccl-tests'])

    def test_changed_remote_tag_blocks_manifest_put(self):
        registry = object.__new__(cleanup.Registry)
        registry.manifest = Mock(return_value=({}, 'newer-digest'))
        registry.request = Mock()
        with self.assertRaisesRegex(ValueError, 'changed'):
            registry.publish('abc1234', {}, 'reviewed-digest')
        registry.request.assert_not_called()


if __name__ == '__main__':
    unittest.main()
