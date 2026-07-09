"""rpc — Rich Presence, Spotify RPC et Custom Status (rotation).

Port de src/self/commands/utilitaires/rpc.js. La logique de configuration est identique ;
seule l'application de la présence utilise l'API discord.py-self (change_presence).

NOTE discord.py-self : discord.js-selfbot exposait des classes dédiées (RichPresence,
SpotifyRPC, CustomStatus). discord.py-self fournit lui aussi une classe dédiée
`discord.Spotify` (cf. examples/spotify_presence.py) que l'on utilise ici pour un rendu
Spotify fidèle ; les Rich Presence classiques et le Custom Status passent respectivement
par discord.Activity / discord.CustomActivity.
"""

from __future__ import annotations

import asyncio
import datetime
import re

import discord

from ...func.data_path import data_path, read_json, write_json
from ...func.logbus import logerr

RPC_FILE = data_path("config", "rpc.json")

ACTIVITY_TYPES = {"playing": 0, "streaming": 1, "listening": 2, "watching": 3, "competing": 5}
_ACTIVITY_ENUM = {
    "playing": discord.ActivityType.playing,
    "streaming": discord.ActivityType.streaming,
    "listening": discord.ActivityType.listening,
    "watching": discord.ActivityType.watching,
    "competing": discord.ActivityType.competing,
}
_STATUS_ENUM = {
    "online": discord.Status.online,
    "idle": discord.Status.idle,
    "dnd": discord.Status.dnd,
    "invisible": discord.Status.invisible,
}

_DEFAULTS = {
    "enabled": False, "mode": "static", "status": "online", "applicationId": None,
    "activities": [], "currentIdx": 0, "intervalSec": 30,
    "customStatuses": [], "csEnabled": False, "csCurrentIdx": 0, "csIntervalSec": 15,
    "spotify": {
        "enabled": False, "songId": None, "albumId": None, "artistIds": [],
        "details": None, "state": None, "applicationId": None, "platform": None, "url": None,
        "assets": {"largeImage": None, "largeText": None, "smallImage": None, "smallText": None},
        "timestamps": {"start": None, "end": None},
    },
}

_activity_task: asyncio.Task | None = None
_cs_task: asyncio.Task | None = None


def _normalize_spotify(raw) -> dict:
    raw = raw or {}
    assets = raw.get("assets") or {}
    ts = raw.get("timestamps") or {}
    return {
        "enabled": bool(raw.get("enabled")),
        "songId": raw.get("songId"),
        "albumId": raw.get("albumId"),
        "artistIds": [a for a in (raw.get("artistIds") or []) if a],
        "details": raw.get("details"),
        "state": raw.get("state"),
        "applicationId": raw.get("applicationId"),
        "platform": raw.get("platform"),
        "url": raw.get("url"),
        "assets": {"largeImage": assets.get("largeImage"), "largeText": assets.get("largeText"),
                   "smallImage": assets.get("smallImage"), "smallText": assets.get("smallText")},
        "timestamps": {"start": ts.get("start"), "end": ts.get("end")},
    }


def load() -> dict:
    raw = read_json(RPC_FILE, None)
    if not raw:
        cfg = dict(_DEFAULTS)
        cfg["spotify"] = _normalize_spotify(_DEFAULTS["spotify"])
        return cfg
    cfg = {**_DEFAULTS, **raw}
    cfg["spotify"] = _normalize_spotify(raw.get("spotify"))
    cleaned = []
    for act in cfg["activities"]:
        if isinstance(act.get("buttons"), list) and len(act["buttons"]) == 0:
            act = {k: v for k, v in act.items() if k != "buttons"}
        cleaned.append(act)
    cfg["activities"] = cleaned
    return cfg


def save(data) -> None:
    write_json(RPC_FILE, data)


def _stop_all():
    global _activity_task, _cs_task
    for task in (_activity_task, _cs_task):
        if task:
            task.cancel()
    _activity_task = None
    _cs_task = None


def _parse_emoji(raw):
    if not raw:
        return None
    if isinstance(raw, dict):
        return discord.PartialEmoji(name=raw.get("name"), id=raw.get("id"),
                                    animated=bool(raw.get("animated")))
    m = re.match(r"^<?(a)?:(\w+):(\d+)>?$", raw)
    if m:
        return discord.PartialEmoji(name=m.group(2), id=int(m.group(3)),
                                    animated=bool(m.group(1)))
    return raw


