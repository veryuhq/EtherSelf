"""fun.spoiler — ||texte caché|| (bridge + commande préfixe)."""

from __future__ import annotations

from ...func.discord_util import fetch_channel
from ...func.message_edit import message_edit


async def execute(client, payload):
    channel_id = payload.get("channelId")
    text = payload.get("text")
    if not channel_id or not text:
        raise ValueError("channelId et text requis.")
    channel = await fetch_channel(client, channel_id)
    if not channel:
        raise ValueError(f"Salon {channel_id} introuvable.")
    spoilered = f"||{text}||"
    await channel.send(spoilered)
    return {"sent": spoilered}


async def callback(client, message, args):
    if not args:
        return await message_edit(message, "`❌` **Usage :** `.spoiler <texte>`")
    spoilered = f"||{' '.join(args)}||"
    return await message_edit(message, spoilered)
