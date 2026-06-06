"use strict";

const fs    = require("fs");
const path  = require("path");
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));
const { dataPath } = require("../../func/data-path");
const { makeDesktopHeaders } = require("../../func/discord-client-headers");
const { signedHeaders } = require("../../../bridge/auth");

const CLONE_LOG_FILE        = dataPath("logs", "clone_history.json");
const BACKUPS_FILE          = dataPath("logs", "backups_data.json");
const BRIDGE_CONTROLLER_URL = process.env.BRIDGE_CONTROLLER_URL ?? "http://127.0.0.1:3001";

function makeDiscordHeaders(token, includeContentType = true) {
  const headers = makeDesktopHeaders(token);
  if (!includeContentType) delete headers["Content-Type"];
  return headers;
}

// ── Délais ────────────────────────────────────────────────────────────────────

const DELAY = { role: 600, channel: 500, emoji: 1200 };

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── I/O ───────────────────────────────────────────────────────────────────────

function loadCloneHistory() {
  try { return JSON.parse(fs.readFileSync(CLONE_LOG_FILE, "utf-8")); }
  catch { return []; }
}

function saveCloneHistory(h) {
  fs.mkdirSync(path.dirname(CLONE_LOG_FILE), { recursive: true });
  fs.writeFileSync(CLONE_LOG_FILE, JSON.stringify(h, null, 2));
}

function pushCloneHistory(entry) {
  const h = loadCloneHistory();
  h.push(entry);
  if (h.length > 20) h.shift();
  saveCloneHistory(h);
}

function loadBackupsData() {
  try { return JSON.parse(fs.readFileSync(BACKUPS_FILE, "utf-8")); }
  catch { return { friends: null, guilds: null, friendsSavedAt: null, guildsSavedAt: null }; }
}

function saveBackupsData(data) {
  fs.mkdirSync(path.dirname(BACKUPS_FILE), { recursive: true });
  fs.writeFileSync(BACKUPS_FILE, JSON.stringify(data, null, 2));
}

// ── Jobs actifs ───────────────────────────────────────────────────────────────

const activeJobs = new Map();

function registerJob(jobId) { activeJobs.set(jobId, { cancelled: false }); }
function cancelJob(jobId) {
  const job = activeJobs.get(jobId);
  if (job) { job.cancelled = true; return true; }
  return false;
}
function isCancelled(jobId) { return activeJobs.get(jobId)?.cancelled === true; }
function cleanJob(jobId) { activeJobs.delete(jobId); }

class CancelledError extends Error {
  constructor() { super("Clonage annulé par l'utilisateur."); this.cancelled = true; }
}
function checkCancelled(jobId) { if (isCancelled(jobId)) throw new CancelledError(); }

// ── Progression bridge ────────────────────────────────────────────────────────

async function notifyProgress(jobId, data) {
  if (!jobId) return;
  const body = JSON.stringify({ jobId, ...data });
  fetch(`${BRIDGE_CONTROLLER_URL}/clone-progress`, {
    method: "POST",
    headers: signedHeaders(body, { "Content-Type": "application/json" }),
    body,
  }).catch(() => {});
}

// ── Sérialisation d'un ami ────────────────────────────────────────────────────

/**
 * Sérialise un ami depuis n'importe quelle source (objet API brut, objet discord.js, ou juste un ID).
 * Lit tous les champs possibles pour maximiser les données récupérées.
 */
function serializeFriend(userId, user, since) {
  // L'objet peut venir de l'API REST (snake_case) ou de discord.js (camelCase)
  const username   = user?.username ?? null;
  const discrim    = user?.discriminator ?? "0";
  const globalName = user?.global_name ?? user?.globalName ?? null;
  const avatar     = user?.avatar ?? null;

  let tag;
  if (username) {
    tag = (discrim && discrim !== "0") ? `${username}#${discrim}` : username;
  } else {
    tag = userId;
  }

  return {
    id:         userId,
    tag,
    username,
    globalName,
    avatar,
    since:      since ?? null,
  };
}

// ── Fetch amis ────────────────────────────────────────────────────────────────

