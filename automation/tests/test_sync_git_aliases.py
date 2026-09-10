import tempfile
import unittest
from pathlib import Path

from automation.scripts.sync_git_aliases import require_config


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
                    "verify_aliases": ["update"],
                    "targets": [{"machine": "example", "path": "/private/set_aliases.sh"}],
                }
            }

            source, repo, targets, aliases = require_config(config)

            self.assertEqual(source, script.resolve())
            self.assertEqual(repo, root.resolve())
            self.assertEqual(targets, [{"machine": "example", "path": "/private/set_aliases.sh"}])
            self.assertEqual(aliases, ["update"])

    def test_rejects_missing_targets(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            script = root / "set_aliases.sh"
            script.write_text("#!/bin/sh\n", encoding="utf-8")
            config = {
                "git_alias_sync": {
                    "source_script": str(script),
                    "source_repo": str(root),
                    "verify_aliases": ["update"],
                    "targets": [],
                }
            }

            with self.assertRaisesRegex(RuntimeError, "targets"):
                require_config(config)


if __name__ == "__main__":
    unittest.main()