def _build_rich(act, application_id):
    type_str = act.get("type", "playing")
    kwargs = {
        "type": _ACTIVITY_ENUM.get(type_str, discord.ActivityType.playing),
        "name": act.get("name") or "…",
    }
    if application_id:
        kwargs["application_id"] = int(application_id)
    if act.get("details"):
        kwargs["details"] = act["details"]
    if act.get("state"):
        kwargs["state"] = act["state"]
    if act.get("platform"):
        kwargs["platform"] = act["platform"]

    assets = act.get("assets") or {}
    asset_payload = {}
    if assets.get("largeImage"):
        asset_payload["large_image"] = assets["largeImage"]
    if assets.get("largeText"):
        asset_payload["large_text"] = assets["largeText"]
    if assets.get("smallImage"):
        asset_payload["small_image"] = assets["smallImage"]
    if assets.get("smallText"):
        asset_payload["small_text"] = assets["smallText"]
    if asset_payload:
        kwargs["assets"] = asset_payload

    ts = act.get("timestamps") or {}
    ts_payload = {}
    if ts.get("start"):
        ts_payload["start"] = ts["start"]
    if ts.get("end"):
        ts_payload["end"] = ts["end"]
    if ts_payload:
        kwargs["timestamps"] = ts_payload

    if type_str == "streaming" and act.get("url"):
        return discord.Streaming(name=act.get("name") or "…", url=act["url"])

    buttons = act.get("buttons")
    if type_str != "streaming" and isinstance(buttons, list) and buttons:
        if not application_id:
            logerr("[RPC] ⚠️  Boutons ignorés : applicationId non défini.")
        else:
            kwargs["buttons"] = [b["label"] for b in buttons[:2] if b.get("label") and b.get("url")]

    try:
        return discord.Activity(**kwargs)
    except Exception as e:  # noqa: BLE001
        logerr(f"[RPC] Erreur buildRichPresence : {e}")
        return discord.Activity(type=kwargs["type"], name=act.get("name") or "…")


def _split_artists(state) -> list:
    """Découpe le sous-titre (state) en liste d'artistes (séparateurs , ; retour ligne)."""
    value = str(state or "").strip()
    if not value:
        return []
    return [p.strip() for p in re.split(r"[;\n,]+", value) if p.strip()]


def _build_spotify(spotify, client):
    """Construit une présence Spotify via la classe dédiée `discord.Spotify`.

    Voir dolfies/discord.py-self examples/spotify_presence.py. On mappe la config :
      details          -> title (nom du morceau)
      state            -> artists (découpé)
      songId/albumId   -> track_id / album_id
      artistIds        -> artist_ids
      assets.largeText -> album ; assets.largeImage -> album_cover_url
      timestamps       -> start_time / duration
    """
    assets = spotify.get("assets") or {}
    ts = spotify.get("timestamps") or {}

    title = spotify.get("details") or "Titre inconnu"
    artists = _split_artists(spotify.get("state")) or ["Artiste inconnu"]
    artist_ids = [a for a in (spotify.get("artistIds") or []) if a] or None

    # timestamps stockés en millisecondes (start/end). On en déduit start_time + durée.
    start_ms, end_ms = ts.get("start"), ts.get("end")
    start_time = discord.utils.MISSING
    if start_ms:
        start_time = datetime.datetime.fromtimestamp(start_ms / 1000, tz=datetime.timezone.utc)
    if start_ms and end_ms and end_ms > start_ms:
        duration = datetime.timedelta(milliseconds=end_ms - start_ms)
    else:
        duration = datetime.timedelta(minutes=3)

    kwargs = {
        "title": title,
        "track_id": spotify.get("songId"),
        "track_type": "track",
        "artists": artists,
        "artist_ids": artist_ids,
        "album": assets.get("largeText"),
        "album_id": spotify.get("albumId"),
        "album_cover_url": assets.get("largeImage"),
        "start_time": start_time,
        "duration": duration,
        "party_owner_id": client.user.id if client and client.user else None,
    }
    try:
        return discord.Spotify(**kwargs)
    except Exception as e:  # noqa: BLE001
        logerr(f"[RPC] Erreur buildSpotifyPresence : {e}")
        return discord.Activity(type=discord.ActivityType.listening, name=title)


