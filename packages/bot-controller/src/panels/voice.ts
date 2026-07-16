import { ButtonStyle } from "discord.js";
import { container, textDisplay, separator, actionRow, btn, navRow, replyV2, type V2MessagePayload } from "../utils/components";

export interface VoiceData {
  enabled?: boolean;
  connected?: boolean;
  channelId?: string | null;
  channelName?: string | null;
  guildName?: string | null;
  presence?: {
    mode?: "gateway" | null;
    joinedAt?: number | null;
    drops?: number;
    lastDropAt?: number | null;
  };
}

export function build(data: VoiceData = {}): V2MessagePayload {
  const { enabled = false, connected = false, channelId = null, channelName = null, guildName = null } = data;

  // Salon configuré : « 🔊 <nom> — <serveur> » (ou l'ID brut si le nom est inconnu).
  const salonLabel = channelId
    ? `${channelName ? `🔊 ${channelName}` : `\`${channelId}\``}${guildName ? ` — ${guildName}` : ""}`
    : null;

  // Ligne Connexion : quand on est en vocal, on affiche « Connecté dans <salon> — <serveur> ».
  const connexionLine = connected
    ? `\`🟢\` **Connexion :** Connecté dans ${salonLabel ?? "*?*"}`
    : enabled
      ? `\`🟠\` **Connexion :** Reprise en cours…${salonLabel ? ` — ${salonLabel}` : ""}`
      : `\`🔴\` **Connexion :** Déconnecté${salonLabel ? ` — salon : ${salonLabel}` : " — *aucun salon configuré*"}`;

  return replyV2(
    container([
      textDisplay(
        `# 🔊 Salon Vocal\n` +
        connexionLine
      ),
      separator(),
      actionRow([
        btn("🟢  Se connecter",         "voice:connect",    ButtonStyle.Success,   null, enabled),
        btn("🔴  Quitter",              "voice:quit",       ButtonStyle.Danger,    null, !enabled),
        btn("🎙️  Changer de salon vocal", "voice:setChannel", ButtonStyle.Secondary),
      ]),
      separator(),
      navRow(null, null, true),
    ], 0x57F287)
  );
}
