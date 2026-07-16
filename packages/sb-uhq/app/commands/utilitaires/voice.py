"""voice — présence permanente en salon vocal (op4 gateway pur).

Maintient le compte visible dans un salon vocal, jamais en sourdine ni muet,
sans jamais transporter d'audio.

Ce qui rend un compte visible dans un salon vocal, c'est UNIQUEMENT son voice
state côté serveur, créé par l'opcode 4 (VOICE_STATE_UPDATE) envoyé sur la
gateway principale. La connexion au serveur vocal (websocket vocal + UDP) ne
sert qu'à transporter l'audio — et c'est la couche la plus fragile : le
moindre échec/timeout/rate-limit finit par un op4 ``channel=None`` (leave
visible de tous), et sur un hôte qui filtre l'UDP sortant elle ne tient de
toute façon pas. On n'ouvre donc AUCUN ``VoiceClient`` : la présence est un
op4 brut, sans couche média, donc sans aucun chemin interne de « leave » et
insensible aux problèmes réseau UDP.

Règles de maintien :
- présence posée par un op4 brut (``client.ws.voice_state``) ;
- le voice state survit côté Discord aux coupures gateway resumables (la
  session reste vivante pendant la fenêtre de resume) — rien à faire alors ;
- seule une session ré-identifiée (READY après invalidation) perd le voice
  state : il est ré-asserté à CHAQUE ``on_ready`` (pas seulement le premier),
  à chaque ``on_resumed``, à chaque ``voice_state_update`` nous concernant,
  par un watchdog (30 s) qui compare le cache au salon cible, et par une
  ré-assertion périodique inconditionnelle (idempotente, invisible pour les
  autres) en filet.

Aucune dépendance voix (PyNaCl, ffmpeg, libopus) n'est requise.
"""

from __future__ import annotations

import asyncio
import time

import discord

from ...func.data_path import data_path, read_json, write_json
from ...func.discord_util import fetch_channel
from ...func.logbus import log, logerr

VOICE_FILE = data_path("config", "voice.json")

# Ré-assertion op4 inconditionnelle toutes les N itérations du watchdog
# (30 s chacune) : filet contre un cache désynchronisé après un resume où des
# événements auraient été perdus. Un op4 « join » vers le salon où l'on est
# déjà ne produit aucun leave/join visible pour les autres.
_REASSERT_TICKS = 20  # ~10 min

_DEFAULT = {
    "enabled": False,       # présence vocale souhaitée
    "channelId": None,      # salon vocal configuré
    "guildId": None,        # serveur du salon — persisté pour ré-asserter l'op4 sans dépendre du cache
    "joinedAt": None,       # epoch (s) du début de la présence continue en cours
}

_recover_task: asyncio.Task | None = None
_watchdog_task: asyncio.Task | None = None

# Diagnostic (mémoire process) : coupures de présence détectées et ré-assertions.
_drops = 0
_last_drop_at: int | None = None
_asserts = 0


def _load() -> dict:
    # On ne conserve que les clés connues : nettoie au passage un éventuel
    # ancien bloc « music » d'une config antérieure au retrait du module.
    data = read_json(VOICE_FILE, {})
    return {k: data.get(k, v) for k, v in _DEFAULT.items()}


def _save(data: dict) -> None:
    write_json(VOICE_FILE, data)


# ── Présence gateway (op4) ───────────────────────────────────────────────────

async def _resolve_channel(client, channel_id):
    channel = await fetch_channel(client, channel_id)
    if channel is None:
        raise ValueError("Salon vocal introuvable — vérifie l'ID.")
    if not isinstance(channel, (discord.VoiceChannel, discord.StageChannel)):
        raise ValueError("Le salon configuré n'est pas un salon vocal.")
    return channel


