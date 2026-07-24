"""msglog — logging des messages supprimés / édités (event handlers + whitelist).

Structure fichiers (identique au JS) :
  data/msg_log_data/SERVEURS/<guildId>/<type>_messages.json
  data/msg_log_data/DMs/<channelId>/<type>_messages.json
  data/msg_log_data/GROUP_DMs/<channelId>/<type>_messages.json
  data/msg_log_data/snipe_whitelist.json
"""

from __future__ import annotations

import discord

from ...func.data_path import data_path, is_snowflake, read_json, safe_id_segment, write_json

DATA_PATH = data_path("msg_log_data")
WHITELIST_FILE = DATA_PATH / "snipe_whitelist.json"

DATA_PATH.mkdir(parents=True, exist_ok=True)

_SCOPE_DIR = {"DM": "DMs", "GROUP_DM": "GROUP_DMs", "guild": "SERVEURS"}

# Types de log écrits ici — bornés pour que `{msg_type}_messages.json` ne puisse
# jamais devenir un nom de fichier arbitraire.
MSG_TYPES = ("deleted", "edited")


def get_whitelist() -> list[str]:
    # Les entrées non numériques sont ignorées : elles serviraient de segment de
    # chemin sous data/ et permettraient d'en sortir.
    return [g for g in read_json(WHITELIST_FILE, []) if is_snowflake(g)]


def save_whitelist(items: list[str]) -> None:
    write_json(WHITELIST_FILE, items)


def _scope_path(scope_id: str, scope_type: str):
    return (DATA_PATH / _SCOPE_DIR.get(scope_type, "SERVEURS")
            / safe_id_segment(scope_id, "identifiant de scope"))


def _messages_file(scope_id: str, msg_type: str, scope_type: str):
    if msg_type not in MSG_TYPES:
        raise ValueError("Type de messages invalide (attendu : deleted ou edited).")
    return _scope_path(scope_id, scope_type) / f"{msg_type}_messages.json"


def read_messages(scope_id: str, msg_type: str, scope_type: str = "guild") -> list:
    return read_json(_messages_file(scope_id, msg_type, scope_type), [])


def _write_messages(scope_id, msg_type, messages, scope_type="guild") -> None:
    write_json(_messages_file(scope_id, msg_type, scope_type), messages)


def _push_entry(scope_id, msg_type, entry, scope_type="guild") -> None:
    messages = read_messages(scope_id, msg_type, scope_type)
    messages.append(entry)
    if len(messages) > 100:
        messages.pop(0)
    _write_messages(scope_id, msg_type, messages, scope_type)


def _ms(dt) -> int | None:
    if dt is None:
        return None
    try:
        return int(dt.timestamp() * 1000)
    except Exception:
        return None


def _normalize_author_tag(author) -> str:
    if not author:
        return "unknown"
    discriminator = getattr(author, "discriminator", "0")
    username = getattr(author, "name", None)
    if username and discriminator and discriminator != "0":
        return f"{username}#{discriminator}"
    return username or getattr(author, "global_name", None) or str(getattr(author, "id", "")) or "unknown"


def _stringify_embeds(embeds) -> list[str]:
    out = []
    for e in embeds or []:
        parts = [p for p in [getattr(e, "title", None), getattr(e, "description", None)] if p]
        if parts:
            out.append(" — ".join(parts))
    return out


def _extract_content(message) -> str:
    if not message:
        return ""
    parts = []
    content = (message.content or "").strip() if getattr(message, "content", None) else ""
    if content:
        parts.append(content)
    for txt in _stringify_embeds(getattr(message, "embeds", [])):
        parts.append(f"[embed] {txt}")
    for att in getattr(message, "attachments", []) or []:
        if getattr(att, "url", None):
            parts.append(f"[file] {att.url}")
    return "\n".join(parts)


def _channel_scope_type(channel) -> str | None:
    if isinstance(channel, discord.DMChannel):
        return "DM"
    if isinstance(channel, discord.GroupChannel):
        return "GROUP_DM"
    return None


async def handle_message_delete(message, client) -> None:
    author = getattr(message, "author", None)
    if author and author.id == client.user.id:
        return

    if getattr(message, "guild", None):
        if str(message.guild.id) not in get_whitelist():
            return
        _push_entry(str(message.guild.id), "deleted", {
            "scope": "guild",
            "guildId": str(message.guild.id),
            "channelId": str(message.channel.id),
            "authorId": str(author.id) if author else None,
            "authorTag": _normalize_author_tag(author),
            "content": _extract_content(message),
            "attachments": [a.url for a in getattr(message, "attachments", []) or []],
            "createdTimestamp": _ms(getattr(message, "created_at", None)),
            "deletedAt": _now_ms(),
        })
        return

    scope_type = _channel_scope_type(getattr(message, "channel", None))
    if scope_type not in ("DM", "GROUP_DM"):
        return
    recipients = []
    for u in getattr(message.channel, "recipients", []) or []:
        recipients.append(f"{_normalize_author_tag(u)} ({u.id})")
    _push_entry(str(message.channel.id), "deleted", {
        "scope": scope_type.lower(),
        "channelId": str(message.channel.id),
        "recipients": recipients,
        "authorId": str(author.id) if author else None,
        "authorTag": _normalize_author_tag(author),
        "content": _extract_content(message),
        "attachments": [a.url for a in getattr(message, "attachments", []) or []],
        "createdTimestamp": _ms(getattr(message, "created_at", None)),
        "deletedAt": _now_ms(),
    }, scope_type)


