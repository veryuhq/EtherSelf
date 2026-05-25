"use strict";

const { ButtonStyle } = require("discord.js");
const { container, textDisplay, separator, actionRow, btn, navRow, replyV2 } = require("../utils/components");

// ── Vue principale ────────────────────────────────────────────────────────────

function build(data = {}) {
  const { deleted = null, pending = false, scope = null } = data;

  let status;
  if (pending) {
    const scopeLabel =
      scope === "dms"    ? "tous les DMs" :
      scope === "guilds" ? "tous les serveurs" :
      scope === "guild"  ? "ce serveur" :
      "ce salon";
    status =
      `\`⏳\` **Purge de ${scopeLabel} en cours…**\n` +
      `*Les messages sont supprimés un par un. Le panel se mettra à jour automatiquement.*`;
  } else if (deleted !== null) {
    const scopeLabel =
      scope === "dms"    ? "des DMs" :
      scope === "guilds" ? "des serveurs" :
      scope === "guild"  ? "du serveur" :
      "du salon";
    status = `\`✅\` **${deleted}** message(s) supprimé(s) ${scopeLabel}.`;
  } else {
    status = "*Supprime tes propres messages dans un salon, un serveur, tous tes DMs, ou tous tes serveurs.*";
  }

  return replyV2(
    container([
      textDisplay(`# 🗑️ Purge\n${status}`),
      separator(),
      actionRow([
        btn("🗑️  Purger un salon",     "purge:confirm:channel", ButtonStyle.Danger),
        btn("🏠  Purger un serveur",   "purge:confirm:guild",   ButtonStyle.Danger),
      ]),
      actionRow([
        btn("💬  Purger tous les DMs", "purge:confirm:dms",     ButtonStyle.Danger),
        btn("🌐  Purger les serveurs", "purge:confirm:guilds",  ButtonStyle.Danger),
      ]),
      separator(),
      navRow(null, null, true),
    ], 0xE74C3C)
  );
}

// ── Vue confirmation ──────────────────────────────────────────────────────────

/**
 * @param {{ scope: "channel"|"guild"|"dms"|"guilds", channelId?: string, guildId?: string }} data
 */
function buildConfirm(data = {}) {
  const { scope, channelId = null, guildId = null, guildName = null, amount = null } = data;

  const SCOPE_LABELS = {
    channel: "ce salon",
    guild:   "ce serveur",
    dms:     "tous tes DMs",
    guilds:  "tous tes serveurs",
  };

  const SCOPE_WARNINGS = {
    channel: channelId
      ? `Le salon <#${channelId}> sera entièrement vidé de tes messages.`
      : "Tous tes messages dans le salon sélectionné seront supprimés.",
    guild: guildName
      ? `Tous tes messages dans le serveur **${guildName}** (tous les salons accessibles) seront supprimés.`
      : guildId
        ? `Tous tes messages dans le serveur \`${guildId}\` (tous les salons accessibles) seront supprimés.`
        : "Tous tes messages dans le serveur sélectionné seront supprimés.",
    dms:    "Tous tes messages dans **chaque DM** seront supprimés. Cette action est irréversible.",
    guilds: "Tous tes messages dans **chaque serveur** (chaque salon accessible) seront supprimés. Cette action est **très longue** et irréversible.",
  };

  const label    = SCOPE_LABELS[scope]   ?? scope;
  const warning  = SCOPE_WARNINGS[scope] ?? "Cette action est irréversible.";

  let confirmId;
  if (scope === "channel" && channelId) {
    confirmId = `purge:run:channel:${channelId}:${amount ?? 0}`;
  } else if (scope === "guild" && guildId) {
    confirmId = `purge:run:guild:${guildId}`;
  } else if (scope === "dms") {
    confirmId = `purge:run:dms`;
  } else if (scope === "guilds") {
    confirmId = `purge:run:guilds`;
  } else {
    confirmId = `purge:ask:${scope}`;
  }

  return replyV2(
    container([
      textDisplay(
        `# ⚠️ Confirmation — Purge ${label}\n\n` +
        `${warning}\n\n` +
        `-# Es-tu sûr(e) de vouloir continuer ? Cette action **ne peut pas être annulée** une fois démarrée (sauf via le bouton d'arrêt).`
      ),
      separator(),
      actionRow([
        btn("✅  Confirmer et lancer",  confirmId,      ButtonStyle.Danger),
        btn("❌  Annuler",              "panel:purge",  ButtonStyle.Secondary),
      ]),
    ], 0xE74C3C)
  );
}

