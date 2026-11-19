#!/usr/bin/env python3
"""Offline Linux/AIX environment snapshot. Uses only Python's standard library.

The collector does not open sockets, install packages, read environment variables,
or execute shell commands. Reports are written only to a caller-selected local path.
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import socket
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _command_output(argv: list[str], timeout: int = 4) -> str | None:
    """Run a fixed, non-shell diagnostic command; return None when unavailable."""
    executable = shutil.which(argv[0])
    if not executable:
        return None
    try:
        result = subprocess.run(
            [executable, *argv[1:]],
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout,
            shell=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if result.returncode != 0:
        return None
    return result.stdout.strip()[:12000] or None


def _memory_bytes() -> dict[str, int] | None:
    """Read total/available memory from procfs (Linux); no external command."""
    proc_mem = Path("/proc/meminfo")
    if proc_mem.is_file():
        values: dict[str, int] = {}
        try:
            for line in proc_mem.read_text(encoding="ascii", errors="ignore").splitlines():
                key, _, rest = line.partition(":")
                fields = rest.split()
                if fields and fields[0].isdigit():
                    values[key] = int(fields[0]) * 1024
            if "MemTotal" in values:
                return {
                    "total_bytes": values["MemTotal"],
                    "available_bytes": values.get("MemAvailable", values.get("MemFree", 0)),
                }
        except OSError:
            pass
    # AIX commonly exposes memory through lsattr; retain raw output rather than
    # guessing a byte conversion from platform-specific units.
    aix_memory = _command_output(["lsattr", "-El", "sys0"])
    return {"aix_sys0_attributes": aix_memory} if aix_memory else None  # type: ignore[dict-item]


def _filesystem_root() -> dict[str, int] | None:
    try:
        stat = os.statvfs(os.path.abspath(os.sep))
    except OSError:
        return None
    unit = stat.f_frsize or stat.f_bsize
    return {
        "total_bytes": stat.f_blocks * unit,
        "available_bytes": stat.f_bavail * unit,
        "used_bytes": (stat.f_blocks - stat.f_bfree) * unit,
    }


def collect_snapshot() -> dict[str, Any]:
    """Collect a conservative, local-only snapshot for Linux and AIX hosts."""
    system = platform.system()
    if system not in {"Linux", "AIX"}:
        raise RuntimeError(f"Unsupported operating system: {system or 'unknown'}")

    uname = platform.uname()
    hostname = socket.gethostname()
    return {
        "schema_version": "1.0",
        "captured_at_utc": datetime.now(timezone.utc).isoformat(),
        "platform": {
            "system": system,
            "release": platform.release(),
            "version": platform.version(),
            "machine": platform.machine(),
            "processor": platform.processor() or None,
            "python": platform.python_version(),
            "hostname": hostname,
            "uname": {
                "node": uname.node,
                "system": uname.system,
                "release": uname.release,
                "version": uname.version,
                "machine": uname.machine,
            },
        },
        "resources": {
            "logical_cpu_count": os.cpu_count(),
            "memory": _memory_bytes(),
            "root_filesystem": _filesystem_root(),
        },
        "diagnostics": {
            "oslevel": _command_output(["oslevel"]) if system == "AIX" else None,
            "lparstat": _command_output(["lparstat", "-i"]) if system == "AIX" else None,
            "df_root": _command_output(["df", "-Pk", "/"]),
        },
        # These are stable report group identifiers. Their business meanings
        # remain defined by the consuming CMM workflow, not inferred here.
        "cmm": {
            "ICG": {"status": "collected", "scope": "identity, configuration and general host context"},
            "ACQ": {"status": "collected", "scope": "acquisition and capacity observations"},
            "ISS": {"status": "collected", "scope": "infrastructure and system state observations"},
        },
        "collection_policy": {
            "network_access": "none",
            "environment_variables_read": False,
            "packages_installed": False,
            "commands_shell_interpretation": False,
        },
    }


def render_text(snapshot: dict[str, Any]) -> str:
    lines = [
        "ENVIRONMENT SNAPSHOT",
        f"Schema: {snapshot['schema_version']}",
        f"Captured (UTC): {snapshot['captured_at_utc']}",
        "",
        "PLATFORM",
    ]
    for key, value in snapshot["platform"].items():
        if key != "uname":
            lines.append(f"{key}: {value}")
    lines.extend(["", "RESOURCES"])
    for key, value in snapshot["resources"].items():
        lines.append(f"{key}: {json.dumps(value, sort_keys=True)}")
    lines.extend(["", "DIAGNOSTICS"])
    for key, value in snapshot["diagnostics"].items():
        lines.append(f"{key}: {value if value is not None else 'not available'}")
    lines.extend(["", "CMM GROUPS"])
    for key, value in snapshot["cmm"].items():
        lines.append(f"{key}: {value['status']} — {value['scope']}")
    lines.extend(["", "COLLECTION POLICY"])
    for key, value in snapshot["collection_policy"].items():
        lines.append(f"{key}: {value}")
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--format", choices=("json", "txt"), default="json")
    parser.add_argument("--output", required=True, help="local output file path")
    args = parser.parse_args(argv)

    try:
        snapshot = collect_snapshot()
        output = json.dumps(snapshot, indent=2, sort_keys=True) + "\n" if args.format == "json" else render_text(snapshot)
        destination = Path(args.output).expanduser()
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(output, encoding="utf-8")
    except (OSError, RuntimeError, ValueError) as exc:
        print(f"environment snapshot failed: {exc}", file=sys.stderr)
        return 1
    print(f"snapshot written: {destination}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
