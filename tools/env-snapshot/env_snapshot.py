#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Offline Linux/AIX environment snapshot (env-snapshot).

Collects a read-only inventory of a host (OS, kernel, hardware, disks, packages, runtimes,
environment, local network, users/limits, services, resource usage, top processes) and writes a
TXT and/or JSON report into --output-dir.

Design rules: Python 3.6+, standard library only, no network calls, no privilege escalation,
fixed allow-list of commands (shell=False, per-command timeout and output cap), secrets are
redacted by default, and the only writes happen inside the chosen output directory.
"""
import argparse
import datetime
import glob as _glob
import hashlib
import io
import json
import os
import platform
import re
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time

TOOL_NAME = "env-snapshot"
TOOL_VERSION = "1.0.0"
SCHEMA_VERSION = "1.0"

STATUSES = ("ok", "unsupported", "unavailable", "permission_denied", "timeout", "error")
CONTEXTS = ("ICG", "ACQ", "ISS")
DEFAULT_CONTEXT = "ICG"
DEFAULT_TIMEOUT = 10
MAX_OUTPUT_BYTES = 256 * 1024
REDACTED = "[REDACTED]"
LABEL_RE = re.compile(r"^[A-Za-z0-9._ -]{1,64}$")

# --------------------------------------------------------------------------------------
# Redaction
# --------------------------------------------------------------------------------------

SECRET_KEY_RE = re.compile(
    r"(pass(word|wd)?|secret|token|api[_-]?key|private|credential|auth|cookie|session|bearer|aws_|azure_|gcp_|ssh_)",
    re.I,
)
_PRIVATE_KEY_RE = re.compile(
    r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----.*?(?:-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----|\Z)",
    re.S,
)
_JWT_RE = re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*")
_AWS_KEY_RE = re.compile(r"\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA)[0-9A-Z]{16}\b")
_TOKEN_RE = re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b")
_URL_CRED_RE = re.compile(r"(\b[A-Za-z][A-Za-z0-9+.-]*://[^\s/:@]*:)([^\s/@]+)(@)")
_FLAG_SECRET_RE = re.compile(
    r"(?i)(\s--?[\w-]*(?:pass(?:word|wd)?|secret|token|api[_-]?key|credential)[\w-]*)([= ])(\S+)"
)
_INLINE_SECRET_RE = re.compile(
    r"(?i)\b([\w.-]*(?:pass(?:word|wd)?|secret|token|api[_-]?key|credential|private[_-]?key)[\w.-]*)(\s*=\s*)"
    r"(\"[^\"]*\"|'[^']*'|[^\s\"']+)"
)
_CONFIG_LINE_RE = re.compile(r"^(\s*(?:export\s+)?)([A-Za-z0-9_.-]+)(\s*[=:]\s*)(\S.*)$", re.M)
_SPACE_CONFIG_RE = re.compile(r"(?im)^(\s*(?:pass(?:word|wd)?|secret|token|api[_-]?key))(\s+)(?![=:])(\S+)")
_BLOB_RE = re.compile(r"^(?:[A-Fa-f0-9]{32,}|[A-Za-z0-9+/_=-]{32,})$")


def redact_values(text):
    """Mask credential-looking values (keys, tokens, URL passwords, secret-named key=value pairs)."""
    if not text:
        return text
    text = _PRIVATE_KEY_RE.sub(REDACTED, text)
    text = _JWT_RE.sub(REDACTED, text)
    text = _AWS_KEY_RE.sub(REDACTED, text)
    text = _TOKEN_RE.sub(REDACTED, text)
    text = _URL_CRED_RE.sub(lambda m: m.group(1) + REDACTED + m.group(3), text)
    text = _FLAG_SECRET_RE.sub(lambda m: m.group(1) + m.group(2) + REDACTED, text)
    text = _INLINE_SECRET_RE.sub(
        lambda m: m.group(0) if m.group(3) == REDACTED else m.group(1) + m.group(2) + REDACTED, text
    )
    return text


def redact_text(text):
    """redact_values plus whole-line config handling (`key = value` where the key looks secret)."""
    text = redact_values(text)
    if not text:
        return text

    def config(match):
        if SECRET_KEY_RE.search(match.group(2)) and match.group(4).strip() != REDACTED:
            return match.group(1) + match.group(2) + match.group(3) + REDACTED
        return match.group(0)

    text = _CONFIG_LINE_RE.sub(config, text)
    return _SPACE_CONFIG_RE.sub(
        lambda m: m.group(0) if m.group(3) == REDACTED else m.group(1) + m.group(2) + REDACTED, text
    )


def redact_env_value(name, value):
    """Value of one environment variable after redaction."""
    if SECRET_KEY_RE.search(name):
        return REDACTED
    cleaned = redact_values(value)
    if cleaned == value and _BLOB_RE.match(value.strip()):
        return REDACTED
    return cleaned


_RAW_KEYS = ("output", "content")


def sanitize(obj, key=None):
    """Deep-redact every string of a section (raw text fields get line-based config handling)."""
    if isinstance(obj, dict):
        return dict((k, sanitize(v, k)) for k, v in obj.items())
    if isinstance(obj, list):
        return [sanitize(v, key) for v in obj]
    if isinstance(obj, str):
        return redact_text(obj) if key in _RAW_KEYS else redact_values(obj)
    return obj


# --------------------------------------------------------------------------------------
# Command / file access
# --------------------------------------------------------------------------------------

ALLOWED_COMMANDS = frozenset(
    [
        "uname", "uptime", "who", "hostname", "oslevel", "getconf", "bootinfo", "lsattr", "prtconf", "lsdev",
        "lscpu", "sysctl", "lsblk", "df", "mount", "lspv", "lsvg", "lsfs", "rpm", "dpkg-query", "apk", "lslpp",
        "instfix", "java", "python", "python3", "node", "perl", "gcc", "go", "ruby", "ip", "ifconfig", "netstat",
        "ss", "id", "whoami", "sh", "lsuser", "systemctl", "service", "lssrc", "vmstat", "free", "svmon", "lsps",
        "iostat", "ps",
    ]
)  # fmt: skip
ALLOWED_FILES = frozenset(
    [
        "/etc/os-release", "/etc/redhat-release", "/etc/hosts", "/etc/resolv.conf", "/etc/security/limits.conf",
        "/etc/security/limits", "/etc/environment", "/etc/profile", "/etc/hostname",
    ]
)  # fmt: skip
SEARCH_DIRS = (
    "/usr/sbin", "/usr/bin", "/sbin", "/bin", "/usr/local/bin", "/usr/local/sbin", "/opt/freeware/bin",
    "/usr/opt/freeware/bin",
)  # fmt: skip
_DENIED_FILE_RE = re.compile(r"(^|/)(shadow|gshadow|passwd|master\.passwd|opasswd)-?$|/security/passwd$")
_PERMISSION_RE = re.compile(r"permission denied|not permitted|must be root|not authori[sz]ed|authority|0509-", re.I)


class CommandResult(object):
    """Outcome of one command run or file read."""

    def __init__(self, status, stdout="", stderr="", exit_code=None, truncated=False, message="", duration_ms=0):
        self.status = status
        self.stdout = stdout
        self.stderr = stderr
        self.exit_code = exit_code
        self.truncated = truncated
        self.message = message
        self.duration_ms = duration_ms


def _clean(text):
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "?", text)


class _Capture(object):
    """Drains a pipe in a thread, keeping at most `cap` bytes."""

    def __init__(self, stream, cap):
        self.cap = cap
        self.chunks = []
        self.size = 0
        self.total = 0
        self.thread = threading.Thread(target=self._pump, args=(stream,))
        self.thread.daemon = True
        self.thread.start()

    def _pump(self, stream):
        try:
            while True:
                chunk = stream.read(8192)
                if not chunk:
                    break
                self.total += len(chunk)
                if self.size < self.cap:
                    keep = chunk[: self.cap - self.size]
                    self.chunks.append(keep)
                    self.size += len(keep)
        except (OSError, ValueError):
            pass

    def result(self):
        self.thread.join(2)
        return b"".join(self.chunks).decode("utf-8", "replace"), self.total > self.cap


class RealRunner(object):
    """Runs allow-listed commands and reads allow-listed files on the local host."""

    def __init__(self, allowed=None, max_output=MAX_OUTPUT_BYTES, search_dirs=SEARCH_DIRS):
        self.allowed = frozenset(allowed) if allowed is not None else ALLOWED_COMMANDS
        self.max_output = max_output
        self.search_dirs = search_dirs

    # identity helpers (overridden by test doubles)
    def system(self):
        return platform.system()

    def hostname(self):
        return socket.gethostname()

    def uname(self):
        u = platform.uname()
        return {"sysname": u[0], "nodename": u[1], "release": u[2], "version": u[3], "machine": u[4]}

    def environ(self):
        return dict(os.environ)

    def glob(self, pattern):
        return sorted(_glob.glob(pattern))

    def which(self, name):
        if os.path.isabs(name):
            return name if os.path.isfile(name) else None
        for directory in self.search_dirs:
            candidate = os.path.join(directory, name)
            if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
                return candidate
        return shutil.which(name)

    def read_file(self, path, max_bytes=None):
        started = time.time()
        if _DENIED_FILE_RE.search(path):
            return CommandResult("permission_denied", message="refused: credential file")
        if path not in ALLOWED_FILES and not path.startswith("/proc/"):
            return CommandResult("error", message="file is not allow-listed")
        cap = max_bytes or self.max_output
        try:
            with open(path, "rb") as handle:
                data = handle.read(cap + 1)
        except (IOError, OSError) as exc:
            status = "unavailable"
            message = "file not found"
            if isinstance(exc, PermissionError):
                status, message = "permission_denied", "permission denied"
            elif not isinstance(exc, FileNotFoundError):
                status, message = "error", "cannot read file (%s)" % exc.__class__.__name__
            return CommandResult(status, message=message, duration_ms=int((time.time() - started) * 1000))
        return CommandResult(
            "ok",
            stdout=data[:cap].decode("utf-8", "replace"),
            truncated=len(data) > cap,
            duration_ms=int((time.time() - started) * 1000),
        )

    def run(self, argv, timeout):
        started = time.time()

        def elapsed():
            return int((time.time() - started) * 1000)

        name = os.path.basename(argv[0])
        if name not in self.allowed:
            return CommandResult("error", message="command is not allow-listed: " + name)
        path = self.which(argv[0])
        if not path:
            return CommandResult("unavailable", message="command not found: " + name)
        env = {"LC_ALL": "C", "LANG": "C", "PATH": os.environ.get("PATH", "/usr/bin:/bin")}
        if os.name == "nt":
            env["SYSTEMROOT"] = os.environ.get("SYSTEMROOT", "")
        kwargs = {}
        if os.name == "posix":
            kwargs["start_new_session"] = True
        try:
            proc = subprocess.Popen(
                [path] + list(argv[1:]),
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=env,
                shell=False,
                close_fds=True,
                **kwargs
            )
        except PermissionError:
            return CommandResult("permission_denied", message="permission denied: " + name, duration_ms=elapsed())
        except FileNotFoundError:
            return CommandResult("unavailable", message="command not found: " + name, duration_ms=elapsed())
        except OSError as exc:
            return CommandResult("error", message="cannot start %s (%s)" % (name, exc.__class__.__name__))
        out = _Capture(proc.stdout, self.max_output)
        err = _Capture(proc.stderr, self.max_output)
        timed_out = False
        try:
            proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
            self._kill(proc)
            try:
                proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                pass
        stdout, out_truncated = out.result()
        stderr, err_truncated = err.result()
        for stream in (proc.stdout, proc.stderr):
            try:
                stream.close()
            except (OSError, ValueError):
                pass
        if timed_out:
            return CommandResult(
                "timeout",
                stdout=_clean(stdout),
                stderr=_clean(stderr),
                truncated=out_truncated,
                message="killed after %s s timeout" % timeout,
                duration_ms=elapsed(),
            )
        code = proc.returncode
        status, message = "ok", ""
        if code != 0:
            first = (stderr.strip().splitlines() or [""])[0][:200]
            if not stdout.strip():
                status = "permission_denied" if _PERMISSION_RE.search(stderr) else "error"
                message = "exit code %s%s" % (code, ": " + first if first else "")
            else:
                message = "exit code %s (partial output)" % code
        return CommandResult(
            status,
            stdout=_clean(stdout),
            stderr=_clean(stderr),
            exit_code=code,
            truncated=out_truncated or err_truncated,
            message=message,
            duration_ms=elapsed(),
        )

    @staticmethod
    def _kill(proc):
        try:
            if os.name == "posix":
                os.killpg(proc.pid, signal.SIGKILL)
            else:
                proc.kill()
        except (OSError, ProcessLookupError):
            try:
                proc.kill()
            except OSError:
                pass


# --------------------------------------------------------------------------------------
# Parsers (pure functions over text)
# --------------------------------------------------------------------------------------


def _int(value, default=None):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def parse_key_values(text, sep="="):
    result = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or sep not in line:
            continue
        key, value = line.split(sep, 1)
        result[key.strip()] = value.strip().strip("\"'")
    return result


def parse_cpuinfo(text):
    blocks = [b for b in re.split(r"\n\s*\n", text.strip()) if b.strip()]
    first = {}
    logical = 0
    physical_ids = set()
    for block in blocks:
        fields = {}
        for line in block.splitlines():
            if ":" in line:
                key, value = line.split(":", 1)
                fields.setdefault(key.strip().lower(), value.strip())
        if "processor" in fields:
            logical += 1
        if "physical id" in fields:
            physical_ids.add(fields["physical id"])
        if not first and fields:
            first = fields
    model = first.get("model name") or first.get("cpu") or first.get("hardware") or first.get("model") or ""
    return {
        "logical_processors": logical,
        "sockets": len(physical_ids) or None,
        "model_name": model,
        "vendor_id": first.get("vendor_id", ""),
        "cpu_mhz": first.get("cpu mhz", ""),
        "cores_per_socket": _int(first.get("cpu cores")),
    }


def first_cpu_block(text):
    return re.split(r"\n\s*\n", text.strip())[0] + "\n" if text.strip() else ""


def parse_lscpu(text):
    wanted = ("Architecture", "CPU(s)", "Model name", "Thread(s) per core", "Core(s) per socket", "Socket(s)")
    values = {}
    for line in text.splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            if key.strip() in wanted:
                values[key.strip()] = value.strip()
    return values


def parse_meminfo(text):
    keys = ("MemTotal", "MemFree", "MemAvailable", "Buffers", "Cached", "SwapTotal", "SwapFree")
    result = {}
    for line in text.splitlines():
        match = re.match(r"^(\w+):\s+(\d+)\s*kB", line)
        if match and match.group(1) in keys:
            result[match.group(1)] = int(match.group(2))
    return result


_DF_RE = re.compile(r"^(\S.*?)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)%\s+(\S.*)$")


def parse_df_p(text):
    rows = []
    for line in text.splitlines()[1:]:
        match = _DF_RE.match(line.strip())
        if match:
            rows.append(
                {
                    "filesystem": match.group(1),
                    "blocks_1k": int(match.group(2)),
                    "used_1k": int(match.group(3)),
                    "available_1k": int(match.group(4)),
                    "use_percent": int(match.group(5)),
                    "mounted_on": match.group(6),
                }
            )
    return rows


_DF_G_RE = re.compile(r"^(\S+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)%\s+(\d+)\s+(\d+)%\s+(\S.*)$")


def parse_df_g(text):
    rows = []
    for line in text.splitlines()[1:]:
        match = _DF_G_RE.match(line.strip())
        if match:
            rows.append(
                {
                    "filesystem": match.group(1),
                    "size_gb": float(match.group(2)),
                    "free_gb": float(match.group(3)),
                    "use_percent": int(match.group(4)),
                    "mounted_on": match.group(7),
                }
            )
    return rows


def _flatten_lsblk(nodes, out):
    for node in nodes or []:
        mount = node.get("mountpoint")
        if mount is None and node.get("mountpoints"):
            mount = ", ".join(m for m in node["mountpoints"] if m)
        out.append(
            {
                "name": node.get("name", ""),
                "type": node.get("type", ""),
                "size": str(node.get("size", "")),
                "fstype": node.get("fstype") or "",
                "mountpoint": mount or "",
            }
        )
        _flatten_lsblk(node.get("children"), out)


def parse_lsblk_json(text):
    out = []
    _flatten_lsblk(json.loads(text).get("blockdevices"), out)
    return out


def parse_lsblk_pairs(text):
    out = []
    for line in text.splitlines():
        pairs = dict(re.findall(r'(\w+)="([^"]*)"', line))
        if pairs.get("NAME"):
            out.append(
                {
                    "name": pairs.get("NAME", ""),
                    "type": pairs.get("TYPE", ""),
                    "size": pairs.get("SIZE", ""),
                    "fstype": pairs.get("FSTYPE", ""),
                    "mountpoint": pairs.get("MOUNTPOINT", ""),
                }
            )
    return out


def parse_proc_mounts(text):
    rows = []
    for line in text.splitlines():
        parts = line.split()
        if len(parts) >= 4:
            rows.append({"device": parts[0], "mount_point": parts[1], "fstype": parts[2], "options": parts[3]})
    return rows


def parse_tab_packages(text):
    rows = []
    for line in text.splitlines():
        parts = line.split("\t")
        if len(parts) >= 2 and parts[0].strip():
            rows.append({"name": parts[0].strip(), "version": parts[1].strip(), "arch": parts[2].strip() if len(parts) > 2 else ""})
    return rows


def parse_apk(text):
    rows = []
    for line in text.splitlines():
        match = re.match(r"^(.+?)-(\d[^-]*-r\d+)$", line.strip())
        if match:
            rows.append({"name": match.group(1), "version": match.group(2), "arch": ""})
    return rows


_LSLPP_RE = re.compile(r"^\s+(\S+)\s+(\d+(?:\.\d+)+)\s+([ABCEO?])\s+(?:([A-Z])\s+)?(.*)$")


def parse_lslpp(text):
    rows = []
    for line in text.splitlines():
        match = _LSLPP_RE.match(line)
        if match:
            rows.append(
                {
                    "name": match.group(1),
                    "version": match.group(2),
                    "arch": "",
                    "state": match.group(3),
                    "description": match.group(5).strip(),
                }
            )
    return rows


def parse_oslevel_s(text):
    match = re.match(r"^\s*(\d{4})-(\d{2})-(\d{2})-(\d{4})\s*$", text)
    if not match:
        return {}
    return {
        "technology_level": "%s-%s" % (match.group(1), match.group(2)),
        "service_pack": match.group(3),
        "build_date": match.group(4),
    }


def parse_lsattr_el(text):
    result = {}
    for line in text.splitlines():
        match = re.match(r"^(\S+)\s+(\S+)\s+(.*?)\s+(True|False)\s*$", line)
        if match:
            result[match.group(1)] = {"value": match.group(2), "description": match.group(3)}
    return result


def parse_prtconf(text):
    result = {}
    for line in text.splitlines():
        if line.startswith("Network Information"):
            break
        match = re.match(r"^([A-Za-z][A-Za-z /()-]*?):\s+(\S.*)$", line)
        if match:
            result.setdefault(match.group(1).strip(), match.group(2).strip())
    return result


def parse_lsdev(text):
    rows = []
    for line in text.splitlines():
        match = re.match(r"^(\S+)\s+(Available|Defined|Stopped|Missing|Unknown)\s+(?:(\d{2}-[\w.-]+)\s+)?(.*)$", line)
        if match:
            rows.append(
                {
                    "name": match.group(1),
                    "status": match.group(2),
                    "location": match.group(3) or "",
                    "description": match.group(4).strip(),
                }
            )
    return rows


def parse_lspv(text):
    rows = []
    for line in text.splitlines():
        parts = line.split()
        if len(parts) >= 3:
            rows.append({"name": parts[0], "pvid": parts[1], "volume_group": parts[2], "state": parts[3] if len(parts) > 3 else ""})
    return rows


def parse_lsvg_l(text):
    rows = []
    for line in text.splitlines():
        match = re.match(r"^(\S+)\s+(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S.*)$", line.strip())
        if match:
            rows.append(
                {
                    "lv": match.group(1),
                    "type": match.group(2),
                    "lps": int(match.group(3)),
                    "pps": int(match.group(4)),
                    "pvs": int(match.group(5)),
                    "state": match.group(6),
                    "mount_point": match.group(7),
                }
            )
    return rows


def parse_lsfs(text):
    rows = []
    for line in text.splitlines()[1:]:
        parts = line.split()
        if len(parts) >= 7:
            rows.append({"name": parts[0], "mount_point": parts[2], "vfs": parts[3], "size": parts[4], "options": parts[5]})
    return rows


def parse_lsps(text):
    rows = []
    for line in text.splitlines():
        match = re.match(r"^(\S+)\s+(\S+)\s+(\S+)\s+(\d+\S*)\s+(\d+)\s+(yes|no)\s+(yes|no)\s+(\S+)", line.strip())
        if match:
            rows.append(
                {
                    "page_space": match.group(1),
                    "physical_volume": match.group(2),
                    "volume_group": match.group(3),
                    "size": match.group(4),
                    "used_percent": int(match.group(5)),
                    "active": match.group(6) == "yes",
                }
            )
    return rows


def parse_svmon_g(text):
    result = {}
    for line in text.splitlines():
        match = re.match(r"^(memory|pg space)\s+(\d+)\s+(\d+)(?:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+))?", line.strip())
        if not match:
            continue
        numbers = [_int(g) for g in match.groups()[1:] if g is not None]
        if match.group(1) == "memory" and len(numbers) >= 6:
            result["memory_frames"] = dict(zip(("size", "inuse", "free", "pin", "virtual", "available"), numbers))
        elif match.group(1) == "pg space":
            result["pg_space_frames"] = {"size": numbers[0], "inuse": numbers[1]}
    return result


def parse_vmstat(text):
    lines = [line for line in text.splitlines() if line.strip()]
    data_index = None
    for index in range(len(lines) - 1, -1, -1):
        if all(re.match(r"^-?\d+(\.\d+)?$", token) for token in lines[index].split()):
            data_index = index
            break
    if not data_index:
        return {}
    values = lines[data_index].split()
    for index in range(data_index - 1, -1, -1):
        names = lines[index].split()
        if len(names) == len(values) and "r" in names and "b" in names:
            return dict(zip(names, [float(v) if "." in v else int(v) for v in values]))
    return {}


def parse_free_m(text):
    result = {}
    for line in text.splitlines():
        parts = line.split()
        if parts and parts[0] == "Mem:" and len(parts) >= 4:
            result["mem_mb"] = {"total": _int(parts[1]), "used": _int(parts[2]), "free": _int(parts[3])}
            if len(parts) >= 7:
                result["mem_mb"]["available"] = _int(parts[6])
        elif parts and parts[0] == "Swap:" and len(parts) >= 4:
            result["swap_mb"] = {"total": _int(parts[1]), "used": _int(parts[2]), "free": _int(parts[3])}
    return result


def parse_loadavg(text):
    parts = text.split()
    if len(parts) >= 3:
        try:
            return {"load1": float(parts[0]), "load5": float(parts[1]), "load15": float(parts[2])}
        except ValueError:
            return {}
    return {}


def parse_uptime(text):
    match = re.search(r"load averages?:\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)", text)
    return {"load1": float(match.group(1)), "load5": float(match.group(2)), "load15": float(match.group(3))} if match else {}


def parse_id(text):
    result = {}
    for key in ("uid", "gid"):
        match = re.search(key + r"=(\d+)\(([^)]*)\)", text)
        if match:
            result[key] = int(match.group(1))
            result[key + "_name"] = match.group(2)
    match = re.search(r"groups=(.*)$", text.strip())
    result["groups"] = re.findall(r"\(([^)]*)\)", match.group(1)) if match else []
    return result


def parse_ulimit(text):
    result = {}
    for line in text.splitlines():
        bash = re.match(r"^(.*?)\s+\(([^)]*?-(\w))\)\s+(\S+)\s*$", line)
        dash = re.match(r"^-(\w):\s+(.*?)\s+(unlimited|\d+)\s*$", line)
        if bash:
            result[bash.group(1).strip()] = bash.group(4)
        elif dash:
            result[dash.group(2).strip()] = dash.group(3)
        else:
            plain = re.match(r"^(\S.*?)\s+(unlimited|\d+)\s*$", line)
            if plain:
                result[plain.group(1).strip()] = plain.group(2)
    return result


def parse_ps(text):
    rows = []
    for line in text.splitlines()[1:]:
        match = re.match(r"^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\S+)\s*(.*)$", line)
        if match:
            rows.append(
                {
                    "pid": int(match.group(1)),
                    "ppid": int(match.group(2)),
                    "user": match.group(3),
                    "cpu_percent": float(match.group(4)),
                    "mem_percent": float(match.group(5)),
                    "elapsed": match.group(6),
                    "command": match.group(7).strip()[:300],
                }
            )
    return rows


def top_processes(rows, limit=15):
    return {
        "by_cpu": sorted(rows, key=lambda r: (-r["cpu_percent"], r["pid"]))[:limit],
        "by_memory": sorted(rows, key=lambda r: (-r["mem_percent"], r["pid"]))[:limit],
        "total": len(rows),
    }


def _port(address):
    match = re.search(r"[.:](\d+)$", address)
    return int(match.group(1)) if match else None


def parse_ss(text):
    rows = []
    for line in text.splitlines():
        parts = line.split()
        if len(parts) >= 5 and parts[0] in ("tcp", "udp", "tcp6", "udp6"):
            rows.append({"protocol": parts[0], "state": parts[1], "local": parts[4], "port": _port(parts[4])})
    return rows


def parse_netstat_listen(text):
    rows = []
    for line in text.splitlines():
        parts = line.split()
        if len(parts) >= 5 and re.match(r"^(tcp|udp)", parts[0]):
            state = parts[-1] if parts[0].startswith("tcp") else "UNCONN"
            if state == "LISTEN" or parts[0].startswith("udp"):
                rows.append({"protocol": parts[0], "state": state, "local": parts[3], "port": _port(parts[3])})
    return rows


def parse_proc_net(text, protocol):
    wanted = "0A" if protocol.startswith("tcp") else "07"
    rows = []
    for line in text.splitlines()[1:]:
        parts = line.split()
        if len(parts) > 3 and parts[3] == wanted and ":" in parts[1]:
            rows.append(
                {
                    "protocol": protocol,
                    "state": "LISTEN" if wanted == "0A" else "UNCONN",
                    "local": parts[1],
                    "port": int(parts[1].split(":")[1], 16),
                }
            )
    return rows


def parse_ifaddrs(text):
    rows = []
    iface = ""
    for line in text.splitlines():
        head = re.match(r"^\d+:\s+([^:\s]+)", line) or re.match(r"^([A-Za-z0-9._-]+):?\s+(?:flags|Link)", line)
        if head:
            iface = head.group(1)
            continue
        v4 = re.search(r"\binet (?:addr:)?(\d+\.\d+\.\d+\.\d+(?:/\d+)?)", line)
        v6 = re.search(r"\binet6 (?:addr:\s*)?([0-9a-fA-F:]+(?:/\d+)?)", line)
        if v4:
            rows.append({"interface": iface, "family": "inet", "address": v4.group(1)})
        elif v6:
            rows.append({"interface": iface, "family": "inet6", "address": v6.group(1)})
    return rows


def parse_default_route(text):
    for line in text.splitlines():
        parts = line.split()
        if parts and parts[0] == "default":
            if "via" in parts and parts.index("via") + 1 < len(parts):
                return parts[parts.index("via") + 1]
            if len(parts) > 1:
                return parts[1]
    return ""


def parse_resolv(text):
    servers = [line.split()[1] for line in text.splitlines() if line.startswith("nameserver") and len(line.split()) > 1]
    return {"nameservers": servers}


def parse_systemctl(text):
    rows = []
    for line in text.splitlines():
        match = re.match(r"^\s*[●*]?\s*(\S+\.service)\s+(\S+)\s+(\S+)\s+(\S+)\s*(.*)$", line)
        if match:
            rows.append(
                {
                    "unit": match.group(1),
                    "load": match.group(2),
                    "active": match.group(3),
                    "sub": match.group(4),
                    "description": match.group(5).strip(),
                }
            )
    return rows


def parse_service_status_all(text):
    states = {"+": "running", "-": "stopped", "?": "unknown"}
    rows = []
    for line in text.splitlines():
        match = re.match(r"^\s*\[\s*([+?-])\s*\]\s+(\S+)", line)
        if match:
            rows.append({"service": match.group(2), "state": states[match.group(1)]})
    return rows


def parse_lssrc(text):
    rows = []
    for line in text.splitlines()[1:]:
        toks = line.split()
        if len(toks) < 2 or toks[-1] not in ("active", "inoperative"):
            continue
        status, rest, pid = toks[-1], toks[:-1], None
        if len(rest) >= 2 and rest[-1].isdigit():
            pid = int(rest.pop())
        rows.append({"subsystem": rest[0], "group": rest[1] if len(rest) > 1 else "", "pid": pid, "status": status})
    return rows


SYSCTL_KEYS = (
    "kernel.pid_max", "kernel.threads-max", "kernel.shmmax", "kernel.shmall", "kernel.sem", "kernel.randomize_va_space",
    "vm.swappiness", "vm.max_map_count", "vm.overcommit_memory", "fs.file-max", "net.core.somaxconn",
    "net.ipv4.ip_local_port_range", "net.ipv4.ip_forward",
)  # fmt: skip


def parse_sysctl(text):
    result = {}
    for line in text.splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            if key.strip() in SYSCTL_KEYS:
                result[key.strip()] = value.strip()
    return result


def parse_proc_stat_btime(text):
    match = re.search(r"^btime\s+(\d+)", text, re.M)
    if not match:
        return ""
    return datetime.datetime.fromtimestamp(int(match.group(1)), datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_version_line(text):
    for line in text.splitlines():
        if line.strip():
            return line.strip()[:200]
    return ""


# --------------------------------------------------------------------------------------
# Collector framework
# --------------------------------------------------------------------------------------


class Ctx(object):
    """Per-collector helper: runs commands/reads files and records one item per source."""

    def __init__(self, runner, family, timeout, mode, redact):
        self.runner = runner
        self.family = family
        self.timeout = timeout
        self.mode = mode
        self.redact = redact

    @staticmethod
    def _item(label, source, target, res, output):
        return {
            "name": label,
            "source": source,
            "target": target,
            "status": res.status,
            "message": res.message,
            "exit_code": res.exit_code,
            "truncated": bool(res.truncated),
            "duration_ms": res.duration_ms,
            "output": output,
        }

    def run(self, label, argv, use_stderr=False):
        res = self.runner.run(list(argv), self.timeout)
        text = res.stdout
        if use_stderr and not text.strip():
            text = res.stderr
        return self._item(label, "command", " ".join(argv), res, text if res.status in ("ok", "timeout") else "")

    def read(self, label, path, max_bytes=None):
        res = self.runner.read_file(path, max_bytes)
        return self._item(label, "file", path, res, res.stdout if res.status == "ok" else "")

    def first_ok(self, attempts):
        """Try (label, argv) alternatives in order; return the first ok item, else the first attempt."""
        first = None
        for label, argv in attempts:
            item = self.run(label, argv)
            if item["status"] == "ok":
                return item
            first = first or item
        return first


def aggregate(items):
    """Collector status from its item statuses: ok when any source worked."""
    if not items:
        return "unavailable", "no data sources"
    ok = [i for i in items if i["status"] == "ok"]
    failed = [i for i in items if i["status"] != "ok"]
    if ok:
        if failed:
            return "ok", "%d of %d sources not collected (%s)" % (
                len(failed),
                len(items),
                ", ".join(sorted(set(i["status"] for i in failed))),
            )
        return "ok", ""
    for status in ("timeout", "permission_denied", "error", "unavailable"):
        if any(i["status"] == status for i in items):
            reasons = "; ".join("%s: %s" % (i["name"], i["message"]) for i in items[:3] if i["message"])
            return status, reasons[:300] or "no data collected"
    return "error", "no data collected"


def _out(item):
    return item["output"] if item["status"] in ("ok", "timeout") else ""


# --- collectors -----------------------------------------------------------------------


def collect_system(ctx):
    items, data = [], {}
    uname = ctx.runner.uname()
    data["hostname"] = ctx.runner.hostname()
    data["uname"] = uname
    items.append(ctx.run("uname -a", ["uname", "-a"]))
    up = ctx.run("uptime", ["uptime"])
    items.append(up)
    if ctx.family == "linux":
        proc_up = ctx.read("/proc/uptime", "/proc/uptime")
        items.append(proc_up)
        if proc_up["status"] == "ok":
            try:
                data["uptime_seconds"] = float(proc_up["output"].split()[0])
            except (ValueError, IndexError):
                pass
        stat = ctx.read("/proc/stat (btime)", "/proc/stat", 65536)
        if stat["status"] == "ok":
            data["boot_time"] = parse_proc_stat_btime(stat["output"])
            stat["output"] = "\n".join(l for l in stat["output"].splitlines() if l.startswith("btime")) + "\n"
        items.append(stat)
    else:
        items.append(ctx.run("who -b", ["who", "-b"]))
        boot = _out(items[-1]).strip()
        if boot:
            data["boot_time_text"] = boot
    data["uptime_text"] = _out(up).strip()
    return items, data


def collect_os(ctx):
    items, data = [], {}
    if ctx.family == "linux":
        osr = ctx.read("/etc/os-release", "/etc/os-release")
        items.append(osr)
        if osr["status"] == "ok":
            data["os_release"] = parse_key_values(osr["output"])
        rh = ctx.read("/etc/redhat-release", "/etc/redhat-release")
        items.append(rh)
        if rh["status"] == "ok":
            data["redhat_release"] = rh["output"].strip()
    else:
        s = ctx.run("oslevel -s", ["oslevel", "-s"])
        items.append(s)
        data["oslevel_s"] = _out(s).strip()
        data.update(parse_oslevel_s(_out(s)))
        r = ctx.run("oslevel -r", ["oslevel", "-r"])
        items.append(r)
        data["oslevel_r"] = _out(r).strip()
        items.append(ctx.run("uname -a", ["uname", "-a"]))
        for key in ("HARDWARE_BITMODE", "KERNEL_BITMODE"):
            g = ctx.run("getconf " + key, ["getconf", key])
            items.append(g)
            if g["status"] == "ok":
                data[key.lower()] = g["output"].strip()
    return items, data


def collect_kernel(ctx):
    items, data = [], {}
    if ctx.family == "linux":
        r = ctx.run("uname -r", ["uname", "-r"])
        items.append(r)
        data["release"] = _out(r).strip()
        items.append(ctx.read("/proc/version", "/proc/version"))
        s = ctx.run("sysctl -a", ["sysctl", "-a"])
        data["sysctl"] = parse_sysctl(_out(s))
        if s["status"] in ("ok", "timeout"):
            s["output"] = "".join("%s = %s\n" % kv for kv in sorted(data["sysctl"].items()))
        if not data["sysctl"] and s["status"] == "ok":
            s["status"], s["message"] = "error", "no allow-listed keys readable"
        items.append(s)
    else:
        b = ctx.run("bootinfo -K", ["bootinfo", "-K"])
        items.append(b)
        data["kernel_bitmode"] = _out(b).strip()
        a = ctx.run("lsattr -El sys0", ["lsattr", "-El", "sys0"])
        items.append(a)
        data["sys0"] = parse_lsattr_el(_out(a))
    return items, data


def collect_hardware(ctx):
    items, data = [], {}
    if ctx.family == "linux":
        cpu = ctx.read("/proc/cpuinfo", "/proc/cpuinfo")
        if cpu["status"] == "ok":
            data["cpu"] = parse_cpuinfo(cpu["output"])
            cpu["output"] = first_cpu_block(cpu["output"])
        items.append(cpu)
        lscpu = ctx.run("lscpu", ["lscpu"])
        items.append(lscpu)
        if lscpu["status"] == "ok":
            data["lscpu"] = parse_lscpu(lscpu["output"])
        mem = ctx.read("/proc/meminfo", "/proc/meminfo")
        items.append(mem)
        if mem["status"] == "ok":
            data["memory_kb"] = parse_meminfo(mem["output"])
    else:
        pc = ctx.run("prtconf", ["prtconf"])
        items.append(pc)
        if pc["status"] == "ok":
            data["prtconf"] = parse_prtconf(pc["output"])
            data["prtconf_trimmed"] = True
            pc["output"] = "".join(
                "%s: %s\n" % kv for kv in sorted(data["prtconf"].items())
            )
        p0 = ctx.run("lsattr -El proc0", ["lsattr", "-El", "proc0"])
        items.append(p0)
        data["proc0"] = parse_lsattr_el(_out(p0))
        dev = ctx.run("lsdev -C", ["lsdev", "-C"])
        items.append(dev)
        devices = parse_lsdev(_out(dev))
        data["devices"] = devices[:500]
        data["device_count"] = len(devices)
    return items, data


def collect_disks(ctx):
    items, data = [], {}
    if ctx.family == "linux":
        lsblk = ctx.run("lsblk -J", ["lsblk", "-J", "-o", "NAME,TYPE,SIZE,FSTYPE,MOUNTPOINT"])
        if lsblk["status"] == "ok":
            try:
                data["block_devices"] = parse_lsblk_json(lsblk["output"])
            except ValueError:
                lsblk["status"], lsblk["message"] = "error", "unparseable lsblk -J output"
        if lsblk["status"] != "ok":
            alt = ctx.run("lsblk -P", ["lsblk", "-P", "-o", "NAME,TYPE,SIZE,FSTYPE,MOUNTPOINT"])
            if alt["status"] == "ok":
                lsblk = alt
                data["block_devices"] = parse_lsblk_pairs(alt["output"])
        items.append(lsblk)
        df = ctx.run("df -P", ["df", "-P"])
        items.append(df)
        data["filesystems"] = parse_df_p(_out(df))
        pm = ctx.read("/proc/mounts", "/proc/mounts")
        items.append(pm)
        data["mounts"] = parse_proc_mounts(_out(pm))[:500]
        items.append(ctx.run("mount", ["mount"]))
    else:
        pv = ctx.run("lspv", ["lspv"])
        items.append(pv)
        data["physical_volumes"] = parse_lspv(_out(pv))
        vg = ctx.run("lsvg", ["lsvg"])
        items.append(vg)
        data["volume_groups"] = [l.strip() for l in _out(vg).splitlines() if l.strip()]
        rl = ctx.run("lsvg -l rootvg", ["lsvg", "-l", "rootvg"])
        items.append(rl)
        data["rootvg_logical_volumes"] = parse_lsvg_l(_out(rl))
        df = ctx.run("df -g", ["df", "-g"])
        items.append(df)
        data["filesystems"] = parse_df_g(_out(df))
        fs = ctx.run("lsfs", ["lsfs"])
        items.append(fs)
        data["lsfs"] = parse_lsfs(_out(fs))
    return items, data


def collect_packages(ctx):
    items, managers = [], []
    specs = []
    if ctx.family == "linux":
        specs = [
            ("rpm -qa", ["rpm", "-qa", "--qf", "%{NAME}\t%{VERSION}-%{RELEASE}\t%{ARCH}\n"], parse_tab_packages, "rpm"),
            ("dpkg-query -W", ["dpkg-query", "-W", "-f", "${Package}\t${Version}\t${Architecture}\n"], parse_tab_packages, "dpkg"),
            ("apk info -v", ["apk", "info", "-v"], parse_apk, "apk"),
        ]  # fmt: skip
    else:
        specs = [("lslpp -L all", ["lslpp", "-L", "all"], parse_lslpp, "lslpp")]
    for label, argv, parser, manager in specs:
        item = ctx.run(label, argv)
        if item["status"] == "ok":
            rows = parser(item["output"])
            managers.append({"manager": manager, "count": len(rows), "truncated": len(rows) > 20000, "items": rows[:20000]})
            item["message"] = item["message"] or "%d packages" % len(rows)
            item["output"] = ""  # parsed list below replaces the raw dump
        items.append(item)
    if ctx.family == "aix":
        inst = ctx.run("instfix -i", ["instfix", "-i"])
        items.append(inst)
    return items, {"managers": managers}


RUNTIME_SPECS = (
    ("java", ["java", "-version"]),
    ("python", ["python", "--version"]),
    ("python3", ["python3", "--version"]),
    ("node", ["node", "-v"]),
    ("perl", ["perl", "-v"]),
    ("gcc", ["gcc", "--version"]),
    ("go", ["go", "version"]),
    ("ruby", ["ruby", "-v"]),
)


def collect_runtimes(ctx):
    items, found = [], []
    for name, argv in RUNTIME_SPECS:
        path = ctx.runner.which(name)
        if not path:
            items.append(
                {
                    "name": name, "source": "command", "target": name, "status": "unavailable",
                    "message": "not found", "exit_code": None, "truncated": False, "duration_ms": 0, "output": "",
                }
            )  # fmt: skip
            found.append({"name": name, "path": "", "version": "", "status": "unavailable"})
            continue
        item = ctx.run(name + " " + " ".join(argv[1:]), [path] + argv[1:], use_stderr=True)
        if item["status"] != "ok" and item["output"] == "":
            alt = ctx.run(name, [path] + argv[1:], use_stderr=True)
            item = alt if alt["status"] == "ok" else item
        items.append(item)
        found.append(
            {"name": name, "path": path, "version": parse_version_line(item["output"]), "status": item["status"]}
        )
    if ctx.family == "aix":
        for path in (ctx.runner.glob("/usr/java*/bin/java") + ctx.runner.glob("/usr/java*/jre/bin/java"))[:6]:
            item = ctx.run("java (" + path + ")", [path, "-version"], use_stderr=True)
            items.append(item)
            found.append({"name": "java", "path": path, "version": parse_version_line(item["output"]), "status": item["status"]})
    # A missing runtime is information, not a failure: the section is ok when anything was found.
    return items, {"runtimes": found}


def collect_environment(ctx):
    items = []
    names_only = ctx.mode == "names"
    entries = []
    for name, value in sorted(ctx.runner.environ().items()):
        if names_only:
            shown = REDACTED
        elif ctx.redact:
            shown = redact_env_value(name, value)
        else:
            shown = value
        entries.append({"name": name, "value": shown, "redacted": shown == REDACTED and value != REDACTED})
    if not names_only:
        for path in ("/etc/environment", "/etc/profile"):
            items.append(ctx.read(path, path, 65536))
    items.append(
        {
            "name": "process environment", "source": "environment", "target": "environ", "status": "ok",
            "message": "%d variables" % len(entries), "exit_code": None, "truncated": False, "duration_ms": 0,
            "output": "",
        }
    )  # fmt: skip
    return items, {"variables": entries, "values_masked": names_only}


def collect_network(ctx):
    items, data = [], {}
    mode = ctx.mode  # full | summary | listening
    linux = ctx.family == "linux"
    if mode in ("full", "summary"):
        host = ctx.run("hostname -f", ["hostname", "-f"])
        items.append(host)
        data["fqdn"] = _out(host).strip()
        attempts = [("ip addr", ["ip", "addr"]), ("ifconfig -a", ["ifconfig", "-a"])] if linux else [("ifconfig -a", ["ifconfig", "-a"])]
        addr = ctx.first_ok(attempts)
        items.append(addr)
        data["addresses"] = parse_ifaddrs(_out(addr))
        attempts = [("ip route", ["ip", "route"]), ("netstat -rn", ["netstat", "-rn"])] if linux else [("netstat -rn", ["netstat", "-rn"])]
        route = ctx.first_ok(attempts)
        items.append(route)
        data["default_gateway"] = parse_default_route(_out(route))
    if mode == "full":
        hosts = ctx.read("/etc/hosts", "/etc/hosts", 65536)
        items.append(hosts)
        resolv = ctx.read("/etc/resolv.conf", "/etc/resolv.conf", 65536)
        items.append(resolv)
        data["resolver"] = parse_resolv(_out(resolv))
    if mode in ("full", "listening"):
        listening = []
        if linux:
            ss = ctx.run("ss -tuln", ["ss", "-tuln"])
            if ss["status"] == "ok":
                listening = parse_ss(ss["output"])
            else:
                ss = ctx.run("netstat -an", ["netstat", "-an"])
                if ss["status"] == "ok":
                    listening = parse_netstat_listen(ss["output"])
                else:
                    first = None
                    for proto in ("tcp", "tcp6", "udp", "udp6"):
                        proc = ctx.read("/proc/net/" + proto, "/proc/net/" + proto, 131072)
                        first = first or proc
                        if proc["status"] == "ok":
                            listening.extend(parse_proc_net(proc["output"], proto))
                    if listening or (first and first["status"] == "ok"):
                        ss = {
                            "name": "/proc/net/{tcp,tcp6,udp,udp6}", "source": "file", "target": "/proc/net", "status": "ok",
                            "message": "fallback: no ss/netstat", "exit_code": None, "truncated": False,
                            "duration_ms": 0, "output": "",
                        }  # fmt: skip
        else:
            ss = ctx.run("netstat -an", ["netstat", "-an"])
            listening = parse_netstat_listen(_out(ss))
        if ss["status"] == "ok":
            ss["output"] = "".join("%s %s %s\n" % (r["protocol"], r["state"], r["local"]) for r in listening)
        items.append(ss)
        data["listening"] = listening[:1000]
    return items, data


def collect_users_limits(ctx):
    items, data = [], {}
    ident = ctx.run("id", ["id"])
    items.append(ident)
    data["identity"] = parse_id(_out(ident))
    items.append(ctx.run("whoami", ["whoami"]))
    data["user"] = _out(items[-1]).strip()
    ul = ctx.run("ulimit -a", ["sh", "-c", "ulimit -a"])
    items.append(ul)
    data["ulimits"] = parse_ulimit(_out(ul))
    if ctx.mode == "full":
        if ctx.family == "linux":
            items.append(ctx.read("/etc/security/limits.conf", "/etc/security/limits.conf", 65536))
        else:
            items.append(ctx.read("/etc/security/limits", "/etc/security/limits", 65536))
            lu = ctx.run(
                "lsuser (limits)", ["lsuser", "-a", "id", "pgrp", "fsize", "cpu", "data", "stack", "core", "rss", "nofiles", "ALL"]
            )
            items.append(lu)
            sys0 = ctx.run("lsattr -El sys0 (maxuproc)", ["lsattr", "-El", "sys0", "-a", "maxuproc"])
            items.append(sys0)
            data["maxuproc"] = _out(sys0).strip()
    return items, data


def collect_services(ctx):
    items, data = [], {}
    if ctx.family == "linux":
        sc = ctx.run("systemctl list-units", ["systemctl", "list-units", "--type=service", "--no-pager"])
        items.append(sc)
        data["systemd_services"] = parse_systemctl(_out(sc))[:1000]
        sv = ctx.run("service --status-all", ["service", "--status-all"])
        items.append(sv)
        data["sysv_services"] = parse_service_status_all(_out(sv))[:1000]
    else:
        ls = ctx.run("lssrc -a", ["lssrc", "-a"])
        items.append(ls)
        data["subsystems"] = parse_lssrc(_out(ls))[:1000]
    return items, data


def collect_resources(ctx):
    items, data = [], {}
    up = ctx.run("uptime", ["uptime"])
    items.append(up)
    data["load"] = parse_uptime(_out(up))
    vm = ctx.run("vmstat", ["vmstat"])
    items.append(vm)
    data["vmstat"] = parse_vmstat(_out(vm))
    if ctx.family == "linux":
        la = ctx.read("/proc/loadavg", "/proc/loadavg")
        items.append(la)
        if la["status"] == "ok":
            data["load"] = parse_loadavg(la["output"]) or data["load"]
        fr = ctx.run("free -m", ["free", "-m"])
        items.append(fr)
        data.update(parse_free_m(_out(fr)))
    else:
        sv = ctx.run("svmon -G", ["svmon", "-G"])
        items.append(sv)
        data["svmon"] = parse_svmon_g(_out(sv))
        ps = ctx.run("lsps -a", ["lsps", "-a"])
        items.append(ps)
        data["paging_spaces"] = parse_lsps(_out(ps))
        items.append(ctx.run("iostat", ["iostat"]))
    return items, data


def collect_processes(ctx):
    item = ctx.run("ps -eo", ["ps", "-eo", "pid,ppid,user,pcpu,pmem,etime,args"])
    rows = parse_ps(_out(item)) if item["status"] == "ok" else []
    data = top_processes(rows)
    if item["status"] == "ok":
        item["output"] = "".join(
            "%6d %6d %-10s %5.1f %5.1f %s\n" % (r["pid"], r["ppid"], r["user"], r["cpu_percent"], r["mem_percent"], r["command"])
            for r in data["by_cpu"]
        )
    return [item], data


# id, title, supported families, function
COLLECTORS = (
    ("system", "System and host identity", ("linux", "aix"), collect_system),
    ("os", "Operating system", ("linux", "aix"), collect_os),
    ("kernel", "Kernel", ("linux", "aix"), collect_kernel),
    ("hardware", "Hardware (CPU, memory, devices)", ("linux", "aix"), collect_hardware),
    ("disks", "Disks and filesystems", ("linux", "aix"), collect_disks),
    ("packages", "Installed packages", ("linux", "aix"), collect_packages),
    ("runtimes", "Language runtimes and toolchains", ("linux", "aix"), collect_runtimes),
    ("environment", "Environment variables and config (sanitised)", ("linux", "aix"), collect_environment),
    ("network", "Network (local only)", ("linux", "aix"), collect_network),
    ("users_limits", "Users and limits", ("linux", "aix"), collect_users_limits),
    ("services", "Services", ("linux", "aix"), collect_services),
    ("resources", "Resource usage", ("linux", "aix"), collect_resources),
    ("processes", "Top processes by CPU and memory", ("linux", "aix"), collect_processes),
)
COLLECTOR_IDS = tuple(c[0] for c in COLLECTORS)

# Collection profiles per CMM context: collector id -> mode
PROFILES = {
    "ICG": dict((cid, "full") for cid in COLLECTOR_IDS),
    "ACQ": {
        "system": "full", "os": "full", "hardware": "full", "disks": "full", "packages": "full", "runtimes": "full",
        "users_limits": "metadata", "network": "summary",
    },  # fmt: skip
    "ISS": {
        "os": "full", "kernel": "full", "packages": "full", "services": "full", "users_limits": "full",
        "network": "listening", "environment": "names", "resources": "full",
    },  # fmt: skip
}
PROFILE_DESCRIPTIONS = {
    "ICG": "Infrastructure/configuration inventory: every collector, full detail.",
    "ACQ": (
        "Acquisition/due diligence: system, os, hardware, disks, packages, runtimes, users_limits (metadata only: "
        "no limits files), network (summary only: addresses and routes). No environment variable values, no process list."
    ),
    "ISS": (
        "Information security/support: os, kernel, packages, services, users_limits, network (listening ports only), "
        "environment (variable names only, every value redacted), resources."
    ),
}
FAMILY_NAMES = {"linux": "Linux", "aix": "AIX"}


def os_family(system_name):
    name = (system_name or "").lower()
    return name if name in ("linux", "aix") else "other"


def run_collector(spec, runner, family, timeout, mode, redact, system_name=""):
    cid, title, families, func = spec
    started = time.time()
    section = {"id": cid, "title": title, "status": "ok", "message": "", "mode": mode, "items": [], "data": {}}
    if family not in families:
        section["status"] = "unsupported"
        section["message"] = "%s supports %s only; this host is '%s'." % (
            cid,
            " and ".join(FAMILY_NAMES[f] for f in families),
            system_name or "unknown",
        )
    else:
        try:
            items, data = func(Ctx(runner, family, timeout, mode, redact))
            section["items"], section["data"] = items, data
            section["status"], section["message"] = aggregate(items)
        except Exception as exc:  # collectors must never crash the run
            section["status"] = "error"
            section["message"] = "collector failed: %s" % exc.__class__.__name__
    section["duration_ms"] = int((time.time() - started) * 1000)
    if redact and section["status"] != "unsupported":
        section = sanitize(section)
    return section


def build_report(runner, context, project, environment, redact, timeout, context_explicit, now=None):
    now = now or datetime.datetime.now(datetime.timezone.utc)
    family = os_family(runner.system())
    profile = PROFILES[context]
    hostname = runner.hostname()
    sections, summary = {}, []
    for spec in COLLECTORS:
        if spec[0] not in profile:
            continue
        section = run_collector(spec, runner, family, timeout, profile[spec[0]], redact, runner.system())
        sections[spec[0]] = section
        summary.append(
            {
                "id": spec[0],
                "title": spec[1],
                "status": section["status"],
                "message": section["message"],
                "duration_ms": section["duration_ms"],
            }
        )
    uname = runner.uname()
    return {
        "schema_version": SCHEMA_VERSION,
        "tool": {"name": TOOL_NAME, "version": TOOL_VERSION},
        "generated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "host": {"hostname": hostname, "host_id": hashlib.sha256(hostname.encode("utf-8")).hexdigest()[:16]},
        "python_version": platform.python_version(),
        "platform": {
            "system": runner.system(),
            "release": uname.get("release", ""),
            "machine": uname.get("machine", ""),
            "family": family,
        },
        "redaction": bool(redact),
        "context": {
            "context": context,
            "context_explicit": bool(context_explicit),
            "project": project or "",
            "environment": environment or "",
        },
        "profile": {
            "name": context,
            "collectors": [cid for cid in COLLECTOR_IDS if cid in profile],
            "modes": dict((cid, profile[cid]) for cid in COLLECTOR_IDS if cid in profile),
        },
        "collectors": summary,
        "sections": sections,
    }


# --------------------------------------------------------------------------------------
# TXT rendering
# --------------------------------------------------------------------------------------


def _render_value(value, indent, lines, limit=60):
    pad = "  " * indent
    if isinstance(value, dict):
        for key in value:
            child = value[key]
            if isinstance(child, (dict, list)) and child:
                lines.append("%s%s:" % (pad, key))
                _render_value(child, indent + 1, lines, limit)
            else:
                lines.append("%s%s: %s" % (pad, key, child if not isinstance(child, (dict, list)) else "-"))
    elif isinstance(value, list):
        for row in value[:limit]:
            if isinstance(row, dict):
                lines.append(pad + "  ".join("%s=%s" % (k, v) for k, v in row.items() if v not in ("", None)))
            else:
                lines.append("%s%s" % (pad, row))
        if len(value) > limit:
            lines.append("%s... %d more (see JSON report)" % (pad, len(value) - limit))


def render_txt(report):
    ctx = report["context"]
    lines = ["ENVIRONMENT SNAPSHOT", "=" * 72]
    header = [
        ("Schema version", report["schema_version"]),
        ("Tool", "%s %s" % (report["tool"]["name"], report["tool"]["version"])),
        ("Generated at (UTC)", report["generated_at"]),
        ("Host", "%s (id %s)" % (report["host"]["hostname"], report["host"]["host_id"])),
        ("Platform", "%s %s %s" % (report["platform"]["system"], report["platform"]["release"], report["platform"]["machine"])),
        ("Python", report["python_version"]),
        ("Context", "%s (%s)" % (ctx["context"], "explicit" if ctx["context_explicit"] else "default")),
        ("Project", ctx["project"] or "-"),
        ("Environment", ctx["environment"] or "-"),
        ("Redaction", "on" if report["redaction"] else "OFF"),
        ("Collectors", ", ".join(report["profile"]["collectors"])),
    ]
    lines.extend("%-20s %s" % (k + ":", v) for k, v in header)
    lines += ["", "COLLECTOR STATUS", "-" * 72, "%-14s %-18s %8s  %s" % ("collector", "status", "ms", "message")]
    for row in report["collectors"]:
        lines.append("%-14s %-18s %8d  %s" % (row["id"], row["status"], row["duration_ms"], row["message"]))
    for cid in report["profile"]["collectors"]:
        section = report["sections"][cid]
        lines += ["", "=" * 72, "%s  [%s]" % (section["title"].upper(), section["status"]), "=" * 72]
        if section["message"]:
            lines.append("Note: " + section["message"])
        data = dict(section["data"])
        if cid == "packages":
            for manager in data.get("managers", []):
                lines.append("%s: %d packages" % (manager["manager"], manager["count"]))
                lines.extend("  %s %s %s" % (p["name"], p["version"], p.get("arch", "")) for p in manager["items"][:300])
                if manager["count"] > 300:
                    lines.append("  ... %d more (see JSON report)" % (manager["count"] - 300))
            data.pop("managers", None)
        if data:
            _render_value(data, 0, lines)
        for item in section["items"]:
            lines.append("")
            lines.append("--- %s [%s]%s%s" % (item["name"], item["status"], " " + item["message"] if item["message"] else "", " (truncated)" if item["truncated"] else ""))
            if item["output"].strip():
                lines.append(item["output"].rstrip("\n"))
    return "\n".join(lines) + "\n"


# --------------------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------------------


def _label(value):
    if not LABEL_RE.match(value):
        raise argparse.ArgumentTypeError("must be 1-64 characters from A-Z a-z 0-9 . _ space -")
    return value


def _timeout(value):
    try:
        number = int(value)
    except ValueError:
        raise argparse.ArgumentTypeError("must be an integer between 1 and 120")
    if number < 1 or number > 120:
        raise argparse.ArgumentTypeError("must be an integer between 1 and 120")
    return number


def build_parser():
    parser = argparse.ArgumentParser(
        prog="env_snapshot.py",
        description="Offline, read-only Linux/AIX environment snapshot (TXT and JSON reports).",
    )
    parser.add_argument("--output-dir", default="./env-snapshot-output", help="report directory (default ./env-snapshot-output)")
    parser.add_argument("--format", choices=("txt", "json", "both"), default="both")
    parser.add_argument("--context", choices=CONTEXTS, default=None, help="CMM context: ICG (default), ACQ or ISS")
    parser.add_argument("--project", type=_label, default=None, help="project label")
    parser.add_argument("--environment", type=_label, default=None, help="environment label (dev, uat, prod ...)")
    parser.add_argument("--redact", dest="redact", action="store_true", default=True, help="redact secrets (default)")
    parser.add_argument("--no-redact", dest="redact", action="store_false", help="keep values unredacted")
    parser.add_argument("--timeout", type=_timeout, default=DEFAULT_TIMEOUT, help="per-command timeout in seconds, 1-120")
    parser.add_argument("--list-collectors", action="store_true", help="list collectors and profiles, then exit")
    parser.add_argument("--version", action="version", version="%s %s" % (TOOL_NAME, TOOL_VERSION))
    return parser


def list_collectors_text():
    lines = ["%-14s %-46s %-11s %s" % ("COLLECTOR", "TITLE", "OS", "PROFILES")]
    for cid, title, families, _func in COLLECTORS:
        profiles = ", ".join(
            "%s%s" % (name, "" if PROFILES[name][cid] == "full" else " (%s)" % PROFILES[name][cid])
            for name in CONTEXTS
            if cid in PROFILES[name]
        )
        lines.append("%-14s %-46s %-11s %s" % (cid, title, "/".join(FAMILY_NAMES[f] for f in families), profiles))
    lines += ["", "PROFILES (--context)"]
    for name in CONTEXTS:
        lines.append("  %s%s: %s" % (name, " (default)" if name == DEFAULT_CONTEXT else "", PROFILE_DESCRIPTIONS[name]))
    lines.append("")
    lines.append("Other platforms: every collector reports 'unsupported' and the exit code is still 0.")
    return "\n".join(lines) + "\n"


def _safe_name(value):
    return re.sub(r"[^A-Za-z0-9._-]", "_", value)[:64] or "host"


def write_reports(report, output_dir, fmt, now):
    """Write the report files with exclusive creation (never overwrites). Returns the paths."""
    stamp = now.strftime("%Y%m%dT%H%M%SZ")
    base = "env-snapshot_%s_%s_%s" % (_safe_name(report["host"]["hostname"]), report["context"]["context"], stamp)
    extensions = {"txt": ["txt"], "json": ["json"], "both": ["txt", "json"]}[fmt]
    suffix = 0
    while True:
        stem = base if suffix == 0 else "%s-%d" % (base, suffix)
        if not any(os.path.exists(os.path.join(output_dir, "%s.%s" % (stem, ext))) for ext in extensions):
            break
        suffix += 1
    contents = {}
    if "txt" in extensions:
        contents["txt"] = render_txt(report)
    if "json" in extensions:
        contents["json"] = json.dumps(report, indent=2) + "\n"
    written = []
    for ext in extensions:
        path = os.path.join(output_dir, "%s.%s" % (stem, ext))
        with io.open(path, "x", encoding="utf-8", newline="\n") as handle:
            handle.write(contents[ext])
        written.append(path)
    return written


def main(argv=None, runner=None, now=None, out=None):
    out = out or sys.stdout
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.list_collectors:
        out.write(list_collectors_text())
        return 0
    output_dir = os.path.abspath(args.output_dir)
    if os.path.exists(output_dir) and not os.path.isdir(output_dir):
        parser.error("--output-dir %s exists and is not a directory" % args.output_dir)
    runner = runner or RealRunner()
    now = now or datetime.datetime.now(datetime.timezone.utc)
    context = args.context or DEFAULT_CONTEXT
    report = build_report(
        runner, context, args.project, args.environment, args.redact, args.timeout, args.context is not None, now
    )
    try:
        os.makedirs(output_dir, exist_ok=True)
        written = write_reports(report, output_dir, args.format, now)
    except OSError as exc:
        sys.stderr.write("env_snapshot: cannot write report: %s\n" % exc.__class__.__name__)
        return 1
    counts = {}
    for row in report["collectors"]:
        counts[row["status"]] = counts.get(row["status"], 0) + 1
    out.write("Collectors: %s\n" % ", ".join("%s=%d" % kv for kv in sorted(counts.items())))
    for path in written:
        out.write("Wrote %s\n" % path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
