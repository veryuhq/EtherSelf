"use strict";

const fs   = require("fs");
const path = require("path");
const { dataPath } = require("../../func/data-path");
const { messageEdit } = require("../../func/message_edit");

const TAGS_FILE = dataPath("config", "tags.json");

// ── I/O ──────────────────────────────────────────────────────────────────────

function load() {
  try { return JSON.parse(fs.readFileSync(TAGS_FILE, "utf8")); }
  catch { return {}; }
}

function save(tags) {
  fs.mkdirSync(path.dirname(TAGS_FILE), { recursive: true });
  fs.writeFileSync(TAGS_FILE, JSON.stringify(tags, null, 2));
}

// ── Logique pure ─────────────────────────────────────────────────────────────

/**
 * @param {import("discord.js-selfbot-v13").Client} client
 * @param {{ action: "add"|"remove"|"edit"|"list"|"send", name?: string, content?: string, channelId?: string }} payload
 */
async function execute(client, payload) {
  const { action, name, content, channelId } = payload;
  const tags = load();

  if (action === "list") return { tags };

  if (action === "add") {
    if (!name || !content) throw new Error("name et content requis.");
    if (tags[name]) throw new Error(`Le tag '${name}' existe déjà.`);
    tags[name] = content;
    save(tags);
    return { tags };
  }

  if (action === "edit") {
    if (!name || !content) throw new Error("name et content requis.");
    if (!tags[name]) throw new Error(`Tag '${name}' introuvable.`);
    tags[name] = content;
    save(tags);
    return { tags };
  }

  if (action === "remove") {
    if (!name) throw new Error("name requis.");
    if (!tags[name]) throw new Error(`Tag '${name}' introuvable.`);
    delete tags[name];
    save(tags);
    return { tags };
  }

  if (action === "send") {
    if (!name) throw new Error("name requis.");
    if (!tags[name]) throw new Error(`Tag '${name}' introuvable.`);
    if (!channelId) throw new Error("channelId requis pour envoyer un tag.");
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) throw new Error(`Salon ${channelId} introuvable.`);
    await channel.send(tags[name]);
    return { sent: true, name, channelId };
  }

  throw new Error(`Action tag inconnue : '${action}'`);
}

// ── Handler commande préfixe ──────────────────────────────────────────────────

async function callback(client, message, args) {
  if (!args.length) return messageEdit(message, "`❌` **Usage :** `.tag <nom>`");

  const [name] = args;
  const tags   = load();

  if (!tags[name]) return messageEdit(message, `\`❌\` **Tag \`${name}\` introuvable.**`);

  return message.edit(tags[name]).catch(() => message.channel.send(tags[name]));
}

module.exports = { name: "tag", execute, callback };