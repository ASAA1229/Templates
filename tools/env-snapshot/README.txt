ENV-SNAPSHOT 1.0.0 - offline Linux/AIX environment snapshot
===========================================================

PURPOSE
  Collect a read-only inventory of a host (OS, kernel, hardware, disks, packages, runtimes,
  environment, local network, users/limits, services, resource usage, top processes) and write it
  as a human-readable TXT report and/or a schema-versioned JSON report. Intended for configuration
  inventory, acquisition/due-diligence and information-security/support reviews.

REQUIREMENTS
  - Python 3.6 or newer (tested on 3.6 and 3.14). Standard library only; nothing to install.
  - Linux or AIX. On any other platform (for example a Windows workstation) every collector reports
    "unsupported" and the exit code is still 0.
  - No root needed. Collectors that need privileges report "permission_denied" instead of failing.

QUICK START
  python env_snapshot.py --context ICG --project "Billing" --environment prod
  python env_snapshot.py --list-collectors
  python env_snapshot.py --context ISS --output-dir /tmp/snap --format json --timeout 20

  On AIX use the interpreter you have, for example /opt/freeware/bin/python3 or /usr/bin/python3.

SAFETY GUARANTEES
  - Offline: no network calls, no DNS lookups, no pings. Only local files and local commands.
    (hostname -f is run as specified; it resolves through the local resolver configuration only.)
  - Read-only: the tool never changes the host. It writes only inside --output-dir
    (default ./env-snapshot-output, created if missing; a path that is a file is refused).
  - No privilege escalation: it never calls sudo or su and never runs anything as another user.
  - Fixed allow-list of commands, resolved to absolute paths; shell=False; per-command timeout
    (default 10 s, --timeout 1-120); output capped at 256 KB per command (flagged "truncated");
    child processes get a minimal environment with LC_ALL=C. The one use of a shell is the fixed
    command "sh -c 'ulimit -a'" because ulimit is a shell built-in.
  - Credential files are never read: /etc/shadow, /etc/passwd, /etc/gshadow, master.passwd and the
    AIX security password files are refused by name. Files outside the allow-list are not read.
  - Reports are never overwritten: files are created exclusively, and a numeric suffix is added if
    the name is taken.

OUTPUT
  env-snapshot_<host>_<context>_<UTC timestamp>.txt   (--format txt|both)
  env-snapshot_<host>_<context>_<UTC timestamp>.json  (--format json|both, default both)

  The JSON report has "schema_version": "1.0" and is described by report.schema.json. The header
  records schema version, tool version, generated_at (UTC), host id, Python version, platform,
  redaction flag, context, project, environment, the collector list with statuses and durations.

  Collector status: ok | unsupported | unavailable | permission_denied | timeout | error
  Each collector has its own status and a message. "ok" means at least one data source worked; the
  message lists how many sources were not collected. A collector never crashes the run.

OPTIONS
  --output-dir DIR        report directory (default ./env-snapshot-output)
  --format txt|json|both  default both
  --context ICG|ACQ|ISS   CMM context / collection profile (default ICG; the report records
                          "context_explicit": false when the option was not given)
  --project NAME          label, up to 64 characters from A-Z a-z 0-9 . _ space -
  --environment NAME      label, same rules (dev, uat, prod, ...)
  --redact / --no-redact  redaction is ON by default; --no-redact keeps raw values
  --timeout SECONDS       per-command timeout, 1-120 (default 10)
  --list-collectors       print collectors, applicable OS and profiles, then exit 0
  --version
  Exit codes: 0 success (even if some collectors are unsupported/unavailable), 2 usage error.

