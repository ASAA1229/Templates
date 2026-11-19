# -*- coding: utf-8 -*-
import json
import unittest

from helpers import es, fixture


class LinuxParserTests(unittest.TestCase):
    def test_os_release(self):
        data = es.parse_key_values(fixture("linux/os-release"))
        self.assertEqual(data["ID"], "rhel")
        self.assertEqual(data["VERSION_ID"], "8.9")
        self.assertEqual(data["PRETTY_NAME"], "Red Hat Enterprise Linux 8.9 (Ootpa)")

    def test_cpuinfo_and_lscpu(self):
        cpu = es.parse_cpuinfo(fixture("linux/cpuinfo"))
        self.assertEqual(cpu["logical_processors"], 4)
        self.assertEqual(cpu["sockets"], 2)
        self.assertIn("Xeon", cpu["model_name"])
        self.assertEqual(es.first_cpu_block(fixture("linux/cpuinfo")).count("processor"), 1)
        lscpu = es.parse_lscpu(fixture("linux/lscpu"))
        self.assertEqual(lscpu["CPU(s)"], "4")
        self.assertEqual(lscpu["Architecture"], "x86_64")

    def test_meminfo(self):
        mem = es.parse_meminfo(fixture("linux/meminfo"))
        self.assertEqual(mem["MemTotal"], 16314520)
        self.assertEqual(mem["SwapFree"], 4194300)
        self.assertNotIn("Dirty", mem)

    def test_lsblk_json_and_pairs(self):
        devices = es.parse_lsblk_json(fixture("linux/lsblk-j.txt"))
        self.assertEqual([d["name"] for d in devices], ["sda", "sda1", "sda2", "rhel-root", "rhel-swap"])
        self.assertEqual(devices[3]["mountpoint"], "/")
        pairs = es.parse_lsblk_pairs(fixture("linux/lsblk-pairs.txt"))
        self.assertEqual(len(pairs), 3)
        self.assertEqual(pairs[1]["fstype"], "xfs")

    def test_df_and_mounts(self):
        rows = es.parse_df_p(fixture("linux/df-P"))
        self.assertEqual(len(rows), 4)
        self.assertEqual(rows[0]["filesystem"], "/dev/mapper/rhel-root")
        self.assertEqual(rows[0]["use_percent"], 26)
        self.assertEqual(rows[3]["mounted_on"], "/boot")
        mounts = es.parse_proc_mounts(fixture("linux/proc-mounts"))
        self.assertEqual(mounts[0]["fstype"], "xfs")

    def test_packages(self):
        rpm = es.parse_tab_packages(fixture("linux/rpm-qa.txt"))
        self.assertEqual(rpm[0], {"name": "bash", "version": "4.4.20-4.el8_6", "arch": "x86_64"})
        dpkg = es.parse_tab_packages(fixture("linux/dpkg-query.txt"))
        self.assertEqual(dpkg[3]["name"], "pass")
        self.assertEqual(dpkg[3]["arch"], "all")
        apk = es.parse_apk(fixture("linux/apk-info.txt"))
        self.assertEqual(apk[0]["name"], "busybox")
        self.assertEqual(apk[0]["version"], "1.36.1-r2")

    def test_ps_top(self):
        rows = es.parse_ps(fixture("linux/ps.txt"))
        self.assertEqual(len(rows), 4)
        top = es.top_processes(rows, 2)
        self.assertEqual(top["by_cpu"][0]["pid"], 842)
        self.assertEqual(top["by_memory"][0]["pid"], 901)
        self.assertEqual(top["total"], 4)

    def test_ss(self):
        rows = es.parse_ss(fixture("linux/ss-tuln.txt"))
        self.assertEqual([r["port"] for r in rows], [22, 22, 5432, 68])
        self.assertEqual(rows[3]["protocol"], "udp")

    def test_proc_net_fallback(self):
        text = (
            "  sl  local_address rem_address   st tx_queue\n"
            "   0: 00000000:0016 00000000:0000 0A 00000000:00000000\n"
            "   1: 0100007F:1F90 0100007F:C000 01 00000000:00000000\n"
        )
        self.assertEqual([r["port"] for r in es.parse_proc_net(text, "tcp")], [22])

    def test_systemctl_and_service(self):
        rows = es.parse_systemctl(fixture("linux/systemctl-units.txt"))
        self.assertEqual(
            [r["unit"] for r in rows], ["crond.service", "sshd.service", "kdump.service", "postgresql.service"]
        )
        self.assertEqual(rows[2]["active"], "failed")
        svc = es.parse_service_status_all(fixture("linux/service-status-all.txt"))
        self.assertEqual([s["state"] for s in svc], ["running", "stopped", "unknown"])

    def test_sysctl_limited_keys(self):
        data = es.parse_sysctl(fixture("linux/sysctl-a.txt"))
        self.assertEqual(data["kernel.pid_max"], "4194304")
        self.assertEqual(data["vm.swappiness"], "10")
        self.assertNotIn("kernel.hostname", data)
        self.assertNotIn("kernel.random.boot_id", data)

    def test_ulimit_id_and_load(self):
        limits = es.parse_ulimit(fixture("linux/ulimit-a.txt"))
        self.assertEqual(limits["open files"], "65536")
        self.assertEqual(limits["core file size"], "0")
        dash = es.parse_ulimit("time(seconds)        unlimited\nstack(kbytes)        8192\n")
        self.assertEqual(dash["stack(kbytes)"], "8192")
        ident = es.parse_id(fixture("linux/id.txt"))
        self.assertEqual((ident["uid"], ident["uid_name"], ident["groups"]), (1001, "svcapp", ["svcapp", "wheel"]))
        self.assertEqual(es.parse_loadavg(fixture("linux/proc-loadavg"))["load15"], 0.59)
        self.assertEqual(es.parse_uptime(fixture("linux/uptime.txt"))["load1"], 0.52)

    def test_free_vmstat(self):
        free = es.parse_free_m(fixture("linux/free-m.txt"))
        self.assertEqual(free["mem_mb"]["total"], 15932)
        self.assertEqual(free["mem_mb"]["available"], 12814)
        self.assertEqual(free["swap_mb"]["total"], 4095)
        vm = es.parse_vmstat(fixture("linux/vmstat.txt"))
        self.assertEqual((vm["r"], vm["id"], vm["free"]), (1, 96, 9021244))

    def test_network(self):
        addrs = es.parse_ifaddrs(fixture("linux/ip-addr.txt"))
        self.assertIn({"interface": "ens192", "family": "inet", "address": "10.20.30.40/24"}, addrs)
        self.assertEqual(es.parse_default_route(fixture("linux/ip-route.txt")), "10.20.30.1")
        self.assertEqual(es.parse_resolv(fixture("linux/resolv.conf"))["nameservers"], ["10.20.30.2", "10.20.30.3"])

    def test_boot_time(self):
        self.assertEqual(es.parse_proc_stat_btime(fixture("linux/proc-stat")), "2026-01-01T00:00:00Z")

    def test_version_line_skips_blank(self):
        self.assertTrue(es.parse_version_line(fixture("linux/perl-v.txt")).startswith("This is perl 5"))


