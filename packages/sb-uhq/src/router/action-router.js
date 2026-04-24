"use strict";

const afk       = require("../self/commands/utilitaires/afk");
const snipe     = require("../self/commands/utilitaires/snipe");
const stalk     = require("../self/commands/utilitaires/stalk");
const tag       = require("../self/commands/utilitaires/tag");
const bookmark  = require("../self/commands/utilitaires/bookmark");
const msgbm     = require("../self/commands/utilitaires/msgbookmarks");
const autobump  = require("../self/commands/utilitaires/autobump");
const purge     = require("../self/commands/utilitaires/purge");
const nitro     = require("../self/commands/utilitaires/nitro");
const rpc       = require("../self/commands/utilitaires/rpc");
const quests    = require("../self/commands/utilitaires/quests");
const snapshot  = require("../self/commands/utilitaires/snapshot");
const clone     = require("../self/commands/utilitaires/clone");
const prefix    = require("../self/commands/gestion/prefix");
const antigroup = require("../self/commands/gestion/antigroup");
const msglog    = require("../self/commands/gestion/msglog");
const gunslol   = require("../self/commands/fun/gunslol");
const mock      = require("../self/commands/fun/mock");
const spoiler   = require("../self/commands/fun/spoiler");
const ping      = require("../self/commands/informations/ping");
const uptime    = require("../self/commands/informations/uptime");
const hostinfo  = require("../self/commands/informations/hostinfo");
const joinvc    = require("../self/commands/voice/joinvc");

