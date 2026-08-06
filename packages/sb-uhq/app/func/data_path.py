"""Résolution des chemins vers data/ indépendamment du working directory (pm2, etc.)."""

from __future__ import annotations

import json
import os
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
    #
    # Écriture ATOMIQUE (temporaire + os.replace), comme token.py pour le .env :
    # shutdown.py sort par os._exit() dès SIGINT/SIGTERM (pm2), donc un redémarrage
    # tombant pendant une écriture en place laissait un JSON tronqué. read_json le
    # relit alors comme "absent" et retombe sur son défaut — pour
    # data/config/purge.json cela veut dire une liste d'exclusions vide, et la purge
    # large perdait silencieusement ses garde-fous. Le rename suffit ici : la menace
    # est la mort du process, pas celle de la machine, et le contenu déjà écrit reste
    # dans le cache de pages. Pas de fsync, qui pénaliserait les boucles de rotation
    # RPC (une écriture toutes les 5 s).
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(data, ensure_ascii=False, indent=2)

    # Créé directement avec ses permissions finales : un chmod après coup laisserait
    # le fichier lisible par les autres comptes de l'hôte le temps de l'écriture.
    tmp = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode if mode is not None else 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(payload)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    os.replace(tmp, path)

    if mode is not None:
        try:
            path.chmod(mode)
        except OSError:
            pass
