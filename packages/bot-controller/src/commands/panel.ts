import { SlashCommandBuilder } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";
import { healthCheck, sendAction } from "../bridge/client";
import * as home from "../panels/home";

const OWNER_ID = process.env.OWNER_ID;

export const data = new SlashCommandBuilder()
  .setName("panel")
  .setDescription("🎛️ Ouvre le panneau de contrôle du selfbot");

export async function execute(interaction: ChatInputCommandInteraction): Promise<unknown> {
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
}