def _extract_spotify_id(raw, kind) -> str | None:
    value = str(raw or "").strip()
    if not value:
        return None
    if re.match(r"^[A-Za-z0-9]{22}$", value):
        return value
    m = re.match(r"^spotify:(track|album|artist):([A-Za-z0-9]{22})$", value, re.IGNORECASE)
    if m:
        if m.group(1).lower() != kind:
            raise ValueError(f"L'entrée Spotify fournie n'est pas un {kind}.")
        return m.group(2)
    m = re.search(r"spotify\.com/(?:intl-[a-z-]+/)?(track|album|artist)/([A-Za-z0-9]{22})",
                  value, re.IGNORECASE)
    if m:
        if m.group(1).lower() != kind:
            raise ValueError(f"L'URL Spotify fournie n'est pas un {kind}.")
        return m.group(2)
    raise ValueError(f"Format Spotify invalide pour {kind}. "
                     f"Utilise un ID, une URI spotify:{kind}:... ou une URL Spotify.")


def _extract_spotify_ids(raw, kind) -> list:
    value = str(raw or "").strip()
    if not value:
        return []
    return [_extract_spotify_id(p.strip(), kind) for p in re.split(r"[\n,]+", value) if p.strip()]


def _parse_timestamp(raw):
    value = str(raw or "").strip()
    if not value:
        return None
    if re.match(r"^\d{10,13}$", value):
        num = int(value)
        return num * 1000 if len(value) == 10 else num
    from datetime import datetime
    try:
        return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)
    except Exception:
        raise ValueError("Timestamp invalide. Utilise un UNIX timestamp (secondes/ms) ou une date ISO.")


def _build_presence(config, client):
    activities = []
    if config["csEnabled"] and config["customStatuses"]:
        cs = config["customStatuses"][config["csCurrentIdx"] % len(config["customStatuses"])]
        try:
            emoji = _parse_emoji(cs.get("emoji")) if cs.get("emoji") else None
            activities.append(discord.CustomActivity(name=cs.get("text") or "", emoji=emoji))
        except Exception:
            activities.append(discord.CustomActivity(name=cs.get("text") or ""))
    if config["spotify"].get("enabled") and config["spotify"].get("songId"):
        activities.append(_build_spotify(config["spotify"], client))
    if config["enabled"] and config["activities"]:
        act = config["activities"][config["currentIdx"] % len(config["activities"])]
        activities.append(_build_rich(act, config["applicationId"]))
    return _STATUS_ENUM.get(config["status"], discord.Status.online), activities


async def apply_presence(client, config) -> None:
    status, activities = _build_presence(config, client)
    try:
        # edit_settings=False : on applique le statut/les activités UNIQUEMENT à la
        # session du selfbot (Desktop), sans écraser le réglage de statut GLOBAL du
        # compte. Avec le défaut (True), change_presence appelle settings.edit(status=…)
        # et propage le statut du RPC à tous les clients : se mettre en invisible sur
        # un autre client (Web) était alors immédiatement annulé par le bot, qui te
        # remettait en ligne. Découplé, le statut du compte (ex. invisible réglé côté
        # Web) est préservé — tu apparais offline aux autres — pendant que la session
        # Desktop conserve la valeur configurée dans le panel RPC.
        await client.change_presence(status=status, activities=activities, edit_settings=False)
    except Exception as e:  # noqa: BLE001
        logerr(f"[RPC] Erreur change_presence : {e}")
        return

    # Le custom status, lui, est resynchronisé dans les réglages du compte : tes
    # PROPRES clients officiels (app Web/Desktop) n'affichent pas la présence des
    # autres sessions du compte, mais bien le custom status enregistré dans les
    # réglages. Sans ça, tu ne voyais plus la rotation depuis ton propre compte.
    # On ne touche QUE custom_activity, jamais status : ton invisible/offline reste
    # donc préservé (contrairement au comportement d'origine edit_settings=True).
    try:
        custom = next(
            (a for a in activities if getattr(a, "type", None) == discord.ActivityType.custom),
            None,
        )
        if custom != client.settings.custom_activity:
            await client.settings.edit(custom_activity=custom)
    except Exception as e:  # noqa: BLE001
        logerr(f"[RPC] Erreur sync custom status (settings) : {e}")


async def _activity_loop(client, interval_sec):
    while True:
        await asyncio.sleep(interval_sec)
        cfg = load()
        if not cfg["activities"]:
            continue
        cfg["currentIdx"] = (cfg["currentIdx"] + 1) % len(cfg["activities"])
        save(cfg)
        await apply_presence(client, cfg)