async def _ensure_guild_id(client, cfg: dict) -> dict:
    """Complète (et persiste) le guildId des configs antérieures à ce champ."""
    if not cfg.get("guildId") and cfg.get("channelId"):
        channel = await _resolve_channel(client, cfg["channelId"])
        cfg["guildId"] = str(channel.guild.id)
        _save(cfg)
    return cfg


async def _gateway_join(client, cfg: dict) -> None:
    """Op4 « join » brut sur la gateway — la présence pure, sans couche média.

    ``DiscordWebSocket.voice_state`` ajoute de lui-même les régions RTC
    préférées au payload, comme le client officiel.
    """
    ws = getattr(client, "ws", None)
    if ws is None:
        raise ValueError("Gateway indisponible (client pas encore connecté).")
    await ws.voice_state(int(cfg["guildId"]), int(cfg["channelId"]), self_mute=False, self_deaf=False)


async def _gateway_leave(client, cfg: dict) -> None:
    ws = getattr(client, "ws", None)
    if ws is not None and cfg.get("guildId"):
        await ws.voice_state(int(cfg["guildId"]), None)


def _presence_ok(client, cfg: dict) -> bool:
    """Vérité serveur (vue du cache) : sommes-nous dans le salon configuré ?"""
    if not cfg.get("guildId") or not cfg.get("channelId"):
        return False
    guild = client.get_guild(int(cfg["guildId"]))
    me = getattr(guild, "me", None)
    voice = getattr(me, "voice", None)
    channel = getattr(voice, "channel", None)
    return channel is not None and str(channel.id) == str(cfg["channelId"])


def _mark_present(cfg: dict) -> None:
    global _asserts
    _asserts += 1
    if not cfg.get("joinedAt"):
        cfg["joinedAt"] = int(time.time())
        _save(cfg)


def _mark_dropped() -> None:
    global _drops, _last_drop_at
    _drops += 1
    _last_drop_at = int(time.time())
    cfg = _load()
    if cfg.get("joinedAt"):
        cfg["joinedAt"] = None
        _save(cfg)


# ── Maintien de la présence ──────────────────────────────────────────────────

async def _assert_presence(client, cfg: dict) -> None:
    """Pose (ou repose) la présence op4 dans le salon configuré."""
    cfg = await _ensure_guild_id(client, cfg)
    await _gateway_join(client, cfg)
    _mark_present(cfg)


def _schedule_recover(client, delay: float = 1.0) -> None:
    global _recover_task
    if _recover_task and not _recover_task.done():
        return
    _recover_task = asyncio.get_event_loop().create_task(_recover_loop(client, delay))


async def _recover_loop(client, delay: float) -> None:
    await asyncio.sleep(delay)
    backoff = 5.0
    while True:
        cfg = _load()
        if not cfg["enabled"] or not cfg["channelId"]:
            return
        try:
            await _assert_presence(client, cfg)
            log("[VOICE] 🔄 Présence vocale rétablie.")
            return
        except Exception as err:  # noqa: BLE001
            logerr(f"[VOICE] Reprise de la présence échouée : {err} — nouvel essai dans {int(backoff)}s.")
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60.0)


async def _watchdog(client) -> None:
    # Filet de sécurité : les events voice peuvent être manqués après un resume
    # gateway ; on revérifie la présence régulièrement, et on la ré-asserte
    # même sans anomalie apparente toutes les _REASSERT_TICKS itérations.
    tick = 0
    while True:
        await asyncio.sleep(30)
        tick += 1
        try:
            cfg = _load()
            if not cfg["enabled"] or not cfg["channelId"]:
                continue
            if not _presence_ok(client, cfg):
                _schedule_recover(client, 0)
            elif tick % _REASSERT_TICKS == 0:
                await _ensure_guild_id(client, cfg)
                await _gateway_join(client, cfg)
        except Exception as err:  # noqa: BLE001
            logerr(f"[VOICE] Watchdog : {err}")


# ── État renvoyé au panel ────────────────────────────────────────────────────

