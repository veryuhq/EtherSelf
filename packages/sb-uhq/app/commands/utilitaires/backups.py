"""backups — clone de serveur + sauvegarde des amis / serveurs.

Port de src/self/commands/utilitaires/backups.js. Le clone tourne en tâche de fond
et relaie sa progression au bot-controller (POST /clone-progress).
"""

from __future__ import annotations

import asyncio
import time

import aiohttp
import discord

from ...bridge.controller_client import post_clone_progress
from ...func.client_token import get_token
from ...func.data_path import data_path, read_json, write_json
from ...func.discord_headers import make_desktop_headers
from ...func.discord_util import user_tag

CLONE_LOG_FILE = data_path("logs", "clone_history.json")
BACKUPS_FILE = data_path("logs", "backups_data.json")

DELAY = {"role": 0.6, "channel": 0.5, "emoji": 1.2}
_EMOJI_LIMITS = [50, 100, 150, 250]

_active_jobs: dict[str, dict] = {}


class CancelledError(Exception):
    def __init__(self):
        super().__init__("Clonage annulé par l'utilisateur.")
        self.cancelled = True


def _register(job_id):
    _active_jobs[job_id] = {"cancelled": False}


def cancel_job(job_id) -> bool:
    job = _active_jobs.get(job_id)
    if job:
        job["cancelled"] = True
        return True
    return False


def _is_cancelled(job_id) -> bool:
    return bool(_active_jobs.get(job_id, {}).get("cancelled"))


def _clean(job_id):
    _active_jobs.pop(job_id, None)


def _check_cancelled(job_id):
    if _is_cancelled(job_id):
        raise CancelledError()


def _now_ms() -> int:
    return int(time.time() * 1000)


# ── Historique / persistance ─────────────────────────────────────────────────

def load_clone_history() -> list:
    return read_json(CLONE_LOG_FILE, [])


def save_clone_history(h) -> None:
    write_json(CLONE_LOG_FILE, h)


def _push_clone_history(entry) -> None:
    h = load_clone_history()
    h.append(entry)
    if len(h) > 20:
        h.pop(0)
    save_clone_history(h)


def load_backups_data() -> dict:
    return read_json(BACKUPS_FILE, {"friends": None, "guilds": None,
                                    "friendsSavedAt": None, "guildsSavedAt": None})


def save_backups_data(data) -> None:
    write_json(BACKUPS_FILE, data)


async def _notify(job_id, data):
    if job_id:
        await post_clone_progress(job_id, data)


# ── Sérialisation ami ────────────────────────────────────────────────────────

def _serialize_friend(user_id, user, since):
    user = user or {}
    username = user.get("username")
    discrim = user.get("discriminator") or "0"
    global_name = user.get("global_name") or user.get("globalName")
    avatar = user.get("avatar")
    if username:
        tag = f"{username}#{discrim}" if discrim and discrim != "0" else username
    else:
        tag = user_id
    return {"id": user_id, "tag": tag, "username": username, "globalName": global_name,
            "avatar": avatar, "since": since}


async def _fetch_friends(client):
    token = get_token(client)
    headers = make_desktop_headers(token)
    headers.pop("Content-Type", None)
    async with aiohttp.ClientSession() as session:
        async with session.get("https://discord.com/api/v9/users/@me/relationships",
                               headers=headers) as res:
            if res.status >= 400:
                body = await res.text()
                raise RuntimeError(f"Impossible de récupérer les amis — HTTP {res.status}"
                                   f"{f' : {body[:200]}' if body else ''}")
            data = await res.json(content_type=None)
    friends = [_serialize_friend(r["id"], r.get("user") or {}, r.get("since"))
               for r in data if r.get("type") == 1]
    return friends, "api"


# ── Fetch serveurs ───────────────────────────────────────────────────────────

async def _create_permanent_invite(guild):
    # Les salons d'annonces sont des TextChannel (is_news()) dans discord.py-self.
    channels = [c for c in guild.channels if isinstance(c, discord.TextChannel)]

    def sort_key(c):
        if c.id == guild.system_channel_id:
            return (-1, 0)
        return (0, getattr(c, "position", 0))

    for channel in sorted(channels, key=sort_key):
        try:
            invite = await channel.create_invite(max_age=0, max_uses=0, unique=False,
                                                 reason="Backup EtherSelf")
            if invite and invite.code:
                return f"https://discord.gg/{invite.code}"
        except Exception:
            continue
    return None


