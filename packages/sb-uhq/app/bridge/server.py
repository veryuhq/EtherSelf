"""Serveur HTTP bridge (aiohttp) — équivalent de src/bridge/server.js.

Écoute sur 127.0.0.1:BRIDGE_PORT. Le controller JS envoie :
  POST /action  headers signés + { action, payload }  → { success, data } | { success:false, error }
  GET  /health  headers signés (body vide)            → { success, data:{ status, user, uptime, ping } }
"""

from __future__ import annotations

import os
import re
import time

from aiohttp import web

from ..func.logbus import logerr
from ..router.action_router import dispatch
from .auth import get_secret_buffer, register_signature, verify_signed_request

BRIDGE_PORT = int(os.environ.get("BRIDGE_PORT", "3000"))

_START_TIME = time.time()

# Actions destructives : rate-limit plus strict (5/min), comme en JS.
_DESTRUCTIVE = re.compile(r"^(purge\.|backups\.clone\.run|token\.set)")


class _RateLimiter:
    def __init__(self, window_ms: int, max_hits: int):
        self.window_ms = window_ms
        self.max_hits = max_hits
        self.buckets: dict[str, dict] = {}

    def allow(self, key: str) -> bool:
        now = int(time.time() * 1000)
        # La clé du limiteur « destructif » contient le nom d'action, qui vient
        # du payload : `purge.<n_importe_quoi>` matche le préfixe et créait une
        # entrée de plus à chaque appel, sans jamais être évacuée. On purge les
        # fenêtres expirées avant d'insérer.
        if len(self.buckets) > 1000:
            for k, b in list(self.buckets.items()):
                if b["resetAt"] <= now:
                    self.buckets.pop(k, None)
        bucket = self.buckets.get(key)
        if not bucket or bucket["resetAt"] <= now:
            bucket = {"count": 0, "resetAt": now + self.window_ms}
        bucket["count"] += 1
        self.buckets[key] = bucket
        return bucket["count"] <= self.max_hits


_general = _RateLimiter(60_000, 100)
_destructive = _RateLimiter(60_000, 5)


def _client_key(request: web.Request) -> str:
    return request.remote or "local"


def _signature_of(request: web.Request) -> str:
    return request.headers.get("X-Bridge-Signature", "")


async def _read_raw(request: web.Request) -> str:
    raw = await request.read()
    return raw.decode("utf-8", errors="replace")


def start_bridge_server(client) -> web.AppRunner:
    try:
        get_secret_buffer()
    except ValueError as err:
        logerr(f"[BRIDGE] ❌  {err} — serveur bridge non démarré.")
        return None

    app = web.Application(client_max_size=64 * 1024)

    async def handle_action(request: web.Request) -> web.Response:
        raw = await _read_raw(request)

        if not verify_signed_request(request.headers, raw):
            return web.json_response(
                {"success": False, "error": "Forbidden — signature invalide."}, status=403)

        if not register_signature(_signature_of(request)):
            return web.json_response(
                {"success": False, "error": "Requête déjà utilisée (rejeu détecté)."}, status=409)

        if not _general.allow(_client_key(request)):
            return web.json_response(
                {"success": False, "error": "Too many requests"}, status=429,
                headers={"Retry-After": "60"})

        try:
            body = _parse_json(raw)
        except ValueError:
            return web.json_response(
                {"success": False, "error": "JSON invalide."}, status=400)

        action = body.get("action")
        payload = body.get("payload") or {}
        if not action or not isinstance(action, str):
            return web.json_response(
                {"success": False, "error": "Champ 'action' manquant ou invalide."}, status=400)

        if _DESTRUCTIVE.match(action):
            key = f"destructive:{_client_key(request)}:{action}"
            if not _destructive.allow(key):
                return web.json_response(
                    {"success": False, "error": "Too many requests"}, status=429,
                    headers={"Retry-After": "60"})

        try:
            result = await dispatch(client, action, payload)
            return web.json_response({"success": True, "data": result})
        except Exception as err:  # noqa: BLE001 — on renvoie l'erreur au controller
            logerr(f"[BRIDGE] Erreur action '{action}': {err}")
            return web.json_response({"success": False, "error": str(err)}, status=500)

    async def handle_health(request: web.Request) -> web.Response:
        raw = await _read_raw(request)
        if not verify_signed_request(request.headers, raw):
            return web.json_response(
                {"success": False, "error": "Forbidden — signature invalide."}, status=403)

        if not register_signature(_signature_of(request)):
            return web.json_response(
                {"success": False, "error": "Requête déjà utilisée (rejeu détecté)."}, status=409)

        ws_ping = None
        try:
            latency = client.latency  # secondes
            if latency == latency:  # exclut NaN
                ws_ping = round(latency * 1000)
        except Exception:
            ws_ping = None

        user_tag = None
        try:
            user_tag = str(client.user) if client.user else None
        except Exception:
            user_tag = None

        return web.json_response({
            "success": True,
            "data": {
                "status": "online",
                "user": user_tag or "non connecté",
                "uptime": time.time() - _START_TIME,
                "ping": ws_ping,
            },
        })

    app.router.add_post("/action", handle_action)
    app.router.add_get("/health", handle_health)

    runner = web.AppRunner(app)
    return runner


def _parse_json(raw: str) -> dict:
    import json

    if not raw:
        return {}
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError("Body doit être un objet JSON.")
    return data


async def run_bridge_server(client) -> web.AppRunner | None:
    runner = start_bridge_server(client)
    if runner is None:
        return None
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", BRIDGE_PORT)
    await site.start()
    from ..func.logbus import log

    log(f"[BRIDGE] ✅  Serveur HTTP démarré sur 127.0.0.1:{BRIDGE_PORT}")
    return runner
