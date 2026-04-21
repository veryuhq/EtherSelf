"use strict";

const { ButtonStyle } = require("discord.js");
const { container, textDisplay, separator, actionRow, btn, navRow, replyV2 } = require("../utils/components");

function build(data = {}) {
  const { prefix = "." } = data;
  return replyV2(
    container([
      textDisplay(`# ⚙️ Préfixe\nPréfixe actuel : \`${prefix}\``),
      separator(),
      actionRow([
        btn("✏️  Changer le préfixe", "prefix:edit", ButtonStyle.Primary),
      ]),
      separator(),
      navRow(null, null, true),
    ], 0xEB459E)
  );
}

module.exports = { build };
