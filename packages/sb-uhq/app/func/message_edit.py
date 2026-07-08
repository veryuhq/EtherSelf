"""Édite un message du selfbot ; retombe sur un envoi si l'édition échoue (DM, etc.)."""

from __future__ import annotations


async def message_edit(message, content: str):
    try:
        return await message.edit(content=content)
    except Exception:
        try:
            return await message.channel.send(content)
        except Exception:
            return None
