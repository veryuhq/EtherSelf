"use strict";

const { sendAction }     = require("../bridge/client");
const { modal }          = require("../utils/components");
const { getCloneConfig } = require("../store/clone-config");

// Panels
const home      = require("../panels/home");
const prefix    = require("../panels/prefix");
const afk       = require("../panels/afk");
const snipe     = require("../panels/snipe");
const stalk     = require("../panels/stalk");
const tags      = require("../panels/tags");
const bookmarks = require("../panels/bookmarks");
const msgbm     = require("../panels/msgbookmarks");
const autobump  = require("../panels/autobump");
const gunslol   = require("../panels/gunslol");
const joinvc    = require("../panels/joinvc");
const purge     = require("../panels/purge");
const nitro     = require("../panels/nitro");
const rpc       = require("../panels/rpc");
const quests    = require("../panels/quests");
const clone = require("../panels/clone");

function getProgressHelpers() {
  return require("../../index.js");
}

function makeJobId(prefix = "job") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

const snipe_panel = require("../panels/snipe");

/**
 * Résout le nom d'un guild depuis la liste fetchée côté selfbot.
 */
async function resolveGuildName(guildId) {
  try {
    const res = await sendAction("clone.listGuilds");
    const guild = (res?.data?.guilds ?? []).find(g => g.id === guildId);
    return guild?.name ?? null;
  } catch {
    return null;
  }
}

/**
 * @param {import("discord.js").ModalSubmitInteraction} interaction
 */
