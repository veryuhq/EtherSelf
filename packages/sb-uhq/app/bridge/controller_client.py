"""Appels sortants vers le bot-controller (resté en JS).

Endpoints côté controller (voir packages/bot-controller/index.js) :
  POST /log              { text }
  POST /progress         { jobId, ... }               (purge)
  POST /clone-progress   { jobId, ... }               (clone de serveur)
  POST /snapshot-result  { jobId, ... }               (résultat snapshot)
  POST /file             { filename, filepath|base64, meta?, channelId? }

Tous signés avec le même HMAC que /action.
"""

from __future__ import annotations

import os

import aiohttp

from .auth import signed_headers

CONTROLLER_URL = os.environ.get("BRIDGE_CONTROLLER_URL", "http://127.0.0.1:3001")

_session: aiohttp.ClientSession | None = None


async def _get_session() -> aiohttp.ClientSession:
    global _session
    if _session is None or _session.closed:
        _session = aiohttp.ClientSession()
    return _session


async def _post_json(path: str, payload: dict) -> bool:
    import json

    body = json.dumps(payload, ensure_ascii=False)
    headers = signed_headers(body, {"Content-Type": "application/json"})
    try:
        session = await _get_session()
        async with session.post(f"{CONTROLLER_URL}{path}", data=body.encode("utf-8"),
                                headers=headers) as res:
            return res.status < 400
    except Exception:
        return False


async def post_log(text: str) -> bool:
    return await _post_json("/log", {"text": text})


async def post_progress(job_id: str, data: dict) -> bool:
    return await _post_json("/progress", {"jobId": job_id, **data})


async def post_clone_progress(job_id: str, data: dict) -> bool:
    if not job_id:
        return False
    return await _post_json("/clone-progress", {"jobId": job_id, **data})


async def post_snapshot_result(job_id: str, result: dict) -> bool:
    if not job_id:
        return False
    return await _post_json("/snapshot-result", {"jobId": job_id, **result})


async def post_file(filename: str, filepath: str, meta: dict | None,
                    channel_id: str | None = None) -> bool:
    return await _post_json("/file", {
        "filename": filename,
        "filepath": filepath,
        "meta": meta,
        "channelId": channel_id,
    })


async def close_session() -> None:
    global _session
    if _session and not _session.closed:
        await _session.close()
    _session = None
