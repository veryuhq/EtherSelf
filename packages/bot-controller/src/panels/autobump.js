"use strict";

const { ButtonStyle } = require("discord.js");
const { container, textDisplay, separator, actionRow, btn, navRow, replyV2 } = require("../utils/components");

function build(data = {}) {
  const { config = {}, running = false } = data;

  const entries = Object.entries(config);
  const list = entries.length
    ? entries.flatMap(([gId, guildConfig]) => {
        const channels = Array.isArray(guildConfig) ? guildConfig : (guildConfig.channels ?? []);
        const appId = Array.isArray(guildConfig) ? "302050872383242240" : (guildConfig.appId ?? "302050872383242240");
        const commandName = Array.isArray(guildConfig) ? "bump" : (guildConfig.commandName ?? "bump");
        const header = `• Serveur \`${gId}\` → app \`${appId}\`, commande \`/${commandName}\``;
        const channelLines = channels.length
          ? channels.map(cId => `  ↳ <#${cId}>`)
          : ["  ↳ *Aucun salon configuré.*"];
        return [header, ...channelLines];
      }).join("\n")
    : "*Aucun serveur configuré.*";

  return replyV2(
    container([
      textDisplay(
        `# ⬆️ Auto-Bump\n` +
        `${running ? "`🟢`" : "`🔴`"} **État :** ${running ? "En cours" : "Arrêté"}\n\n` +
        `**Salons configurés :**\n${list}`
      ),
      separator(),
      actionRow([
        btn("➕  Ajouter salon",    "autobump:add",    ButtonStyle.Success),
        btn("➖  Retirer salon",    "autobump:remove", ButtonStyle.Danger),
      ]),
      actionRow([
        btn(running ? "🔴  Arrêter" : "🟢  Démarrer",
          running ? "autobump:stop" : "autobump:start",
          running ? ButtonStyle.Danger : ButtonStyle.Success
        ),
      ]),
      separator(),
      navRow(null, null, true),
    ], 0x3498DB)
  );
}

module.exports = { build };
