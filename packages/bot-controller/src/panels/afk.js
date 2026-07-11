"use strict";

const { ButtonStyle } = require("discord.js");
const { container, textDisplay, separator, actionRow, btn, selectMenu, navRow, replyV2 } = require("../utils/components");

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
      selectMenu("menu:afk", "📋  Choisis une action…", [
        { label: "📌  Changer la raison",  value: "afk:setReason",      description: "Modifier la raison AFK" },
        { label: "💬  Message normal",     value: "afk:setMsgNormal",   description: "Configurer le message AFK normal" },
        { label: "⭐  Message spécial",    value: "afk:setMsgSpecial",  description: "Configurer le message AFK spécial" },
        { label: "➕  Ajouter exclusion",  value: "afk:addExclusion",   description: "Exclure un utilisateur, serveur ou groupe" },
        { label: "➖  Retirer exclusion",  value: "afk:removeExclusion", description: "Retirer une exclusion existante" },
      ]),
      separator(),
      navRow(null, null, true),
    ], 0xFEE75C)
  );
}

module.exports = { build };
