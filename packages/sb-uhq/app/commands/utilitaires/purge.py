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
from ...func.data_path import data_path, read_json, write_json
from ...func.discord_util import fetch_channel, user_tag
from ...func.discord_headers import make_desktop_headers

PARALLEL_DELETE = 5
BATCH_DELAY = 0.05

# Découverte des DMs — un DM « fermé » (retiré de la liste de messages) reste
# intact côté serveur mais n'apparaît dans aucune liste : il faut le rouvrir
# pour y accéder. POST /users/@me/channels est fortement rate-limité, d'où les
# délais entre deux ouvertures / refermetures.
DM_OPEN_DELAY = 0.35
DM_CLOSE_DELAY = 0.25
# Fréquence des notifications de progression pendant la découverte.
DM_DISCOVERY_NOTIFY_EVERY = 5

# Recherche « ai-je écrit ici ? » : requêtes lancées en parallèle, pause entre
# deux lots, et tentatives max quand l'index de Discord n'est pas encore prêt.
SEARCH_BATCH = 10
SEARCH_BATCH_DELAY = 0.5
SEARCH_MAX_RETRIES = 4

# Exclusions de purge — serveurs / groupes DM / salons épargnés par les purges
# larges (serveur, tous serveurs, tous DMs). Persistées dans data/config/purge.json.
PURGE_FILE = data_path("config", "purge.json")

_DEFAULT_STATE = {"excluded": []}

# Types d'exclusion valides côté panel.
EXCL_KINDS = ("guild", "groupdm", "channel")

_active_jobs: dict[str, dict] = {}


def _load_state() -> dict:
    data = read_json(PURGE_FILE, dict(_DEFAULT_STATE))
    if not isinstance(data.get("excluded"), list):
        data["excluded"] = []
    return data


def _save_state(data) -> None:
    write_json(PURGE_FILE, data)


def _excluded_ids(state=None) -> set[str]:
    """Ensemble des IDs exclus (serveurs, groupes DM, salons confondus).

    Les IDs Discord étant uniques, une seule appartenance suffit à épargner
    aussi bien un serveur, un groupe DM qu'un salon.
    """
    state = state or _load_state()
    return {str(e.get("id")) for e in state["excluded"] if e.get("id")}


def _resolve_excl_label(client, kind, id_str) -> str:
    """Nom lisible d'une exclusion (best-effort, retombe sur l'ID)."""
    try:
        obj_id = int(id_str)
    except (TypeError, ValueError):
        return id_str
    try:
        if kind == "guild":
            guild = client.get_guild(obj_id)
            return guild.name if guild and guild.name else id_str
        channel = client.get_channel(obj_id)
        if channel is None:
            return id_str
        name = getattr(channel, "name", None)
        if name:
            return name if kind == "groupdm" else f"#{name}"
        recipients = getattr(channel, "recipients", None) or []
        if recipients:
            return ", ".join(user_tag(r) or str(r.id) for r in recipients[:3])
        recipient = getattr(channel, "recipient", None)
        return user_tag(recipient) or id_str
    except Exception:
        return id_str


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
    """Le compte a-t-il des messages dans ce salon ? (pré-filtre de purge)

    En cas de doute (erreur, index indisponible), retourne True : le salon sera
    parcouru pour rien au pire, alors qu'un faux négatif le sauterait
    définitivement — et laisserait des messages derrière.
    """
    token = get_token(client)
    url = (f"https://discord.com/api/v9/channels/{channel_id}/messages/search"
           f"?author_id={client.user.id}&limit=1")
    try:
        async with aiohttp.ClientSession() as session:
            for _ in range(SEARCH_MAX_RETRIES):
                async with session.get(url, headers=make_desktop_headers(token)) as res:
                    if res.status == 404:
                        return False
                    if res.status == 403:
                        return True
                    # 202 = index de recherche pas encore construit pour ce salon,
                    # 429 = rate-limit : dans les deux cas Discord renvoie un
                    # `retry_after` et la réponse ne contient aucun résultat.
                    if res.status in (202, 429):
                        data = await res.json(content_type=None) or {}
                        try:
                            wait = float(data.get("retry_after") or 1)
                        except (TypeError, ValueError):
                            wait = 1.0
                        await asyncio.sleep(min(max(wait, 0.5), 5))
                        continue
                    if res.status >= 400:
                        return True
                    data = await res.json(content_type=None)
                    return (data.get("total_results") or 0) > 0
        return True
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


