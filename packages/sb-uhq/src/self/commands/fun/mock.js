"use strict";

const { messageEdit } = require("../../func/message_edit");

// ── Logique pure ─────────────────────────────────────────────────────────────

function mockText(text) {
  return text.split("").map((c, i) => i % 2 === 0 ? c.toLowerCase() : c.toUpperCase()).join("");
}

/**
 * @param {import("discord.js-selfbot-v13").Client} client
 * @param {{ channelId: string, text: string }} payload
 */
async function execute(client, payload) {
  const { channelId, text } = payload;
  if (!channelId || !text) throw new Error("channelId et text requis.");

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) throw new Error(`Salon ${channelId} introuvable.`);

  const mocked = mockText(text);
  await channel.send(mocked);
  return { sent: mocked };
}

// ── Handler commande préfixe ──────────────────────────────────────────────────

async function callback(client, message, args) {
  if (!args.length) return messageEdit(message, "`❌` **Usage :** `.mock <texte>`");
  const mocked = mockText(args.join(" "));
  return message.edit(mocked).catch(() => message.channel.send(mocked));
}

module.exports = { name: "mock", execute, callback };
