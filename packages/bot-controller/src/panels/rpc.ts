import { ButtonStyle } from "discord.js";
import { container, textDisplay, separator, actionRow, btn, selectMenu, navRow, replyV2, type ActionRowComponent, type ButtonComponent, type SelectOption, type V2MessagePayload } from "../utils/components";

export interface RpcActivity {
  type?: string;
  name: string;
  details?: string | null;
  state?: string | null;
  url?: string | null;
  platform?: string | null;
  assets?: { largeImage?: string | null; largeText?: string | null; smallImage?: string | null; smallText?: string | null };
  timestamps?: { start?: number | null; end?: number | null };
  buttons?: Array<{ label: string; url?: string }>;
}

export interface SpotifyConfig {
  enabled?: boolean;
  songId?: string | null;
  albumId?: string | null;
  artistIds?: string[];
  details?: string | null;
  state?: string | null;
  assets?: { largeImage?: string | null; largeText?: string | null; smallImage?: string | null; smallText?: string | null };
  timestamps?: { start?: number | null; end?: number | null };
  applicationId?: string | null;
  platform?: string | null;
  url?: string | null;
}

export interface RpcData {
  enabled?: boolean;
  mode?: string;
  status?: string;
  activities?: RpcActivity[];
  intervalSec?: number;
  applicationId?: string | null;
  customStatuses?: Array<{ emoji?: string | null; text?: string }>;
  csEnabled?: boolean;
  csIntervalSec?: number;
  spotify?: SpotifyConfig;
}

const TYPE_LABELS: Record<string, string> = {
  playing:   "🎮 Playing",
  streaming: "📺 Streaming",
  listening: "🎧 Listening",
  watching:  "👀 Watching",
  competing: "🏆 Competing",
};

const STATUS_LABELS: Record<string, string> = {
  online:    "`🟢` En ligne",
  idle:      "`🌙` Inactif",
  dnd:       "`🔴` Ne pas déranger",
  invisible: "`⚫` Invisible",
};