def _dm_label(channel) -> str:
    """Libellé d'un DM ou groupe DM pour la file de progression."""
    recipient = getattr(channel, "recipient", None)
    if recipient:
        return user_tag(recipient) or str(channel.id)
    name = getattr(channel, "name", None)
    if name:
        return name
    recipients = getattr(channel, "recipients", None) or []
    if recipients:
        return ", ".join(user_tag(r) or str(r.id) for r in recipients[:3])
    return str(channel.id)


# ── Découverte des conversations privées ──────────────────────────────────────


def _is_private(channel) -> bool:
    return isinstance(channel, (discord.DMChannel, discord.GroupChannel))


async def _open_private_channels(client) -> dict[int, object]:
    """Conversations privées visibles dans la liste de messages.

    Cache de la gateway + `GET /users/@me/channels` : le READY peut omettre des
    conversations sur les gros comptes, la liste REST fait autorité.
    """
    channels = {c.id: c for c in client.private_channels if _is_private(c)}
    try:
        for channel in await client.fetch_private_channels():
            if _is_private(channel):
                channels.setdefault(channel.id, channel)
    except Exception:
        pass
    return channels


async def _closed_dm_candidates(client, known: dict) -> list[int]:
    """Interlocuteurs dont le DM est fermé (absent de la liste de messages).

    Fermer un DM ne supprime rien côté serveur : la conversation disparaît juste
    de la liste et d'`/users/@me/channels`, donc une purge basée sur cette seule
    liste laisse ces messages intacts. Aucun endpoint ne liste les DMs fermés :
    on reconstitue les interlocuteurs via les relations (amis, bloqués, demandes
    en attente) et les affinités (comptes les plus fréquentés), puis on rouvre
    le DM — ce qui restitue l'historique complet.
    """
    # Uniquement les DMs 1-à-1 : les membres d'un groupe DM ne disent rien de
    # l'état du DM privé qu'on a avec eux.
    seen = {client.user.id}
    for channel in known.values():
        if isinstance(channel, discord.DMChannel) and channel.recipient:
            seen.add(channel.recipient.id)

    candidates: list[int] = []

    def _add(user_id) -> None:
        if user_id and user_id not in seen:
            seen.add(user_id)
            candidates.append(user_id)

    try:
        for relationship in client.relationships:
            _add(getattr(getattr(relationship, "user", None), "id", None))
    except Exception:
        pass

    try:
        for affinity in await client.user_affinities():
            _add(getattr(affinity, "user_id", None))
    except Exception:
        pass

    return candidates


async def _reopen_dms(client, user_ids, job_id, on_progress) -> dict[int, object]:
    """Rouvre les DMs fermés des interlocuteurs donnés (best-effort)."""
    reopened: dict[int, object] = {}
    for i, user_id in enumerate(user_ids):
        if is_cancelled(job_id):
            break
        try:
            channel = await client.create_dm(discord.Object(id=user_id))
        except Exception:
            channel = None  # DM impossible (compte supprimé, bloqué, fermé aux inconnus)
        if channel is not None:
            reopened[channel.id] = channel
        if on_progress and (i + 1) % DM_DISCOVERY_NOTIFY_EVERY == 0:
            await on_progress(len(reopened))
        if i + 1 < len(user_ids):
            await asyncio.sleep(DM_OPEN_DELAY)
    return reopened


async def _close_dms(client, channels) -> None:
    """Referme les DMs rouverts pour la purge : la liste de messages retrouve
    son état d'origine, et l'historique reste intact côté serveur."""
    for channel in channels:
        # Jamais sur un groupe DM : `close()` y signifie quitter le groupe.
        if not isinstance(channel, discord.DMChannel):
            continue
        try:
            await channel.close()
        except Exception:
            pass
        await asyncio.sleep(DM_CLOSE_DELAY)


