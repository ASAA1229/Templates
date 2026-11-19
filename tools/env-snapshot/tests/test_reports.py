# -*- coding: utf-8 -*-
"""Collectors end to end with the fixture-backed fake runner, schema validation and profiles."""
import json
import unittest

from helpers import FakeRunner, es, load_schema, snapshot, validate

SCHEMA = load_schema()


def sections(report):
    return report["sections"]


class SchemaValidatorTests(unittest.TestCase):
    """The tiny validator itself must reject bad documents, or the schema tests prove nothing."""

    def test_rejects_problems(self):
        schema = {
            "type": "object",
            "required": ["a"],
            "additionalProperties": False,
            "properties": {
                "a": {"type": "string", "enum": ["x", "y"], "pattern": "^x"},
                "n": {"type": ["integer", "null"]},
                "l": {"type": "array", "items": {"type": "boolean"}},
            },
        }
        self.assertEqual(validate({"a": "x", "n": None, "l": [True]}, schema), [])
        self.assertTrue(validate({}, schema))
        self.assertTrue(validate({"a": "y"}, schema))  # pattern
        self.assertTrue(validate({"a": "z"}, schema))  # enum
        self.assertTrue(validate({"a": "x", "extra": 1}, schema))
        self.assertTrue(validate({"a": "x", "n": True}, schema))  # bool is not integer
        self.assertTrue(validate({"a": "x", "l": [1]}, schema))


class LinuxReportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.runner = FakeRunner("linux", env={"HOME": "/home/svcapp", "PATH": "/usr/bin", "LANG": "C"})
        cls.report = snapshot(cls.runner)
        cls.s = sections(cls.report)

    def test_schema_valid(self):
        self.assertEqual(validate(json.loads(json.dumps(self.report)), SCHEMA), [])

    def test_header(self):
        r = self.report
        self.assertEqual(r["schema_version"], "1.0")
        self.assertEqual(r["context"], {"context": "ICG", "context_explicit": True, "project": "demo", "environment": "dev"})
        self.assertEqual(r["platform"]["family"], "linux")
        self.assertTrue(r["redaction"])
        self.assertEqual(len(r["collectors"]), 13)
        self.assertEqual(r["host"]["hostname"], "rhel8-app01")

    def test_all_sections_present_and_statuses_valid(self):
        for cid, section in self.s.items():
            self.assertIn(section["status"], es.STATUSES, cid)
        self.assertEqual(self.s["os"]["status"], "ok")
        self.assertEqual(self.s["os"]["data"]["os_release"]["ID"], "rhel")
        self.assertEqual(self.s["os"]["data"]["redhat_release"], "Red Hat Enterprise Linux release 8.9 (Ootpa)")

    def test_system_kernel_hardware(self):
        self.assertEqual(self.s["system"]["data"]["boot_time"], "2026-01-01T00:00:00Z")
        self.assertAlmostEqual(self.s["system"]["data"]["uptime_seconds"], 1049040.12)
        self.assertEqual(self.s["kernel"]["data"]["release"], "4.18.0-513.5.1.el8_9.x86_64")
        self.assertEqual(self.s["kernel"]["data"]["sysctl"]["kernel.pid_max"], "4194304")
        self.assertNotIn("kernel.hostname", self.s["kernel"]["data"]["sysctl"])
        self.assertEqual(self.s["hardware"]["data"]["cpu"]["logical_processors"], 4)
        self.assertEqual(self.s["hardware"]["data"]["memory_kb"]["MemTotal"], 16314520)

    def test_disks_packages_runtimes(self):
        disks = self.s["disks"]["data"]
        self.assertEqual(len(disks["block_devices"]), 5)
        self.assertEqual(len(disks["filesystems"]), 4)
        managers = dict((m["manager"], m) for m in self.s["packages"]["data"]["managers"])
        self.assertEqual(managers["rpm"]["count"], 4)
        self.assertEqual(managers["dpkg"]["count"], 4)
        self.assertEqual(managers["apk"]["count"], 3)
        runtimes = dict((r["name"], r) for r in self.s["runtimes"]["data"]["runtimes"])
        self.assertEqual(runtimes["java"]["version"], 'openjdk version "11.0.21" 2023-10-17 LTS')
        self.assertEqual(runtimes["python3"]["version"], "Python 3.6.8")
        self.assertEqual(runtimes["go"]["status"], "unavailable")
        self.assertEqual(self.s["runtimes"]["status"], "ok")

    def test_network_users_services_resources_processes(self):
        net = self.s["network"]["data"]
        self.assertEqual(net["fqdn"], "rhel8-app01.corp.example")
        self.assertEqual(net["default_gateway"], "10.20.30.1")
        self.assertEqual([p["port"] for p in net["listening"]], [22, 22, 5432, 68])
        users = self.s["users_limits"]["data"]
        self.assertEqual(users["identity"]["uid"], 1001)
        self.assertEqual(users["ulimits"]["open files"], "65536")
        self.assertEqual(len(self.s["services"]["data"]["systemd_services"]), 4)
        res = self.s["resources"]["data"]
        self.assertEqual(res["load"]["load1"], 0.52)
        self.assertEqual(res["mem_mb"]["total"], 15932)
        procs = self.s["processes"]["data"]
        self.assertEqual(procs["by_cpu"][0]["pid"], 842)

    def test_partial_sources_are_reported(self):
        # os: both files present -> no message; runtimes: some binaries missing is not an error
        self.assertEqual(self.s["os"]["message"], "")
        self.assertIn("not collected", self.s["runtimes"]["message"])


class AixReportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.report = snapshot(FakeRunner("aix"))
        cls.s = sections(cls.report)

    def test_schema_valid(self):
        self.assertEqual(validate(json.loads(json.dumps(self.report)), SCHEMA), [])
        self.assertEqual(self.report["platform"]["family"], "aix")

    def test_os_and_kernel(self):
        self.assertEqual(self.s["os"]["status"], "ok")
        self.assertEqual(self.s["os"]["data"]["oslevel_s"], "7200-05-04-2220")
        self.assertEqual(self.s["os"]["data"]["technology_level"], "7200-05")
        self.assertEqual(self.s["os"]["data"]["oslevel_r"], "7200-05")
        self.assertEqual(self.s["kernel"]["data"]["kernel_bitmode"], "64")
        self.assertEqual(self.s["kernel"]["data"]["sys0"]["maxuproc"]["value"], "4096")

    def test_hardware_disks_packages(self):
        hw = self.s["hardware"]["data"]
        self.assertEqual(hw["prtconf"]["Memory Size"], "32768 MB")
        self.assertEqual(hw["device_count"], 5)
        disks = self.s["disks"]["data"]
        self.assertEqual(disks["volume_groups"], ["rootvg", "datavg"])
        self.assertEqual(len(disks["rootvg_logical_volumes"]), 4)
        self.assertEqual(len(disks["filesystems"]), 3)
        pkgs = self.s["packages"]["data"]["managers"]
        self.assertEqual((pkgs[0]["manager"], pkgs[0]["count"]), ("lslpp", 5))
        self.assertTrue(any("7200-05_AIX_ML" in i["output"] for i in self.s["packages"]["items"]))

    def test_services_resources_network_users(self):
        self.assertEqual(len(self.s["services"]["data"]["subsystems"]), 4)
        res = self.s["resources"]["data"]
        self.assertEqual(res["svmon"]["memory_frames"]["size"], 8388608)
        self.assertEqual(res["paging_spaces"][0]["page_space"], "hd6")
        self.assertEqual(res["vmstat"]["id"], 96)
        net = self.s["network"]["data"]
        self.assertEqual(net["default_gateway"], "10.1.2.1")
        self.assertEqual(len(net["listening"]), 3)
        self.assertEqual(self.s["users_limits"]["data"]["identity"]["uid"], 205)
        self.assertEqual(self.s["system"]["data"]["boot_time_text"], ".        system boot  Oct  1 07:05")


