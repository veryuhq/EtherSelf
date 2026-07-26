"""afk — réponse automatique en DM + renommage [AFK] du globalName."""

from __future__ import annotations

import re

from ...func.data_path import data_path, read_json, write_json
from ...func.logbus import logerr

AFK_FILE = data_path("config", "afk.json")

_DEFAULT = {
    "enabled": False,
    "excluded": [],
    "notified": [],
    "message": None,
}


def _strip_reason_placeholder(text: str) -> str:
    """Retire le placeholder ``{reason}`` et les résidus qu'il laisse derrière lui.

    Nettoie les parenthèses/crochets vides et les espaces superflus.
    """
    text = text.replace("{reason}", "")
    text = re.sub(r"[([{][\s—–-]*[)\]}]", "", text)  # () / [] / {} vides
    text = re.sub(r"[ \t]+([,.;:!?])", r"\1", text)   # espace avant ponctuation
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text.strip()


def _load() -> dict:
    data = read_json(AFK_FILE, dict(_DEFAULT))
    # Migration : l'ancien champ "messageNormal" devient "message".
    if "messageNormal" in data:
        data.setdefault("message", data.pop("messageNormal"))
    # Migration : la raison n'existe plus, on la retire de l'état et du message.
    data.pop("reason", None)
    if data.get("message") and "{reason}" in data["message"]:
        data["message"] = _strip_reason_placeholder(data["message"]) or None
    return data


def _save(data) -> None:
    write_json(AFK_FILE, data)


def _build_message(data: dict) -> str:
    """Construit le message AFK à envoyer.

    Message personnalisé s'il est défini, sinon message par défaut.
    """
    return data.get("message") or "Je suis AFK."


async def execute(client, payload):
    action = payload.get("action")
    data = _load()

    if action == "getState":
        return data

    if action == "toggle":
        data["enabled"] = not data.get("enabled")
        data["notified"] = []
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

    if action == "setMessage":
        data["message"] = payload.get("message") or None
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
    # DM et Group DM uniquement — jamais dans les serveurs.
    if message.guild is not None:
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

    msg = _build_message(data)

    try:
        await message.channel.send(msg)
    except Exception:
        pass

    data["notified"].append(author_id)
    _save(data)
