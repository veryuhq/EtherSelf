"use strict";

const { SlashCommandBuilder } = require("discord.js");
const { healthCheck, sendAction } = require("../bridge/client");
const home                        = require("../panels/home");

const OWNER_ID = process.env.OWNER_ID;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("panel")
    .setDescription("🎛️ Ouvre le panneau de contrôle du selfbot"),

  /**
   * @param {import("discord.js").ChatInputCommandInteraction} interaction
   */
  async execute(interaction) {
    // Guard : seul le propriétaire peut ouvrir le panel
    if (OWNER_ID && interaction.user.id !== OWNER_ID) {
      return interaction.reply({
        content: "❌ Tu n'as pas la permission d'utiliser ce panneau.",
        ephemeral: true,
      });
    }

    // Vérifie que le selfbot est en ligne avant d'ouvrir le panel
    const { online } = await healthCheck();
    if (!online) {
      return interaction.reply({
        content: "⚠️ Le selfbot est **hors ligne** ou injoignable. Vérifie que le selfbot est bien démarré.",
        ephemeral: true,
      });
    }

    const prefixRes = await sendAction("prefix.get").catch(() => null);
    const prefix    = prefixRes?.data?.prefix ?? ".";

    return interaction.reply({
      ...home.build({ prefix }),
      ephemeral: true,
    });
  },
};