async def _cs_loop(client, interval_sec):
    while True:
        await asyncio.sleep(interval_sec)
        cfg = load()
        if not cfg["customStatuses"]:
            continue
        cfg["csCurrentIdx"] = (cfg["csCurrentIdx"] + 1) % len(cfg["customStatuses"])
        save(cfg)
        await apply_presence(client, cfg)


async def start_rotators(client, config) -> None:
    global _activity_task, _cs_task
    _stop_all()
    await apply_presence(client, config)
    loop = asyncio.get_event_loop()
    if config["enabled"] and config["mode"] == "rotate" and len(config["activities"]) > 1:
        _activity_task = loop.create_task(_activity_loop(client, config.get("intervalSec") or 30))
    if config["csEnabled"] and len(config["customStatuses"]) > 1:
        _cs_task = loop.create_task(_cs_loop(client, config.get("csIntervalSec") or 15))


def on_ready(client) -> None:
    config = load()
    has_activity = ((config["spotify"].get("enabled") and config["spotify"].get("songId"))
                    or (config["enabled"] and config["activities"]))
    has_cs = config["csEnabled"] and config["customStatuses"]
    if has_activity or has_cs:
        asyncio.get_event_loop().create_task(start_rotators(client, config))


async def execute(client, payload):
    action = payload.get("action")
    config = load()

    async def _persist_and_apply():
        save(config)
        await start_rotators(client, config)
        return config

    if action == "getState":
        return config

    if action == "toggle":
        config["enabled"] = not config["enabled"]
        return await _persist_and_apply()

    if action == "csToggle":
        config["csEnabled"] = not config["csEnabled"]
        return await _persist_and_apply()

    if action == "setApplicationId":
        raw = (payload.get("applicationId") or "").strip()
        if raw and not re.match(r"^\d{17,20}$", raw):
            raise ValueError("Application ID invalide. Doit être un snowflake Discord (17–20 chiffres).")
        config["applicationId"] = raw or None
        return await _persist_and_apply()

    if action == "setSpotifyConfig":
        enabled = bool(payload.get("enabled"))
        song_id = _extract_spotify_id(payload.get("songId"), "track")
        album_id = _extract_spotify_id(payload.get("albumId"), "album")
        artist_ids = _extract_spotify_ids(payload.get("artistIds"), "artist")
        details = (payload.get("details") or "").strip() or None
        state = (payload.get("state") or "").strip() or None
        if enabled and not song_id:
            raise ValueError("Le Song ID Spotify est requis pour activer Spotify RPC.")
        config["spotify"] = {**_normalize_spotify(config["spotify"]), "enabled": enabled,
                             "songId": song_id, "albumId": album_id, "artistIds": artist_ids,
                             "details": details[:128] if details else None,
                             "state": state[:128] if state else None}
        return await _persist_and_apply()

    if action == "setSpotifyAssets":
        assets = payload.get("assets") or {}
        config["spotify"] = {**_normalize_spotify(config["spotify"]), "assets": {
            "largeImage": (assets.get("largeImage") or "").strip() or None,
            "largeText": (assets.get("largeText") or "").strip() or None,
            "smallImage": (assets.get("smallImage") or "").strip() or None,
            "smallText": (assets.get("smallText") or "").strip() or None}}
        return await _persist_and_apply()

    if action == "setSpotifyTimestamps":
        start = _parse_timestamp(payload.get("start"))
        end = _parse_timestamp(payload.get("end"))
        if start and end and end <= start:
            raise ValueError("Le timestamp de fin doit être supérieur au timestamp de début.")
        config["spotify"] = {**_normalize_spotify(config["spotify"]),
                             "timestamps": {"start": start, "end": end}}
        return await _persist_and_apply()

    if action == "setSpotifyExtras":
        application_id = (payload.get("applicationId") or "").strip() or None
        platform = (payload.get("platform") or "").strip().lower() or None
        url = (payload.get("url") or "").strip() or None
        if application_id and not re.match(r"^\d{17,20}$", application_id):
            raise ValueError("Application ID Spotify invalide. Doit être un snowflake Discord.")
        if url and not re.match(r"^https?://", url):
            raise ValueError("L'URL Spotify RPC doit commencer par http:// ou https://")
        config["spotify"] = {**_normalize_spotify(config["spotify"]),
                             "applicationId": application_id, "platform": platform, "url": url}
        return await _persist_and_apply()

    if action == "setStatus":
        allowed = ["online", "idle", "dnd", "invisible"]
        if payload.get("status") not in allowed:
            raise ValueError(f"Statut invalide. Valeurs : {', '.join(allowed)}")
        config["status"] = payload["status"]
        return await _persist_and_apply()

    if action == "setMode":
        if payload.get("mode") not in ("static", "rotate"):
            raise ValueError("Mode invalide : 'static' ou 'rotate'.")
        config["mode"] = payload["mode"]
        return await _persist_and_apply()

    if action == "setInterval":
        sec = _int(payload.get("intervalSec"))
        if not sec or sec < 5:
            raise ValueError("Intervalle minimum : 5 secondes.")
        config["intervalSec"] = sec
        return await _persist_and_apply()

    if action == "setCsInterval":
        sec = _int(payload.get("intervalSec"))
        if not sec or sec < 5:
            raise ValueError("Intervalle minimum : 5 secondes.")
        config["csIntervalSec"] = sec
        return await _persist_and_apply()

    if action == "addActivity":
        activity = payload.get("activity") or {}
        if not activity.get("name"):
            raise ValueError("'name' requis.")
        if (activity.get("type") or "playing") not in ACTIVITY_TYPES:
            raise ValueError(f"Type invalide. Valeurs : {', '.join(ACTIVITY_TYPES)}")
        entry = {"type": activity.get("type") or "playing", "name": activity["name"][:128],
                 "details": activity.get("details"), "state": activity.get("state"),
                 "url": activity.get("url"),
                 "assets": {"largeImage": None, "largeText": None, "smallImage": None, "smallText": None},
                 "timestamps": {"start": None, "end": None}}
        if entry["type"] == "streaming" and entry["url"] and not entry["url"].startswith("https://"):
            raise ValueError("L'URL de streaming doit commencer par https://")
        config["activities"].append(entry)
        return await _persist_and_apply()

    if action == "editActivity":
        idx = (payload.get("index") or 1) - 1
        if idx < 0 or idx >= len(config["activities"]):
            raise ValueError(f"Index invalide (1–{len(config['activities'])}).")
        activity = payload.get("activity") or {}
        if not activity.get("name"):
            raise ValueError("'name' requis.")
        if (activity.get("type") or "playing") not in ACTIVITY_TYPES:
            raise ValueError(f"Type invalide. Valeurs : {', '.join(ACTIVITY_TYPES)}")
        if activity.get("type") == "streaming" and activity.get("url") \
                and not activity["url"].startswith("https://"):
            raise ValueError("L'URL de streaming doit commencer par https://")
        config["activities"][idx] = {**config["activities"][idx],
                                     "type": activity.get("type") or config["activities"][idx]["type"],
                                     "name": activity["name"][:128],
                                     "details": activity.get("details"),
                                     "state": activity.get("state"), "url": activity.get("url")}
        return await _persist_and_apply()

    if action == "setPlatform":
        platforms = ["desktop", "samsung", "xbox", "ios", "android", "embedded", "ps4", "ps5"]
        idx = (payload.get("index") or 1) - 1
        if idx < 0 or idx >= len(config["activities"]):
            raise ValueError(f"Index invalide (1–{len(config['activities'])}).")
        platform = payload.get("platform")
        if platform in (None, ""):
            config["activities"][idx].pop("platform", None)
        else:
            if platform not in platforms:
                raise ValueError(f"Plateforme invalide. Valeurs : {', '.join(platforms)}")
            config["activities"][idx]["platform"] = platform
        return await _persist_and_apply()

    if action == "editButtons":
        idx = (payload.get("index") or 1) - 1
        if idx < 0 or idx >= len(config["activities"]):
            raise ValueError(f"Index invalide (1–{len(config['activities'])}).")
        act = config["activities"][idx]
        if act["type"] == "streaming":
            raise ValueError("Les boutons ne sont pas disponibles pour les activités Streaming.")
        if not config["applicationId"]:
            raise ValueError("Application ID non configuré. Configure-le d'abord via le bouton "
                             "'🔑 App ID' pour que les boutons soient cliquables.")
        button_action = payload.get("buttonAction")
        if not isinstance(act.get("buttons"), list):
            act["buttons"] = []
        if button_action == "add":
            if len(act["buttons"]) >= 2:
                raise ValueError("Maximum 2 boutons par activité.")
            label, url = payload.get("label"), payload.get("url")
            if not label:
                raise ValueError("label requis.")
            if not url:
                raise ValueError("url requis.")
            if not (url.startswith("http://") or url.startswith("https://")):
                raise ValueError("L'URL doit commencer par http:// ou https://")
            act["buttons"].append({"label": label[:32], "url": url})
        elif button_action == "remove":
            b_idx = (payload.get("buttonIndex") or 1) - 1
            if b_idx < 0 or b_idx >= len(act["buttons"]):
                raise ValueError(f"Index bouton invalide (1–{len(act['buttons'])}).")
            act["buttons"].pop(b_idx)
            if not act["buttons"]:
                act.pop("buttons", None)
        elif button_action == "clear":
            act.pop("buttons", None)
        return await _persist_and_apply()

    if action == "editAssets":
        idx = (payload.get("index") or 1) - 1
        if idx < 0 or idx >= len(config["activities"]):
            raise ValueError(f"Index invalide (1–{len(config['activities'])}).")
        assets = payload.get("assets") or {}
        config["activities"][idx]["assets"] = {
            "largeImage": assets.get("largeImage"), "largeText": assets.get("largeText"),
            "smallImage": assets.get("smallImage"), "smallText": assets.get("smallText")}
        return await _persist_and_apply()

    if action == "setActivityTimestamps":
        idx = (payload.get("index") or 1) - 1
        if idx < 0 or idx >= len(config["activities"]):
            raise ValueError(f"Index invalide (1–{len(config['activities'])}).")
        start = _parse_timestamp(payload.get("start"))
        end = _parse_timestamp(payload.get("end"))
        if start and end and end <= start:
            raise ValueError("Le timestamp de fin doit être supérieur au timestamp de début.")
        config["activities"][idx]["timestamps"] = {"start": start, "end": end}
        return await _persist_and_apply()

    if action == "removeActivity":
        idx = (payload.get("index") or 1) - 1
        if idx < 0 or idx >= len(config["activities"]):
            raise ValueError(f"Index invalide (1–{len(config['activities'])}).")
        config["activities"].pop(idx)
        config["currentIdx"] = 0
        return await _persist_and_apply()

    if action == "moveActivity":
        idx = (payload.get("index") or 1) - 1
        direction = payload.get("direction")
        if idx < 0 or idx >= len(config["activities"]):
            raise ValueError("Index invalide.")
        if direction == "up" and idx == 0:
            raise ValueError("Déjà en première position.")
        if direction == "down" and idx == len(config["activities"]) - 1:
            raise ValueError("Déjà en dernière position.")
        swap = idx - 1 if direction == "up" else idx + 1
        config["activities"][idx], config["activities"][swap] = \
            config["activities"][swap], config["activities"][idx]
        config["currentIdx"] = 0
        return await _persist_and_apply()

    if action == "clearActivities":
        config["activities"] = []
        config["currentIdx"] = 0
        return await _persist_and_apply()

    if action == "csAdd":
        emoji = payload.get("emoji")
        text = payload.get("text") or ""
        if not text and not emoji:
            raise ValueError("text ou emoji requis.")
        config["customStatuses"].append({"emoji": emoji or None, "text": text[:128]})
        return await _persist_and_apply()

    if action == "csEdit":
        idx = (payload.get("index") or 1) - 1
        if idx < 0 or idx >= len(config["customStatuses"]):
            raise ValueError(f"Index invalide (1–{len(config['customStatuses'])}).")
        config["customStatuses"][idx] = {"emoji": payload.get("emoji") or None,
                                         "text": (payload.get("text") or "")[:128]}
        return await _persist_and_apply()

    if action == "csRemove":
        idx = (payload.get("index") or 1) - 1
        if idx < 0 or idx >= len(config["customStatuses"]):
            raise ValueError(f"Index invalide (1–{len(config['customStatuses'])}).")
        config["customStatuses"].pop(idx)
        config["csCurrentIdx"] = 0
        return await _persist_and_apply()

    if action == "csClear":
        config["customStatuses"] = []
        config["csCurrentIdx"] = 0
        config["csEnabled"] = False
        return await _persist_and_apply()

    if action == "applyNow":
        await apply_presence(client, config)
        return config

    raise ValueError(f"Action rpc inconnue : '{action}'")


def _int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0
