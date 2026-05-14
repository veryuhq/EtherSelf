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
        btn("🔐  Token selfbot", "config:token", ButtonStyle.Primary),
        btn("🔁  Redémarrage", "config:restart", ButtonStyle.Primary),
        btn("📊  Infos système", "config:sysinfo", ButtonStyle.Secondary),
      ]),
      separator(),
      navRow(null, null, true),
    ], 0x5865F2)
  );
}


function buildRestartConfirm() {
  return replyV2(
    container([
      textDisplay("# 🔁 Redémarrage PM2\nVeux-tu redémarrer **le selfbot et le bot** maintenant ?"),
      separator(),
      actionRow([
        btn("🚀  Oui, redémarrer maintenant", "config:restart:confirm", ButtonStyle.Danger),
        btn("⏭️  Non, annuler", "config:restart:skip", ButtonStyle.Secondary),
      ]),
      separator(),
      navRow("panel:config", "Configuration", true),
    ], 0xFEE75C)
  );
}


function buildTokenUpdated() {
  return replyV2(
    container([
      textDisplay("# ✅ Token mis à jour\nLe token selfbot (`sb-uhq/.env` → `TOKEN`) a été modifié avec succès."),
      separator(),
      textDisplay("## 🔁 Redémarrage PM2\nVeux-tu redémarrer **le selfbot et le bot** maintenant ?"),
      actionRow([
        btn("🚀  Oui, redémarrer maintenant", "config:token:restart", ButtonStyle.Danger),
        btn("⏭️  Non, plus tard", "config:token:restart:skip", ButtonStyle.Secondary),
      ]),
      separator(),
      navRow("panel:config", "Configuration", true),
    ], 0x57F287)
  );
}

module.exports = { build, buildRestartConfirm, buildTokenUpdated };
