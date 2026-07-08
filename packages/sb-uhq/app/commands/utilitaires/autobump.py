"""autobump — envoi automatique d'une slash command (/bump Disboard par défaut) toutes les 2h."""

from __future__ import annotations

import asyncio

import discord

from ...func.data_path import data_path, read_json, write_json
from ...func.discord_util import fetch_channel
from ...func.logbus import log, logerr

AUTOBUMP_FILE = data_path("config", "autobump.json")

DEFAULT_BUMP_APP_ID = "302050872383242240"
DEFAULT_BUMP_COMMAND = "bump"
INTERVAL_SECONDS = 2 * 60 * 60

_task: asyncio.Task | None = None


def _load() -> dict:
    return read_json(AUTOBUMP_FILE, {})


def _save(data) -> None:
    write_json(AUTOBUMP_FILE, data)


def _normalize_guild_config(guild_config) -> dict:
    if isinstance(guild_config, list):
        return {"channels": guild_config, "appId": DEFAULT_BUMP_APP_ID,
                "commandName": DEFAULT_BUMP_COMMAND}
    guild_config = guild_config or {}
    channels = guild_config.get("channels")
    return {
        "channels": channels if isinstance(channels, list) else [],
        "appId": str(guild_config.get("appId") or DEFAULT_BUMP_APP_ID).strip(),
        "commandName": str(guild_config.get("commandName") or DEFAULT_BUMP_COMMAND).strip(),
    }


def _normalize_config(config) -> dict:
    return {gid: _normalize_guild_config(gc) for gid, gc in (config or {}).items()}


def load_config() -> dict:
    raw = _load()
    if "config" in raw:
        migrated = {**raw, "config": _normalize_config(raw.get("config"))}
    else:
        migrated = {"running": False, "config": _normalize_config(raw)}
    _save(migrated)
    return migrated


def save_config(data) -> None:
    _save(data)


async def _send_slash(channel, app_id: str, command_name: str) -> None:
    """Invoque une slash command dans le salon (discord.py-self)."""
    app = discord.Object(id=int(app_id))
    async for cmd in channel.slash_commands(query=command_name, application=app):
        if cmd.name == command_name:
            await cmd()
            return
    # Repli sans filtre d'application
    async for cmd in channel.slash_commands(query=command_name):
        if cmd.name == command_name:
            await cmd()
            return
    raise RuntimeError(f"Commande /{command_name} introuvable pour l'app {app_id}.")


async def _run_bumps(client) -> None:
    data = load_config()
    for guild_id, guild_config in (data.get("config") or {}).items():
        normalized = _normalize_guild_config(guild_config)
        for channel_id in normalized["channels"]:
            try:
                channel = await fetch_channel(client, channel_id)
                if not channel:
                    log(f"[AUTOBUMP] Salon {channel_id} introuvable, skip.")
                    continue
                await _send_slash(channel, normalized["appId"], normalized["commandName"])
                log(f"[AUTOBUMP] /{normalized['commandName']} envoyé dans "
                    f"{getattr(channel, 'name', channel_id)} ({channel_id}) via {normalized['appId']}")
            except Exception as err:  # noqa: BLE001
                logerr(f"[AUTOBUMP] Erreur bump {channel_id} : {err}")


async def _loop(client) -> None:
    while True:
        await asyncio.sleep(INTERVAL_SECONDS)
        await _run_bumps(client)


def start_autobump(client) -> bool:
    global _task
    if _task and not _task.done():
        return False
    _task = asyncio.get_event_loop().create_task(_loop(client))
    return True


def stop_autobump() -> bool:
    global _task
    if not _task:
        return False
    _task.cancel()
    _task = None
    return True


def on_ready(client) -> None:
    raw = _load()
    if raw.get("running") is True:
        start_autobump(client)
        log("[AUTOBUMP] 🔄 Boucle relancée automatiquement au démarrage.")


async def execute(client, payload):
    action = payload.get("action")
    guild_id = payload.get("guildId")
    channel_id = payload.get("channelId")
    app_id = payload.get("appId")
    command_name = payload.get("commandName")
    data = load_config()

    if action == "list":
        return {"config": data["config"], "running": _task is not None and not _task.done()}

    if action == "add":
        if not guild_id or not channel_id:
            raise ValueError("guildId et channelId requis.")
        cleaned_app = str(app_id or DEFAULT_BUMP_APP_ID).strip()
        cleaned_cmd = str(command_name or DEFAULT_BUMP_COMMAND).strip().lstrip("/")
        if not cleaned_app or not cleaned_cmd:
            raise ValueError("APP ID et nom de commande requis.")
        data["config"].setdefault(guild_id, _normalize_guild_config([]))
        data["config"][guild_id]["appId"] = cleaned_app
        data["config"][guild_id]["commandName"] = cleaned_cmd
        if channel_id not in data["config"][guild_id]["channels"]:
            data["config"][guild_id]["channels"].append(channel_id)
        save_config(data)
        return {"config": data["config"]}

    if action == "remove":
        if not guild_id or not channel_id:
            raise ValueError("guildId et channelId requis.")
        guild_config = data["config"].get(guild_id)
        if not guild_config:
            raise ValueError("Aucun salon configuré pour ce serveur.")
        if channel_id not in guild_config["channels"]:
            raise ValueError("Ce salon n'est pas enregistré.")
        guild_config["channels"].remove(channel_id)
        save_config(data)
        return {"config": data["config"]}

    if action == "start":
        empty = not any(gc["channels"] for gc in data["config"].values())
        if empty:
            raise ValueError("Aucun salon configuré pour l'autobump.")
        started = start_autobump(client)
        data["running"] = True
        save_config(data)
        return {"running": True, "alreadyRunning": not started}

    if action == "stop":
        stopped = stop_autobump()
        data["running"] = False
        save_config(data)
        return {"running": False, "wasStopped": stopped}

    raise ValueError(f"Action autobump inconnue : '{action}'")
