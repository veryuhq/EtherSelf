"use strict";

const { container, textDisplay, separator, selectMenu, navRow, replyV2 } = require("../utils/components");

function build(data = {}) {
  const { bookmarks = [] } = data;
  const list = bookmarks.length
    ? bookmarks.map((b, i) => {
        const content = (b.content ?? "").slice(0, 120) + ((b.content ?? "").length > 120 ? "…" : "");
        const note    = b.note ? `  •  📎 *${b.note}*` : "";
        const link    = b.url  ? `\n${b.url}` : "";
        return `**${i + 1}. ${b.authorTag ?? "?"}**${note}\n> ${content || "*(vide)*"}${link}`;
      }).join("\n\n")
    : "*Aucun message sauvegardé.*";

  return replyV2(
    container([
      textDisplay(`# 💬 Bookmarks messages\n**Messages sauvegardés (${bookmarks.length}) :**\n${list}`),
      separator(),
      selectMenu("menu:msgbm", "📋  Choisis une action…", [
        { label: "➕  Ajouter",      value: "msgbm:add",    description: "Ajouter un bookmark message" },
        { label: "➖  Supprimer",    value: "msgbm:remove", description: "Supprimer un bookmark" },
        { label: "📝  Ajouter note", value: "msgbm:note",   description: "Ajouter ou modifier une note" },
        { label: "🗑️  Tout effacer", value: "msgbm:clear",  description: "Effacer tous les bookmarks" },
      ]),
      separator(),
      navRow(null, null, true),
    ], 0x9B59B6)
  );
}

module.exports = { build };
