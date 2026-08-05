"""token.set — met à jour le token du compte dans le fichier .env.

Écriture atomique (fichier temporaire + rename), permissions 0600. Confirmation par OWNER_ID.
On met aussi à jour os.environ (la reconnexion effective nécessite un redémarrage).
"""

from __future__ import annotations

import hmac
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
    # Le temporaire contient tout le .env (token ET BRIDGE_SECRET) : on le crée
    # directement en 0600 plutôt que d'écrire puis chmod, sinon il reste lisible
    # par les autres comptes de l'hôte le temps de l'écriture.
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(content)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    os.replace(tmp, ENV_FILE)
    os.environ["TOKEN"] = token
    return {"updated": True}


def _assert_owner_confirmed(payload) -> None:
    """Second facteur de `token.set` : l'OWNER_ID doit être confirmé explicitement.

    Une valeur non vide est exigée des deux côtés — sinon deux `None` (OWNER_ID absent
    du .env du selfbot) suffisaient à valider la garde — et comparée en temps constant.
    """
    owner_id = str(os.environ.get("OWNER_ID") or "").strip()
    if not owner_id:
        raise ValueError(
            "OWNER_ID n'est pas configuré dans le .env du selfbot : "
            "modification du token refusée.")
    confirm = str(payload.get("ownerIdConfirm") or "").strip()
    if not confirm or not hmac.compare_digest(confirm, owner_id):
        raise ValueError("Confirmation OWNER_ID invalide.")


async def execute(client, payload):
    action = payload.get("action")
    if action == "set":
        _assert_owner_confirmed(payload)
        next_token = str(payload.get("token") or "").strip()
        if not next_token:
            raise ValueError("Le token ne peut pas être vide.")
        _write_token_to_env(next_token)
        return {"updated": True}
    raise ValueError(f"Action token inconnue : '{action}'")
