// Basé sur ce projet :
// https://github.com/aiko-chan-ai/Discord-Quest-Auto-Completion-Selfbot
// Merci à aiko-chan....et à Claude !

import { ButtonStyle } from "discord.js";
import { container, textDisplay, separator, actionRow, btn, selectMenu, navRow, replyV2, type V2MessagePayload } from "../utils/components";

export interface Quest {
  name: string;
  game: string;
  completed?: boolean;
  enrolled?: boolean;
  taskName?: string | null;
  expiresAt?: string | number;
  progress?: Record<string, { value: number }>;
}

export interface QuestsData {
  quests?: Quest[];
  stats?: { total?: number; todo?: number; enroll?: number; completed?: number; excluded?: number };
  blockedUntil?: string | number | null;
  config?: { enabled?: boolean; intervalMin?: number };
}

export interface QuestHistoryEntry {
  success?: boolean;
  questName?: string;
  taskName?: string | null;
  timestamp?: string | number;
  error?: string;
}

export interface QuestsHistoryData {
  history?: QuestHistoryEntry[];
}

// ── Panel principal ───────────────────────────────────────────────────────────

export function build(data: QuestsData = {}): V2MessagePayload {
  const {
    quests       = [],
    stats        = {},
    blockedUntil = null,
    config       = {},
  } = data;

  const { total = 0, todo = 0, enroll = 0, completed = 0, excluded = 0 } = stats;
  const enabled     = config.enabled     ?? false;
  const intervalMin = config.intervalMin ?? 360;

  let questList: string;
  if (!quests.length) {
    questList = excluded
      ? "*Aucune quête disponible : Discord n'en distribue que des inéligibles pour ce compte.*"
      : "*Aucune quête active en ce moment.*";
  } else {
    questList = quests.map((q) => {
      const statusEmoji = q.completed ? "`✅`" : q.enrolled ? "`⏳`" : "`📋`";
      const expiry      = new Date(q.expiresAt ?? 0).toLocaleDateString("fr-FR");

      let progressStr = "";
      const progress = q.taskName ? q.progress?.[q.taskName] : undefined;
      if (!q.completed && progress) {
        progressStr = ` — \`${Math.floor(progress.value)}s\``;
      }

      return `${statusEmoji} **${q.name}** (${q.game})${progressStr}\n> ↳ Tâche: \`${q.taskName ?? "?"}\` — expire le ${expiry}`;
    }).join("\n\n");
  }

  const excludedLine = excluded
    ? `\n\`🚫\` **${excluded}** quête(s) distribuée(s) mais inéligible(s) pour ce compte`
    : "";

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
        `\`📊\` **${total}** quête(s) active(s) — \`✅\` ${completed} complétée(s) — \`⏳\` ${todo} à faire — \`📋\` ${enroll} à inscrire${excludedLine}${blockedLine}\n\n` +
        `**Quêtes :**\n${questList}`
      ),
      separator(),
      actionRow([
        btn(
          enabled ? "🔴  Désactiver auto" : "🟢  Activer auto",
          "quests:toggle",
          enabled ? ButtonStyle.Danger : ButtonStyle.Success
        ),
      ]),
      separator(1, false),
      selectMenu("menu:quests", "📋  Choisis une action…", [
        { label: "⏱️  Intervalle",           value: "quests:setInterval", description: "Régler l'intervalle de complétion auto" },
        { label: "🔄  Actualiser",           value: "quests:refresh",     description: "Rafraîchir la liste des quêtes" },
        { label: "▶️  Compléter maintenant", value: "quests:run",         description: "Lancer la complétion des quêtes" },
        { label: "📜  Historique",           value: "quests:history",     description: "Voir l'historique des complétions" },
      ]),
      separator(),
      navRow(null, null, true),
    ], 0x5865F2)
  );
}

// ── Panel "en cours" ──────────────────────────────────────────────────────────

export function buildRunning(): V2MessagePayload {
  return replyV2(
    container([
      textDisplay(
        `# 🏆 Discord Quests\n` +
        `\`⏳\` **Complétion en cours…**\n\n` +
        `*Les quêtes sont traitées une par une. Les logs apparaissent dans tes messages privés.*`
      ),
      separator(),
      navRow(null, null, true),
    ], 0x5865F2)
  );
}

// ── Panel historique ──────────────────────────────────────────────────────────

export function buildHistory(data: QuestsHistoryData = {}): V2MessagePayload {
  const { history = [] } = data;

  const list = history.length
    ? history.slice(-15).reverse().map((entry) => {
        const emoji = entry.success ? "✅" : "❌";
        const time  = new Date(entry.timestamp ?? 0).toLocaleString("fr-FR");
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
