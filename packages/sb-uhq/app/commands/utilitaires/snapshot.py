"""snapshot — archive HTML d'un salon / MP + snapshots périodiques.

Le fichier HTML est écrit dans data/snapshots/... puis son CHEMIN est transmis au
bot-controller (POST /file) qui l'envoie en MP ou dans un salon (les deux process
tournent sur le même hôte, donc pas de base64).
"""

from __future__ import annotations

import asyncio
import os
import re
import time

import discord

from ...bridge.controller_client import post_file, post_snapshot_result
from ...func.data_path import data_path, read_json, write_json
from ...func.discord_util import fetch_channel, user_tag
from ...func.logbus import log, logerr
from ...func.snapshot_html import build_html, is_system_message

SNAPSHOTS_ROOT = data_path("snapshots")
SNAPSHOTS_GUILDS_DIR = SNAPSHOTS_ROOT / "SERVEURS"
SNAPSHOTS_DMS_DIR = SNAPSHOTS_ROOT / "MPs"
SNAPSHOTS_GROUPDMS_DIR = SNAPSHOTS_ROOT / "GROUP_DMs"
SCHEDULE_FILE = data_path("config", "snapshot-schedules.json")

SCHEDULE_TICK = 60
MIN_SCHEDULE_INTERVAL_MS = 5 * 60 * 1000

_HARD_LIMIT_ENV = os.environ.get("SNAPSHOT_HARD_LIMIT")
SNAPSHOT_HARD_LIMIT = int(_HARD_LIMIT_ENV) if _HARD_LIMIT_ENV is not None else 10_000

_schedule_task: asyncio.Task | None = None
_schedule_client = None
_running_scheduled: set = set()


# ── Config planification ─────────────────────────────────────────────────────

def load_schedule_config() -> dict:
    raw = read_json(SCHEDULE_FILE, {})
    return {"running": raw.get("running") is True,
            "jobs": raw.get("jobs") if isinstance(raw.get("jobs"), list) else []}


def save_schedule_config(config) -> None:
    write_json(SCHEDULE_FILE, {"running": config.get("running") is True,
                               "jobs": config.get("jobs") or []}, mode=0o600)


_INTERVAL_COMPACT = re.compile(
    r"^(\d+(?:\.\d+)?)\s*(m|min|minute|minutes|h|heure|heures|d|j|jour|jours|w|s|sem|semaine|semaines)$",
    re.IGNORECASE)
_INTERVAL_WORDS = re.compile(
    r"^toutes?\s+les?\s+(\d+(?:\.\d+)?)\s*(m|min|minute|minutes|h|heure|heures|d|j|jour|jours|w|s|sem|semaine|semaines)$",
    re.IGNORECASE)


def parse_schedule_interval(raw_input) -> int:
    raw = str(raw_input or "").strip().lower().replace(",", ".")
    if not raw:
        raise ValueError("Intervalle requis (ex: 1w, 7d, 24h, 60m).")
    match = _INTERVAL_COMPACT.match(raw) or _INTERVAL_WORDS.match(raw)
    if not match:
        raise ValueError("Format d'intervalle invalide. Exemples : 1w, 7d, 24h, 60m.")
    value = float(match.group(1))
    unit = match.group(2)
    if value <= 0:
        raise ValueError("L'intervalle doit être supérieur à 0.")
    minute, hour, day, week = 60_000, 3_600_000, 86_400_000, 604_800_000
    if unit in ("m", "min", "minute", "minutes"):
        ms = value * minute
    elif unit in ("h", "heure", "heures"):
        ms = value * hour
    elif unit in ("d", "j", "jour", "jours"):
        ms = value * day
    elif unit in ("w", "s", "sem", "semaine", "semaines"):
        ms = value * week
    else:
        raise ValueError("Unité d'intervalle invalide.")
    if ms < MIN_SCHEDULE_INTERVAL_MS:
        raise ValueError("Intervalle trop court (minimum 5 minutes).")
    return round(ms)


def format_schedule_interval(ms) -> str:
    minute, hour, day, week = 60_000, 3_600_000, 86_400_000, 604_800_000
    if ms % week == 0:
        return f"{ms // week} semaine(s)"
    if ms % day == 0:
        return f"{ms // day} jour(s)"
    if ms % hour == 0:
        return f"{ms // hour} heure(s)"
    if ms % minute == 0:
        return f"{ms // minute} minute(s)"
    return f"{round(ms / minute)} minute(s)"


def _public_schedule_state() -> dict:
    config = load_schedule_config()
    now = int(time.time() * 1000)
    return {
        "running": config["running"] and _schedule_task is not None,
        "jobs": [{
            **job,
            "intervalLabel": format_schedule_interval(job["intervalMs"]),
            "nextRunInMs": max(0, (job.get("nextRunAt") or now) - now),
        } for job in config["jobs"]],
    }