class AixParserTests(unittest.TestCase):
    def test_oslevel(self):
        self.assertEqual(
            es.parse_oslevel_s(fixture("aix/oslevel-s.txt")),
            {"technology_level": "7200-05", "service_pack": "04", "build_date": "2220"},
        )
        self.assertEqual(es.parse_oslevel_s("garbage"), {})

    def test_prtconf(self):
        conf = es.parse_prtconf(fixture("aix/prtconf.txt"))
        self.assertEqual(conf["Processor Type"], "PowerPC_POWER9")
        self.assertEqual(conf["Number Of Processors"], "4")
        self.assertEqual(conf["Memory Size"], "32768 MB")
        self.assertNotIn("Host Name", conf)

    def test_lsattr(self):
        sys0 = es.parse_lsattr_el(fixture("aix/lsattr-sys0.txt"))
        self.assertEqual(sys0["maxuproc"]["value"], "4096")
        self.assertIn("PROCESSES", sys0["maxuproc"]["description"])
        self.assertEqual(es.parse_lsattr_el(fixture("aix/lsattr-proc0.txt"))["smt_threads"]["value"], "4")

    def test_lsdev(self):
        devices = es.parse_lsdev(fixture("aix/lsdev-C.txt"))
        self.assertEqual(len(devices), 5)
        self.assertEqual(devices[0]["location"], "00-08-00")
        self.assertEqual(devices[4]["location"], "")
        self.assertEqual(devices[4]["description"], "System Object")

    def test_lslpp(self):
        rows = es.parse_lslpp(fixture("aix/lslpp-L.txt"))
        self.assertEqual([r["name"] for r in rows][:2], ["Java8_64.jre", "bos.64bit"])
        self.assertEqual(rows[3]["version"], "8.1.102.2101")
        self.assertEqual(len(rows), 5)

    def test_lsps_svmon_vmstat(self):
        ps = es.parse_lsps(fixture("aix/lsps-a.txt"))
        self.assertEqual((ps[0]["page_space"], ps[0]["size"], ps[0]["used_percent"]), ("hd6", "4096MB", 3))
        sv = es.parse_svmon_g(fixture("aix/svmon-G.txt"))
        self.assertEqual(sv["memory_frames"]["size"], 8388608)
        self.assertEqual(sv["memory_frames"]["available"], 2188485)
        self.assertEqual(sv["pg_space_frames"], {"size": 1048576, "inuse": 32012})
        vm = es.parse_vmstat(fixture("aix/vmstat.txt"))
        self.assertEqual((vm["avm"], vm["fre"], vm["id"]), (5994160, 2188485, 96))

    def test_storage(self):
        lvs = es.parse_lsvg_l(fixture("aix/lsvg-l-rootvg.txt"))
        self.assertEqual([lv["lv"] for lv in lvs], ["hd5", "hd6", "hd4", "hd2"])
        self.assertEqual(lvs[3]["mount_point"], "/usr")
        pvs = es.parse_lspv(fixture("aix/lspv.txt"))
        self.assertEqual((pvs[0]["name"], pvs[0]["volume_group"], pvs[0]["state"]), ("hdisk0", "rootvg", "active"))
        df = es.parse_df_g(fixture("aix/df-g.txt"))
        self.assertEqual((df[1]["filesystem"], df[1]["use_percent"], df[1]["free_gb"]), ("/dev/hd2", 75, 1.25))
        fs = es.parse_lsfs(fixture("aix/lsfs.txt"))
        self.assertEqual((fs[0]["mount_point"], fs[0]["vfs"]), ("/", "jfs2"))

    def test_lssrc(self):
        rows = es.parse_lssrc(fixture("aix/lssrc-a.txt"))
        self.assertEqual([r["subsystem"] for r in rows], ["syslogd", "sendmail", "biod", "sshd"])
        self.assertEqual(rows[0]["pid"], 4260310)
        self.assertIsNone(rows[2]["pid"])
        self.assertEqual(rows[2]["status"], "inoperative")

    def test_network(self):
        addrs = es.parse_ifaddrs(fixture("aix/ifconfig-a.txt"))
        self.assertEqual(addrs[0], {"interface": "en0", "family": "inet", "address": "10.1.2.3"})
        self.assertEqual(es.parse_default_route(fixture("aix/netstat-rn.txt")), "10.1.2.1")
        listening = es.parse_netstat_listen(fixture("aix/netstat-an.txt"))
        self.assertEqual([r["port"] for r in listening], [22, 111, 123])


class LsblkEdgeTests(unittest.TestCase):
    def test_newer_lsblk_mountpoints_list(self):
        text = json.dumps(
            {"blockdevices": [{"name": "vda", "type": "disk", "size": "10G", "mountpoint": None, "mountpoints": ["/", "/x"]}]}
        )
        self.assertEqual(es.parse_lsblk_json(text)[0]["mountpoint"], "/, /x")


if __name__ == "__main__":
    unittest.main()