class UnsupportedPlatformTests(unittest.TestCase):
    def test_windows_and_other_report_unsupported(self):
        for name in ("Windows", "Darwin", "SunOS"):
            runner = FakeRunner("other", system_name=name, hostname="winbox")
            report = snapshot(runner)
            self.assertEqual(validate(json.loads(json.dumps(report)), SCHEMA), [], name)
            self.assertEqual([c["status"] for c in report["collectors"]], ["unsupported"] * 13)
            self.assertIn(name, report["collectors"][0]["message"])
            self.assertEqual(runner.requests, [], "nothing may be executed on an unsupported host")

    def test_every_status_kind_validates(self):
        overrides = {
            "uname -r": es.CommandResult("timeout", message="killed after 1 s timeout"),
            "uname -a": es.CommandResult("permission_denied", message="permission denied: uname"),
            "uptime": es.CommandResult("error", message="exit code 1"),
        }
        report = snapshot(FakeRunner("linux", overrides=overrides))
        self.assertEqual(validate(json.loads(json.dumps(report)), SCHEMA), [])
        statuses = set(i["status"] for i in report["sections"]["system"]["items"])
        self.assertTrue({"permission_denied", "error"} <= statuses)
        self.assertIn("timeout", set(i["status"] for i in report["sections"]["kernel"]["items"]))


class CollectorResilienceTests(unittest.TestCase):
    def test_all_commands_unavailable(self):
        runner = FakeRunner("linux", files={})
        runner.commands = {}
        runner.files = {}
        report = snapshot(runner)
        self.assertEqual(validate(json.loads(json.dumps(report)), SCHEMA), [])
        for row in report["collectors"]:
            self.assertIn(row["status"], ("unavailable", "ok"), row["id"])
        self.assertEqual(sections(report)["os"]["status"], "unavailable")
        self.assertEqual(sections(report)["packages"]["status"], "unavailable")

    def test_permission_denied_aggregation(self):
        denied = es.CommandResult("permission_denied", message="permission denied")
        runner = FakeRunner("aix", overrides={"svmon -G": denied, "lsps -a": denied, "vmstat": denied, "iostat": denied, "uptime": denied})
        report = snapshot(runner)
        self.assertEqual(sections(report)["resources"]["status"], "permission_denied")

    def test_timeout_aggregation(self):
        slow = es.CommandResult("timeout", message="killed after 5 s timeout")
        runner = FakeRunner("aix", overrides={"lssrc -a": slow})
        report = snapshot(runner)
        self.assertEqual(sections(report)["services"]["status"], "timeout")

    def test_collector_exception_does_not_crash(self):
        class Exploding(FakeRunner):
            def run(self, argv, timeout):
                if argv[0] == "lscpu":
                    raise RuntimeError("boom")
                return FakeRunner.run(self, argv, timeout)

        report = snapshot(Exploding("linux"))
        self.assertEqual(sections(report)["hardware"]["status"], "error")
        self.assertEqual(sections(report)["hardware"]["message"], "collector failed: RuntimeError")
        self.assertEqual(sections(report)["os"]["status"], "ok")

    def test_lsblk_falls_back_to_pairs(self):
        runner = FakeRunner("linux")
        runner.commands = dict(runner.commands)
        runner.commands.pop("lsblk -J -o")
        runner.commands["lsblk -P -o"] = "linux/lsblk-pairs.txt"
        report = snapshot(runner)
        self.assertEqual(len(sections(report)["disks"]["data"]["block_devices"]), 3)

    def test_ip_falls_back_to_ifconfig(self):
        runner = FakeRunner("linux")
        runner.commands.pop("ip addr")
        runner.commands["ifconfig -a"] = "aix/ifconfig-a.txt"
        report = snapshot(runner)
        self.assertEqual(sections(report)["network"]["data"]["addresses"][0]["address"], "10.1.2.3")


