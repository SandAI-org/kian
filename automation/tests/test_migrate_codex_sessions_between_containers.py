from __future__ import annotations

import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).parents[1] / "scripts" / "migrate_codex_sessions_between_containers.sh"

FAKE_DOCKER = r'''#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "inspect" && "$2" == "-f" ]]; then echo true; exit 0; fi
if [[ "$1" == "inspect" ]]; then
  cat <<'JSON'
[{"Mounts":[{"Type":"bind","Source":"__HOST_SOURCE__","Destination":"/workspace"}]}]
JSON
  exit 0
fi
if [[ "$1" != "exec" ]]; then exit 90; fi
shift
interactive=0
if [[ "${1:-}" == "-i" ]]; then interactive=1; shift; fi
container=$1
shift
if [[ "${1:-}" == "test" ]]; then exit 0; fi
if [[ "${1:-}" == "python3" ]]; then
  [[ $interactive -eq 1 ]] || exit 91
  cat >/dev/null
  if [[ "$container" == "old" ]]; then echo 2; else echo 0; fi
  exit 0
fi
if [[ "${1:-}" == "sh" && "${2:-}" == "-lc" && "${3:-}" == *"rollout-*.jsonl"* ]]; then
  if [[ "$container" == "old" ]]; then echo 2; else echo 0; fi
  exit 0
fi
exit 92
'''


class CodexMigrationTests(unittest.TestCase):
    def run_dry_run(self, workspace: str = "/workspace/repo") -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory() as directory:
            fake_docker = Path(directory) / "docker"
            host_source = Path(directory) / "shared"
            (host_source / "repo").mkdir(parents=True)
            fake_docker.write_text(FAKE_DOCKER.replace("__HOST_SOURCE__", str(host_source)))
            fake_docker.chmod(0o700)
            env = os.environ.copy()
            env["PATH"] = f"{directory}:{env['PATH']}"
            return subprocess.run(
                ["bash", str(SCRIPT), "--source", "old", "--target", "new", "--workspace-dir", workspace, "--dry-run"],
                text=True,
                capture_output=True,
                env=env,
                check=False,
            )

    def test_dry_run_accepts_empty_target_and_same_workspace(self) -> None:
        result = self.run_dry_run()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertRegex(result.stdout, r"host_path=.+/shared/repo")
        self.assertIn("source=old threads=2 rollouts=2", result.stdout)
        self.assertIn("target=new threads=0 rollouts=0", result.stdout)
        self.assertIn("dry-run passed; no data changed", result.stdout)

    def test_requires_absolute_workspace_path(self) -> None:
        result = self.run_dry_run("relative/repo")
        self.assertEqual(result.returncode, 2)
        self.assertIn("must be an absolute path", result.stderr)

    def test_shell_syntax(self) -> None:
        result = subprocess.run(["bash", "-n", str(SCRIPT)], text=True, capture_output=True, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
