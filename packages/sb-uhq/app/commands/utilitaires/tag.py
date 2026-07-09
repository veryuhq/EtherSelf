"""tag — messages prédéfinis (bridge + commande préfixe)."""

from __future__ import annotations

from ...func.data_path import data_path, read_json, write_json
from ...func.discord_util import fetch_channel
from ...func.message_edit import message_edit

TAGS_FILE = data_path("config", "tags.json")


def _load() -> dict:
    return read_json(TAGS_FILE, {})


def _save(tags) -> None:
    write_json(TAGS_FILE, tags)


async def execute(client, payload):
    action = payload.get("action")
    name = payload.get("name")
    content = payload.get("content")
    channel_id = payload.get("channelId")
    tags = _load()

    if action == "list":
        return {"tags": tags}

    if action == "add":
        if not name or not content:
            raise ValueError("name et content requis.")
        if name in tags:
            raise ValueError(f"Le tag '{name}' existe déjà.")
        tags[name] = content
        _save(tags)
        return {"tags": tags}

    if action == "edit":
        if not name or not content:
            raise ValueError("name et content requis.")
        if name not in tags:
            raise ValueError(f"Tag '{name}' introuvable.")
        tags[name] = content
        _save(tags)
        return {"tags": tags}

    if action == "remove":
        if not name:
            raise ValueError("name requis.")
        if name not in tags:
            raise ValueError(f"Tag '{name}' introuvable.")
        del tags[name]
        _save(tags)
        return {"tags": tags}

    if action == "send":
        if not name:
            raise ValueError("name requis.")
        if name not in tags:
            raise ValueError(f"Tag '{name}' introuvable.")
        if not channel_id:
            raise ValueError("channelId requis pour envoyer un tag.")
        channel = await fetch_channel(client, channel_id)
        if not channel:
            raise ValueError(f"Salon {channel_id} introuvable.")
        await channel.send(tags[name])
        return {"sent": True, "name": name, "channelId": channel_id}

    raise ValueError(f"Action tag inconnue : '{action}'")


async def callback(client, message, args):
    if not args:
        return await message_edit(message, "`❌` **Usage :** `.tag <nom>`")
    name = args[0]
    tags = _load()
    if name not in tags:
        return await message_edit(message, f"`❌` **Tag `{name}` introuvable.**")
    return await message_edit(message, tags[name])
