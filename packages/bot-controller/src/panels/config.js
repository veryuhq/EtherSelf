"use strict";

const { ButtonStyle } = require("discord.js");
const { container, textDisplay, separator, actionRow, btn, navRow, replyV2 } = require("../utils/components");

function build() {
  return replyV2(
    container([
      textDisplay("# ⚙️ Configuration\nGère les paramètres globaux du selfbot."),
      separator(),
      actionRow([
        btn("✏️  Préfixe", "config:prefix", ButtonStyle.Primary),
        btn("📊  Infos système", "config:sysinfo", ButtonStyle.Secondary),
      ]),
      separator(),
      navRow(null, null, true),
    ], 0x5865F2)
  );
}

module.exports = { build };
