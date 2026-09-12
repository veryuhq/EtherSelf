import { ButtonStyle } from "discord.js";
import { container, textDisplay, separator, actionRow, btn, selectMenu, logLines, navRow, boundedList, plainText, replyV2, type SelectOption, type V2MessagePayload } from "../utils/components";

export interface BackupsHubData {
  friendsCount?: number | null;
  friendsSavedAt?: string | number | null;
  guildsCount?: number | null;
  guildsSavedAt?: string | number | null;
}

export interface BackupFriend {
  tag?: string;
  username?: string;
  globalName?: string | null;
  since?: string | number | null;
}

export interface FriendsData {
  friends?: BackupFriend[] | null;
  savedAt?: string | number | null;
  count?: number | null;
  page?: number;
  _loading?: boolean;
}

export interface BackupGuild {
  id: string;
  name?: string;
  isOwner?: boolean;
  invite?: string | null;
}

export interface GuildsData {
  guilds?: BackupGuild[] | null;
  savedAt?: string | number | null;
  count?: number | null;
  page?: number;
  _loading?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
//  HUB BACKUPS
// ─────────────────────────────────────────────────────────────────────────────

export function build(data: BackupsHubData = {}): V2MessagePayload {
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
        `# 💾 Backups\n\n` +
        `### 👥 Amis\n> ${fLine}\n\n` +
        `### 🏠 Serveurs\n> ${gLine}`
      ),
      separator(),
      actionRow([
        btn("👥  Backup amis",        "backups:friends",     ButtonStyle.Primary),
        btn("🏠  Backup serveurs",    "backups:guilds",      ButtonStyle.Primary),
      ]),
      separator(),
      navRow(null, null, true),
    ], 0x3498DB)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  AMIS
// ─────────────────────────────────────────────────────────────────────────────

export function buildFriends(data: FriendsData = {}): V2MessagePayload {
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
    : boundedList(
        slice.map((f, i) => {
          const num = page * PAGE_SIZE + i + 1;
          const since = f.since ? ` — *depuis ${new Date(f.since).toLocaleDateString("fr-FR")}*` : "";
          // Pseudo / globalName d'un tiers : markdown neutralisé (cf. plainText) et
          // borné — l'échappement peut doubler la longueur du pseudo.
          const display = f.globalName && f.globalName !== f.username
            ? `**${plainText(f.globalName, 50)}** (${plainText(f.tag, 50)})`
            : `**${plainText(f.tag, 50)}**`;
          return `\`${num}.\` ${display}${since}`;
        }),
        { maxLines: PAGE_SIZE, maxChars: 2200, empty: "*Aucun ami trouvé. Clique sur \"Actualiser backup\" pour récupérer ta liste d'amis.*" },
      );

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

export function buildGuilds(data: GuildsData = {}): V2MessagePayload {
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
    : boundedList(
        slice.map((g, i) => {
          const num = page * PAGE_SIZE + i + 1;
          const owner = g.isOwner ? " 👑" : "";
          const inviteLine = g.invite
            ? `\n> 🔗 ${plainText(g.invite, 120)}`
            : `\n> 🔗 *aucune invitation*`;
          // Nom de serveur = contenu tiers (défini par son propriétaire).
          return `\`${num}.\` **${plainText(g.name, 80)}**${owner} — \`${plainText(g.id)}\`${inviteLine}`;
        }),
        { maxLines: PAGE_SIZE, maxChars: 2200, separator: "\n\n", empty: "*Aucun serveur trouvé. Clique sur \"Actualiser backup\" pour en créer un.*" },
      );

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
