"use strict";

const { ButtonStyle } = require("discord.js");
const { container, textDisplay, separator, actionRow, btn, selectMenu, navRow, replyV2 } = require("../utils/components");

function build() {
  return replyV2(
    container([
      textDisplay("# ⚙️ Configuration\nGère les paramètres globaux du selfbot."),
      separator(),
      selectMenu("menu:config", "📋  Choisis une action…", [
        { label: "✏️  Préfixe",       value: "config:prefix",  description: "Changer le préfixe des commandes" },
        { label: "🔐  Token selfbot", value: "config:token",   description: "Modifier le token du selfbot" },
        { label: "🔁  Redémarrage",   value: "config:restart", description: "Redémarrer le selfbot et le bot" },
        { label: "📊  Infos système", value: "config:sysinfo", description: "Voir les informations système" },
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
