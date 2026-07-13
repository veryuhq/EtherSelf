"use strict";

const { ButtonStyle } = require("discord.js");
const { container, textDisplay, separator, actionRow, btn, selectMenu, logLines, navRow, replyV2 } = require("../utils/components");

// ─────────────────────────────────────────────────────────────────────────────
//  HUB BACKUPS
// ─────────────────────────────────────────────────────────────────────────────

function build(data = {}) {
  const { friendsCount = null, friendsSavedAt = null, guildsCount = null, guildsSavedAt = null } = data;

  const fLine = friendsSavedAt
    ? `\`✅\` **${friendsCount ?? "?"}** ami(s) — sauvegardé le ${new Date(friendsSavedAt).toLocaleString("fr-FR")}`
    : "`📭` *Aucun backup d'amis enregistré*";

  const gLine = guildsSavedAt
    ? `\`✅\` **${guildsCount ?? "?"}** serveur(s) — sauvegardé le ${new Date(guildsSavedAt).toLocaleString("fr-FR")}`
    : "`📭` *Aucun backup de serveurs enregistré*";

  return replyV2(
    container([
      textDisplay(
        `# 💾 Backups & Clone\n\n` +
        `### 👥 Amis\n> ${fLine}\n\n` +
        `### 🏠 Serveurs\n> ${gLine}`
      ),
      separator(),
      actionRow([
        btn("👥  Backup amis",        "backups:friends",     ButtonStyle.Primary),
        btn("🏠  Backup serveurs",    "backups:guilds",      ButtonStyle.Primary),
        btn("🔁  Cloner un serveur",  "backups:clone",       ButtonStyle.Secondary),
      ]),
      separator(),
      navRow(null, null, true),
    ], 0x3498DB)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  AMIS
// ─────────────────────────────────────────────────────────────────────────────

function buildFriends(data = {}) {
  // Normalise : null → []
  const friends   = Array.isArray(data.friends) ? data.friends : [];
  const savedAt   = data.savedAt   ?? null;
  const count     = data.count     ?? friends.length;
  const _loading  = data._loading  ?? false;

  const PAGE_SIZE  = 15;
  const page       = data.page ?? 0;
  const totalPages = Math.max(1, Math.ceil(friends.length / PAGE_SIZE));
  const slice      = friends.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const list = _loading
    ? "*⏳ Récupération de la liste d'amis en cours…*"
    : slice.length
    ? slice.map((f, i) => {
        const num = page * PAGE_SIZE + i + 1;
        const since = f.since ? ` — *depuis ${new Date(f.since).toLocaleDateString("fr-FR")}*` : "";
        const display = f.globalName && f.globalName !== f.username
          ? `**${f.globalName}** (${f.tag})`
          : `**${f.tag}**`;
        return `\`${num}.\` ${display}${since}`;
      }).join("\n")
    : "*Aucun ami trouvé. Clique sur \"Actualiser backup\" pour récupérer ta liste d'amis.*";

  const savedLine = _loading
    ? "*Actualisation en cours…*"
    : savedAt
    ? `*Backup du ${new Date(savedAt).toLocaleString("fr-FR")} — ${count} ami(s)*`
    : "*Aucun backup enregistré — clique sur \"Actualiser backup\" pour en créer un*";

  return replyV2(
    container([
      textDisplay(
        `# 👥 Backup Amis\n${savedLine}\n\n${list}` +
        (!_loading && friends.length > PAGE_SIZE ? `\n\n*Page ${page + 1}/${totalPages}*` : "")
      ),
      separator(),
      actionRow([
        btn("⬅️", `backups:friends_page:${page - 1}`, ButtonStyle.Secondary, null, page === 0 || _loading),
        btn("➡️", `backups:friends_page:${page + 1}`, ButtonStyle.Secondary, null, page >= totalPages - 1 || _loading),
        btn("🔄  Actualiser backup", "backups:friends_refresh", ButtonStyle.Success, null, _loading),
        btn("🗑️  Supprimer backup",  "backups:friends_clear",   ButtonStyle.Danger,  null, _loading || !savedAt),
      ]),
      separator(),
      navRow("panel:backups", "Backups"),
    ], 0x3498DB)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  SERVEURS
// ─────────────────────────────────────────────────────────────────────────────

function buildGuilds(data = {}) {
  // Normalise : null → []
  const guilds    = Array.isArray(data.guilds) ? data.guilds : [];
  const savedAt   = data.savedAt  ?? null;
  const count     = data.count    ?? guilds.length;
  const _loading  = data._loading ?? false;

  const PAGE_SIZE  = 8;
  const page       = data.page ?? 0;
  const totalPages = Math.max(1, Math.ceil(guilds.length / PAGE_SIZE));
  const slice      = guilds.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const list = _loading
    ? "*⏳ Génération des invitations permanentes en cours…*"
    : slice.length
    ? slice.map((g, i) => {
        const num = page * PAGE_SIZE + i + 1;
        const owner = g.isOwner ? " 👑" : "";
        const inviteLine = g.invite
          ? `\n> 🔗 ${g.invite}`
          : `\n> 🔗 *aucune invitation*`;
        return `\`${num}.\` **${g.name}**${owner} — \`${g.id}\`${inviteLine}`;
      }).join("\n\n")
    : "*Aucun serveur trouvé. Clique sur \"Actualiser backup\" pour en créer un.*";

  const savedLine = _loading
    ? "*Actualisation en cours…*"
    : savedAt
    ? `*Backup du ${new Date(savedAt).toLocaleString("fr-FR")} — ${count} serveur(s)*`
    : "*Aucun backup enregistré — clique \"Actualiser backup\" pour générer les invitations permanentes*";

  return replyV2(
    container([
      textDisplay(
        `# 🏠 Backup Serveurs\n${savedLine}\n\n${list}` +
        (!_loading && guilds.length > PAGE_SIZE ? `\n\n*Page ${page + 1}/${totalPages}*` : "")
      ),
      separator(),
      actionRow([
        btn("⬅️", `backups:guilds_page:${page - 1}`, ButtonStyle.Secondary, null, page === 0 || _loading),
        btn("➡️", `backups:guilds_page:${page + 1}`, ButtonStyle.Secondary, null, page >= totalPages - 1 || _loading),
        btn("🔄  Actualiser backup", "backups:guilds_refresh", ButtonStyle.Success, null, _loading),
        btn("🗑️  Supprimer backup",  "backups:guilds_clear",   ButtonStyle.Danger,  null, _loading || !savedAt),
      ]),
      separator(),
      navRow("panel:backups", "Backups"),
    ], 0x3498DB)
  );
}

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

  const cloneActions = [
    { label: "📤  Source",    value: "clone:setSource",  description: "Définir le serveur source (à copier)" },
    { label: "📥  Cible",     value: "clone:setTarget",  description: "Définir le serveur cible (à modifier)" },
    { label: "🗂️  Serveurs",  value: "clone:listGuilds", description: "Lister tes serveurs" },
  ];
  if (canRun) {
    cloneActions.push({ label: "▶️  Lancer le clonage", value: "clone:run", description: "Démarrer le clonage" });
  }
  cloneActions.push({ label: "📜  Historique", value: "clone:history", description: "Voir l'historique des clonages" });

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
        btn(cloneRoles    ? "🎭  Rôles ✅"   : "🎭  Rôles ❌",   "clone:toggleRoles",    cloneRoles    ? ButtonStyle.Success : ButtonStyle.Secondary),
        btn(cloneChannels ? "💬  Salons ✅"  : "💬  Salons ❌",  "clone:toggleChannels", cloneChannels ? ButtonStyle.Success : ButtonStyle.Secondary),
        btn(cloneEmojis   ? "😀  Emojis ✅"  : "😀  Emojis ❌",  "clone:toggleEmojis",   cloneEmojis   ? ButtonStyle.Success : ButtonStyle.Secondary),
        btn(cloneSettings ? "⚙️  Params ✅"  : "⚙️  Params ❌", "clone:toggleSettings", cloneSettings ? ButtonStyle.Success : ButtonStyle.Secondary),
      ]),
      separator(1, false),
      selectMenu("menu:clone", "📋  Choisis une action…", cloneActions),
      separator(),
      navRow("panel:backups", "Backups"),
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
  const logsSection = logs ? `\n### Logs\n${logLines(logs)}` : "";

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
    statusLine  =
      `\`✅\` **Clonage terminé en \`${duration}s\` !**\n\n` +
      `### Résultats\n` +
      `> \`🎭\` Rôles clonés     : **${rolesCloned}**\n` +
      `> \`💬\` Salons clonés    : **${channelsCloned}**\n` +
      `> \`😀\` Emojis clonés    : **${emojisCloned}**\n` +
      `> \`⏱️\` Durée totale     : **${duration}s**`;
  } else {
    accentColor = 0xE74C3C;
    statusLine  = `\`❌\` **Erreur lors du clonage**\n> ${error ?? "Erreur inconnue."}`;
  }
  const logsSection = logs ? `\n### Derniers logs\n${logLines(logs)}` : "";

  return replyV2(
    container([
      textDisplay(`# 🔁 Clone — Résultat\n\n### Serveurs\n> \`📤\` **Source :** ${sourceGuildName}\n> \`📥\` **Cible :**  ${targetGuildName}\n\n${statusLine}${logsSection}`),
      separator(),
      actionRow([
        btn("🔁  Nouveau clone", "backups:clone",  ButtonStyle.Primary),
        btn("📜  Historique",    "clone:history",  ButtonStyle.Secondary),
        btn("◀️  Backups",       "panel:backups",  ButtonStyle.Secondary),
        btn("🏠  Accueil",       "panel:home",     ButtonStyle.Secondary),
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
      navRow("backups:clone", "Clone"),
    ], 0xE67E22)
  );
}

function buildCloneGuildList(data = {}) {
  const { guilds = [] } = data;
  const list = guilds.length
    ? guilds.map((g, i) => {
        const owner = g.isOwner ? " 👑" : "";
        return `\`${i + 1}.\` **${g.name}**${owner} — \`${g.id}\``;
      }).join("\n")
    : "*Aucun serveur trouvé.*";

  return replyV2(
    container([
      textDisplay(`# 🗂️ Serveurs disponibles\n-# Utilise ces IDs pour configurer la source et la cible.\n\n${list}`),
      separator(),
      navRow("backups:clone", "Clone"),
    ], 0xE67E22)
  );
}

module.exports = {
  build,
  buildFriends,
  buildGuilds,
  buildClone,
  buildCloneRunning,
  buildCloneResult,
  buildCloneHistory,
  buildCloneGuildList,
};