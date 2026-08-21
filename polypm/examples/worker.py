"""Exemple Python : une boucle de travail qui journalise son avancement."""
from __future__ import annotations

import os
import signal
import sys
import time

QUEUE = os.environ.get("QUEUE", "default")
processed = 0
running = True


def stop(_signum, _frame):
    global running
    running = False


signal.signal(signal.SIGINT, stop)
signal.signal(signal.SIGTERM, stop)

print(f"[py] worker démarré sur la file « {QUEUE} » (pid {os.getpid()})")

while running:
    processed += 1
    print(f"[py] job {processed} traité")
    time.sleep(2)

print(f"[py] arrêt propre après {processed} jobs")
sys.exit(0)
