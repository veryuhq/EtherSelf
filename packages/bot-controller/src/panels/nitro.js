"use strict";

const { ButtonStyle } = require("discord.js");
const { container, textDisplay, separator, actionRow, btn, navRow, replyV2 } = require("../utils/components");

function build(data = {}) {
  const { enabled = false, notifyOnClaim = true, notifyOnFail = false, excludedGuilds = [] } = data;

  return replyV2(
    container([
      textDisplay(
        `# 🎁 Nitro Sniper\n` +
        `${enabled ? "`🟢`" : "`🔴`"} **Statut :** ${enabled ? "Activé" : "Désactivé"}\n` +
        `${notifyOnClaim ? "`🔔`" : "`🔕`"} **Notifications claim réussi :** ${notifyOnClaim ? "Oui" : "Non"}\n` +
        `${notifyOnFail ? "`🔔`" : "`🔕`"} **Notifications échec :** ${notifyOnFail ? "Oui" : "Non"}\n` +
        `\`🚫\` **Serveurs exclus :** ${excludedGuilds.length}\n\n` +
        `*Détecte et claim automatiquement les codes Nitro.*`
      ),
      separator(),
      actionRow([
        btn(
          enabled ? "🔴  Désactiver" : "🟢  Activer",
          "nitro:toggle",
          enabled ? ButtonStyle.Danger : ButtonStyle.Success
        ),
        btn("📜  Historique", "nitro:history", ButtonStyle.Primary),
        btn("🚫  Exclusions", "nitro:exclusions", ButtonStyle.Secondary),
      ]),
      separator(),
      actionRow([
        btn(
          notifyOnClaim ? "🔕  Désactiver notif succès" : "🔔  Activer notif succès",
          "nitro:toggleNotifyClaim",
          ButtonStyle.Secondary
        ),
        btn(
          notifyOnFail ? "🔕  Désactiver notif échec" : "🔔  Activer notif échec",
          "nitro:toggleNotifyFail",
          ButtonStyle.Secondary
        ),
      ]),
      separator(),
      navRow(null, null, true),
    ], 0xF47FFF)
  );
}

function buildHistory(data = {}) {
  const { history = [] } = data;

  const list = history.length
    ? history.slice(-10).reverse().map((entry, i) => {
        const emoji = entry.success ? "✅" : "❌";
        const location = entry.guildName
          ? `${entry.guildName} (#${entry.channelName || entry.channelId})`
          : "MP";
        const time = new Date(entry.timestamp).toLocaleString("fr-FR");
        const error = entry.success ? "" : ` — *${entry.error}*`;
        return `${emoji} **${entry.code}** — ${location}\n> ${time}${error}`;
      }).join("\n\n")
    : "*Aucun historique de claim.*";

  return replyV2(
    container([
      textDisplay(
        `# 📜 Historique Nitro\n` +
        `**Dernières tentatives (${history.length} total) :**\n\n${list}`
      ),
      separator(),
      actionRow([
        btn("🗑️  Effacer l'historique", "nitro:clearHistory", ButtonStyle.Danger),
      ]),
      separator(),
      navRow("panel:nitro", "Nitro"),
    ], 0xF47FFF)
  );
}

function buildExclusions(data = {}) {
  const { excludedGuilds = [], guilds = [] } = data;

  const list = excludedGuilds.length
    ? excludedGuilds.map((id, i) => {
        const guild = guilds.find(g => g.id === id);
        const name  = guild?.name ?? null;
        return `\`${i + 1}.\` ${name ? `**${name}** (\`${id}\`)` : `\`${id}\``}`;
      }).join("\n")
    : "*Aucun serveur exclu.*";

  return replyV2(
    container([
      textDisplay(`# 🚫 Serveurs exclus\n**Serveurs exclus du Nitro Sniper (${excludedGuilds.length}) :**\n\n${list}`),
      separator(),
      actionRow([
        btn("➕  Exclure serveur", "nitro:addExclusion", ButtonStyle.Success),
        btn("➖  Retirer exclusion", "nitro:removeExclusion", ButtonStyle.Danger),
      ]),
      separator(),
      navRow("panel:nitro", "Nitro"),
    ], 0xF47FFF)
  );
}

module.exports = { build, buildHistory, buildExclusions };