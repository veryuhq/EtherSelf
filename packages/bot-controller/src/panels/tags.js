"use strict";

const { ButtonStyle } = require("discord.js");
const { container, textDisplay, separator, actionRow, btn, navRow, replyV2 } = require("../utils/components");

function build(data = {}) {
  const { tags = {}, prefix = "." } = data;
  const keys = Object.keys(tags);
  const list = keys.length
    ? keys.map((k, i) => `\`${i + 1}.\` **${k}** — *Clique sur "Voir un tag" pour voir son contenu*`).join("\n")
    : "*Aucun tag défini.*";

  return replyV2(
    container([
      textDisplay(
        `# 🏷️ Tags\n` +
        `**Tags disponibles (${keys.length}) :**\n${list}\n\n` +
        `-# 💡 Pour envoyer un tag dans un salon, tape \`${prefix}tag <nom>\` dans n'importe quel salon.`
      ),
      separator(),
      actionRow([
        btn("➕  Créer",    "tags:add",    ButtonStyle.Success),
        btn("✏️  Modifier", "tags:edit",   ButtonStyle.Primary),
        btn("➖  Supprimer","tags:remove", ButtonStyle.Danger),
      ]),
      actionRow([
        btn("👁️  Voir un tag", "tags:view", ButtonStyle.Secondary),
      ]),
      separator(),
      navRow(null, null, true),
    ], 0xEB459E)
  );
}

module.exports = { build };