const ACTIONS = {
  // ── AFK ──────────────────────────────────────────────────────────────────
  "afk.toggle":         (c, p) => afk.execute(c, { action: "toggle" }),
  "afk.toggleSpecial":  (c, p) => afk.execute(c, { action: "toggleSpecial" }),
  "afk.setReason":      (c, p) => afk.execute(c, { action: "setReason",      reason:  p.reason }),
  "afk.setMsgNormal":   (c, p) => afk.execute(c, { action: "setMsgNormal",   message: p.message }),
  "afk.setMsgSpecial":  (c, p) => afk.execute(c, { action: "setMsgSpecial",  message: p.message }),
  "afk.addExclusion":   (c, p) => afk.execute(c, { action: "addExclusion",   userId:  p.userId }),
  "afk.removeExclusion":(c, p) => afk.execute(c, { action: "removeExclusion",userId:  p.userId }),
  "afk.getState":       (c, p) => afk.execute(c, { action: "getState" }),

  // ── PREFIX ───────────────────────────────────────────────────────────────
  "prefix.set":         (c, p) => prefix.execute(c, { action: "set", prefix: p.prefix }),
  "prefix.get":         (c, p) => prefix.execute(c, { action: "get" }),

  // ── SNIPE / MSGLOG ────────────────────────────────────────────────────────
  "snipe.addGuild":          (c, p) => snipe.execute(c, { action: "addGuild",          guildId:   p.guildId }),
  "snipe.removeGuild":       (c, p) => snipe.execute(c, { action: "removeGuild",       guildId:   p.guildId }),
  "snipe.getWhitelist":      (c, p) => snipe.execute(c, { action: "getWhitelist" }),
  "snipe.getMessages":       (c, p) => snipe.execute(c, { action: "getMessages",       channelId: p.channelId, type: p.type }),
  "snipe.getMessagesByGuild":(c, p) => snipe.execute(c, { action: "getMessagesByGuild",guildId:   p.guildId,   type: p.type }),
  "snipe.getMessagesByUser": (c, p) => snipe.execute(c, { action: "getMessagesByUser", userId:    p.userId,    type: p.type }),

  // ── STALK ─────────────────────────────────────────────────────────────────
  "stalk.add":          (c, p) => stalk.execute(c, { action: "add",    userId: p.userId }),
  "stalk.remove":       (c, p) => stalk.execute(c, { action: "remove", userId: p.userId }),
  "stalk.getList":      (c, p) => stalk.execute(c, { action: "getList" }),

  // ── TAGS ──────────────────────────────────────────────────────────────────
  "tag.add":            (c, p) => tag.execute(c, { action: "add",    name: p.name, content: p.content }),
  "tag.remove":         (c, p) => tag.execute(c, { action: "remove", name: p.name }),
  "tag.edit":           (c, p) => tag.execute(c, { action: "edit",   name: p.name, content: p.content }),
  "tag.list":           (c, p) => tag.execute(c, { action: "list" }),
  "tag.send":           (c, p) => tag.execute(c, { action: "send",   name: p.name, channelId: p.channelId }),

  // ── BOOKMARKS SALONS ──────────────────────────────────────────────────────
  "bookmark.add":       (c, p) => bookmark.execute(c, { action: "add",    channelId: p.channelId }),
  "bookmark.remove":    (c, p) => bookmark.execute(c, { action: "remove", channelId: p.channelId }),
  "bookmark.list":      (c, p) => bookmark.execute(c, { action: "list" }),

  // ── BOOKMARKS MESSAGES ────────────────────────────────────────────────────
  "msgbm.list":         (c, p) => msgbm.execute(c, { action: "list" }),
  "msgbm.add":          (c, p) => msgbm.execute(c, { action: "add",    url: p.url, note: p.note }),
  "msgbm.remove":       (c, p) => msgbm.execute(c, { action: "remove", index: p.index }),
  "msgbm.note":         (c, p) => msgbm.execute(c, { action: "note",   index: p.index, note: p.note }),
  "msgbm.clear":        (c, p) => msgbm.execute(c, { action: "clear" }),

  // ── ANTIGROUP ─────────────────────────────────────────────────────────────
  "antigroup.toggle":   (c, p) => antigroup.execute(c, { action: "toggle" }),
  "antigroup.getState": (c, p) => antigroup.execute(c, { action: "getState" }),
  "antigroup.leaveAll": (c, p) => antigroup.execute(c, { action: "leaveAll" }),

  // ── AUTOBUMP ─────────────────────────────────────────────────────────────
  "autobump.add":       (c, p) => autobump.execute(c, { action: "add",    guildId: p.guildId, channelId: p.channelId }),
  "autobump.remove":    (c, p) => autobump.execute(c, { action: "remove", guildId: p.guildId, channelId: p.channelId }),
  "autobump.start":     (c, p) => autobump.execute(c, { action: "start" }),
  "autobump.stop":      (c, p) => autobump.execute(c, { action: "stop" }),
  "autobump.list":      (c, p) => autobump.execute(c, { action: "list" }),

  // ── MSGLOG ────────────────────────────────────────────────────────────────
  "msglog.add":         (c, p) => msglog.execute(c, { action: "add",    guildId: p.guildId }),
  "msglog.remove":      (c, p) => msglog.execute(c, { action: "remove", guildId: p.guildId }),
  "msglog.list":        (c, p) => msglog.execute(c, { action: "list" }),

  // ── GUNSLOL ───────────────────────────────────────────────────────────────
  "gunslol.toggle":     (c, p) => gunslol.execute(c, { action: "toggle" }),
  "gunslol.setLink":    (c, p) => gunslol.execute(c, { action: "setLink",    link:      p.link }),
  "gunslol.setMsg":     (c, p) => gunslol.execute(c, { action: "setMsg",     message:   p.message }),
  "gunslol.resetMsg":   (c, p) => gunslol.execute(c, { action: "resetMsg" }),
  "gunslol.setChannel": (c, p) => gunslol.execute(c, { action: "setChannel", channelId: p.channelId }),
  "gunslol.getState":   (c, p) => gunslol.execute(c, { action: "getState" }),

  // ── NITRO SNIPER ──────────────────────────────────────────────────────────
  "nitro.toggle":           (c, p) => nitro.execute(c, { action: "toggle" }),
  "nitro.getState":         (c, p) => nitro.execute(c, { action: "getState" }),
  "nitro.getHistory":       (c, p) => nitro.execute(c, { action: "getHistory" }),
  "nitro.clearHistory":     (c, p) => nitro.execute(c, { action: "clearHistory" }),
  "nitro.setNotifyOnClaim": (c, p) => nitro.execute(c, { action: "setNotifyOnClaim", value:   p.value }),
  "nitro.setNotifyOnFail":  (c, p) => nitro.execute(c, { action: "setNotifyOnFail",  value:   p.value }),
  "nitro.addExclusion":     (c, p) => nitro.execute(c, { action: "addExclusion",     guildId: p.guildId }),
  "nitro.removeExclusion":  (c, p) => nitro.execute(c, { action: "removeExclusion",  guildId: p.guildId }),
  "nitro.getExclusions":    (c, p) => nitro.execute(c, { action: "getExclusions" }),

  // ── RPC + Custom Status ───────────────────────────────────────────────────
  "rpc.getState":        (c, p) => rpc.execute(c, { action: "getState" }),
  "rpc.toggle":          (c, p) => rpc.execute(c, { action: "toggle" }),
  "rpc.setStatus":       (c, p) => rpc.execute(c, { action: "setStatus",      status:      p.status }),
  "rpc.setMode":         (c, p) => rpc.execute(c, { action: "setMode",        mode:        p.mode }),
  "rpc.setInterval":     (c, p) => rpc.execute(c, { action: "setInterval",    intervalSec: p.intervalSec }),
  "rpc.addActivity":     (c, p) => rpc.execute(c, { action: "addActivity",    activity:    p.activity }),
  "rpc.editActivity":    (c, p) => rpc.execute(c, { action: "editActivity",  index: p.index, activity: p.activity }),
  "rpc.setPlatform":     (c, p) => rpc.execute(c, { action: "setPlatform",   index: p.index, platform: p.platform }),
  "rpc.editButtons":     (c, p) => rpc.execute(c, { action: "editButtons",   index: p.index, buttonAction: p.buttonAction, buttonIndex: p.buttonIndex, label: p.label, url: p.url }),
  "rpc.editAssets":      (c, p) => rpc.execute(c, { action: "editAssets",     index:       p.index, assets: p.assets }),
  "rpc.setActivityTimestamps": (c, p) => rpc.execute(c, { action: "setActivityTimestamps", index: p.index, start: p.start, end: p.end }),
  "rpc.removeActivity":  (c, p) => rpc.execute(c, { action: "removeActivity", index:       p.index }),
  "rpc.moveActivity":    (c, p) => rpc.execute(c, { action: "moveActivity",   index:       p.index, direction: p.direction }),
  "rpc.clearActivities": (c, p) => rpc.execute(c, { action: "clearActivities" }),
  "rpc.applyNow":        (c, p) => rpc.execute(c, { action: "applyNow" }),
  "rpc.setApplicationId":(c, p) => rpc.execute(c, { action: "setApplicationId", applicationId: p.applicationId }),
  "rpc.setSpotifyConfig":(c, p) => rpc.execute(c, {
    action:   "setSpotifyConfig",
    enabled:  p.enabled,
    songId:   p.songId,
    albumId:  p.albumId,
    artistIds:p.artistIds,
    details:  p.details,
    state:    p.state,
  }),
  "rpc.setSpotifyAssets":(c, p) => rpc.execute(c, { action: "setSpotifyAssets", assets: p.assets }),
  "rpc.setSpotifyTimestamps":(c, p) => rpc.execute(c, { action: "setSpotifyTimestamps", start: p.start, end: p.end }),
  "rpc.setSpotifyExtras":(c, p) => rpc.execute(c, {
    action: "setSpotifyExtras",
    applicationId: p.applicationId,
    platform: p.platform,
    url: p.url,
  }),
  "rpc.csToggle":        (c, p) => rpc.execute(c, { action: "csToggle" }),
  "rpc.csAdd":           (c, p) => rpc.execute(c, { action: "csAdd",    emoji: p.emoji, text: p.text }),
  "rpc.csEdit":          (c, p) => rpc.execute(c, { action: "csEdit",   index: p.index, emoji: p.emoji, text: p.text }),
  "rpc.csRemove":        (c, p) => rpc.execute(c, { action: "csRemove", index: p.index }),
  "rpc.csClear":         (c, p) => rpc.execute(c, { action: "csClear" }),
  "rpc.setCsInterval":   (c, p) => rpc.execute(c, { action: "setCsInterval", intervalSec: p.intervalSec }),

  // ── SNAPSHOT (export salon en HTML) ──────────────────────────────────────
  "snapshot.run":        (c, p) => snapshot.execute(c, {
    action:          "snapshot",
    channelId:       p.channelId,
    limit:           p.limit ?? 0,
    sendToChannelId: p.sendToChannelId ?? null,
    jobId:           p.jobId ?? null,
  }),

  // ── QUESTS ────────────────────────────────────────────────────────────────
  "quests.getConfig":    (c, p) => quests.execute(c, { action: "getConfig" }),
  "quests.toggle":       (c, p) => quests.execute(c, { action: "toggle" }),
  "quests.setInterval":  (c, p) => quests.execute(c, { action: "setInterval", intervalMin: p.intervalMin }),
  "quests.list":         (c, p) => quests.execute(c, { action: "list" }),
  "quests.run":          (c, p) => quests.execute(c, { action: "run" }),
  "quests.getHistory":   (c, p) => quests.execute(c, { action: "getHistory" }),
  "quests.clearHistory": (c, p) => quests.execute(c, { action: "clearHistory" }),

  // ── CLONE ─────────────────────────────────────────────────────────────────
  "clone.listGuilds":   (c, p) => clone.execute(c, { action: "listGuilds" }),
  "clone.run":          (c, p) => clone.execute(c, {
    action:          "run",
    sourceGuildId:   p.sourceGuildId,
    targetGuildId:   p.targetGuildId,
    cloneRoles:      p.cloneRoles,
    cloneChannels:   p.cloneChannels,
    cloneEmojis:     p.cloneEmojis,
    cloneSettings:   p.cloneSettings,
    jobId:           p.jobId,
  }),
  "clone.cancel":       (c, p) => clone.execute(c, { action: "cancel", jobId: p.jobId }),
  "clone.getHistory":   (c, p) => clone.execute(c, { action: "getHistory" }),
  "clone.clearHistory": (c, p) => clone.execute(c, { action: "clearHistory" }),



  // ── FUN ───────────────────────────────────────────────────────────────────
  "fun.mock":           (c, p) => mock.execute(c,    { channelId: p.channelId, text: p.text }),
  "fun.spoiler":        (c, p) => spoiler.execute(c, { channelId: p.channelId, text: p.text }),

  // ── INFORMATIONS ─────────────────────────────────────────────────────────
  "info.ping":          (c, p) => ping.execute(c),
  "info.uptime":        (c, p) => uptime.execute(c),
  "info.hostinfo":      (c, p) => hostinfo.execute(c),

  // ── VOICE ─────────────────────────────────────────────────────────────────
  "voice.join":         (c, p) => joinvc.execute(c, { channelId: p.channelId }),
  "voice.leave":        (c, p) => joinvc.execute(c, { action: "leave",    channelId: p.channelId }),
  "voice.move":         (c, p) => joinvc.execute(c, { action: "move",     channelId: p.channelId }),
  "voice.getState":     (c, p) => joinvc.execute(c, { action: "getState" }),

  // ── PURGE ─────────────────────────────────────────────────────────────────
  "purge.channel":      (c, p) => purge.execute(c, { scope: "channel", channelId: p.channelId, amount: p.amount, jobId: p.jobId }),
  "purge.guild":        (c, p) => purge.execute(c, { scope: "guild",   guildId:   p.guildId,                    jobId: p.jobId }),
  "purge.dms":          (c, p) => purge.execute(c, { scope: "dms",                                              jobId: p.jobId }),
  "purge.guilds":       (c, p) => purge.execute(c, { scope: "guilds",                                           jobId: p.jobId }),
  "purge.cancel":       (c, p) => purge.execute(c, { scope: "cancel",  jobId: p.jobId }),
};

async function dispatch(client, action, payload) {
  const handler = ACTIONS[action];
  if (!handler) throw new Error(`Action inconnue : '${action}'`);
  return handler(client, payload);
}

module.exports = { dispatch };
