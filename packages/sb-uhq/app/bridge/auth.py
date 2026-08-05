"""Signature HMAC-SHA256 du bridge — compatible byte-pour-byte avec le bot-controller JS.

Le contrat (identique à packages/*/src/bridge/auth.js) :
  payload_signé = f"{timestamp_ms}.{body}"
  signature     = HMAC-SHA256(BRIDGE_SECRET, payload_signé).hexdigest()
  headers       = X-Bridge-Timestamp (ms epoch) + X-Bridge-Signature (hex 64)

Toute divergence ici casserait la communication avec le controller resté en JS.
"""

from __future__ import annotations

import hashlib
import hmac
import math
import os
import re
import time

MIN_SECRET_BYTES = 32
MAX_SKEW_MS = 5 * 60 * 1000

_HEX64 = re.compile(r"^[a-f0-9]{64}$", re.IGNORECASE)


def get_secret_buffer(secret: str | None = None) -> bytes:
    raw = secret if secret is not None else os.environ.get("BRIDGE_SECRET", "")
    buf = str(raw or "").encode("utf-8")
    if len(buf) < MIN_SECRET_BYTES:
        raise ValueError(
            f"BRIDGE_SECRET doit contenir au moins {MIN_SECRET_BYTES} octets aléatoires."
        )
    return buf


def _now_ms() -> int:
    return int(time.time() * 1000)


def sign_body(body: str = "", timestamp: int | str | None = None,
              secret: str | None = None) -> tuple[str, str]:
    secret_buf = get_secret_buffer(secret)
    ts = str(timestamp if timestamp is not None else _now_ms())
    payload = f"{ts}.{body or ''}"
    signature = hmac.new(secret_buf, payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return ts, signature


def signed_headers(body: str = "", extra: dict | None = None) -> dict:
    ts, signature = sign_body(body)
    headers = dict(extra or {})
    headers["X-Bridge-Timestamp"] = ts
    headers["X-Bridge-Signature"] = signature
    return headers


def verify_signed_request(headers, body: str = "") -> bool:
    # aiohttp headers sont insensibles à la casse ; on tente les deux orthographes.
    def _get(name: str):
        return headers.get(name) or headers.get(name.lower()) or headers.get(name.upper())

    timestamp = _get("X-Bridge-Timestamp")
    signature = _get("X-Bridge-Signature")
    if not timestamp or not signature:
        return False

    try:
        ts_num = float(timestamp)
    except (TypeError, ValueError):
        return False
    # Rejette explicitement nan/inf : `nan > MAX_SKEW_MS` vaut False et laisserait
    # sinon passer un horodatage "nan" (le côté JS rejette déjà via Number.isFinite).
    if not math.isfinite(ts_num):
        return False
    if abs(_now_ms() - ts_num) > MAX_SKEW_MS:
        return False

    _, expected = sign_body(body, str(timestamp))
    if not _HEX64.match(str(signature)):
        return False
    return hmac.compare_digest(str(signature), expected)


# ── Anti-rejeu ───────────────────────────────────────────────────────────────
# Deux requêtes distinctes ont des timestamps donc des signatures distinctes : seul un
# rejeu réutilise la même. On mémorise celles vues pendant la fenêtre de dérive.

_seen_signatures: dict[str, float] = {}


def register_signature(signature: str | None) -> bool:
    """Retourne True si la signature est neuve, False si c'est un rejeu."""
    now = _now_ms()
    if len(_seen_signatures) > 10_000:
        for key, expiry in list(_seen_signatures.items()):
            if expiry <= now:
                _seen_signatures.pop(key, None)
    sig = str(signature or "")
    if not sig:
        return False
    expiry = _seen_signatures.get(sig)
    if expiry and expiry > now:
        return False
    _seen_signatures[sig] = now + MAX_SKEW_MS
    return True