// ── Vue progression temps réel ────────────────────────────────────────────────

/**
 * @param {{
 *   scope:       "channel"|"dms"|"guilds"|"guild",
 *   guildName?:  string|null,
 *   queue:       Array<{ id: string, label: string }>,
 *   activeLabel: string|null,
 *   doneCount:   number,
 *   total:       number,
 *   totalDeleted: number,
 *   done:        boolean,
 *   cancelled:   boolean,
 *   jobId?:      string,
 * }} data
 */
function buildProgress(data = {}) {
  const {
    scope        = "dms",
    guildName    = null,
    queue        = [],
    activeLabel  = null,
    doneCount    = 0,
    total        = 0,
    totalDeleted = 0,
    done         = false,
    cancelled    = false,
    jobId        = null,
  } = data;

  const SCOPE_ICONS = {
    channel: "🗑️",
    dms:     "💬",
    guilds:  "🌐",
    guild:   "🏠",
  };
  const SCOPE_TITLES = {
    channel: "Purge du salon",
    dms:     "Purge des DMs",
    guilds:  "Purge des serveurs",
    guild:   guildName ? `Purge de ${guildName}` : "Purge du serveur",
  };

  const icon  = SCOPE_ICONS[scope]  ?? "🗑️";
  const title = SCOPE_TITLES[scope] ?? "Purge";

  // Barre de progression
  const BAR_LEN = 10;
  const filled  = total > 0 ? Math.round((doneCount / total) * BAR_LEN) : (done ? BAR_LEN : 0);
  const bar     = "█".repeat(filled) + "░".repeat(BAR_LEN - filled);
  const progressLine = `\`${bar}\` **${doneCount}/${total}** — \`${totalDeleted}\` msg supprimé(s)`;

  // Corps de la liste
  const lines = [];

  if (!done) {
    if (activeLabel) {
      lines.push(`⏳ **${activeLabel}**`);
    }

    const DISPLAY_LIMIT = 12;
    const displayed = queue.slice(0, DISPLAY_LIMIT);
    const hidden    = queue.length - displayed.length;

    for (const item of displayed) {
      lines.push(`⬜ ${item.label}`);
    }

    if (hidden > 0) {
      lines.push(`*… et ${hidden} autre(s)*`);
    }
  }

  const listText = lines.length ? lines.join("\n") : "";

  let header;
  if (done && cancelled) {
    header = `\`🛑\` **Arrêté !** \`${totalDeleted}\` message(s) supprimé(s) avant l'arrêt.`;
  } else if (done) {
    // total === 0 = tous les canaux skippés (aucun message à supprimer)
    if (total === 0) {
      header = `\`✅\` **Terminé !** Aucun message à supprimer.`;
    } else {
      const scopeUnit =
        scope === "dms"    ? "DM(s)" :
        scope === "guilds" ? "serveur(s)" :
        scope === "guild"  ? "salon(s)" :
        "salon(s)";
      header = `\`✅\` **Terminé !** \`${totalDeleted}\` message(s) supprimé(s) sur **${total}** ${scopeUnit}.`;
    }
  } else if (activeLabel) {
    header = `\`⏳\` **En cours…**`;
  } else if (total === 0) {
    header = `\`🔄\` **Démarrage…**`;
  } else {
    header = `\`🔄\` **Démarrage…**`;
  }

  const body = listText
    ? `${header}\n\n${progressLine}\n\n${listText}`
    : `${header}\n\n${progressLine}`;

  const buttons = [];
  if (done) {
    buttons.push(btn("◀️  Retour Purge", "panel:purge", ButtonStyle.Secondary));
    buttons.push(btn("🏠  Accueil",      "panel:home",  ButtonStyle.Secondary));
  } else {
    if (jobId) {
      buttons.push(btn("🛑  Arrêter",  `purge:cancel:${jobId}`, ButtonStyle.Danger));
    }
    buttons.push(btn("🏠  Accueil", "panel:home", ButtonStyle.Secondary));
  }

  return replyV2(
    container([
      textDisplay(`# ${icon} ${title}\n${body}`),
      separator(),
      actionRow(buttons),
    ], 0xE74C3C)
  );
}

module.exports = { build, buildConfirm, buildProgress };