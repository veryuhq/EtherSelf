"""msgbookmarks — messages importants sauvegardés avec notes."""

from __future__ import annotations

import re
import time

from ...func.data_path import data_path, read_json, write_json
from ...func.discord_util import fetch_channel, user_tag
from ...func.logbus import logerr

MSGBM_FILE = data_path("config", "msgbookmarks.json")

# Ancré sur l'URL complète : un `search` non ancré acceptait
# https://exemple.test/discord.com/channels/1/2/3, et cette URL arbitraire était
# ensuite stockée puis affichée comme lien cliquable dans le panel.
_URL_RE = re.compile(
    r"^https://(?:(?:canary|ptb)\.)?discord(?:app)?\.com/channels/(\d{1,20}|@me)/(\d{1,20})/(\d{1,20})/?$")


def _load() -> list:
    return read_json(MSGBM_FILE, [])


def _save(data) -> None:
    write_json(MSGBM_FILE, data)


def _now_ms() -> int:
    return int(time.time() * 1000)


async def execute(client, payload):
    action = payload.get("action")
    index = payload.get("index")
    note = payload.get("note")
    bookmarks = _load()

    if action == "list":
        return {"bookmarks": bookmarks}

    if action == "add":
        url = payload.get("url")
        if not url:
            raise ValueError("url requis.")
        match = _URL_RE.match(str(url).strip())
        if not match:
            raise ValueError("URL de message Discord invalide.")
        guild_id, channel_id, message_id = match.group(1), match.group(2), match.group(3)

        author_tag = "Inconnu"
        content = ""
        try:
            channel = await fetch_channel(client, channel_id)
            if channel:
                msg = await channel.fetch_message(int(message_id))
                if msg:
                    author_tag = user_tag(msg.author) or "Inconnu"
                    content = msg.content or ""
                    if not content and msg.embeds:
                        e = msg.embeds[0]
                        content = getattr(e, "title", None) or getattr(e, "description", None) or ""
                    content = content[:500]
        except Exception as err:  # noqa: BLE001
            logerr(f"[MSGBM] Erreur fetch message : {err}")

        bookmarks.append({
            "messageId": message_id,
            "channelId": channel_id,
            "guildId": None if guild_id == "@me" else guild_id,
            "authorTag": author_tag,
            "content": content,
            "url": url,
            "savedAt": _now_ms(),
            "note": payload.get("note") or None,
        })
        if len(bookmarks) > 200:
            bookmarks.pop(0)
        _save(bookmarks)
        return {"bookmarks": bookmarks}

    if action == "clear":
        _save([])
        return {"bookmarks": []}

    if action == "remove":
        idx = (index or 1) - 1
        if idx < 0 or idx >= len(bookmarks):
            raise ValueError(f"Index invalide (1–{len(bookmarks)}).")
        bookmarks.pop(idx)
        _save(bookmarks)
        return {"bookmarks": bookmarks}

    if action == "note":
        idx = (index or 1) - 1
        if idx < 0 or idx >= len(bookmarks):
            raise ValueError(f"Index invalide (1–{len(bookmarks)}).")
        bookmarks[idx]["note"] = note or None
        _save(bookmarks)
        return {"bookmarks": bookmarks}

    raise ValueError(f"Action msgbookmarks inconnue : '{action}'")
