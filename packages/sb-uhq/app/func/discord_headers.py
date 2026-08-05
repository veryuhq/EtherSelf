"""En-têtes client Discord pour les requêtes REST brutes (quests, purge, backups).

Port de src/self/func/discord-client-headers.js, réaligné depuis sur les super
properties de l'implémentation de référence des quêtes (aiko-chan-ai/
Discord-Quest-Auto-Completion-Selfbot, src/constants.ts) : l'ancien portage
omettait les champs de session d'un lancement client (voir plus bas).
"""

from __future__ import annotations

import base64
import json
import uuid

# Identifiants de session tirés au sort à chaque lancement du process, comme le fait
# un vrai client Discord à chaque démarrage. Ils comptent surtout pour les quêtes :
# Discord les livre via son système de décision publicitaire, qui rattache chaque
# livraison à un `client_heartbeat_session_id`. Un client qui n'en présente jamais et
# qui ne se déclare jamais « focused » n'est pas ciblé, et /quests/@me se limite alors
# aux quêtes déjà acceptées à la main dans le client officiel.
DESKTOP_HEARTBEAT_SESSION_ID = str(uuid.uuid4())
ANDROID_HEARTBEAT_SESSION_ID = str(uuid.uuid4())

DESKTOP_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "discord/1.0.9236 Chrome/138.0.7204.251 Electron/37.6.0 Safari/537.36"
)
ANDROID_USER_AGENT = "Discord-Android/316011;RNA"

DESKTOP_SUPER_PROPERTIES = {
    "os": "Windows",
    "browser": "Discord Client",
    "release_channel": "stable",
    "client_version": "1.0.9236",
    "os_version": "10.0.19045",
    "os_arch": "x64",
    "app_arch": "x64",
    "system_locale": "en-US",
    "has_client_mods": False,
    "client_launch_id": str(uuid.uuid4()),
    "browser_user_agent": DESKTOP_USER_AGENT,
    "browser_version": "37.6.0",
    "os_sdk_version": "19045",
    "client_build_number": 539951,
    "native_build_number": 81687,
    "client_event_source": None,
    "launch_signature": str(uuid.uuid4()),
    "client_heartbeat_session_id": DESKTOP_HEARTBEAT_SESSION_ID,
    "client_app_state": "focused",
}

ANDROID_SUPER_PROPERTIES = {
    "os": "Android",
    "browser": "Discord Android",
    "device": "b0q",
    "system_locale": "en-US",
    "has_client_mods": False,
    "client_version": "316.11 - rn",
    "release_channel": "googleRelease",
    "device_vendor_id": str(uuid.uuid4()),
    "design_id": 2,
    "browser_user_agent": "",
    "browser_version": "",
    "os_version": "28",
    "client_build_number": 5169,
    "client_event_source": None,
    "client_launch_id": str(uuid.uuid4()),
    # Le client Android signe son lancement avec un entier, pas un UUID : on reprend
    # tel quel celui de l'implémentation de référence (aiko-chan-ai).
    "launch_signature": "1771754995045142953",
    "client_app_state": "active",
    "client_heartbeat_session_id": ANDROID_HEARTBEAT_SESSION_ID,
}


def _encode_super_properties(properties: dict) -> str:
    # Séparateurs compacts (",", ":") pour reproduire à l'identique le JSON.stringify
    # de Node : l'X-Super-Properties est l'empreinte client vue par Discord et doit
    # correspondre au byte près à celle de l'ancien selfbot / d'un vrai client.
    payload = json.dumps(properties, separators=(",", ":"))
    return base64.b64encode(payload.encode("utf-8")).decode("ascii")


def launch_identity_fields(is_android: bool = False) -> dict:
    """Renvoie les champs de session d'un lancement client, à fusionner ailleurs.

    Le profil de super properties récupéré en ligne par ``platform_identity`` ne les
    contient pas. Les y ajouter aligne l'identité annoncée à la gateway sur celle des
    requêtes REST brutes : Discord voit un seul et même client, avec un unique
    identifiant de session, au lieu de deux.
    """
    source = ANDROID_SUPER_PROPERTIES if is_android else DESKTOP_SUPER_PROPERTIES
    return {key: source[key] for key in (
        "client_launch_id", "launch_signature", "client_app_state",
        "client_heartbeat_session_id",
    )}


def make_desktop_headers(token: str, extra: dict | None = None) -> dict:
    headers = {
        "Authorization": token,
        "Content-Type": "application/json",
        "User-Agent": DESKTOP_USER_AGENT,
        "X-Super-Properties": _encode_super_properties(DESKTOP_SUPER_PROPERTIES),
        "accept-language": "en-US",
        "x-debug-options": "bugReporterEnabled",
        "x-discord-locale": "en-US",
        "x-discord-timezone": "Asia/Saigon",
        "origin": "https://discord.com",
        "referer": "https://discord.com/channels/@me",
        "sec-ch-ua": '"Not)A;Brand";v="8", "Chromium";v="138"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
    }
    if extra:
        headers.update(extra)
    return headers


def make_android_headers(token: str, extra: dict | None = None) -> dict:
    headers = {
        "Authorization": token,
        "Content-Type": "application/json",
        "User-Agent": ANDROID_USER_AGENT,
        "X-Super-Properties": _encode_super_properties(ANDROID_SUPER_PROPERTIES),
        "accept-language": "en-US",
        "x-debug-options": "bugReporterEnabled",
        "x-discord-locale": "en-US",
        "x-discord-timezone": "Asia/Saigon",
    }
    if extra:
        headers.update(extra)
    return headers
