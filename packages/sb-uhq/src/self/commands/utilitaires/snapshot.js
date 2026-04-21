"use strict";

// ─────────────────────────────────────────────────────────────────────────────
//  SNAPSHOT — Logique métier
//  Ce fichier gère :
//    - la récupération des messages Discord
//    - la sérialisation (Message → objet JSON)
//    - la classification salon vs DM / Group DM
//    - la sauvegarde du fichier HTML dans le bon dossier
//    - l'envoi du fichier au bot-controller
//    - la notification du résultat (pour mise à jour du panel)
//
//  Structure des dossiers :
//    data/snapshots/SERVEURS/<guildId>/<channelId>/
//    data/snapshots/MPs/<recipientId>/
//    data/snapshots/GROUP_DMs/<channelId>/
// ─────────────────────────────────────────────────────────────────────────────

const fs    = require("fs");
const path  = require("path");
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));
const { dataPath } = require("../../func/data-path");
const { buildHtml, isSystemMessage, resolveUrl } = require("../../func/snapshot-html");

// ── Chemins ───────────────────────────────────────────────────────────────────

const SNAPSHOTS_ROOT         = dataPath("snapshots");
const SNAPSHOTS_GUILDS_DIR   = path.join(SNAPSHOTS_ROOT, "SERVEURS");
const SNAPSHOTS_DMS_DIR      = path.join(SNAPSHOTS_ROOT, "MPs");
const SNAPSHOTS_GROUPDMS_DIR = path.join(SNAPSHOTS_ROOT, "GROUP_DMs");

const BRIDGE_CONTROLLER_URL = process.env.BRIDGE_CONTROLLER_URL ?? "http://127.0.0.1:3001";
const BRIDGE_SECRET         = process.env.BRIDGE_SECRET ?? "";

// ── Classification du type de salon ──────────────────────────────────────────

/**
 * Retourne les informations de contexte d'un channel Discord.
 * @param {object} channel  Channel discord.js-selfbot-v13
 * @returns {{
 *   isDm: boolean,
 *   isGroupDm: boolean,
 *   channelName: string,
 *   guildName: string|null,
 *   dmWith: string|null,
 *   snapshotDir: string
 * }}
 */
function classifyChannel(channel) {
  const type = channel.type;

  // DM prive (1:1) → MPs/<recipientId>/
  if (type === "DM") {
    const recipient   = channel.recipient;
    const recipientId = recipient?.id ?? channel.id;
    let dmWith = null;
    if (recipient) {
      dmWith = (recipient.discriminator && recipient.discriminator !== "0")
        ? `${recipient.username}#${recipient.discriminator}`
        : recipient.username ?? recipient.tag ?? recipientId;
    }
    return {
      isDm:        true,
      isGroupDm:   false,
      channelName: dmWith ?? recipientId,
      guildName:   null,
      dmWith,
      snapshotDir: path.join(SNAPSHOTS_DMS_DIR, recipientId),
    };
  }

  // Group DM → GROUP_DMs/<channelId>/
  if (type === "GROUP_DM") {
    return {
      isDm:        true,
      isGroupDm:   true,
      channelName: channel.name ?? "Groupe",
      guildName:   null,
      dmWith:      null,
      snapshotDir: path.join(SNAPSHOTS_GROUPDMS_DIR, channel.id),
    };
  }

  // Salon de serveur → SERVEURS/<guildId>/<channelId>/
  const guildId = channel.guild?.id ?? "inconnu";
  return {
    isDm:        false,
    isGroupDm:   false,
    channelName: channel.name ?? channel.id,
    guildName:   channel.guild?.name ?? null,
    dmWith:      null,
    snapshotDir: path.join(SNAPSHOTS_GUILDS_DIR, guildId, channel.id),
  };
}

// ── Recuperation des messages ─────────────────────────────────────────────────

/**
 * Recupere tous les messages d'un salon (ou jusqu'a `limit`).
 * Les messages sont retournes du plus ancien au plus recent.
 * @param {object} channel
 * @param {number} limit  0 = tout recuperer
 * @returns {Promise<object[]>}
 */
