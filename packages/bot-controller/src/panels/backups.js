"use strict";

const { ButtonStyle, MessageFlags, FileBuilder } = require("discord.js");
const { container, textDisplay, separator, actionRow, btn, navRow, replyV2 } = require("../utils/components");

// ─────────────────────────────────────────────────────────────────────────────
//  HUB
// ─────────────────────────────────────────────────────────────────────────────

function buildHub() {
  return replyV2(
    container([
      textDisplay(`# 💾 Backups\n*QuestionHub : que voulez-vous sauvegarder ?*`),
      separator(),
      actionRow([
        btn("👥  Backup Friends",    "panel:backupfriends", ButtonStyle.Primary),
        btn("🏰  Backup Servers",    "panel:backupservers", ButtonStyle.Primary),
      ]),
      separator(1, false),
      actionRow([
        btn("🔁  Clone de serveur", "panel:clone",         ButtonStyle.Secondary),
        btn("🎞️  GIFs favoris",     "panel:backupgifs",    ButtonStyle.Secondary),
        btn("🏠  Accueil",          "panel:home",       ButtonStyle.Secondary),
      ]),
    ], 0x2ECC71)
  );
}

function buildFriends(data = {}) {
  const latest = data.latest ?? null;
  const lastRestore = data.lastRestore ?? null;
  const list = latest?.friends ?? [];
  const preview = list.length
    ? list.slice(0, 8).map((f, i) => `\`${i + 1}.\` **${f.username}** · \`${f.id}\` · *${f.displayName ?? "N/A"}*`).join("\n")
    : "*Aucun ami sauvegardé.*";

  return replyV2(
    container([
      textDisplay(
        `# 👥 Backup Friends\n` +
        `\`📦\` **Amis sauvegardés :** ${latest?.total ?? 0}\n` +
        `\`🕐\` **Dernière sauvegarde :** ${latest ? new Date(latest.timestamp).toLocaleString("fr-FR") : "*Jamais*"}\n` +
        `\`🔄\` **Dernière restauration :** ${lastRestore ? `${lastRestore.restored}/${lastRestore.total} (${lastRestore.failed} échec(s))` : "*Jamais*"}\n\n` +
        `### Aperçu\n${preview}\n\n` +
        `-# Source: API Discord, fallback cache local / backup précédent.`
      ),
      separator(),
      actionRow([
        btn("💾  Sauvegarder", "backups:friends:backup", ButtonStyle.Success),
        btn("♻️  Restaurer",   "backups:friends:restore", ButtonStyle.Primary, null, !list.length),
      ]),
      separator(),
      actionRow([
        btn("◀️  Retour Backups", "panel:backups", ButtonStyle.Secondary),
        btn("🏠  Accueil",        "panel:home", ButtonStyle.Secondary),
      ]),
    ], 0x3498DB)
  );
}

