# -*- coding: utf-8 -*-
import json
import unittest

from helpers import FakeRunner, es, snapshot

R = es.REDACTED
FAKE_KEY = "-----BEGIN RSA " + "PRIVATE KEY-----\nMIIEowIBAAKCAQEAfakefakefakefakefake\nabcdefghijklmnop\n-----END RSA " + "PRIVATE KEY-----"
FAKE_JWT = "eyJ" + "hbGciOiJIUzI1NiJ9." + "eyJ" + "zdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk"
FAKE_AWS = "AKIA" + "IOSFODNN7EXAMPLE"
FAKE_GH = "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8"


class RedactionTextTests(unittest.TestCase):
    def test_private_key_block(self):
        out = es.redact_text("before\n" + FAKE_KEY + "\nafter")
        self.assertNotIn("MIIEow", out)
        self.assertNotIn("PRIVATE KEY", out)
        self.assertTrue(out.startswith("before\n"))
        self.assertTrue(out.endswith("\nafter"))

    def test_unterminated_private_key_masks_to_end(self):
        out = es.redact_text("x\n-----BEGIN OPENSSH " + "PRIVATE KEY-----\nAAAAB3Nza")
        self.assertNotIn("AAAAB3Nza", out)

    def test_jwt_aws_github(self):
        out = es.redact_text("t=%s a=%s g=%s ok=fine" % (FAKE_JWT, FAKE_AWS, FAKE_GH))
        for secret in (FAKE_JWT, FAKE_AWS, FAKE_GH, "eyJzdWIi"):
            self.assertNotIn(secret, out)
        self.assertIn("ok=fine", out)

    def test_url_password_keeps_scheme_user_and_host(self):
        out = es.redact_text("postgres://dbuser:" + "hunter2pass@db.internal:5432/app?x=1")
        self.assertEqual(out, "postgres://dbuser:" + "[REDACTED]@db.internal:5432/app?x=1")
        self.assertEqual(es.redact_text("https://example.com/a:b@c"), "https://example.com/a:b@c")
        self.assertEqual(es.redact_text("see https://example.com/docs"), "see https://example.com/docs")

    def test_config_lines(self):
        text = "\n".join(
            [
                "db_password = s3cr3tvalue",
                "api_key: abcdef123456",
                "export AUTH_TOKEN=zzz999",
                "  Password=hunter2",
                "ssh_key_path=/root/.ssh/x",
                "max_connections = 100",
                "name = visible",
                "password hunter3",
            ]
        )
        lines = es.redact_text(text).splitlines()
        self.assertEqual(lines[0], "db_password = " + R)
        self.assertEqual(lines[1], "api_key: " + R)
        self.assertEqual(lines[2], "export AUTH_TOKEN=" + R)
        self.assertEqual(lines[3], "  Password=" + R)
        self.assertEqual(lines[4], "ssh_key_path=" + R)
        self.assertEqual(lines[5], "max_connections = 100")
        self.assertEqual(lines[6], "name = visible")
        self.assertEqual(lines[7], "password " + R)

    def test_command_line_flags(self):
        out = es.redact_text("java -jar app.jar --db.password=hunter2pass --token abc123 --port=8080 -Dapi_key=zzz")
        for secret in ("hunter2pass", "abc123", "zzz"):
            self.assertNotIn(secret, out)
        self.assertIn("--port=8080", out)

    def test_non_secrets_survive(self):
        samples = [
            "Linux rhel8-app01 4.18.0-513.5.1.el8_9.x86_64 #1 SMP x86_64 GNU/Linux",
            "tcp LISTEN 0 128 0.0.0.0:22 0.0.0.0:*",
            "/dev/mapper/rhel-root 83871744 21004444 62867300 26% /",
            "PRETTY_NAME=\"Red Hat Enterprise Linux 8.9 (Ootpa)\"",
            "nameserver 10.20.30.2",
            "7200-05-04-2220",
            "Mem: 15932 2301 8808 101 4822 12814",
            "bash 4.4.20-4.el8_6 x86_64",
        ]
        for sample in samples:
            self.assertEqual(es.redact_text(sample), sample)

    def test_env_values(self):
        self.assertEqual(es.redact_env_value("DEMO_SECRET_TOKEN", "supersecretvalue123"), R)
        self.assertEqual(es.redact_env_value("AWS_REGION", "eu-west-1"), R)  # aws_ prefix is treated as sensitive
        self.assertEqual(es.redact_env_value("SSH_AUTH_SOCK", "/tmp/ssh-x/agent.1"), R)
        self.assertEqual(es.redact_env_value("DB_URL", "postgres://u:" + "hunter2pass@db/x"), "postgres://u:" + "[REDACTED]@db/x")
        self.assertEqual(es.redact_env_value("MYSTERY", "A" * 40), R)  # long base64 blob
        self.assertEqual(es.redact_env_value("MYSTERY", "0123456789abcdef" * 3), R)  # long hex blob
        self.assertEqual(es.redact_env_value("MYSTERY", FAKE_AWS), R)
        self.assertEqual(es.redact_env_value("PATH", "/usr/local/bin:/usr/bin"), "/usr/local/bin:/usr/bin")
        self.assertEqual(es.redact_env_value("LANG", "en_US.UTF-8"), "en_US.UTF-8")
        self.assertEqual(es.redact_env_value("HOME", "/home/svcapp"), "/home/svcapp")

    def test_key_pattern_matches_spec_words(self):
        for key in ("PASSWORD", "db_passwd", "pass", "SECRET", "gh_token", "API_KEY", "api-key", "PRIVATE_KEY", "CREDENTIALS",
                    "OAUTH", "COOKIE", "SESSION_ID", "BEARER", "AWS_X", "AZURE_X", "GCP_X", "SSH_X"):
            self.assertTrue(es.SECRET_KEY_RE.search(key), key)
        for key in ("PATH", "HOME", "LANG", "SHELL", "TERM"):
            self.assertFalse(es.SECRET_KEY_RE.search(key), key)

    def test_sanitize_is_deep_and_keeps_structure(self):
        data = {"output": "password = abc", "list": [{"command": "x --token=abc"}], "n": 3, "none": None}
        out = es.sanitize(data)
        self.assertEqual(out["output"], "password = " + R)
        self.assertEqual(out["list"][0]["command"], "x --token=" + R)
        self.assertEqual((out["n"], out["none"]), (3, None))


