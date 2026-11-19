# -*- coding: utf-8 -*-
"""Static checks that keep env_snapshot.py runnable on Python 3.6, offline and unprivileged."""
import ast
import io
import os
import re
import sys
import unittest

from helpers import SOURCE_PATH, TESTS_DIR, TOOL_DIR

with io.open(SOURCE_PATH, encoding="utf-8") as handle:
    SOURCE = handle.read()


class Python36CompatibilityTests(unittest.TestCase):
    def test_parses_as_python_3_6(self):
        if sys.version_info < (3, 8):
            self.skipTest("ast.parse(feature_version=...) needs Python 3.8+; run this test on a newer interpreter")
        ast.parse(SOURCE, filename=SOURCE_PATH, feature_version=(3, 6))

    def test_test_files_also_parse_as_python_3_6(self):
        if sys.version_info < (3, 8):
            self.skipTest("ast.parse(feature_version=...) needs Python 3.8+")
        for name in os.listdir(TESTS_DIR):
            if name.endswith(".py"):
                with io.open(os.path.join(TESTS_DIR, name), encoding="utf-8") as handle:
                    ast.parse(handle.read(), filename=name, feature_version=(3, 6))

    def test_no_constructs_newer_than_3_6(self):
        forbidden = ["capture_output", "text=True", ":=", "from __future__ import annotations", "dataclass", "removeprefix", "removesuffix"]
        for token in forbidden:
            self.assertNotIn(token, SOURCE, "forbidden construct: " + token)
        self.assertIsNone(re.search(r"f['\"][^'\"]*\{[^}]*=\}", SOURCE), "f-string '=' specifier")
        for token in ("fromisoformat", "math.prod", "functools.cache", "asyncio.run", "contextlib.nullcontext", "importlib.resources"):
            self.assertNotIn(token, SOURCE, token)

    def test_stdlib_only_imports(self):
        allowed = set(
            "argparse datetime glob hashlib io json os platform re shutil signal socket subprocess sys threading time".split()
        )
        imported = set()
        for node in ast.walk(ast.parse(SOURCE)):
            if isinstance(node, ast.Import):
                imported.update(alias.name.split(".")[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom):
                imported.add((node.module or "").split(".")[0])
        self.assertLessEqual(imported, allowed)


class SafetyPropertyTests(unittest.TestCase):
    def test_no_shell_true_no_privilege_escalation_no_network_calls(self):
        for token in ("shell=True", "os.system", "os.popen", "sudo", "urllib", "http.client", "requests", "ftplib", "smtplib",
                      "getaddrinfo", "gethostbyname", "create_connection", ".connect("):
            self.assertNotIn(token, SOURCE, token)
        self.assertIsNone(re.search(r"\bping\b", SOURCE))

    def test_commands_use_shell_false_and_a_timeout(self):
        self.assertIn("shell=False", SOURCE)
        self.assertIn("proc.wait(timeout=timeout)", SOURCE)
        self.assertIn('"LC_ALL": "C"', SOURCE)

    def test_credential_files_are_never_in_the_file_allow_list(self):
        import env_snapshot as es

        for path in es.ALLOWED_FILES:
            self.assertIsNone(es._DENIED_FILE_RE.search(path), path)
            self.assertFalse(re.search(r"shadow|passwd", path))

    def test_tool_tree_has_no_bytecode(self):
        for base, dirs, files in os.walk(TOOL_DIR):
            self.assertNotIn("__pycache__", dirs, base)
            self.assertFalse([f for f in files if f.endswith((".pyc", ".pyo"))], base)

    def test_fixtures_are_plain_files(self):
        found = 0
        for base, _dirs, files in os.walk(os.path.join(TESTS_DIR, "fixtures")):
            for name in files:
                found += 1
                with open(os.path.join(base, name), "rb") as handle:
                    self.assertNotIn(b"\x00", handle.read(), name)
        self.assertGreater(found, 60)


if __name__ == "__main__":
    unittest.main()
