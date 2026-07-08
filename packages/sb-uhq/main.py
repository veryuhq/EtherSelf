"""Point d'entrée du selfbot EtherSelf (discord.py-self).

Réécriture Python de packages/sb-uhq/index.js. Expose le même bridge HTTP local
(port BRIDGE_PORT) que le controller JS consomme, et redirige les logs vers lui.
"""

from __future__ import annotations

import os

from dotenv import load_dotenv

from app.func.data_path import ENV_FILE

load_dotenv(ENV_FILE)

import discord  # noqa: E402  (après load_dotenv)

from app.bridge.server import run_bridge_server  # noqa: E402
from app.commands.fun import mock, spoiler  # noqa: E402
from app.commands.gestion import antigroup, msglog, prefix  # noqa: E402
from app.commands.utilitaires import afk, autobump, quests, rpc, snapshot, tag  # noqa: E402
from app.commands.voice import joinvc  # noqa: E402
from app.func.logbus import enable_broadcast, log, logerr  # noqa: E402

PREFIX_COMMANDS = {"tag": tag, "mock": mock, "spoiler": spoiler}

client = discord.Client()

_ready_once = False
_bridge_runner = None


@client.event
async def on_ready():
    global _ready_once, _bridge_runner
    if _ready_once:
        return
    _ready_once = True

    log(f"[SB-UHQ] ✅  Connecté en tant que {client.user}")

    _bridge_runner = await run_bridge_server(client)

    # RPC + Custom Status
    rpc.on_ready(client)
    # Auto-rejoin vocal
    await joinvc.auto_rejoin(client)
    # Quests
    quests.on_ready(client)
    # Autobump
    autobump.on_ready(client)
    # Snapshots périodiques
    snapshot.on_ready(client)

    # À partir d'ici, log() est relayé au bot-controller via /log.
    enable_broadcast()


@client.event
async def on_message(message):
    # Messages des autres → réponse AFK éventuelle
    if message.author.id != client.user.id:
        try:
            await afk.handle_incoming_message(message, client)
        except Exception as err:  # noqa: BLE001
            logerr(f"[AFK] Erreur handleIncomingMessage : {err}")
        return

    # Mes propres messages → commandes préfixe
    current_prefix = prefix.load_prefix()
    if not message.content.startswith(current_prefix):
        return

    parts = message.content[len(current_prefix):].strip().split()
    if not parts:
        return
    command_name = parts[0].lower()
    args = parts[1:]

    cmd = PREFIX_COMMANDS.get(command_name)
    if cmd and hasattr(cmd, "callback"):
        try:
            await cmd.callback(client, message, args)
        except Exception as err:  # noqa: BLE001
            logerr(f"[CMD] Erreur '{command_name}': {err}")


@client.event
async def on_message_delete(message):
    try:
        await msglog.handle_message_delete(message, client)
    except Exception as err:  # noqa: BLE001
        logerr(f"[MSGLOG] delete : {err}")


@client.event
async def on_message_edit(before, after):
    try:
        await msglog.handle_message_edit(before, after, client)
    except Exception as err:  # noqa: BLE001
        logerr(f"[MSGLOG] edit : {err}")


@client.event
async def on_private_channel_create(channel):
    # Anti-Group DM (discord.py-self émet cet évènement pour les nouveaux groupes).
    try:
        await antigroup.handle_channel_create(client, channel)
    except Exception as err:  # noqa: BLE001
        logerr(f"[ANTIGROUP] channelCreate : {err}")


def main():
    token = os.environ.get("TOKEN")
    if not token:
        raise SystemExit("TOKEN manquant dans le fichier .env du selfbot.")
    client.run(token)


if __name__ == "__main__":
    main()