async def _fetch_guilds(client, with_invites=False):
    guilds = []
    for guild in client.guilds:
        invite = None
        if with_invites:
            try:
                existing = await guild.invites()
                if existing:
                    own = next((i for i in existing if i.max_age == 0
                                and i.inviter and i.inviter.id == client.user.id), None)
                    any_perm = next((i for i in existing if i.max_age == 0), None)
                    invite = (own.url if own else None) or (any_perm.url if any_perm else None)
            except Exception:
                pass
            if not invite:
                invite = await _create_permanent_invite(guild)
        guilds.append({
            "id": str(guild.id), "name": guild.name,
            "icon": str(guild.icon.replace(size=64)) if guild.icon else None,
            "ownerId": str(guild.owner_id) if guild.owner_id else None,
            "isOwner": guild.owner_id == client.user.id,
            "invite": invite,
        })
    return guilds, "cache"


# ── Clone ────────────────────────────────────────────────────────────────────

def _emoji_limit(guild) -> int:
    tier = guild.premium_tier or 0
    return _EMOJI_LIMITS[tier] if 0 <= tier < len(_EMOJI_LIMITS) else 50


def _translate_overwrites(channel, role_map):
    result = {}
    for target, overwrite in channel.overwrites.items():
        if not isinstance(target, discord.Role):
            continue
        mapped = role_map.get(target.id)
        if not mapped:
            continue
        result[mapped] = overwrite
    return result


async def _fetch_bytes(url):
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url) as res:
                return await res.read()
    except Exception:
        return None


async def _clone_roles(src, tgt, job_id, push_log, ctx):
    role_map = {}
    to_delete = [r for r in tgt.roles if not r.managed and r.name != "@everyone"]
    push_log(f"🗑️ Suppression de {len(to_delete)} rôle(s)…")
    for r in to_delete:
        _check_cancelled(job_id)
        try:
            await r.delete(reason="Clone")
        except Exception:
            pass
        await asyncio.sleep(0.3)

    roles = sorted([r for r in src.roles if not r.managed and r.name != "@everyone"],
                   key=lambda r: r.position)
    push_log(f"🎭 Clonage de {len(roles)} rôle(s)…")
    await _notify(job_id, {"step": "roles", "current": 0, "total": len(roles),
                           "label": "Clonage des rôles…", "done": False,
                           "sourceGuild": ctx["src"], "targetGuild": ctx["tgt"]})
    for i, r in enumerate(roles):
        _check_cancelled(job_id)
        try:
            created = await tgt.create_role(name=r.name, colour=r.colour, hoist=r.hoist,
                                            mentionable=r.mentionable, permissions=r.permissions,
                                            reason="Clone")
            role_map[r.id] = created
            push_log(f'✅ Rôle "{r.name}"')
        except Exception as e:  # noqa: BLE001
            push_log(f'⚠️ "{r.name}" ignoré : {e}')
        await _notify(job_id, {"step": "roles", "current": i + 1, "total": len(roles),
                               "label": f"Rôle : {r.name}", "done": False,
                               "sourceGuild": ctx["src"], "targetGuild": ctx["tgt"]})
        await asyncio.sleep(DELAY["role"])
    role_map[src.id] = tgt.default_role
    return role_map


