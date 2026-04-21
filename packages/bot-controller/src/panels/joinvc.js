"use strict";

const { ButtonStyle } = require("discord.js");
const { container, textDisplay, separator, actionRow, btn, navRow, replyV2 } = require("../utils/components");

function build(data = {}) {
  const { joined = false, channelId = null, channelName = null, guildName = null } = data;

  const status = joined
    ? "`🟢` **Connecté** dans **" + (channelName ?? channelId) + "**" + (guildName ? ` — *${guildName}*` : "")
    : "`🔴` **Non connecté**";

  return replyV2(
    container([
      textDisplay(`# 🔊 Salon vocal\n${status}`),
      separator(),
      actionRow([
        btn("🔊  Rejoindre",         "joinvc:join",  ButtonStyle.Success),
        btn("🔄  Changer de salon",  "joinvc:move",  ButtonStyle.Primary,  null, !joined),
        btn("🔇  Quitter",           "joinvc:leave", ButtonStyle.Danger,   null, !joined),
      ]),
      separator(),
      navRow(null, null, true),
    ], 0x9B59B6)
  );
}

module.exports = { build };