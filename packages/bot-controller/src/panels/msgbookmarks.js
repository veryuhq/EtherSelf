"use strict";

const { ButtonStyle } = require("discord.js");
const { container, textDisplay, separator, actionRow, btn, navRow, replyV2 } = require("../utils/components");

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
      actionRow([
        btn("➕  Ajouter",         "msgbm:add",    ButtonStyle.Success),
        btn("➖  Supprimer",       "msgbm:remove", ButtonStyle.Danger),
        btn("📝  Ajouter note",    "msgbm:note",   ButtonStyle.Secondary),
        btn("🗑️  Tout effacer",    "msgbm:clear",  ButtonStyle.Danger),
      ]),
      separator(),
      navRow(null, null, true),
    ], 0x9B59B6)
  );
}

module.exports = { build };
