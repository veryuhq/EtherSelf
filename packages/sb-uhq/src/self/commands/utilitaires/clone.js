"use strict";

const fs    = require("fs");
const path  = require("path");
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));
const { dataPath } = require("../../func/data-path");

const CLONE_LOG_FILE        = dataPath("logs", "clone_history.json");
const BRIDGE_CONTROLLER_URL = process.env.BRIDGE_CONTROLLER_URL ?? "http://127.0.0.1:3001";
const BRIDGE_SECRET         = process.env.BRIDGE_SECRET ?? "";

// ── Délais pour éviter le rate-limit ─────────────────────────────────────────

const DELAY = {
  role:    600,
  channel: 500,
  emoji:   1200,
};

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Limite d'emojis selon le niveau de boost ──────────────────────────────────

function getEmojiLimit(guild) {
  const tier = guild.premiumTier ?? 0;
  const tierNum = typeof tier === "string"
    ? ({ NONE: 0, TIER_1: 1, TIER_2: 2, TIER_3: 3 }[tier] ?? 0)
    : tier;

  switch (tierNum) {
    case 1:  return 100;
    case 2:  return 150;
    case 3:  return 250;
    default: return 50;
  }
}

// ── Registre des jobs actifs (pour annulation) ────────────────────────────────

const activeJobs = new Map();

function registerJob(jobId) {
  activeJobs.set(jobId, { cancelled: false });
}

function cancelJob(jobId) {
  const job = activeJobs.get(jobId);
  if (job) {
    job.cancelled = true;
    return true;
  }
  return false;
}

function isCancelled(jobId) {
  return activeJobs.get(jobId)?.cancelled === true;
}

function cleanJob(jobId) {
  activeJobs.delete(jobId);
}

// ── I/O historique ────────────────────────────────────────────────────────────

function loadHistory() {
  try { return JSON.parse(fs.readFileSync(CLONE_LOG_FILE, "utf-8")); }
  catch { return []; }
}

function saveHistory(history) {
  fs.mkdirSync(path.dirname(CLONE_LOG_FILE), { recursive: true });
  fs.writeFileSync(CLONE_LOG_FILE, JSON.stringify(history, null, 2));
}

function pushHistory(entry) {
  const h = loadHistory();
  h.push(entry);
  if (h.length > 20) h.shift();
  saveHistory(h);
}

// ── Progression bridge ────────────────────────────────────────────────────────

async function notifyProgress(jobId, data) {
  if (!jobId) return;
  fetch(`${BRIDGE_CONTROLLER_URL}/clone-progress`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": BRIDGE_SECRET,
    },
    body: JSON.stringify({ jobId, ...data }),
  }).catch(() => {});
}

// ── Fetch image en base64 (pour emojis/icône) ─────────────────────────────────

