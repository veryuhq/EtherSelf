"""purge — suppression des propres messages (salon / serveur / DMs / tous serveurs).

Progression et annulation relayées au bot-controller via POST /progress.
"""

from __future__ import annotations

import asyncio
import math

import aiohttp
import discord

from ...bridge.controller_client import post_progress
from ...func.client_token import get_token
from ...func.discord_util import fetch_channel, user_tag
from ...func.discord_headers import make_desktop_headers

PARALLEL_DELETE = 5
BATCH_DELAY = 0.05

_active_jobs: dict[str, dict] = {}


def register_job(job_id):
    if job_id:
        _active_jobs[job_id] = {"cancelled": False}


def cancel_job(job_id) -> bool:
    job = _active_jobs.get(job_id)
    if job:
        job["cancelled"] = True
        return True
    return False


def is_cancelled(job_id) -> bool:
    return bool(_active_jobs.get(job_id, {}).get("cancelled"))


def clean_job(job_id):
    _active_jobs.pop(job_id, None)


async def _notify(job_id, data):
    if job_id:
        await post_progress(job_id, data)


async def _has_own_messages(client, channel_id) -> bool:
    token = get_token(client)
    url = (f"https://discord.com/api/v9/channels/{channel_id}/messages/search"
           f"?author_id={client.user.id}&limit=1")
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=make_desktop_headers(token)) as res:
                if res.status == 404:
                    return False
                if res.status == 403:
                    return True
                if res.status >= 400:
                    return True
                data = await res.json(content_type=None)
                return (data.get("total_results") or 0) > 0
    except Exception:
        return True


async def _purge_channel(client, channel, limit=math.inf, job_id=None) -> int:
    deleted = 0
    before = None
    while deleted < limit:
        if job_id and is_cancelled(job_id):
            break
        batch = []
        try:
            async for msg in channel.history(limit=100, before=before):
                batch.append(msg)
        except Exception:
            break
        if not batch:
            break

        own = [m for m in batch if m.author.id == client.user.id]
        to_delete = own[: int(limit - deleted)] if limit != math.inf else own

        for i in range(0, len(to_delete), PARALLEL_DELETE):
            if job_id and is_cancelled(job_id):
                break
            group = to_delete[i:i + PARALLEL_DELETE]
            results = await asyncio.gather(*(m.delete() for m in group),
                                           return_exceptions=True)
            deleted += sum(1 for r in results if not isinstance(r, Exception))
            if i + PARALLEL_DELETE < len(to_delete):
                await asyncio.sleep(BATCH_DELAY)

        before = discord.Object(id=batch[-1].id)
        if len(batch) < 100:
            break

    return deleted


def _guild_text_channels(client, guild):
    channels = []
    for ch in guild.channels:
        try:
            if getattr(ch, "guild", None) and hasattr(ch, "history"):
                perms = ch.permissions_for(guild.me)
                if perms.view_channel:
                    channels.append(ch)
        except Exception:
            continue
    return channels


