"""bookmark — salons favoris."""

from __future__ import annotations

from ...func.data_path import data_path, read_json, write_json

BOOKMARKS_FILE = data_path("config", "bookmarks.json")


def _load() -> list:
    return read_json(BOOKMARKS_FILE, [])


def _save(data) -> None:
    write_json(BOOKMARKS_FILE, data)


async def execute(client, payload):
    action = payload.get("action")
    channel_id = payload.get("channelId")
    bookmarks = _load()

    if action == "list":
        return {"bookmarks": bookmarks}

    if action == "add":
        if not channel_id:
            raise ValueError("channelId requis.")
        if channel_id not in bookmarks:
            bookmarks.append(channel_id)
        _save(bookmarks)
        return {"bookmarks": bookmarks}

    if action == "remove":
        if not channel_id:
            raise ValueError("channelId requis.")
        filtered = [c for c in bookmarks if c != channel_id]
        _save(filtered)
        return {"bookmarks": filtered}

    raise ValueError(f"Action bookmark inconnue : '{action}'")
