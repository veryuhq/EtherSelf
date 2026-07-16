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
  const presence = data.presence ?? {};

  const channelLabel = channelId
    ? `${channelName ? `🔊 ${channelName}` : `\`${channelId}\``}${guildName ? ` — ${guildName}` : ""}`
    : "*aucun*";

  // Présence maintenue par le voice state gateway (op4) : aucune couche audio,
  // donc insensible aux pannes du serveur vocal et aux hôtes qui filtrent l'UDP.
  const sinceLabel = presence.joinedAt ? ` — en vocal depuis <t:${presence.joinedAt}:R>` : "";
  const dropsLabel = presence.drops
    ? `\n\`⚠️\` **Coupures détectées :** ${presence.drops}${presence.lastDropAt ? ` (dernière <t:${presence.lastDropAt}:R>)` : ""}`
    : "";

  return replyV2(
    container([
      textDisplay(
        `# 🔊 Salon Vocal\n` +
        `${connected ? "`🟢`" : enabled ? "`🟠`" : "`🔴`"} **Présence :** ${connected ? "en vocal" : enabled ? "reprise en cours…" : "hors vocal"}${connected ? sinceLabel : ""}\n` +
        `\`🎙️\` **Salon configuré :** ${channelLabel}` +
        dropsLabel
      ),
      separator(),
      actionRow([
        btn(enabled ? "🔴  Se déconnecter" : "🟢  Se connecter", "voice:toggle", enabled ? ButtonStyle.Danger : ButtonStyle.Success),
        btn("🎙️  Définir le salon", "voice:setChannel", ButtonStyle.Secondary),
      ]),
      separator(),
      navRow(null, null, true),
    ], 0x57F287)
  );
}
