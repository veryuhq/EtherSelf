"""info.ping — latence WebSocket."""

from __future__ import annotations


async def execute(client, payload=None):
    latency = getattr(client, "latency", None)
    ping_ms = None
    if latency is not None and latency == latency:  # exclut NaN
        ping_ms = round(latency * 1000)
    return {"ping": ping_ms}
