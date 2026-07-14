"""Routeur d'actions du bridge — port fidèle de src/router/action-router.js.

Chaque clé mappe un nom d'action (envoyé par le controller) vers un appel
`module.execute(client, payload_interne)`. Les noms d'actions, les clés de payload
et les formes de réponse sont conservés à l'identique pour ne rien casser côté controller.
"""

from __future__ import annotations

from ..commands.fun import mock, spoiler
from ..commands.gestion import antigroup, msglog, prefix, token
from ..commands.informations import hostinfo, ping, uptime
from ..commands.utilitaires import (afk, autobump, backups, bookmark, msgbookmarks,
                                     purge, quests, rpc, snapshot, snipe, tag)
from ..commands.voice import joinvc

# action → async (client, payload) -> data
ACTIONS = {
    # ── AFK ──
    "afk.toggle": lambda c, p: afk.execute(c, {"action": "toggle"}),
    "afk.setReason": lambda c, p: afk.execute(c, {"action": "setReason", "reason": p.get("reason")}),
    "afk.setMessage": lambda c, p: afk.execute(c, {"action": "setMessage", "message": p.get("message")}),
    "afk.addExclusion": lambda c, p: afk.execute(c, {"action": "addExclusion", "userId": p.get("userId")}),
    "afk.removeExclusion": lambda c, p: afk.execute(c, {"action": "removeExclusion", "userId": p.get("userId")}),
    "afk.getState": lambda c, p: afk.execute(c, {"action": "getState"}),

    # ── PREFIX / TOKEN ──
    "prefix.set": lambda c, p: prefix.execute(c, {"action": "set", "prefix": p.get("prefix")}),
    "prefix.get": lambda c, p: prefix.execute(c, {"action": "get"}),
    "token.set": lambda c, p: token.execute(c, {"action": "set", "token": p.get("token"),
                                                "ownerIdConfirm": p.get("ownerIdConfirm")}),

    # ── SNIPE ──
    "snipe.addGuild": lambda c, p: snipe.execute(c, {"action": "addGuild", "guildId": p.get("guildId")}),
    "snipe.removeGuild": lambda c, p: snipe.execute(c, {"action": "removeGuild", "guildId": p.get("guildId")}),
    "snipe.getWhitelist": lambda c, p: snipe.execute(c, {"action": "getWhitelist"}),
    "snipe.getMessages": lambda c, p: snipe.execute(c, {"action": "getMessages", "channelId": p.get("channelId"), "type": p.get("type")}),
    "snipe.getMessagesByGuild": lambda c, p: snipe.execute(c, {"action": "getMessagesByGuild", "guildId": p.get("guildId"), "type": p.get("type")}),
    "snipe.getMessagesByUser": lambda c, p: snipe.execute(c, {"action": "getMessagesByUser", "userId": p.get("userId"), "type": p.get("type")}),

    # ── TAGS ──
    "tag.add": lambda c, p: tag.execute(c, {"action": "add", "name": p.get("name"), "content": p.get("content")}),
    "tag.remove": lambda c, p: tag.execute(c, {"action": "remove", "name": p.get("name")}),
    "tag.edit": lambda c, p: tag.execute(c, {"action": "edit", "name": p.get("name"), "content": p.get("content")}),
    "tag.list": lambda c, p: tag.execute(c, {"action": "list"}),
    "tag.send": lambda c, p: tag.execute(c, {"action": "send", "name": p.get("name"), "channelId": p.get("channelId")}),

    # ── BOOKMARKS SALONS ──
    "bookmark.add": lambda c, p: bookmark.execute(c, {"action": "add", "channelId": p.get("channelId")}),
    "bookmark.remove": lambda c, p: bookmark.execute(c, {"action": "remove", "channelId": p.get("channelId")}),
    "bookmark.list": lambda c, p: bookmark.execute(c, {"action": "list"}),

    # ── BOOKMARKS MESSAGES ──
    "msgbm.list": lambda c, p: msgbookmarks.execute(c, {"action": "list"}),
    "msgbm.add": lambda c, p: msgbookmarks.execute(c, {"action": "add", "url": p.get("url"), "note": p.get("note")}),
    "msgbm.remove": lambda c, p: msgbookmarks.execute(c, {"action": "remove", "index": p.get("index")}),
    "msgbm.note": lambda c, p: msgbookmarks.execute(c, {"action": "note", "index": p.get("index"), "note": p.get("note")}),
    "msgbm.clear": lambda c, p: msgbookmarks.execute(c, {"action": "clear"}),

    # ── ANTIGROUP ──
    "antigroup.toggle": lambda c, p: antigroup.execute(c, {"action": "toggle"}),
    "antigroup.getState": lambda c, p: antigroup.execute(c, {"action": "getState"}),
    "antigroup.leaveAll": lambda c, p: antigroup.execute(c, {"action": "leaveAll"}),

    # ── AUTOBUMP ──
    "autobump.add": lambda c, p: autobump.execute(c, {"action": "add", "guildId": p.get("guildId"), "channelId": p.get("channelId"), "appId": p.get("appId"), "commandName": p.get("commandName")}),
    "autobump.remove": lambda c, p: autobump.execute(c, {"action": "remove", "guildId": p.get("guildId"), "channelId": p.get("channelId")}),
    "autobump.start": lambda c, p: autobump.execute(c, {"action": "start"}),
    "autobump.stop": lambda c, p: autobump.execute(c, {"action": "stop"}),
    "autobump.list": lambda c, p: autobump.execute(c, {"action": "list"}),

    # ── MSGLOG ──
    "msglog.add": lambda c, p: msglog.execute(c, {"action": "add", "guildId": p.get("guildId")}),
    "msglog.remove": lambda c, p: msglog.execute(c, {"action": "remove", "guildId": p.get("guildId")}),
    "msglog.list": lambda c, p: msglog.execute(c, {"action": "list"}),

    # ── RPC + Custom Status ──
    "rpc.getState": lambda c, p: rpc.execute(c, {"action": "getState"}),
    "rpc.toggle": lambda c, p: rpc.execute(c, {"action": "toggle"}),
    "rpc.setStatus": lambda c, p: rpc.execute(c, {"action": "setStatus", "status": p.get("status")}),
    "rpc.setMode": lambda c, p: rpc.execute(c, {"action": "setMode", "mode": p.get("mode")}),
    "rpc.setInterval": lambda c, p: rpc.execute(c, {"action": "setInterval", "intervalSec": p.get("intervalSec")}),
    "rpc.addActivity": lambda c, p: rpc.execute(c, {"action": "addActivity", "activity": p.get("activity")}),
    "rpc.editActivity": lambda c, p: rpc.execute(c, {"action": "editActivity", "index": p.get("index"), "activity": p.get("activity")}),
    "rpc.setPlatform": lambda c, p: rpc.execute(c, {"action": "setPlatform", "index": p.get("index"), "platform": p.get("platform")}),
    "rpc.editButtons": lambda c, p: rpc.execute(c, {"action": "editButtons", "index": p.get("index"), "buttonAction": p.get("buttonAction"), "buttonIndex": p.get("buttonIndex"), "label": p.get("label"), "url": p.get("url")}),
    "rpc.editAssets": lambda c, p: rpc.execute(c, {"action": "editAssets", "index": p.get("index"), "assets": p.get("assets")}),
    "rpc.setActivityTimestamps": lambda c, p: rpc.execute(c, {"action": "setActivityTimestamps", "index": p.get("index"), "start": p.get("start"), "end": p.get("end")}),
    "rpc.removeActivity": lambda c, p: rpc.execute(c, {"action": "removeActivity", "index": p.get("index")}),
    "rpc.moveActivity": lambda c, p: rpc.execute(c, {"action": "moveActivity", "index": p.get("index"), "direction": p.get("direction")}),
    "rpc.clearActivities": lambda c, p: rpc.execute(c, {"action": "clearActivities"}),
    "rpc.applyNow": lambda c, p: rpc.execute(c, {"action": "applyNow"}),
    "rpc.setApplicationId": lambda c, p: rpc.execute(c, {"action": "setApplicationId", "applicationId": p.get("applicationId")}),
    "rpc.setSpotifyConfig": lambda c, p: rpc.execute(c, {"action": "setSpotifyConfig", "enabled": p.get("enabled"), "songId": p.get("songId"), "albumId": p.get("albumId"), "artistIds": p.get("artistIds"), "details": p.get("details"), "state": p.get("state")}),
    "rpc.setSpotifyAssets": lambda c, p: rpc.execute(c, {"action": "setSpotifyAssets", "assets": p.get("assets")}),
    "rpc.setSpotifyTimestamps": lambda c, p: rpc.execute(c, {"action": "setSpotifyTimestamps", "start": p.get("start"), "end": p.get("end")}),
    "rpc.setSpotifyExtras": lambda c, p: rpc.execute(c, {"action": "setSpotifyExtras", "applicationId": p.get("applicationId"), "platform": p.get("platform"), "url": p.get("url")}),
    "rpc.csToggle": lambda c, p: rpc.execute(c, {"action": "csToggle"}),
    "rpc.csAdd": lambda c, p: rpc.execute(c, {"action": "csAdd", "emoji": p.get("emoji"), "text": p.get("text")}),
    "rpc.csEdit": lambda c, p: rpc.execute(c, {"action": "csEdit", "index": p.get("index"), "emoji": p.get("emoji"), "text": p.get("text")}),
    "rpc.csRemove": lambda c, p: rpc.execute(c, {"action": "csRemove", "index": p.get("index")}),
    "rpc.csClear": lambda c, p: rpc.execute(c, {"action": "csClear"}),
    "rpc.setCsInterval": lambda c, p: rpc.execute(c, {"action": "setCsInterval", "intervalSec": p.get("intervalSec")}),

    # ── SNAPSHOT ──
    "snapshot.run": lambda c, p: snapshot.execute(c, {"action": "snapshot", "channelId": p.get("channelId"), "limit": p.get("limit", 0), "sendToChannelId": p.get("sendToChannelId"), "jobId": p.get("jobId")}),
    "snapshot.periodic.list": lambda c, p: snapshot.execute(c, {"action": "periodic.list"}),
    "snapshot.periodic.add": lambda c, p: snapshot.execute(c, {"action": "periodic.add", "channelId": p.get("channelId"), "interval": p.get("interval"), "limit": p.get("limit", 0), "sendToChannelId": p.get("sendToChannelId")}),
    "snapshot.periodic.remove": lambda c, p: snapshot.execute(c, {"action": "periodic.remove", "channelId": p.get("channelId")}),
    "snapshot.periodic.start": lambda c, p: snapshot.execute(c, {"action": "periodic.start"}),
    "snapshot.periodic.stop": lambda c, p: snapshot.execute(c, {"action": "periodic.stop"}),

    # ── QUESTS ──
    "quests.getConfig": lambda c, p: quests.execute(c, {"action": "getConfig"}),
    "quests.toggle": lambda c, p: quests.execute(c, {"action": "toggle"}),
    "quests.setInterval": lambda c, p: quests.execute(c, {"action": "setInterval", "intervalMin": p.get("intervalMin")}),
    "quests.list": lambda c, p: quests.execute(c, {"action": "list"}),
    "quests.run": lambda c, p: quests.execute(c, {"action": "run"}),
    "quests.getHistory": lambda c, p: quests.execute(c, {"action": "getHistory"}),
    "quests.clearHistory": lambda c, p: quests.execute(c, {"action": "clearHistory"}),

    # ── BACKUPS ──
    "backups.listGuilds": lambda c, p: backups.execute(c, {"action": "listGuilds"}),
    "backups.clone.run": lambda c, p: backups.execute(c, {"action": "clone.run", "sourceGuildId": p.get("sourceGuildId"), "targetGuildId": p.get("targetGuildId"), "cloneRoles": p.get("cloneRoles"), "cloneChannels": p.get("cloneChannels"), "cloneEmojis": p.get("cloneEmojis"), "cloneSettings": p.get("cloneSettings"), "jobId": p.get("jobId")}),
    "backups.clone.cancel": lambda c, p: backups.execute(c, {"action": "clone.cancel", "jobId": p.get("jobId")}),
    "backups.clone.getHistory": lambda c, p: backups.execute(c, {"action": "clone.getHistory"}),
    "backups.clone.clearHistory": lambda c, p: backups.execute(c, {"action": "clone.clearHistory"}),
    "backups.friends.backup": lambda c, p: backups.execute(c, {"action": "friends.backup"}),
    "backups.friends.get": lambda c, p: backups.execute(c, {"action": "friends.get"}),
    "backups.friends.clearBackup": lambda c, p: backups.execute(c, {"action": "friends.clearBackup"}),
    "backups.guilds.backup": lambda c, p: backups.execute(c, {"action": "guilds.backup"}),
    "backups.guilds.get": lambda c, p: backups.execute(c, {"action": "guilds.get"}),
    "backups.guilds.clearBackup": lambda c, p: backups.execute(c, {"action": "guilds.clearBackup"}),

    # ── FUN ──
    "fun.mock": lambda c, p: mock.execute(c, {"channelId": p.get("channelId"), "text": p.get("text")}),
    "fun.spoiler": lambda c, p: spoiler.execute(c, {"channelId": p.get("channelId"), "text": p.get("text")}),

    # ── INFORMATIONS ──
    "info.ping": lambda c, p: ping.execute(c),
    "info.uptime": lambda c, p: uptime.execute(c),
    "info.hostinfo": lambda c, p: hostinfo.execute(c),

    # ── VOICE ──
    "voice.join": lambda c, p: joinvc.execute(c, {"channelId": p.get("channelId")}),
    "voice.leave": lambda c, p: joinvc.execute(c, {"action": "leave", "channelId": p.get("channelId")}),
    "voice.move": lambda c, p: joinvc.execute(c, {"action": "move", "channelId": p.get("channelId")}),
    "voice.getState": lambda c, p: joinvc.execute(c, {"action": "getState"}),
    "voice.getConfig": lambda c, p: joinvc.execute(c, {"action": "getConfig"}),

    # ── PURGE ──
    "purge.channel": lambda c, p: purge.execute(c, {"scope": "channel", "channelId": p.get("channelId"), "amount": p.get("amount"), "jobId": p.get("jobId")}),
    "purge.guild": lambda c, p: purge.execute(c, {"scope": "guild", "guildId": p.get("guildId"), "jobId": p.get("jobId")}),
    "purge.dms": lambda c, p: purge.execute(c, {"scope": "dms", "jobId": p.get("jobId")}),
    "purge.guilds": lambda c, p: purge.execute(c, {"scope": "guilds", "jobId": p.get("jobId")}),
    "purge.cancel": lambda c, p: purge.execute(c, {"scope": "cancel", "jobId": p.get("jobId")}),
    "purge.getExclusions": lambda c, p: purge.execute(c, {"scope": "excl.list"}),
    "purge.addExclusion": lambda c, p: purge.execute(c, {"scope": "excl.add", "id": p.get("id"), "kind": p.get("kind")}),
    "purge.removeExclusion": lambda c, p: purge.execute(c, {"scope": "excl.remove", "id": p.get("id")}),
}


async def dispatch(client, action, payload):
    handler = ACTIONS.get(action)
    if not handler:
        raise ValueError(f"Action inconnue : '{action}'")
    return await handler(client, payload or {})
