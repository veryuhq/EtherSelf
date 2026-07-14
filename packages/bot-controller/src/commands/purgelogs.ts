import { SlashCommandBuilder } from "discord.js";
import type { ChatInputCommandInteraction, Message } from "discord.js";

const OWNER_ID = process.env.OWNER_ID;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const data = new SlashCommandBuilder()
  .setName("purgelogs")
  .setDescription("🧹 Supprime tous les messages du bot dans tes MPs");

export async function execute(interaction: ChatInputCommandInteraction): Promise<unknown> {
  if (OWNER_ID && interaction.user.id !== OWNER_ID) {
    return interaction.reply({
      content: "`❌` Tu n'as pas la permission d'utiliser cette commande.",
      ephemeral: true,
    });
  }

  const owner = await interaction.client.users.fetch(OWNER_ID ?? interaction.user.id).catch(() => null);
  const dm    = owner ? await owner.createDM().catch(() => null) : null;
  if (!dm) {
    return interaction.reply({ content: "`❌` Impossible d'ouvrir le salon MP.", ephemeral: true });
  }

  await interaction.reply({
    content: "`🧹` Les messages du bot vont maintenant être supprimés…",
    ephemeral: true,
  });

  const botId = interaction.client.user.id;
  let before: string | undefined = undefined;

  // Un fetch qui échoue (rate limit, coupure réseau) ne doit pas arrêter la
  // purge en plein historique : on réessaie avec backoff avant d'abandonner.
  const fetchBatch = async () => {
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        return await dm.messages.fetch({ limit: 100, before, cache: false });
      } catch (err) {
        console.error(`[CONTROLLER] /purgelogs fetch échoué (${attempt}/5) :`, (err as Error).message);
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
    let minId: string | null = null;

    for (const msg of batch.values() as IterableIterator<Message>) {
      if (minId === null || BigInt(msg.id) < BigInt(minId)) minId = msg.id;
      if (msg.author.id !== botId) continue;

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await msg.delete();
          break;
        } catch (err) {
          // 10008 = message déjà supprimé : rien à faire.
          if ((err as { code?: number })?.code === 10008) break;
          console.error(`[CONTROLLER] /purgelogs delete échoué (${attempt}/3) :`, (err as Error).message);
          await sleep(1500 * attempt);
        }
      }
    }

    before = minId ?? undefined;
  }
}
