"use strict";

const { messageEdit } = require("../../func/message_edit");

/**
 * @param {import("discord.js-selfbot-v13").Client} client
 * @param {{ channelId: string, text: string }} payload
 */
async function execute(client, payload) {
  const { channelId, text } = payload;
  if (!channelId || !text) throw new Error("channelId et text requis.");
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) throw new Error(`Salon ${channelId} introuvable.`);
  const spoilered = `||${text}||`;
  await channel.send(spoilered);
  return { sent: spoilered };
}

// ── Handler commande préfixe ──────────────────────────────────────────────────

async function callback(client, message, args) {
  if (!args.length) return messageEdit(message, "`❌` **Usage :** `.spoiler <texte>`");
  const spoilered = `||${args.join(" ")}||`;
  return message.edit(spoilered).catch(() => message.channel.send(spoilered));
}

module.exports = { name: "spoiler", execute, callback };
