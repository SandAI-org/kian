import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from automation.scripts.file_transfer import Endpoint
from automation.scripts.sync_git_aliases import require_config, sync


class SyncGitAliasesTests(unittest.TestCase):
    def test_normalizes_valid_private_configuration(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            script = root / "set_aliases.sh"
            script.write_text("#!/bin/sh\n", encoding="utf-8")
            config = {
                "git_alias_sync": {
                    "source_script": str(script),
                    "source_repo": str(root),
                    "targets": [{"machine": "example", "path": "/private/set_aliases.sh"}],
                }
            }

            source, repo, targets = require_config(config)

            self.assertEqual(source, script.resolve())
            self.assertEqual(repo, root.resolve())
            self.assertEqual(targets, [{"machine": "example", "path": "/private/set_aliases.sh"}])

    def test_rejects_missing_targets(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            script = root / "set_aliases.sh"
            script.write_text("#!/bin/sh\n", encoding="utf-8")
            config = {
                "git_alias_sync": {
                    "source_script": str(script),
                    "source_repo": str(root),
                    "targets": [],
                }
            }

            with self.assertRaisesRegex(RuntimeError, "targets"):
                require_config(config)

    @patch("automation.scripts.sync_git_aliases.direct_transfer")
    @patch("automation.scripts.sync_git_aliases.translate_remote")
    @patch("automation.scripts.sync_git_aliases.run")
    def test_sync_distributes_without_executing_setup_script(self, run, translate_remote, direct_transfer):
        source = Path("/private/set_aliases.sh")
        translate_remote.return_value = Endpoint("example-host", "/mapped/set_aliases.sh")

        sync(source, [{"machine": "example", "path": "/container/set_aliases.sh"}])

        run.assert_called_once_with(["bash", "-n", str(source)])
        direct_transfer.assert_called_once()


if __name__ == "__main__":
    unittest.main()
