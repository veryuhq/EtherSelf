import { ButtonStyle } from "discord.js";
import { container, textDisplay, separator, actionRow, btn, selectMenu, navRow, plainText, replyV2, type V2MessagePayload } from "../utils/components";

export type SnipeType = "deleted" | "edited";
export type SnipeSearchMode = "channel" | "guild" | "user";

export interface SnapshotSchedule {
  channelId: string;
  intervalLabel?: string;
  limit?: number;
  sendToChannelId?: string | null;
  nextRunAt?: number | null;
}

export interface SnipeData {
  whitelist?: string[];
  guilds?: Array<{ id: string; name?: string }>;
  snapshotSchedules?: SnapshotSchedule[];
  snapshotSchedulesRunning?: boolean;
}

export interface SnipedMessage {
  content?: string;
  oldContent?: string;
  newContent?: string;
  authorTag?: string;
  authorId?: string;
  channelId?: string;
  channelName?: string;
  createdTimestamp?: number;
  deletedAt?: number;
  editedAt?: number;
}

export interface SnipeResultsData {
  messages?: SnipedMessage[];
  type?: SnipeType;
  page?: number;
  searchMode?: SnipeSearchMode;
  channelId?: string | null;
  channelName?: string | null;
  guildId?: string | null;
  guildName?: string | null;
  userId?: string | null;
  userTag?: string | null;
}

export function build(data: SnipeData = {}): V2MessagePayload {
  const { whitelist = [], guilds = [], snapshotSchedules = [], snapshotSchedulesRunning = false } = data;

  const list = whitelist.length
    ? whitelist.map((id, i) => {
        const guild = guilds.find((g) => g.id === id);
        const name  = guild?.name ?? null;
        return `\`${i + 1}.\` ${name ? `**${plainText(name)}** (\`${plainText(id)}\`)` : `\`${plainText(id)}\``}`;
      }).join("\n")
    : "*Aucun serveur dans la whitelist.*";

  const scheduleList = snapshotSchedules.length
    ? snapshotSchedules.slice(0, 8).map((job, i) => {
        const limit = (job.limit ?? 0) > 0 ? `${job.limit} msg` : "tout";
        const target = job.sendToChannelId ? `<#${job.sendToChannelId}>` : "DM";
        const next = job.nextRunAt ? `<t:${Math.floor(job.nextRunAt / 1000)}:R>` : "bientôt";
        return `\`${i + 1}.\` <#${job.channelId}> — **${job.intervalLabel ?? "intervalle ?"}** — ${limit} — ${target} — prochain ${next}`;
      }).join("\n")
    : "*Aucun snapshot périodique configuré.*";

  return replyV2(
    container([
      textDisplay(
        `# 🔍 Snipe / MessageLogger / Snapshots\n` +
        `**Serveurs whitelistés (${whitelist.length}) :**\n${list}\n\n` +
        `**Snapshots périodiques (${snapshotSchedules.length}) :** ${snapshotSchedulesRunning ? "`🟢` Actif" : "`🔴` Inactif"}\n${scheduleList}`
      ),
      separator(),
      selectMenu("menu:snipe", "📋  Choisis une action…", [
        { label: "➕  Ajouter serveur",    value: "snipe:add",                    description: "Whitelister un serveur" },
        { label: "➖  Retirer serveur",    value: "snipe:remove",                 description: "Retirer un serveur de la whitelist" },
        { label: "👀  Voir les messages",  value: "snipe:view",                   description: "Consulter les messages supprimés ou édités" },
        { label: "📸  Snapshot salon",     value: "snipe:snapshot",               description: "Archiver un salon maintenant" },
        { label: "🔁  Ajouter périodique", value: "snipe:snapshotPeriodicAdd",    description: "Programmer un snapshot périodique" },
        { label: "🗑️  Retirer périodique", value: "snipe:snapshotPeriodicRemove", description: "Retirer un snapshot périodique" },
      ]),
      separator(1, false),
      actionRow([
        btn(snapshotSchedulesRunning ? "⏸️  Stop périodiques" : "▶️  Start périodiques", "snipe:snapshotPeriodicToggle", snapshotSchedulesRunning ? ButtonStyle.Danger : ButtonStyle.Success, null, snapshotSchedules.length === 0),
      ]),
      separator(),
      navRow(null, null, true),
    ], 0xED4245)
  );
}