async function fetchAllMessages(channel, limit = 0) {
  const messages = [];
  let lastId = undefined;

  while (true) {
    const fetchOpts = { limit: 100 };
    if (lastId) fetchOpts.before = lastId;

    const batch = await channel.messages.fetch(fetchOpts).catch(() => null);
    if (!batch || !batch.size) break;

    const sorted = [...batch.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    messages.unshift(...sorted);

    lastId = batch.last()?.id;

    if (batch.size < 100) break;
    if (limit > 0 && messages.length >= limit) break;

    await new Promise(r => setTimeout(r, 350));
  }

  if (limit > 0) return messages.slice(-limit);
  return messages;
}

// ── Serialisation d'un message ────────────────────────────────────────────────

function serializeMessage(msg) {
  const msgType = msg.type;
  const system  = isSystemMessage(msgType);

  const reactions = [...(msg.reactions?.cache?.values() ?? [])].map(r => ({
    emoji:     r.emoji.id ? null : r.emoji.name,
    emojiId:   r.emoji.id   ?? null,
    emojiName: r.emoji.name ?? null,
    animated:  r.emoji.animated ?? false,
    count:     r.count,
  }));

  const stickers = [...(msg.stickers?.values() ?? [])].map(s => ({
    id:          s.id,
    name:        s.name ?? "sticker",
    format_type: s.format_type ?? s.formatType ?? 1,
    pack_id:     s.packId      ?? null,
    description: s.description ?? null,
  }));

  const embeds = (msg.embeds || []).map(e => {
    const fields = (e.fields ?? []).map(f => ({
      name:   f.name   ?? "",
      value:  f.value  ?? "",
      inline: f.inline ?? false,
    }));

    const authorIconUrl = e.author
      ? resolveUrl(e.author.iconURL) ?? resolveUrl(e.author.proxyIconURL) ?? e.author.icon_url ?? null
      : null;
    const footerIconUrl = e.footer
      ? resolveUrl(e.footer.iconURL) ?? resolveUrl(e.footer.proxyIconURL) ?? e.footer.icon_url ?? null
      : null;
    const imageUrl     = e.image     ? resolveUrl(e.image.url)     ?? resolveUrl(e.image.proxyURL)     ?? null : null;
    const thumbnailUrl = e.thumbnail ? resolveUrl(e.thumbnail.url) ?? resolveUrl(e.thumbnail.proxyURL) ?? null : null;
    const videoUrl     = e.video     ? resolveUrl(e.video.url)     ?? null                                     : null;

    return {
      type:         e.type        ?? "rich",
      url:          e.url         ?? null,
      title:        e.title       ?? null,
      description:  e.description ?? null,
      color:        e.color       ?? null,
      author: e.author ? {
        name:    e.author.name ?? null,
        url:     e.author.url  ?? null,
        iconUrl: authorIconUrl,
      } : null,
      provider: e.provider ? {
        name: e.provider.name ?? null,
        url:  e.provider.url  ?? null,
      } : null,
      footer:       e.footer?.text ?? null,
      footerIconUrl,
      timestamp:    e.timestamp   ?? null,
      imageUrl,
      thumbnailUrl,
      videoUrl,
      fields,
    };
  });

  // Utilisateurs et roles mentionnes (pour la resolution des mentions dans le HTML)
  const mentionedUsers = [...(msg.mentions?.users?.values() ?? [])].map(u => {
    let tag;
    if (u.discriminator && u.discriminator !== "0") {
      tag = `${u.username}#${u.discriminator}`;
    } else {
      tag = u.username ?? u.tag ?? u.id;
    }
    return { id: u.id, tag };
  });

  const mentionedRoles = [...(msg.mentions?.roles?.values() ?? [])].map(r => ({
    id:   r.id,
    name: r.name ?? r.id,
  }));

  // Tag de l'auteur
  let authorTag = "Inconnu";
  const author  = msg.author;
  if (author) {
    if (author.discriminator && author.discriminator !== "0") {
      authorTag = `${author.username}#${author.discriminator}`;
    } else {
      authorTag = author.username ?? author.tag ?? author.id ?? "Inconnu";
    }
  }

  return {
    id:                  msg.id,
    messageType:         msgType,
    isSystem:            system,
    authorId:            msg.author?.id          ?? "0",
    authorTag,
    authorAvatar:        msg.author?.avatar        ?? null,
    authorDiscriminator: msg.author?.discriminator ?? "0",
    isBot:               !!(msg.author?.bot),
    content:             msg.content || "",
    timestamp:           msg.createdTimestamp,
    editedAt:            msg.editedTimestamp || null,
    attachments: [...(msg.attachments?.values() ?? [])].map(a => ({
      url:  a.url,
      name: a.name,
    })),
    embeds,
    stickers,
    mentionedUsers,
    mentionedRoles,
    replyAuthor:  msg.reference
      ? (msg.mentions?.repliedUser?.tag ?? msg.mentions?.repliedUser?.username ?? null)
      : null,
    replyContent: null,
    reactions,
  };
}

// ── Envoi du fichier via le bot-controller ────────────────────────────────────

async function sendFileViaController(filepath, filename, meta, channelId = null) {
  const base64 = fs.readFileSync(filepath).toString("base64");
  const res = await fetch(`${BRIDGE_CONTROLLER_URL}/file`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": BRIDGE_SECRET,
    },
    body: JSON.stringify({ filename, base64, meta, channelId }),
  });
  return res.ok;
}

