"use strict";

const { ButtonStyle } = require("discord.js");
const { container, textDisplay, separator, actionRow, btn, selectMenu, navRow, replyV2 } = require("../utils/components");

const TYPE_LABELS = {
  playing:   "🎮 Playing",
  streaming: "📺 Streaming",
  listening: "🎧 Listening",
  watching:  "👀 Watching",
  competing: "🏆 Competing",
};

const STATUS_LABELS = {
  online:    "`🟢` En ligne",
  idle:      "`🌙` Inactif",
  dnd:       "`🔴` Ne pas déranger",
  invisible: "`⚫` Invisible",
};

function short(value, max = 48) {
  if (!value) return "—";
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

// ── Panel hub : choix RPC ou Custom Status ────────────────────────────────────

function buildHub() {
  return replyV2(
    container([
      textDisplay(
        `# 🎮 Rich Presence & Custom Status\n` +
        `*Quel paramètre veux-tu configurer ?*`
      ),
      separator(),
      actionRow([
        btn("🎮  Rich Presence", "panel:rpc",    ButtonStyle.Primary),
        btn("🎵  Spotify RPC",   "panel:rpc_spotify", ButtonStyle.Primary),
        btn("💬  Custom Status", "panel:rpc_cs", ButtonStyle.Primary),
      ]),
      separator(1, false),
      actionRow([
        btn("🏠  Accueil",        "panel:home",   ButtonStyle.Secondary),
      ]),
    ], 0x7289DA)
  );
}

// ── Panel principal : Rich Presence ──────────────────────────────────────────

function build(data = {}) {
  const {
    enabled       = false,
    mode          = "static",
    status        = "online",
    activities    = [],
    intervalSec   = 30,
    applicationId = null,
  } = data;

  const noActivities = !activities.length;

  const appIdLine = applicationId
    ? `\`🔑\` **App ID :** \`${applicationId}\``
    : `\`⚠️\` **App ID :** *non défini — boutons non cliquables !*`;

  const activityList = activities.length
    ? activities.map((a, i) => {
        const typeLabel = TYPE_LABELS[a.type] ?? a.type;
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

  const actionOptions = [
    { label: enabled ? "🔴  Désactiver" : "🟢  Activer", value: "toggle", description: enabled ? "Désactive le Rich Presence" : "Active le Rich Presence" },
    { label: "🔑  App ID", value: "setAppId", description: "Définir l'Application ID Discord" },
    { label: "➕  Ajouter", value: "addActivity", description: "Ajouter une activité Rich Presence" },
    { label: "👤  Statut", value: "setStatus", description: "Changer le statut en ligne" },
    { label: mode === "rotate" ? "📌  Statique" : "🔄  Rotation", value: "toggleMode", description: "Basculer le mode d'affichage" },
  ];

  if (activities.length) {
    actionOptions.push(
      { label: "✏️  Éditer", value: "editActivity", description: "Modifier une activité existante" },
      { label: "➖  Supprimer", value: "removeActivity", description: "Supprimer une activité" },
      { label: "🖼️  Assets", value: "editAssets", description: "Configurer les assets d'une activité" },
      { label: "⏱️  Temps", value: "editTimestamps", description: "Configurer start/end timestamp" },
      { label: "💻  Plateforme", value: "setPlatform", description: "Définir la plateforme d'une activité" },
      { label: "🔘  Boutons", value: "editButtons", description: "Gérer les boutons de l'activité" },
      { label: "⬆️  Monter", value: "moveUp", description: "Monter une activité dans la liste" },
      { label: "⬇️  Descendre", value: "moveDown", description: "Descendre une activité dans la liste" },
      { label: "🗑️  Vider", value: "clear", description: "Supprimer toutes les activités" },
    );
  }

  if (mode === "rotate") {
    actionOptions.push({ label: "⏱️  Intervalle", value: "setInterval", description: "Régler l'intervalle de rotation" });
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
      selectMenu("rpc:actions", "Choisis une action…", actionOptions),
      separator(1, false),

      actionRow([
        btn("▶️  Appliquer",  "rpc:applyNow",    ButtonStyle.Success),
      ]),

      separator(),

      actionRow([
        btn("🎵  Spotify RPC",   "panel:rpc_spotify", ButtonStyle.Primary),
        btn("💬  Custom Status", "panel:rpc_cs",  ButtonStyle.Primary),
        btn("◀️  Retour",        "panel:rpc_hub", ButtonStyle.Secondary),
        btn("🏠  Accueil",        "panel:home",    ButtonStyle.Secondary),
      ]),
    ], 0x7289DA)
  );
}

// ── Panel secondaire : Custom Status ─────────────────────────────────────────

function buildCs(data = {}) {
  const {
    customStatuses = [],
    csEnabled      = false,
    csIntervalSec  = 15,
  } = data;

  const noStatuses = !customStatuses.length;

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
        btn("➕  Ajouter",   "rpc:csAdd",    ButtonStyle.Primary),
        btn("✏️  Modifier",  "rpc:csEdit",   ButtonStyle.Secondary, null, noStatuses),
        btn("➖  Supprimer", "rpc:csRemove", ButtonStyle.Danger,    null, noStatuses),
        btn("🗑️  Vider",    "rpc:csClear",  ButtonStyle.Danger,    null, noStatuses),
      ]),
      separator(1, false),

      actionRow([
        btn("⏱️  Intervalle", "rpc:setCsInterval", ButtonStyle.Secondary),
      ]),

      separator(),

      actionRow([
        btn("🎵  Spotify RPC",   "panel:rpc_spotify", ButtonStyle.Primary),
        btn("🎮  Rich Presence", "panel:rpc",     ButtonStyle.Primary),
        btn("◀️  Retour",        "panel:rpc_hub", ButtonStyle.Secondary),
        btn("🏠  Accueil",        "panel:home",    ButtonStyle.Secondary),
      ]),
    ], 0x7289DA)
  );
}

