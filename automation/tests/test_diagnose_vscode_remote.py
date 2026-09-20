import unittest

from automation.scripts.diagnose_vscode_remote import classify


def healthy_probe():
    return {
        "storage_stat_max_ms": 2,
        "storage_write_fsync_ms": 80,
        "storage_write_mib_s": 100,
        "load_1m": 2,
        "cpu_count": 16,
        "pressure": {"cpu": 0, "memory": 0, "io": 0},
        "memory_available_pct": 50,
        "vscode_cpu_total_pct": 5,
        "vscode_cpu_max_pct": 3,
        "recent_vscode_log_hits": [],
    }


class DiagnoseVscodeRemoteTests(unittest.TestCase):
    def test_reports_network_as_primary(self):
        findings = classify([550, 650, 600], healthy_probe())
        self.assertEqual(findings[0].cause, "network/SSH")

    def test_reports_shared_storage_as_primary(self):
        probe = healthy_probe()
        probe.update(storage_stat_max_ms=900, storage_write_fsync_ms=4000, storage_write_mib_s=2)
        findings = classify([100, 110, 120], probe)
        self.assertEqual(findings[0].cause, "workspace shared storage")

    def test_reports_vscode_process_as_primary(self):
        probe = healthy_probe()
        probe.update(vscode_cpu_total_pct=210, vscode_cpu_max_pct=120)
        findings = classify([100, 110, 120], probe)
        self.assertEqual(findings[0].cause, "VS Code server/extension process")

    def test_healthy_sample_is_inconclusive(self):
        self.assertEqual(classify([100, 110, 120], healthy_probe()), [])

    def test_single_log_match_does_not_create_false_root_cause(self):
        probe = healthy_probe()
        probe["recent_vscode_log_hits"] = [{"file": "remoteagent.log", "hits": 1}]
        self.assertEqual(classify([100, 110, 120], probe), [])


if __name__ == "__main__":
    unittest.main()