function buildServers(data = {}) {
  const latest = data.latest ?? null;
  const lastRestore = data.lastRestore ?? null;
  const list = latest?.servers ?? [];
  const preview = list.length
    ? list.slice(0, 8).map((s, i) => {
      const inv = s.inviteUrl ? s.inviteUrl : "*Aucune invite*";
      return `\`${i + 1}.\` **${s.name}** · ${inv}`;
    }).join("\n")
    : "*Aucun serveur sauvegardé.*";

  return replyV2(
    container([
      textDisplay(
        `# 🏰 Backup Servers\n` +
        `\`📦\` **Serveurs sauvegardés :** ${latest?.total ?? 0}\n` +
        `\`🔗\` **Invites permanentes :** ${latest?.withInvite ?? 0}\n` +
        `\`🕐\` **Dernière sauvegarde :** ${latest ? new Date(latest.timestamp).toLocaleString("fr-FR") : "*Jamais*"}\n` +
        `\`🔄\` **Dernière restauration :** ${lastRestore ? `${lastRestore.restored}/${lastRestore.total} (${lastRestore.failed} échec(s))` : "*Jamais*"}\n\n` +
        `### Aperçu\n${preview}`
      ),
      separator(),
      actionRow([
        btn("💾  Sauvegarder", "backups:servers:backup", ButtonStyle.Success),
        btn("♻️  Restaurer",   "backups:servers:restore", ButtonStyle.Primary, null, !list.length),
      ]),
      separator(),
      actionRow([
        btn("◀️  Retour Backups", "panel:backups", ButtonStyle.Secondary),
        btn("🏠  Accueil",        "panel:home", ButtonStyle.Secondary),
      ]),
    ], 0x9B59B6)
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
        btn("◀️  Retour Backups", "panel:backups", ButtonStyle.Secondary),
        btn("🏠  Accueil",        "panel:home",    ButtonStyle.Secondary),
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
        btn("◀️  Backups",        "panel:backups", ButtonStyle.Secondary),
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

// ─────────────────────────────────────────────────────────────────────────────
//  BACKUP GIFs
// ─────────────────────────────────────────────────────────────────────────────

function buildGifs(data = {}) {
  const { totalSaved = 0, lastBackup = null, gifs = [], lastZip = null, lastZipOk = null, lastZipFail = null } = data;

  const lastBackupStr = lastBackup
    ? `Le **${new Date(lastBackup).toLocaleString("fr-FR")}**`
    : "*Jamais effectué*";

  let zipLine = "";
  if (lastZip) {
    const failStr = (lastZipFail ?? 0) > 0 ? `, ${lastZipFail} échec(s)` : "";
    zipLine = `\`📦\` **Dernier ZIP :** \`${lastZip}\` *(${lastZipOk ?? 0} fichier(s)${failStr})*\n`;
  }

  const preview = gifs.length
    ? gifs.slice(0, 5).map((g, i) => {
        const url  = g.src ?? "?";
        const dims = (g.width && g.height) ? ` *(${g.width}×${g.height})*` : "";
        return `\`${i + 1}.\` ${url.slice(0, 80)}${url.length > 80 ? "…" : ""}${dims}`;
      }).join("\n") + (gifs.length > 5 ? `\n*… et ${gifs.length - 5} autre(s)*` : "")
    : "*Aucun GIF sauvegardé pour l'instant.*";

  return replyV2(
    container([
      textDisplay(
        `# 🎞️ Backup GIFs favoris\n` +
        `\`📦\` **GIFs sauvegardés :** ${totalSaved}\n` +
        `\`🕐\` **Dernier backup :** ${lastBackupStr}\n` +
        zipLine +
        `\n**Aperçu :**\n${preview}\n\n` +
        `-# Les GIFs sont récupérés via l'API Discord (settings-proto/2) et téléchargés dans un ZIP envoyé en DM.`
      ),
      separator(),
      actionRow([
        btn("🔄  Lancer le backup",   "backupgifs:backup", ButtonStyle.Success),
        btn("📋  Voir tous les GIFs",  "backupgifs:list",   ButtonStyle.Primary,   null, totalSaved === 0),
        btn("🗑️  Effacer",            "backupgifs:clear",  ButtonStyle.Danger,    null, totalSaved === 0),
      ]),
      separator(),
      actionRow([
        btn("◀️  Retour Backups", "panel:backups", ButtonStyle.Secondary),
        btn("🏠  Accueil",        "panel:home",    ButtonStyle.Secondary),
      ]),
    ], 0x2ECC71)
  );
}

/**
 * Panel "en cours" affiché pendant le backup asynchrone.
 */
function buildGifsRunning() {
  return replyV2(
    container([
      textDisplay(
        `# 🎞️ Backup GIFs en cours…\n` +
        `\`⏳\` **Récupération et téléchargement des GIFs…**\n\n` +
        `*Les GIFs sont récupérés depuis l'API Discord, téléchargés puis compressés dans un ZIP.*\n` +
        `*Le ZIP sera joint directement dans ce message une fois terminé.*`
      ),
      separator(),
      actionRow([btn("🏠  Accueil", "panel:home", ButtonStyle.Secondary)]),
    ], 0x2ECC71)
  );
}

/**
 * Réponse finale avec le ZIP attaché en Components V2 FileBuilder.
 * Appelée depuis index.js via /backupgifs-result avec l'attachment.
 *
 * @param {{ totalGifs: number, zipOk: number, zipFail: number, zipFilename: string, sent: boolean, error?: string }} meta
 * @param {import("discord.js").AttachmentBuilder|null} attachment
 * @param {{ showActions?: boolean }} options
 */
function buildGifsResult(meta = {}, attachment = null, options = {}) {
  const { totalGifs = 0, zipOk = 0, zipFail = 0, zipFilename = null, sent = false, error = null } = meta;
  const { showActions = false } = options;

  let statusLine, accentColor;

  if (error) {
    accentColor = 0xE74C3C;
    statusLine  = `\`❌\` **Erreur :** ${error}`;
  } else {
    accentColor = 0x2ECC71;
    const failStr = zipFail > 0 ? `, **${zipFail}** échec(s)` : "";
    statusLine =
      `\`✅\` **Backup terminé !**\n\n` +
      `> \`🎞️\` GIFs dans le compte : **${totalGifs}**\n` +
      `> \`📦\` Téléchargés dans le ZIP : **${zipOk}**${failStr}\n` +
      (zipFilename ? `> \`📄\` Fichier : \`${zipFilename}\`` : "");
  }

  // Composants de base
  const content = [textDisplay(`# 🎞️ Backup GIFs — Résultat\n\n${statusLine}`)];
  if (showActions) {
    content.push(
      separator(),
      actionRow([
        btn("🔄  Nouveau backup",   "backupgifs:backup", ButtonStyle.Success),
        btn("◀️  Retour GIFs",      "panel:backupgifs",  ButtonStyle.Secondary),
        btn("🏠  Accueil",          "panel:home",        ButtonStyle.Secondary),
      ])
    );
  }

  const components = [container(content, accentColor)];

  // Attacher le ZIP via FileBuilder si disponible
  if (attachment && zipFilename) {
    const fileComponent = new FileBuilder().setURL(`attachment://${zipFilename}`);
    return {
      flags: (1 << 15) | (1 << 6), // IS_COMPONENTS_V2 | EPHEMERAL
      components: [...components, fileComponent],
      files: [attachment],
    };
  }

  return {
    flags: (1 << 15) | (1 << 6),
    components,
  };
}

function buildGifsList(data = {}, page = 0) {
  const { gifs = [], totalSaved = 0 } = data;
  const PAGE_SIZE  = 8;
  const totalPages = Math.max(1, Math.ceil(gifs.length / PAGE_SIZE));
  const slice      = gifs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const list = slice.length
    ? slice.map((g, i) => {
        const idx  = page * PAGE_SIZE + i + 1;
        const url  = g.src ?? "?";
        const dims = (g.width && g.height) ? ` *(${g.width}×${g.height})*` : "";
        const fmt  = g.format && g.format !== "unknown" ? ` [${g.format}]` : "";
        return `\`${idx}.\`${fmt} ${url.slice(0, 90)}${url.length > 90 ? "…" : ""}${dims}`;
      }).join("\n")
    : "*Aucun GIF.*";

  return replyV2(
    container([
      textDisplay(`# 🎞️ GIFs favoris — Liste complète\n*${totalSaved} GIF(s) — page ${page + 1}/${totalPages}*\n\n${list}`),
      separator(),
      actionRow([
        btn("⬅️", `backupgifs:page:${page - 1}`, ButtonStyle.Secondary, null, page === 0),
        btn("➡️", `backupgifs:page:${page + 1}`, ButtonStyle.Secondary, null, page >= totalPages - 1),
        btn("◀️  Retour GIFs", "panel:backupgifs", ButtonStyle.Secondary),
      ]),
    ], 0x2ECC71)
  );
}

module.exports = {
  buildHub,
  buildFriends,
  buildServers,
  // Clone
  buildClone, buildCloneRunning, buildCloneResult, buildCloneHistory, buildCloneGuildList,
  // GIFs
  buildGifs, buildGifsRunning, buildGifsResult, buildGifsList,
};
