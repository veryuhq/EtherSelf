"""Récupère le token du compte pour les requêtes REST brutes.

En JS on lisait `client.token`. discord.py-self stocke le token dans `client.http.token` ;
on retombe sur la variable d'environnement TOKEN si besoin.
"""

from __future__ import annotations

import os


def get_token(client=None) -> str:
    if client is not None:
        http = getattr(client, "http", None)
        token = getattr(http, "token", None)
        if token:
            return token
    return os.environ.get("TOKEN", "")
