"""antigroup — quitte automatiquement les groupes DM entrants (+ leaveAll)."""

from __future__ import annotations

import asyncio

import discord

from ...func.data_path import data_path, read_json, write_json
from ...func.logbus import log, logerr

ANTIGROUP_FILE = data_path("config", "antigroup.json")


def get_state() -> bool:
    if not ANTIGROUP_FILE.exists():
        return False
    data = read_json(ANTIGROUP_FILE, {})
    return data.get("enabled") is True


def set_state(enabled: bool) -> None:
    write_json(ANTIGROUP_FILE, {"enabled": enabled})


def _is_group(channel) -> bool:
    return isinstance(channel, discord.GroupChannel) or getattr(channel, "type", None) == discord.ChannelType.group


async def handle_channel_create(client, channel) -> None:
    if not _is_group(channel):
        return
    if getattr(channel, "owner_id", None) == client.user.id:
        return
    if not get_state():
        return
    log(f"[ANTIGROUP] Groupe DM détecté ({channel.id}), je quitte.")
    try:
        await channel.leave()
    except Exception:
        pass


async def execute(client, payload):
    action = payload.get("action")

    if action == "getState":
        return {"enabled": get_state()}

    if action == "toggle":
        new_state = not get_state()
        set_state(new_state)
        return {"enabled": new_state}

    if action == "leaveAll":
        groups = [c for c in client.private_channels if _is_group(c)]
        left = 0
        failed = 0
        details = []
        for group in groups:
            name = getattr(group, "name", None) or f"Groupe ({group.id})"
            try:
                await group.leave()
                left += 1
                log(f'[ANTIGROUP] Quitté le groupe "{name}" ({group.id})')
                details.append({"id": str(group.id), "name": name, "success": True})
            except Exception as err:  # noqa: BLE001
                failed += 1
                logerr(f"[ANTIGROUP] Impossible de quitter le groupe {group.id} : {err}")
                details.append({"id": str(group.id), "name": name, "success": False,
                                "error": str(err)})
            await asyncio.sleep(0.3)
        return {"left": left, "failed": failed, "total": len(groups), "details": details}

    raise ValueError(f"Action antigroup inconnue : '{action}'")
