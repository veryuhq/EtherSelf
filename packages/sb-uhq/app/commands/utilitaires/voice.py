"""voice — présence permanente en salon vocal + streaming de musique.

Deux volets :
- « Salon Vocal » : connexion au salon configuré, jamais en sourdine ni muet
  (``self_deaf=False`` / ``self_mute=False``), reconnexion automatique au
  démarrage et à chaque déconnexion (kick vocal, coupure réseau, resume
  gateway) pour rester visible en vocal sans « leave » apparent.
- « Musique » : stream d'un fichier audio local (tout format décodé par
  ffmpeg) dans ce salon, avec volume (0–200 %) et lecture en boucle. Le
  fichier vient soit d'un upload Discord (téléchargé dans ``data/audio/``),
  soit d'un chemin sur l'hôte.

Dépendances voix : PyNaCl (pip) + ffmpeg et libopus (paquets système).
"""

from __future__ import annotations

import asyncio
import re
import shutil
from pathlib import Path

import aiohttp
import discord

from ...func.data_path import SB_ROOT, data_path, read_json, write_json
from ...func.discord_util import fetch_channel
from ...func.logbus import log, logerr

VOICE_FILE = data_path("config", "voice.json")
AUDIO_DIR = data_path("audio")

# Taille max d'un fichier musique téléchargé depuis Discord (500 Mo).
_MAX_DOWNLOAD_BYTES = 500 * 1024 * 1024

_DEFAULT = {
    "enabled": False,       # connexion vocale souhaitée
    "channelId": None,      # salon vocal configuré
    "music": {
        "file": None,       # chemin absolu du fichier audio
        "volume": 100,      # 0–200 (%)
        "loop": False,
        "playing": False,   # lecture souhaitée (reprise auto après reconnexion)
    },
}

_reconnect_task: asyncio.Task | None = None
_watchdog_task: asyncio.Task | None = None
_current_source: discord.PCMVolumeTransformer | None = None
# Invalide les callbacks `after` des lectures précédentes (stop/remplacement).
_play_generation = 0


def _load() -> dict:
    data = read_json(VOICE_FILE, {})
    merged = {**_DEFAULT, **data}
    merged["music"] = {**_DEFAULT["music"], **(data.get("music") or {})}
    return merged


def _save(data: dict) -> None:
    write_json(VOICE_FILE, data)


def _deps() -> dict:
    try:
        import nacl  # noqa: F401
        has_nacl = True
    except ImportError:
        has_nacl = False
    return {"nacl": has_nacl, "ffmpeg": shutil.which("ffmpeg") is not None}


def _clamp_volume(value) -> int:
    try:
        vol = int(value)
    except (TypeError, ValueError):
        vol = 100
    return max(0, min(vol, 200))


def _current_vc(client) -> discord.VoiceClient | None:
    clients = list(getattr(client, "voice_clients", None) or [])
    return clients[0] if clients else None


def _bump_generation() -> int:
    global _play_generation
    _play_generation += 1
    return _play_generation


# ── Connexion vocale ─────────────────────────────────────────────────────────

async def _resolve_channel(client, channel_id):
    channel = await fetch_channel(client, channel_id)
    if channel is None:
        raise ValueError("Salon vocal introuvable — vérifie l'ID.")
    if not isinstance(channel, (discord.VoiceChannel, discord.StageChannel)):
        raise ValueError("Le salon configuré n'est pas un salon vocal.")
    return channel


async def _connect(client) -> discord.VoiceClient:
    cfg = _load()
    if not _deps()["nacl"]:
        raise ValueError("PyNaCl manquant — relance `npm run setup:selfbot` pour installer les dépendances voix.")
    channel = await _resolve_channel(client, cfg.get("channelId"))
    vc = _current_vc(client)
    if vc and vc.is_connected():
        if getattr(vc.channel, "id", None) == channel.id:
            return vc
        await vc.move_to(channel)
        return vc
    if vc:
        # Client vocal fantôme (déconnexion non nettoyée) : on repart de zéro.
        await vc.disconnect(force=True)
    # Ni sourdine ni muet : aucune icône casque/micro barré visible.
    return await channel.connect(self_deaf=False, self_mute=False, reconnect=True)


def _schedule_reconnect(client, delay: float = 2.0) -> None:
    global _reconnect_task
    if _reconnect_task and not _reconnect_task.done():
        return
    _reconnect_task = asyncio.get_event_loop().create_task(_reconnect_loop(client, delay))