async function fetchFriends(client) {
  // On passe TOUJOURS par l'API REST : c'est la seule source fiable qui retourne
  // les données complètes (username, global_name, avatar) pour tous les amis,
  // y compris ceux qui ne sont pas dans le cache discord.js.
  const getHeaders = makeDiscordHeaders(client.token, false);

  const res = await fetch("https://discord.com/api/v9/users/@me/relationships", {
    method: "GET",
    headers: getHeaders,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Impossible de récupérer les amis — HTTP ${res.status}${body ? ` : ${body.slice(0, 200)}` : ""}`);
  }

  const data = await res.json();

  // type 1 = ami accepté
  const friends = data
    .filter(r => r.type === 1)
    .map(r => serializeFriend(r.id, r.user ?? {}, r.since ?? null));

  return { friends, source: "api" };
}

// ── Fetch serveurs avec lien d'invitation permanent ───────────────────────────

async function createPermanentInvite(guild, client) {
  // On récupère tous les salons texte sans vérifier les permissions à l'avance
  // (le cache des permissions en selfbot est souvent incomplet/incorrect).
  // On tente salon par salon et on passe au suivant en cas d'échec.
  const channels = [...guild.channels.cache.values()].filter(c =>
    c.type === "GUILD_TEXT" || c.type === "GUILD_NEWS"
  );

  // Priorité au salon système s'il existe
  const sorted = channels.sort((a, b) => {
    if (a.id === guild.systemChannelId) return -1;
    if (b.id === guild.systemChannelId) return 1;
    return a.position - b.position;
  });

  for (const channel of sorted) {
    try {
      const invite = await channel.createInvite({
        maxAge:  0,
        maxUses: 0,
        unique:  false,
        reason:  "Backup EtherSelf",
      });
      if (invite?.code) return `https://discord.gg/${invite.code}`;
    } catch {
      // Pas les perms ou autre erreur sur ce salon → on essaie le suivant
    }
  }

  return null;
}

