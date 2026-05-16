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
const SNAPSHOT_SCHEDULE_FILE = dataPath("config", "snapshot-schedules.json");

const BRIDGE_CONTROLLER_URL = process.env.BRIDGE_CONTROLLER_URL ?? "http://127.0.0.1:3001";
const BRIDGE_SECRET         = process.env.BRIDGE_SECRET ?? "";

const SCHEDULE_TICK_MS = 60 * 1000;
const MIN_SCHEDULE_INTERVAL_MS = 5 * 60 * 1000;

let _scheduleInterval = null;
let _scheduleClient = null;
const _runningScheduledSnapshots = new Set();


// ── Configuration des snapshots périodiques ──────────────────────────────────

function loadScheduleConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(SNAPSHOT_SCHEDULE_FILE, "utf-8"));
    return {
      running: raw.running === true,
      jobs: Array.isArray(raw.jobs) ? raw.jobs : [],
    };
  } catch {
    return { running: false, jobs: [] };
  }
}

function saveScheduleConfig(config) {
  fs.mkdirSync(path.dirname(SNAPSHOT_SCHEDULE_FILE), { recursive: true });
  fs.writeFileSync(SNAPSHOT_SCHEDULE_FILE, JSON.stringify({
    running: config.running === true,
    jobs: Array.isArray(config.jobs) ? config.jobs : [],
  }, null, 2));
}

function parseScheduleInterval(input) {
  const raw = String(input ?? "").trim().toLowerCase().replace(/,/g, ".");
  if (!raw) throw new Error("Intervalle requis (ex: 1w, 7d, 24h, 60m).");

  const compact = raw.match(/^(\d+(?:\.\d+)?)\s*(m|min|minute|minutes|h|heure|heures|d|j|jour|jours|w|s|sem|semaine|semaines)$/i);
  const words = raw.match(/^toutes?\s+les?\s+(\d+(?:\.\d+)?)\s*(m|min|minute|minutes|h|heure|heures|d|j|jour|jours|w|s|sem|semaine|semaines)$/i);
  const match = compact ?? words;
  if (!match) throw new Error("Format d'intervalle invalide. Exemples : 1w, 7d, 24h, 60m.");

  const value = Number(match[1]);
  const unit = match[2];
  if (!Number.isFinite(value) || value <= 0) throw new Error("L'intervalle doit être supérieur à 0.");

  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  let ms;

  if (["m", "min", "minute", "minutes"].includes(unit)) ms = value * minute;
  else if (["h", "heure", "heures"].includes(unit)) ms = value * hour;
  else if (["d", "j", "jour", "jours"].includes(unit)) ms = value * day;
  else if (["w", "s", "sem", "semaine", "semaines"].includes(unit)) ms = value * week;
  else throw new Error("Unité d'intervalle invalide.");

  if (ms < MIN_SCHEDULE_INTERVAL_MS) throw new Error("Intervalle trop court (minimum 5 minutes).");
  return Math.round(ms);
}

function formatScheduleInterval(ms) {
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;

  if (ms % week === 0) return `${ms / week} semaine(s)`;
  if (ms % day === 0) return `${ms / day} jour(s)`;
  if (ms % hour === 0) return `${ms / hour} heure(s)`;
  if (ms % minute === 0) return `${ms / minute} minute(s)`;
  return `${Math.round(ms / minute)} minute(s)`;
}

function publicScheduleState() {
  const config = loadScheduleConfig();
  const now = Date.now();
  return {
    running: config.running === true && _scheduleInterval !== null,
    jobs: config.jobs.map(job => ({
      ...job,
      intervalLabel: formatScheduleInterval(job.intervalMs),
      nextRunInMs: Math.max(0, (job.nextRunAt ?? now) - now),
    })),
  };
}

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


// ── Boucle des snapshots périodiques ─────────────────────────────────────────

async function runScheduledSnapshot(client, job) {
  if (_runningScheduledSnapshots.has(job.id)) return;
  _runningScheduledSnapshots.add(job.id);

  try {
    console.log(`[SNAPSHOT] Snapshot périodique déclenché pour ${job.channelId}`);
    await runSnapshot(client, job.channelId, job.limit ?? 0, job.sendToChannelId ?? null, null);
  } catch (err) {
    console.error(`[SNAPSHOT] Erreur snapshot périodique ${job.channelId} :`, err.message);
  } finally {
    const config = loadScheduleConfig();
    const current = config.jobs.find(j => j.id === job.id);
    if (current) {
      current.lastRunAt = Date.now();
      current.nextRunAt = current.lastRunAt + current.intervalMs;
      saveScheduleConfig(config);
    }
    _runningScheduledSnapshots.delete(job.id);
  }
}

