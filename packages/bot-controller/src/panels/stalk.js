"use strict";

const { ButtonStyle } = require("discord.js");
const { container, textDisplay, separator, actionRow, btn, navRow, replyV2 } = require("../utils/components");

function build(data = {}) {
  const { stalked = [] } = data;
  const list = stalked.length
    ? stalked.map((id, i) => `\`${i + 1}.\` <@${id}> (\`${id}\`)`).join("\n")
    : "*Aucun utilisateur surveillé.*";

  return replyV2(
    container([
      textDisplay(`# 👁️ Stalk vocal\n**Utilisateurs surveillés (${stalked.length}) :**\n${list}`),
      separator(),
      actionRow([
        btn("➕  Stalker",   "stalk:add",    ButtonStyle.Success),
        btn("➖  Unstalker", "stalk:remove", ButtonStyle.Danger),
      ]),
      separator(),
      navRow(null, null, true),
    ], 0x57F287)
  );
}

module.exports = { build };
