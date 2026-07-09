"""Force l'identité de plateforme du selfbot (Desktop par défaut, pas Web).

discord.py-self construit ses `super_properties` via `discord.utils.Headers.default`,
qui récupère TOUJOURS le profil de type ``web`` (``browser: "Chrome"``). Ces propriétés
partent à la fois dans l'en-tête REST ``X-Super-Properties`` et dans le payload ``IDENTIFY``
de la gateway. Discord déduit le badge affiché aux autres (🖥️ Desktop / 🌐 Web / 📱 Mobile)
du champ ``properties.browser`` :

    "Discord Client"  -> Desktop
    "Discord Android" -> Mobile (Android)
    "Discord iOS"     -> Mobile (iOS)
    autre (Chrome...) -> Web

Par défaut le selfbot apparaissait donc en **Web**. Ce module remplace `Headers.default`
pour privilégier un profil **Desktop** (surchargé via la variable d'environnement
``SB_CLIENT_PLATFORM`` : ``desktop`` | ``web`` | ``android`` | ``ios``).

Le profil est d'abord récupéré en ligne via l'API cordapi (comme le fait la lib pour ``web``),
ce qui garantit un ``client_build_number`` à jour ; en cas d'échec réseau on retombe sur un
profil Desktop codé en dur, aligné sur ``discord_headers.DESKTOP_SUPER_PROPERTIES``.
"""

from __future__ import annotations

import asyncio
import copy
import os
import re

import discord
from discord.utils import Headers

from app.func.discord_headers import (
    DESKTOP_SUPER_PROPERTIES,
    DESKTOP_USER_AGENT,
    _encode_super_properties,
)

# Type cordapi (`.../api/v2/properties/{type}`) selon la plateforme voulue.
_PLATFORM_TYPES = {"desktop", "web", "android", "ios"}

# Plateforme (au sens en-têtes client-hints / Sec-CH-UA-Platform) associée au type.
_PLATFORM_OS = {
    "desktop": "Windows",
    "web": "Windows",
    "android": "Android",
    "ios": "iOS",
}

_CHROME_MAJOR_RE = re.compile(r"Chrome/(\d+)")

# Repli codé en dur si l'API cordapi est injoignable : identité Desktop stable.
_FALLBACK_BUILD_NUMBER = DESKTOP_SUPER_PROPERTIES.get("client_build_number", 539951)


def _selected_platform() -> str:
    value = (os.environ.get("SB_CLIENT_PLATFORM") or "desktop").strip().lower()
    return value if value in _PLATFORM_TYPES else "desktop"


def _chrome_major(user_agent: str, default: int = 138) -> int:
    match = _CHROME_MAJOR_RE.search(user_agent or "")
    return int(match.group(1)) if match else default


def _build_desktop_fallback() -> Headers:
    """Construit un `Headers` Desktop sans réseau, aligné sur discord_headers.py."""
    properties = copy.deepcopy(DESKTOP_SUPER_PROPERTIES)
    return Headers(
        platform="Windows",
        major_version=_chrome_major(properties.get("browser_user_agent", DESKTOP_USER_AGENT)),
        super_properties=properties,
        encoded_super_properties=_encode_super_properties(properties),
        # Le vrai client Desktop n'envoie pas les champs gateway spécifiques au web.
        extra_gateway_properties={},
    )


def install(platform: str | None = None) -> None:
    """Remplace `discord.utils.Headers.default` pour émuler la plateforme voulue.

    Doit être appelé AVANT `client.run(...)` (les en-têtes sont construits paresseusement
    au premier appel HTTP, dans `HTTPClient.startup`).
    """
    target = (platform or _selected_platform())
    if target not in _PLATFORM_TYPES:
        target = "desktop"

    # Rien à faire pour 'web' : c'est déjà le comportement natif de la lib.
    if target == "web":
        return

    original_default = Headers.default.__func__  # classmethod -> fonction sous-jacente

    async def _patched_default(cls, session, proxy=None, proxy_auth=None):
        # 1) Profil en ligne (build number à jour) pour la plateforme demandée.
        try:
            properties, extra, encoded = await asyncio.wait_for(
                cls.get_api_properties(session, target, proxy=proxy, proxy_auth=proxy_auth),
                timeout=3,
            )
            return cls(
                platform=_PLATFORM_OS.get(target, "Windows"),
                major_version=_chrome_major(properties.get("browser_user_agent", "")),
                super_properties=properties,
                encoded_super_properties=encoded,
                extra_gateway_properties=extra,
            )
        except Exception:
            pass

        # 2) Repli Desktop hors-ligne (les autres plateformes n'ont pas de profil codé
        #    en dur : on reprend alors le comportement natif de la lib).
        if target == "desktop":
            return _build_desktop_fallback()
        return await original_default(cls, session, proxy=proxy, proxy_auth=proxy_auth)

    Headers.default = classmethod(_patched_default)
    discord.utils.Headers.default = Headers.default
