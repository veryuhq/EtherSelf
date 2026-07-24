"""snipe — recherche dans les messages loggés (par salon / serveur / utilisateur)."""

from __future__ import annotations

import asyncio

from ...func.data_path import (data_path, is_snowflake, read_json, safe_id_segment,
                               write_json)
from ...func.discord_util import resolve_channel_name, resolve_guild_name, resolve_user_tag

WHITELIST_FILE = data_path("msg_log_data", "snipe_whitelist.json")
DATA_PATH = data_path("msg_log_data")

# Seuls types de log écrits par msglog : tout le reste deviendrait un nom de
# fichier arbitraire (`{msg_type}_messages.json`) et pourrait sortir de data/.
MSG_TYPES = ("deleted", "edited")


def _safe_msg_type(msg_type) -> str:
    if msg_type not in MSG_TYPES:
        raise ValueError("Type de messages invalide (attendu : deleted ou edited).")
    return msg_type


def get_whitelist() -> list[str]:
    # On ignore les entrées non numériques : un ID corrompu ou hérité ne doit pas
    # pouvoir servir de segment de chemin lors des recherches.
    return [g for g in read_json(WHITELIST_FILE, []) if is_snowflake(g)]


def save_whitelist(items) -> None:
    write_json(WHITELIST_FILE, items)


def _read(path) -> list:
    return read_json(path, [])


def _sort_key(m):
    return m.get("deletedAt") or m.get("editedAt") or 0


def _read_by_channel(channel_id, msg_type) -> list:
    channel_id = safe_id_segment(channel_id, "channelId")
    msg_type = _safe_msg_type(msg_type)
    results = []
    for guild_id in get_whitelist():
        msgs = _read(DATA_PATH / "SERVEURS" / guild_id / f"{msg_type}_messages.json")
        results.extend(m for m in msgs if m.get("channelId") == channel_id)
    results.extend(_read(DATA_PATH / "DMs" / channel_id / f"{msg_type}_messages.json"))
    results.extend(_read(DATA_PATH / "GROUP_DMs" / channel_id / f"{msg_type}_messages.json"))
    return sorted(results, key=_sort_key, reverse=True)


def _read_by_guild(guild_id, msg_type) -> list:
    guild_id = safe_id_segment(guild_id, "guildId")
    msg_type = _safe_msg_type(msg_type)
    msgs = _read(DATA_PATH / "SERVEURS" / guild_id / f"{msg_type}_messages.json")
    return sorted(msgs, key=_sort_key, reverse=True)


def _read_by_user(user_id, msg_type) -> list:
    user_id = safe_id_segment(user_id, "userId")
    msg_type = _safe_msg_type(msg_type)
    results = []
    for guild_id in get_whitelist():
        msgs = _read(DATA_PATH / "SERVEURS" / guild_id / f"{msg_type}_messages.json")
        results.extend(m for m in msgs if m.get("authorId") == user_id)
    for base in ("DMs", "GROUP_DMs"):
        root = DATA_PATH / base
        if root.exists():
            for channel_dir in root.iterdir():
                msgs = _read(channel_dir / f"{msg_type}_messages.json")
                results.extend(m for m in msgs if m.get("authorId") == user_id)
    return sorted(results, key=_sort_key, reverse=True)


async def _enrich(client, messages) -> list:
    unique_ids = list({m.get("channelId") for m in messages if m.get("channelId")})
    names = await asyncio.gather(*(resolve_channel_name(client, cid) for cid in unique_ids))
    name_map = dict(zip(unique_ids, names))
    enriched = []
    for m in messages:
        enriched.append({
            **m,
            "channelName": m.get("channelName") or name_map.get(m.get("channelId")),
            "authorTag": m.get("authorTag") or "Inconnu",
            "content": m.get("content") or "",
            "oldContent": m.get("oldContent") or "",
            "newContent": m.get("newContent") or "",
        })
    return enriched


async def execute(client, payload):
    action = payload.get("action")
    guild_id = payload.get("guildId")
    channel_id = payload.get("channelId")
    user_id = payload.get("userId")
    msg_type = payload.get("type", "deleted")

    if action == "getWhitelist":
        whitelist = get_whitelist()
        guilds = []
        for gid in whitelist:
            guilds.append({"id": gid, "name": await resolve_guild_name(client, gid)})
        return {"whitelist": whitelist, "guilds": guilds}

    if action == "addGuild":
        if not guild_id:
            raise ValueError("guildId requis.")
        guild_id = safe_id_segment(guild_id, "guildId")
        items = get_whitelist()
        if guild_id not in items:
            items.append(guild_id)
            save_whitelist(items)
        return {"whitelist": items}

    if action == "removeGuild":
        if not guild_id:
            raise ValueError("guildId requis.")
        items = [g for g in get_whitelist() if g != guild_id]
        save_whitelist(items)
        return {"whitelist": items}

    if action == "getMessages":
        if not channel_id:
            raise ValueError("channelId requis.")
        raw = _read_by_channel(channel_id, msg_type)
        channel_name = await resolve_channel_name(client, channel_id)
        messages = [{
            **m,
            "authorTag": m.get("authorTag") or "Inconnu",
            "content": m.get("content") or "",
            "oldContent": m.get("oldContent") or "",
            "newContent": m.get("newContent") or "",
            "channelName": channel_name,
        } for m in raw]
        return {"messages": messages, "channelId": channel_id,
                "channelName": channel_name, "type": msg_type, "searchMode": "channel"}

    if action == "getMessagesByGuild":
        if not guild_id:
            raise ValueError("guildId requis.")
        if guild_id not in get_whitelist():
            raise ValueError("Ce serveur n'est pas dans la whitelist.")
        raw = _read_by_guild(guild_id, msg_type)
        guild_name = await resolve_guild_name(client, guild_id)
        messages = await _enrich(client, raw)
        return {"messages": messages, "guildId": guild_id,
                "guildName": guild_name, "type": msg_type, "searchMode": "guild"}

    if action == "getMessagesByUser":
        if not user_id:
            raise ValueError("userId requis.")
        raw = _read_by_user(user_id, msg_type)
        tag = await resolve_user_tag(client, user_id)
        messages = await _enrich(client, raw)
        return {"messages": messages, "userId": user_id,
                "userTag": tag, "type": msg_type, "searchMode": "user"}

    raise ValueError(f"Action snipe inconnue : '{action}'")
