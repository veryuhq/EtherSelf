"use strict";

const { SlashCommandBuilder } = require("discord.js");
const { container, textDisplay, ephemeralV2 } = require("../utils/components");

const OWNER_ID = process.env.OWNER_ID;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function buildProgress(stats, done) {
  const { deleted, scanned, skipped, failed, oldest } = stats;
  const title = done ? "## ✅ Purge des logs terminée" : "## 🧹 Purge des logs en cours…";
  const lines = [
    title,
    `> \`🗑️\` **Messages supprimés :** \`${deleted}\``,
    `> \`🔍\` **Messages parcourus :** \`${scanned}\``,
    skipped ? `> \`⏭️\` **Ignorés (autre auteur) :** \`${skipped}\`` : null,
    failed  ? `> \`⚠️\` **Échecs :** \`${failed}\`` : null,
    oldest  ? `> \`📅\` **Plus ancien parcouru :** <t:${Math.floor(oldest / 1000)}:f>` : null,
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
    const stats = { deleted: 0, scanned: 0, skipped: 0, failed: 0, oldest: null };
    let before  = undefined;
    let lastEdit = 0;

    // Édition de progression throttlée ; l'interaction expire au bout de 15 min,
    // la purge continue quand même en silence si l'editReply échoue.
    const reportProgress = async () => {
      const now = Date.now();
      if (now - lastEdit < 3000) return;
      lastEdit = now;
      await interaction.editReply(buildProgress(stats, false)).catch(() => {});
    };

    // Un fetch qui échoue (rate limit, coupure réseau) ne doit pas arrêter la
    // purge en plein historique : on réessaie avec backoff avant d'abandonner.
    const fetchBatch = async () => {
      for (let attempt = 1; attempt <= 5; attempt++) {
        try {
          return await dm.messages.fetch({ limit: 100, before, cache: false });
        } catch (err) {
          console.error(`[CONTROLLER] /purgelogs fetch échoué (${attempt}/5) :`, err.message);
          await sleep(2000 * attempt);
        }
      }
      return null;
    };

    for (;;) {
      const batch = await fetchBatch();
      if (!batch || batch.size === 0) break;

      // Curseur de pagination : le plus petit snowflake du lot, indépendant
      // de l'ordre de la Collection et des suppressions effectuées.
      let minId = null;

      for (const msg of batch.values()) {
        stats.scanned += 1;
        if (minId === null || BigInt(msg.id) < BigInt(minId)) minId = msg.id;
        if (stats.oldest === null || msg.createdTimestamp < stats.oldest) stats.oldest = msg.createdTimestamp;

        if (msg.author.id !== botId) {
          stats.skipped += 1;
          continue;
        }

        let removed = false;
        for (let attempt = 1; attempt <= 3 && !removed; attempt++) {
          try {
            await msg.delete();
            removed = true;
          } catch (err) {
            // 10008 = message déjà supprimé : rien à faire.
            if (err?.code === 10008) { removed = true; break; }
            console.error(`[CONTROLLER] /purgelogs delete échoué (${attempt}/3) :`, err.message);
            await sleep(1500 * attempt);
          }
        }
        if (removed) stats.deleted += 1;
        else stats.failed += 1;

        await reportProgress();
      }

      before = minId;
      await reportProgress();
    }

    await interaction.editReply(buildProgress(stats, true)).catch(() => {});
  },
};
