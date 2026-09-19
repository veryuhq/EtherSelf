import { container, textDisplay, separator, selectMenu, replyV2, type V2MessagePayload } from "../utils/components";

export interface HomeData {
  prefix?: string;
}

export function build(data: HomeData = {}): V2MessagePayload {
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
        { label: "🏷️  Tags",                                value: "tags",         description: "Gérer tes messages prédéfinis" },
        { label: "📌  Bookmarks salons",                     value: "bookmarks",    description: "Salons favoris" },
        { label: "💬  Bookmarks messages",                   value: "msgbookmarks", description: "Messages importants sauvegardés" },
        { label: "🔇  Anti-Group DM",                        value: "antigroup",    description: "Quitter auto les group DMs" },
        { label: "🎮  Rich Presence / Spotify / Custom Status", value: "rpc_hub",   description: "Rich Presence, Spotify RPC et Custom Status" },
        { label: "🎭  Rôles",                                value: "roles",        description: "Rôles d'un membre, membres d'un rôle" },
        { label: "🗑️  Purge",                               value: "purge",        description: "Supprimer tes messages dans un salon" },
        { label: "🏆  Discord Quests",                       value: "quests",       description: "Complétion automatique des quêtes Discord" },
        { label: "💾  Backups",                      value: "backups",      description: "Backup amis et serveurs (aec invitations)" },
      ]),
    ], 0x5865F2)
  );
}
