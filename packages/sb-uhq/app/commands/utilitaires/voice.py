"""voice — présence permanente en salon vocal + streaming de musique.

Deux volets :
- « Salon Vocal » : présence visible dans le salon configuré, jamais en
  sourdine ni muet (``self_deaf=False`` / ``self_mute=False``), maintenue
  quoi qu'il arrive à la connexion (kick vocal, coupure réseau, resume ou
  re-identify gateway, crash du serveur vocal Discord).
- « Musique » : stream d'un fichier audio local (tout format décodé par
  ffmpeg) dans ce salon, avec volume (0–200 %) et lecture en boucle. Le
  fichier vient soit d'un upload Discord (téléchargé dans ``data/audio/``),
  soit d'un chemin sur l'hôte.

Technique de présence (résultat d'une lecture complète de discord.py-self) :
ce qui rend un compte visible dans un salon vocal, c'est UNIQUEMENT son
voice state côté serveur, créé par l'opcode 4 (VOICE_STATE_UPDATE) envoyé
sur la gateway principale. La connexion au serveur vocal (websocket vocal
+ UDP) ne sert qu'à transporter l'audio — et c'est de loin la couche la
plus fragile : dans ``discord/voice_state.py``, tout échec de handshake,
timeout, rate-limit (4021) ou hoquet réseau du websocket vocal finit par
``disconnect()`` → op4 ``channel=None`` → le compte QUITTE le salon à la
vue de tous. C'est ce qui cassait les streaks vocaux.

D'où la règle appliquée ici :
- sans musique, AUCUN ``VoiceClient`` n'est créé — la présence est un op4
  brut (``client.ws.voice_state``), sans couche média donc sans aucun
  chemin interne de « leave » ;
- le voice state survit côté Discord aux coupures gateway resumables (la
  session reste vivante pendant la fenêtre de resume) — on ne touche à
  rien dans ce cas ;
- seule une session ré-identifiée (READY après invalidation) perd le voice
  state : la présence est ré-assertée immédiatement à CHAQUE ``on_ready``
  (pas seulement le premier), à chaque ``on_resumed``, à chaque
  ``voice_state_update`` nous concernant, par un watchdog (30 s) qui
  compare le cache au salon cible, et par une ré-assertion périodique
  inconditionnelle (idempotente, invisible pour les autres) en filet ;
- le ``VoiceClient`` n'existe que pendant la lecture de musique ; s'il
  meurt, la présence op4 reprend en quelques secondes ;
- pendant la musique, le ``VoiceClient`` se reconnecte SEUL (``reconnect=
  True``) : ses hoquets réseau se résument le plus souvent en silence (op4
  intact). On ne le double PAS avec nos propres reconnexions — le
  ``channel=None`` transitoire qu'il émet lors de SA reconnexion générique
  n'est pas traité comme un kick, et le watchdog attend qu'il ait
  réellement disparu avant d'intervenir. Sinon nos reconnexions entrent en
  collision avec les siennes → boucle de leave/join ;
- si le ``VoiceClient`` meurt POUR DE BON (close 4014 : Discord ne reçoit
  pas notre audio UDP — typique d'un hôte dont l'UDP sortant est bloqué,
  drops réguliers ~30 s), le streak passe avant la musique : on ré-assère
  la présence op4 immédiatement (visible, sans UDP) et on RETENTE la
  connexion complète en back-off (15 s → 5 min) au lieu de relancer un
  ``VoiceClient`` qui retomberait aussitôt. Sur un tel hôte la musique
  n'est donc que best-effort, mais la présence — et le streak — tiennent ;
- après un re-identify, ``ConnectionState.clear()`` oublie le
  ``VoiceClient`` sans l'arrêter : ce zombie finirait par envoyer un op4
  ``channel=None`` sur la NOUVELLE gateway (sa boucle de reconnexion ne
  reçoit plus jamais ses événements et abandonne) — il est neutralisé à
  chaque ``on_ready``.

Dépendances voix (musique uniquement) : PyNaCl (pip) + ffmpeg et libopus
(paquets système).
"""

