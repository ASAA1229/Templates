import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tools.env_snapshot import snapshot


class EnvironmentSnapshotTests(unittest.TestCase):
    def test_rejects_unsupported_platform(self):
        with patch.object(snapshot.platform, "system", return_value="Windows"):
            with self.assertRaisesRegex(RuntimeError, "Unsupported operating system"):
                snapshot.collect_snapshot()

    def test_linux_snapshot_has_required_groups_and_no_network_policy(self):
        with patch.object(snapshot.platform, "system", return_value="Linux"):
            result = snapshot.collect_snapshot()
        self.assertEqual(result["schema_version"], "1.0")
        self.assertEqual(set(result["cmm"]), {"ICG", "ACQ", "ISS"})
        self.assertEqual(result["collection_policy"]["network_access"], "none")
        self.assertFalse(result["collection_policy"]["environment_variables_read"])
        self.assertIn("logical_cpu_count", result["resources"])

    def test_text_report_contains_cmm_groups(self):
        report = snapshot.render_text({
            "schema_version": "1.0",
            "captured_at_utc": "2026-01-01T00:00:00+00:00",
            "platform": {"system": "Linux", "uname": {}},
            "resources": {},
            "diagnostics": {},
            "cmm": {
                "ICG": {"status": "collected", "scope": "host context"},
                "ACQ": {"status": "collected", "scope": "capacity"},
                "ISS": {"status": "collected", "scope": "system state"},
            },
            "collection_policy": {"network_access": "none"},
        })
        for group in ("ICG", "ACQ", "ISS"):
            self.assertIn(group, report)


    def test_aix_memory_is_reported_as_raw_attributes_without_unit_assumptions(self):
        with patch.object(snapshot.platform, "system", return_value="AIX"), \
             patch.object(snapshot, "_command_output", return_value="realmem  :  32768") as command:
            result = snapshot._memory_bytes()
        self.assertEqual(result, {"aix_sys0_attributes": "realmem  :  32768"})
        command.assert_called_once_with(["lsattr", "-El", "sys0"])

    def test_cli_writes_json_to_requested_path(self):
        sample = {
            "schema_version": "1.0",
            "captured_at_utc": "2026-01-01T00:00:00+00:00",
            "platform": {},
            "resources": {},
            "diagnostics": {},
            "cmm": {},
            "collection_policy": {},
        }
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "snapshot.json"
            with patch.object(snapshot, "collect_snapshot", return_value=sample):
                self.assertEqual(snapshot.main(["--format", "json", "--output", str(target)]), 0)
            self.assertEqual(json.loads(target.read_text(encoding="utf-8")), sample)


if __name__ == "__main__":
    unittest.main()