async def handle_raw_message_delete(payload, client) -> None:
    """Point d'entrée branché sur on_raw_message_delete.

    Contrairement à on_message_delete, cet événement se déclenche aussi pour les
    messages absents du cache interne (messages antérieurs au démarrage ou évincés
    du cache) — c'est le cas le plus fréquent sur les serveurs actifs. Le gateway
    ne fournit alors ni contenu ni auteur : on logge une entrée minimale, comme le
    faisait la version JS avec les partials dont le fetch échouait.
    """
    if payload.cached_message is not None:
        await handle_message_delete(payload.cached_message, client)
        return

    created_ts = _ms(discord.utils.snowflake_time(payload.message_id))

    if payload.guild_id is not None:
        guild_id = str(payload.guild_id)
        if guild_id not in get_whitelist():
            return
        _push_entry(guild_id, "deleted", {
            "scope": "guild",
            "guildId": guild_id,
            "channelId": str(payload.channel_id),
            "authorId": None,
            "authorTag": "unknown",
            "content": "",
            "attachments": [],
            "createdTimestamp": created_ts,
            "deletedAt": _now_ms(),
        })
        return

    channel = client.get_channel(payload.channel_id)
    scope_type = _channel_scope_type(channel)
    if scope_type not in ("DM", "GROUP_DM"):
        return
    recipients = [f"{_normalize_author_tag(u)} ({u.id})"
                  for u in getattr(channel, "recipients", []) or []]
    _push_entry(str(payload.channel_id), "deleted", {
        "scope": scope_type.lower(),
        "channelId": str(payload.channel_id),
        "recipients": recipients,
        "authorId": None,
        "authorTag": "unknown",
        "content": "",
        "attachments": [],
        "createdTimestamp": created_ts,
        "deletedAt": _now_ms(),
    }, scope_type)


async def handle_raw_message_edit(payload, client) -> None:
    """Point d'entrée branché sur on_raw_message_edit (payload.message = message à jour)."""
    if payload.cached_message is not None:
        await handle_message_edit(payload.cached_message, payload.message, client)
        return

    after = payload.message
    author = getattr(after, "author", None)
    if author and author.id == client.user.id:
        return
    # Sans version en cache, edited_at est le seul moyen de distinguer une vraie
    # édition d'un MESSAGE_UPDATE technique (déroulé d'embed d'un lien, épinglage…).
    if getattr(after, "edited_at", None) is None:
        return
    new_content = _extract_content(after)

    if getattr(after, "guild", None):
        if str(after.guild.id) not in get_whitelist():
            return
        _push_entry(str(after.guild.id), "edited", {
            "scope": "guild",
            "guildId": str(after.guild.id),
            "channelId": str(after.channel.id),
            "authorId": str(author.id) if author else None,
            "authorTag": _normalize_author_tag(author),
            "oldContent": "",
            "newContent": new_content,
            "createdTimestamp": _ms(getattr(after, "created_at", None)),
            "editedAt": _now_ms(),
        })
        return

    scope_type = _channel_scope_type(getattr(after, "channel", None))
    if scope_type not in ("DM", "GROUP_DM"):
        return
    _push_entry(str(after.channel.id), "edited", {
        "scope": scope_type.lower(),
        "channelId": str(after.channel.id),
        "authorId": str(author.id) if author else None,
        "authorTag": _normalize_author_tag(author),
        "oldContent": "",
        "newContent": new_content,
        "createdTimestamp": _ms(getattr(after, "created_at", None)),
        "editedAt": _now_ms(),
    }, scope_type)


async def handle_message_edit(before, after, client) -> None:
    author = getattr(before, "author", None)
    if author and author.id == client.user.id:
        return

    old_content = _extract_content(before)
    new_content = _extract_content(after)
    if old_content == new_content:
        return

    if getattr(before, "guild", None):
        if str(before.guild.id) not in get_whitelist():
            return
        _push_entry(str(before.guild.id), "edited", {
            "scope": "guild",
            "guildId": str(before.guild.id),
            "channelId": str(before.channel.id),
            "authorId": str(author.id) if author else None,
            "authorTag": _normalize_author_tag(author),
            "oldContent": old_content,
            "newContent": new_content,
            "createdTimestamp": _ms(getattr(before, "created_at", None)),
            "editedAt": _now_ms(),
        })
        return

    scope_type = _channel_scope_type(getattr(before, "channel", None))
    if scope_type not in ("DM", "GROUP_DM"):
        return
    _push_entry(str(before.channel.id), "edited", {
        "scope": scope_type.lower(),
        "channelId": str(before.channel.id),
        "authorId": str(author.id) if author else None,
        "authorTag": _normalize_author_tag(author),
        "oldContent": old_content,
        "newContent": new_content,
        "createdTimestamp": _ms(getattr(before, "created_at", None)),
        "editedAt": _now_ms(),
    }, scope_type)


def _now_ms() -> int:
    import time
    return int(time.time() * 1000)


async def execute(client, payload):
    action = payload.get("action")
    guild_id = payload.get("guildId")

    if action == "list":
        return {"whitelist": get_whitelist()}

    if action == "add":
        if not guild_id:
            raise ValueError("guildId requis.")
        guild_id = safe_id_segment(guild_id, "guildId")
        items = get_whitelist()
        if guild_id not in items:
            items.append(guild_id)
            save_whitelist(items)
        return {"whitelist": items}

    if action == "remove":
        if not guild_id:
            raise ValueError("guildId requis.")
        items = [g for g in get_whitelist() if g != guild_id]
        save_whitelist(items)
        return {"whitelist": items}

    raise ValueError(f"Action msglog inconnue : '{action}'")