from __future__ import annotations

import asyncio
import re
import shutil
import time
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

# Ré-assertion op4 inconditionnelle toutes les N itérations du watchdog
# (30 s chacune) : filet contre un cache désynchronisé après un resume où
# des événements auraient été perdus. Un op4 « join » vers le salon où l'on
# est déjà ne produit aucun leave/join visible pour les autres.
_REASSERT_TICKS = 20  # ~10 min

_DEFAULT = {
    "enabled": False,       # présence vocale souhaitée
    "channelId": None,      # salon vocal configuré
    "guildId": None,        # serveur du salon — persisté pour ré-asserter l'op4 sans dépendre du cache
    "joinedAt": None,       # epoch (s) du début de la présence continue en cours
    "music": {
        "file": None,       # chemin absolu du fichier audio
        "volume": 100,      # 0–200 (%)
        "loop": False,
        "playing": False,   # lecture souhaitée (reprise auto après reconnexion)
    },
}

_recover_task: asyncio.Task | None = None
_watchdog_task: asyncio.Task | None = None
_current_source: discord.PCMVolumeTransformer | None = None
# Dernier VoiceClient créé par nous — pour repérer les zombies après un re-identify.
_last_vc: discord.VoiceClient | None = None
# Invalide les callbacks `after` des lectures précédentes (stop/remplacement).
_play_generation = 0

# Diagnostic (mémoire process) : coupures de présence détectées et ré-assertions.
_drops = 0
_last_drop_at: int | None = None
_asserts = 0

# Musique : back-off des tentatives de connexion COMPLÈTE (ws vocal + UDP)
# quand l'hôte ne tient pas la couche UDP (drops réguliers ~30 s = paquets
# Opus qui ne passent pas, Discord ferme en 4014). Entre deux tentatives, la
# présence est maintenue en op4 pur (visible, sans audio) : le streak vocal
# passe avant la continuité de la musique.
_music_fail_count = 0
_music_retry_at = 0.0
_music_live = False  # on croit une connexion musique complète établie (garde le back-off à un cran par drop)
_MUSIC_BACKOFF_MAX = 300.0  # 15 → 30 → 60 → 120 → 240 → 300 s (plafond)


def _music_ok() -> None:
    """La couche musique tient : on remet le back-off à zéro."""
    global _music_fail_count, _music_retry_at
    _music_fail_count = 0
    _music_retry_at = 0.0


def _music_defer() -> float:
    """La couche musique est tombée : espace la prochaine tentative complète."""
    global _music_fail_count, _music_retry_at
    _music_fail_count += 1
    delay = min(15.0 * (2 ** (_music_fail_count - 1)), _MUSIC_BACKOFF_MAX)
    _music_retry_at = time.time() + delay
    return delay


def _music_retry_ready() -> bool:
    return time.time() >= _music_retry_at


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


def _music_wanted(cfg: dict) -> bool:
    return bool(cfg["music"]["playing"] and cfg["music"]["file"])


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


def _kill_zombie_vc(vc) -> None:
    """Neutralise un VoiceClient oublié par ``ConnectionState.clear()``.

    Après un re-identify, le state ne connaît plus ce client mais ses tâches
    internes tournent encore : sa boucle ``_poll_voice_ws`` va tenter une
    reconnexion, ne jamais recevoir ses événements (désenregistré), puis
    abandonner en envoyant un op4 ``channel=None`` sur la nouvelle gateway —
    ce qui nous éjecterait du salon APRÈS notre re-join. On annule ses tâches
    avant qu'il n'en ait l'occasion (attributs privés de discord.py-self 2.1,
    accès best-effort).
    """
    try:
        vc.stop()
    except Exception:  # noqa: BLE001
        pass
    conn = getattr(vc, "_connection", None)
    for attr in ("_connector", "_runner"):
        task = getattr(conn, attr, None)
        try:
            if task is not None:
                task.cancel()
        except Exception:  # noqa: BLE001
            pass
    try:
        reader = getattr(conn, "_socket_reader", None)
        if reader is not None:
            reader.stop()
    except Exception:  # noqa: BLE001
        pass
    try:
        sock = getattr(conn, "socket", None)
        if sock:
            sock.close()
    except Exception:  # noqa: BLE001
        pass