async def _clone_channels(src, tgt, role_map, job_id, push_log, ctx):
    channel_map = {}
    push_log("🗑️ Suppression des salons existants…")
    for ch in list(tgt.channels):
        _check_cancelled(job_id)
        try:
            await ch.delete(reason="Clone")
        except Exception:
            pass
        await asyncio.sleep(0.2)

    categories = sorted([c for c in src.channels if isinstance(c, discord.CategoryChannel)],
                        key=lambda c: c.position)
    others = sorted([c for c in src.channels if not isinstance(c, discord.CategoryChannel)],
                    key=lambda c: c.position)
    total = len(categories) + len(others)
    push_log(f"📋 {total} salon(s) à créer…")
    await _notify(job_id, {"step": "channels", "current": 0, "total": total,
                           "label": "Clonage des salons…", "done": False,
                           "sourceGuild": ctx["src"], "targetGuild": ctx["tgt"]})

    for i, cat in enumerate(categories):
        _check_cancelled(job_id)
        try:
            created = await tgt.create_category(
                cat.name, overwrites=_translate_overwrites(cat, role_map),
                position=cat.position, reason="Clone")
            channel_map[cat.id] = created
            push_log(f'📁 "{cat.name}"')
        except Exception as e:  # noqa: BLE001
            push_log(f'⚠️ Cat "{cat.name}" ignorée : {e}')
        await _notify(job_id, {"step": "channels", "current": i + 1, "total": total,
                               "label": f"Cat : {cat.name}", "done": False,
                               "sourceGuild": ctx["src"], "targetGuild": ctx["tgt"]})
        await asyncio.sleep(DELAY["channel"])

    for j, ch in enumerate(others):
        _check_cancelled(job_id)
        overwrites = _translate_overwrites(ch, role_map)
        parent = channel_map.get(ch.category_id) if ch.category_id else None
        try:
            if isinstance(ch, (discord.VoiceChannel, discord.StageChannel)):
                kwargs = {"overwrites": overwrites, "position": ch.position, "reason": "Clone"}
                if parent:
                    kwargs["category"] = parent
                if getattr(ch, "bitrate", None):
                    kwargs["bitrate"] = min(ch.bitrate, 96000)
                if getattr(ch, "user_limit", None):
                    kwargs["user_limit"] = ch.user_limit
                created = await tgt.create_voice_channel(ch.name, **kwargs)
            else:
                kwargs = {"overwrites": overwrites, "position": ch.position, "reason": "Clone"}
                if parent:
                    kwargs["category"] = parent
                if getattr(ch, "topic", None):
                    kwargs["topic"] = ch.topic
                if getattr(ch, "nsfw", False):
                    kwargs["nsfw"] = ch.nsfw
                if getattr(ch, "slowmode_delay", 0):
                    kwargs["slowmode_delay"] = ch.slowmode_delay
                created = await tgt.create_text_channel(ch.name, **kwargs)
            channel_map[ch.id] = created
            push_log(f"💬 #{ch.name}")
        except Exception as e:  # noqa: BLE001
            push_log(f"⚠️ #{ch.name} ignoré : {e}")
        await _notify(job_id, {"step": "channels", "current": len(categories) + j + 1,
                               "total": total, "label": f"Salon : {ch.name}", "done": False,
                               "sourceGuild": ctx["src"], "targetGuild": ctx["tgt"]})
        await asyncio.sleep(DELAY["channel"])

    return channel_map


async def _clone_emojis(src, tgt, job_id, push_log, ctx):
    for e in list(tgt.emojis):
        _check_cancelled(job_id)
        try:
            await e.delete(reason="Clone")
        except Exception:
            pass
        await asyncio.sleep(0.4)

    emojis = list(src.emojis)
    if not emojis:
        return 0
    limit = _emoji_limit(tgt)
    to_clone = min(len(emojis), limit)
    push_log(f"😀 Clonage de {to_clone}/{len(emojis)} emoji(s) (limite {limit})…")
    await _notify(job_id, {"step": "emojis", "current": 0, "total": to_clone,
                           "label": f"Clonage des emojis… (limite {limit})", "done": False,
                           "sourceGuild": ctx["src"], "targetGuild": ctx["tgt"]})
    cloned = 0
    for i, emoji in enumerate(emojis):
        _check_cancelled(job_id)
        if cloned >= limit:
            push_log(f"🚫 Limite atteinte, {len(emojis) - i} ignorés.")
            break
        try:
            image = await _fetch_bytes(str(emoji.url))
            if not image:
                push_log(f'⚠️ "{emoji.name}" image introuvable')
            else:
                await tgt.create_custom_emoji(name=emoji.name, image=image, reason="Clone")
                cloned += 1
                push_log(f'✅ "{emoji.name}" ({cloned}/{to_clone})')
        except discord.HTTPException as e:
            if e.code == 30008:
                push_log(f"🚫 Limite Discord atteinte après {cloned} emoji(s).")
                break
            push_log(f'⚠️ "{emoji.name}" ignoré : {e}')
        except Exception as e:  # noqa: BLE001
            push_log(f'⚠️ "{emoji.name}" ignoré : {e}')
        await _notify(job_id, {"step": "emojis", "current": cloned, "total": to_clone,
                               "label": f"Emoji : {emoji.name}", "done": False,
                               "sourceGuild": ctx["src"], "targetGuild": ctx["tgt"]})
        await asyncio.sleep(DELAY["emoji"])
    return cloned