function short(value: string | null | undefined, max = 48): string {
  if (!value) return "—";
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** Barre de navigation commune aux trois panels RPC : liens croisés vers les
 *  deux panels frères + Accueil. Le retour au hub est inutile (il n'offre que
 *  ces mêmes liens). */
function rpcNavRow(current: "rpc" | "spotify" | "cs"): ActionRowComponent {
  const buttons: ButtonComponent[] = [];
  if (current !== "rpc")     buttons.push(btn("🎮  Rich Presence", "panel:rpc",         ButtonStyle.Primary));
  if (current !== "spotify") buttons.push(btn("🎵  Spotify RPC",   "panel:rpc_spotify", ButtonStyle.Primary));
  if (current !== "cs")      buttons.push(btn("💬  Custom Status", "panel:rpc_cs",      ButtonStyle.Primary));
  buttons.push(btn("🏠  Accueil", "panel:home", ButtonStyle.Secondary));
  return actionRow(buttons);
}

// ── Panel hub : choix RPC ou Custom Status ────────────────────────────────────

export function buildHub(): V2MessagePayload {
  return replyV2(
    container([
      textDisplay(
        `# 🎮 Rich Presence & Custom Status\n` +
        `*Quel paramètre veux-tu configurer ?*`
      ),
      separator(),
      actionRow([
        btn("🎮  Rich Presence", "panel:rpc",         ButtonStyle.Primary),
        btn("🎵  Spotify RPC",   "panel:rpc_spotify", ButtonStyle.Primary),
        btn("💬  Custom Status", "panel:rpc_cs",      ButtonStyle.Primary),
      ]),
      separator(1, false),
      navRow(null, null, true),
    ], 0x7289DA)
  );
}

// ── Panel principal : Rich Presence ──────────────────────────────────────────

export function build(data: RpcData = {}): V2MessagePayload {
  const {
    enabled       = false,
    mode          = "static",
    status        = "online",
    activities    = [],
    intervalSec   = 30,
    applicationId = null,
  } = data;

  const appIdLine = applicationId
    ? `\`🔑\` **App ID :** \`${applicationId}\``
    : `\`⚠️\` **App ID :** *non défini — boutons non cliquables !*`;

  const activityList = activities.length
    ? activities.map((a, i) => {
        const typeLabel = TYPE_LABELS[a.type ?? ""] ?? a.type;
        const url = a.type === "streaming" && a.url
          ? ` — *${a.url.slice(0, 40)}${a.url.length > 40 ? "…" : ""}*`
          : "";
        const details = a.details
          ? `\n> ↳ ${a.details}${a.state ? ` — ${a.state}` : ""}`
          : (a.state ? `\n> ↳ ${a.state}` : "");
        const assets = (a.assets?.largeImage || a.assets?.smallImage)
          ? `\n> 🖼️ \`${a.assets.largeImage ?? "—"}\`  •  \`${a.assets.smallImage ?? "—"}\``
          : "";
        const timing = (a.timestamps?.start || a.timestamps?.end)
          ? `\n> ⏱️ \`${a.timestamps?.start ? new Date(a.timestamps.start).toISOString().slice(11, 19) : "—"}\` → \`${a.timestamps?.end ? new Date(a.timestamps.end).toISOString().slice(11, 19) : "—"}\``
          : "";
        const buttons = a.buttons?.length
          ? `\n> 🔘 ${a.buttons.map((b, bi) => `\`${bi + 1}.\` ${b.label}`).join("  ")}`
          : "";
        const platform = a.platform
          ? `\n> 💻 \`${a.platform}\``
          : "";
        return `\`${i + 1}.\` **${typeLabel}** — ${a.name.slice(0, 60)}${a.name.length > 60 ? "…" : ""}${url}${details}${assets}${timing}${buttons}${platform}`;
      }).join("\n")
    : "*Aucune activité configurée.*";

  const modeLabel = mode === "rotate"
    ? `Rotation (toutes les \`${intervalSec}s\`)`
    : "Statique (1ère activité)";

  const actionOptions: SelectOption[] = [
    { label: enabled ? "🔴  Désactiver" : "🟢  Activer", value: "rpc:toggle", description: enabled ? "Désactive le Rich Presence" : "Active le Rich Presence" },
    { label: "🔑  App ID", value: "rpc:setAppId", description: "Définir l'Application ID Discord" },
    { label: "➕  Ajouter", value: "rpc:addActivity", description: "Ajouter une activité Rich Presence" },
    { label: "👤  Statut", value: "rpc:setStatus", description: "Changer le statut en ligne" },
    { label: mode === "rotate" ? "📌  Statique" : "🔄  Rotation", value: "rpc:toggleMode", description: "Basculer le mode d'affichage" },
  ];

  if (activities.length) {
    actionOptions.push(
      { label: "✏️  Éditer", value: "rpc:editActivity", description: "Modifier une activité existante" },
      { label: "➖  Supprimer", value: "rpc:removeActivity", description: "Supprimer une activité" },
      { label: "🖼️  Assets", value: "rpc:editAssets", description: "Configurer les assets d'une activité" },
      { label: "⏱️  Temps", value: "rpc:editTimestamps", description: "Configurer start/end timestamp" },
      { label: "💻  Plateforme", value: "rpc:setPlatform", description: "Définir la plateforme d'une activité" },
      { label: "🔘  Boutons", value: "rpc:editButtons", description: "Gérer les boutons de l'activité" },
      { label: "↕️  Déplacer", value: "rpc:move", description: "Monter ou descendre une activité dans la liste" },
      { label: "🗑️  Vider", value: "rpc:clear", description: "Supprimer toutes les activités" },
    );
  }

  if (mode === "rotate") {
    actionOptions.push({ label: "⏱️  Intervalle", value: "rpc:setInterval", description: "Régler l'intervalle de rotation" });
  }

  return replyV2(
    container([
      textDisplay(
        `# 🎮 Rich Presence\n` +
        `${enabled ? "`🟢` **Actif**" : "`🔴` **Inactif**"}  •  ${STATUS_LABELS[status] ?? status}  •  \`🔄\` ${modeLabel}\n` +
        `${appIdLine}\n\n` +
        `**Activités (${activities.length}) :**\n${activityList}`
      ),
      separator(),
      separator(1, false),
      textDisplay("**Actions Rich Presence :**"),
      selectMenu("menu:rpc", "Choisis une action…", actionOptions),
      separator(1, false),

      actionRow([
        btn("▶️  Appliquer",  "rpc:applyNow",    ButtonStyle.Success),
      ]),

      separator(),

      rpcNavRow("rpc"),
    ], 0x7289DA)
  );
}