class ProfileTests(unittest.TestCase):
    ENV = {"HOME": "/home/svcapp", "DEMO_SECRET_TOKEN": "supersecretvalue123", "APP_MODE": "production", "LANG": "C"}

    def test_icg_has_all_collectors(self):
        report = snapshot(FakeRunner("linux", env=self.ENV), context="ICG")
        self.assertEqual(report["profile"]["collectors"], list(es.COLLECTOR_IDS))

    def test_acq_profile_has_no_env_or_process_list(self):
        runner = FakeRunner("linux", env=self.ENV)
        report = snapshot(runner, context="ACQ")
        self.assertEqual(validate(json.loads(json.dumps(report)), SCHEMA), [])
        ids = [c["id"] for c in report["collectors"]]
        self.assertEqual(ids, ["system", "os", "hardware", "disks", "packages", "runtimes", "network", "users_limits"])
        self.assertNotIn("environment", report["sections"])
        self.assertNotIn("processes", report["sections"])
        text = json.dumps(report) + es.render_txt(report)
        self.assertNotIn("APP_MODE", text)
        self.assertNotIn("production", text)
        self.assertNotIn("ps -eo", [key for kind, key in runner.requests if kind == "run" and key.startswith("ps")])
        self.assertFalse([k for kind, k in runner.requests if k == "/etc/security/limits.conf"], "ACQ users_limits is metadata only")
        self.assertFalse([k for kind, k in runner.requests if k in ("/etc/hosts", "/etc/resolv.conf", "ss -tuln")])
        self.assertEqual(report["sections"]["users_limits"]["mode"], "metadata")
        self.assertEqual(report["sections"]["network"]["mode"], "summary")
        self.assertNotIn("listening", report["sections"]["network"]["data"])

    def test_iss_profile_redacts_all_env_values_and_keeps_names(self):
        for redact in (True, False):
            report = snapshot(FakeRunner("linux", env=self.ENV), context="ISS", redact=redact)
            self.assertEqual(validate(json.loads(json.dumps(report)), SCHEMA), [])
            self.assertEqual(
                [c["id"] for c in report["collectors"]],
                ["os", "kernel", "packages", "environment", "network", "users_limits", "services", "resources"],
            )
            variables = report["sections"]["environment"]["data"]["variables"]
            self.assertEqual(sorted(v["name"] for v in variables), sorted(self.ENV))
            self.assertTrue(all(v["value"] == "[REDACTED]" for v in variables))
            text = json.dumps(report) + es.render_txt(report)
            for value in ("supersecretvalue123", "/home/svcapp", "production"):
                self.assertNotIn(value, text)
            self.assertEqual(report["sections"]["network"]["mode"], "listening")
            self.assertIn("listening", report["sections"]["network"]["data"])
            self.assertNotIn("addresses", report["sections"]["network"]["data"])
            self.assertNotIn("processes", report["sections"])

    def test_icg_environment_values_follow_redaction_flag(self):
        on = snapshot(FakeRunner("linux", env=self.ENV), redact=True)["sections"]["environment"]["data"]["variables"]
        values = dict((v["name"], v["value"]) for v in on)
        self.assertEqual(values["DEMO_SECRET_TOKEN"], "[REDACTED]")
        self.assertEqual(values["APP_MODE"], "production")
        off = snapshot(FakeRunner("linux", env=self.ENV), redact=False)["sections"]["environment"]["data"]["variables"]
        self.assertEqual(dict((v["name"], v["value"]) for v in off)["DEMO_SECRET_TOKEN"], "supersecretvalue123")

    def test_every_collector_belongs_to_a_profile_description(self):
        text = es.list_collectors_text()
        for cid in es.COLLECTOR_IDS:
            self.assertIn(cid, text)
        for name in es.CONTEXTS:
            self.assertIn(name, text)


class TxtReportTests(unittest.TestCase):
    def test_txt_layout(self):
        report = snapshot(FakeRunner("aix"), context="ISS", explicit=False)
        text = es.render_txt(report)
        lines = text.splitlines()
        self.assertEqual(lines[0], "ENVIRONMENT SNAPSHOT")
        self.assertIn("Context:             ISS (default)", text)
        self.assertLess(text.index("COLLECTOR STATUS"), text.index("OPERATING SYSTEM"))
        self.assertIn("7200-05-04-2220", text)
        self.assertIn("lslpp: 5 packages", text)

    def test_context_default_is_recorded_as_not_explicit(self):
        report = snapshot(FakeRunner("linux"), explicit=False)
        self.assertFalse(report["context"]["context_explicit"])


if __name__ == "__main__":
    unittest.main()