async function handle(interaction) {
  const id = interaction.customId;

  // ── PREFIX ───────────────────────────────────────────────────────────────
  if (id === "modal:prefix") {
    const newPrefix = interaction.fields.getTextInputValue("prefix").trim().slice(0, 3);
    if (!newPrefix) return interaction.update(prefix.build());
    const res = await sendAction("prefix.set", { prefix: newPrefix });
    return interaction.update(prefix.build(res?.data ?? {}));
  }

  // ── AFK ──────────────────────────────────────────────────────────────────
  if (id === "modal:afk_reason") {
    const reason = interaction.fields.getTextInputValue("reason").trim();
    const res = await sendAction("afk.setReason", { reason });
    return interaction.update(afk.build(res?.data ?? {}));
  }
  if (id === "modal:afk_msg_normal") {
    const message = interaction.fields.getTextInputValue("msg").trim();
    const res = await sendAction("afk.setMsgNormal", { message: message || null });
    return interaction.update(afk.build(res?.data ?? {}));
  }
  if (id === "modal:afk_msg_special") {
    const message = interaction.fields.getTextInputValue("msg").trim();
    const res = await sendAction("afk.setMsgSpecial", { message: message || null });
    return interaction.update(afk.build(res?.data ?? {}));
  }
  if (id === "modal:afk_excl_add") {
    const userId = interaction.fields.getTextInputValue("userId").trim();
    const res = await sendAction("afk.addExclusion", { userId });
    return interaction.update(afk.build(res?.data ?? {}));
  }
  if (id === "modal:afk_excl_remove") {
    const userId = interaction.fields.getTextInputValue("userId").trim();
    const res = await sendAction("afk.removeExclusion", { userId });
    return interaction.update(afk.build(res?.data ?? {}));
  }

  // ── SNIPE ────────────────────────────────────────────────────────────────
  if (id === "modal:snipe_add") {
    const guildId = interaction.fields.getTextInputValue("guildId").trim();
    const res = await sendAction("snipe.addGuild", { guildId });
    return interaction.update(snipe_panel.build(res?.data ?? {}));
  }
  if (id === "modal:snipe_remove") {
    const guildId = interaction.fields.getTextInputValue("guildId").trim();
    const res = await sendAction("snipe.removeGuild", { guildId });
    return interaction.update(snipe_panel.build(res?.data ?? {}));
  }
  if (id.startsWith("modal:snipe_view:")) {
    const type  = id.split(":")[2];
    const mode  = interaction.fields.getTextInputValue("mode").trim().toLowerCase();
    const query = interaction.fields.getTextInputValue("query").trim();

    let res;
    if (mode === "guild") {
      res = await sendAction("snipe.getMessagesByGuild", { guildId: query, type });
    } else if (mode === "user") {
      res = await sendAction("snipe.getMessagesByUser", { userId: query, type });
    } else {
      res = await sendAction("snipe.getMessages", { channelId: query, type });
    }

    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(snipe_panel.buildResults({ ...(res?.data ?? {}), page: 0 }));
  }

  // ── SNIPE : SNAPSHOT ──────────────────────────────────────────────────────
  if (id === "modal:snipe_snapshot") {
    const channelId       = interaction.fields.getTextInputValue("channelId").trim();
    const limitRaw        = interaction.fields.getTextInputValue("limit").trim();
    const sendToChannelId = interaction.fields.getTextInputValue("sendToChannelId").trim() || null;
    const limit           = limitRaw ? Math.max(0, parseInt(limitRaw, 10) || 0) : 0;

    const jobId = makeJobId("snapshot");

    await interaction.update(snipe_panel.buildSnapshotRunning({ channelId }));

    const { registerSnapshotJob } = getProgressHelpers();
    registerSnapshotJob(jobId, interaction);

    sendAction("snapshot.run", { channelId, limit, sendToChannelId, jobId }).catch(() => {
      interaction.editReply(snipe_panel.buildSnapshotResult({
        channelName:  channelId,
        messageCount: 0,
        sent:         false,
        error:        "Bridge injoignable.",
      })).catch(() => {});
    });

    return;
  }

  // ── STALK ────────────────────────────────────────────────────────────────
  if (id === "modal:stalk_add") {
    const userId = interaction.fields.getTextInputValue("userId").trim();
    const res = await sendAction("stalk.add", { userId });
    return interaction.update(stalk.build(res?.data ?? {}));
  }
  if (id === "modal:stalk_remove") {
    const userId = interaction.fields.getTextInputValue("userId").trim();
    const res = await sendAction("stalk.remove", { userId });
    return interaction.update(stalk.build(res?.data ?? {}));
  }

  // ── TAGS ─────────────────────────────────────────────────────────────────
  if (id === "modal:tags_add") {
    const name    = interaction.fields.getTextInputValue("name").trim();
    const content = interaction.fields.getTextInputValue("content").trim();
    const res = await sendAction("tag.add", { name, content });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(tags.build(res?.data ?? {}));
  }
  if (id === "modal:tags_edit") {
    const name    = interaction.fields.getTextInputValue("name").trim();
    const content = interaction.fields.getTextInputValue("content").trim();
    const res = await sendAction("tag.edit", { name, content });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(tags.build(res?.data ?? {}));
  }
  if (id === "modal:tags_remove") {
    const name = interaction.fields.getTextInputValue("name").trim();
    const res  = await sendAction("tag.remove", { name });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(tags.build(res?.data ?? {}));
  }
  if (id === "modal:tags_view") {
    const name = interaction.fields.getTextInputValue("name").trim();
    const res  = await sendAction("tag.list");
    if (!res?.success) return _error(interaction, res?.error);

    const tagContent = res?.data?.tags?.[name];
    if (!tagContent) return _error(interaction, `Tag \`${name}\` introuvable.`);

    return interaction.reply({
      content: tagContent,
      ephemeral: true,
    });
  }

  // ── BOOKMARKS SALONS ─────────────────────────────────────────────────────
  if (id === "modal:bookmarks_add") {
    const channelId = interaction.fields.getTextInputValue("channelId").trim();
    const res = await sendAction("bookmark.add", { channelId });
    return interaction.update(bookmarks.build(res?.data ?? {}));
  }
  if (id === "modal:bookmarks_remove") {
    const channelId = interaction.fields.getTextInputValue("channelId").trim();
    const res = await sendAction("bookmark.remove", { channelId });
    return interaction.update(bookmarks.build(res?.data ?? {}));
  }

  // ── BOOKMARKS MESSAGES ───────────────────────────────────────────────────
  if (id === "modal:msgbm_add") {
    const url  = interaction.fields.getTextInputValue("url").trim();
    const note = interaction.fields.getTextInputValue("note").trim();
    const res  = await sendAction("msgbm.add", { url, note: note || null });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(msgbm.build(res?.data ?? {}));
  }
  if (id === "modal:msgbm_remove") {
    const index = parseInt(interaction.fields.getTextInputValue("index").trim(), 10);
    const res   = await sendAction("msgbm.remove", { index });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(msgbm.build(res?.data ?? {}));
  }
  if (id === "modal:msgbm_note") {
    const index = parseInt(interaction.fields.getTextInputValue("index").trim(), 10);
    const note  = interaction.fields.getTextInputValue("note").trim();
    const res   = await sendAction("msgbm.note", { index, note: note || null });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(msgbm.build(res?.data ?? {}));
  }

  // ── AUTOBUMP ─────────────────────────────────────────────────────────────
  if (id === "modal:autobump_add") {
    const guildId   = interaction.fields.getTextInputValue("guildId").trim();
    const channelId = interaction.fields.getTextInputValue("channelId").trim();
    const res = await sendAction("autobump.add", { guildId, channelId });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(autobump.build(res?.data ?? {}));
  }
  if (id === "modal:autobump_remove") {
    const guildId   = interaction.fields.getTextInputValue("guildId").trim();
    const channelId = interaction.fields.getTextInputValue("channelId").trim();
    const res = await sendAction("autobump.remove", { guildId, channelId });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(autobump.build(res?.data ?? {}));
  }

  // ── PURGE ────────────────────────────────────────────────────────────────
  if (id === "modal:purge_ask_channel") {
    const channelId = interaction.fields.getTextInputValue("channelId").trim();
    const amountRaw = interaction.fields.getTextInputValue("amount").trim();
    const amount    = amountRaw ? parseInt(amountRaw, 10) || 0 : 0;

    return interaction.update(purge.buildConfirm({
      scope:     "channel",
      channelId,
      amount:    amount || null,
    }));
  }

  if (id === "modal:purge_ask_guild") {
    const guildId = interaction.fields.getTextInputValue("guildId").trim();

    let guildName = null;
    try {
      const res = await sendAction("clone.listGuilds");
      const guild = (res?.data?.guilds ?? []).find(g => g.id === guildId);
      guildName = guild?.name ?? null;
    } catch { /* non bloquant */ }

    return interaction.update(purge.buildConfirm({
      scope:     "guild",
      guildId,
      guildName,
    }));
  }

  // ── JOINVC ────────────────────────────────────────────────────────────────
  if (id === "modal:joinvc_join") {
    const channelId = interaction.fields.getTextInputValue("channelId").trim();
    const res = await sendAction("voice.join", { channelId });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(joinvc.build(res?.data ?? {}));
  }
  if (id === "modal:joinvc_move") {
    const channelId = interaction.fields.getTextInputValue("channelId").trim();
    const res = await sendAction("voice.move", { channelId });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(joinvc.build(res?.data ?? {}));
  }
  if (id === "modal:joinvc_leave") {
    const channelId = interaction.fields.getTextInputValue("channelId").trim();
    const res = await sendAction("voice.leave", { channelId });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(joinvc.build(res?.data ?? {}));
  }

  // ── GUNSLOL ──────────────────────────────────────────────────────────────
  if (id === "modal:gunslol_link") {
    const link = interaction.fields.getTextInputValue("link").trim();
    const res  = await sendAction("gunslol.setLink", { link });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(gunslol.build(res?.data ?? {}));
  }
  if (id === "modal:gunslol_channel") {
    const channelId = interaction.fields.getTextInputValue("channelId").trim();
    const res = await sendAction("gunslol.setChannel", { channelId });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(gunslol.build(res?.data ?? {}));
  }
  if (id === "modal:gunslol_msg") {
    const msg = interaction.fields.getTextInputValue("msg").trim();
    const res = await sendAction("gunslol.setMsg", { message: msg || null });
    return interaction.update(gunslol.build(res?.data ?? {}));
  }

  // ── NITRO ────────────────────────────────────────────────────────────────
  if (id === "modal:nitro_excl_add") {
    const guildId = interaction.fields.getTextInputValue("guildId").trim();
    const res = await sendAction("nitro.addExclusion", { guildId });
    if (!res?.success) return _error(interaction, res?.error);
    const exclusions = await sendAction("nitro.getExclusions");
    return interaction.update(nitro.buildExclusions(exclusions?.data ?? {}));
  }
  if (id === "modal:nitro_excl_remove") {
    const guildId = interaction.fields.getTextInputValue("guildId").trim();
    const res = await sendAction("nitro.removeExclusion", { guildId });
    if (!res?.success) return _error(interaction, res?.error);
    const exclusions = await sendAction("nitro.getExclusions");
    return interaction.update(nitro.buildExclusions(exclusions?.data ?? {}));
  }

  // ── RPC — Activités ──────────────────────────────────────────────────────
  if (id === "modal:rpc_addActivity") {
    const res = await sendAction("rpc.addActivity", {
      activity: {
        type:    interaction.fields.getTextInputValue("type").trim().toLowerCase(),
        name:    interaction.fields.getTextInputValue("name").trim(),
        details: interaction.fields.getTextInputValue("details").trim() || null,
        state:   interaction.fields.getTextInputValue("state").trim()   || null,
        url:     interaction.fields.getTextInputValue("url").trim()     || null,
      },
    });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(rpc.build(res?.data ?? {}));
  }
  if (id === "modal:rpc_editActivity") {
    const index = parseInt(interaction.fields.getTextInputValue("index").trim(), 10);
    const res   = await sendAction("rpc.editActivity", {
      index,
      activity: {
        type:    interaction.fields.getTextInputValue("type").trim().toLowerCase(),
        name:    interaction.fields.getTextInputValue("name").trim(),
        details: interaction.fields.getTextInputValue("details").trim() || null,
        state:   interaction.fields.getTextInputValue("state").trim()   || null,
      },
    });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(rpc.build(res?.data ?? {}));
  }
  if (id === "modal:rpc_setPlatform") {
    const index    = parseInt(interaction.fields.getTextInputValue("index").trim(), 10);
    const platform = interaction.fields.getTextInputValue("platform").trim().toLowerCase() || null;
    const res      = await sendAction("rpc.setPlatform", { index, platform });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(rpc.build(res?.data ?? {}));
  }
  if (id === "modal:rpc_editButtons") {
    const index        = parseInt(interaction.fields.getTextInputValue("index").trim(), 10);
    const buttonAction = interaction.fields.getTextInputValue("buttonAction").trim().toLowerCase();
    const label        = interaction.fields.getTextInputValue("label").trim()       || null;
    const url          = interaction.fields.getTextInputValue("url").trim()         || null;
    const buttonIndex  = parseInt(interaction.fields.getTextInputValue("buttonIndex").trim() || "1", 10);

    const res = await sendAction("rpc.editButtons", { index, buttonAction, label, url, buttonIndex });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(rpc.build(res?.data ?? {}));
  }
  if (id === "modal:rpc_editAssets") {
    const index = parseInt(interaction.fields.getTextInputValue("index").trim(), 10);
    const res   = await sendAction("rpc.editAssets", {
      index,
      assets: {
        largeImage: interaction.fields.getTextInputValue("largeImage").trim() || null,
        largeText:  interaction.fields.getTextInputValue("largeText").trim()  || null,
        smallImage: interaction.fields.getTextInputValue("smallImage").trim() || null,
        smallText:  interaction.fields.getTextInputValue("smallText").trim()  || null,
      },
    });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(rpc.build(res?.data ?? {}));
  }
  if (id === "modal:rpc_editTimestamps") {
    const index = parseInt(interaction.fields.getTextInputValue("index").trim(), 10);
    const startOffsetRaw = interaction.fields.getTextInputValue("startOffsetSec").trim();
    const durationRaw = interaction.fields.getTextInputValue("durationSec").trim();
    const startOffsetSec = startOffsetRaw ? parseInt(startOffsetRaw, 10) : 0;
    const durationSec = durationRaw ? parseInt(durationRaw, 10) : null;

    if (Number.isNaN(index) || index < 1) {
      return _error(interaction, "Le numéro d'activité est invalide.");
    }
    if (Number.isNaN(startOffsetSec) || startOffsetSec < 0) {
      return _error(interaction, "Le début doit être un nombre de secondes positif ou nul.");
    }
    if (durationRaw && (Number.isNaN(durationSec) || durationSec <= 0)) {
      return _error(interaction, "La durée doit être un nombre de secondes positif.");
    }

    const start = Date.now() + (startOffsetSec * 1000);
    const end = durationSec ? start + (durationSec * 1000) : null;

    const res = await sendAction("rpc.setActivityTimestamps", { index, start, end });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(rpc.build(res?.data ?? {}));
  }
  if (id === "modal:rpc_removeActivity") {
    const index = parseInt(interaction.fields.getTextInputValue("index").trim(), 10);
    const res   = await sendAction("rpc.removeActivity", { index });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(rpc.build(res?.data ?? {}));
  }
  if (id === "modal:rpc_setStatus") {
    const status = interaction.fields.getTextInputValue("status").trim().toLowerCase();
    const res    = await sendAction("rpc.setStatus", { status });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(rpc.build(res?.data ?? {}));
  }
  if (id === "modal:rpc_setInterval") {
    const intervalSec = parseInt(interaction.fields.getTextInputValue("intervalSec").trim(), 10);
    const res         = await sendAction("rpc.setInterval", { intervalSec });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(rpc.build(res?.data ?? {}));
  }
  if (id === "modal:rpc_moveUp") {
    const index = parseInt(interaction.fields.getTextInputValue("index").trim(), 10);
    const res   = await sendAction("rpc.moveActivity", { index, direction: "up" });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(rpc.build(res?.data ?? {}));
  }
  if (id === "modal:rpc_moveDown") {
    const index = parseInt(interaction.fields.getTextInputValue("index").trim(), 10);
    const res   = await sendAction("rpc.moveActivity", { index, direction: "down" });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(rpc.build(res?.data ?? {}));
  }
  if (id === "modal:rpc_setAppId") {
    const applicationId = interaction.fields.getTextInputValue("applicationId").trim();
    const res = await sendAction("rpc.setApplicationId", { applicationId });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(rpc.build(res?.data ?? {}));
  }
  if (id === "modal:rpc_spotify") {
    const enabledRaw = interaction.fields.getTextInputValue("enabled").trim().toLowerCase();
    const displayRaw = interaction.fields.getTextInputValue("display").trim();
    const [detailsRaw = "", stateRaw = ""] = displayRaw.split("|", 2).map(part => part.trim());

    const res = await sendAction("rpc.setSpotifyConfig", {
      enabled: ["on", "true", "1", "yes", "oui"].includes(enabledRaw),
      songId: interaction.fields.getTextInputValue("songId").trim() || null,
      albumId: interaction.fields.getTextInputValue("albumId").trim() || null,
      artistIds: interaction.fields.getTextInputValue("artistIds").trim() || null,
      details: detailsRaw || null,
      state: stateRaw || null,
    });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(rpc.buildSpotify(res?.data ?? {}));
  }
  if (id === "modal:rpc_spotifyAssets") {
    const res = await sendAction("rpc.setSpotifyAssets", {
      assets: {
        largeImage: interaction.fields.getTextInputValue("largeImage").trim() || null,
        largeText: interaction.fields.getTextInputValue("largeText").trim() || null,
        smallImage: interaction.fields.getTextInputValue("smallImage").trim() || null,
        smallText: interaction.fields.getTextInputValue("smallText").trim() || null,
      },
    });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(rpc.buildSpotify(res?.data ?? {}));
  }
  if (id === "modal:rpc_spotifyTimestamps") {
    const startOffsetRaw = interaction.fields.getTextInputValue("startOffsetSec").trim();
    const durationRaw = interaction.fields.getTextInputValue("durationSec").trim();
    const startOffsetSec = startOffsetRaw ? parseInt(startOffsetRaw, 10) : 0;
    const durationSec = durationRaw ? parseInt(durationRaw, 10) : null;

    if (Number.isNaN(startOffsetSec) || startOffsetSec < 0) {
      return _error(interaction, "Le début doit être un nombre de secondes positif ou nul.");
    }
    if (durationRaw && (Number.isNaN(durationSec) || durationSec <= 0)) {
      return _error(interaction, "La durée doit être un nombre de secondes positif.");
    }

    const start = Date.now() + (startOffsetSec * 1000);
    const end = durationSec ? start + (durationSec * 1000) : null;

    const res = await sendAction("rpc.setSpotifyTimestamps", {
      start,
      end,
    });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(rpc.buildSpotify(res?.data ?? {}));
  }
  if (id === "modal:rpc_spotifyExtras") {
    const res = await sendAction("rpc.setSpotifyExtras", {
      applicationId: interaction.fields.getTextInputValue("applicationId").trim() || null,
      platform: interaction.fields.getTextInputValue("platform").trim() || null,
      url: interaction.fields.getTextInputValue("url").trim() || null,
    });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(rpc.buildSpotify(res?.data ?? {}));
  }

  // ── RPC — Custom Status ───────────────────────────────────────────────────
  if (id === "modal:rpc_csAdd") {
    const emoji = interaction.fields.getTextInputValue("emoji").trim() || null;
    const text  = interaction.fields.getTextInputValue("text").trim();
    const res   = await sendAction("rpc.csAdd", { emoji, text });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(rpc.buildCs(res?.data ?? {}));
  }
  if (id === "modal:rpc_csEdit") {
    const index = parseInt(interaction.fields.getTextInputValue("index").trim(), 10);
    const emoji = interaction.fields.getTextInputValue("emoji").trim() || null;
    const text  = interaction.fields.getTextInputValue("text").trim();
    const res   = await sendAction("rpc.csEdit", { index, emoji, text });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(rpc.buildCs(res?.data ?? {}));
  }
  if (id === "modal:rpc_csRemove") {
    const index = parseInt(interaction.fields.getTextInputValue("index").trim(), 10);
    const res   = await sendAction("rpc.csRemove", { index });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(rpc.buildCs(res?.data ?? {}));
  }
  if (id === "modal:rpc_setCsInterval") {
    const intervalSec = parseInt(interaction.fields.getTextInputValue("intervalSec").trim(), 10);
    const res         = await sendAction("rpc.setCsInterval", { intervalSec });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(rpc.buildCs(res?.data ?? {}));
  }

  // ── QUESTS ───────────────────────────────────────────────────────────────
  if (id === "modal:quests_interval") {
    const intervalMin = parseInt(interaction.fields.getTextInputValue("intervalMin").trim(), 10);
    const res         = await sendAction("quests.setInterval", { intervalMin });
    if (!res?.success) return _error(interaction, res?.error);
    const listRes = await sendAction("quests.list");
    return interaction.update(quests.build(listRes?.data ?? {}));
  }

  // ── CLONE ────────────────────────────────────────────────────────────────
  if (id === "modal:clone_source") {
    const guildId = interaction.fields.getTextInputValue("guildId").trim();
    const cfg     = getCloneConfig(interaction.user.id);
    cfg.sourceGuildId   = guildId;
    cfg.sourceGuildName = await resolveGuildName(guildId);
    return interaction.update(clone.buildClone(cfg));
  }
  if (id === "modal:clone_target") {
    const guildId = interaction.fields.getTextInputValue("guildId").trim();
    const cfg     = getCloneConfig(interaction.user.id);
    cfg.targetGuildId   = guildId;
    cfg.targetGuildName = await resolveGuildName(guildId);
    return interaction.update(clone.buildClone(cfg));
  }
}

function _error(interaction, message = "Une erreur est survenue.") {
  return interaction.reply({ content: `❌ ${message}`, ephemeral: true });
}

module.exports = { handle };
