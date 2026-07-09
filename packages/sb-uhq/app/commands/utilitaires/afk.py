"""afk — réponse automatique en DM + renommage [AFK] du globalName."""

from __future__ import annotations

from ...func.data_path import data_path, read_json, write_json
from ...func.logbus import logerr

AFK_FILE = data_path("config", "afk.json")

_DEFAULT = {
    "enabled": False,
    "special": False,
    "reason": "",
    "excluded": [],
    "notified": [],
    "messageNormal": None,
    "messageSpecial": None,
}


def _load() -> dict:
    return read_json(AFK_FILE, dict(_DEFAULT))


def _save(data) -> None:
    write_json(AFK_FILE, data)


async def execute(client, payload):
    action = payload.get("action")
    data = _load()

    if action == "getState":
        return data

    if action == "toggle":
        data["enabled"] = not data.get("enabled")
        if data["enabled"]:
            current_name = getattr(client.user, "global_name", None) or client.user.name
            data["_originalGlobalName"] = current_name
            _save(data)
            try:
                await client.user.edit(global_name=f"[AFK] {current_name}")
            except Exception as err:  # noqa: BLE001
                logerr(f"[AFK] Impossible de changer le globalName : {err}")
        else:
            original = data.get("_originalGlobalName")
            data["_originalGlobalName"] = None
            _save(data)
            try:
                await client.user.edit(global_name=original)
            except Exception as err:  # noqa: BLE001
                logerr(f"[AFK] Impossible de restaurer le globalName : {err}")
        return data

    if action == "toggleSpecial":
        data["special"] = not data.get("special")
        _save(data)
        return data

    if action == "setReason":
        data["reason"] = payload.get("reason") or ""
        _save(data)
        return data

    if action == "setMsgNormal":
        data["messageNormal"] = payload.get("message") or None
        _save(data)
        return data

    if action == "setMsgSpecial":
        data["messageSpecial"] = payload.get("message") or None
        _save(data)
        return data

    if action == "addExclusion":
        user_id = payload.get("userId")
        if not user_id:
            raise ValueError("userId requis.")
        if user_id not in data["excluded"]:
            data["excluded"].append(user_id)
        _save(data)
        return data

    if action == "removeExclusion":
        user_id = payload.get("userId")
        if not user_id:
            raise ValueError("userId requis.")
        data["excluded"] = [i for i in data["excluded"] if i != user_id]
        _save(data)
        return data

    raise ValueError(f"Action afk inconnue : '{action}'")


async def handle_incoming_message(message, client) -> None:
    data = _load()
    if not data.get("enabled"):
        return
    if message.author.id == client.user.id:
        return
    if message.guild:
        return
    if getattr(message.author, "bot", False):
        return
    if getattr(message, "mention_everyone", False):
        return
    if getattr(message, "role_mentions", None):
        return
    author_id = str(message.author.id)
    if author_id in data["excluded"]:
        return
    if author_id in data["notified"]:
        return

    if data.get("special") and data.get("messageSpecial"):
        msg = data["messageSpecial"]
    elif data.get("messageNormal"):
        msg = data["messageNormal"]
    else:
        reason = f" — {data['reason']}" if data.get("reason") else ""
        msg = f"Je suis AFK{reason}."

    try:
        await message.channel.send(msg)
    except Exception:
        pass

    data["notified"].append(author_id)
    _save(data)