async def _purge_dms(client, job_id) -> dict:
    """Purge de toutes les conversations privées (DMs, groupes, DMs fermés)."""
    excluded = _excluded_ids()
    total_deleted = 0
    done_count = 0
    reopened_by_us: list = []

    async def _stage(stage, discovered, scanned=0):
        await _notify(job_id, {"scope": "dms", "stage": stage, "queue": [],
                               "activeLabel": None, "doneCount": 0, "total": 0,
                               "totalDeleted": 0, "discovered": discovered,
                               "scanned": scanned, "done": False, "cancelled": False})

    try:
        # 1. Conversations ouvertes (cache + REST), puis DMs fermés rouverts.
        known = await _open_private_channels(client)
        await _stage("discovery", len(known))

        candidates = await _closed_dm_candidates(client, known)
        reopened = await _reopen_dms(
            client, candidates, job_id,
            lambda count: _stage("discovery", len(known) + count),
        )
        reopened_by_us = [c for cid, c in reopened.items() if cid not in known]
        known.update(reopened)

        dm_channels = [c for cid, c in known.items() if str(cid) not in excluded]

        # 2. Pré-filtre : ne garder que les conversations où on a écrit.
        filtered = []
        for i in range(0, len(dm_channels), SEARCH_BATCH):
            if is_cancelled(job_id):
                break
            batch = dm_channels[i:i + SEARCH_BATCH]
            checks = await asyncio.gather(*(_has_own_messages(client, c.id) for c in batch))
            filtered.extend(c for c, has in zip(batch, checks) if has)
            await _stage("scan", len(dm_channels), min(i + SEARCH_BATCH, len(dm_channels)))
            if i + SEARCH_BATCH < len(dm_channels):
                await asyncio.sleep(SEARCH_BATCH_DELAY)

        total = len(filtered)
        queue = [{"id": str(c.id), "label": _dm_label(c)} for c in filtered]

        await _notify(job_id, {"scope": "dms", "queue": queue, "activeLabel": None,
                               "doneCount": 0, "total": total, "totalDeleted": 0,
                               "done": False, "cancelled": False})

        # 3. Purge conversation par conversation.
        for i, channel in enumerate(filtered):
            if is_cancelled(job_id):
                await _close_dms(client, reopened_by_us)
                reopened_by_us = []
                await _notify(job_id, {"scope": "dms", "queue": queue[i:], "activeLabel": None,
                                       "doneCount": done_count, "total": total,
                                       "totalDeleted": total_deleted, "done": True,
                                       "cancelled": True})
                return {"deleted": total_deleted, "scope": "dms", "cancelled": True}

            label = queue[i]["label"]
            remaining = queue[i + 1:]
            await _notify(job_id, {"scope": "dms", "queue": remaining, "activeLabel": label,
                                   "doneCount": done_count, "total": total,
                                   "totalDeleted": total_deleted, "done": False, "cancelled": False})
            total_deleted += await _purge_channel(client, channel, math.inf, job_id)
            done_count += 1
            await _notify(job_id, {"scope": "dms", "queue": remaining, "activeLabel": None,
                                   "doneCount": done_count, "total": total,
                                   "totalDeleted": total_deleted, "done": False, "cancelled": False})

        was_cancelled = is_cancelled(job_id)
        await _close_dms(client, reopened_by_us)
        reopened_by_us = []
        await _notify(job_id, {"scope": "dms", "queue": [], "activeLabel": None,
                               "doneCount": done_count, "total": total,
                               "totalDeleted": total_deleted, "done": True,
                               "cancelled": was_cancelled})
        return {"deleted": total_deleted, "scope": "dms", "cancelled": was_cancelled}
    finally:
        # Filet de sécurité : ne jamais laisser des DMs rouverts derrière soi.
        await _close_dms(client, reopened_by_us)
        clean_job(job_id)


async def execute(client, payload):
    scope = payload.get("scope", "channel")
    job_id = payload.get("jobId")

    if scope == "cancel":
        if not job_id:
            raise ValueError("jobId requis pour annuler.")
        return {"cancelled": cancel_job(job_id)}

    # ── Exclusions (serveurs / groupes DM / salons) ──────────────────────────
    if scope == "excl.list":
        return _load_state()

    if scope == "excl.add":
        excl_id = str(payload.get("id") or "").strip()
        kind = payload.get("kind") or "channel"
        if not excl_id:
            raise ValueError("ID requis.")
        if not excl_id.isdigit():
            raise ValueError("L'ID doit être numérique.")
        if kind not in EXCL_KINDS:
            kind = "channel"
        state = _load_state()
        if any(str(e.get("id")) == excl_id for e in state["excluded"]):
            raise ValueError("Cette exclusion existe déjà.")
        state["excluded"].append({
            "id": excl_id,
            "kind": kind,
            "label": _resolve_excl_label(client, kind, excl_id),
        })
        _save_state(state)
        return state

    if scope == "excl.remove":
        excl_id = str(payload.get("id") or "").strip()
        if not excl_id:
            raise ValueError("ID requis.")
        state = _load_state()
        before = len(state["excluded"])
        state["excluded"] = [e for e in state["excluded"] if str(e.get("id")) != excl_id]
        if len(state["excluded"]) == before:
            raise ValueError("Exclusion introuvable.")
        _save_state(state)
        return state

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
        register_job(job_id)
        return await _purge_dms(client, job_id)

    if scope == "guilds":
        excluded = _excluded_ids()
        guilds = [g for g in client.guilds if str(g.id) not in excluded]
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
                if str(ch.id) in excluded:
                    continue
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
        excluded = _excluded_ids()
        channels = [c for c in _guild_text_channels(client, guild) if str(c.id) not in excluded]
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
