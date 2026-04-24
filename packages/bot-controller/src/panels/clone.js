"use strict";

const { ButtonStyle, MessageFlags, FileBuilder } = require("discord.js");
const { container, textDisplay, separator, actionRow, btn, navRow, replyV2 } = require("../utils/components");

// ─────────────────────────────────────────────────────────────────────────────
//  HUB
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
//  CLONE
// ─────────────────────────────────────────────────────────────────────────────

function buildClone(data = {}) {
  const {
    sourceGuildId = null, sourceGuildName = null,
    targetGuildId = null, targetGuildName = null,
    cloneRoles = true, cloneChannels = true, cloneEmojis = true, cloneSettings = true,
  } = data;

  const sourceDisplay = sourceGuildName
    ? `**${sourceGuildName}** (\`${sourceGuildId}\`)` : sourceGuildId ? `\`${sourceGuildId}\`` : "*non défini*";
  const targetDisplay = targetGuildName
    ? `**${targetGuildName}** (\`${targetGuildId}\`)` : targetGuildId ? `\`${targetGuildId}\`` : "*non défini*";
  const canRun = !!(sourceGuildId && targetGuildId && sourceGuildId !== targetGuildId);
  const optLine = [
    cloneRoles    ? "`🎭` Rôles"       : null,
    cloneChannels ? "`💬` Salons"      : null,
    cloneEmojis   ? "`😀` Emojis"      : null,
    cloneSettings ? "`⚙️` Paramètres" : null,
  ].filter(Boolean).join("  ·  ") || "*Aucune option sélectionnée*";

  return replyV2(
    container([
      textDisplay(
        `# 🔁 Clone de serveur\n` +
        `-# Copie la structure complète d'un serveur Discord vers un autre.\n\n` +
        `### Serveurs\n> \`📤\` **Source :** ${sourceDisplay}\n> \`📥\` **Cible :**  ${targetDisplay}\n\n` +
        `### Options de clonage\n> ${optLine}\n\n` +
        `-# ⚠️ Les salons existants de la cible seront supprimés avant le clonage.`
      ),
      separator(),
      actionRow([
        btn("📤  Source",    "clone:setSource",  ButtonStyle.Primary),
        btn("📥  Cible",     "clone:setTarget",  ButtonStyle.Primary),
        btn("🗂️  Serveurs", "clone:listGuilds", ButtonStyle.Secondary),
      ]),
      separator(1, false),
      actionRow([
        btn(cloneRoles    ? "🎭  Rôles ✅"    : "🎭  Rôles ❌",    "clone:toggleRoles",    cloneRoles    ? ButtonStyle.Success : ButtonStyle.Secondary),
        btn(cloneChannels ? "💬  Salons ✅"   : "💬  Salons ❌",   "clone:toggleChannels", cloneChannels ? ButtonStyle.Success : ButtonStyle.Secondary),
        btn(cloneEmojis   ? "😀  Emojis ✅"   : "😀  Emojis ❌",   "clone:toggleEmojis",   cloneEmojis   ? ButtonStyle.Success : ButtonStyle.Secondary),
        btn(cloneSettings ? "⚙️  Params ✅"   : "⚙️  Params ❌",  "clone:toggleSettings", cloneSettings ? ButtonStyle.Success : ButtonStyle.Secondary),
      ]),
      separator(),
      actionRow([
        btn("▶️  Lancer le clonage", "clone:run",     ButtonStyle.Danger,     null, !canRun),
        btn("📜  Historique",         "clone:history", ButtonStyle.Secondary),
      ]),
      separator(),
      actionRow([
        btn("🏠  Accueil", "panel:home", ButtonStyle.Secondary),
      ]),
    ], 0xE67E22)
  );
}

function buildCloneRunning(data = {}) {
  const { step = "start", sourceGuild = "?", targetGuild = "?", current = 0, total = 0, label = "Initialisation…", logs = "", jobId = null } = data;
  const STEP_LABELS = { start: "🚀 Démarrage", roles: "🎭 Clonage des rôles", roles_done: "🎭 Rôles ✅", channels: "💬 Clonage des salons", channels_done: "💬 Salons ✅", emojis: "😀 Clonage des emojis", emojis_done: "😀 Emojis ✅", settings: "⚙️ Application des paramètres", done: "✅ Terminé", error: "❌ Erreur" };
  const STEP_ORDER = ["roles", "channels", "emojis", "settings"];
  const STEP_ICONS = { roles: "🎭", channels: "💬", emojis: "😀", settings: "⚙️" };
  const base = step.replace("_done", "");
  const idx  = STEP_ORDER.indexOf(base);
  const stepsLine = STEP_ORDER.map((s, i) => {
    const icon = STEP_ICONS[s];
    if (i < idx || step === `${s}_done` || step === "done") return `\`✅\` ${icon}`;
    if (s === base && step !== `${s}_done`) return `\`⏳\` ${icon}`;
    return `\`⬜\` ${icon}`;
  }).join("  ");
  const BAR_LEN = 14;
  const filled  = total > 0 ? Math.round((current / total) * BAR_LEN) : 0;
  const bar     = "█".repeat(filled) + "░".repeat(BAR_LEN - filled);
  const pctLine = total > 0 ? `\`${bar}\` **${current}/${total}** *(${Math.round((current / total) * 100)}%)*` : `\`🔄\` Démarrage…`;
  const logsSection = logs ? `\n### Logs\n\`\`\`\n${logs}\n\`\`\`` : "";

  return replyV2(
    container([
      textDisplay(
        `# 🔁 Clone en cours…\n-# Ce panneau se met à jour automatiquement.\n\n` +
        `### Serveurs\n> \`📤\` **Source :** ${sourceGuild}\n> \`📥\` **Cible :**  ${targetGuild}\n\n` +
        `### Progression\n${stepsLine}\n\n**Étape :** ${STEP_LABELS[step] ?? step}\n${pctLine}\n\`💬\` *${label}*` +
        logsSection
      ),
      separator(),
      actionRow([
        btn("🛑  Annuler", jobId ? `clone:cancel:${jobId}` : "clone:cancel", ButtonStyle.Danger),
        btn("🏠  Accueil", "panel:home", ButtonStyle.Secondary),
      ]),
    ], 0xE67E22)
  );
}