function tickSchedules() {
  if (!_scheduleClient) return;
  const config = loadScheduleConfig();
  if (!config.running) return;

  const now = Date.now();
  let changed = false;

  for (const job of config.jobs) {
    if (!job.nextRunAt) {
      job.nextRunAt = now + job.intervalMs;
      changed = true;
      continue;
    }

    if (job.nextRunAt <= now) {
      runScheduledSnapshot(_scheduleClient, { ...job }).catch(() => {});
    }
  }

  if (changed) saveScheduleConfig(config);
}

function startScheduleLoop(client) {
  _scheduleClient = client;
  if (_scheduleInterval) return false;
  _scheduleInterval = setInterval(tickSchedules, SCHEDULE_TICK_MS);
  tickSchedules();
  return true;
}

function stopScheduleLoop() {
  if (!_scheduleInterval) return false;
  clearInterval(_scheduleInterval);
  _scheduleInterval = null;
  return true;
}

function onReady(client) {
  const config = loadScheduleConfig();
  if (config.running && config.jobs.length) {
    startScheduleLoop(client);
    console.log(`[SNAPSHOT] 🔄 Boucle périodique relancée (${config.jobs.length} salon(s)).`);
  }
}

// ── execute (bridge) ──────────────────────────────────────────────────────────

/**
 * @param {import("discord.js-selfbot-v13").Client} client
 * @param {{ action: string, channelId?: string, limit?: number, sendToChannelId?: string, jobId?: string, interval?: string }} payload
 */
async function execute(client, payload) {
  const { action, channelId, limit = 0, sendToChannelId, jobId, interval } = payload;

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

  if (action === "periodic.list") {
    const config = loadScheduleConfig();
    if (config.running && config.jobs.length && !_scheduleInterval) {
      startScheduleLoop(client);
    }
    return publicScheduleState();
  }

  if (action === "periodic.add") {
    if (!channelId) throw new Error("channelId requis.");
    const intervalMs = parseScheduleInterval(interval);
    const safeLimit = Math.max(0, parseInt(limit, 10) || 0);
    const config = loadScheduleConfig();
    const now = Date.now();
    const id = channelId;
    const existing = config.jobs.findIndex(j => j.id === id);
    const job = {
      id,
      channelId,
      intervalMs,
      limit: safeLimit,
      sendToChannelId: sendToChannelId ?? null,
      createdAt: existing >= 0 ? config.jobs[existing].createdAt ?? now : now,
      lastRunAt: existing >= 0 ? config.jobs[existing].lastRunAt ?? null : null,
      nextRunAt: now + intervalMs,
    };

    if (existing >= 0) config.jobs[existing] = job;
    else config.jobs.push(job);

    config.running = true;
    saveScheduleConfig(config);
    startScheduleLoop(client);
    return publicScheduleState();
  }

  if (action === "periodic.remove") {
    if (!channelId) throw new Error("channelId requis.");
    const config = loadScheduleConfig();
    const before = config.jobs.length;
    config.jobs = config.jobs.filter(j => j.channelId !== channelId && j.id !== channelId);
    if (config.jobs.length === before) throw new Error("Aucun snapshot périodique trouvé pour ce salon.");
    if (!config.jobs.length) {
      config.running = false;
      stopScheduleLoop();
    }
    saveScheduleConfig(config);
    return publicScheduleState();
  }

  if (action === "periodic.start") {
    const config = loadScheduleConfig();
    if (!config.jobs.length) throw new Error("Aucun snapshot périodique configuré.");
    config.running = true;
    saveScheduleConfig(config);
    startScheduleLoop(client);
    return publicScheduleState();
  }

  if (action === "periodic.stop") {
    const config = loadScheduleConfig();
    config.running = false;
    saveScheduleConfig(config);
    stopScheduleLoop();
    return publicScheduleState();
  }

  throw new Error(`Action snapshot inconnue : '${action}'`);
}

module.exports = { name: "snapshot", execute, onReady, parseScheduleInterval, formatScheduleInterval };
