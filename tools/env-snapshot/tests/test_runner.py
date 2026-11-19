# -*- coding: utf-8 -*-
"""RealRunner: allow-list, timeouts, output caps, error classification (uses the Python interpreter as the fake command)."""
import os
import sys
import time
import unittest

from helpers import es

PY = sys.executable
PY_NAME = os.path.basename(PY)


def runner(**kwargs):
    return es.RealRunner(allowed=[PY_NAME], **kwargs)


class RealRunnerTests(unittest.TestCase):
    def test_runs_allow_listed_command(self):
        result = runner().run([PY, "-c", "print('hello')"], 10)
        self.assertEqual(result.status, "ok")
        self.assertEqual(result.stdout.strip(), "hello")
        self.assertEqual(result.exit_code, 0)
        self.assertFalse(result.truncated)

    def test_slow_command_is_killed_and_reported_as_timeout(self):
        started = time.time()
        result = runner().run([PY, "-c", "import time; time.sleep(30)"], 1)
        elapsed = time.time() - started
        self.assertEqual(result.status, "timeout")
        self.assertLess(elapsed, 8, "the child must be killed shortly after the timeout")
        self.assertIn("timeout", result.message)

    def test_output_is_capped_and_flagged(self):
        result = runner(max_output=1000).run([PY, "-c", "print('x' * 5000)"], 10)
        self.assertEqual(result.status, "ok")
        self.assertTrue(result.truncated)
        self.assertEqual(len(result.stdout), 1000)

    def test_command_outside_allow_list_is_refused(self):
        result = es.RealRunner().run(["rm", "-rf", "/tmp/x"], 5)
        self.assertEqual(result.status, "error")
        self.assertIn("not allow-listed", result.message)
        self.assertEqual(es.RealRunner().run(["sudo", "id"], 5).status, "error")
        self.assertEqual(es.RealRunner().run(["su", "-c", "id"], 5).status, "error")

    def test_missing_command_is_unavailable(self):
        r = es.RealRunner(allowed=["definitely-not-installed-cmd"]).run(["definitely-not-installed-cmd"], 5)
        self.assertEqual(r.status, "unavailable")

    def test_permission_error_text_maps_to_permission_denied(self):
        code = "import sys; sys.stderr.write('svmon: Permission denied\\n'); sys.exit(1)"
        result = runner().run([PY, "-c", code], 10)
        self.assertEqual(result.status, "permission_denied")
        self.assertIn("exit code 1", result.message)

    def test_nonzero_exit_without_output_is_error(self):
        result = runner().run([PY, "-c", "import sys; sys.stderr.write('bad thing\\n'); sys.exit(3)"], 10)
        self.assertEqual(result.status, "error")
        self.assertIn("bad thing", result.message)

    def test_nonzero_exit_with_output_is_partial_ok(self):
        result = runner().run([PY, "-c", "import sys; print('rows'); sys.exit(2)"], 10)
        self.assertEqual(result.status, "ok")
        self.assertIn("partial", result.message)
        self.assertEqual(result.exit_code, 2)

    def test_child_environment_is_minimal_and_c_locale(self):
        os.environ["ES_TEST_PARENT_SECRET"] = "leak-me"
        try:
            code = "import os; print(sorted(os.environ)); print(os.environ.get('LC_ALL'))"
            result = runner().run([PY, "-c", code], 10)
        finally:
            del os.environ["ES_TEST_PARENT_SECRET"]
        self.assertEqual(result.status, "ok")
        self.assertNotIn("ES_TEST_PARENT_SECRET", result.stdout)
        self.assertTrue(result.stdout.strip().endswith("C"))

    def test_no_shell_interpretation(self):
        result = runner().run([PY, "-c", "import sys; print(sys.argv[1:])", "a; echo injected", "$(id)"], 10)
        self.assertEqual(result.status, "ok")
        self.assertIn("a; echo injected", result.stdout)
        self.assertIn("$(id)", result.stdout)

    def test_collector_reports_timeout_status_from_real_runner(self):
        slow = runner()
        section = es.run_collector(
            ("demo", "Demo", ("linux",), lambda ctx: ([ctx.run("sleep", [PY, "-c", "import time; time.sleep(30)"])], {})),
            slow,
            "linux",
            1,
            "full",
            True,
        )
        self.assertEqual(section["status"], "timeout")


class FileReadTests(unittest.TestCase):
    def test_credential_files_are_refused_without_reading(self):
        r = es.RealRunner()
        for path in ("/etc/shadow", "/etc/passwd", "/etc/gshadow", "/etc/master.passwd", "/etc/security/passwd"):
            result = r.read_file(path)
            self.assertEqual(result.status, "permission_denied", path)
            self.assertIn("refused", result.message)
            self.assertEqual(result.stdout, "")

    def test_non_allow_listed_file_is_refused(self):
        self.assertEqual(es.RealRunner().read_file("/etc/ssh/ssh_host_rsa_key").status, "error")
        self.assertEqual(es.RealRunner().read_file(os.path.abspath(__file__)).status, "error")

    def test_missing_proc_file_is_unavailable(self):
        self.assertEqual(es.RealRunner().read_file("/proc/definitely-missing-file").status, "unavailable")

    def test_collectors_never_request_credential_files(self):
        from helpers import FakeRunner, snapshot

        for family in ("linux", "aix"):
            fake = FakeRunner(family)
            snapshot(fake)
            requested = [target for kind, target in fake.requests if kind == "file"]
            for target in requested:
                self.assertIsNone(es._DENIED_FILE_RE.search(target), target)
                self.assertTrue(target in es.ALLOWED_FILES or target.startswith("/proc/"), target)


class AllowListTests(unittest.TestCase):
    def test_every_command_used_by_collectors_is_allow_listed(self):
        from helpers import FakeRunner, snapshot

        for family in ("linux", "aix"):
            fake = FakeRunner(family)
            snapshot(fake)
            names = set(key.split(" ")[0] for kind, key in fake.requests if kind == "run")
            self.assertTrue(names)
            self.assertLessEqual(names, set(es.ALLOWED_COMMANDS))

    def test_no_privilege_escalation_commands_in_allow_list(self):
        for name in ("sudo", "su", "doas", "pkexec", "rm", "curl", "wget", "ping", "nslookup", "dig", "ssh", "nc"):
            self.assertNotIn(name, es.ALLOWED_COMMANDS)


if __name__ == "__main__":
    unittest.main()
