"use strict";

const { ButtonStyle } = require("discord.js");
const { container, textDisplay, separator, actionRow, btn, navRow, replyV2 } = require("../utils/components");

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
        btn("💬  Custom Status", "panel:rpc_cs", ButtonStyle.Primary),
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
        const buttons = a.buttons?.length
          ? `\n> 🔘 ${a.buttons.map((b, bi) => `\`${bi + 1}.\` ${b.label}`).join("  ")}`
          : "";
        const platform = a.platform
          ? `\n> 💻 \`${a.platform}\``
          : "";
        return `\`${i + 1}.\` **${typeLabel}** — ${a.name.slice(0, 60)}${a.name.length > 60 ? "…" : ""}${url}${details}${assets}${buttons}${platform}`;
      }).join("\n")
    : "*Aucune activité configurée.*";

  const modeLabel = mode === "rotate"
    ? `Rotation (toutes les \`${intervalSec}s\`)`
    : "Statique (1ère activité)";

  return replyV2(
    container([
      textDisplay(
        `# 🎮 Rich Presence\n` +
        `${enabled ? "`🟢` **Actif**" : "`🔴` **Inactif**"}  •  ${STATUS_LABELS[status] ?? status}  •  \`🔄\` ${modeLabel}\n` +
        `${appIdLine}\n\n` +
        `**Activités (${activities.length}) :**\n${activityList}`
      ),
      separator(),

      actionRow([
        btn(
          enabled ? "🔴  Désactiver" : "🟢  Activer",
          "rpc:toggle",
          enabled ? ButtonStyle.Danger : ButtonStyle.Success
        ),
        btn("🔑  App ID",      "rpc:setAppId",     ButtonStyle.Secondary),
        btn("➕  Ajouter",    "rpc:addActivity",  ButtonStyle.Primary),
        btn("✏️  Éditer",     "rpc:editActivity", ButtonStyle.Primary,   null, noActivities),
        btn("➖  Supprimer",  "rpc:removeActivity", ButtonStyle.Danger,  null, noActivities),
      ]),
      separator(1, false),

      actionRow([
        btn("🖼️  Assets",     "rpc:editAssets",   ButtonStyle.Secondary, null, noActivities),
        btn("💻  Plateforme", "rpc:setPlatform",   ButtonStyle.Secondary, null, noActivities),
        btn("🔘  Boutons",    "rpc:editButtons",   ButtonStyle.Secondary, null, noActivities),
        btn("⬆️  Monter",     "rpc:moveUp",        ButtonStyle.Secondary, null, noActivities),
        btn("⬇️  Descendre",  "rpc:moveDown",      ButtonStyle.Secondary, null, noActivities),
      ]),
      separator(1, false),

      actionRow([
        btn("👤  Statut",     "rpc:setStatus",   ButtonStyle.Secondary),
        btn(
          mode === "rotate" ? "📌  Statique" : "🔄  Rotation",
          "rpc:toggleMode",
          ButtonStyle.Secondary
        ),
        btn("⏱️  Intervalle", "rpc:setInterval", ButtonStyle.Secondary, null, mode !== "rotate"),
        btn("🗑️  Vider",     "rpc:clear",        ButtonStyle.Danger,    null, noActivities),
        btn("▶️  Appliquer",  "rpc:applyNow",    ButtonStyle.Success),
      ]),

      separator(),

      actionRow([
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
        btn("⏱️  Intervalle statuts", "rpc:setCsInterval", ButtonStyle.Secondary),
      ]),

      separator(),

      actionRow([
        btn("🎮  Rich Presence", "panel:rpc",     ButtonStyle.Primary),
        btn("◀️  Retour",        "panel:rpc_hub", ButtonStyle.Secondary),
        btn("🏠  Accueil",        "panel:home",    ButtonStyle.Secondary),
      ]),
    ], 0x7289DA)
  );
}

module.exports = { build, buildCs, buildHub };