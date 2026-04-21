"use strict";

const fs   = require("fs");
const path = require("path");
const { dataPath } = require("../../func/data-path");

const WHITELIST_FILE = dataPath("msg_log_data", "snipe_whitelist.json");
const DATA_PATH      = dataPath("msg_log_data");

// ── I/O whitelist ─────────────────────────────────────────────────────────────

function getWhitelist() {
  try { return JSON.parse(fs.readFileSync(WHITELIST_FILE, "utf-8")); }
  catch { return []; }
}

function saveWhitelist(list) {
  fs.mkdirSync(path.dirname(WHITELIST_FILE), { recursive: true });
  fs.writeFileSync(WHITELIST_FILE, JSON.stringify(list, null, 2));
}

// ── Helpers lecture ───────────────────────────────────────────────────────────

function readFile(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf-8")); }
  catch { return []; }
}

// ── Helpers résolution noms ───────────────────────────────────────────────────

async function resolveChannelName(client, channelId) {
  if (!channelId) return null;
  try {
    let channel = client?.channels?.cache?.get(channelId);
    if (!channel) channel = await client?.channels?.fetch(channelId).catch(() => null);
    return channel?.name ?? channel?.recipient?.tag ?? channel?.recipient?.username ?? null;
  } catch {
    return null;
  }
}

async function resolveGuildName(client, guildId) {
  if (!guildId) return null;
  try {
    let guild = client?.guilds?.cache?.get(guildId);
    if (!guild) guild = await client?.guilds?.fetch(guildId).catch(() => null);
    return guild?.name ?? null;
  } catch {
    return null;
  }
}

async function resolveUserTag(client, userId) {
  if (!userId) return null;
  try {
    let user = client?.users?.cache?.get(userId);
    if (!user) user = await client?.users?.fetch(userId).catch(() => null);
    if (!user) return null;
    if (user.discriminator && user.discriminator !== "0") {
      return `${user.username}#${user.discriminator}`;
    }
    return user.username ?? user.tag ?? null;
  } catch {
    return null;
  }
}

// ── Enrichissement des messages avec les noms de salons ──────────────────────
// Pour les recherches par guild ou user, les messages n'ont que channelId
// On résout les noms manquants en batch (un fetch par channelId unique)

async function enrichMessagesWithChannelNames(client, messages) {
  const uniqueChannelIds = [...new Set(
    messages.map(m => m.channelId).filter(Boolean)
  )];

  const channelNameMap = {};
  await Promise.all(
    uniqueChannelIds.map(async (cId) => {
      channelNameMap[cId] = await resolveChannelName(client, cId);
    })
  );

  return messages.map(m => ({
    ...m,
    channelName: m.channelName ?? channelNameMap[m.channelId] ?? null,
    // S'assurer que authorTag n'est jamais null/undefined
    authorTag: m.authorTag || "Inconnu",
    content:   m.content   ?? "",
    oldContent: m.oldContent ?? "",
    newContent: m.newContent ?? "",
  }));
}

// ── Lecture par channelId ─────────────────────────────────────────────────────

function readMessagesByChannel(channelId, type) {
  const results = [];

  for (const guildId of getWhitelist()) {
    const msgs = readFile(path.join(DATA_PATH, "SERVEURS", guildId, `${type}_messages.json`));
    results.push(...msgs.filter(m => m.channelId === channelId));
  }

  results.push(...readFile(path.join(DATA_PATH, "DMs",       channelId, `${type}_messages.json`)));
  results.push(...readFile(path.join(DATA_PATH, "GROUP_DMs", channelId, `${type}_messages.json`)));

  return results.sort((a, b) =>
    (b.deletedAt ?? b.editedAt ?? 0) - (a.deletedAt ?? a.editedAt ?? 0)
  );
}

// ── Lecture par guildId ───────────────────────────────────────────────────────

function readMessagesByGuild(guildId, type) {
  const msgs = readFile(path.join(DATA_PATH, "SERVEURS", guildId, `${type}_messages.json`));
  return msgs.sort((a, b) =>
    (b.deletedAt ?? b.editedAt ?? 0) - (a.deletedAt ?? a.editedAt ?? 0)
  );
}