# ── Classification ───────────────────────────────────────────────────────────

def _classify_channel(channel) -> dict:
    if isinstance(channel, discord.DMChannel):
        recipient = channel.recipient
        recipient_id = str(recipient.id) if recipient else str(channel.id)
        dm_with = user_tag(recipient)
        return {"isDm": True, "isGroupDm": False,
                "channelName": dm_with or recipient_id, "guildName": None, "dmWith": dm_with,
                "snapshotDir": SNAPSHOTS_DMS_DIR / recipient_id}
    if isinstance(channel, discord.GroupChannel):
        return {"isDm": True, "isGroupDm": True,
                "channelName": channel.name or "Groupe", "guildName": None, "dmWith": None,
                "snapshotDir": SNAPSHOTS_GROUPDMS_DIR / str(channel.id)}
    guild = getattr(channel, "guild", None)
    guild_id = str(guild.id) if guild else "inconnu"
    return {"isDm": False, "isGroupDm": False,
            "channelName": getattr(channel, "name", None) or str(channel.id),
            "guildName": getattr(guild, "name", None) if guild else None, "dmWith": None,
            "snapshotDir": SNAPSHOTS_GUILDS_DIR / guild_id / str(channel.id)}


# ── Fetch ────────────────────────────────────────────────────────────────────

async def _fetch_all_messages(channel, limit=0) -> list:
    if limit > 0 and SNAPSHOT_HARD_LIMIT > 0:
        effective = min(limit, SNAPSHOT_HARD_LIMIT)
    elif limit > 0:
        effective = limit
    elif SNAPSHOT_HARD_LIMIT > 0:
        effective = SNAPSHOT_HARD_LIMIT
    else:
        effective = 0

    messages = []
    if effective > 0:
        # Du plus récent au plus ancien pour obtenir les N DERNIERS messages,
        # puis inversion pour retrouver l'ordre chronologique.
        async for msg in channel.history(limit=effective):
            messages.append(msg)
        messages.reverse()
    else:
        async for msg in channel.history(limit=None, oldest_first=True):
            messages.append(msg)
    return messages


def _ms(dt):
    if dt is None:
        return None
    try:
        return int(dt.timestamp() * 1000)
    except Exception:
        return None


def _serialize_message(msg) -> dict:
    msg_type = int(getattr(msg.type, "value", msg.type))
    system = is_system_message(msg_type)

    reactions = []
    for r in getattr(msg, "reactions", []) or []:
        emoji = r.emoji
        emoji_id = getattr(emoji, "id", None)
        emoji_name = getattr(emoji, "name", None) if not isinstance(emoji, str) else emoji
        reactions.append({
            "emoji": None if emoji_id else emoji_name,
            "emojiId": str(emoji_id) if emoji_id else None,
            "emojiName": emoji_name,
            "animated": bool(getattr(emoji, "animated", False)),
            "count": r.count,
        })

    stickers = []
    for s in getattr(msg, "stickers", []) or []:
        fmt = getattr(s, "format", None)
        stickers.append({
            "id": str(s.id),
            "name": getattr(s, "name", None) or "sticker",
            "format_type": getattr(fmt, "value", fmt) or 1,
        })

    embeds = []
    for e in getattr(msg, "embeds", []) or []:
        fields = [{"name": f.name or "", "value": f.value or "", "inline": bool(f.inline)}
                  for f in getattr(e, "fields", [])]
        author = None
        if e.author and e.author.name is not None:
            author = {"name": e.author.name, "url": e.author.url,
                      "iconUrl": e.author.icon_url or e.author.proxy_icon_url}
        provider = None
        if getattr(e, "provider", None) and getattr(e.provider, "name", None):
            provider = {"name": e.provider.name, "url": getattr(e.provider, "url", None)}
        color = e.colour.value if e.colour else None
        embeds.append({
            "type": getattr(e, "type", None) or "rich",
            "url": e.url, "title": e.title, "description": e.description, "color": color,
            "author": author, "provider": provider,
            "footer": e.footer.text if e.footer else None,
            "footerIconUrl": (e.footer.icon_url or e.footer.proxy_icon_url) if e.footer else None,
            "timestamp": _ms(e.timestamp) if e.timestamp else None,
            "imageUrl": e.image.url if e.image else None,
            "thumbnailUrl": e.thumbnail.url if e.thumbnail else None,
            "videoUrl": e.video.url if e.video else None,
            "fields": fields,
        })

    mentioned_users = [{"id": str(u.id), "tag": user_tag(u)} for u in getattr(msg, "mentions", [])]
    mentioned_roles = [{"id": str(r.id), "name": r.name or str(r.id)}
                       for r in getattr(msg, "role_mentions", [])]

    author = msg.author
    author_tag = user_tag(author) or "Inconnu"
    avatar_key = None
    if author and getattr(author, "avatar", None):
        avatar_key = getattr(author.avatar, "key", None)

    reply_author = None
    ref = getattr(msg, "reference", None)
    if ref:
        resolved = getattr(ref, "resolved", None)
        if resolved and getattr(resolved, "author", None):
            reply_author = user_tag(resolved.author)

    return {
        "id": str(msg.id),
        "messageType": msg_type,
        "isSystem": system,
        "authorId": str(author.id) if author else "0",
        "authorTag": author_tag,
        "authorAvatar": avatar_key,
        "authorDiscriminator": getattr(author, "discriminator", "0") if author else "0",
        "isBot": bool(getattr(author, "bot", False)),
        "content": msg.content or "",
        "timestamp": _ms(msg.created_at),
        "editedAt": _ms(getattr(msg, "edited_at", None)),
        "attachments": [{"url": a.url, "name": a.filename} for a in getattr(msg, "attachments", [])],
        "embeds": embeds,
        "stickers": stickers,
        "mentionedUsers": mentioned_users,
        "mentionedRoles": mentioned_roles,
        "replyAuthor": reply_author,
        "replyContent": None,
        "reactions": reactions,
    }


