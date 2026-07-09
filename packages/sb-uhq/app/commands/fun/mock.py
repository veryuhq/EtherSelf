"""fun.mock — tExTe En MoDe MoCk (bridge + commande préfixe)."""

from __future__ import annotations

from ...func.discord_util import fetch_channel
from ...func.message_edit import message_edit


def mock_text(text: str) -> str:
    return "".join(c.lower() if i % 2 == 0 else c.upper() for i, c in enumerate(text))


async def execute(client, payload):
    channel_id = payload.get("channelId")
    text = payload.get("text")
    if not channel_id or not text:
        raise ValueError("channelId et text requis.")
    channel = await fetch_channel(client, channel_id)
    if not channel:
        raise ValueError(f"Salon {channel_id} introuvable.")
    mocked = mock_text(text)
    await channel.send(mocked)
    return {"sent": mocked}


async def callback(client, message, args):
    if not args:
        return await message_edit(message, "`❌` **Usage :** `.mock <texte>`")
    mocked = mock_text(" ".join(args))
    return await message_edit(message, mocked)