class RedactionOnReportsTests(unittest.TestCase):
    """Redaction applies to collector output from files and commands, in JSON and TXT."""

    def build(self, redact=True, context="ICG"):
        env = {
            "HOME": "/home/svcapp",
            "DEMO_SECRET_TOKEN": "supersecretvalue123",
            "DB_URL": "postgres://u:" + "hunter2pass@db/x",
            "BLOB": "Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmFy",
            "AWS_ACCESS_KEY_ID": FAKE_AWS,
        }
        return snapshot(FakeRunner("linux", env=env), redact=redact, context=context)

    def both(self, report):
        return json.dumps(report) + es.render_txt(report)

    def test_secrets_removed_everywhere(self):
        text = self.both(self.build())
        for secret in ("supersecretvalue123", "hunter2pass", "Zm9vYmFy", FAKE_AWS, "s3cr3tvalue", "abcdefghij1234567890"):
            self.assertNotIn(secret, text, secret)
        self.assertIn("postgres://u:" + "[REDACTED]@db/x", text)
        self.assertIn("/home/svcapp", text)  # non-secret survives in ICG

    def test_file_content_and_process_arguments_are_masked(self):
        report = self.build()
        env_items = dict((i["name"], i["output"]) for i in report["sections"]["environment"]["items"])
        self.assertIn("db_password = [REDACTED]", env_items["/etc/environment"])
        self.assertIn("LANG=en_US.UTF-8", env_items["/etc/environment"])
        cmdline = report["sections"]["processes"]["data"]["by_cpu"]
        self.assertTrue(any("--db.password=[REDACTED]" in row["command"] for row in cmdline))
        self.assertNotIn("hunter2pass", self.both(report))

    def test_no_redact_keeps_values(self):
        text = self.both(self.build(redact=False))
        self.assertIn("supersecretvalue123", text)
        self.assertIn("hunter2pass", text)
        self.assertIn("OFF", text)

    def test_secrets_in_arbitrary_command_output_are_masked(self):
        nl = chr(10)
        leaky_text = nl.join(["host ok", "API_TOKEN=" + FAKE_GH, "url=ftp://bob:" + "pw123@h/x", FAKE_KEY, ""])
        leaky = es.CommandResult("ok", stdout=leaky_text, exit_code=0)
        report = snapshot(FakeRunner("linux", overrides={"uname -r": leaky}))
        text = self.both(report)
        for secret in (FAKE_GH, "pw123", "MIIEow"):
            self.assertNotIn(secret, text)
        self.assertIn("host ok", text)


if __name__ == "__main__":
    unittest.main()