async def _clone_settings(src, tgt, channel_map, push_log):
    push_log("⚙️ Application des paramètres…")
    kwargs = {
        "name": src.name,
        "default_notifications": src.default_notifications,
        "explicit_content_filter": src.explicit_content_filter,
        "verification_level": src.verification_level,
        "reason": "Clone",
    }
    if src.icon:
        icon = await _fetch_bytes(str(src.icon.replace(size=512)))
        if icon:
            kwargs["icon"] = icon
    if src.afk_channel and src.afk_channel.id in channel_map:
        kwargs["afk_channel"] = channel_map[src.afk_channel.id]
        kwargs["afk_timeout"] = src.afk_timeout
    if src.system_channel and src.system_channel.id in channel_map:
        kwargs["system_channel"] = channel_map[src.system_channel.id]
    try:
        await tgt.edit(**kwargs)
        push_log("✅ Paramètres appliqués")
    except Exception as e:  # noqa: BLE001
        push_log(f"⚠️ Paramètres partiels : {e}")


async def _run_clone(client, source_id, target_id, options, job_id):
    _register(job_id)
    log_buffer = []

    def push_log(msg):
        log_buffer.append(msg)
        if len(log_buffer) > 8:
            log_buffer.pop(0)

    async def flush_logs(extra):
        await _notify(job_id, {**extra, "logs": "\n".join(log_buffer)})

    started = time.time()
    src = client.get_guild(int(source_id)) or await client.fetch_guild(int(source_id))
    tgt = client.get_guild(int(target_id)) or await client.fetch_guild(int(target_id))
    if not src:
        raise RuntimeError(f"Serveur source {source_id} introuvable.")
    if not tgt:
        raise RuntimeError(f"Serveur cible {target_id} introuvable.")

    ctx = {"src": src.name, "tgt": tgt.name}
    push_log(f'🚀 "{src.name}" → "{tgt.name}"')
    await _notify(job_id, {"step": "start", "sourceGuild": src.name, "targetGuild": tgt.name,
                           "current": 0, "total": 0, "label": "Initialisation…",
                           "logs": "\n".join(log_buffer), "jobId": job_id, "done": False})

    role_map, channel_map, emojis_cloned = {}, {}, 0
    try:
        if options["cloneRolesEnabled"]:
            role_map = await _clone_roles(src, tgt, job_id, push_log, ctx)
        else:
            role_map[src.id] = tgt.default_role
        await flush_logs({"step": "roles_done", "label": "Rôles terminés", "done": False,
                          "sourceGuild": ctx["src"], "targetGuild": ctx["tgt"]})

        if options["cloneChannelsEnabled"]:
            channel_map = await _clone_channels(src, tgt, role_map, job_id, push_log, ctx)
        await flush_logs({"step": "channels_done", "label": "Salons terminés", "done": False,
                          "sourceGuild": ctx["src"], "targetGuild": ctx["tgt"]})

        if options["cloneEmojisEnabled"]:
            emojis_cloned = await _clone_emojis(src, tgt, job_id, push_log, ctx)
        await flush_logs({"step": "emojis_done", "label": "Emojis terminés", "done": False,
                          "sourceGuild": ctx["src"], "targetGuild": ctx["tgt"]})

        if options["cloneSettingsEnabled"] and options["cloneChannelsEnabled"]:
            await _clone_settings(src, tgt, channel_map, push_log)
    except CancelledError:
        _clean(job_id)
        entry = {"sourceGuildId": source_id, "sourceGuildName": src.name,
                 "targetGuildId": target_id, "targetGuildName": tgt.name,
                 "cancelled": True, "success": False, "timestamp": _now_ms()}
        _push_clone_history(entry)
        await _notify(job_id, {"step": "done", "label": "Clonage annulé.",
                               "logs": "\n".join(log_buffer), "done": True,
                               "sourceGuild": ctx["src"], "targetGuild": ctx["tgt"],
                               "summary": {**entry, "rolesCloned": 0, "channelsCloned": 0,
                                           "emojisCloned": 0,
                                           "duration": round(time.time() - started)}})
        return

    duration = round(time.time() - started)
    push_log(f"🎉 Terminé en {duration}s !")
    summary = {"sourceGuildId": source_id, "sourceGuildName": src.name,
               "targetGuildId": target_id, "targetGuildName": tgt.name,
               "rolesCloned": (len(role_map) - 1) if options["cloneRolesEnabled"] else 0,
               "channelsCloned": len(channel_map) if options["cloneChannelsEnabled"] else 0,
               "emojisCloned": emojis_cloned if options["cloneEmojisEnabled"] else 0,
               "duration": duration, "timestamp": _now_ms(), "success": True, "cancelled": False}
    _push_clone_history(summary)
    _clean(job_id)
    await _notify(job_id, {"step": "done", "label": f"Clonage terminé en {duration}s",
                           "logs": "\n".join(log_buffer), "done": True,
                           "sourceGuild": ctx["src"], "targetGuild": ctx["tgt"], "summary": summary})
    return summary