# ── Connexion vocale complète (musique uniquement) ───────────────────────────

async def _connect(client) -> discord.VoiceClient:
    global _last_vc
    cfg = _load()
    if not _deps()["nacl"]:
        raise ValueError("PyNaCl manquant — relance `npm run setup:selfbot` pour installer les dépendances voix.")
    channel = await _resolve_channel(client, cfg.get("channelId"))
    vc = _current_vc(client)
    if vc and vc.is_connected():
        _last_vc = vc
        if getattr(vc.channel, "id", None) == channel.id:
            return vc
        await vc.move_to(channel)
        return vc
    if vc:
        # Client vocal fantôme (déconnexion non nettoyée) : on repart de zéro.
        await vc.disconnect(force=True)
    # Ni sourdine ni muet : aucune icône casque/micro barré visible.
    _last_vc = await channel.connect(self_deaf=False, self_mute=False, reconnect=True)
    return _last_vc


# ── Maintien de la présence ──────────────────────────────────────────────────

async def _note_presence_lost(client, cfg: dict, vc) -> None:
    """La présence a chuté : ré-assère l'op4 tout de suite (priorité au streak).

    Point d'entrée unique appelé par ``handle_voice_state_update`` ET le
    watchdog — ainsi le back-off musique n'avance que d'un cran par drop réel,
    quel que soit celui qui le détecte en premier (course callback ``after`` /
    echo gateway / watchdog).

    ``vc`` : le VoiceClient courant vu par l'appelant. ``None`` = teardown
    complet (close 4014, la couche UDP a lâché) → back-off musique. Non-``None``
    = reconnexion interne encore en cours → on pose juste l'op4 pour rester
    visible pendant le trou, sans toucher au back-off (elle se soigne seule).
    """
    global _music_live
    _mark_dropped()
    cfg = await _ensure_guild_id(client, cfg)
    await _gateway_join(client, cfg)  # redevenir visible immédiatement (sans UDP)
    _mark_present(cfg)
    if vc is None and _music_wanted(cfg) and _music_live:
        _music_live = False
        delay = _music_defer()
        hint = (" — l'hôte n'arrive pas à tenir la couche audio UDP (souvent : UDP "
                "sortant bloqué/filtré). La présence tient, la musique reste best-effort."
                if _music_fail_count >= 3 else "")
        log(f"[VOICE] ⚠️ Couche musique tombée (UDP) — présence op4 maintenue, "
            f"nouvelle tentative musique dans {int(delay)}s.{hint}")
    elif not _music_wanted(cfg):
        log("[VOICE] ⚠️ Sorti du salon — présence op4 ré-assertée immédiatement.")


