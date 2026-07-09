"""En-têtes client Discord pour les requêtes REST brutes (quests, purge, backups).

Port fidèle de src/self/func/discord-client-headers.js.
"""

from __future__ import annotations

import base64
import json

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
    "browser_user_agent": DESKTOP_USER_AGENT,
    "browser_version": "37.6.0",
    "os_sdk_version": "19045",
    "client_build_number": 539951,
    "native_build_number": 81687,
    "client_event_source": None,
}

ANDROID_SUPER_PROPERTIES = {
    "os": "Android",
    "browser": "Discord Android",
    "device": "b0q",
    "system_locale": "en-US",
    "has_client_mods": False,
    "client_version": "316.11 - rn",
    "release_channel": "googleRelease",
    "browser_user_agent": "",
    "browser_version": "",
    "os_version": "28",
    "client_build_number": 5169,
    "client_event_source": None,
}


def _encode_super_properties(properties: dict) -> str:
    # Séparateurs compacts (",", ":") pour reproduire à l'identique le JSON.stringify
    # de Node : l'X-Super-Properties est l'empreinte client vue par Discord et doit
    # correspondre au byte près à celle de l'ancien selfbot / d'un vrai client.
    payload = json.dumps(properties, separators=(",", ":"))
    return base64.b64encode(payload.encode("utf-8")).decode("ascii")


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
