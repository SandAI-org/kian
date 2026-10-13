import tempfile
import unittest
from pathlib import Path
from unittest import mock

from automation.scripts import init_tmp_workspace as initializer
from automation.scripts.file_transfer import Endpoint


class TmpWorkspaceInitializerTest(unittest.TestCase):
    def test_local_initialization_creates_standard_structure_and_gitignore(self):
        with tempfile.TemporaryDirectory() as directory:
            workspace = Path(directory)

            result = initializer.initialize(Endpoint(None, str(workspace)))

            self.assertEqual(result, str(workspace / ".tmp"))
            for name in initializer.TMP_DIRECTORIES:
                self.assertTrue((workspace / ".tmp" / name).is_dir())
            self.assertEqual((workspace / ".tmp" / ".gitignore").read_text(), "**\n")

    def test_initialization_is_idempotent_and_preserves_existing_gitignore(self):
        with tempfile.TemporaryDirectory() as directory:
            workspace = Path(directory)
            (workspace / ".tmp").mkdir()
            gitignore = workspace / ".tmp" / ".gitignore"
            gitignore.write_text("custom-entry\n", encoding="utf-8")

            initializer.initialize(Endpoint(None, str(workspace)))
            initializer.initialize(Endpoint(None, str(workspace)))

            self.assertEqual(gitignore.read_text(), "custom-entry\n\n**\n")

    def test_missing_workspace_is_not_created(self):
        with tempfile.TemporaryDirectory() as directory:
            missing = Path(directory) / "missing"
            with self.assertRaises(FileNotFoundError):
                initializer.initialize(Endpoint(None, str(missing)))
            self.assertFalse(missing.exists())

    @mock.patch.object(initializer, "ssh")
    def test_remote_initialization_uses_translated_endpoint_and_safe_checks(self, ssh):
        endpoint = Endpoint("remote-host", "/mounted/project")

        result = initializer.initialize(endpoint)

        self.assertEqual(result, "/mounted/project/.tmp")
        host, command = ssh.call_args.args
        self.assertEqual(host, "remote-host")
        self.assertIn("test -d /mounted/project", command)
        self.assertIn("mkdir -p", command)
        self.assertIn("/mounted/project/.tmp/.tmp_chats", command)
        self.assertIn("grep -Fqx '**' /mounted/project/.tmp/.gitignore", command)


if __name__ == "__main__":
    unittest.main()
