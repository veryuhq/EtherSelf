"""Redirection des logs vers le bot-controller (équivalent du console.log override JS).

`log()`  → affiché en stdout ET relayé au controller via POST /log (MP à OWNER_ID).
`logerr()` → stderr uniquement (comme console.error côté JS, non relayé).
"""

from __future__ import annotations

import asyncio
import json as _json
import sys

_broadcast_enabled = False


def enable_broadcast() -> None:
    global _broadcast_enabled
    _broadcast_enabled = True


def _stringify(args) -> str:
    parts = []
    for a in args:
        parts.append(a if isinstance(a, str) else _json.dumps(a, ensure_ascii=False))
    return " ".join(parts)


def log(*args) -> None:
    text = _stringify(args)
    print(text, flush=True)
    if not _broadcast_enabled:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    # Import tardif pour éviter une dépendance circulaire au chargement.
    from ..bridge.controller_client import post_log

    loop.create_task(post_log(text))


def logerr(*args) -> None:
    print(_stringify(args), file=sys.stderr, flush=True)