COLLECTORS (id: sources)
  system        host identity: hostname, uname, uptime, boot time
  os            Linux: /etc/os-release, /etc/redhat-release.
                AIX: oslevel -s, oslevel -r, uname -a, getconf
  kernel        Linux: uname -r, /proc/version, sysctl -a (limited keys only).
                AIX: bootinfo -K, lsattr -El sys0
  hardware      Linux: /proc/cpuinfo, lscpu, /proc/meminfo.  AIX: prtconf, lsattr -El proc0, lsdev -C
  disks         Linux: lsblk -J (or -P), df -P, /proc/mounts, mount.
                AIX: lspv, lsvg, lsvg -l rootvg, df -g, lsfs
  packages      rpm -qa, dpkg-query -W, apk info (Linux); lslpp -L all, instfix -i (AIX)
  runtimes      java, python, python3, node, perl, gcc, go, ruby (found on PATH / fixed dirs);
                AIX also /usr/java*/bin/java
  environment   process environment variables and /etc/environment, /etc/profile (sanitised)
  network       LOCAL ONLY: hostname -f, ip addr / ifconfig -a, ip route / netstat -rn, /etc/hosts,
                /etc/resolv.conf, listening sockets (ss -tuln, netstat -an, or /proc/net fallback)
  users_limits  id, whoami, ulimit -a, /etc/security/limits.conf (Linux) or /etc/security/limits,
                lsuser limits and maxuproc (AIX)
  services      systemctl list-units --type=service, service --status-all (Linux); lssrc -a (AIX)
  resources     uptime, /proc/loadavg, vmstat, free -m (Linux); vmstat, svmon -G, lsps -a, iostat (AIX)
  processes     ps: top processes by CPU and by memory

PROFILES (--context)
  ICG  Infrastructure/configuration inventory. Every collector, full detail.
  ACQ  Acquisition / due diligence. system, os, hardware, disks, packages, runtimes,
       users_limits (metadata only: id, whoami, ulimit; no limits files),
       network (summary only: FQDN, addresses, default route).
       NO environment variable values (the environment collector is not run), NO process list.
  ISS  Information security / support. os, kernel, packages, services, users_limits,
       network (listening ports only), environment (variable NAMES only; every value is
       replaced by [REDACTED] even with --no-redact), resources.

REDACTION (default on)
  - Variables and config lines whose KEY matches (case-insensitive):
      pass(word|wd)?, secret, token, api[_-]?key, private, credential, auth, cookie, session,
      bearer, aws_, azure_, gcp_, ssh_
    have their value replaced by [REDACTED].
  - Values that look like credentials are masked anywhere in any output: private key blocks, JWTs,
    AWS access key ids, GitHub/Slack tokens, the password part of credentialed URLs (scheme,
    user and host are kept), --password=/--token= style command-line arguments, and (for
    environment values) long base64/hex blobs of 32+ characters.
  - Config lines "key = value" read from files are masked when the key looks secret.
  - Redaction is applied to every collector output (commands and files) before it is written.
  Redaction is heuristic. Review a report before sharing it outside your organisation.

SAMPLE OUTPUT (excerpt of the TXT report)
  ENVIRONMENT SNAPSHOT
  Context:             ISS (explicit)
  COLLECTOR STATUS
  os             ok                          3  ...
  OPERATING SYSTEM  [ok]
  os_release:
    ID: rhel
    VERSION_ID: 8.9

TESTS
  python -B -m unittest discover -s tools/env-snapshot/tests
  Standard library only (unittest). Uses a mocked command runner with realistic Linux and AIX
  fixtures (tests/fixtures), validates reports against report.schema.json with a small built-in
  JSON-schema-subset validator, and checks the source parses as Python 3.6.

LIMITATIONS
  - The AIX command paths and parsers were validated against recorded fixture output only; verify
    on a real AIX host before relying on it.
  - rpm/dpkg/lslpp lists are capped at 20000 packages; ps shows the top 15 per ranking.
  - Output of commands that need root (for example svmon -G on AIX, some sysctl keys) is reported
    as permission_denied or partial when run as a normal user.
  - Container images often lack ps, ss, ip, systemctl; those sources are reported "unavailable".

LICENSE AND PROVENANCE
  Proprietary, locally maintained internal tool. See manifest.json for file checksums.