async function fetchBase64(url) {
  try {
    const res  = await fetch(url);
    const buf  = await res.buffer();
    const mime = res.headers.get("content-type") || "image/png";
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

// ── Erreur d'annulation ───────────────────────────────────────────────────────

class CancelledError extends Error {
  constructor() { super("Clonage annulé par l'utilisateur."); this.cancelled = true; }
}

function checkCancelled(jobId) {
  if (isCancelled(jobId)) throw new CancelledError();
}

// ── Détection de la limite d'emojis Discord ───────────────────────────────────

function isEmojiLimitError(err) {
  if (!err) return false;
  const msg = (err.message ?? "").toLowerCase();
  return (
    err.code === 30008 ||
    msg.includes("maximum number of emojis") ||
    msg.includes("30008")
  );
}

// ── Traduction des permission overwrites ──────────────────────────────────────

function translateOverwrites(sourceChannel, roleMap) {
  const overwrites = [];

  for (const [id, overwrite] of sourceChannel.permissionOverwrites.cache) {
    const isRoleOverwrite = overwrite.type === "role" || overwrite.type === 0;
    if (!isRoleOverwrite) continue;

    const targetRole = roleMap.get(id);
    if (!targetRole) continue;

    overwrites.push({
      id:    targetRole.id,
      type:  0,
      allow: overwrite.allow.bitfield,
      deny:  overwrite.deny.bitfield,
    });
  }

  return overwrites;
}

// ── Nettoyage des rôles existants ─────────────────────────────────────────────

async function clearRoles(targetGuild, pushLog, jobId) {
  const roles = [...targetGuild.roles.cache.values()].filter(
    r => !r.managed && r.name !== "@everyone"
  );
  pushLog(`🗑️ Suppression de ${roles.length} rôle(s) existant(s)…`);
  for (const r of roles) {
    checkCancelled(jobId);
    await r.delete("Clone serveur — nettoyage").catch(() => {});
    await sleep(300);
  }
}

// ── Nettoyage des emojis existants ────────────────────────────────────────────

async function clearEmojis(targetGuild, pushLog, jobId) {
  const emojis = [...targetGuild.emojis.cache.values()];
  pushLog(`🗑️ Suppression de ${emojis.length} emoji(s) existant(s)…`);
  for (const emoji of emojis) {
    checkCancelled(jobId);
    await emoji.delete("Clone serveur — nettoyage").catch(() => {});
    await sleep(400);
  }
}

// ── Clonage des rôles ─────────────────────────────────────────────────────────

async function cloneRoles(sourceGuild, targetGuild, jobId, pushLog, ctx) {
  const roleMap = new Map();

  await targetGuild.roles.fetch().catch(() => {});
  await clearRoles(targetGuild, pushLog, jobId);

  const roles = [...sourceGuild.roles.cache.values()]
    .filter(r => !r.managed && r.name !== "@everyone")
    .sort((a, b) => a.position - b.position);

  pushLog(`🎭 Clonage de ${roles.length} rôle(s)…`);
  await notifyProgress(jobId, {
    step: "roles", current: 0, total: roles.length,
    label: "Clonage des rôles…", done: false,
    sourceGuild: ctx.sourceGuildName,
    targetGuild: ctx.targetGuildName,
  });

  for (let i = 0; i < roles.length; i++) {
    checkCancelled(jobId);
    const r = roles[i];
    try {
      const created = await targetGuild.roles.create({
        name:        r.name,
        color:       r.color,
        hoist:       r.hoist,
        mentionable: r.mentionable,
        permissions: r.permissions.bitfield,
        reason:      "Clone serveur",
      });
      roleMap.set(r.id, created);
      pushLog(`✅ Rôle "${r.name}" créé`);
    } catch (err) {
      pushLog(`⚠️ Rôle "${r.name}" ignoré : ${err.message}`);
    }

    await notifyProgress(jobId, {
      step: "roles", current: i + 1, total: roles.length,
      label: `Rôle : ${r.name}`, done: false,
      sourceGuild: ctx.sourceGuildName,
      targetGuild: ctx.targetGuildName,
    });

    await sleep(DELAY.role);
  }

  roleMap.set(sourceGuild.id, targetGuild.roles.everyone);

  return roleMap;
}

// ── Clonage des catégories et salons ─────────────────────────────────────────

async function cloneChannels(sourceGuild, targetGuild, roleMap, jobId, pushLog, ctx) {
  const channelMap = new Map();

  await sourceGuild.channels.fetch().catch(() => {});

  pushLog("🗑️ Suppression des salons existants…");
  const existing = [...targetGuild.channels.cache.values()].filter(c => !c.isThread?.());
  for (const ch of existing) {
    checkCancelled(jobId);
    await ch.delete("Clone serveur — nettoyage").catch(() => {});
    await sleep(200);
  }

  const allChannels = [...sourceGuild.channels.cache.values()]
    .filter(c => !c.isThread?.())
    .sort((a, b) => {
      if (a.type === "GUILD_CATEGORY" && b.type !== "GUILD_CATEGORY") return -1;
      if (a.type !== "GUILD_CATEGORY" && b.type === "GUILD_CATEGORY") return 1;
      return a.position - b.position;
    });

  pushLog(`📋 ${allChannels.length} salon(s) à créer…`);
  await notifyProgress(jobId, {
    step: "channels", current: 0, total: allChannels.length,
    label: "Clonage des salons…", done: false,
    sourceGuild: ctx.sourceGuildName,
    targetGuild: ctx.targetGuildName,
  });

  const categories = allChannels.filter(c => c.type === "GUILD_CATEGORY");
  for (let i = 0; i < categories.length; i++) {
    checkCancelled(jobId);
    const cat = categories[i];
    try {
      const overwrites = translateOverwrites(cat, roleMap);
      const created    = await targetGuild.channels.create(cat.name, {
        type:                 "GUILD_CATEGORY",
        position:             cat.position,
        permissionOverwrites: overwrites,
        reason:               "Clone serveur",
      });
      channelMap.set(cat.id, created);
      pushLog(`📁 "${cat.name}" — ${overwrites.length} overwrite(s)`);
    } catch (err) {
      pushLog(`⚠️ Catégorie "${cat.name}" ignorée : ${err.message}`);
    }

    await notifyProgress(jobId, {
      step: "channels", current: i + 1, total: allChannels.length,
      label: `Catégorie : ${cat.name}`, done: false,
      sourceGuild: ctx.sourceGuildName,
      targetGuild: ctx.targetGuildName,
    });

    await sleep(DELAY.channel);
  }

  const nonCats = allChannels.filter(c => c.type !== "GUILD_CATEGORY");
  for (let i = 0; i < nonCats.length; i++) {
    checkCancelled(jobId);
    const ch = nonCats[i];

    const parentCategory = ch.parentId ? channelMap.get(ch.parentId) ?? null : null;
    const overwrites     = translateOverwrites(ch, roleMap);

    const typeMap = {
      "GUILD_TEXT":         "GUILD_TEXT",
      "GUILD_VOICE":        "GUILD_VOICE",
      "GUILD_ANNOUNCEMENT": "GUILD_ANNOUNCEMENT",
      "GUILD_STAGE_VOICE":  "GUILD_STAGE_VOICE",
      "GUILD_FORUM":        "GUILD_TEXT",
    };
    const channelType = typeMap[ch.type] ?? "GUILD_TEXT";

    const options = {
      type:                 channelType,
      position:             ch.position,
      permissionOverwrites: overwrites,
      reason:               "Clone serveur",
    };

    if (parentCategory)      options.parent          = parentCategory.id;
    if (ch.topic)            options.topic            = ch.topic;
    if (ch.nsfw)             options.nsfw             = ch.nsfw;
    if (ch.rateLimitPerUser) options.rateLimitPerUser = ch.rateLimitPerUser;

    if (ch.type === "GUILD_VOICE" || ch.type === "GUILD_STAGE_VOICE") {
      if (ch.bitrate)   options.bitrate   = Math.min(ch.bitrate, 96000);
      if (ch.userLimit) options.userLimit = ch.userLimit;
    }

    try {
      const created = await targetGuild.channels.create(ch.name, options);
      channelMap.set(ch.id, created);
      pushLog(`💬 #${ch.name} — ${overwrites.length} overwrite(s)`);
    } catch (err) {
      pushLog(`⚠️ #${ch.name} ignoré : ${err.message}`);
    }

    await notifyProgress(jobId, {
      step: "channels", current: categories.length + i + 1, total: allChannels.length,
      label: `Salon : ${ch.name}`, done: false,
      sourceGuild: ctx.sourceGuildName,
      targetGuild: ctx.targetGuildName,
    });

    await sleep(DELAY.channel);
  }

  return channelMap;
}

// ── Clonage des emojis ────────────────────────────────────────────────────────

async function cloneEmojis(sourceGuild, targetGuild, jobId, pushLog, ctx) {
  await targetGuild.emojis.fetch().catch(() => {});
  await clearEmojis(targetGuild, pushLog, jobId);

  const emojis = [...sourceGuild.emojis.cache.values()];
  if (!emojis.length) return 0;

  const emojiLimit  = getEmojiLimit(targetGuild);
  const tierNum     = typeof targetGuild.premiumTier === "string"
    ? ({ NONE: 0, TIER_1: 1, TIER_2: 2, TIER_3: 3 }[targetGuild.premiumTier] ?? 0)
    : (targetGuild.premiumTier ?? 0);
  const toClone     = Math.min(emojis.length, emojiLimit);
  const willSkip    = emojis.length - toClone;

  if (willSkip > 0) {
    pushLog(
      `⚠️ Serveur cible niveau ${tierNum} — limite : ${emojiLimit} emojis. ` +
      `${toClone}/${emojis.length} seront clonés, ${willSkip} ignorés.`
    );
  } else {
    pushLog(`😀 Clonage de ${emojis.length} emoji(s) (limite cible : ${emojiLimit})…`);
  }

  await notifyProgress(jobId, {
    step: "emojis", current: 0, total: toClone,
    label: `Clonage des emojis… (limite ${emojiLimit})`, done: false,
    sourceGuild: ctx.sourceGuildName,
    targetGuild: ctx.targetGuildName,
  });

  let cloned = 0;

  for (let i = 0; i < emojis.length; i++) {
    checkCancelled(jobId);

    if (cloned >= emojiLimit) {
      const remaining = emojis.length - i;
      pushLog(`🚫 Limite atteinte (${emojiLimit}) — ${remaining} emoji(s) restant(s) ignorés.`);
      break;
    }

    const emoji = emojis[i];

    try {
      const base64 = await fetchBase64(emoji.url);
      if (!base64) {
        pushLog(`⚠️ Emoji "${emoji.name}" — image introuvable, skip`);
      } else {
        await targetGuild.emojis.create(base64, emoji.name, { reason: "Clone serveur" });
        cloned++;
        pushLog(`✅ Emoji "${emoji.name}" (${cloned}/${toClone})`);
      }
    } catch (err) {
      if (isEmojiLimitError(err)) {
        const remaining = emojis.length - i;
        pushLog(`🚫 Limite Discord atteinte après ${cloned} emoji(s) — ${remaining} ignorés.`);
        await notifyProgress(jobId, {
          step: "emojis", current: cloned, total: toClone,
          label: `Limite atteinte après ${cloned} emoji(s)`, done: false,
          sourceGuild: ctx.sourceGuildName,
          targetGuild: ctx.targetGuildName,
        });
        break;
      }
      pushLog(`⚠️ Emoji "${emoji.name}" ignoré : ${err.message}`);
    }

    await notifyProgress(jobId, {
      step: "emojis", current: cloned, total: toClone,
      label: `Emoji : ${emoji.name}`, done: false,
      sourceGuild: ctx.sourceGuildName,
      targetGuild: ctx.targetGuildName,
    });

    await sleep(DELAY.emoji);
  }

  return cloned;
}

// ── Clonage des paramètres ────────────────────────────────────────────────────

async function cloneSettings(sourceGuild, targetGuild, channelMap, pushLog) {
  pushLog("⚙️ Application des paramètres du serveur…");

  const settings = {
    name:                        sourceGuild.name,
    defaultMessageNotifications: sourceGuild.defaultMessageNotifications,
    explicitContentFilter:       sourceGuild.explicitContentFilter,
    verificationLevel:           sourceGuild.verificationLevel,
    reason:                      "Clone serveur",
  };

  if (sourceGuild.icon) {
    const iconData = await fetchBase64(sourceGuild.iconURL({ size: 512, dynamic: true }));
    if (iconData) settings.icon = iconData;
  }

  if (sourceGuild.afkChannelId && channelMap.has(sourceGuild.afkChannelId)) {
    settings.afkChannel = channelMap.get(sourceGuild.afkChannelId).id;
    settings.afkTimeout = sourceGuild.afkTimeout;
  }

  if (sourceGuild.systemChannelId && channelMap.has(sourceGuild.systemChannelId)) {
    settings.systemChannel = channelMap.get(sourceGuild.systemChannelId).id;
  }

  try {
    await targetGuild.edit(settings);
    pushLog("✅ Paramètres appliqués");
  } catch (err) {
    pushLog(`⚠️ Paramètres partiellement appliqués : ${err.message}`);
  }
}

// ── Runner principal ──────────────────────────────────────────────────────────

async function runClone(client, sourceGuildId, targetGuildId, options, jobId) {
  const {
    cloneRolesEnabled    = true,
    cloneChannelsEnabled = true,
    cloneEmojisEnabled   = true,
    cloneSettingsEnabled = true,
  } = options;

  registerJob(jobId);

  const logBuffer = [];

  function pushLog(msg) {
    logBuffer.push(msg);
    if (logBuffer.length > 8) logBuffer.shift();
  }

  async function flushLogs(extra = {}) {
    await notifyProgress(jobId, {
      ...extra,
      logs: logBuffer.join("\n"),
    });
  }

  const startedAt = Date.now();

  let sourceGuild, targetGuild;

  try {
    sourceGuild = client.guilds.cache.get(sourceGuildId)
      ?? await client.guilds.fetch(sourceGuildId);
  } catch {
    throw new Error(`Serveur source ${sourceGuildId} introuvable ou inaccessible.`);
  }

  try {
    targetGuild = client.guilds.cache.get(targetGuildId)
      ?? await client.guilds.fetch(targetGuildId);
  } catch {
    throw new Error(`Serveur cible ${targetGuildId} introuvable ou inaccessible.`);
  }

  // Contexte partagé avec les sous-fonctions pour les notifications
  const ctx = {
    sourceGuildName: sourceGuild.name,
    targetGuildName: targetGuild.name,
  };

  pushLog(`🚀 "${sourceGuild.name}" → "${targetGuild.name}"`);
  await notifyProgress(jobId, {
    step:        "start",
    sourceGuild: sourceGuild.name,
    targetGuild: targetGuild.name,
    current:     0,
    total:       0,
    label:       "Initialisation…",
    logs:        logBuffer.join("\n"),
    jobId,
    done:        false,
  });

  await sourceGuild.channels.fetch().catch(() => {});
  await sourceGuild.roles.fetch().catch(() => {});
  await sourceGuild.emojis.fetch().catch(() => {});

  let roleMap    = new Map();
  let channelMap = new Map();
  let emojisCloned = 0;

  try {
    if (cloneRolesEnabled) {
      roleMap = await cloneRoles(sourceGuild, targetGuild, jobId, pushLog, ctx);
    } else {
      roleMap.set(sourceGuild.id, targetGuild.roles.everyone);
    }
    await flushLogs({
      step: "roles_done", label: "Rôles terminés", done: false,
      sourceGuild: ctx.sourceGuildName, targetGuild: ctx.targetGuildName,
    });

    if (cloneChannelsEnabled) {
      channelMap = await cloneChannels(sourceGuild, targetGuild, roleMap, jobId, pushLog, ctx);
    }
    await flushLogs({
      step: "channels_done", label: "Salons terminés", done: false,
      sourceGuild: ctx.sourceGuildName, targetGuild: ctx.targetGuildName,
    });

    if (cloneEmojisEnabled) {
      emojisCloned = await cloneEmojis(sourceGuild, targetGuild, jobId, pushLog, ctx);
    }
    await flushLogs({
      step: "emojis_done", label: "Emojis terminés", done: false,
      sourceGuild: ctx.sourceGuildName, targetGuild: ctx.targetGuildName,
    });

    if (cloneSettingsEnabled && cloneChannelsEnabled) {
      await cloneSettings(sourceGuild, targetGuild, channelMap, pushLog);
    }
  } catch (err) {
    cleanJob(jobId);

    if (err.cancelled) {
      const cancelledEntry = {
        sourceGuildId,
        sourceGuildName: sourceGuild.name,
        targetGuildId,
        targetGuildName: targetGuild.name,
        cancelled:  true,
        success:    false,
        timestamp:  Date.now(),
      };
      pushHistory(cancelledEntry);

      await notifyProgress(jobId, {
        step:  "done",
        label: "Clonage annulé.",
        logs:  logBuffer.join("\n"),
        done:  true,
        sourceGuild: ctx.sourceGuildName,
        targetGuild: ctx.targetGuildName,
        summary: {
          ...cancelledEntry,
          rolesCloned:    0,
          channelsCloned: 0,
          emojisCloned:   0,
          duration:       Math.round((Date.now() - startedAt) / 1000),
        },
      });
      return;
    }

    throw err;
  }

  const duration = Math.round((Date.now() - startedAt) / 1000);
  pushLog(`🎉 Terminé en ${duration}s !`);

  const summary = {
    sourceGuildId,
    sourceGuildName: sourceGuild.name,
    targetGuildId,
    targetGuildName: targetGuild.name,
    rolesCloned:    cloneRolesEnabled    ? roleMap.size - 1 : 0,
    channelsCloned: cloneChannelsEnabled ? channelMap.size  : 0,
    emojisCloned:   cloneEmojisEnabled   ? emojisCloned     : 0,
    duration,
    timestamp: Date.now(),
    success:   true,
    cancelled: false,
  };

  pushHistory(summary);
  cleanJob(jobId);

  await notifyProgress(jobId, {
    step:  "done",
    label: `Clonage terminé en ${duration}s`,
    logs:  logBuffer.join("\n"),
    done:  true,
    sourceGuild: ctx.sourceGuildName,
    targetGuild: ctx.targetGuildName,
    summary,
  });

  return summary;
}

// ── execute (bridge) ──────────────────────────────────────────────────────────

async function execute(client, payload) {
  const { action } = payload;

  if (action === "listGuilds") {
    const guilds = [...client.guilds.cache.values()].map(g => ({
      id:          g.id,
      name:        g.name,
      memberCount: g.memberCount ?? 0,
      icon:        g.icon ? g.iconURL({ size: 64 }) : null,
    }));
    return { guilds };
  }

  if (action === "run") {
    const {
      sourceGuildId,
      targetGuildId,
      cloneRoles:    cloneRolesEnabled    = true,
      cloneChannels: cloneChannelsEnabled = true,
      cloneEmojis:   cloneEmojisEnabled   = true,
      cloneSettings: cloneSettingsEnabled = true,
      jobId,
    } = payload;

    if (!sourceGuildId) throw new Error("sourceGuildId requis.");
    if (!targetGuildId) throw new Error("targetGuildId requis.");
    if (sourceGuildId === targetGuildId) throw new Error("Les serveurs source et cible doivent être différents.");

    setImmediate(() => {
      runClone(
        client,
        sourceGuildId,
        targetGuildId,
        { cloneRolesEnabled, cloneChannelsEnabled, cloneEmojisEnabled, cloneSettingsEnabled },
        jobId,
      ).catch(err => {
        pushHistory({ sourceGuildId, targetGuildId, success: false, error: err.message, timestamp: Date.now() });
        notifyProgress(jobId, {
          step:  "error",
          label: `Erreur : ${err.message}`,
          logs:  err.message,
          done:  true,
          error: err.message,
        });
      });
    });

    return { started: true };
  }

  if (action === "cancel") {
    const { jobId } = payload;
    if (!jobId) throw new Error("jobId requis.");
    const cancelled = cancelJob(jobId);
    return { cancelled };
  }

  if (action === "getHistory") {
    return { history: loadHistory() };
  }

  if (action === "clearHistory") {
    saveHistory([]);
    return { history: [] };
  }

  throw new Error(`Action clone inconnue : '${action}'`);
}

module.exports = { name: "clone", execute };