# ── Runner ───────────────────────────────────────────────────────────────────

async def run_snapshot(client, channel_id, limit, send_to_channel_id, job_id) -> None:
    channel = await fetch_channel(client, channel_id)
    if not channel:
        await post_snapshot_result(job_id, {
            "error": f"Salon {channel_id} introuvable ou inaccessible.",
            "channelName": channel_id, "messageCount": 0, "sent": False, "isDm": False})
        return

    info = _classify_channel(channel)
    log(f"[SNAPSHOT] Début du snapshot de {info['channelName']} ({channel_id})...")

    try:
        raw = await _fetch_all_messages(channel, limit)
        log(f"[SNAPSHOT] {len(raw)} messages recupérés, génération HTML...")
        serialized = [_serialize_message(m) for m in raw]

        info["snapshotDir"].mkdir(parents=True, exist_ok=True)
        filename = f"snapshot_{channel_id}_{int(time.time() * 1000)}.html"
        filepath = info["snapshotDir"] / filename

        html = build_html(channel_name=info["channelName"], guild_name=info["guildName"],
                          is_dm=info["isDm"], dm_with=info["dmWith"], messages=serialized)
        filepath.write_text(html, encoding="utf-8")
        try:
            filepath.chmod(0o600)
        except OSError:
            pass

        message_count = len(serialized)
        file_size_kb = round(filepath.stat().st_size / 1024)
        meta = {"channelName": info["channelName"], "guildName": info["guildName"],
                "isDm": info["isDm"], "isGroupDm": info["isGroupDm"], "dmWith": info["dmWith"],
                "messageCount": message_count, "filename": filename, "fileSizeKb": file_size_kb}

        sent = False
        try:
            sent = await post_file(filename, str(filepath), meta, send_to_channel_id)
            log("[SNAPSHOT] " + ("Fichier transmis au bot controller."
                                 if sent else "Bot controller injoignable."))
        except Exception as err:  # noqa: BLE001
            logerr(f"[SNAPSHOT] Erreur envoi au bot controller : {err}")

        await post_snapshot_result(job_id, {
            "channelId": channel_id, "channelName": info["channelName"],
            "guildName": info["guildName"], "isDm": info["isDm"], "isGroupDm": info["isGroupDm"],
            "dmWith": info["dmWith"], "messageCount": message_count, "filename": filename,
            "filepath": str(filepath), "fileSizeKb": file_size_kb, "sent": sent,
            "sentChannelId": send_to_channel_id})
    except Exception as err:  # noqa: BLE001
        logerr(f"[SNAPSHOT] Erreur pendant le snapshot : {err}")
        await post_snapshot_result(job_id, {
            "error": str(err), "channelName": info["channelName"], "guildName": info["guildName"],
            "isDm": info["isDm"], "messageCount": 0, "sent": False})


# ── Boucle périodique ────────────────────────────────────────────────────────

async def _run_scheduled(client, job) -> None:
    if job["id"] in _running_scheduled:
        return
    _running_scheduled.add(job["id"])
    try:
        log(f"[SNAPSHOT] Snapshot périodique déclenché pour {job['channelId']}")
        await run_snapshot(client, job["channelId"], job.get("limit") or 0,
                           job.get("sendToChannelId"), None)
    except Exception as err:  # noqa: BLE001
        logerr(f"[SNAPSHOT] Erreur snapshot périodique {job['channelId']} : {err}")
    finally:
        config = load_schedule_config()
        current = next((j for j in config["jobs"] if j["id"] == job["id"]), None)
        if current:
            current["lastRunAt"] = int(time.time() * 1000)
            current["nextRunAt"] = current["lastRunAt"] + current["intervalMs"]
            save_schedule_config(config)
        _running_scheduled.discard(job["id"])


