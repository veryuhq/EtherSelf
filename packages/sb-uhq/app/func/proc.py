"""Horodatage de démarrage du process (équivalent process.uptime() de Node)."""

from __future__ import annotations

import time

PROCESS_START = time.time()


def process_uptime() -> float:
    return time.time() - PROCESS_START


def format_uptime(seconds: float) -> str:
    s = int(seconds)
    d = s // 86400
    h = (s % 86400) // 3600
    m = (s % 3600) // 60
    sec = s % 60
    parts = []
    if d:
        parts.append(f"{d}j")
    if h:
        parts.append(f"{h}h")
    if m:
        parts.append(f"{m}m")
    parts.append(f"{sec}s")
    return " ".join(parts)