async def _reconnect_loop(client, delay: float) -> None:
    await asyncio.sleep(delay)
    backoff = 5.0
    while True:
        cfg = _load()
        if not cfg["enabled"] or not cfg["channelId"]:
            return
        try:
            vc = await _connect(client)
            log(f"[VOICE] 🔄 Reconnecté au salon vocal « {getattr(vc.channel, 'name', cfg['channelId'])} ».")
            if cfg["music"]["playing"] and cfg["music"]["file"]:
                await _start_playback(client, _load())
            return
        except Exception as err:  # noqa: BLE001
            logerr(f"[VOICE] Reconnexion échouée : {err} — nouvel essai dans {int(backoff)}s.")
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60.0)


async def _watchdog(client) -> None:
    # Filet de sécurité : les events voice peuvent être manqués après un resume
    # gateway ; on revérifie la connexion régulièrement.
    while True:
        await asyncio.sleep(30)
        try:
            cfg = _load()
            if not cfg["enabled"] or not cfg["channelId"]:
                continue
            vc = _current_vc(client)
            if not vc or not vc.is_connected():
                _schedule_reconnect(client, 0)
        except Exception as err:  # noqa: BLE001
            logerr(f"[VOICE] Watchdog : {err}")


# ── Musique ──────────────────────────────────────────────────────────────────

def _safe_filename(name) -> str:
    base = Path(str(name or "musique")).name
    cleaned = re.sub(r"[^\w.\-() ]", "_", base).strip() or "musique"
    return cleaned[:120]


async def _download_music(url: str, filename) -> Path:
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    dest = AUDIO_DIR / _safe_filename(filename)
    timeout = aiohttp.ClientTimeout(total=300)
    try:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(url) as resp:
                if resp.status != 200:
                    raise ValueError(f"Téléchargement du fichier impossible (HTTP {resp.status}).")
                size = 0
                with open(dest, "wb") as fh:
                    async for chunk in resp.content.iter_chunked(64 * 1024):
                        size += len(chunk)
                        if size > _MAX_DOWNLOAD_BYTES:
                            raise ValueError("Fichier audio trop volumineux (max 500 Mo).")
                        fh.write(chunk)
    except Exception:
        dest.unlink(missing_ok=True)
        raise
    return dest


def _resolve_file_path(raw: str) -> Path:
    path = Path(raw).expanduser()
    if not path.is_absolute():
        path = SB_ROOT / path
    if not path.is_file():
        raise ValueError(f"Fichier audio introuvable : {path}")
    return path


def _make_source(path: Path, volume: int) -> discord.PCMVolumeTransformer:
    source = discord.FFmpegPCMAudio(str(path))
    return discord.PCMVolumeTransformer(source, volume=_clamp_volume(volume) / 100)


async def _start_playback(client, cfg: dict, *, announce: bool = True) -> None:
    global _current_source
    if not _deps()["ffmpeg"]:
        raise ValueError("ffmpeg introuvable sur l'hôte — installe-le pour streamer de la musique.")
    path = Path(cfg["music"]["file"] or "")
    if not path.is_file():
        raise ValueError(f"Fichier audio introuvable : {path}")
    vc = await _connect(client)
    generation = _bump_generation()
    if vc.is_playing() or vc.is_paused():
        vc.stop()
    source = _make_source(path, cfg["music"]["volume"])
    _current_source = source
    loop_ref = asyncio.get_running_loop()

    def _after(err) -> None:
        # Appelé depuis le thread du player audio → retour dans l'event loop.
        if err:
            logerr(f"[VOICE] Lecture interrompue : {err}")
        asyncio.run_coroutine_threadsafe(_on_track_end(client, generation), loop_ref)

    vc.play(source, after=_after)
    # Pas de log à chaque tour de boucle : seul le lancement initial (et la
    # reprise après reconnexion) est annoncé, sinon le controller est spammé.
    if announce:
        log(f"[VOICE] 🎵 Lecture de « {path.name} » (volume {cfg['music']['volume']} %"
            f"{', en boucle' if cfg['music']['loop'] else ''}).")


async def _on_track_end(client, generation: int) -> None:
    if generation != _play_generation:
        return  # lecture remplacée ou stoppée entre-temps
    cfg = _load()
    if not cfg["music"]["playing"]:
        return
    if cfg["music"]["loop"] and cfg["music"]["file"]:
        try:
            await _start_playback(client, cfg, announce=False)
        except Exception as err:  # noqa: BLE001
            logerr(f"[VOICE] Relance de la boucle impossible : {err}")
    else:
        cfg["music"]["playing"] = False
        _save(cfg)


def _stop_playback(client) -> None:
    _bump_generation()
    vc = _current_vc(client)
    if vc and (vc.is_playing() or vc.is_paused()):
        vc.stop()


# ── État renvoyé au panel ────────────────────────────────────────────────────