// ── Panel secondaire : Custom Status ─────────────────────────────────────────

export function buildCs(data: RpcData = {}): V2MessagePayload {
  const {
    customStatuses = [],
    csEnabled      = false,
    csIntervalSec  = 15,
  } = data;

  const noStatuses = !customStatuses.length;

  const csActions: SelectOption[] = [
    { label: "➕  Ajouter", value: "rpc:csAdd", description: "Ajouter un custom status" },
  ];
  if (!noStatuses) {
    csActions.push(
      { label: "✏️  Modifier",  value: "rpc:csEdit",   description: "Modifier un custom status" },
      { label: "➖  Supprimer", value: "rpc:csRemove", description: "Supprimer un custom status" },
      { label: "🗑️  Vider",    value: "rpc:csClear",  description: "Supprimer tous les statuts" },
    );
  }
  csActions.push({ label: "⏱️  Intervalle", value: "rpc:setCsInterval", description: "Régler l'intervalle de rotation" });

  const csList = customStatuses.length
    ? customStatuses.map((cs, i) => {
        const emoji = cs.emoji ? `${cs.emoji} ` : "";
        return `\`${i + 1}.\` ${emoji}${cs.text || "*vide*"}`;
      }).join("\n")
    : "*Aucun statut configuré.*";

  return replyV2(
    container([
      textDisplay(
        `# 💬 Custom Status\n` +
        `${csEnabled ? `\`🟢\` **Rotation active** (toutes les \`${csIntervalSec}s\`)` : "`🔴` **Rotation inactive**"}\n\n` +
        `**Statuts (${customStatuses.length}) :**\n${csList}`
      ),
      separator(),

      actionRow([
        btn(
          csEnabled ? "🔴  Désactiver" : "🟢  Activer",
          "rpc:csToggle",
          csEnabled ? ButtonStyle.Danger : ButtonStyle.Success
        ),
      ]),
      separator(1, false),

      selectMenu("menu:rpc_cs", "📋  Choisis une action…", csActions),

      separator(),

      rpcNavRow("cs"),
    ], 0x7289DA)
  );
}

// ── Panel secondaire : Spotify RPC ───────────────────────────────────────────

export function buildSpotify(data: RpcData = {}): V2MessagePayload {
  const { spotify = {} } = data;

  const spotifyEnabled   = !!spotify.enabled;
  const spotifySongId    = spotify.songId    ?? null;
  const spotifyAlbumId   = spotify.albumId   ?? null;
  const spotifyArtistIds = Array.isArray(spotify.artistIds) ? spotify.artistIds : [];
  const spotifyAssets    = spotify.assets    ?? {};
  const spotifyTimestamps= spotify.timestamps ?? {};

  const trackLine  = spotifySongId  ? `\`${short(spotifySongId,  28)}\`` : "*manquant*";
  const albumLine  = spotifyAlbumId ? `\`${short(spotifyAlbumId, 28)}\`` : "*non défini*";
  const artistLine = spotifyArtistIds.length
    ? spotifyArtistIds.map((id) => `\`${short(id, 20)}\``).join(", ")
    : "*non défini*";

  const detailsLine = spotify.details ? short(spotify.details, 52) : "*non défini*";
  const stateLine   = spotify.state   ? short(spotify.state,   52) : "*non défini*";

  const lImg = spotifyAssets.largeImage ? `\`${short(spotifyAssets.largeImage, 28)}\`` : "*—*";
  const lTxt = spotifyAssets.largeText  ? short(spotifyAssets.largeText,  28) : "—";
  const sImg = spotifyAssets.smallImage ? `\`${short(spotifyAssets.smallImage, 28)}\`` : "*—*";
  const sTxt = spotifyAssets.smallText  ? short(spotifyAssets.smallText,  28) : "—";

  const fmtTs = (ts: number | null | undefined) => ts ? `\`${new Date(ts).toISOString().slice(11, 19)}\`` : "`—`";
  const timingLine = (spotifyTimestamps.start || spotifyTimestamps.end)
    ? `${fmtTs(spotifyTimestamps.start)} → ${fmtTs(spotifyTimestamps.end)}`
    : "*non configuré*";

  const appIdLine    = spotify.applicationId ? `\`${short(spotify.applicationId, 20)}\`` : "*—*";
  const platformLine = spotify.platform      ? `\`${spotify.platform}\``                 : "*—*";
  const urlLine      = spotify.url           ? short(spotify.url, 48)                    : "*—*";

  const spotifyList =
    `\`🎵\` **Track :** ${trackLine}\n` +
    `\`💿\` **Album :** ${albumLine}\n` +
    `\`🎤\` **Artiste(s) :** ${artistLine}\n\n` +
    `\`📝\` **Titre (details) :** ${detailsLine}\n` +
    `\`🎶\` **Sous-titre (state) :** ${stateLine}\n\n` +
    `\`🖼️\` **Large image :** ${lImg}${spotifyAssets.largeText ? ` — *${lTxt}*` : ""}\n` +
    `\`🖼️\` **Small image :** ${sImg}${spotifyAssets.smallText ? ` — *${sTxt}*` : ""}\n\n` +
    `\`⏱️\` **Timestamps :** ${timingLine}\n\n` +
    `\`🔑\` **App ID :** ${appIdLine}\n` +
    `\`💻\` **Plateforme :** ${platformLine}\n` +
    `\`🔗\` **URL :** ${urlLine}`;

  const actionOptions: SelectOption[] = [
    { label: spotifyEnabled ? "🔴  Désactiver" : "🟢  Activer", value: "rpc:spotifyToggle",     description: spotifyEnabled ? "Désactiver Spotify RPC" : "Activer Spotify RPC" },
    { label: "⚙️  Base (track / album / artistes)",             value: "rpc:spotify",           description: "IDs Spotify, titre et sous-titre" },
    { label: "🖼️  Assets (images)",                             value: "rpc:spotifyAssets",     description: "Images large et small" },
    { label: "⏱️  Timestamps",                                  value: "rpc:spotifyTimestamps", description: "Début et durée de lecture" },
    { label: "🧩  Extras (app ID / plateforme)",                value: "rpc:spotifyExtras",     description: "Réglages avancés" },
  ];

  return replyV2(
    container([
      textDisplay(
        `# 🎵 Spotify RPC\n` +
        `${spotifyEnabled ? "`🟢` **Actif**" : "`🔴` **Inactif**"}\n\n` +
        `**Configuration (${spotifySongId ? "1" : "0"}/1 track) :**\n${spotifyList}`
      ),
      separator(),
      separator(1, false),
      textDisplay("**Actions Spotify RPC :**"),
      selectMenu("menu:rpc_spotify", "Choisis une action…", actionOptions),
      separator(),
      rpcNavRow("spotify"),
    ], 0x7289DA)
  );
}
