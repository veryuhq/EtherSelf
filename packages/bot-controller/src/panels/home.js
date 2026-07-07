"use strict";

const { ButtonStyle } = require("discord.js");
const { container, textDisplay, separator, selectMenu, replyV2 } = require("../utils/components");

function build(data = {}) {
  const { prefix = "." } = data;

  return replyV2(
    container([
      textDisplay(
        "# 🎛️ EtherSelf — Panneau de contrôle\n" +
        "*Gère ton selfbot depuis ici, sans taper une seule commande.*\n\n" +
        `-# 💡 **Commandes préfixe disponibles :** \`${prefix}mock <texte>\` · \`${prefix}spoiler <texte>\` · \`${prefix}tag <nom>\``
      ),
      separator(),
      textDisplay("**Choisis un module :**"),
      selectMenu("panel:nav", "📂 Sélectionne un module...", [
        { label: "⚙️  Configuration",                      value: "config",       description: "Préfixe et informations système" },
        { label: "😴  AFK",                                  value: "afk",          description: "Configurer le mode AFK" },
        { label: "🔍  Snipe / MessageLogger / Snapshots",    value: "snipe",        description: "Whitelist, consultation des messages et snapshots de salon" },
        { label: "🏷️  Tags",                                value: "tags",         description: "Gérer tes messages prédéfinis" },
        { label: "📌  Bookmarks salons",                     value: "bookmarks",    description: "Salons favoris" },
        { label: "💬  Bookmarks messages",                   value: "msgbookmarks", description: "Messages importants sauvegardés" },
        { label: "🔇  Anti-Group DM",                        value: "antigroup",    description: "Quitter auto les group DMs" },
        { label: "⬆️  Auto-Bump",                            value: "autobump",     description: "Config du bump automatique Disboard" },
        { label: "🎮  Rich Presence / Spotify / Custom Status", value: "rpc_hub",   description: "Rich Presence, Spotify RPC et Custom Status" },
        { label: "🔊  Salon vocal",                          value: "joinvc",       description: "Rejoindre ou quitter un salon vocal" },
        { label: "🗑️  Purge",                               value: "purge",        description: "Supprimer tes messages dans un salon" },
        { label: "🏆  Discord Quests",                       value: "quests",       description: "Complétion automatique des quêtes Discord" },
        { label: "💾  Backups & Clone",                      value: "backups",      description: "Backup amis/serveurs, cloner un serveur" },
              ]),
    ], 0x5865F2)
  );
}

module.exports = { build };