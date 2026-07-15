import { ButtonStyle } from "discord.js";
import { container, textDisplay, separator, actionRow, btn, selectMenu, navRow, replyV2, type V2MessagePayload } from "../utils/components";

export interface VoiceData {
  enabled?: boolean;
  connected?: boolean;
  channelId?: string | null;
  channelName?: string | null;
  guildName?: string | null;
  playing?: boolean;
  music?: {
    file?: string | null;
    filePath?: string | null;
    volume?: number;
    loop?: boolean;
  };
  deps?: { nacl?: boolean; ffmpeg?: boolean };
}

export function build(data: VoiceData = {}): V2MessagePayload {
  const { enabled = false, connected = false, channelId = null, channelName = null, guildName = null, playing = false } = data;
  const music = data.music ?? {};
  const deps = data.deps ?? {};

  const channelLabel = channelId
    ? `${channelName ? `🔊 ${channelName}` : `\`${channelId}\``}${guildName ? ` — ${guildName}` : ""}`
    : "*aucun*";

  const warnings: string[] = [];
  if (deps.nacl === false)   warnings.push("`⚠️` **PyNaCl manquant** — relance `npm run setup:selfbot`.");
  if (deps.ffmpeg === false) warnings.push("`⚠️` **ffmpeg introuvable** — installe-le sur l'hôte pour la musique.");

  return replyV2(
    container([
      textDisplay(
        `# 🔊 Salon Vocal & Musique\n` +
        `${connected ? "`🟢`" : enabled ? "`🟠`" : "`🔴`"} **Connexion :** ${connected ? "connecté" : enabled ? "reconnexion en cours…" : "déconnecté"}\n` +
        `\`🎙️\` **Salon configuré :** ${channelLabel}\n` +
        `${playing ? "`▶️`" : "`⏹️`"} **Musique :** ${playing ? "en lecture" : "à l'arrêt"} — ${music.file ? `\`${music.file}\`` : "*aucun fichier*"}\n` +
        `\`🔊\` **Volume :** ${music.volume ?? 100} % — \`🔁\` **Boucle :** ${music.loop ? "activée" : "désactivée"}` +
        (warnings.length ? `\n\n${warnings.join("\n")}` : "")
      ),
      separator(),
      actionRow([
        btn(enabled ? "🔴  Se déconnecter" : "🟢  Se connecter", "voice:toggle", enabled ? ButtonStyle.Danger : ButtonStyle.Success),
        btn("🎵  Musique", "voice:music", ButtonStyle.Primary),
        btn("⏹️  Stop", "voice:musicStop", ButtonStyle.Secondary, null, !playing),
      ]),
      separator(),
      selectMenu("menu:voice", "📋  Choisis une action…", [
        { label: "🎙️  Définir le salon vocal", value: "voice:setChannel", description: "ID du salon vocal à rejoindre" },
        { label: "🔊  Changer le volume",       value: "voice:setVolume",  description: "Volume 0–200 %, appliqué en direct" },
        { label: "🔁  Basculer la boucle",      value: "voice:loopToggle", description: "Rejouer la musique en continu ou non" },
      ]),
      separator(),
      navRow(null, null, true),
    ], 0x57F287)
  );
}
