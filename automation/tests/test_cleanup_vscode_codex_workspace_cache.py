import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from automation.scripts.cleanup_vscode_codex_workspace_cache import (
    cleanup_database,
    find_workspace,
    inspect_database,
)


class CleanupCodexWorkspaceCacheTests(unittest.TestCase):
    def create_workspace(self, root: Path) -> Path:
        directory = root / "workspace-id"
        directory.mkdir()
        host = '{"hostName":"B300-idg35-1"}'.encode().hex()
        (directory / "workspace.json").write_text(
            json.dumps(
                {
                    "folder": (
                        "vscode-remote://ssh-remote+"
                        f"{host}/mnt/Sandai/kato/workspace/copilot/envs"
                    )
                }
            )
        )
        database = directory / "state.vscdb"
        with sqlite3.connect(database) as connection:
            connection.execute("CREATE TABLE ItemTable (key TEXT UNIQUE, value BLOB)")
            connection.execute(
                "INSERT INTO ItemTable VALUES (?, ?)",
                (
                    "agentSessions.model.cache",
                    json.dumps(
                        [
                            {
                                "providerType": "openai-codex",
                                "resource": "openai-codex://route/local/thread",
                            },
                            {
                                "providerType": "local",
                                "resource": "vscode-chat-session://local/keep",
                            },
                        ]
                    ),
                ),
            )
            connection.execute(
                "INSERT INTO ItemTable VALUES (?, ?)",
                (
                    "agentSessions.state.cache",
                    json.dumps(
                        [
                            {"resource": "openai-codex://route/local/thread"},
                            {"resource": "vscode-chat-session://local/keep"},
                        ]
                    ),
                ),
            )
        return database

    def test_finds_only_the_exact_host_and_workspace(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            database = self.create_workspace(root)
            found, decoded = find_workspace(
                root, "B300-idg35-1", "/mnt/Sandai/kato/workspace/copilot/envs"
            )
            self.assertEqual(found, database)
            self.assertIn('"hostName":"B300-idg35-1"', decoded)

    def test_cleans_only_codex_entries_and_creates_backup(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            database = self.create_workspace(root)
            backup, removed = cleanup_database(database, root / "backups")

            self.assertTrue(backup.is_file())
            self.assertEqual(sum(removed.values()), 2)
            self.assertEqual(sum(inspect_database(database).values()), 0)
            with sqlite3.connect(database) as connection:
                model = json.loads(
                    connection.execute(
                        "SELECT value FROM ItemTable WHERE key='agentSessions.model.cache'"
                    ).fetchone()[0]
                )
            self.assertEqual(model[0]["providerType"], "local")
            self.assertEqual(sum(inspect_database(backup).values()), 2)

    def test_rejects_ambiguous_or_missing_workspace(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.create_workspace(root)
            with self.assertRaises(ValueError):
                find_workspace(root, "other-host", "/workspace")


if __name__ == "__main__":
    unittest.main()
