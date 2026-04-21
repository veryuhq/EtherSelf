"use strict";

/**
 * Édite un message du selfbot. Si l'édition échoue (ex: DM), envoie un nouveau message.
 * @param {import("discord.js-selfbot-v13").Message} message
 * @param {string} content
 */
async function messageEdit(message, content) {
  try {
    return await message.edit(content);
  } catch {
    return await message.channel.send(content).catch(() => null);
  }
}

module.exports = { messageEdit };