"""prefix — préfixe des commandes texte du selfbot (bridge + lecture)."""

from __future__ import annotations

from ...func.data_path import data_path, read_json, write_json

PREFIX_FILE = data_path("config", "prefix.json")
DEFAULT_PREFIX = "."

_cached_prefix: str | None = None


def _save(prefix: str) -> str:
    global _cached_prefix
    _cached_prefix = prefix
    write_json(PREFIX_FILE, {"prefix": prefix})
    return prefix


def load_prefix() -> str:
    global _cached_prefix
    if _cached_prefix:
        return _cached_prefix
    if not PREFIX_FILE.exists():
        return _save(DEFAULT_PREFIX)
    data = read_json(PREFIX_FILE, None)
    if not data:
        return _save(DEFAULT_PREFIX)
    _cached_prefix = data.get("prefix") or DEFAULT_PREFIX
    return _cached_prefix


async def execute(client, payload):
    action = payload.get("action")
    if action == "get":
        return {"prefix": load_prefix()}
    if action == "set":
        new_prefix = payload.get("prefix")
        if not new_prefix or len(new_prefix) > 3:
            raise ValueError("Le préfixe doit faire entre 1 et 3 caractères.")
        _save(new_prefix)
        return {"prefix": new_prefix}
    raise ValueError(f"Action prefix inconnue : '{action}'")