async def _assert_presence(client, cfg: dict) -> str:
    """Rétablit la présence vocale, par la voie la plus robuste disponible.

    Retourne le mode utilisé : « udp » (VoiceClient complet, exigé par la
    musique) ou « gateway » (op4 pur, aucun chemin de leave interne).
    """
    cfg = await _ensure_guild_id(client, cfg)
    vc = _current_vc(client)
    if vc and vc.is_connected() and str(getattr(vc.channel, "id", "")) == str(cfg["channelId"]):
        _mark_present(cfg)
        return "udp"
    # La musique exige la couche UDP. Si l'hôte la tient, on (re)monte la
    # connexion complète ; si elle vient d'échouer (back-off en cours), on ne
    # s'acharne pas et on se rabat sur la présence op4 pour rester visible.
    if _music_wanted(cfg) and _music_retry_ready():
        try:
            vc = await _connect(client)
            if not (vc.is_playing() or vc.is_paused()):
                await _start_playback(client, _load(), announce=False)
            _mark_present(cfg)
            return "udp"
        except Exception as err:  # noqa: BLE001
            delay = _music_defer()
            logerr(f"[VOICE] Connexion musique impossible ({err}) — présence op4 en attendant, "
                   f"nouvel essai musique dans {int(delay)}s.")
    # Présence op4 pure (musique désactivée, en back-off, ou connexion échouée).
    await _gateway_join(client, cfg)
    _mark_present(cfg)
    return "gateway"


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
            mode = await _assert_presence(client, cfg)
            label = "connexion complète (musique)" if mode == "udp" else "gateway (op4)"
            log(f"[VOICE] 🔄 Présence vocale rétablie — {label}.")
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
    music_good_ticks = 0
    while True:
        await asyncio.sleep(30)
        tick += 1
        try:
            cfg = _load()
            if not cfg["enabled"] or not cfg["channelId"]:
                music_good_ticks = 0
                continue
            vc = _current_vc(client)
            vc_ok = bool(vc and vc.is_connected()
                         and str(getattr(vc.channel, "id", "")) == str(cfg["channelId"]))
            if _music_wanted(cfg):
                if vc_ok:
                    # La couche musique tient. Ne remet le back-off à zéro qu'après
                    # une stabilité réelle (~2 min) : sur un hôte qui lâche l'UDP
                    # toutes les 30 s, le back-off continue ainsi de grandir au lieu
                    # de repartir de zéro à chaque reconnexion éphémère.
                    music_good_ticks += 1
                    if music_good_ticks >= 4:
                        _music_ok()
                    # Connexion revenue mais lecture arrêtée (après un reconnect
                    # interne le player ne repart pas seul) → relancer la lecture.
                    if not (vc.is_playing() or vc.is_paused()):
                        try:
                            await _start_playback(client, _load(), announce=False)
                        except Exception as err:  # noqa: BLE001
                            logerr(f"[VOICE] Relance de la lecture impossible : {err}")
                    continue
                music_good_ticks = 0
                if vc is not None:
                    # Reconnexion interne de discord.py-self encore en cours → on la
                    # laisse cicatriser (ne pas la doubler).
                    continue
                # Plus de VoiceClient.
                if _music_live:
                    # Une connexion musique est tombée sans avoir été comptabilisée
                    # (course : echo channel=None reçu avant le nettoyage du client,
                    # le handler a alors sauté le back-off). On la solde ici → op4 +
                    # cran de back-off, pour ne pas reconnecter en boucle.
                    await _note_presence_lost(client, cfg, None)
                elif not _presence_ok(client, cfg):
                    # Plus visible du tout et musique déjà en back-off → ré-asserter l'op4.
                    await _note_presence_lost(client, cfg, None)
                elif _music_retry_ready():
                    # Visible en op4 et le back-off est écoulé → retenter la connexion
                    # complète (musique).
                    _schedule_recover(client, 0)
                # sinon : visible en op4, musique en back-off → on ne touche à rien.
                continue
            music_good_ticks = 0
            if vc_ok:
                continue
            if not _presence_ok(client, cfg):
                _schedule_recover(client, 0)
            elif tick % _REASSERT_TICKS == 0:
                await _gateway_join(client, cfg)
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
    global _current_source, _music_live
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
    _music_live = True  # couche musique établie : le prochain drop déclenchera un cran de back-off
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
    # Le player s'arrête AUSSI quand la connexion vocale tombe (Discord ferme le
    # VoiceClient → thread audio terminé → ce callback). Dans ce cas la piste
    # n'est pas « finie » : ne PAS relancer la lecture ici, sinon on recrée un
    # VoiceClient en contournant le back-off (boucle de reconnexion). La reprise
    # (op4 immédiat + musique en back-off) est gérée par handle_voice_state_update
    # et le watchdog. On ne rejoue en boucle que si la connexion est bien vivante.
    vc = _current_vc(client)
    if vc is None or not vc.is_connected():
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
    global _music_live
    _music_live = False
    _bump_generation()
    vc = _current_vc(client)
    if vc and (vc.is_playing() or vc.is_paused()):
        vc.stop()


# ── État renvoyé au panel ────────────────────────────────────────────────────

