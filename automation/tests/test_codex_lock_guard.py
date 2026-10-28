import json
import os
from pathlib import Path
import sqlite3
import tempfile
import time
import unittest
from unittest.mock import patch

from automation.scripts import codex_lock_guard as guard


def window_text(pid, connection, host="example-host", container="dev", earlier=""):
    authority = "ssh-remote+" + json.dumps({"hostName": host}).encode().hex()
    if container:
        authority = "attached-container+" + json.dumps({"containerName": "/" + container}).encode().hex() + "@" + authority
    return (earlier + f"Started local extension host with pid {pid}.\nremoteAuthority={authority})\n"
            f"Creating a socket (renderer-ExtensionHost-{connection}) was successful\n")


OLD = "aaaaaaaa-0000-0000-0000-000000000000"
NEW = "bbbbbbbb-0000-0000-0000-000000000000"
TID = "00000000-1111-2222-3333-444444444444"


class CodexLockGuardTests(unittest.TestCase):
    def test_deleted_log_handles_still_identify_old_connection(self):
        with tempfile.TemporaryDirectory() as d:
            proc, home, request = self.make_remote_fixture(Path(d))
            server = Path(request['server_root'])
            log = server / 'data/logs/session/old/openai.chatgpt/Codex.log'
            log.unlink()
            fd = proc / '11/fd/5'
            fd.unlink()
            fd.write_text('old log')
            agent = proc / '11/fd/6'
            agent.write_text('[aaaaaaaa][ExtensionHostConnection] <11> Launched Extension Host Process\n')
            original = os.readlink
            def readlink(path):
                if Path(path) == fd:
                    return str(log) + ' (deleted)'
                if Path(path) == agent:
                    return str(server / 'data/logs/session/remoteagent.log') + ' (deleted)'
                return original(path)
            with patch.object(guard, 'PROC', proc), patch.object(guard.os, 'readlink', side_effect=readlink):
                found = guard.candidates(request)
                self.assertEqual(len(found), 1)
                self.assertEqual(found[0]['old']['connection'], 'aaaaaaaa')

    def test_manual_history_recovers_connection_outside_normal_tail(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            old = root / '20260101/window1/renderer.log'
            current = root / '20260102/window1/renderer.log'
            old.parent.mkdir(parents=True)
            current.parent.mkdir(parents=True)
            old.write_text(window_text(1, OLD))
            current.write_text(window_text(1, OLD) + 'padding\n' * 300000 + window_text(2, NEW))
            with patch.object(guard.subprocess, 'check_output', return_value='2 Code Helper (Plugin)\n'):
                self.assertEqual(guard.local_connections(root)[('example-host', 'dev')]['replaced'], {})
                links = guard.local_connections(root, include_history=True)[('example-host', 'dev')]
                self.assertEqual(links['active'], ['bbbbbbbb'])
                self.assertEqual(links['replaced'], {'aaaaaaaa': ['bbbbbbbb']})

    def test_manual_uses_current_workspace_registry_when_service_disabled(self):
        config = {"services": {"codex_lock_guard": {"enabled": False}},
                  "codex_activity_monitor": {"targets": [
                      {"id": "current", "host": "host", "workspaces": ["/new"],
                       "thread_workspaces": {TID: "/new"}}]},
                  "codex_lock_guard": {"targets": [{"id": "obsolete"}]}}
        targets = guard.manual_targets(config)
        self.assertEqual([t["id"] for t in targets], ["current"])
        self.assertEqual(targets[0]["thread_workspaces"], {TID: "/new"})
        self.assertNotIn("server_root", config["codex_activity_monitor"]["targets"][0])

    def test_exact_thread_mapping_does_not_allow_other_threads_or_active_turns(self):
        with tempfile.TemporaryDirectory() as d:
            proc, home, request = self.make_remote_fixture(Path(d))
            request.update(workspaces=["/registered"], thread_workspaces={TID: "/registered"})
            with patch.object(guard, "PROC", proc):
                self.assertEqual(len(guard.candidates(request)), 1)
                wrong = {**request, "thread_workspaces": {"other-thread": "/registered"}}
                self.assertEqual(guard.candidates(wrong), [])
                with sqlite3.connect(home / "thread_history_1.sqlite") as db:
                    db.execute("UPDATE thread_turns SET status='inProgress'")
                self.assertEqual(guard.candidates(request), [])

    def make_remote_fixture(self, root):
        proc, home, server = root / "proc", root / "codex", root / "server"
        home.mkdir()
        (home / "sessions").mkdir()
        rollout = home / "sessions/r.jsonl"
        rollout.write_text("{}\n")
        os.utime(rollout, (time.time()-300, time.time()-300))
        with sqlite3.connect(home / "state_5.sqlite") as db:
            db.execute("CREATE TABLE threads(id,cwd,rollout_path)")
            db.execute("INSERT INTO threads VALUES(?,?,?)", (TID, "/workspace", str(rollout)))
        with sqlite3.connect(home / "thread_history_1.sqlite") as db:
            db.execute("CREATE TABLE thread_turns(thread_id,status,rollout_ordinal)")
            db.execute("INSERT INTO thread_turns VALUES(?,?,?)", (TID, "completed", 1))
        lock = home / "thread-writer-locks" / (TID + ".lock")
        lock.parent.mkdir()
        lock.touch()
        stat = lock.stat()
        device = f"{os.major(stat.st_dev):02x}:{os.minor(stat.st_dev):02x}:{stat.st_ino}"
        (proc / "self/ns").mkdir(parents=True)
        (proc / "self/ns/mnt").symlink_to("mnt:[1]")
        (proc / "locks").write_text(f"1: FLOCK ADVISORY WRITE 10 {device} 0 EOF\n")
        session = server / "data/logs/session"
        session.mkdir(parents=True)
        (session / "remoteagent.log").write_text(
            "[aaaaaaaa][ExtensionHostConnection] <11> Launched Extension Host Process\n"
            "[bbbbbbbb][ExtensionHostConnection] <21> Launched Extension Host Process\n")
        for pid, parent, start, name in [(10, 11, 100, "old"), (20, 21, 200, "new")]:
            p = proc / str(pid)
            (p / "ns").mkdir(parents=True)
            (p / "ns/mnt").symlink_to("mnt:[1]")
            (p / "cmdline").write_bytes(b"/extension/bin/linux-x86_64/codex\0app-server\0")
            fields = ["S", str(parent)] + ["0"] * 17 + [str(start)]
            (p / "stat").write_text(f"{pid} (codex) " + " ".join(fields))
            log = session / name / "openai.chatgpt/Codex.log"
            log.parent.mkdir(parents=True)
            log.write_text(f"Request failed thread {TID} already has an active writer method=thread/resume\n"
                           if name == "new" else "idle\n")
            fds = proc / str(parent) / "fd"
            fds.mkdir(parents=True)
            (fds / "5").symlink_to(log)
        request = {"codex_home": str(home), "server_root": str(server),
                   "workspaces": ["/workspace"], "quiet_seconds": 120,
                   "connections": {"active": ["bbbbbbbb"], "replaced": {"aaaaaaaa": ["bbbbbbbb"]}}}
        return proc, home, request

    def test_full_scan_requires_matching_namespace_lock_connection_and_idle_turn(self):
        with tempfile.TemporaryDirectory() as d:
            proc, home, request = self.make_remote_fixture(Path(d))
            with patch.object(guard, "PROC", proc):
                found = guard.candidates(request)
                self.assertEqual(len(found), 1)
                self.assertEqual(found[0]["old"]["pid"], 10)
                # A currently connected old writer is never a stale writer.
                active = {**request, "connections": {"active": ["aaaaaaaa", "bbbbbbbb"],
                                                       "replaced": {"aaaaaaaa": ["bbbbbbbb"]}}}
                self.assertEqual(guard.candidates(active), [])
                with sqlite3.connect(home / "thread_history_1.sqlite") as db:
                    db.execute("UPDATE thread_turns SET status='inProgress'")
                diagnostics = {}
                self.assertEqual(guard.candidates(request, diagnostics), [])
                self.assertEqual(diagnostics, {"thread active or unknown": 1})
                with sqlite3.connect(home / "thread_history_1.sqlite") as db:
                    db.execute("UPDATE thread_turns SET status='completed'")
                (proc / "10/ns/mnt").unlink()
                (proc / "10/ns/mnt").symlink_to("mnt:[other-container]")
                self.assertEqual(guard.candidates(request), [])

    def test_full_scan_rejects_backend_with_another_owned_thread_or_running_child(self):
        with tempfile.TemporaryDirectory() as d:
            proc, home, request = self.make_remote_fixture(Path(d))
            with patch.object(guard, "PROC", proc):
                child = proc / "12"
                child.mkdir()
                (child / "stat").write_text("12 (python) S 10 " + "0 " * 18)
                (child / "cmdline").write_bytes(b"python3\0training.py\0")
                self.assertEqual(guard.candidates(request), [])
                (child / "stat").unlink()
                (child / "cmdline").unlink()
                child.rmdir()
                second = home / "thread-writer-locks" / ("11111111-1111-2222-3333-444444444444.lock")
                second.touch()
                stat = second.stat()
                device = f"{os.major(stat.st_dev):02x}:{os.minor(stat.st_dev):02x}:{stat.st_ino}"
                with (proc / "locks").open("a") as f:
                    f.write(f"2: FLOCK ADVISORY WRITE 10 {device} 0 EOF\n")
                self.assertEqual(guard.candidates(request), [])

    def test_only_replaced_connections_of_live_windows_are_eligible(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            p = root / "session/window1/renderer.log"
            p.parent.mkdir(parents=True)
            p.write_text(window_text(2, NEW, earlier=window_text(1, OLD)))
            with patch.object(guard.subprocess, "check_output", return_value="2 Code Helper (Plugin)\n"):
                links = guard.local_connections(root)[("example-host", "dev")]
            self.assertEqual(links, {"active": ["bbbbbbbb"], "replaced": {"aaaaaaaa": ["bbbbbbbb"]}})
            # A different live window still using the old connection prevents termination.
            p2 = root / "session/window2/renderer.log"
            p2.parent.mkdir()
            p2.write_text(window_text(3, OLD))
            with patch.object(guard.subprocess, "check_output", return_value="2 Code Helper (Plugin)\n3 Code Helper (Plugin)\n"):
                self.assertEqual(guard.local_connections(root)[("example-host", "dev")]["replaced"], {})
            # Closing/reopening as a different window also leaves usable ownership evidence.
            p.write_text(window_text(2, NEW))
            with patch.object(guard.subprocess, "check_output", return_value="2 Code Helper (Plugin)\n"):
                self.assertEqual(guard.local_connections(root)[("example-host", "dev")]["replaced"],
                                 {"aaaaaaaa": ["bbbbbbbb"]})
            # An alternate alias still showing that connection also protects the writer.
            p2.write_text(window_text(3, OLD, host="alternate-alias"))
            with patch.object(guard.subprocess, "check_output", return_value="2 Code Helper (Plugin)\n3 Code Helper (Plugin)\n"):
                self.assertEqual(guard.local_connections(root)[("example-host", "dev")]["replaced"], {})

    def test_unknown_or_unconnected_window_is_not_evidence(self):
        self.assertIsNone(guard.window_connections("Started local extension host with pid 1.\n"))
        parsed = guard.window_connections(window_text(3, NEW, container=None))
        self.assertEqual(parsed[1], ("example-host", None))

    def test_success_cancels_earlier_conflict_for_same_thread(self):
        failure = f"Request failed thread {TID} already has an active writer method=thread/resume"
        self.assertEqual(guard.latest_conflicts(failure), {TID})
        self.assertEqual(guard.latest_conflicts(failure + f"\nmaybe_resume_success conversationId={TID}"), set())
        self.assertEqual(guard.latest_conflicts(failure.replace("thread/resume", "other")), set())

    def test_idle_gate_rejects_active_recent_and_non_allowlisted_threads(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            rollout = root / "sessions/r.jsonl"
            rollout.parent.mkdir()
            rollout.write_text("{}\n")
            with sqlite3.connect(root / "state_5.sqlite") as db:
                db.execute("CREATE TABLE threads(id,cwd,rollout_path)")
                db.execute("INSERT INTO threads VALUES(?,?,?)", (TID, "/workspace", str(rollout)))
            with sqlite3.connect(root / "thread_history_1.sqlite") as db:
                db.execute("CREATE TABLE thread_turns(thread_id,status,rollout_ordinal)")
                db.execute("INSERT INTO thread_turns VALUES(?,?,?)", (TID, "inProgress", 1))
            with self.assertRaisesRegex(ValueError, "active"):
                guard.idle_thread(root, TID, ["/workspace"], 120)
            with sqlite3.connect(root / "thread_history_1.sqlite") as db:
                db.execute("UPDATE thread_turns SET status='completed'")
            with self.assertRaisesRegex(ValueError, "recent"):
                guard.idle_thread(root, TID, ["/workspace"], 120)
            os.utime(rollout, (time.time()-300, time.time()-300))
            self.assertEqual(guard.idle_thread(root, TID, ["/workspace"], 120)["cwd"], "/workspace")
            with self.assertRaisesRegex(ValueError, "allowlist"):
                guard.idle_thread(root, TID, ["/other"], 120)

    def test_confirmation_requires_stable_evidence_and_continuous_observation(self):
        item = {"key": "id", "inode": 7}
        previous = {"candidate": item, "first_seen": 100, "last_seen": 150}
        self.assertTrue(guard.eligible(previous, item, 200, 60))
        self.assertFalse(guard.eligible(previous, item, 155, 60))
        self.assertFalse(guard.eligible(previous, item, 400, 60))
        self.assertFalse(guard.eligible(previous, {**item, "inode": 8}, 200, 60))

    def test_prior_frontend_snapshot_handles_new_window_and_protects_alternate_alias(self):
        target = {"id": "t", "host": "host"}
        links = {("host", None): {"active": ["new"], "replaced": {}}}
        history = guard.frontend_history(links, [target], {"t": {"old": 100, "expired": -20000}}, 200)
        self.assertEqual(links[("host", None)]["replaced"], {"old": ["new"]})
        self.assertEqual(history, {"t": {"old": 100, "new": 200}})
        links = {("host", None): {"active": ["new"], "replaced": {}},
                 ("alias", None): {"active": ["old"], "replaced": {}}}
        guard.frontend_history(links, [target], {"t": {"old": 100}}, 200)
        self.assertEqual(links[("host", None)]["replaced"], {})

    def test_remote_revalidates_before_pidfd_signal_and_does_not_escalate(self):
        item = {"key": "k", "old": {"pid": 10}, "thread": TID}
        with patch.object(guard, "candidates", return_value=[item]), \
             patch.object(guard.os, "pidfd_open", return_value=99, create=True), \
             patch.object(guard.signal, "pidfd_send_signal", create=True) as send, \
             patch.object(guard.os, "close"):
            result = guard.remote_main({"approved": [item]})
            send.assert_called_once_with(99, guard.signal.SIGTERM)
            self.assertEqual(result["actions"][0]["result"], "signal_sent")
        with patch.object(guard, "candidates", side_effect=[[item], []]), \
             patch.object(guard.os, "pidfd_open", return_value=99, create=True), \
             patch.object(guard.signal, "pidfd_send_signal", create=True) as send, \
             patch.object(guard.os, "close"):
            self.assertEqual(guard.remote_main({"approved": [item]})["actions"], [])
            send.assert_not_called()

    def test_writer_released_by_server_is_reported_as_ui_retry_not_silent_zero(self):
        with tempfile.TemporaryDirectory() as d:
            proc, home, request = self.make_remote_fixture(Path(d))
            (home / "thread-writer-locks" / (TID + ".lock")).unlink()
            with patch.object(guard, "PROC", proc):
                result = guard.remote_main(request)
            self.assertEqual(result["candidates"], [])
            self.assertEqual(result["skips"], {"writer_or_session_file_gone_retry_chat": 1})

    def test_disappearing_old_process_does_not_abort_entire_recovery_batch(self):
        item = {"key": "k", "old": {"pid": 10}, "thread": TID}
        with patch.object(guard, "candidates", return_value=[item]), \
             patch.object(guard.os, "pidfd_open", side_effect=ProcessLookupError, create=True), \
             patch.object(guard.signal, "pidfd_send_signal", create=True) as send:
            result = guard.remote_main({"approved": [item]})
            self.assertEqual(result["skips"], {"old_process_already_exited": 1})
            send.assert_not_called()


if __name__ == "__main__":
    unittest.main()
