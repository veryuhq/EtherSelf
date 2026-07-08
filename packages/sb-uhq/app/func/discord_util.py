"""Helpers de résolution d'objets Discord (cache → fetch), partagés entre modules."""

from __future__ import annotations


async def fetch_channel(client, channel_id):
    if channel_id is None:
        return None
    try:
        cid = int(channel_id)
    except (TypeError, ValueError):
        return None
    channel = client.get_channel(cid)
    if channel:
        return channel
    try:
        return await client.fetch_channel(cid)
    except Exception:
        return None


def user_tag(user) -> str | None:
    if not user:
        return None
    discriminator = getattr(user, "discriminator", "0")
    username = getattr(user, "name", None) or getattr(user, "username", None)
    if username and discriminator and discriminator != "0":
        return f"{username}#{discriminator}"
    return username or getattr(user, "global_name", None) or str(getattr(user, "id", "")) or None


async def resolve_channel_name(client, channel_id):
    channel = await fetch_channel(client, channel_id)
    if not channel:
        return None
    name = getattr(channel, "name", None)
    if name:
        return name
    recipient = getattr(channel, "recipient", None)
    return user_tag(recipient)


async def resolve_guild_name(client, guild_id):
    if guild_id is None:
        return None
    try:
        gid = int(guild_id)
    except (TypeError, ValueError):
        return None
    guild = client.get_guild(gid)
    if not guild:
        try:
            guild = await client.fetch_guild(gid)
        except Exception:
            return None
    return getattr(guild, "name", None) if guild else None


async def resolve_user_tag(client, user_id):
    if user_id is None:
        return None
    try:
        uid = int(user_id)
    except (TypeError, ValueError):
        return None
    user = client.get_user(uid)
    if not user:
        try:
            user = await client.fetch_user(uid)
        except Exception:
            return None
    return user_tag(user)