async def _run_clone_bg(client, source_id, target_id, options, job_id):
    try:
        await _run_clone(client, source_id, target_id, options, job_id)
    except Exception as err:  # noqa: BLE001
        _push_clone_history({"sourceGuildId": source_id, "targetGuildId": target_id,
                             "success": False, "error": str(err), "timestamp": _now_ms()})
        await _notify(job_id, {"step": "error", "label": f"Erreur : {err}",
                               "logs": str(err), "done": True, "error": str(err)})


async def execute(client, payload):
    action = payload.get("action")

    if action == "listGuilds":
        guilds, _ = await _fetch_guilds(client, False)
        return {"guilds": guilds}

    if action == "clone.run":
        source_id = payload.get("sourceGuildId")
        target_id = payload.get("targetGuildId")
        if not source_id:
            raise ValueError("sourceGuildId requis.")
        if not target_id:
            raise ValueError("targetGuildId requis.")
        if source_id == target_id:
            raise ValueError("Les serveurs source et cible doivent être différents.")
        options = {
            "cloneRolesEnabled": payload.get("cloneRoles", True),
            "cloneChannelsEnabled": payload.get("cloneChannels", True),
            "cloneEmojisEnabled": payload.get("cloneEmojis", True),
            "cloneSettingsEnabled": payload.get("cloneSettings", True),
        }
        asyncio.get_event_loop().create_task(
            _run_clone_bg(client, source_id, target_id, options, payload.get("jobId")))
        return {"started": True}

    if action == "clone.cancel":
        job_id = payload.get("jobId")
        if not job_id:
            raise ValueError("jobId requis.")
        return {"cancelled": cancel_job(job_id)}

    if action == "clone.getHistory":
        return {"history": load_clone_history()}

    if action == "clone.clearHistory":
        save_clone_history([])
        return {"history": []}

    if action == "friends.get":
        data = load_backups_data()
        friends = data.get("friends") if isinstance(data.get("friends"), list) else None
        return {"friends": friends, "count": len(friends) if friends is not None else None,
                "savedAt": data.get("friendsSavedAt")}

    if action == "friends.backup":
        friends, source = await _fetch_friends(client)
        data = load_backups_data()
        data["friends"] = friends
        data["friendsSavedAt"] = _now_ms()
        save_backups_data(data)
        return {"friends": friends, "count": len(friends), "source": source,
                "savedAt": data["friendsSavedAt"]}

    if action == "friends.clearBackup":
        data = load_backups_data()
        data["friends"] = None
        data["friendsSavedAt"] = None
        save_backups_data(data)
        return {"cleared": True}

    if action == "guilds.get":
        data = load_backups_data()
        guilds = data.get("guilds") if isinstance(data.get("guilds"), list) else None
        return {"guilds": guilds, "count": len(guilds) if guilds is not None else None,
                "savedAt": data.get("guildsSavedAt")}

    if action == "guilds.backup":
        guilds, source = await _fetch_guilds(client, True)
        data = load_backups_data()
        data["guilds"] = guilds
        data["guildsSavedAt"] = _now_ms()
        save_backups_data(data)
        return {"guilds": guilds, "count": len(guilds), "source": source,
                "savedAt": data["guildsSavedAt"]}

    if action == "guilds.clearBackup":
        data = load_backups_data()
        data["guilds"] = None
        data["guildsSavedAt"] = None
        save_backups_data(data)
        return {"cleared": True}

    raise ValueError(f"Action backups inconnue : '{action}'")
