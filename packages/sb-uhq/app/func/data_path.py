"""Résolution des chemins vers data/ indépendamment du working directory (pm2, etc.)."""

from __future__ import annotations

import json
import re
from pathlib import Path

# app/func/data_path.py → parents[0]=func, [1]=app, [2]=racine du package sb-uhq
SB_ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = SB_ROOT / ".env"

# Un ID Discord (snowflake) est un entier non signé sur 64 bits : au plus 20 chiffres.
_SNOWFLAKE_RE = re.compile(r"^[0-9]{1,20}$")


def data_path(*segments: str) -> Path:
    return SB_ROOT.joinpath("data", *segments)


def is_snowflake(value) -> bool:
    """True si la valeur est un ID Discord utilisable tel quel dans un chemin."""
    return bool(_SNOWFLAKE_RE.match(str(value or "").strip()))


def safe_id_segment(value, label: str = "identifiant") -> str:
    """Valide un ID Discord destiné à devenir un segment de chemin sous data/.

    Sans ça, un ``../../..`` ou un ``/etc`` sortirait de data/ (pathlib repart de zéro
    sur un segment absolu et conserve les ``..``). Seul le numérique est accepté.
    """
    text = str(value or "").strip()
    if not _SNOWFLAKE_RE.match(text):
        raise ValueError(f"{label} invalide : un ID Discord numérique est attendu.")
    return text


def read_json(path: Path, default):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return default


def write_json(path: Path, data, *, mode: int | None = 0o600) -> None:
    # Défaut 0600 : les fichiers de data/ contiennent des données privées
    # (contenu de messages supprimés/édités, liste d'amis, config, tokens de
    # session) et ne doivent pas être lisibles par les autres comptes de l'hôte.
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
    if mode is not None:
        try:
            path.chmod(mode)
        except OSError:
            pass