function buildCloneResult(data = {}) {
  const { success = false, cancelled = false, error = null, sourceGuildName = "?", targetGuildName = "?", rolesCloned = 0, channelsCloned = 0, emojisCloned = 0, duration = 0, logs = "" } = data;
  let accentColor, statusLine;
  if (cancelled) {
    accentColor = 0x95A5A6;
    statusLine  = `\`🛑\` **Clonage annulé**\n> *L'opération a été interrompue manuellement.*`;
  } else if (success) {
    accentColor = 0x2ECC71;
    statusLine  = `\`✅\` **Clonage terminé en \`${duration}s\` !**\n\n### Résultats\n> \`🎭\` Rôles clonés     : **${rolesCloned}**\n> \`💬\` Salons clonés    : **${channelsCloned}**\n> \`😀\` Emojis clonés    : **${emojisCloned}**\n> \`⏱️\` Durée totale     : **${duration}s**`;
  } else {
    accentColor = 0xE74C3C;
    statusLine  = `\`❌\` **Erreur lors du clonage**\n> ${error ?? "Erreur inconnue."}`;
  }
  const logsSection = logs ? `\n### Derniers logs\n\`\`\`\n${logs}\n\`\`\`` : "";

  return replyV2(
    container([
      textDisplay(`# 🔁 Clone — Résultat\n\n### Serveurs\n> \`📤\` **Source :** ${sourceGuildName}\n> \`📥\` **Cible :**  ${targetGuildName}\n\n${statusLine}${logsSection}`),
      separator(),
      actionRow([
        btn("🔁  Nouveau clone", "panel:clone",    ButtonStyle.Primary),
        btn("📜  Historique",     "clone:history", ButtonStyle.Secondary),
        btn("◀️  Clone",          "panel:clone", ButtonStyle.Secondary),
        btn("🏠  Accueil",        "panel:home",    ButtonStyle.Secondary),
      ]),
    ], accentColor)
  );
}

function buildCloneHistory(data = {}) {
  const { history = [] } = data;
  const list = history.length
    ? [...history].reverse().map(entry => {
        let emoji, detail;
        if (entry.cancelled) { emoji = "🛑"; detail = `*Annulé manuellement*`; }
        else if (entry.success) { emoji = "✅"; detail = `🎭 ${entry.rolesCloned ?? 0}  ·  💬 ${entry.channelsCloned ?? 0}  ·  😀 ${entry.emojisCloned ?? 0}  ·  ⏱️ ${entry.duration ?? 0}s`; }
        else { emoji = "❌"; detail = `⚠️ ${entry.error ?? "Erreur"}`; }
        return `${emoji} **${entry.sourceGuildName ?? entry.sourceGuildId}** → **${entry.targetGuildName ?? entry.targetGuildId}**\n> 🕐 ${new Date(entry.timestamp).toLocaleString("fr-FR")}\n> ${detail}`;
      }).join("\n\n")
    : "*Aucun clonage effectué.*";

  return replyV2(
    container([
      textDisplay(`# 📜 Historique des clonages\n-# ${history.length} entrée(s) enregistrée(s).\n\n${list}`),
      separator(),
      actionRow([btn("🗑️  Effacer l'historique", "clone:clearHistory", ButtonStyle.Danger)]),
      separator(),
      navRow("panel:clone", "Clone"),
    ], 0xE67E22)
  );
}

function buildCloneGuildList(data = {}) {
  const { guilds = [] } = data;
  const list = guilds.length
    ? guilds.map((g, i) => `\`${i + 1}.\` **${g.name}** — \`${g.id}\``).join("\n")
    : "*Aucun serveur trouvé.*";

  return replyV2(
    container([
      textDisplay(`# 🗂️ Serveurs disponibles\n-# Utilise ces IDs pour configurer la source et la cible.\n\n${list}`),
      separator(),
      navRow("panel:clone", "Clone"),
    ], 0xE67E22)
  );
}

module.exports = {
  buildClone,
  buildCloneRunning,
  buildCloneResult,
  buildCloneHistory,
  buildCloneGuildList,
};
