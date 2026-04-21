"use strict";

const { ButtonStyle } = require("discord.js");
const { container, textDisplay, separator, actionRow, btn, navRow, replyV2 } = require("../utils/components");

function build(data = {}) {
  const { enabled = false, special = false, reason = "", excluded = [], notified = [] } = data;
  return replyV2(
    container([
      textDisplay(
        `# 😴 Mode AFK\n` +
        `${enabled ? "`🟢`" : "`🔴`"} **Statut :** ${enabled ? "Activé" : "Désactivé"}\n` +
        `${special ? "`🟡`" : "`⚫`"} **Mode spécial :** ${special ? "Activé" : "Désactivé"}\n` +
        "`📌` **Raison :** " + (reason || "*aucune*") + "\n" +
        "`🚫` **Exclusions :** " + excluded.length + " — `👥` **Notifiés :** " + notified.length
      ),
      separator(),
      actionRow([
        btn(enabled ? "🔴  Désactiver AFK"    : "🟢  Activer AFK",    "afk:toggle",        enabled ? ButtonStyle.Danger   : ButtonStyle.Success),
        btn(special ? "⚫  Désactiver Spécial" : "🟡  Activer Spécial","afk:toggleSpecial", special ? ButtonStyle.Secondary: ButtonStyle.Primary),
      ]),
      separator(),
      actionRow([
        btn("📌  Changer la raison",      "afk:setReason",    ButtonStyle.Secondary),
        btn("💬  Message normal",          "afk:setMsgNormal", ButtonStyle.Secondary),
        btn("⭐  Message spécial",         "afk:setMsgSpecial",ButtonStyle.Secondary),
      ]),
      separator(),
      actionRow([
        btn("➕  Ajouter exclusion",       "afk:addExclusion",    ButtonStyle.Secondary),
        btn("➖  Retirer exclusion",       "afk:removeExclusion", ButtonStyle.Secondary),
      ]),
      separator(),
      navRow(null, null, true),
    ], 0xFEE75C)
  );
}

module.exports = { build };
