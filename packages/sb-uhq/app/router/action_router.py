"""Routeur d'actions du bridge.

Chaque clé mappe un nom d'action (envoyé par le controller) vers un appel
`module.execute(client, payload_interne)`. Les noms d'actions, les clés de payload
et les formes de réponse forment le contrat du bridge : toute modification doit être
synchronisée côté controller.
"""

from __future__ import annotations

from ..commands.fun import mock, spoiler
from ..commands.gestion import antigroup, prefix, token
from ..commands.informations import hostinfo, ping, roles, uptime
from ..commands.utilitaires import (backups, bookmark, msgbookmarks,
                                    purge, quests, rpc, tag)

# action → async (client, payload) -> data
ACTIONS = {

    # ── PREFIX / TOKEN ──
    "prefix.set": lambda c, p: prefix.execute(c, {"action": "set", "prefix": p.get("prefix")}),
    "prefix.get": lambda c, p: prefix.execute(c, {"action": "get"}),
    "token.set": lambda c, p: token.execute(c, {"action": "set", "token": p.get("token"),
                                                "ownerIdConfirm": p.get("ownerIdConfirm")}),

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
    "backups.friends.backup": lambda c, p: backups.execute(c, {"action": "friends.backup"}),
    "backups.friends.get": lambda c, p: backups.execute(c, {"action": "friends.get"}),
    "backups.friends.clearBackup": lambda c, p: backups.execute(c, {"action": "friends.clearBackup"}),
    "backups.guilds.backup": lambda c, p: backups.execute(c, {"action": "guilds.backup"}),
    "backups.guilds.get": lambda c, p: backups.execute(c, {"action": "guilds.get"}),
    "backups.guilds.clearBackup": lambda c, p: backups.execute(c, {"action": "guilds.clearBackup"}),

    # ── FUN ──
    "fun.mock": lambda c, p: mock.execute(c, {"channelId": p.get("channelId"), "text": p.get("text")}),
    "fun.spoiler": lambda c, p: spoiler.execute(c, {"channelId": p.get("channelId"), "text": p.get("text")}),

    # ── RÔLES ──
    "roles.guildInfo": lambda c, p: roles.execute(c, {"action": "guildInfo", "guildId": p.get("guildId")}),
    "roles.listRoles": lambda c, p: roles.execute(c, {"action": "listRoles", "guildId": p.get("guildId")}),
    "roles.memberRoles": lambda c, p: roles.execute(c, {"action": "memberRoles", "guildId": p.get("guildId"), "userId": p.get("userId")}),
    "roles.roleMembers": lambda c, p: roles.execute(c, {"action": "roleMembers", "guildId": p.get("guildId"), "roleId": p.get("roleId"), "deep": p.get("deep")}),

    # ── INFORMATIONS ──
    "info.ping": lambda c, p: ping.execute(c),
    "info.uptime": lambda c, p: uptime.execute(c),
    "info.hostinfo": lambda c, p: hostinfo.execute(c),

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
