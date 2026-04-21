// Basé sur ce projet :
// https://github.com/aiko-chan-ai/Discord-Quest-Auto-Completion-Selfbot
// Merci à aiko-chan....et à Claude !

"use strict";

const { ButtonStyle } = require("discord.js");
const { container, textDisplay, separator, actionRow, btn, navRow, replyV2 } = require("../utils/components");

// ── Panel principal ───────────────────────────────────────────────────────────

function build(data = {}) {
  const {
    quests       = [],
    stats        = {},
    blockedUntil = null,
    config       = {},
  } = data;

  const { total = 0, todo = 0, enroll = 0, completed = 0 } = stats;
  const enabled     = config.enabled     ?? false;
  const intervalMin = config.intervalMin ?? 360;

  let questList;
  if (!quests.length) {
    questList = "*Aucune quête active en ce moment.*";
  } else {
    questList = quests.map(q => {
      const statusEmoji = q.completed ? "`✅`" : q.enrolled ? "`⏳`" : "`📋`";
      const expiry      = new Date(q.expiresAt).toLocaleDateString("fr-FR");

      let progressStr = "";
      if (!q.completed && q.taskName && q.progress[q.taskName]) {
        const p = q.progress[q.taskName];
        progressStr = ` — \`${Math.floor(p.value)}s\``;
      }

      return `${statusEmoji} **${q.name}** (${q.game})${progressStr}\n> ↳ Tâche: \`${q.taskName ?? "?"}\` — expire le ${expiry}`;
    }).join("\n\n");
  }

  const blockedLine = blockedUntil
    ? `\n⚠️ **Inscription bloquée jusqu'au** <t:${Math.floor(new Date(blockedUntil).getTime() / 1000)}:f>`
    : "";

  const autoLine =
    `${enabled ? "`🟢`" : "`🔴`"} **Complétion auto :** ${enabled ? `Activée — toutes les \`${intervalMin} min\`` : "Désactivée"}`;

  return replyV2(
    container([
      textDisplay(
        `# 🏆 Discord Quests\n` +
        `${autoLine}\n` +
        `\`📊\` **${total}** quête(s) active(s) — \`✅\` ${completed} complétée(s) — \`⏳\` ${todo} à faire — \`📋\` ${enroll} à inscrire${blockedLine}\n\n` +
        `**Quêtes :**\n${questList}`
      ),
      separator(),
      actionRow([
        btn(
          enabled ? "🔴  Désactiver auto" : "🟢  Activer auto",
          "quests:toggle",
          enabled ? ButtonStyle.Danger : ButtonStyle.Success
        ),
        btn("⏱️  Intervalle",      "quests:setInterval", ButtonStyle.Secondary),
        btn("🔄  Actualiser",      "quests:refresh",     ButtonStyle.Primary),
      ]),
      separator(),
      actionRow([
        btn("▶️  Compléter maintenant", "quests:run",     ButtonStyle.Success),
        btn("📜  Historique",           "quests:history", ButtonStyle.Secondary),
      ]),
      separator(),
      navRow(null, null, true),
    ], 0x5865F2)
  );
}

// ── Panel "en cours" ──────────────────────────────────────────────────────────

function buildRunning() {
  return replyV2(
    container([
      textDisplay(
        `# 🏆 Discord Quests\n` +
        `\`⏳\` **Complétion en cours…**\n\n` +
        `*Les quêtes sont traitées une par une. Les logs apparaissent dans tes messages privés.*`
      ),
      separator(),
      actionRow([
        btn("🏠  Accueil", "panel:home", ButtonStyle.Secondary),
      ]),
    ], 0x5865F2)
  );
}

// ── Panel historique ──────────────────────────────────────────────────────────

function buildHistory(data = {}) {
  const { history = [] } = data;

  const list = history.length
    ? history.slice(-15).reverse().map((entry) => {
        const emoji = entry.success ? "✅" : "❌";
        const time  = new Date(entry.timestamp).toLocaleString("fr-FR");
        const error = entry.success ? "" : `\n> ⚠️ *${entry.error}*`;
        return `${emoji} **${entry.questName}** — \`${entry.taskName ?? "?"}\`\n> ${time}${error}`;
      }).join("\n\n")
    : "*Aucun historique de quêtes.*";

  return replyV2(
    container([
      textDisplay(
        `# 📜 Historique Quests\n` +
        `**Dernières tentatives (${history.length} total) :**\n\n${list}`
      ),
      separator(),
      actionRow([
        btn("🗑️  Effacer l'historique", "quests:clearHistory", ButtonStyle.Danger),
      ]),
      separator(),
      navRow("panel:quests", "Quests"),
    ], 0x5865F2)
  );
}

module.exports = { build, buildRunning, buildHistory };