async def _state(client) -> dict:
    cfg = _load()
    gateway_ok = _presence_ok(client, cfg)
    channel_name = None
    guild_name = None
    if cfg["channelId"]:
        resolved = await fetch_channel(client, cfg["channelId"])
        channel_name = getattr(resolved, "name", None)
        guild_name = getattr(getattr(resolved, "guild", None), "name", None)
    return {
        "enabled": cfg["enabled"],
        "channelId": cfg["channelId"],
        "channelName": channel_name,
        "guildName": guild_name,
        "connected": gateway_ok,
        "presence": {
            "mode": "gateway" if gateway_ok else None,
            "joinedAt": cfg.get("joinedAt"),
            "drops": _drops,
            "lastDropAt": _last_drop_at,
        },
    }


# ── Bridge ───────────────────────────────────────────────────────────────────

async def execute(client, payload):
    action = payload.get("action")

    if action == "getState":
        return await _state(client)

    if action == "setChannel":
        channel_id = str(payload.get("channelId") or "").strip()
        if not channel_id.isdigit():
            raise ValueError("ID de salon vocal invalide.")
        channel = await _resolve_channel(client, channel_id)
        cfg = _load()
        cfg["channelId"] = channel_id
        cfg["guildId"] = str(channel.guild.id)
        _save(cfg)
        if cfg["enabled"]:
            await _assert_presence(client, cfg)  # bascule immédiate vers le nouveau salon
        return await _state(client)

    if action == "toggle":
        cfg = _load()
        if cfg["enabled"]:
            cfg["enabled"] = False
            cfg["joinedAt"] = None
            _save(cfg)
            try:
                cfg = await _ensure_guild_id(client, cfg)  # configs antérieures au champ guildId
            except Exception:  # noqa: BLE001
                pass
            await _gateway_leave(client, cfg)
            log("[VOICE] 🔴 Déconnecté du salon vocal.")
        else:
            if not cfg["channelId"]:
                raise ValueError("Configure d'abord un salon vocal.")
            cfg["enabled"] = True
            _save(cfg)
            await _assert_presence(client, _load())
            log("[VOICE] 🟢 Présent dans le salon vocal.")
        return await _state(client)

    raise ValueError(f"Action voice inconnue : '{action}'")


# ── Hooks appelés par main.py ────────────────────────────────────────────────

def on_ready(client) -> None:
    """À appeler à CHAQUE ready — une session ré-identifiée perd son voice state."""
    global _watchdog_task
    if _watchdog_task is None or _watchdog_task.done():
        _watchdog_task = asyncio.get_event_loop().create_task(_watchdog(client))
    cfg = _load()
    if cfg["enabled"] and cfg["channelId"]:
        _schedule_recover(client, 0)


def on_resumed(client) -> None:
    """Après un resume, le voice state survit côté serveur — simple vérification."""
    cfg = _load()
    if cfg["enabled"] and cfg["channelId"] and not _presence_ok(client, cfg):
        _schedule_recover(client, 1.0)


async def handle_voice_state_update(client, member, before, after) -> None:
    if not client.user or member.id != client.user.id:
        return
    cfg = _load()
    if not cfg["enabled"] or not cfg["channelId"]:
        return
    # Déconnecté ou déplacé hors du salon configuré → retour immédiat.
    if after.channel is None or str(after.channel.id) != str(cfg["channelId"]):
        _mark_dropped()
        log("[VOICE] ⚠️ Sorti du salon vocal (kick, déplacement ou coupure) — reprise immédiate.")
        _schedule_recover(client)
        return
    # Sourdine/muet activés (autre client, mauvaise manip) → on les retire.
    if after.self_mute or after.self_deaf:
        try:
            await after.channel.guild.change_voice_state(
                channel=after.channel, self_mute=False, self_deaf=False)
        except Exception as err:  # noqa: BLE001
            logerr(f"[VOICE] Impossible de retirer mute/sourdine : {err}")
