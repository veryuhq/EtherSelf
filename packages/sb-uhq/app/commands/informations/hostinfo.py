"""info.hostinfo — infos système de l'hôte (CPU / RAM / OS)."""

from __future__ import annotations

import platform
import shutil
import socket
import subprocess
import sys
import time

try:
    import psutil
except ImportError:  # dépendance recommandée mais optionnelle
    psutil = None

from ...func.proc import format_uptime


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
    units = ["B", "KB", "MB", "GB", "TB"]
    i = 0
    val = float(b)
    while val >= 1024 and i < len(units) - 1:
        val /= 1024
        i += 1
    return f"{val:.2f} {units[i]}"


async def execute(client, payload=None):
    if psutil is not None:
        vm = psutil.virtual_memory()
        total_mem, free_mem, used_mem = vm.total, vm.available, vm.total - vm.available
        cpu_count = psutil.cpu_count(logical=True) or 1
        sys_uptime = time.time() - psutil.boot_time()
    else:
        total_mem = free_mem = used_mem = 0
        cpu_count = 1
        sys_uptime = 0.0

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

    percent = f"{(used_mem / total_mem * 100):.1f}" if total_mem else "0.0"

    return {
        "hostname": socket.gethostname(),
        "platform": sys.platform,
        "arch": platform.machine(),
        "distro": distro,
        "kernel": kernel,
        "nodeVer": f"python {platform.python_version()}",
        "cpu": {"model": cpu_model.strip() if cpu_model else "Inconnu", "count": cpu_count},
        "memory": {
            "total": _format_bytes(total_mem),
            "used": _format_bytes(used_mem),
            "free": _format_bytes(free_mem),
            "percent": percent,
        },
        "uptime": format_uptime(sys_uptime),
    }
