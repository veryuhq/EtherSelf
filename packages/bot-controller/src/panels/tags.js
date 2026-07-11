"use strict";

const { container, textDisplay, separator, selectMenu, navRow, replyV2 } = require("../utils/components");

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
      selectMenu("menu:tags", "📋  Choisis une action…", [
        { label: "➕  Créer",       value: "tags:add",    description: "Créer un nouveau tag" },
        { label: "✏️  Modifier",    value: "tags:edit",   description: "Modifier un tag existant" },
        { label: "➖  Supprimer",   value: "tags:remove", description: "Supprimer un tag" },
        { label: "👁️  Voir un tag", value: "tags:view",   description: "Afficher le contenu d'un tag" },
      ]),
      separator(),
      navRow(null, null, true),
    ], 0xEB459E)
  );
}

module.exports = { build };