async def _state(client) -> dict:
    cfg = _load()
    vc = _current_vc(client)
    connected = bool(vc and vc.is_connected())
    channel = vc.channel if connected else None
    channel_name = getattr(channel, "name", None)
    guild_name = getattr(getattr(channel, "guild", None), "name", None)
    if not channel_name and cfg["channelId"]:
        resolved = await fetch_channel(client, cfg["channelId"])
        channel_name = getattr(resolved, "name", None)
        guild_name = getattr(getattr(resolved, "guild", None), "name", None)
    music_file = cfg["music"]["file"]
    return {
        "enabled": cfg["enabled"],
        "channelId": cfg["channelId"],
        "channelName": channel_name,
        "guildName": guild_name,
        "connected": connected,
        "playing": bool(vc and vc.is_playing()),
        "music": {
            "file": Path(music_file).name if music_file else None,
            "filePath": music_file,
            "volume": cfg["music"]["volume"],
            "loop": cfg["music"]["loop"],
        },
        "deps": _deps(),
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
        await _resolve_channel(client, channel_id)
        cfg = _load()
        cfg["channelId"] = channel_id
        _save(cfg)
        if cfg["enabled"]:
            await _connect(client)  # déplacement immédiat si déjà connecté ailleurs
        return await _state(client)

    if action == "toggle":
        cfg = _load()
        if cfg["enabled"]:
            cfg["enabled"] = False
            cfg["music"]["playing"] = False
            _save(cfg)
            _stop_playback(client)
            vc = _current_vc(client)
            if vc:
                await vc.disconnect(force=True)
            log("[VOICE] 🔴 Déconnecté du salon vocal.")
        else:
            if not cfg["channelId"]:
                raise ValueError("Configure d'abord un salon vocal.")
            cfg["enabled"] = True
            _save(cfg)
            vc = await _connect(client)
            log(f"[VOICE] 🟢 Connecté au salon vocal « {getattr(vc.channel, 'name', '')} ».")
        return await _state(client)

    if action == "music.play":
        cfg = _load()
        if not cfg["channelId"]:
            raise ValueError("Configure d'abord un salon vocal.")
        file_url = payload.get("fileUrl")
        file_path = payload.get("filePath")
        if file_url:
            path = await _download_music(file_url, payload.get("fileName"))
        elif file_path:
            path = _resolve_file_path(str(file_path))
        elif cfg["music"]["file"]:
            path = _resolve_file_path(cfg["music"]["file"])  # relance le dernier fichier
        else:
            raise ValueError("Fournis un fichier audio (upload) ou un chemin sur l'hôte.")
        cfg["music"]["file"] = str(path)
        if payload.get("volume") is not None:
            cfg["music"]["volume"] = _clamp_volume(payload.get("volume"))
        if payload.get("loop") is not None:
            cfg["music"]["loop"] = bool(payload.get("loop"))
        cfg["music"]["playing"] = True
        cfg["enabled"] = True  # jouer implique être connecté
        _save(cfg)
        await _start_playback(client, cfg)
        return await _state(client)

    if action == "music.stop":
        cfg = _load()
        cfg["music"]["playing"] = False
        _save(cfg)
        _stop_playback(client)
        return await _state(client)

    if action == "music.setVolume":
        cfg = _load()
        cfg["music"]["volume"] = _clamp_volume(payload.get("volume"))
        _save(cfg)
        if _current_source is not None:
            _current_source.volume = cfg["music"]["volume"] / 100
        return await _state(client)

    if action == "music.toggleLoop":
        cfg = _load()
        cfg["music"]["loop"] = not cfg["music"]["loop"]
        _save(cfg)
        return await _state(client)

    raise ValueError(f"Action voice inconnue : '{action}'")


# ── Hooks appelés par main.py ────────────────────────────────────────────────

def on_ready(client) -> None:
    global _watchdog_task
    if _watchdog_task is None or _watchdog_task.done():
        _watchdog_task = asyncio.get_event_loop().create_task(_watchdog(client))
    cfg = _load()
    if cfg["enabled"] and cfg["channelId"]:
        _schedule_reconnect(client, 0)


async def handle_voice_state_update(client, member, before, after) -> None:
    if not client.user or member.id != client.user.id:
        return
    cfg = _load()
    if not cfg["enabled"] or not cfg["channelId"]:
        return
    # Déconnecté ou déplacé hors du salon configuré → retour immédiat.
    if after.channel is None or str(after.channel.id) != str(cfg["channelId"]):
        _schedule_reconnect(client)
        return
    # Sourdine/muet activés (autre client, mauvaise manip) → on les retire.
    if after.self_mute or after.self_deaf:
        try:
            await after.channel.guild.change_voice_state(
                channel=after.channel, self_mute=False, self_deaf=False)
        except Exception as err:  # noqa: BLE001
            logerr(f"[VOICE] Impossible de retirer mute/sourdine : {err}")