async def _tick():
    if not _schedule_client:
        return
    config = load_schedule_config()
    if not config["running"]:
        return
    now = int(time.time() * 1000)
    changed = False
    for job in config["jobs"]:
        if not job.get("nextRunAt"):
            job["nextRunAt"] = now + job["intervalMs"]
            changed = True
            continue
        if job["nextRunAt"] <= now:
            asyncio.get_event_loop().create_task(_run_scheduled(_schedule_client, dict(job)))
    if changed:
        save_schedule_config(config)


async def _schedule_loop():
    while True:
        try:
            await _tick()
        except Exception:
            pass
        await asyncio.sleep(SCHEDULE_TICK)


def start_schedule_loop(client) -> bool:
    global _schedule_task, _schedule_client
    _schedule_client = client
    if _schedule_task and not _schedule_task.done():
        return False
    _schedule_task = asyncio.get_event_loop().create_task(_schedule_loop())
    return True


def stop_schedule_loop() -> bool:
    global _schedule_task
    if not _schedule_task:
        return False
    _schedule_task.cancel()
    _schedule_task = None
    return True


def on_ready(client) -> None:
    config = load_schedule_config()
    if config["running"] and config["jobs"]:
        start_schedule_loop(client)
        log(f"[SNAPSHOT] 🔄 Boucle périodique relancée ({len(config['jobs'])} salon(s)).")


async def execute(client, payload):
    action = payload.get("action")
    channel_id = payload.get("channelId")
    limit = payload.get("limit", 0)
    send_to = payload.get("sendToChannelId")
    job_id = payload.get("jobId")
    interval = payload.get("interval")

    if action == "snapshot":
        if not channel_id:
            raise ValueError("channelId requis.")
        asyncio.get_event_loop().create_task(
            _safe_run(client, channel_id, limit, send_to, job_id))
        return {"started": True, "channelId": channel_id}

    if action == "periodic.list":
        config = load_schedule_config()
        if config["running"] and config["jobs"] and not _schedule_task:
            start_schedule_loop(client)
        return _public_schedule_state()

    if action == "periodic.add":
        if not channel_id:
            raise ValueError("channelId requis.")
        interval_ms = parse_schedule_interval(interval)
        safe_limit = max(0, int(limit) if limit else 0)
        config = load_schedule_config()
        now = int(time.time() * 1000)
        existing = next((i for i, j in enumerate(config["jobs"]) if j["id"] == channel_id), -1)
        job = {"id": channel_id, "channelId": channel_id, "intervalMs": interval_ms,
               "limit": safe_limit, "sendToChannelId": send_to,
               "createdAt": config["jobs"][existing].get("createdAt", now) if existing >= 0 else now,
               "lastRunAt": config["jobs"][existing].get("lastRunAt") if existing >= 0 else None,
               "nextRunAt": now + interval_ms}
        if existing >= 0:
            config["jobs"][existing] = job
        else:
            config["jobs"].append(job)
        config["running"] = True
        save_schedule_config(config)
        start_schedule_loop(client)
        return _public_schedule_state()

    if action == "periodic.remove":
        if not channel_id:
            raise ValueError("channelId requis.")
        config = load_schedule_config()
        before = len(config["jobs"])
        config["jobs"] = [j for j in config["jobs"]
                          if j.get("channelId") != channel_id and j.get("id") != channel_id]
        if len(config["jobs"]) == before:
            raise ValueError("Aucun snapshot périodique trouvé pour ce salon.")
        if not config["jobs"]:
            config["running"] = False
            stop_schedule_loop()
        save_schedule_config(config)
        return _public_schedule_state()

    if action == "periodic.start":
        config = load_schedule_config()
        if not config["jobs"]:
            raise ValueError("Aucun snapshot périodique configuré.")
        config["running"] = True
        save_schedule_config(config)
        start_schedule_loop(client)
        return _public_schedule_state()

    if action == "periodic.stop":
        config = load_schedule_config()
        config["running"] = False
        save_schedule_config(config)
        stop_schedule_loop()
        return _public_schedule_state()

    raise ValueError(f"Action snapshot inconnue : '{action}'")


async def _safe_run(client, channel_id, limit, send_to, job_id):
    try:
        await run_snapshot(client, channel_id, limit, send_to, job_id)
    except Exception as err:  # noqa: BLE001
        logerr(f"[SNAPSHOT] Erreur non gerée : {err}")
        await post_snapshot_result(job_id, {
            "error": str(err), "channelName": channel_id, "messageCount": 0,
            "sent": False, "isDm": False})
