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

from app.func import platform_identity  # noqa: E402

# Force l'identité de plateforme (Desktop par défaut) AVANT toute connexion :
# sinon discord.py-self s'identifie comme le client Web (browser="Chrome").
# Surchargeable via la variable d'env SB_CLIENT_PLATFORM (desktop|web|android|ios).
platform_identity.install()

from app.bridge.server import run_bridge_server  # noqa: E402
from app.commands.fun import mock, spoiler  # noqa: E402
from app.commands.gestion import antigroup, msglog, prefix  # noqa: E402
from app.commands.utilitaires import afk, quests, rpc, snapshot, tag  # noqa: E402
from app.func import shutdown  # noqa: E402
from app.func.logbus import enable_broadcast, log, logerr  # noqa: E402

PREFIX_COMMANDS = {"tag": tag, "mock": mock, "spoiler": spoiler}

# Cache de messages élargi (défaut : 1000, tous salons confondus) pour que le
# snipe retrouve le contenu des messages supprimés/édités le plus souvent possible.
# La version JS gardait ~200 messages PAR salon ; ici le cache est global, donc on
# vise large (~20-60 Mo de RAM).
client = discord.Client(max_messages=20000)

_ready_once = False
_bridge_runner = None


@client.event
async def on_ready():
    global _ready_once, _bridge_runner
    if not _ready_once:
        _ready_once = True

        log(f"[SB-UHQ] ✅  Connecté en tant que {client.user}")

        _bridge_runner = await run_bridge_server(client)

        # RPC + Custom Status
        rpc.on_ready(client)
        # Quests
        quests.on_ready(client)
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


# Événements raw : contrairement à on_message_delete/on_message_edit, ils se
# déclenchent aussi pour les messages absents du cache interne (l'équivalent des
# partials de la version JS), sans quoi la plupart des suppressions en serveur
# ne seraient jamais loggées.
@client.event
async def on_raw_message_delete(payload):
    try:
        await msglog.handle_raw_message_delete(payload, client)
    except Exception as err:  # noqa: BLE001
        logerr(f"[MSGLOG] delete : {err}")


@client.event
async def on_raw_message_edit(payload):
    try:
        await msglog.handle_raw_message_edit(payload, client)
    except Exception as err:  # noqa: BLE001
        logerr(f"[MSGLOG] edit : {err}")


@client.event
async def on_private_channel_create(channel):
    # Anti-Group DM — discord.py-self émet private_channel_create(channel).
    try:
        await antigroup.handle_channel_create(client, channel)
    except Exception as err:  # noqa: BLE001
        logerr(f"[ANTIGROUP] private_channel_create : {err}")


@client.event
async def on_group_join(channel, user):
    # Fallback : ajout à un groupe DM existant → group_join(channel, user).
    try:
        await antigroup.handle_channel_create(client, channel)
    except Exception as err:  # noqa: BLE001
        logerr(f"[ANTIGROUP] group_join : {err}")


def main():
    token = os.environ.get("TOKEN")
    if not token:
        raise SystemExit("TOKEN manquant dans le fichier .env du selfbot.")
    # SIGINT/SIGTERM (pm2 stop/restart/max_memory_restart) → sortie brutale
    # sans close 1000, comme l'ancienne version JS : Discord garde la session
    # et le compte reste affiché en ligne pendant le redémarrage
    # (voir app/func/shutdown.py).
    shutdown.install()
    client.run(token)


if __name__ == "__main__":
    main()
