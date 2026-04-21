"use strict";

const fs   = require("fs");
const path = require("path");
const { dataPath } = require("../../func/data-path");

const DATA_PATH      = dataPath("msg_log_data");
const WHITELIST_FILE = path.join(DATA_PATH, "snipe_whitelist.json");

fs.mkdirSync(DATA_PATH, { recursive: true });

// ── Whitelist helpers ─────────────────────────────────────────────────────────

function getWhitelist() {
  try { return JSON.parse(fs.readFileSync(WHITELIST_FILE, "utf-8")); }
  catch { return []; }
}

function saveWhitelist(list) {
  fs.writeFileSync(WHITELIST_FILE, JSON.stringify(list, null, 2));
}

// ── I/O messages ─────────────────────────────────────────────────────────────

function getScopePath(scopeId, scopeType) {
  const base = { DM: "DMs", GROUP_DM: "GROUP_DMs", guild: "SERVEURS" };
  return path.join(DATA_PATH, base[scopeType] ?? "SERVEURS", scopeId);
}

function readMessages(scopeId, type, scopeType = "guild") {
  const file = path.join(getScopePath(scopeId, scopeType), `${type}_messages.json`);
  try { return JSON.parse(fs.readFileSync(file, "utf-8")); } catch { return []; }
}

function writeMessages(scopeId, type, messages, scopeType = "guild") {
  const folder = getScopePath(scopeId, scopeType);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, `${type}_messages.json`), JSON.stringify(messages, null, 2));
}

function pushEntry(scopeId, type, entry, scopeType = "guild") {
  const messages = readMessages(scopeId, type, scopeType);
  messages.push(entry);
  if (messages.length > 100) messages.shift();
  writeMessages(scopeId, type, messages, scopeType);
}

// ── Event handlers Discord (inchangés) ───────────────────────────────────────

function handleMessageDelete(message, client) {
  if (message.author?.id === client.user?.id) return;

  if (message.guild) {
    if (!getWhitelist().includes(message.guild.id)) return;
    pushEntry(message.guild.id, "deleted", {
      scope: "guild",
      guildId: message.guild.id,
      channelId: message.channel.id,
      authorId: message.author?.id ?? null,
      authorTag: message.author?.tag ?? "unknown",
      content: message.content || "",
      attachments: [...(message.attachments?.values() ?? [])].map(a => a.url),
      createdTimestamp: message.createdTimestamp,
      deletedAt: Date.now(),
    });
    return;
  }

  const scopeType = message.channel?.type;
  if (scopeType !== "DM" && scopeType !== "GROUP_DM") return;
  pushEntry(message.channel.id, "deleted", {
    scope: scopeType.toLowerCase(),
    channelId: message.channel.id,
    recipients: [...(message.channel.recipients?.values() ?? [])].map(u => `${u.tag} (${u.id})`),
    authorId: message.author?.id ?? null,
    authorTag: message.author?.tag ?? "unknown",
    content: message.content || "",
    attachments: [...(message.attachments?.values() ?? [])].map(a => a.url),
    createdTimestamp: message.createdTimestamp,
    deletedAt: Date.now(),
  }, scopeType);
}

function handleMessageEdit(oldMessage, newMessage, client) {
  if (oldMessage.author?.id === client.user?.id) return;
  if (oldMessage.content === newMessage.content) return;

  if (oldMessage.guild) {
    if (!getWhitelist().includes(oldMessage.guild.id)) return;
    pushEntry(oldMessage.guild.id, "edited", {
      scope: "guild",
      guildId: oldMessage.guild.id,
      channelId: oldMessage.channel.id,
      authorId: oldMessage.author?.id ?? null,
      authorTag: oldMessage.author?.tag ?? "unknown",
      oldContent: oldMessage.content || "",
      newContent: newMessage.content || "",
      createdTimestamp: oldMessage.createdTimestamp,
      editedAt: Date.now(),
    });
    return;
  }

  const scopeType = oldMessage.channel?.type;
  if (scopeType !== "DM" && scopeType !== "GROUP_DM") return;
  pushEntry(oldMessage.channel.id, "edited", {
    scope: scopeType.toLowerCase(),
    channelId: oldMessage.channel.id,
    authorId: oldMessage.author?.id ?? null,
    authorTag: oldMessage.author?.tag ?? "unknown",
    oldContent: oldMessage.content || "",
    newContent: newMessage.content || "",
    createdTimestamp: oldMessage.createdTimestamp,
    editedAt: Date.now(),
  }, scopeType);
}

// ── Logique pure ──────────────────────────────────────────────────────────────

/**
 * @param {import("discord.js-selfbot-v13").Client} _client
 * @param {{ action: "add"|"remove"|"list", guildId?: string }} payload
 */
async function execute(_client, payload) {
  const { action, guildId } = payload;

  if (action === "list") {
    return { whitelist: getWhitelist() };
  }

  if (action === "add") {
    if (!guildId) throw new Error("guildId requis.");
    const list = getWhitelist();
    if (!list.includes(guildId)) {
      list.push(guildId);
      saveWhitelist(list);
    }
    return { whitelist: list };
  }

  if (action === "remove") {
    if (!guildId) throw new Error("guildId requis.");
    const list = getWhitelist().filter(id => id !== guildId);
    saveWhitelist(list);
    return { whitelist: list };
  }

  throw new Error(`Action msglog inconnue : '${action}'`);
}

module.exports = {
  name: "msglog",
  execute,
  handleMessageDelete,
  handleMessageEdit,
  readMessages,
};