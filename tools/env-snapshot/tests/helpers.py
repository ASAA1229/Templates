# -*- coding: utf-8 -*-
"""Shared test helpers: module loader, fixture-backed fake runner, JSON-schema-subset validator."""
import importlib.util
import io
import json
import os
import re
import sys

sys.dont_write_bytecode = True

TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
TOOL_DIR = os.path.dirname(TESTS_DIR)
FIXTURES = os.path.join(TESTS_DIR, "fixtures")
SOURCE_PATH = os.path.join(TOOL_DIR, "env_snapshot.py")
SCHEMA_PATH = os.path.join(TOOL_DIR, "report.schema.json")


def load_module():
    spec = importlib.util.spec_from_file_location("env_snapshot", SOURCE_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules["env_snapshot"] = module
    spec.loader.exec_module(module)
    return module


es = load_module()


def fixture(rel):
    with io.open(os.path.join(FIXTURES, *rel.split("/")), encoding="utf-8", newline="") as handle:
        return handle.read()


# command key (basename + first two args) -> (fixture, stream)
LINUX_COMMANDS = {
    "uname -a": "linux/uname-a.txt",
    "uname -r": "linux/uname-r.txt",
    "uptime": "linux/uptime.txt",
    "lscpu": "linux/lscpu",
    "sysctl -a": "linux/sysctl-a.txt",
    "lsblk -J -o": "linux/lsblk-j.txt",
    "df -P": "linux/df-P",
    "mount": "linux/mount.txt",
    "rpm -qa --qf": "linux/rpm-qa.txt",
    "dpkg-query -W -f": "linux/dpkg-query.txt",
    "apk info -v": "linux/apk-info.txt",
    "java -version": ("linux/java-version.txt", "stderr"),
    "python3 --version": "linux/python3-version.txt",
    "node -v": "linux/node-v.txt",
    "perl -v": "linux/perl-v.txt",
    "gcc --version": "linux/gcc-version.txt",
    "hostname -f": "linux/hostname-f.txt",
    "ip addr": "linux/ip-addr.txt",
    "ip route": "linux/ip-route.txt",
    "ss -tuln": "linux/ss-tuln.txt",
    "id": "linux/id.txt",
    "whoami": "linux/whoami.txt",
    "sh -c ulimit -a": "linux/ulimit-a.txt",
    "systemctl list-units --type=service": "linux/systemctl-units.txt",
    "service --status-all": "linux/service-status-all.txt",
    "vmstat": "linux/vmstat.txt",
    "free -m": "linux/free-m.txt",
    "ps -eo pid,ppid,user,pcpu,pmem,etime,args": "linux/ps.txt",
}
LINUX_FILES = {
    "/etc/os-release": "linux/os-release",
    "/etc/redhat-release": "linux/redhat-release",
    "/proc/cpuinfo": "linux/cpuinfo",
    "/proc/meminfo": "linux/meminfo",
    "/proc/mounts": "linux/proc-mounts",
    "/proc/version": "linux/proc-version",
    "/proc/uptime": "linux/proc-uptime",
    "/proc/stat": "linux/proc-stat",
    "/proc/loadavg": "linux/proc-loadavg",
    "/etc/hosts": "linux/hosts",
    "/etc/resolv.conf": "linux/resolv.conf",
    "/etc/security/limits.conf": "linux/limits.conf",
    "/etc/environment": "linux/etc-environment",
    "/etc/profile": "linux/etc-profile",
}
AIX_COMMANDS = {
    "uname -a": "aix/uname-a.txt",
    "uptime": "aix/uptime.txt",
    "who -b": "aix/who-b.txt",
    "oslevel -s": "aix/oslevel-s.txt",
    "oslevel -r": "aix/oslevel-r.txt",
    "getconf HARDWARE_BITMODE": "aix/getconf-hw.txt",
    "getconf KERNEL_BITMODE": "aix/getconf-kernel.txt",
    "bootinfo -K": "aix/bootinfo-K.txt",
    "lsattr -El sys0": "aix/lsattr-sys0.txt",
    "lsattr -El proc0": "aix/lsattr-proc0.txt",
    "prtconf": "aix/prtconf.txt",
    "lsdev -C": "aix/lsdev-C.txt",
    "lspv": "aix/lspv.txt",
    "lsvg": "aix/lsvg.txt",
    "lsvg -l rootvg": "aix/lsvg-l-rootvg.txt",
    "df -g": "aix/df-g.txt",
    "lsfs": "aix/lsfs.txt",
    "lslpp -L all": "aix/lslpp-L.txt",
    "instfix -i": "aix/instfix-i.txt",
    "java -version": ("aix/java-version.txt", "stderr"),
    "hostname -f": "aix/hostname-f.txt",
    "ifconfig -a": "aix/ifconfig-a.txt",
    "netstat -rn": "aix/netstat-rn.txt",
    "netstat -an": "aix/netstat-an.txt",
    "id": "aix/id.txt",
    "whoami": "aix/whoami.txt",
    "sh -c ulimit -a": "aix/ulimit-a.txt",
    "lsuser -a id": "aix/lsuser.txt",
    "lssrc -a": "aix/lssrc-a.txt",
    "vmstat": "aix/vmstat.txt",
    "svmon -G": "aix/svmon-G.txt",
    "lsps -a": "aix/lsps-a.txt",
    "iostat": "aix/iostat.txt",
    "ps -eo pid,ppid,user,pcpu,pmem,etime,args": "aix/ps.txt",
}
AIX_FILES = {"/etc/security/limits": "aix/limits.txt", "/etc/hosts": "linux/hosts", "/etc/resolv.conf": "linux/resolv.conf"}


class FakeRunner(object):
    """Serves fixture outputs instead of running anything; records every request."""

    def __init__(self, family="linux", overrides=None, env=None, hostname=None, system_name=None, files=None):
        self.family = family
        self.system_name = system_name or {"linux": "Linux", "aix": "AIX"}.get(family, family)
        self.commands = dict(LINUX_COMMANDS if family == "linux" else AIX_COMMANDS if family == "aix" else {})
        self.files = dict(LINUX_FILES if family == "linux" else AIX_FILES if family == "aix" else {})
        if files:
            self.files.update(files)
        self.overrides = overrides or {}
        self.env = env if env is not None else {"HOME": "/home/svcapp", "PATH": "/usr/bin"}
        self._hostname = hostname or ("rhel8-app01" if family == "linux" else "aixprod01")
        self.requests = []

    def system(self):
        return self.system_name

    def hostname(self):
        return self._hostname

    def uname(self):
        return {"sysname": self.system_name, "nodename": self._hostname, "release": "4.18.0", "version": "#1", "machine": "x86_64"}

    def environ(self):
        return dict(self.env)

    def glob(self, pattern):
        return []

    def which(self, name):
        base = os.path.basename(name)
        if any(key == base or key.startswith(base + " ") for key in list(self.commands) + list(self.overrides)):
            return "/usr/bin/" + base
        return None

    @staticmethod
    def key(argv):
        return " ".join([os.path.basename(argv[0])] + list(argv[1:3]))

    def run(self, argv, timeout):
        key = self.key(argv)
        self.requests.append(("run", key))
        for candidate in (key, " ".join([os.path.basename(argv[0])] + list(argv[1:2])), os.path.basename(argv[0])):
            if candidate in self.overrides:
                return self.overrides[candidate]
        for candidate in (key, " ".join([os.path.basename(argv[0])] + list(argv[1:2])), os.path.basename(argv[0])):
            if candidate in self.commands:
                spec = self.commands[candidate]
                name, stream = (spec, "stdout") if isinstance(spec, str) else spec
                text = fixture(name)
                if stream == "stderr":
                    return es.CommandResult("ok", stderr=text, exit_code=0)
                return es.CommandResult("ok", stdout=text, exit_code=0)
        for candidate in list(self.commands):
            if key.startswith(candidate + " ") or key.startswith(candidate):
                spec = self.commands[candidate]
                name, stream = (spec, "stdout") if isinstance(spec, str) else spec
                return es.CommandResult("ok", stdout=fixture(name), exit_code=0)
        return es.CommandResult("unavailable", message="command not found: " + os.path.basename(argv[0]))

    def read_file(self, path, max_bytes=None):
        self.requests.append(("file", path))
        if path in self.overrides:
            return self.overrides[path]
        if path in self.files:
            return es.CommandResult("ok", stdout=fixture(self.files[path]))
        return es.CommandResult("unavailable", message="file not found")


# --------------------------------------------------------------------------------------
# Tiny JSON Schema subset validator (types, required, enum, pattern, items, properties,
# additionalProperties, $ref, minimum, minLength, maxLength)
# --------------------------------------------------------------------------------------

_TYPES = {
    "object": lambda v: isinstance(v, dict),
    "array": lambda v: isinstance(v, list),
    "string": lambda v: isinstance(v, str),
    "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
    "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
    "boolean": lambda v: isinstance(v, bool),
    "null": lambda v: v is None,
}


def validate(instance, schema, root=None, path="$"):
    """Return a list of error strings (empty when valid)."""
    root = root or schema
    errors = []
    if "$ref" in schema:
        node = root
        for part in schema["$ref"].lstrip("#/").split("/"):
            node = node[part]
        return validate(instance, node, root, path)
    if "type" in schema:
        types = schema["type"] if isinstance(schema["type"], list) else [schema["type"]]
        if not any(_TYPES[t](instance) for t in types):
            return ["%s: expected %s, got %s" % (path, "/".join(types), type(instance).__name__)]
    if "enum" in schema and instance not in schema["enum"]:
        errors.append("%s: %r not in enum" % (path, instance))
    if isinstance(instance, str):
        if "pattern" in schema and not re.search(schema["pattern"], instance):
            errors.append("%s: %r does not match %s" % (path, instance[:40], schema["pattern"]))
        if "minLength" in schema and len(instance) < schema["minLength"]:
            errors.append("%s: shorter than %d" % (path, schema["minLength"]))
        if "maxLength" in schema and len(instance) > schema["maxLength"]:
            errors.append("%s: longer than %d" % (path, schema["maxLength"]))
    if _TYPES["number"](instance) and "minimum" in schema and instance < schema["minimum"]:
        errors.append("%s: below minimum" % path)
    if isinstance(instance, list) and "items" in schema:
        for index, value in enumerate(instance):
            errors.extend(validate(value, schema["items"], root, "%s[%d]" % (path, index)))
    if isinstance(instance, dict):
        for name in schema.get("required", []):
            if name not in instance:
                errors.append("%s: missing required %s" % (path, name))
        properties = schema.get("properties", {})
        for name, value in instance.items():
            if name in properties:
                errors.extend(validate(value, properties[name], root, "%s.%s" % (path, name)))
            elif schema.get("additionalProperties") is False:
                errors.append("%s: unexpected property %s" % (path, name))
            elif isinstance(schema.get("additionalProperties"), dict):
                errors.extend(validate(value, schema["additionalProperties"], root, "%s.%s" % (path, name)))
    return errors


def load_schema():
    with io.open(SCHEMA_PATH, encoding="utf-8") as handle:
        return json.load(handle)


def snapshot(runner, context="ICG", redact=True, project="demo", environment="dev", explicit=True):
    return es.build_report(runner, context, project, environment, redact, 5, explicit)
