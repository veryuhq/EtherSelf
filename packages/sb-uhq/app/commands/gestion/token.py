"""token.set — met à jour le token du compte dans le fichier .env.

Écriture atomique (fichier temporaire + rename), permissions 0600. Confirmation par OWNER_ID.
Comme en JS, on met aussi à jour os.environ (la reconnexion effective nécessite un redémarrage).
"""

from __future__ import annotations

import os
import re

from ...func.data_path import ENV_FILE

_TOKEN_RE = re.compile(r"^[A-Za-z0-9._-]{50,120}$")
_TOKEN_LINE = re.compile(r"^\s*TOKEN\s*=")


def _read_env_lines() -> list[str]:
    if not ENV_FILE.exists():
        return []
    return ENV_FILE.read_text(encoding="utf-8").splitlines()


def _assert_valid_token(token: str) -> None:
    if not _TOKEN_RE.match(token):
        raise ValueError("Format de token invalide.")


def _write_token_to_env(token: str) -> dict:
    _assert_valid_token(token)
    lines = _read_env_lines()
    found = False
    out = []
    for line in lines:
        if _TOKEN_LINE.match(line):
            found = True
            out.append(f"TOKEN={token}")
        else:
            out.append(line)
    if not found:
        out.append(f"TOKEN={token}")

    content = "\n".join(out).rstrip("\n") + "\n"
    tmp = ENV_FILE.with_suffix(f".{os.getpid()}.tmp")
    tmp.write_text(content, encoding="utf-8")
    try:
        tmp.chmod(0o600)
    except OSError:
        pass
    os.replace(tmp, ENV_FILE)
    os.environ["TOKEN"] = token
    return {"updated": True}


async def execute(client, payload):
    action = payload.get("action")
    if action == "set":
        if payload.get("ownerIdConfirm") != os.environ.get("OWNER_ID"):
            raise ValueError("Confirmation OWNER_ID invalide.")
        next_token = str(payload.get("token") or "").strip()
        if not next_token:
            raise ValueError("Le token ne peut pas être vide.")
        _write_token_to_env(next_token)
        return {"updated": True}
    raise ValueError(f"Action token inconnue : '{action}'")