// ── Lecture par userId ────────────────────────────────────────────────────────

function readMessagesByUser(userId, type) {
  const results = [];

  for (const guildId of getWhitelist()) {
    const msgs = readFile(path.join(DATA_PATH, "SERVEURS", guildId, `${type}_messages.json`));
    results.push(...msgs.filter(m => m.authorId === userId));
  }

  const dmDir = path.join(DATA_PATH, "DMs");
  if (fs.existsSync(dmDir)) {
    for (const channelId of fs.readdirSync(dmDir)) {
      const msgs = readFile(path.join(dmDir, channelId, `${type}_messages.json`));
      results.push(...msgs.filter(m => m.authorId === userId));
    }
  }

  const groupDir = path.join(DATA_PATH, "GROUP_DMs");
  if (fs.existsSync(groupDir)) {
    for (const channelId of fs.readdirSync(groupDir)) {
      const msgs = readFile(path.join(groupDir, channelId, `${type}_messages.json`));
      results.push(...msgs.filter(m => m.authorId === userId));
    }
  }

  return results.sort((a, b) =>
    (b.deletedAt ?? b.editedAt ?? 0) - (a.deletedAt ?? a.editedAt ?? 0)
  );
}

// ── Logique pure ─────────────────────────────────────────────────────────────

/**
 * @param {import("discord.js-selfbot-v13").Client} client
 * @param {{ action: string, guildId?: string, channelId?: string, userId?: string, type?: string }} payload
 */
async function execute(client, payload) {
  const { action, guildId, channelId, userId, type = "deleted" } = payload;

  if (action === "getWhitelist") {
    const whitelist = getWhitelist();
    const guilds = await Promise.all(
      whitelist.map(async (id) => ({
        id,
        name: await resolveGuildName(client, id),
      }))
    );
    return { whitelist, guilds };
  }

  if (action === "addGuild") {
    if (!guildId) throw new Error("guildId requis.");
    const list = getWhitelist();
    if (!list.includes(guildId)) { list.push(guildId); saveWhitelist(list); }
    return { whitelist: list };
  }

  if (action === "removeGuild") {
    if (!guildId) throw new Error("guildId requis.");
    const list = getWhitelist().filter(id => id !== guildId);
    saveWhitelist(list);
    return { whitelist: list };
  }

  // ── Recherche par salon ───────────────────────────────────────────────────
  if (action === "getMessages") {
    if (!channelId) throw new Error("channelId requis.");
    const rawMessages = readMessagesByChannel(channelId, type);
    const channelName = await resolveChannelName(client, channelId);
    const messages    = rawMessages.map(m => ({
      ...m,
      authorTag:  m.authorTag  || "Inconnu",
      content:    m.content    ?? "",
      oldContent: m.oldContent ?? "",
      newContent: m.newContent ?? "",
      channelName: channelName ?? null,
    }));
    return { messages, channelId, channelName, type, searchMode: "channel" };
  }

  // ── Recherche par serveur ─────────────────────────────────────────────────
  if (action === "getMessagesByGuild") {
    if (!guildId) throw new Error("guildId requis.");
    if (!getWhitelist().includes(guildId))
      throw new Error("Ce serveur n'est pas dans la whitelist.");
    const rawMessages = readMessagesByGuild(guildId, type);
    const guildName   = await resolveGuildName(client, guildId);
    const messages    = await enrichMessagesWithChannelNames(client, rawMessages);
    return { messages, guildId, guildName, type, searchMode: "guild" };
  }

  // ── Recherche par utilisateur ─────────────────────────────────────────────
  if (action === "getMessagesByUser") {
    if (!userId) throw new Error("userId requis.");
    const rawMessages = readMessagesByUser(userId, type);
    const userTag     = await resolveUserTag(client, userId);
    const messages    = await enrichMessagesWithChannelNames(client, rawMessages);
    return { messages, userId, userTag, type, searchMode: "user" };
  }

  throw new Error(`Action snipe inconnue : '${action}'`);
}

module.exports = { name: "snipe", execute };