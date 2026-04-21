"use strict";

const { ButtonStyle } = require("discord.js");
const { container, textDisplay, separator, actionRow, btn, navRow, replyV2 } = require("../utils/components");

function build(data = {}) {
  const { config = {}, running = false } = data;

  const entries = Object.entries(config);
  const list = entries.length
    ? entries.flatMap(([gId, channels]) =>
        channels.map(cId => `• Serveur \`${gId}\` → <#${cId}>`)
      ).join("\n")
    : "*Aucun salon configuré.*";

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
