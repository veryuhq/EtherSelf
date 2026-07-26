"""Requêtes REST brutes pour la complétion des quêtes Discord.

Port de src/self/func/quest-http.js. Endpoints non officiels — susceptibles de casser.
Basé sur https://github.com/aiko-chan-ai/Discord-Quest-Auto-Completion-Selfbot
"""

from __future__ import annotations

import json
from urllib.parse import urlencode, urlparse, parse_qs

import aiohttp

from .data_path import is_snowflake
from .discord_headers import make_android_headers, make_desktop_headers

API = "https://discord.com/api/v9"


def _safe_id(value, label: str) -> str:
    """Valide un identifiant Discord AVANT de l'interpoler dans une URL.

    Ces identifiants proviennent tous de la réponse de l'API quêtes, donc d'une
    source distante que le selfbot ne contrôle pas. Sans validation :

    - `application_id` est interpolé dans le HOST de
      ``https://{application_id}.discordsays.com/.proxy/acf/authorize`` — une
      valeur du type ``a@exemple.test/`` y déplacerait la requête vers un
      serveur tiers, à qui partirait le **code d'autorisation OAuth2 du compte**
      (scopes identify / applications.commands / applications.entitlements) ;
    - `quest_id` et `token_id` sont interpolés dans le CHEMIN d'appels à
      discord.com : un ``#`` ou un ``?`` y tronque l'URL et un ``../`` la
      redirige vers un autre endpoint de l'API.

    Les IDs Discord sont toujours des snowflakes numériques : on rejette tout le
    reste. Un ID malformé fait échouer la quête concernée (l'appelant journalise
    l'erreur dans l'historique) plutôt que d'émettre une requête douteuse.
    """
    text = str(value or "").strip()
    if not is_snowflake(text):
        raise ValueError(f"{label} invalide : un ID Discord numérique est attendu.")
    return text


async def _request(method: str, path: str, token: str, body=None, is_android: bool = False):
    headers = make_android_headers(token) if is_android else make_desktop_headers(token)
    data = json.dumps(body) if body is not None else None
    async with aiohttp.ClientSession() as session:
        async with session.request(method, f"{API}{path}", headers=headers, data=data) as res:
            text = await res.text()
            try:
                parsed = json.loads(text)
            except ValueError:
                parsed = {"_raw": text}
            return {"status": res.status, "ok": res.status < 400, "data": parsed}


async def fetch_quests(token: str):
    return await _request("GET", "/quests/@me", token)


async def enroll_quest(token: str, quest: dict, is_android: bool = False):
    quest_id = _safe_id(quest.get("id"), "questId")
    return await _request("POST", f"/quests/{quest_id}/enroll", token, {
        "location": 12 if is_android else 11,
        "is_targeted": False,
        "metadata_sealed": None,
        "traffic_metadata_raw": quest.get("traffic_metadata_raw"),
        "traffic_metadata_sealed": quest.get("traffic_metadata_sealed"),
    }, is_android)


async def post_video_progress(token: str, quest_id: str, timestamp):
    quest_id = _safe_id(quest_id, "questId")
    return await _request("POST", f"/quests/{quest_id}/video-progress", token,
                          {"timestamp": timestamp})


async def post_heartbeat(token: str, quest_id: str, body: dict):
    quest_id = _safe_id(quest_id, "questId")
    return await _request("POST", f"/quests/{quest_id}/heartbeat", token, body)


async def fetch_application_public(token: str, application_id: str):
    application_id = _safe_id(application_id, "applicationId")
    return await _request("GET", f"/applications/public?application_ids={application_id}", token)


async def authorize_oauth2(token: str, application_id: str):
    application_id = _safe_id(application_id, "applicationId")
    params = urlencode({
        "response_type": "code",
        "client_id": application_id,
        "scope": "identify applications.commands applications.entitlements",
        "state": "",
    })
    return await _request("POST", f"/oauth2/authorize?{params}", token, {
        "permissions": "0",
        "authorize": True,
        "integration_type": 1,
        "location_context": {"guild_id": "10000", "channel_id": "10000", "channel_type": 10000},
    })


async def get_oauth2_tokens(token: str):
    return await _request("GET", "/oauth2/tokens", token)


async def delete_oauth2_token(token: str, token_id: str):
    token_id = _safe_id(token_id, "tokenId")
    return await _request("DELETE", f"/oauth2/tokens/{token_id}", token)


async def get_proxy_ticket(token: str, application_id: str) -> str:
    application_id = _safe_id(application_id, "applicationId")
    res = await _request("POST", f"/applications/{application_id}/proxy-tickets", token, {})
    ticket = (res.get("data") or {}).get("ticket") if res.get("ok") else None
    if not res.get("ok") or not ticket:
        raise RuntimeError(f"Proxy ticket failed ({res['status']}): {json.dumps(res['data'])}")
    return ticket


async def get_activity_referrer(token: str, application_id: str) -> str:
    application_id = _safe_id(application_id, "applicationId")
    proxy_ticket = await get_proxy_ticket(token, application_id)
    params = urlencode({
        "instance_id": "example-cl-instance",
        "platform": "desktop",
        "discord_proxy_ticket": proxy_ticket,
    })
    return f"https://{application_id}.discordsays.com/?{params}"


def _activity_headers(quest_id: str, ds_token: str = "", referrer: str | None = None) -> dict:
    headers = {
        "Content-Type": "application/json",
        "X-Auth-Token": ds_token,
        "X-Discord-Quest-ID": quest_id,
    }
    if referrer:
        headers["Referer"] = referrer
    return headers


async def authorize_discord_says(discord_token: str, application_id: str, quest_id: str,
                                 auth_code: str):
    # C'est ici que part le code d'autorisation OAuth2 du compte : l'ID doit être
    # validé AVANT de construire le host, sans quoi le code file chez un tiers.
    application_id = _safe_id(application_id, "applicationId")
    quest_id = _safe_id(quest_id, "questId")
    referrer = await get_activity_referrer(discord_token, application_id)
    async with aiohttp.ClientSession() as session:
        async with session.post(
            f"https://{application_id}.discordsays.com/.proxy/acf/authorize",
            headers=_activity_headers(quest_id, "", referrer),
            data=json.dumps({"code": auth_code}),
        ) as res:
            try:
                data = await res.json(content_type=None)
            except Exception:
                data = {}
            return {"token": (data or {}).get("token"), "activityReferrer": referrer}


async def progress_discord_says(application_id: str, quest_id: str, ds_token: str,
                                quest_target, referrer: str) -> bool:
    application_id = _safe_id(application_id, "applicationId")
    quest_id = _safe_id(quest_id, "questId")
    async with aiohttp.ClientSession() as session:
        async with session.post(
            f"https://{application_id}.discordsays.com/.proxy/acf/quest/progress",
            headers=_activity_headers(quest_id, ds_token, referrer),
            data=json.dumps({"progress": quest_target}),
        ) as res:
            return res.status < 400


def extract_code_from_location(location: str) -> str | None:
    try:
        return parse_qs(urlparse(location).query).get("code", [None])[0]
    except Exception:
        return None