async function fetchGuilds(client, withInvites = false) {
  const guilds = [];

  for (const guild of client.guilds.cache.values()) {
    let invite = null;

    if (withInvites) {
      try {
        const existing = await guild.invites.fetch().catch(() => null);
        if (existing && existing.size > 0) {
          // Priorité : invite permanente créée par le selfbot, sinon n'importe quelle permanente
          const ownPerm = existing.find(i => i.maxAge === 0 && i.inviter?.id === client.user?.id);
          const anyPerm = existing.find(i => i.maxAge === 0);
          invite = ownPerm?.url ?? anyPerm?.url ?? null;
        }
      } catch { /* non bloquant */ }

      // Si aucune invite existante trouvée, on essaie d'en créer une
      if (!invite) invite = await createPermanentInvite(guild, client);
    }

    guilds.push({
      id:      guild.id,
      name:    guild.name,
      icon:    guild.icon ? guild.iconURL({ size: 64, dynamic: true }) : null,
      ownerId: guild.ownerId ?? null,
      isOwner: guild.ownerId === client.user?.id,
      invite:  invite ?? null,
    });
  }

  if (guilds.length > 0) return { guilds, source: "cache" };

  const res = await fetch("https://discord.com/api/v9/users/@me/guilds", {
    headers: makeDiscordHeaders(client.token, false),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return {
    guilds: data.map(g => ({
      id:      g.id,
      name:    g.name,
      icon:    g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64` : null,
      ownerId: null,
      isOwner: !!g.owner,
      invite:  null,
    })),
    source: "api",
  };
}

// ══════════════════════════════════════════════════════════════════════════════
//  CLONE
// ══════════════════════════════════════════════════════════════════════════════

function getEmojiLimit(guild) {
  const tier = guild.premiumTier ?? 0;
  const n = typeof tier === "string"
    ? ({ NONE: 0, TIER_1: 1, TIER_2: 2, TIER_3: 3 }[tier] ?? 0)
    : tier;
  return [50, 100, 150, 250][n] ?? 50;
}

function isEmojiLimitError(err) {
  const msg = (err?.message ?? "").toLowerCase();
  return err?.code === 30008 || msg.includes("maximum number of emojis") || msg.includes("30008");
}

async function fetchBase64(url) {
  try {
    const res = await fetch(url);
    const buf = await res.buffer();
    const mime = res.headers.get("content-type") || "image/png";
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch { return null; }
}

function translateOverwrites(channel, roleMap) {
  const result = [];
  for (const [id, ow] of channel.permissionOverwrites.cache) {
    if (ow.type !== "role" && ow.type !== 0) continue;
    const target = roleMap.get(id);
    if (!target) continue;
    result.push({ id: target.id, type: 0, allow: ow.allow.bitfield, deny: ow.deny.bitfield });
  }
  return result;
}

async function clearRoles(guild, pushLog, jobId) {
  const roles = [...guild.roles.cache.values()].filter(r => !r.managed && r.name !== "@everyone");
  pushLog(`🗑️ Suppression de ${roles.length} rôle(s)…`);
  for (const r of roles) { checkCancelled(jobId); await r.delete("Clone").catch(() => {}); await sleep(300); }
}

async function clearEmojis(guild, pushLog, jobId) {
  const emojis = [...guild.emojis.cache.values()];
  pushLog(`🗑️ Suppression de ${emojis.length} emoji(s)…`);
  for (const e of emojis) { checkCancelled(jobId); await e.delete("Clone").catch(() => {}); await sleep(400); }
}

async function cloneRoles(src, tgt, jobId, pushLog, ctx) {
  const roleMap = new Map();
  await tgt.roles.fetch().catch(() => {});
  await clearRoles(tgt, pushLog, jobId);
  const roles = [...src.roles.cache.values()]
    .filter(r => !r.managed && r.name !== "@everyone")
    .sort((a, b) => a.position - b.position);
  pushLog(`🎭 Clonage de ${roles.length} rôle(s)…`);
  await notifyProgress(jobId, { step: "roles", current: 0, total: roles.length, label: "Clonage des rôles…", done: false, sourceGuild: ctx.src, targetGuild: ctx.tgt });
  for (let i = 0; i < roles.length; i++) {
    checkCancelled(jobId);
    const r = roles[i];
    try {
      const created = await tgt.roles.create({ name: r.name, color: r.color, hoist: r.hoist, mentionable: r.mentionable, permissions: r.permissions.bitfield, reason: "Clone" });
      roleMap.set(r.id, created);
      pushLog(`✅ Rôle "${r.name}"`);
    } catch (e) { pushLog(`⚠️ "${r.name}" ignoré : ${e.message}`); }
    await notifyProgress(jobId, { step: "roles", current: i + 1, total: roles.length, label: `Rôle : ${r.name}`, done: false, sourceGuild: ctx.src, targetGuild: ctx.tgt });
    await sleep(DELAY.role);
  }
  roleMap.set(src.id, tgt.roles.everyone);
  return roleMap;
}

async function cloneChannels(src, tgt, roleMap, jobId, pushLog, ctx) {
  const channelMap = new Map();
  await src.channels.fetch().catch(() => {});
  pushLog("🗑️ Suppression des salons existants…");
  for (const ch of [...tgt.channels.cache.values()].filter(c => !c.isThread?.())) {
    checkCancelled(jobId); await ch.delete("Clone").catch(() => {}); await sleep(200);
  }
  const all = [...src.channels.cache.values()]
    .filter(c => !c.isThread?.())
    .sort((a, b) => {
      if (a.type === "GUILD_CATEGORY" && b.type !== "GUILD_CATEGORY") return -1;
      if (a.type !== "GUILD_CATEGORY" && b.type === "GUILD_CATEGORY") return 1;
      return a.position - b.position;
    });
  pushLog(`📋 ${all.length} salon(s) à créer…`);
  await notifyProgress(jobId, { step: "channels", current: 0, total: all.length, label: "Clonage des salons…", done: false, sourceGuild: ctx.src, targetGuild: ctx.tgt });
  const cats = all.filter(c => c.type === "GUILD_CATEGORY");
  for (let i = 0; i < cats.length; i++) {
    checkCancelled(jobId);
    const cat = cats[i];
    try {
      const created = await tgt.channels.create(cat.name, { type: "GUILD_CATEGORY", position: cat.position, permissionOverwrites: translateOverwrites(cat, roleMap), reason: "Clone" });
      channelMap.set(cat.id, created);
      pushLog(`📁 "${cat.name}"`);
    } catch (e) { pushLog(`⚠️ Cat "${cat.name}" ignorée : ${e.message}`); }
    await notifyProgress(jobId, { step: "channels", current: i + 1, total: all.length, label: `Cat : ${cat.name}`, done: false, sourceGuild: ctx.src, targetGuild: ctx.tgt });
    await sleep(DELAY.channel);
  }
  const nonCats = all.filter(c => c.type !== "GUILD_CATEGORY");
  const typeMap = { GUILD_TEXT: "GUILD_TEXT", GUILD_VOICE: "GUILD_VOICE", GUILD_ANNOUNCEMENT: "GUILD_ANNOUNCEMENT", GUILD_STAGE_VOICE: "GUILD_STAGE_VOICE", GUILD_FORUM: "GUILD_TEXT" };
  for (let i = 0; i < nonCats.length; i++) {
    checkCancelled(jobId);
    const ch = nonCats[i];
    const opts = { type: typeMap[ch.type] ?? "GUILD_TEXT", position: ch.position, permissionOverwrites: translateOverwrites(ch, roleMap), reason: "Clone" };
    const parent = ch.parentId ? channelMap.get(ch.parentId) : null;
    if (parent) opts.parent = parent.id;
    if (ch.topic) opts.topic = ch.topic;
    if (ch.nsfw) opts.nsfw = ch.nsfw;
    if (ch.rateLimitPerUser) opts.rateLimitPerUser = ch.rateLimitPerUser;
    if (ch.type === "GUILD_VOICE" || ch.type === "GUILD_STAGE_VOICE") {
      if (ch.bitrate) opts.bitrate = Math.min(ch.bitrate, 96000);
      if (ch.userLimit) opts.userLimit = ch.userLimit;
    }
    try {
      const created = await tgt.channels.create(ch.name, opts);
      channelMap.set(ch.id, created);
      pushLog(`💬 #${ch.name}`);
    } catch (e) { pushLog(`⚠️ #${ch.name} ignoré : ${e.message}`); }
    await notifyProgress(jobId, { step: "channels", current: cats.length + i + 1, total: all.length, label: `Salon : ${ch.name}`, done: false, sourceGuild: ctx.src, targetGuild: ctx.tgt });
    await sleep(DELAY.channel);
  }
  return channelMap;
}

async function cloneEmojis(src, tgt, jobId, pushLog, ctx) {
  await tgt.emojis.fetch().catch(() => {});
  await clearEmojis(tgt, pushLog, jobId);
  const emojis = [...src.emojis.cache.values()];
  if (!emojis.length) return 0;
  const limit = getEmojiLimit(tgt);
  const toClone = Math.min(emojis.length, limit);
  pushLog(`😀 Clonage de ${toClone}/${emojis.length} emoji(s) (limite ${limit})…`);
  await notifyProgress(jobId, { step: "emojis", current: 0, total: toClone, label: `Clonage des emojis… (limite ${limit})`, done: false, sourceGuild: ctx.src, targetGuild: ctx.tgt });
  let cloned = 0;
  for (let i = 0; i < emojis.length; i++) {
    checkCancelled(jobId);
    if (cloned >= limit) { pushLog(`🚫 Limite atteinte, ${emojis.length - i} ignorés.`); break; }
    const emoji = emojis[i];
    try {
      const b64 = await fetchBase64(emoji.url);
      if (!b64) { pushLog(`⚠️ "${emoji.name}" image introuvable`); }
      else { await tgt.emojis.create(b64, emoji.name, { reason: "Clone" }); cloned++; pushLog(`✅ "${emoji.name}" (${cloned}/${toClone})`); }
    } catch (e) {
      if (isEmojiLimitError(e)) { pushLog(`🚫 Limite Discord atteinte après ${cloned} emoji(s).`); break; }
      pushLog(`⚠️ "${emoji.name}" ignoré : ${e.message}`);
    }
    await notifyProgress(jobId, { step: "emojis", current: cloned, total: toClone, label: `Emoji : ${emoji.name}`, done: false, sourceGuild: ctx.src, targetGuild: ctx.tgt });
    await sleep(DELAY.emoji);
  }
  return cloned;
}

async function cloneSettings(src, tgt, channelMap, pushLog) {
  pushLog("⚙️ Application des paramètres…");
  const settings = {
    name: src.name,
    defaultMessageNotifications: src.defaultMessageNotifications,
    explicitContentFilter: src.explicitContentFilter,
    verificationLevel: src.verificationLevel,
    reason: "Clone",
  };
  if (src.icon) {
    const iconData = await fetchBase64(src.iconURL({ size: 512, dynamic: true }));
    if (iconData) settings.icon = iconData;
  }
  if (src.afkChannelId && channelMap.has(src.afkChannelId)) { settings.afkChannel = channelMap.get(src.afkChannelId).id; settings.afkTimeout = src.afkTimeout; }
  if (src.systemChannelId && channelMap.has(src.systemChannelId)) settings.systemChannel = channelMap.get(src.systemChannelId).id;
  try { await tgt.edit(settings); pushLog("✅ Paramètres appliqués"); }
  catch (e) { pushLog(`⚠️ Paramètres partiels : ${e.message}`); }
}

async function runClone(client, sourceGuildId, targetGuildId, options, jobId) {
  const { cloneRolesEnabled = true, cloneChannelsEnabled = true, cloneEmojisEnabled = true, cloneSettingsEnabled = true } = options;
  registerJob(jobId);
  const logBuffer = [];
  function pushLog(msg) { logBuffer.push(msg); if (logBuffer.length > 8) logBuffer.shift(); }
  async function flushLogs(extra = {}) { await notifyProgress(jobId, { ...extra, logs: logBuffer.join("\n") }); }
  const startedAt = Date.now();

  let src, tgt;
  try { src = client.guilds.cache.get(sourceGuildId) ?? await client.guilds.fetch(sourceGuildId); }
  catch { throw new Error(`Serveur source ${sourceGuildId} introuvable.`); }
  try { tgt = client.guilds.cache.get(targetGuildId) ?? await client.guilds.fetch(targetGuildId); }
  catch { throw new Error(`Serveur cible ${targetGuildId} introuvable.`); }

  const ctx = { src: src.name, tgt: tgt.name };
  pushLog(`🚀 "${src.name}" → "${tgt.name}"`);
  await notifyProgress(jobId, { step: "start", sourceGuild: src.name, targetGuild: tgt.name, current: 0, total: 0, label: "Initialisation…", logs: logBuffer.join("\n"), jobId, done: false });

  await src.channels.fetch().catch(() => {});
  await src.roles.fetch().catch(() => {});
  await src.emojis.fetch().catch(() => {});

  let roleMap = new Map(), channelMap = new Map(), emojisCloned = 0;

  try {
    if (cloneRolesEnabled) roleMap = await cloneRoles(src, tgt, jobId, pushLog, ctx);
    else roleMap.set(src.id, tgt.roles.everyone);
    await flushLogs({ step: "roles_done", label: "Rôles terminés", done: false, sourceGuild: ctx.src, targetGuild: ctx.tgt });

    if (cloneChannelsEnabled) channelMap = await cloneChannels(src, tgt, roleMap, jobId, pushLog, ctx);
    await flushLogs({ step: "channels_done", label: "Salons terminés", done: false, sourceGuild: ctx.src, targetGuild: ctx.tgt });

    if (cloneEmojisEnabled) emojisCloned = await cloneEmojis(src, tgt, jobId, pushLog, ctx);
    await flushLogs({ step: "emojis_done", label: "Emojis terminés", done: false, sourceGuild: ctx.src, targetGuild: ctx.tgt });

    if (cloneSettingsEnabled && cloneChannelsEnabled) await cloneSettings(src, tgt, channelMap, pushLog);
  } catch (err) {
    cleanJob(jobId);
    if (err.cancelled) {
      const entry = { sourceGuildId, sourceGuildName: src.name, targetGuildId, targetGuildName: tgt.name, cancelled: true, success: false, timestamp: Date.now() };
      pushCloneHistory(entry);
      await notifyProgress(jobId, { step: "done", label: "Clonage annulé.", logs: logBuffer.join("\n"), done: true, sourceGuild: ctx.src, targetGuild: ctx.tgt, summary: { ...entry, rolesCloned: 0, channelsCloned: 0, emojisCloned: 0, duration: Math.round((Date.now() - startedAt) / 1000) } });
      return;
    }
    throw err;
  }

  const duration = Math.round((Date.now() - startedAt) / 1000);
  pushLog(`🎉 Terminé en ${duration}s !`);
  const summary = { sourceGuildId, sourceGuildName: src.name, targetGuildId, targetGuildName: tgt.name, rolesCloned: cloneRolesEnabled ? roleMap.size - 1 : 0, channelsCloned: cloneChannelsEnabled ? channelMap.size : 0, emojisCloned: cloneEmojisEnabled ? emojisCloned : 0, duration, timestamp: Date.now(), success: true, cancelled: false };
  pushCloneHistory(summary);
  cleanJob(jobId);
  await notifyProgress(jobId, { step: "done", label: `Clonage terminé en ${duration}s`, logs: logBuffer.join("\n"), done: true, sourceGuild: ctx.src, targetGuild: ctx.tgt, summary });
  return summary;
}

// ══════════════════════════════════════════════════════════════════════════════
//  EXECUTE (bridge)
// ══════════════════════════════════════════════════════════════════════════════

async function execute(client, payload) {
  const { action } = payload;

  // ── listGuilds ────────────────────────────────────────────────────────────
  if (action === "listGuilds") {
    const { guilds } = await fetchGuilds(client, false);
    return { guilds };
  }

  // ── Clone ─────────────────────────────────────────────────────────────────
  if (action === "clone.run") {
    const { sourceGuildId, targetGuildId, cloneRoles: cR = true, cloneChannels: cCh = true, cloneEmojis: cE = true, cloneSettings: cS = true, jobId } = payload;
    if (!sourceGuildId) throw new Error("sourceGuildId requis.");
    if (!targetGuildId) throw new Error("targetGuildId requis.");
    if (sourceGuildId === targetGuildId) throw new Error("Les serveurs source et cible doivent être différents.");
    setImmediate(() => {
      runClone(client, sourceGuildId, targetGuildId, { cloneRolesEnabled: cR, cloneChannelsEnabled: cCh, cloneEmojisEnabled: cE, cloneSettingsEnabled: cS }, jobId).catch(err => {
        pushCloneHistory({ sourceGuildId, targetGuildId, success: false, error: err.message, timestamp: Date.now() });
        notifyProgress(jobId, { step: "error", label: `Erreur : ${err.message}`, logs: err.message, done: true, error: err.message });
      });
    });
    return { started: true };
  }

  if (action === "clone.cancel") {
    const { jobId } = payload;
    if (!jobId) throw new Error("jobId requis.");
    return { cancelled: cancelJob(jobId) };
  }

  if (action === "clone.getHistory") { return { history: loadCloneHistory() }; }
  if (action === "clone.clearHistory") { saveCloneHistory([]); return { history: [] }; }

  // ── Backup amis — LECTURE SEULE depuis le fichier (rapide, pas de fetch réseau) ──
  if (action === "friends.get") {
    const data = loadBackupsData();
    // Retourne ce qui est en fichier, sans jamais faire de fetch réseau
    return {
      friends:   Array.isArray(data.friends) ? data.friends : null,
      count:     Array.isArray(data.friends) ? data.friends.length : null,
      savedAt:   data.friendsSavedAt ?? null,
    };
  }

  // ── Backup amis — ÉCRITURE (fetch réseau, puis sauvegarde) ────────────────
  if (action === "friends.backup") {
    const { friends, source } = await fetchFriends(client);
    const data = loadBackupsData();
    data.friends = friends;
    data.friendsSavedAt = Date.now();
    saveBackupsData(data);
    return { friends, count: friends.length, source, savedAt: data.friendsSavedAt };
  }

  if (action === "friends.clearBackup") {
    const data = loadBackupsData();
    data.friends = null;
    data.friendsSavedAt = null;
    saveBackupsData(data);
    return { cleared: true };
  }

  // ── Backup serveurs — LECTURE SEULE depuis le fichier (rapide, pas de fetch réseau) ──
  if (action === "guilds.get") {
    const data = loadBackupsData();
    // Retourne ce qui est en fichier, sans jamais faire de fetch réseau
    return {
      guilds:  Array.isArray(data.guilds) ? data.guilds : null,
      count:   Array.isArray(data.guilds) ? data.guilds.length : null,
      savedAt: data.guildsSavedAt ?? null,
    };
  }

  // ── Backup serveurs — ÉCRITURE (fetch réseau + invitations, puis sauvegarde) ──
  if (action === "guilds.backup") {
    const { guilds, source } = await fetchGuilds(client, true);
    const data = loadBackupsData();
    data.guilds = guilds;
    data.guildsSavedAt = Date.now();
    saveBackupsData(data);
    return { guilds, count: guilds.length, source, savedAt: data.guildsSavedAt };
  }

  if (action === "guilds.clearBackup") {
    const data = loadBackupsData();
    data.guilds = null;
    data.guildsSavedAt = null;
    saveBackupsData(data);
    return { cleared: true };
  }

  throw new Error(`Action backups inconnue : '${action}'`);
}

module.exports = { name: "backups", execute };