"""joinvc — rejoindre / quitter / déplacer un salon vocal + auto-rejoin au démarrage."""

from __future__ import annotations

import discord

from ...func.data_path import data_path, read_json, write_json
from ...func.discord_util import fetch_channel
from ...func.logbus import log, logerr

JOINVC_FILE = data_path("config", "joinvc.json")

_VOICE_TYPES = (discord.VoiceChannel, discord.StageChannel)


def _load_saved():
    return read_json(JOINVC_FILE, None)


def _save_current(data) -> None:
    write_json(JOINVC_FILE, data)


def _clear_saved() -> None:
    try:
        JOINVC_FILE.unlink()
    except OSError:
        pass


def _is_voice(channel) -> bool:
    return isinstance(channel, _VOICE_TYPES)


def _current_voice(client):
    for vc in client.voice_clients:
        if getattr(vc, "channel", None):
            return vc
    return None


async def _connect(channel) -> None:
    existing = channel.guild.voice_client if channel.guild else None
    if existing:
        await existing.move_to(channel)
    else:
        await channel.connect(self_deaf=True, self_mute=False)


async def auto_rejoin(client) -> None:
    saved = _load_saved()
    if not saved or not saved.get("channelId"):
        return
    channel = await fetch_channel(client, saved["channelId"])
    if not channel:
        log(f"[JOINVC] Auto-rejoin : salon {saved['channelId']} introuvable, config effacée.")
        _clear_saved()
        return
    if not _is_voice(channel):
        _clear_saved()
        return
    try:
        await _connect(channel)
        log(f"[JOINVC] Auto-rejoin : connecté dans {channel.name} ({channel.id})")
    except Exception as err:  # noqa: BLE001
        logerr(f"[JOINVC] Auto-rejoin échoué : {err}")


async def execute(client, payload):
    channel_id = payload.get("channelId")
    action = payload.get("action")

    if action == "getState":
        vc = _current_voice(client)
        if not vc:
            return {"joined": False, "channelId": None, "channelName": None,
                    "guildId": None, "guildName": None}
        ch = vc.channel
        guild = getattr(ch, "guild", None)
        return {
            "joined": True,
            "channelId": str(ch.id),
            "channelName": getattr(ch, "name", None),
            "guildId": str(guild.id) if guild else None,
            "guildName": getattr(guild, "name", None) if guild else None,
        }

    if action == "getConfig":
        saved = _load_saved()
        if not saved or not saved.get("channelId"):
            return {"configured": False, "channelId": None}
        return {"configured": True, "channelId": saved["channelId"]}

    if action == "leave":
        if not channel_id:
            raise ValueError("channelId requis pour quitter le vocal.")
        vc = _current_voice(client)
        if not vc:
            raise ValueError("Le selfbot n'est dans aucun salon vocal.")
        if str(vc.channel.id) != str(channel_id):
            raise ValueError("Le selfbot n'est pas dans ce salon vocal.")
        try:
            await vc.disconnect(force=True)
        except Exception:
            pass
        return {"joined": False, "channelId": None, "channelName": None,
                "guildId": None, "guildName": None}

    if action in ("move", None) or channel_id:
        if not channel_id:
            raise ValueError("channelId ou action requis.")
        channel = await fetch_channel(client, channel_id)
        if not channel:
            raise ValueError(f"Salon vocal {channel_id} introuvable.")
        if not _is_voice(channel):
            raise ValueError("Ce salon n'est pas un salon vocal.")
        await _connect(channel)
        guild = getattr(channel, "guild", None)
        result = {
            "joined": True,
            "channelId": str(channel.id),
            "channelName": channel.name,
            "guildId": str(guild.id) if guild else None,
            "guildName": getattr(guild, "name", None) if guild else None,
        }
        _save_current({"channelId": str(channel.id)})
        return result

    raise ValueError("channelId ou action requis.")