async def execute(client, payload):
    scope = payload.get("scope", "channel")
    job_id = payload.get("jobId")

    if scope == "cancel":
        if not job_id:
            raise ValueError("jobId requis pour annuler.")
        return {"cancelled": cancel_job(job_id)}

    if scope == "channel":
        channel_id = payload.get("channelId")
        amount = payload.get("amount")
        if not channel_id:
            raise ValueError("channelId requis.")
        channel = await fetch_channel(client, channel_id)
        if not channel:
            raise ValueError(f"Salon {channel_id} introuvable.")
        limit = min(max(int(amount), 1), 100) if amount else math.inf
        register_job(job_id)
        deleted = await _purge_channel(client, channel, limit, job_id)
        if job_id:
            clean_job(job_id)
            await _notify(job_id, {"scope": "channel", "queue": [], "activeLabel": None,
                                   "doneCount": 1, "total": 1, "totalDeleted": deleted,
                                   "done": True, "cancelled": False})
        return {"deleted": deleted, "scope": "channel"}

    if scope == "dms":
        dm_channels = [c for c in client.private_channels if isinstance(c, discord.DMChannel)]
        register_job(job_id)
        total_deleted = 0
        done_count = 0

        filtered = []
        CHECK = 10
        for i in range(0, len(dm_channels), CHECK):
            if is_cancelled(job_id):
                break
            batch = dm_channels[i:i + CHECK]
            checks = await asyncio.gather(*(_has_own_messages(client, c.id) for c in batch))
            filtered.extend(c for c, has in zip(batch, checks) if has)
            if i + CHECK < len(dm_channels):
                await asyncio.sleep(0.5)

        total = len(filtered)
        queue = [{"id": str(c.id),
                  "label": user_tag(getattr(c, "recipient", None)) or str(c.id)} for c in filtered]

        await _notify(job_id, {"scope": "dms", "queue": queue, "activeLabel": None,
                               "doneCount": 0, "total": total, "totalDeleted": 0,
                               "done": False, "cancelled": False})

        for i, ch in enumerate(filtered):
            if is_cancelled(job_id):
                await _notify(job_id, {"scope": "dms", "queue": queue[i:], "activeLabel": None,
                                       "doneCount": done_count, "total": total,
                                       "totalDeleted": total_deleted, "done": True,
                                       "cancelled": True})
                clean_job(job_id)
                return {"deleted": total_deleted, "scope": "dms", "cancelled": True}

            label = queue[i]["label"]
            remaining = queue[i + 1:]
            await _notify(job_id, {"scope": "dms", "queue": remaining, "activeLabel": label,
                                   "doneCount": done_count, "total": total,
                                   "totalDeleted": total_deleted, "done": False, "cancelled": False})
            total_deleted += await _purge_channel(client, ch, math.inf, job_id)
            done_count += 1
            await _notify(job_id, {"scope": "dms", "queue": remaining, "activeLabel": None,
                                   "doneCount": done_count, "total": total,
                                   "totalDeleted": total_deleted, "done": False, "cancelled": False})

        was_cancelled = is_cancelled(job_id)
        clean_job(job_id)
        await _notify(job_id, {"scope": "dms", "queue": [], "activeLabel": None,
                               "doneCount": done_count, "total": total,
                               "totalDeleted": total_deleted, "done": True,
                               "cancelled": was_cancelled})
        return {"deleted": total_deleted, "scope": "dms", "cancelled": was_cancelled}

    if scope == "guilds":
        guilds = list(client.guilds)
        register_job(job_id)
        total_deleted = 0
        done_count = 0
        total = len(guilds)
        queue = [{"id": str(g.id), "label": g.name or str(g.id)} for g in guilds]

        await _notify(job_id, {"scope": "guilds", "queue": queue, "activeLabel": None,
                               "doneCount": 0, "total": total, "totalDeleted": 0,
                               "done": False, "cancelled": False})

        for i, guild in enumerate(guilds):
            if is_cancelled(job_id):
                await _notify(job_id, {"scope": "guilds", "queue": queue[i:], "activeLabel": None,
                                       "doneCount": done_count, "total": total,
                                       "totalDeleted": total_deleted, "done": True,
                                       "cancelled": True})
                clean_job(job_id)
                return {"deleted": total_deleted, "scope": "guilds", "cancelled": True}

            label = queue[i]["label"]
            remaining = queue[i + 1:]
            await _notify(job_id, {"scope": "guilds", "queue": remaining, "activeLabel": label,
                                   "doneCount": done_count, "total": total,
                                   "totalDeleted": total_deleted, "done": False, "cancelled": False})

            for ch in _guild_text_channels(client, guild):
                if is_cancelled(job_id):
                    break
                if not await _has_own_messages(client, ch.id):
                    continue
                total_deleted += await _purge_channel(client, ch, math.inf, job_id)

            done_count += 1
            await _notify(job_id, {"scope": "guilds", "queue": remaining, "activeLabel": None,
                                   "doneCount": done_count, "total": total,
                                   "totalDeleted": total_deleted, "done": False, "cancelled": False})

        was_cancelled = is_cancelled(job_id)
        clean_job(job_id)
        await _notify(job_id, {"scope": "guilds", "queue": [], "activeLabel": None,
                               "doneCount": done_count, "total": total,
                               "totalDeleted": total_deleted, "done": True,
                               "cancelled": was_cancelled})
        return {"deleted": total_deleted, "scope": "guilds", "cancelled": was_cancelled}

    if scope == "guild":
        guild_id = payload.get("guildId")
        if not guild_id:
            raise ValueError("guildId requis.")
        guild = client.get_guild(int(guild_id))
        if not guild:
            try:
                guild = await client.fetch_guild(int(guild_id))
            except Exception:
                guild = None
        if not guild:
            raise ValueError(f"Serveur {guild_id} introuvable.")

        register_job(job_id)
        channels = _guild_text_channels(client, guild)
        total_deleted = 0
        done_count = 0
        total = len(channels)
        queue = [{"id": str(c.id), "label": getattr(c, "name", None) or str(c.id)} for c in channels]

        await _notify(job_id, {"scope": "guild", "guildName": guild.name, "queue": queue,
                               "activeLabel": None, "doneCount": 0, "total": total,
                               "totalDeleted": 0, "done": False, "cancelled": False})

        for i, ch in enumerate(channels):
            if is_cancelled(job_id):
                await _notify(job_id, {"scope": "guild", "guildName": guild.name,
                                       "queue": queue[i:], "activeLabel": None,
                                       "doneCount": done_count, "total": total,
                                       "totalDeleted": total_deleted, "done": True,
                                       "cancelled": True})
                clean_job(job_id)
                return {"deleted": total_deleted, "scope": "guild", "guildId": guild_id,
                        "cancelled": True}

            label = f"#{getattr(ch, 'name', ch.id)}"
            if not await _has_own_messages(client, ch.id):
                done_count += 1
                await _notify(job_id, {"scope": "guild", "guildName": guild.name,
                                       "queue": queue[i + 1:], "activeLabel": None,
                                       "doneCount": done_count, "total": total,
                                       "totalDeleted": total_deleted, "done": False,
                                       "cancelled": False})
                continue

            remaining = queue[i + 1:]
            await _notify(job_id, {"scope": "guild", "guildName": guild.name, "queue": remaining,
                                   "activeLabel": label, "doneCount": done_count, "total": total,
                                   "totalDeleted": total_deleted, "done": False, "cancelled": False})
            total_deleted += await _purge_channel(client, ch, math.inf, job_id)
            done_count += 1
            await _notify(job_id, {"scope": "guild", "guildName": guild.name, "queue": remaining,
                                   "activeLabel": None, "doneCount": done_count, "total": total,
                                   "totalDeleted": total_deleted, "done": False, "cancelled": False})

        was_cancelled = is_cancelled(job_id)
        clean_job(job_id)
        await _notify(job_id, {"scope": "guild", "guildName": guild.name, "queue": [],
                               "activeLabel": None, "doneCount": done_count, "total": total,
                               "totalDeleted": total_deleted, "done": True,
                               "cancelled": was_cancelled})
        return {"deleted": total_deleted, "scope": "guild", "guildId": guild_id,
                "cancelled": was_cancelled}

    raise ValueError(f"Scope purge inconnu : '{scope}'")
