import { ButtonStyle } from "discord.js";
import { container, textDisplay, separator, actionRow, btn, selectMenu, navRow, replyV2, type V2MessagePayload } from "../utils/components";

export interface AfkData {
  enabled?: boolean;
  reason?: string;
  message?: string;
  excluded?: string[];
  notified?: string[];
}

export function build(data: AfkData = {}): V2MessagePayload {
  const { enabled = false, reason = "", excluded = [], notified = [] } = data;
  return replyV2(
    container([
      textDisplay(
        `# 😴 Mode AFK\n` +
        `${enabled ? "`🟢`" : "`🔴`"} **Statut :** ${enabled ? "Activé" : "Désactivé"}\n` +
        "`📌` **Raison :** " + (reason || "*aucune*") + "\n" +
        "`🚫` **Exclusions :** " + excluded.length + " — `👥` **Notifiés :** " + notified.length
      ),
      separator(),
      actionRow([
        btn(enabled ? "🔴  Désactiver AFK" : "🟢  Activer AFK", "afk:toggle", enabled ? ButtonStyle.Danger : ButtonStyle.Success),
      ]),
      separator(),
      selectMenu("menu:afk", "📋  Choisis une action…", [
        { label: "📌  Changer la raison",  value: "afk:setReason",       description: "Modifier la raison AFK" },
        { label: "💬  Message AFK",        value: "afk:setMessage",      description: "Configurer le message AFK" },
        { label: "➕  Ajouter exclusion",  value: "afk:addExclusion",    description: "Exclure un utilisateur, serveur ou groupe" },
        { label: "➖  Retirer exclusion",  value: "afk:removeExclusion", description: "Retirer une exclusion existante" },
      ]),
      separator(),
      navRow(null, null, true),
    ], 0xFEE75C)
  );
}
