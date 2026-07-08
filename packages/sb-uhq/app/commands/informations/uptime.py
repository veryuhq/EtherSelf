"""info.uptime — uptime du process selfbot."""

from __future__ import annotations

from ...func.proc import format_uptime, process_uptime


async def execute(client, payload=None):
    seconds = process_uptime()
    return {"uptime": seconds, "formatted": format_uptime(seconds)}
