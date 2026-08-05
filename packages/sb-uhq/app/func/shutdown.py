"""Arrêt « brutal » du process pour préserver la session Discord.

Une fermeture propre (SIGINT → Client.close() → close 1000) invalide la session côté
Discord et fait passer le compte hors-ligne à chaque restart pm2. On sort donc via
os._exit() sur SIGINT/SIGTERM : sans close frame, Discord garde la présence vivante
pendant la fenêtre de resume.
"""

from __future__ import annotations

import os
import signal
import sys


def _hard_exit(signum, frame) -> None:  # noqa: ARG001
    # Pas de log() ici : le logbus passe par une requête HTTP asynchrone qui
    # n'aurait pas le temps de partir. stderr est capturé par pm2.
    try:
        sys.stderr.write(
            f"[SHUTDOWN] Signal {signal.Signals(signum).name} reçu : sortie immédiate "
            "(session gateway conservée côté Discord).\n"
        )
        sys.stderr.flush()
    except Exception:  # noqa: BLE001
        pass
    os._exit(0)


def install() -> None:
    """Installe les handlers SIGINT/SIGTERM. À appeler avant client.run()."""
    signal.signal(signal.SIGINT, _hard_exit)
    signal.signal(signal.SIGTERM, _hard_exit)
