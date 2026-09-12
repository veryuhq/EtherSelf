"""backups — sauvegarde de la liste d'amis et de la liste de serveurs
(avec invitations permanentes).
"""

from __future__ import annotations

import asyncio
import time

import aiohttp
import discord

from ...func.client_token import get_token
from ...func.data_path import data_path, read_json, write_json
from ...func.discord_headers import make_desktop_headers
from ...func.discord_util import user_tag

BACKUPS_FILE = data_path("logs", "backups_data.json")

DELAY = {"invite": 5.0}

def _now_ms() -> int:
    return int(time.time() * 1000)

def load_backups_data() -> dict:
    return read_json(BACKUPS_FILE, {"friends": None, "guilds": None,
                                    "friendsSavedAt": None, "guildsSavedAt": None})


def save_backups_data(data) -> None:
    write_json(BACKUPS_FILE, data)

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

async def _resolve_guild_invite(guild):
    """Résout une invitation permanente pour un serveur, en limitant les requêtes.

    Renvoie ``(invite_url | None, made_request)``. ``made_request`` indique si l'API
    Discord a réellement été sollicitée, afin que l'appelant n'espace les requêtes que
    lorsque c'est nécessaire (et évite ainsi la vague de 429 lors du backup de serveurs).
    """
    me = guild.me
    if me is None:
        return None, False

    made_request = False

    # Réutiliser une invitation permanente existante — évite d'en créer une nouvelle.
    # guild.invites() nécessite « Gérer le serveur » : on ne l'appelle que si on l'a.
    if me.guild_permissions.manage_guild:
        try:
            existing = await guild.invites()
            made_request = True
            own = next((i for i in existing if i.max_age == 0
                        and i.inviter and i.inviter.id == guild.me.id), None)
            any_perm = next((i for i in existing if i.max_age == 0), None)
            url = (own.url if own else None) or (any_perm.url if any_perm else None)
            if url:
                return url, made_request
        except Exception:
            pass

    # Ne tenter la création que sur les salons où l'on a réellement la permission :
    # inutile d'envoyer des POST voués à échouer (chaque échec compte dans le rate limit).
    # Les salons d'annonces sont des TextChannel (is_news()) dans discord.py-self.
    channels = [c for c in guild.channels
                if isinstance(c, discord.TextChannel)
                and c.permissions_for(me).create_instant_invite]
    if not channels:
        return None, made_request

    # discord.py-self expose la propriété system_channel (objet), pas system_channel_id.
    sys_id = guild.system_channel.id if guild.system_channel else None

    def sort_key(c):
        if c.id == sys_id:
            return (-1, 0)
        return (0, getattr(c, "position", 0))

    for channel in sorted(channels, key=sort_key):
        try:
            invite = await channel.create_invite(max_age=0, max_uses=0, unique=False,
                                                 reason="Backup EtherSelf")
            made_request = True
            if invite and invite.code:
                return f"https://discord.gg/{invite.code}", made_request
        except Exception:
            made_request = True
            continue
    return None, made_request


async def _fetch_guilds(client, with_invites=False):
    guilds = []
    for guild in client.guilds:
        invite = None
        made_request = False
        if with_invites:
            invite, made_request = await _resolve_guild_invite(guild)
        guilds.append({
            "id": str(guild.id), "name": guild.name,
            "icon": str(guild.icon.replace(size=64)) if guild.icon else None,
            "ownerId": str(guild.owner_id) if guild.owner_id else None,
            "isOwner": guild.owner_id == client.user.id,
            "invite": invite,
        })
        # N'espacer que lorsqu'une requête a effectivement été émise : les serveurs
        # sans permission ou avec invitation en cache ne ralentissent pas le backup.
        if made_request:
            await asyncio.sleep(DELAY["invite"])
    return guilds, "cache"

async def execute(client, payload):
    action = payload.get("action")

    if action == "listGuilds":
        guilds, _ = await _fetch_guilds(client, False)
        return {"guilds": guilds}

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
