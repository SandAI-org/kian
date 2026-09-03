import tempfile
import unittest
from pathlib import Path

from automation.scripts.cleanup_remote_ssh_cache import cleanup, extract_short_hash


class CleanupRemoteSshCacheTests(unittest.TestCase):
    def test_extracts_short_hash_from_incomplete_output(self):
        output = ".remote-ssh/vscode-ssh-host-803ff1b3-4fe60c8b1cdac1c4c17"
        self.assertEqual(extract_short_hash(output), "803ff1b3")

    def test_removes_only_matching_directories(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            first = root / "vscode-ssh-host-803ff1b3-first"
            second = root / "vscode-ssh-host-803ff1b3-second"
            unrelated = root / "vscode-ssh-host-deadbeef-other"
            first.mkdir()
            second.mkdir()
            unrelated.mkdir()

            removed = cleanup("vscode-ssh-host-803ff1b3-truncated", root)

            self.assertEqual(removed, [first.name, second.name])
            self.assertFalse(first.exists())
            self.assertFalse(second.exists())
            self.assertTrue(unrelated.exists())

    def test_rejects_short_or_invalid_hash(self):
        with self.assertRaises(ValueError):
            extract_short_hash("vscode-ssh-host-803ff1")


if __name__ == "__main__":
    unittest.main()
