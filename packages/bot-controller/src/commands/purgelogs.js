"use strict";

const { SlashCommandBuilder } = require("discord.js");
const { container, textDisplay, ephemeralV2 } = require("../utils/components");

const OWNER_ID = process.env.OWNER_ID;

function buildProgress(deleted, scanned, done, failed = 0) {
  const title = done ? "## ✅ Purge des logs terminée" : "## 🧹 Purge des logs en cours…";
  const lines = [
    title,
    `> \`🗑️\` **Messages supprimés :** \`${deleted}\``,
    `> \`🔍\` **Messages parcourus :** \`${scanned}\``,
    failed ? `> \`⚠️\` **Échecs :** \`${failed}\`` : null,
    done ? null : `\n*Ça peut prendre un moment, Discord limite le débit…*`,
  ].filter(l => l !== null).join("\n");
  return ephemeralV2(container([textDisplay(lines)], done ? 0x2ECC71 : 0x5865F2));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("purgelogs")
    .setDescription("🧹 Supprime tous les messages du bot dans tes MPs"),

  /**
   * @param {import("discord.js").ChatInputCommandInteraction} interaction
   */
  async execute(interaction) {
    if (OWNER_ID && interaction.user.id !== OWNER_ID) {
      return interaction.reply({
        content: "❌ Tu n'as pas la permission d'utiliser cette commande.",
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const owner = await interaction.client.users.fetch(OWNER_ID ?? interaction.user.id).catch(() => null);
    const dm    = owner ? await owner.createDM().catch(() => null) : null;
    if (!dm) {
      return interaction.editReply({ content: "❌ Impossible d'ouvrir le salon MP." });
    }

    const botId = interaction.client.user.id;
    let deleted = 0;
    let scanned = 0;
    let failed  = 0;
    let before  = undefined;
    let lastEdit = 0;

    // Édition de progression throttlée ; l'interaction expire au bout de 15 min,
    // la purge continue quand même en silence si l'editReply échoue.
    const reportProgress = async (force = false) => {
      const now = Date.now();
      if (!force && now - lastEdit < 3000) return;
      lastEdit = now;
      await interaction.editReply(buildProgress(deleted, scanned, false, failed)).catch(() => {});
    };

    for (;;) {
      const batch = await dm.messages.fetch({ limit: 100, before }).catch(() => null);
      if (!batch || batch.size === 0) break;

      for (const msg of batch.values()) {
        scanned += 1;
        if (msg.author.id === botId) {
          try {
            await msg.delete();
            deleted += 1;
          } catch {
            failed += 1;
          }
        }
      }

      before = batch.last().id;
      await reportProgress();
    }

    await interaction.editReply(buildProgress(deleted, scanned, true, failed)).catch(() => {});
  },
};