// ── Panel secondaire : Spotify RPC ───────────────────────────────────────────

function buildSpotify(data = {}) {
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
    ? spotifyArtistIds.map(id => `\`${short(id, 20)}\``).join(", ")
    : "*non défini*";

  const detailsLine = spotify.details ? short(spotify.details, 52) : "*non défini*";
  const stateLine   = spotify.state   ? short(spotify.state,   52) : "*non défini*";

  const lImg = spotifyAssets.largeImage ? `\`${short(spotifyAssets.largeImage, 28)}\`` : "*—*";
  const lTxt = spotifyAssets.largeText  ? short(spotifyAssets.largeText,  28) : "—";
  const sImg = spotifyAssets.smallImage ? `\`${short(spotifyAssets.smallImage, 28)}\`` : "*—*";
  const sTxt = spotifyAssets.smallText  ? short(spotifyAssets.smallText,  28) : "—";

  const fmtTs = (ts) => ts ? `\`${new Date(ts).toISOString().slice(11, 19)}\`` : "`—`";
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

  const actionOptions = [
    { label: spotifyEnabled ? "🔴  Désactiver" : "🟢  Activer", value: "spotifyToggle",     description: spotifyEnabled ? "Désactiver Spotify RPC" : "Activer Spotify RPC" },
    { label: "⚙️  Base (track / album / artistes)",             value: "spotifyBase",       description: "IDs Spotify, titre et sous-titre" },
    { label: "🖼️  Assets (images)",                             value: "spotifyAssets",     description: "Images large et small" },
    { label: "⏱️  Timestamps",                                  value: "spotifyTimestamps", description: "Début et durée de lecture" },
    { label: "🧩  Extras (app ID / plateforme)",                value: "spotifyExtras",     description: "Réglages avancés" },
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
      { type: 1, components: [{ type: 3, custom_id: "rpc:spotifyActions", placeholder: "Choisis une action…", min_values: 1, max_values: 1, options: actionOptions }] },
      separator(),
      actionRow([
        btn("🎮  Rich Presence", "panel:rpc",     ButtonStyle.Primary),
        btn("💬  Custom Status", "panel:rpc_cs",  ButtonStyle.Primary),
        btn("◀️  Retour",        "panel:rpc_hub", ButtonStyle.Secondary),
        btn("🏠  Accueil",        "panel:home",   ButtonStyle.Secondary),
      ]),
    ], 0x7289DA)
  );
}

module.exports = { build, buildCs, buildHub, buildSpotify };