async def _state(client) -> dict:
    cfg = _load()
    vc = _current_vc(client)
    vc_ok = bool(vc and vc.is_connected())
    gateway_ok = _presence_ok(client, cfg)
    connected = vc_ok or gateway_ok
    channel = vc.channel if vc_ok else None
    channel_name = getattr(channel, "name", None)
    guild_name = getattr(getattr(channel, "guild", None), "name", None)
    if not channel_name and cfg["channelId"]:
        resolved = await fetch_channel(client, cfg["channelId"])
        channel_name = getattr(resolved, "name", None)
        guild_name = getattr(getattr(resolved, "guild", None), "name", None)
    music_file = cfg["music"]["file"]
    playing = bool(vc and vc.is_playing())
    # Musique voulue mais audio pas en cours = en attente de reconnexion (back-off).
    music_pending = bool(_music_wanted(cfg) and not playing)
    retry_in = max(0, int(_music_retry_at - time.time())) if music_pending else 0
    return {
        "enabled": cfg["enabled"],
        "channelId": cfg["channelId"],
        "channelName": channel_name,
        "guildName": guild_name,
        "connected": connected,
        "playing": playing,
        "presence": {
            "mode": "udp" if vc_ok else ("gateway" if gateway_ok else None),
            "joinedAt": cfg.get("joinedAt"),
            "drops": _drops,
            "lastDropAt": _last_drop_at,
        },
        "music": {
            "file": Path(music_file).name if music_file else None,
            "filePath": music_file,
            "volume": cfg["music"]["volume"],
            "loop": cfg["music"]["loop"],
            "pending": music_pending,
            "retryIn": retry_in,
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
            cfg["music"]["playing"] = False
            _save(cfg)
            _stop_playback(client)
            vc = _current_vc(client)
            if vc:
                await vc.disconnect(force=True)  # envoie déjà l'op4 channel=None
            else:
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
            _music_ok()  # (re)connexion manuelle : tentative musique immédiate
            mode = await _assert_presence(client, _load())
            label = "connexion complète (musique)" if mode == "udp" else "gateway (op4)"
            log(f"[VOICE] 🟢 Présent dans le salon vocal — {label}.")
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
        _music_ok()  # action manuelle : on réessaie tout de suite, back-off remis à zéro
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
    """À appeler à CHAQUE ready — une session ré-identifiée perd son voice state."""
    global _watchdog_task, _last_vc
    # Neutralise un éventuel VoiceClient zombie de la session précédente
    # (oublié par ConnectionState.clear() lors du re-identify).
    if _last_vc is not None and _last_vc not in list(getattr(client, "voice_clients", None) or []):
        _kill_zombie_vc(_last_vc)
        _last_vc = None
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
    # Déconnecté ou déplacé hors du salon configuré.
    if after.channel is None or str(after.channel.id) != str(cfg["channelId"]):
        vc = _current_vc(client)
        # VoiceClient sain et connecté = event spurieux/obsolète → rien à faire.
        if vc is not None and vc.is_connected():
            return
        # Présence perdue. PRIORITÉ AU STREAK : ré-assertion op4 INSTANTANÉE (sous
        # la seconde, sans UDP). Si le VoiceClient a totalement disparu (vc None =
        # close 4014, UDP qui ne passe pas), la musique passe en back-off au lieu
        # de relancer aussitôt un client qui retomberait dans ~30 s ; s'il est
        # encore là (reconnexion interne en cours), on pose juste l'op4 pour
        # rester visible pendant le trou et on la laisse se soigner.
        try:
            await _note_presence_lost(client, cfg, vc)
        except Exception as err:  # noqa: BLE001
            logerr(f"[VOICE] Ré-assertion op4 impossible ({err}) — reprise via watchdog.")
            _schedule_recover(client)
        return
    # Sourdine/muet activés (autre client, mauvaise manip) → on les retire.
    if after.self_mute or after.self_deaf:
        try:
            await after.channel.guild.change_voice_state(
                channel=after.channel, self_mute=False, self_deaf=False)
        except Exception as err:  # noqa: BLE001
            logerr(f"[VOICE] Impossible de retirer mute/sourdine : {err}")
