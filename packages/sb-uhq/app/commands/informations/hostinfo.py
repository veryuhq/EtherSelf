"""info.hostinfo — infos système détaillées de l'hôte (CPU / RAM / disque / réseau)."""

from __future__ import annotations

import os
import platform
import socket
import subprocess
import sys
import time

try:
    import psutil
except ImportError:  # dépendance recommandée mais optionnelle
    psutil = None

from ...func.proc import format_uptime, process_uptime


def _exec_cmd(cmd: str):
    try:
        out = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=3)
        result = out.stdout.strip()
        return result or None
    except Exception:
        return None


def _format_bytes(b: int) -> str:
    if not b:
        return "0 B"
    units = ["B", "KB", "MB", "GB", "TB", "PB"]
    i = 0
    val = float(b)
    while val >= 1024 and i < len(units) - 1:
        val /= 1024
        i += 1
    return f"{val:.2f} {units[i]}"


def _local_ip() -> str:
    """Adresse IP locale (best-effort, sans réellement émettre de paquet)."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
        finally:
            s.close()
    except Exception:
        try:
            return socket.gethostbyname(socket.gethostname())
        except Exception:
            return "?"


def _percent(used: int, total: int) -> float:
    return round(used / total * 100, 1) if total else 0.0


async def execute(client, payload=None):
    # ── Mémoire vive & swap ──────────────────────────────────────────────────
    if psutil is not None:
        vm = psutil.virtual_memory()
        total_mem, free_mem, used_mem = vm.total, vm.available, vm.total - vm.available
        mem_percent = round(vm.percent, 1)

        sw = psutil.swap_memory()
        total_swap, used_swap, swap_percent = sw.total, sw.used, round(sw.percent, 1)

        cpu_count_logical = psutil.cpu_count(logical=True) or 1
        cpu_count_physical = psutil.cpu_count(logical=False) or cpu_count_logical
        # Charge CPU instantanée (petit échantillon pour une valeur non nulle)
        cpu_percent = round(psutil.cpu_percent(interval=0.2), 1)

        freq = psutil.cpu_freq()
        cpu_freq = round(freq.current) if freq and freq.current else 0

        sys_uptime = time.time() - psutil.boot_time()
        boot_ts = int(psutil.boot_time())

        # Disque (partition racine)
        try:
            du = psutil.disk_usage("/")
            disk_total, disk_used, disk_free = du.total, du.used, du.free
            disk_percent = round(du.percent, 1)
        except Exception:
            disk_total = disk_used = disk_free = 0
            disk_percent = 0.0

        # Réseau (compteurs cumulés depuis le boot)
        try:
            net = psutil.net_io_counters()
            net_sent, net_recv = net.bytes_sent, net.bytes_recv
        except Exception:
            net_sent = net_recv = 0

        # Process du selfbot lui-même
        try:
            proc = psutil.Process(os.getpid())
            with proc.oneshot():
                proc_rss = proc.memory_info().rss
                proc_threads = proc.num_threads()
                proc_cpu = round(proc.cpu_percent(interval=None) / (cpu_count_logical or 1), 1)
        except Exception:
            proc_rss = 0
            proc_threads = 0
            proc_cpu = 0.0

        proc_count = len(psutil.pids())
    else:
        total_mem = free_mem = used_mem = 0
        mem_percent = 0.0
        total_swap = used_swap = 0
        swap_percent = 0.0
        cpu_count_logical = cpu_count_physical = 1
        cpu_percent = 0.0
        cpu_freq = 0
        sys_uptime = 0.0
        boot_ts = 0
        disk_total = disk_used = disk_free = 0
        disk_percent = 0.0
        net_sent = net_recv = 0
        proc_rss = 0
        proc_threads = 0
        proc_cpu = 0.0
        proc_count = 0

    # ── Charge moyenne (Unix) ────────────────────────────────────────────────
    try:
        load1, load5, load15 = os.getloadavg()
        loadavg = [round(load1, 2), round(load5, 2), round(load15, 2)]
    except (OSError, AttributeError):
        loadavg = None

    # ── Identité machine & OS ────────────────────────────────────────────────
    cpu_model = (
        _exec_cmd("lscpu | grep 'Model name' | cut -d: -f2")
        or platform.processor()
        or "Inconnu"
    )
    distro = (
        _exec_cmd("lsb_release -ds 2>/dev/null || "
                  "grep PRETTY_NAME /etc/os-release 2>/dev/null | cut -d= -f2 | tr -d '\"'")
        or platform.system()
    )
    kernel = _exec_cmd("uname -r") or platform.release()

    return {
        "hostname": socket.gethostname(),
        "localIp": _local_ip(),
        "platform": sys.platform,
        "arch": platform.machine(),
        "distro": distro,
        "kernel": kernel,
        "nodeVer": f"python {platform.python_version()}",
        "cpu": {
            "model": cpu_model.strip() if cpu_model else "Inconnu",
            "count": cpu_count_logical,
            "physical": cpu_count_physical,
            "freqMhz": cpu_freq,
            "usagePercent": cpu_percent,
            "loadavg": loadavg,
        },
        "memory": {
            "total": _format_bytes(total_mem),
            "used": _format_bytes(used_mem),
            "free": _format_bytes(free_mem),
            "percent": mem_percent,
        },
        "swap": {
            "total": _format_bytes(total_swap),
            "used": _format_bytes(used_swap),
            "percent": swap_percent,
        },
        "disk": {
            "total": _format_bytes(disk_total),
            "used": _format_bytes(disk_used),
            "free": _format_bytes(disk_free),
            "percent": disk_percent,
        },
        "network": {
            "sent": _format_bytes(net_sent),
            "recv": _format_bytes(net_recv),
        },
        "process": {
            "pid": os.getpid(),
            "memory": _format_bytes(proc_rss),
            "threads": proc_threads,
            "cpuPercent": proc_cpu,
            "count": proc_count,
            "uptime": format_uptime(process_uptime()),
        },
        "uptime": format_uptime(sys_uptime),
        "bootTime": boot_ts,
    }
