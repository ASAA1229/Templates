# -*- coding: utf-8 -*-
import datetime
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

from helpers import FakeRunner, SOURCE_PATH, TOOL_DIR, es, load_schema, validate

NOW = datetime.datetime(2026, 3, 4, 5, 6, 7)


def tree(root):
    found = []
    for base, dirs, files in os.walk(root):
        for name in dirs + files:
            found.append(os.path.relpath(os.path.join(base, name), root).replace(os.sep, "/"))
    return sorted(found)


class CliTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="es-cli-")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.out = os.path.join(self.tmp, "out")

    def run_main(self, args, runner=None, now=NOW):
        stream = io.StringIO()
        code = es.main(args, runner=runner or FakeRunner("linux"), now=now, out=stream)
        return code, stream.getvalue()

    def usage_error(self, args):
        stderr = io.StringIO()
        old = sys.stderr
        sys.stderr = stderr
        try:
            with self.assertRaises(SystemExit) as caught:
                es.main(args, runner=FakeRunner("linux"), now=NOW, out=io.StringIO())
        finally:
            sys.stderr = old
        self.assertEqual(caught.exception.code, 2, args)
        return stderr.getvalue()

    # --- argument validation ------------------------------------------------------
    def test_invalid_arguments_exit_2(self):
        for args in (
            ["--context", "XYZ"],
            ["--format", "xml"],
            ["--timeout", "0"],
            ["--timeout", "121"],
            ["--timeout", "abc"],
            ["--project", "x" * 65],
            ["--project", "bad;name"],
            ["--environment", "a/b"],
            ["--environment", ""],
            ["--unknown-flag"],
        ):
            self.usage_error(args + ["--output-dir", self.out])
        self.assertFalse(os.path.exists(self.out), "usage errors must not create anything")

    def test_valid_labels_and_timeout_bounds(self):
        for label in ("demo", "Project A-1.2_x", "x" * 64):
            code, _ = self.run_main(["--project", label, "--environment", "uat 1", "--timeout", "120", "--output-dir", self.out])
            self.assertEqual(code, 0)
        self.assertEqual(self.run_main(["--timeout", "1", "--output-dir", self.out])[0], 0)

    def test_version_and_help_exit_0(self):
        out = io.StringIO()
        old = sys.stdout
        sys.stdout = out
        try:
            with self.assertRaises(SystemExit) as caught:
                es.main(["--version"])
        finally:
            sys.stdout = old
        self.assertEqual(caught.exception.code, 0)
        self.assertIn(es.TOOL_VERSION, out.getvalue())

    # --- list collectors ----------------------------------------------------------
    def test_list_collectors_prints_and_does_not_collect_or_write(self):
        runner = FakeRunner("linux")
        code, text = self.run_main(["--list-collectors", "--output-dir", self.out], runner=runner)
        self.assertEqual(code, 0)
        self.assertEqual(runner.requests, [])
        self.assertFalse(os.path.exists(self.out))
        for cid in es.COLLECTOR_IDS:
            self.assertRegex(text, r"(?m)^%s\s" % cid)
        self.assertIn("Linux/AIX", text)
        self.assertRegex(text, r"(?m)^processes .*ICG$")
        self.assertRegex(text, r"(?m)^environment .*ICG, ISS \(names\)$")
        self.assertIn("ACQ: Acquisition/due diligence", text)
        self.assertIn("ISS: Information security/support", text)
        self.assertIn("ICG (default)", text)

    # --- output directory ---------------------------------------------------------
    def test_output_dir_that_is_a_file_is_refused(self):
        target = os.path.join(self.tmp, "a-file")
        with open(target, "w") as handle:
            handle.write("keep")
        message = self.usage_error(["--output-dir", target])
        self.assertIn("not a directory", message)
        with open(target) as handle:
            self.assertEqual(handle.read(), "keep")

    def test_creates_missing_nested_output_dir(self):
        nested = os.path.join(self.tmp, "a", "b", "c")
        self.assertEqual(self.run_main(["--output-dir", nested])[0], 0)
        self.assertEqual(len(os.listdir(nested)), 2)

    def test_file_naming_and_formats(self):
        code, text = self.run_main(["--context", "ACQ", "--output-dir", self.out])
        self.assertEqual(code, 0)
        names = sorted(os.listdir(self.out))
        self.assertEqual(
            names,
            ["env-snapshot_rhel8-app01_ACQ_20260304T050607Z.json", "env-snapshot_rhel8-app01_ACQ_20260304T050607Z.txt"],
        )
        self.assertIn("Wrote", text)
        for fmt, expected in (("txt", [".txt"]), ("json", [".json"])):
            folder = os.path.join(self.tmp, fmt)
            self.run_main(["--format", fmt, "--output-dir", folder])
            self.assertEqual([os.path.splitext(n)[1] for n in os.listdir(folder)], expected)

    def test_hostile_hostname_is_sanitised_in_file_names(self):
        self.run_main(["--output-dir", self.out], runner=FakeRunner("linux", hostname="../../evil host;rm"))
        for name in os.listdir(self.out):
            self.assertRegex(name, r"^env-snapshot_[A-Za-z0-9._-]+_ICG_\d{8}T\d{6}Z\.(txt|json)$")
            self.assertNotIn("/", name)

    def test_never_overwrites_existing_reports(self):
        self.run_main(["--output-dir", self.out])
        first = dict((n, open(os.path.join(self.out, n), "rb").read()) for n in os.listdir(self.out))
        # same second, same host and context: the new files must get a suffix
        self.run_main(["--output-dir", self.out])
        self.run_main(["--output-dir", self.out])
        names = sorted(os.listdir(self.out))
        self.assertEqual(len(names), 6)
        for name, content in first.items():
            with open(os.path.join(self.out, name), "rb") as handle:
                self.assertEqual(handle.read(), content)
        self.assertTrue(any("-1." in n for n in names) and any("-2." in n for n in names))

    def test_exclusive_create_protects_a_file_that_appears_late(self):
        path = os.path.join(self.out, "env-snapshot_rhel8-app01_ICG_20260304T050607Z.json")
        os.makedirs(self.out)
        with open(path, "w") as handle:
            handle.write("precious")
        report = es.build_report(FakeRunner("linux"), "ICG", "", "", True, 5, False, NOW)
        written = es.write_reports(report, self.out, "json", NOW)
        self.assertNotEqual(written[0], path)
        with open(path) as handle:
            self.assertEqual(handle.read(), "precious")

    # --- behaviour ----------------------------------------------------------------
    def test_default_context_is_icg_and_not_explicit(self):
        self.run_main(["--format", "json", "--output-dir", self.out])
        report = json.load(open(os.path.join(self.out, os.listdir(self.out)[0])))
        self.assertEqual(report["context"]["context"], "ICG")
        self.assertFalse(report["context"]["context_explicit"])
        self.assertEqual(report["redaction"], True)

    def test_no_redact_flag_is_recorded(self):
        self.run_main(["--format", "json", "--no-redact", "--output-dir", self.out])
        self.assertFalse(json.load(open(os.path.join(self.out, os.listdir(self.out)[0])))["redaction"])
        other = os.path.join(self.tmp, "o2")
        self.run_main(["--format", "json", "--redact", "--context", "ISS", "--output-dir", other])
        report = json.load(open(os.path.join(other, os.listdir(other)[0])))
        self.assertTrue(report["redaction"])
        self.assertTrue(report["context"]["context_explicit"])

    def test_unsupported_platform_exits_zero_and_validates(self):
        code, text = self.run_main(["--output-dir", self.out], runner=FakeRunner("other", system_name="Windows", hostname="WIN1"))
        self.assertEqual(code, 0)
        self.assertIn("unsupported=13", text)
        report = json.load(open([os.path.join(self.out, n) for n in os.listdir(self.out) if n.endswith(".json")][0]))
        self.assertEqual(validate(report, load_schema()), [])

    def test_written_json_matches_schema_for_every_context(self):
        schema = load_schema()
        for family in ("linux", "aix"):
            for context in es.CONTEXTS:
                folder = os.path.join(self.tmp, family + context)
                self.run_main(["--context", context, "--output-dir", folder], runner=FakeRunner(family))
                path = [os.path.join(folder, n) for n in os.listdir(folder) if n.endswith(".json")][0]
                with io.open(path, encoding="utf-8") as handle:
                    self.assertEqual(validate(json.load(handle), schema), [], family + context)

    def test_only_writes_inside_output_dir(self):
        """Run in a scratch cwd (real subprocess, real runner on this host): nothing may appear outside out/."""
        work = os.path.join(self.tmp, "work")
        os.makedirs(work)
        tool_before = tree(TOOL_DIR)
        env = dict(os.environ)
        env["PYTHONDONTWRITEBYTECODE"] = "1"
        proc = subprocess.run(
            [sys.executable, "-B", SOURCE_PATH, "--output-dir", "out", "--context", "ISS", "--timeout", "5"],
            cwd=work, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True, timeout=120,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        listing = tree(work)
        self.assertEqual(listing[0], "out")
        self.assertTrue(all(item == "out" or item.startswith("out/") for item in listing), listing)
        self.assertEqual(len([i for i in listing if i.startswith("out/")]), 2)
        self.assertEqual(tree(TOOL_DIR), tool_before, "the tool directory must not be modified")
        self.assertFalse(any("__pycache__" in item or item.endswith(".pyc") for item in tree(TOOL_DIR)))

    def test_default_output_dir_is_relative_to_cwd(self):
        work = os.path.join(self.tmp, "cwd")
        os.makedirs(work)
        old = os.getcwd()
        os.chdir(work)
        try:
            self.assertEqual(self.run_main([])[0], 0)
        finally:
            os.chdir(old)
        self.assertEqual(tree(work)[0], "env-snapshot-output")


if __name__ == "__main__":
    unittest.main()
