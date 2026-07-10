"""Arrêt « brutal » du process pour préserver la session Discord (parité JS).

pm2 arrête ses process avec SIGINT (y compris pour max_memory_restart).
Avec discord.py-self, SIGINT → KeyboardInterrupt → Client.close(), qui :
  1. déconnecte chaque VoiceClient (op 4 « channel_id: null ») → départ
     immédiatement visible du salon vocal ;
  2. ferme la gateway avec le code 1000 (fermeture propre) → la session est
     invalidée et le compte passe hors-ligne instantanément.

L'ancien selfbot JS ne faisait rien de tout ça : le process Node mourait
brutalement, la connexion TCP tombait sans close frame, et Discord gardait
la session gateway — donc l'état vocal ET la présence — vivante pendant la
fenêtre de resume (largement plus longue que les ~15 s d'un restart pm2).
L'auto-rejoin du démarrage suivant reprenait la main sans que le compte
n'apparaisse jamais déconnecté du vocal.

Ce module reproduit ce comportement : sur SIGINT/SIGTERM on sort
immédiatement via os._exit(), sans laisser discord.py-self envoyer la
déconnexion vocale ni le close 1000. La déconnexion volontaire du vocal
reste possible via l'action « leave » du bridge, qui elle est propre.
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
