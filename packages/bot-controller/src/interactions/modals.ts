import type { ModalMessageModalSubmitInteraction, ModalSubmitInteraction } from "discord.js";

import { sendAction } from "../bridge/client";
import { fetchAndBuild } from "./fetch-and-build";
import { getCloneConfig } from "../store/clone-config";
import { registerSnapshotJob } from "../store/jobs";

// Panels
import * as prefix      from "../panels/prefix";
import * as afk         from "../panels/afk";
import * as snipe       from "../panels/snipe";
import * as tags        from "../panels/tags";
import * as bookmarks   from "../panels/bookmarks";
import * as msgbm       from "../panels/msgbookmarks";
import * as autobump    from "../panels/autobump";
import * as purge       from "../panels/purge";
import * as rpc         from "../panels/rpc";
import * as quests      from "../panels/quests";
import * as backups     from "../panels/backups";
import * as configPanel from "../panels/config";
import * as voice       from "../panels/voice";

// ─────────────────────────────────────────────────────────────────────────────

function makeJobId(prefixStr = "job"): string {
  return `${prefixStr}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function resolveGuildName(guildId: string): Promise<string | null> {
  try {
    const res = await sendAction("backups.listGuilds");
    const guild = ((res?.data?.guilds ?? []) as Array<{ id: string; name?: string }>).find((g) => g.id === guildId);
    return guild?.name ?? null;
  } catch { return null; }
}

export async function handle(interaction: ModalSubmitInteraction): Promise<unknown> {
  // Tous les modals du panel sont ouverts depuis un message de panel :
  // isFromMessage() garantit l'accès typé à update() pour re-render en place.
  if (!interaction.isFromMessage()) return;

  const id = interaction.customId;

  // ── Navigation ────────────────────────────────────────────────────────────
  if (id === "panel:home") {
    const panel = await fetchAndBuild("home");
    return interaction.update(panel!);
  }

  const NAV_MAP: Record<string, string> = {
    "panel:config":       "config",
    "panel:afk":          "afk",
    "panel:snipe":        "snipe",
    "panel:tags":         "tags",
    "panel:bookmarks":    "bookmarks",
    "panel:msgbookmarks": "msgbookmarks",
    "panel:antigroup":    "antigroup",
    "panel:autobump":     "autobump",
    "panel:purge":        "purge",
    "panel:sysinfo":      "sysinfo",
    "panel:rpc":          "rpc",
    "panel:rpc_cs":       "rpc_cs",
    "panel:rpc_spotify":  "rpc_spotify",
    "panel:rpc_hub":      "rpc_hub",
    "panel:quests":       "quests",
    "panel:backups":      "backups",
    "panel:voice":        "voice",
  };
  if (NAV_MAP[id]) {
    const panel = await fetchAndBuild(NAV_MAP[id]);
    return interaction.update(panel!);
  }

  // ── CONFIG ────────────────────────────────────────────────────────────────
  if (id === "modal:token") {
    const token = interaction.fields.getTextInputValue("token").trim();
    const ownerIdConfirm = interaction.fields.getTextInputValue("ownerId").trim();
    if (ownerIdConfirm !== process.env.OWNER_ID) {
      return _error(interaction, "Confirmation OWNER_ID invalide — token non modifié.");
    }
    const res = await sendAction("token.set", { token, ownerIdConfirm });
    if (!res?.success) return _error(interaction, res?.error ?? "Erreur lors de la mise à jour du token.");
    return interaction.update(configPanel.buildTokenUpdated());
  }

  // ── PREFIX ────────────────────────────────────────────────────────────────
  if (id === "modal:prefix") {
    const newPrefix = interaction.fields.getTextInputValue("prefix").trim();
    const res = await sendAction("prefix.set", { prefix: newPrefix });
    if (!res?.success) return _error(interaction, res?.error ?? "Erreur lors du changement de préfixe.");
    return interaction.update(prefix.build(res?.data ?? {}));
  }

  // ── AFK ───────────────────────────────────────────────────────────────────
  if (id === "modal:afk_reason") {
    const reason = interaction.fields.getTextInputValue("reason");
    const res = await sendAction("afk.setReason", { reason });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(afk.build(res?.data ?? {}));
  }
  if (id === "modal:afk_msg") {
    const msg = interaction.fields.getTextInputValue("msg");
    const res = await sendAction("afk.setMessage", { message: msg || null });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(afk.build(res?.data ?? {}));
  }
  if (id === "modal:afk_excl_add") {
    const userId = interaction.fields.getTextInputValue("userId").trim();
    const res = await sendAction("afk.addExclusion", { userId });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(afk.build(res?.data ?? {}));
  }
  if (id === "modal:afk_excl_remove") {
    const userId = interaction.fields.getTextInputValue("userId").trim();
    const res = await sendAction("afk.removeExclusion", { userId });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(afk.build(res?.data ?? {}));
  }

  // ── SNIPE ─────────────────────────────────────────────────────────────────
  if (id === "modal:snipe_add") {
    const guildId = interaction.fields.getTextInputValue("guildId").trim();
    const res = await sendAction("snipe.addGuild", { guildId });
    if (!res?.success) return _error(interaction, res?.error);
    // On passe par fetchAndBuild pour avoir les noms de serveurs ET les schedules
    const panel = await fetchAndBuild("snipe");
    return interaction.update(panel!);
  }
  if (id === "modal:snipe_remove") {
    const guildId = interaction.fields.getTextInputValue("guildId").trim();
    const res = await sendAction("snipe.removeGuild", { guildId });
    if (!res?.success) return _error(interaction, res?.error);
    // On passe par fetchAndBuild pour avoir les noms de serveurs ET les schedules
    const panel = await fetchAndBuild("snipe");
    return interaction.update(panel!);
  }
  if (id === "modal:snipe_view:deleted" || id === "modal:snipe_view:edited") {
    const type  = id.endsWith("deleted") ? "deleted" : "edited";
    const mode  = interaction.fields.getRadioGroup("mode", true);
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
    return interaction.update(snipe.buildResults({ ...(res?.data ?? {}), page: 0 }));
  }
  if (id === "modal:snipe_snapshot") {
    const channelId       = interaction.fields.getTextInputValue("channelId").trim();
    const limitRaw        = interaction.fields.getTextInputValue("limit").trim();
    const sendToChannelId = interaction.fields.getTextInputValue("sendToChannelId").trim() || null;
    const limit           = parseInt(limitRaw, 10) || 0;
    const jobId           = makeJobId("snapshot");

    await interaction.update(snipe.buildSnapshotRunning({ channelId }));

    registerSnapshotJob(jobId, interaction);

    sendAction("snapshot.run", { channelId, limit, sendToChannelId, jobId }).catch(() => {});
    return;
  }
  if (id === "modal:snipe_snapshot_periodic_add") {
    const channelId       = interaction.fields.getTextInputValue("channelId").trim();
    const interval        = interaction.fields.getTextInputValue("interval").trim();
    const limitRaw        = interaction.fields.getTextInputValue("limit").trim();
    const sendToChannelId = interaction.fields.getTextInputValue("sendToChannelId").trim() || null;
    const limit           = parseInt(limitRaw, 10) || 0;

    const res = await sendAction("snapshot.periodic.add", { channelId, interval, limit, sendToChannelId });
    if (!res?.success) return _error(interaction, res?.error);
    const panel = await fetchAndBuild("snipe");
    return interaction.update(panel!);
  }
  if (id === "modal:snipe_snapshot_periodic_remove") {
    const channelId = interaction.fields.getTextInputValue("channelId").trim();
    const res = await sendAction("snapshot.periodic.remove", { channelId });
    if (!res?.success) return _error(interaction, res?.error);
    const panel = await fetchAndBuild("snipe");
    return interaction.update(panel!);
  }

  // ── TAGS ──────────────────────────────────────────────────────────────────
  if (id === "modal:tags_add") {
    const name    = interaction.fields.getTextInputValue("name").trim();
    const content = interaction.fields.getTextInputValue("content");
    const res = await sendAction("tag.add", { name, content });
    if (!res?.success) return _error(interaction, res?.error);
    const prefixRes = await sendAction("prefix.get");
    return interaction.update(tags.build({ tags: res?.data?.tags ?? {}, prefix: prefixRes?.data?.prefix ?? "." }));
  }
  if (id === "modal:tags_edit") {
    const name    = interaction.fields.getTextInputValue("name").trim();
    const content = interaction.fields.getTextInputValue("content");
    const res = await sendAction("tag.edit", { name, content });
    if (!res?.success) return _error(interaction, res?.error);
    const prefixRes = await sendAction("prefix.get");
    return interaction.update(tags.build({ tags: res?.data?.tags ?? {}, prefix: prefixRes?.data?.prefix ?? "." }));
  }
  if (id === "modal:tags_remove") {
    const name = interaction.fields.getTextInputValue("name").trim();
    const res = await sendAction("tag.remove", { name });
    if (!res?.success) return _error(interaction, res?.error);
    const prefixRes = await sendAction("prefix.get");
    return interaction.update(tags.build({ tags: res?.data?.tags ?? {}, prefix: prefixRes?.data?.prefix ?? "." }));
  }
  if (id === "modal:tags_view") {
    const name = interaction.fields.getTextInputValue("name").trim();
    const res = await sendAction("tag.list");
    if (!res?.success) return _error(interaction, res?.error);
    const tagContent = res?.data?.tags?.[name];
    if (!tagContent) return _error(interaction, `Tag \`${name}\` introuvable.`);
    return interaction.reply({ content: tagContent, ephemeral: true });
  }

  // ── BOOKMARKS SALONS ──────────────────────────────────────────────────────
  if (id === "modal:bookmarks_add") {
    const channelId = interaction.fields.getTextInputValue("channelId").trim();
    const res = await sendAction("bookmark.add", { channelId });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(bookmarks.build(res?.data ?? {}));
  }
  if (id === "modal:bookmarks_remove") {
    const channelId = interaction.fields.getTextInputValue("channelId").trim();
    const res = await sendAction("bookmark.remove", { channelId });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(bookmarks.build(res?.data ?? {}));
  }

  // ── BOOKMARKS MESSAGES ────────────────────────────────────────────────────
  if (id === "modal:msgbm_add") {
    const url  = interaction.fields.getTextInputValue("url").trim();
    const note = interaction.fields.getTextInputValue("note").trim() || null;
    const res = await sendAction("msgbm.add", { url, note });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(msgbm.build(res?.data ?? {}));
  }
  if (id === "modal:msgbm_remove") {
    const index = parseInt(interaction.fields.getTextInputValue("index").trim(), 10);
    const res = await sendAction("msgbm.remove", { index });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(msgbm.build(res?.data ?? {}));
  }
  if (id === "modal:msgbm_note") {
    const index = parseInt(interaction.fields.getTextInputValue("index").trim(), 10);
    const note  = interaction.fields.getTextInputValue("note").trim() || null;
    const res = await sendAction("msgbm.note", { index, note });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(msgbm.build(res?.data ?? {}));
  }

  // ── AUTOBUMP ──────────────────────────────────────────────────────────────
  if (id === "modal:autobump_add") {
    const guildId     = interaction.fields.getTextInputValue("guildId").trim();
    const channelId   = interaction.fields.getTextInputValue("channelId").trim();
    const appId       = interaction.fields.getTextInputValue("appId").trim();
    const commandName = interaction.fields.getTextInputValue("commandName").trim();
    const res = await sendAction("autobump.add", { guildId, channelId, appId, commandName });
    if (!res?.success) return _error(interaction, res?.error);
    const state = await sendAction("autobump.list");
    return interaction.update(autobump.build(state?.data ?? {}));
  }
  if (id === "modal:autobump_remove") {
    const guildId   = interaction.fields.getTextInputValue("guildId").trim();
    const channelId = interaction.fields.getTextInputValue("channelId").trim();
    const res = await sendAction("autobump.remove", { guildId, channelId });
    if (!res?.success) return _error(interaction, res?.error);
    const state = await sendAction("autobump.list");
    return interaction.update(autobump.build(state?.data ?? {}));
  }

  // ── PURGE ─────────────────────────────────────────────────────────────────
  if (id === "modal:purge_ask_channel") {
    const channelId  = interaction.fields.getTextInputValue("channelId").trim();
    const amountRaw  = interaction.fields.getTextInputValue("amount").trim();
    const amount     = amountRaw ? parseInt(amountRaw, 10) : null;
    return interaction.update(purge.buildConfirm({ scope: "channel", channelId, amount }));
  }
  if (id === "modal:purge_ask_guild") {
    const guildId   = interaction.fields.getTextInputValue("guildId").trim();
    const guildName = await resolveGuildName(guildId);
    return interaction.update(purge.buildConfirm({ scope: "guild", guildId, guildName }));
  }
  if (id === "modal:purge_excl_add") {
    const kind = interaction.fields.getRadioGroup("kind", true);
    const exclId = interaction.fields.getTextInputValue("id").trim();
    const res = await sendAction("purge.addExclusion", { id: exclId, kind });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(purge.buildExclusions(res?.data ?? {}));
  }
  if (id === "modal:purge_excl_remove") {
    const exclId = interaction.fields.getTextInputValue("id").trim();
    const res = await sendAction("purge.removeExclusion", { id: exclId });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(purge.buildExclusions(res?.data ?? {}));
  }

  // ── RPC — Activités ───────────────────────────────────────────────────────
  if (id === "modal:rpc_addActivity") {
    const type    = interaction.fields.getRadioGroup("type", true);
    const name    = interaction.fields.getTextInputValue("name").trim();
    const details = interaction.fields.getTextInputValue("details").trim() || null;
    const state   = interaction.fields.getTextInputValue("state").trim() || null;
    const url     = interaction.fields.getTextInputValue("url").trim() || null;
    const res = await sendAction("rpc.addActivity", { activity: { type, name, details, state, url } });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(rpc.build(res?.data ?? {}));
  }
  if (id === "modal:rpc_editActivity") {
    const index   = parseInt(interaction.fields.getTextInputValue("index").trim(), 10);
    const type    = interaction.fields.getRadioGroup("type", true);
    const name    = interaction.fields.getTextInputValue("name").trim();
    const details = interaction.fields.getTextInputValue("details").trim() || null;
    const state   = interaction.fields.getTextInputValue("state").trim() || null;
    const res = await sendAction("rpc.editActivity", { index, activity: { type, name, details, state } });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(rpc.build(res?.data ?? {}));
  }
  if (id === "modal:rpc_removeActivity") {
    const index = parseInt(interaction.fields.getTextInputValue("index").trim(), 10);
    const res = await sendAction("rpc.removeActivity", { index });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(rpc.build(res?.data ?? {}));
  }
  if (id === "modal:rpc_editAssets") {
    const index      = parseInt(interaction.fields.getTextInputValue("index").trim(), 10);
    const largeImage = interaction.fields.getTextInputValue("largeImage").trim() || null;
    const largeText  = interaction.fields.getTextInputValue("largeText").trim() || null;
    const smallImage = interaction.fields.getTextInputValue("smallImage").trim() || null;
    const smallText  = interaction.fields.getTextInputValue("smallText").trim() || null;
    const res = await sendAction("rpc.editAssets", { index, assets: { largeImage, largeText, smallImage, smallText } });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(rpc.build(res?.data ?? {}));
  }
  if (id === "modal:rpc_editTimestamps") {
    const index          = parseInt(interaction.fields.getTextInputValue("index").trim(), 10);
    const startOffsetRaw = interaction.fields.getTextInputValue("startOffsetSec").trim();
    const durationRaw    = interaction.fields.getTextInputValue("durationSec").trim();
    const startOffsetSec = startOffsetRaw ? parseInt(startOffsetRaw, 10) : 0;
    const durationSec    = durationRaw    ? parseInt(durationRaw, 10)    : null;
    const now  = Date.now();
    const start = now + startOffsetSec * 1000;
    const end   = durationSec ? start + durationSec * 1000 : null;
    const res = await sendAction("rpc.setActivityTimestamps", { index, start, end });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(rpc.build(res?.data ?? {}));
  }
  if (id === "modal:rpc_setPlatform") {
    const index    = parseInt(interaction.fields.getTextInputValue("index").trim(), 10);
    const platformRaw = interaction.fields.getRadioGroup("platform", true);
    const platform = platformRaw === "none" ? null : platformRaw;
    const res = await sendAction("rpc.setPlatform", { index, platform });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(rpc.build(res?.data ?? {}));
  }
  if (id === "modal:rpc_editButtons") {
    const index        = parseInt(interaction.fields.getTextInputValue("index").trim(), 10);
    const buttonAction = interaction.fields.getRadioGroup("buttonAction", true);
    const label        = interaction.fields.getTextInputValue("label").trim() || null;
    const url          = interaction.fields.getTextInputValue("url").trim() || null;
    const buttonIndex  = parseInt(interaction.fields.getTextInputValue("buttonIndex").trim(), 10) || null;
    const res = await sendAction("rpc.editButtons", { index, buttonAction, label, url, buttonIndex });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(rpc.build(res?.data ?? {}));
  }
  if (id === "modal:rpc_setStatus") {
    const status = interaction.fields.getRadioGroup("status", true);
    const res = await sendAction("rpc.setStatus", { status });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(rpc.build(res?.data ?? {}));
  }
  if (id === "modal:rpc_setInterval") {
    const intervalSec = parseInt(interaction.fields.getTextInputValue("intervalSec").trim(), 10);
    const res = await sendAction("rpc.setInterval", { intervalSec });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(rpc.build(res?.data ?? {}));
  }
  if (id === "modal:rpc_moveUp") {
    const index = parseInt(interaction.fields.getTextInputValue("index").trim(), 10);
    const res = await sendAction("rpc.moveActivity", { index, direction: "up" });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(rpc.build(res?.data ?? {}));
  }
  if (id === "modal:rpc_moveDown") {
    const index = parseInt(interaction.fields.getTextInputValue("index").trim(), 10);
    const res = await sendAction("rpc.moveActivity", { index, direction: "down" });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(rpc.build(res?.data ?? {}));
  }
  if (id === "modal:rpc_setAppId") {
    const applicationId = interaction.fields.getTextInputValue("applicationId").trim() || null;
    const res = await sendAction("rpc.setApplicationId", { applicationId });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(rpc.build(res?.data ?? {}));
  }

  // ── RPC — Spotify ─────────────────────────────────────────────────────────
  if (id === "modal:rpc_spotify") {
    const enabledRaw = interaction.fields.getTextInputValue("enabled").trim().toLowerCase();
    const enabled    = enabledRaw === "on" || enabledRaw === "true" || enabledRaw === "oui";
    const songId     = interaction.fields.getTextInputValue("songId").trim() || null;
    const albumId    = interaction.fields.getTextInputValue("albumId").trim() || null;
    const artistIds  = interaction.fields.getTextInputValue("artistIds").trim() || null;
    const display    = interaction.fields.getTextInputValue("display").trim() || null;
    let details: string | null = null;
    let state: string | null = null;
    if (display) {
      const parts = display.split("|").map((s) => s.trim());
      details = parts[0] || null;
      state   = parts[1] || null;
    }
    const res = await sendAction("rpc.setSpotifyConfig", { enabled, songId, albumId, artistIds, details, state });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(rpc.buildSpotify(res?.data ?? {}));
  }
  if (id === "modal:rpc_spotifyAssets") {
    const largeImage = interaction.fields.getTextInputValue("largeImage").trim() || null;
    const largeText  = interaction.fields.getTextInputValue("largeText").trim() || null;
    const smallImage = interaction.fields.getTextInputValue("smallImage").trim() || null;
    const smallText  = interaction.fields.getTextInputValue("smallText").trim() || null;
    const res = await sendAction("rpc.setSpotifyAssets", { assets: { largeImage, largeText, smallImage, smallText } });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(rpc.buildSpotify(res?.data ?? {}));
  }
  if (id === "modal:rpc_spotifyTimestamps") {
    const startOffsetRaw = interaction.fields.getTextInputValue("startOffsetSec").trim();
    const durationRaw    = interaction.fields.getTextInputValue("durationSec").trim();
    const startOffsetSec = startOffsetRaw ? parseInt(startOffsetRaw, 10) : 0;
    const durationSec    = durationRaw    ? parseInt(durationRaw, 10)    : null;
    const now   = Date.now();
    const start = now + startOffsetSec * 1000;
    const end   = durationSec ? start + durationSec * 1000 : null;
    const res = await sendAction("rpc.setSpotifyTimestamps", { start, end });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(rpc.buildSpotify(res?.data ?? {}));
  }
  if (id === "modal:rpc_spotifyExtras") {
    const applicationId = interaction.fields.getTextInputValue("applicationId").trim() || null;
    const platformRaw   = interaction.fields.getRadioGroup("platform", true);
    const platform      = platformRaw === "none" ? null : platformRaw;
    const url           = interaction.fields.getTextInputValue("url").trim() || null;
    const res = await sendAction("rpc.setSpotifyExtras", { applicationId, platform, url });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(rpc.buildSpotify(res?.data ?? {}));
  }

  // ── RPC — Custom Status ───────────────────────────────────────────────────
  if (id === "modal:rpc_csAdd") {
    const emoji = interaction.fields.getTextInputValue("emoji").trim() || null;
    const text  = interaction.fields.getTextInputValue("text").trim();
    const res = await sendAction("rpc.csAdd", { emoji, text });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(rpc.buildCs(res?.data ?? {}));
  }
  if (id === "modal:rpc_csEdit") {
    const index = parseInt(interaction.fields.getTextInputValue("index").trim(), 10);
    const emoji = interaction.fields.getTextInputValue("emoji").trim() || null;
    const text  = interaction.fields.getTextInputValue("text").trim();
    const res = await sendAction("rpc.csEdit", { index, emoji, text });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(rpc.buildCs(res?.data ?? {}));
  }
  if (id === "modal:rpc_csRemove") {
    const index = parseInt(interaction.fields.getTextInputValue("index").trim(), 10);
    const res = await sendAction("rpc.csRemove", { index });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(rpc.buildCs(res?.data ?? {}));
  }
  if (id === "modal:rpc_setCsInterval") {
    const intervalSec = parseInt(interaction.fields.getTextInputValue("intervalSec").trim(), 10);
    const res = await sendAction("rpc.setCsInterval", { intervalSec });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(rpc.buildCs(res?.data ?? {}));
  }

  // ── SALON VOCAL & MUSIQUE ─────────────────────────────────────────────────
  if (id === "modal:voice_channel") {
    const channelId = interaction.fields.getTextInputValue("channelId").trim();
    const res = await sendAction("voice.setChannel", { channelId });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(voice.build(res?.data ?? {}));
  }
  if (id === "modal:voice_music") {
    const uploaded  = interaction.fields.getUploadedFiles("file", false)?.first() ?? null;
    const filePath  = interaction.fields.getTextInputValue("path").trim() || null;
    const volumeRaw = interaction.fields.getTextInputValue("volume").trim();
    const loopRaw   = interaction.fields.getTextInputValue("loop").trim().toLowerCase();
    if (!uploaded && !filePath) {
      return _error(interaction, "Fournis un fichier audio (upload) ou un chemin sur l'hôte.");
    }
    // Le téléchargement + la connexion vocale peuvent dépasser les 3 s de Discord.
    await interaction.deferUpdate();
    const res = await sendAction("voice.music.play", {
      fileUrl:  uploaded?.url ?? null,
      fileName: uploaded?.name ?? null,
      filePath,
      volume:   volumeRaw ? parseInt(volumeRaw, 10) : null,
      loop:     loopRaw === "on" || loopRaw === "true" || loopRaw === "oui",
    });
    if (!res?.success) {
      return interaction.followUp({ content: `❌ ${res?.error ?? "Une erreur est survenue."}`, ephemeral: true });
    }
    return interaction.editReply(voice.build(res?.data ?? {}));
  }
  if (id === "modal:voice_volume") {
    const volume = parseInt(interaction.fields.getTextInputValue("volume").trim(), 10);
    const res = await sendAction("voice.music.setVolume", { volume });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(voice.build(res?.data ?? {}));
  }

  // ── QUESTS ────────────────────────────────────────────────────────────────
  if (id === "modal:quests_interval") {
    const intervalMin = parseInt(interaction.fields.getTextInputValue("intervalMin").trim(), 10);
    const res = await sendAction("quests.setInterval", { intervalMin });
    if (!res?.success) return _error(interaction, res?.error);
    const lr = await sendAction("quests.list");
    return interaction.update(quests.build(lr?.data ?? {}));
  }

  // ── CLONE ─────────────────────────────────────────────────────────────────
  if (id === "modal:clone_source") {
    const guildId = interaction.fields.getTextInputValue("guildId").trim();
    const cfg = getCloneConfig(interaction.user.id);
    cfg.sourceGuildId   = guildId;
    cfg.sourceGuildName = await resolveGuildName(guildId);
    return interaction.update(backups.buildClone(cfg));
  }
  if (id === "modal:clone_target") {
    const guildId = interaction.fields.getTextInputValue("guildId").trim();
    const cfg = getCloneConfig(interaction.user.id);
    cfg.targetGuildId   = guildId;
    cfg.targetGuildName = await resolveGuildName(guildId);
    return interaction.update(backups.buildClone(cfg));
  }
}

function _error(interaction: ModalMessageModalSubmitInteraction, message: string | undefined = "Une erreur est survenue."): Promise<unknown> {
  return interaction.reply({ content: `❌ ${message ?? "Une erreur est survenue."}`, ephemeral: true });
}
