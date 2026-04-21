"use strict";

const { ButtonStyle } = require("discord.js");
const { container, textDisplay, separator, actionRow, btn, navRow, replyV2 } = require("../utils/components");

function build(data = {}) {
  const { enabled = false, link = null, channelId = null, customMessage = null } = data;
  const validLink    = typeof link === "string" && link.startsWith("https://guns.lol/");
  const validChannel = typeof channelId === "string" && channelId.length > 0;
  const canEnable    = validLink && validChannel;

  return replyV2(
    container([
      textDisplay(
        `# 🔫 Guns.lol\n` +
        `${enabled ? "`🟢`" : "`🔴`"} **Statut :** ${enabled ? "Activé" : "Désactivé"}\n` +
        "`🔗` **Lien :** " + (link ?? "*non défini*") + "\n" +
        "`📢` **Salon d'envoi :** " + (channelId ? `<#${channelId}>` : "*non défini*") + "\n" +
        "`💬` **Message custom :** " + (customMessage
          ? customMessage.slice(0, 60) + (customMessage.length > 60 ? "…" : "")
          : "*aucun — lien seul envoyé*") + "\n\n" +
        `*Envoi automatique toutes les 30 min.*`
      ),
      separator(),
      actionRow([
        btn(
          enabled ? "🔴  Désactiver" : "🟢  Activer",
          "gunslol:toggle",
          enabled ? ButtonStyle.Danger : ButtonStyle.Success,
          null,
          !canEnable && !enabled
        ),
        btn("🔗  Définir le lien",    "gunslol:setLink",    ButtonStyle.Primary),
        btn("📢  Définir le salon",   "gunslol:setChannel", ButtonStyle.Primary),
      ]),
      actionRow([
        btn("💬  Message custom",   "gunslol:setMsg",   ButtonStyle.Secondary),
        btn("🔄  Reset message",    "gunslol:resetMsg", ButtonStyle.Secondary),
      ]),
      separator(),
      navRow(null, null, true),
    ], 0xE74C3C)
  );
}

module.exports = { build };