export function buildResults(data: SnipeResultsData = {}): V2MessagePayload {
  const {
    messages    = [],
    type        = "deleted",
    page        = 0,
    searchMode  = "channel",
    // channel
    channelId   = null,
    channelName = null,
    // guild
    guildId     = null,
    guildName   = null,
    // user
    userId      = null,
    userTag     = null,
  } = data;

  const PAGE_SIZE  = 5;
  const totalPages = Math.max(1, Math.ceil(messages.length / PAGE_SIZE));
  const emoji      = type === "deleted" ? "🗑️" : "✏️";
  const label      = type === "deleted" ? "supprimés" : "édités";

  // ── En-tête selon le mode de recherche ───────────────────────────────────
  let scopeDisplay: string;
  let backButtonId: string;
  if (searchMode === "guild") {
    scopeDisplay = guildName
      ? `**${plainText(guildName)}**`
      : guildId
        ? `\`${plainText(guildId)}\``
        : `*serveur inconnu*`;
    backButtonId = `snipe:inputGuild:${type}`;
  } else if (searchMode === "user") {
    scopeDisplay = userTag
      ? `**${plainText(userTag)}**`
      : userId
        ? `\`${plainText(userId)}\``
        : `*utilisateur inconnu*`;
    backButtonId = `snipe:inputUser:${type}`;
  } else {
    scopeDisplay = channelName
      ? `#${plainText(channelName)}`
      : channelId
        ? `\`${plainText(channelId)}\``
        : `*salon inconnu*`;
    backButtonId = `snipe:inputChannel:${type}`;
  }

  // ── Corps ─────────────────────────────────────────────────────────────────
  let body: string;
  if (!messages.length) {
    body = "*Aucun message snipé ici.*";
  } else {
    const sorted = [...messages].sort((a, b) =>
      (b.deletedAt ?? b.editedAt ?? 0) - (a.deletedAt ?? a.editedAt ?? 0)
    );
    const slice = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    body = slice.map((m, i) => {
      const ts  = new Date(m.createdTimestamp ?? m.deletedAt ?? m.editedAt ?? 0).toLocaleString("fr-FR");
      const num = page * PAGE_SIZE + i + 1;

      // Nom d'auteur : fallback en cascade. Pseudos et contenus viennent de tiers,
      // donc systématiquement neutralisés (cf. plainText).
      const author = m.authorTag && m.authorTag !== "unknown"
        ? plainText(m.authorTag)
        : m.authorId
          ? `\`${plainText(m.authorId)}\``
          : "*auteur inconnu*";

      // Info salon pour les recherches guild/user
      let channelInfo = "";
      if (searchMode === "guild" || searchMode === "user") {
        if (m.channelName) {
          channelInfo = ` — #${plainText(m.channelName)}`;
        } else if (m.channelId) {
          channelInfo = ` — <#${m.channelId}>`;
        }
      }

      if (type === "edited") {
        const before = m.oldContent ? plainText(m.oldContent, 80) : "*(vide)*";
        const after  = m.newContent ? plainText(m.newContent, 80) : "*(vide)*";
        return `**${num}. ${author}**${channelInfo} — ${ts}\n> ✦ Avant : ${before}\n> ✦ Après : ${after}`;
      }

      const content = m.content ? plainText(m.content, 120) : "*(vide)*";
      return `**${num}. ${author}**${channelInfo} — ${ts}\n> ${content}`;
    }).join("\n\n");
    body = `*${messages.length} message(s) — page ${page + 1}/${totalPages}*\n\n${body}`;
  }

  // ── Construire customId pagination avec le bon identifiant ────────────────
  const scopeId = searchMode === "guild" ? guildId
    : searchMode === "user" ? userId
    : channelId;

  return replyV2(
    container([
      textDisplay(`# ${emoji} Messages ${label} — ${scopeDisplay}\n${body}`),
      separator(),
      actionRow([
        btn("⬅️", `snipe:page:${type}:${page - 1}:${searchMode}:${scopeId}`, ButtonStyle.Secondary, null, page === 0),
        btn("➡️", `snipe:page:${type}:${page + 1}:${searchMode}:${scopeId}`, ButtonStyle.Secondary, null, page >= totalPages - 1),
        btn("🔎  Autre recherche", backButtonId, ButtonStyle.Secondary),
      ]),
      separator(),
      navRow("panel:snipe", "Snipe"),
    ], 0xED4245)
  );
}

/**
 * Panel affiché pendant l'exécution du snapshot (long, asynchrone).
 */
export function buildSnapshotRunning(data: { channelId?: string; channelName?: string | null } = {}): V2MessagePayload {
  const { channelName = null, channelId = "" } = data;
  const display = channelName ? `#${plainText(channelName)}` : `\`${plainText(channelId)}\``;

  return replyV2(
    container([
      textDisplay(
        `# 📸 Snapshot en cours…\n` +
        `\`⏳\` **Récupération des messages de ${display}…**\n\n` +
        `*Cette opération peut prendre plusieurs secondes à quelques minutes selon la taille du salon.*\n` +
        `*Le fichier HTML te sera envoyé en DM une fois terminé.*`
      ),
      separator(),
      navRow(null, null, true),
    ], 0xED4245)
  );
}

/**
 * Panel de résultat du snapshot.
 */
export function buildSnapshotResult(
  data: { channelName?: string; messageCount?: number; sent?: boolean; error?: string | null } = {},
): V2MessagePayload {
  const { channelName = "?", messageCount = 0, sent = false, error = null } = data;

  const statusLine = error
    ? `\`❌\` **Erreur :** ${plainText(error)}`
    : sent
      ? `\`✅\` **Fichier envoyé en DM !**`
      : `\`⚠️\` **Fichier généré mais non envoyé** *(DM inaccessible)*`;

  return replyV2(
    container([
      textDisplay(
        `# 📸 Snapshot terminé\n` +
        `\`📋\` **Salon :** #${plainText(channelName)}\n` +
        `\`💬\` **Messages archivés :** ${messageCount}\n` +
        `${statusLine}`
      ),
      separator(),
      actionRow([
        btn("📸  Nouveau snapshot", "snipe:snapshot", ButtonStyle.Primary),
        btn("◀️  Retour Snipe",     "panel:snipe",    ButtonStyle.Secondary),
        btn("🏠  Accueil",           "panel:home",     ButtonStyle.Secondary),
      ]),
    ], 0xED4245)
  );
}
