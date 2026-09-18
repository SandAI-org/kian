from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from urllib.parse import quote

SCRIPT = Path(__file__).parents[1] / "scripts" / "migrate_vscode_copilot_sessions_macos.py"
SPEC = importlib.util.spec_from_file_location("copilot_migration", SCRIPT)
assert SPEC and SPEC.loader
migration = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = migration
SPEC.loader.exec_module(migration)


def encoded_json(value: dict[str, str]) -> str:
    return json.dumps(value, separators=(",", ":")).encode().hex()


def make_workspace(root: Path, workspace_id: str, container: str, host: str, workspace_path: str) -> Path:
    workspace = root / workspace_id
    workspace.mkdir()
    authority = (
        f"attached-container+{encoded_json({'containerName': '/' + container})}"
        f"@ssh-remote+{encoded_json({'hostName': host})}"
    )
    uri = f"vscode-remote://{quote(authority, safe='@')}{workspace_path}"
    (workspace / "workspace.json").write_text(json.dumps({"folder": uri}))
    return workspace


class MigrationTests(unittest.TestCase):
    def test_workspace_identity_supports_attached_container(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace = make_workspace(Path(directory), "abc", "old", "IDG", "/repo")
            identity = migration.workspace_identity(workspace)
            self.assertIsNotNone(identity)
            assert identity
            self.assertEqual(identity.container_name, "old")
            self.assertEqual(identity.remote_host, "IDG")
            self.assertEqual(identity.workspace_path, "/repo")

    def test_choose_sources_requires_same_host_and_path(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = make_workspace(root, "target", "new", "IDG", "/repo")
            good = make_workspace(root, "good", "old", "IDG", "/repo")
            wrong_host = make_workspace(root, "host", "old", "SenseTime", "/repo")
            wrong_path = make_workspace(root, "path", "old", "IDG", "/other")
            for workspace in (good, wrong_host, wrong_path):
                sessions = workspace / "chatSessions"
                sessions.mkdir()
                (sessions / "session.jsonl").write_text("{}\n")
            self.assertEqual(migration.choose_sources([good, wrong_host, wrong_path], target), [good])

    def test_filter_workspace_identity_selects_exact_host_and_project(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            attn = make_workspace(root, "attn", "old", "IDG", "/workspace/magiattn")
            moe = make_workspace(root, "moe", "old", "IDG", "/workspace/magimoe")
            other_host = make_workspace(root, "other", "old", "SenseTime", "/workspace/magiattn")
            self.assertEqual(
                migration.filter_workspace_identity([attn, moe, other_host], "/workspace/magiattn/", "IDG"),
                [attn],
            )

    def test_merge_skips_index_entries_without_session_files(self) -> None:
        source = {"version": 1, "entries": {"real": {"lastMessageDate": 2}, "ghost": {"lastMessageDate": 3}}}
        target = {"version": 1, "entries": {"target": {"lastMessageDate": 1}}}
        merged, added, skipped = migration.merge_indexes([(source, {"real"})], target, [], "new-authority")
        self.assertEqual(set(merged["entries"]), {"target", "real"})
        self.assertEqual(added, 1)
        self.assertEqual(skipped, 1)

    def test_rewrite_handles_encoded_and_decoded_authorities(self) -> None:
        old = "attached-container%2Bold@ssh-remote%2Bhost"
        new = "attached-container%2Bnew@ssh-remote%2Bhost"
        value = {
            "encoded": f"vscode-remote://{old}/repo",
            "decoded": f"vscode-remote://{migration.unquote(old)}/repo",
        }
        rewritten = migration.rewrite(value, [old], new)
        self.assertIn(new, rewritten["encoded"])
        self.assertIn(migration.unquote(new), rewritten["decoded"])


if __name__ == "__main__":
    unittest.main()