// ── Notification du resultat ──────────────────────────────────────────────────

async function notifySnapshotResult(jobId, result) {
  if (!jobId) return;
  try {
    await fetch(`${BRIDGE_CONTROLLER_URL}/snapshot-result`, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": BRIDGE_SECRET,
      },
      body: JSON.stringify({ jobId, ...result }),
    });
  } catch {
    // non bloquant
  }
}

// ── Runner principal (asynchrone) ─────────────────────────────────────────────

async function runSnapshot(client, channelId, limit, sendToChannelId, jobId) {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) {
    await notifySnapshotResult(jobId, {
      error:        `Salon ${channelId} introuvable ou inaccessible.`,
      channelName:  channelId,
      messageCount: 0,
      sent:         false,
      isDm:         false,
    });
    return;
  }

  const { isDm, isGroupDm, channelName, guildName, dmWith, snapshotDir } = classifyChannel(channel);

  const logLabel = isDm
    ? (isGroupDm ? `groupe DM "${channelName}" (${channelId})` : `DM avec ${channelName}`)
    : `#${channelName}${guildName ? ` (${guildName})` : ""} [${channelId}]`;

  console.log(`[SNAPSHOT] Début du snapshot de ${logLabel}...`);

  try {
    const rawMessages = await fetchAllMessages(channel, limit);
    console.log(`[SNAPSHOT] ${rawMessages.length} messages recupérés, génération HTML...`);

    const serialized = rawMessages.map(serializeMessage);

    const html = buildHtml({
      channelName,
      guildName,
      isDm,
      dmWith,
      messages: serialized,
    });

    fs.mkdirSync(snapshotDir, { recursive: true });

    // Nom de fichier horodate — utilise l'ID du salon pour eviter les collisions
    const filename = `snapshot_${channelId}_${Date.now()}.html`;
    const filepath = path.join(snapshotDir, filename);

    fs.writeFileSync(filepath, html, "utf-8");

    const fileSizeKb = Math.round(html.length / 1024);

    const meta = {
      channelName,
      guildName,
      isDm,
      isGroupDm,
      dmWith,
      messageCount: serialized.length,
      filename,
      fileSizeKb,
    };

    let sent = false;
    try {
      sent = await sendFileViaController(filepath, filename, meta, sendToChannelId ?? null);
      console.log(`[SNAPSHOT] ${sent ? "Fichier transmis au bot controller." : "Bot controller injoignable."}`);
    } catch (err) {
      console.error("[SNAPSHOT] Erreur envoi au bot controller :", err.message);
    }

    await notifySnapshotResult(jobId, {
      channelId,
      channelName,
      guildName,
      isDm,
      isGroupDm,
      dmWith,
      messageCount: serialized.length,
      filename,
      filepath,
      fileSizeKb,
      sent,
      sentChannelId: sendToChannelId ?? null,
    });
  } catch (err) {
    console.error("[SNAPSHOT] Erreur pendant le snapshot :", err.message);
    await notifySnapshotResult(jobId, {
      error:        err.message,
      channelName,
      guildName,
      isDm,
      messageCount: 0,
      sent:         false,
    });
  }
}

// ── execute (bridge) ──────────────────────────────────────────────────────────

/**
 * @param {import("discord.js-selfbot-v13").Client} client
 * @param {{ action: string, channelId?: string, limit?: number, sendToChannelId?: string, jobId?: string }} payload
 */
async function execute(client, payload) {
  const { action, channelId, limit = 0, sendToChannelId, jobId } = payload;

  if (action === "snapshot") {
    if (!channelId) throw new Error("channelId requis.");

    // Lance le snapshot en arriere-plan pour ne pas bloquer le bridge
    setImmediate(() => {
      runSnapshot(client, channelId, limit, sendToChannelId, jobId).catch(err => {
        console.error("[SNAPSHOT] Erreur non gerée :", err.message);
        notifySnapshotResult(jobId, {
          error:        err.message,
          channelName:  channelId,
          messageCount: 0,
          sent:         false,
          isDm:         false,
        }).catch(() => {});
      });
    });

    return { started: true, channelId };
  }

  throw new Error(`Action snapshot inconnue : '${action}'`);
}

module.exports = { name: "snapshot", execute };