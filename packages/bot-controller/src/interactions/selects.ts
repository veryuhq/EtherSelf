import type { MessageComponentInteraction, StringSelectMenuInteraction } from "discord.js";

import { fetchAndBuild } from "./fetch-and-build";
import { handle as handleButton } from "./buttons";

export async function handle(interaction: StringSelectMenuInteraction): Promise<unknown> {
  // ── menu:* — boutons regroupés en menu déroulant ──────────────────────────
  // Quand un panel dépasse 3 boutons d'action, ceux-ci sont regroupés dans un
  // select (les boutons de navigation, de pagination et les bascules à état
  // restent des boutons). La valeur choisie correspond au custom_id du bouton
  // d'origine : on la redispatche vers le handler de boutons pour réutiliser
  // toute sa logique existante (modals, updates, etc.).
  if (interaction.customId.startsWith("menu:")) {
    const selected = interaction.values?.[0];
    if (!selected) return;
    const proxy = new Proxy(interaction, {
      get(target, prop) {
        if (prop === "customId") return selected;
        const value = Reflect.get(target, prop) as unknown;
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    }) as MessageComponentInteraction;
    return handleButton(proxy);
  }

  // ── panel:nav ─────────────────────────────────────────────────────────────
  if (interaction.customId !== "panel:nav") return;

  const val = interaction.values[0];
  if (!val) return;

  // Defer immédiatement pour éviter le timeout Discord (3s)
  await interaction.deferUpdate();

  const panel = await fetchAndBuild(val);

  if (!panel) {
    return interaction.followUp({ content: `❌ Module \`${val}\` inconnu.`, ephemeral: true });
  }

  return interaction.editReply(panel);
}
