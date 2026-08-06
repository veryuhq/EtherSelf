import { ButtonStyle } from "discord.js";
import {
  container, textDisplay, separator, actionRow, btn, selectMenu, section, thumbnail,
  navRow, boundedList, plainText, replyV2, type ActionRowComponent, type ContainerChild,
  type SelectOption, type V2MessagePayload,
} from "../utils/components";

// ─────────────────────────────────────────────────────────────────────────────
//  PANEL RÔLES — consultation seule : les rôles d'un membre, les membres d'un rôle.
//  Tout nom d'origine tierce passe par plainText() avant un Text Display.
// ─────────────────────────────────────────────────────────────────────────────

const ACCENT = 0x9B59B6;

export interface RoleGuild {
  id: string;
  name?: string;
  icon?: string | null;
  memberCount?: number | null;
  cachedMembers?: number;
  chunked?: boolean;
  roleCount?: number;
  ownerId?: string | null;
}

export interface RoleInfo {
  id: string;
  name?: string;
  color?: number;
  colorHex?: string | null;
  position?: number;
  hoist?: boolean;
  mentionable?: boolean;
  managed?: boolean;
  isEveryone?: boolean;
  isBotManaged?: boolean;
  isBooster?: boolean;
  unicodeEmoji?: string | null;
  createdAt?: number | null;
  keyPermissions?: string[];
  /** Compte exact renvoyé par Discord (null si permissions insuffisantes). */
  memberCount?: number | null;
  /** Compte issu du seul cache du selfbot. */
  cachedMembers?: number | null;
}

export interface RoleMember {
  id: string;
  tag?: string | null;
  displayName?: string | null;
  nick?: string | null;
  bot?: boolean;
  joinedAt?: number | null;
  premiumSince?: number | null;
}

export interface MemberProfile extends RoleMember {
  avatar?: string | null;
  isOwner?: boolean;
  colorHex?: string | null;
  topRole?: RoleInfo | null;
  keyPermissions?: string[];
}

export interface RolesHubData {
  guild?: RoleGuild | null;
  /** Serveur mémorisé mais devenu inaccessible (selfbot plus membre, ID erroné…). */
  staleGuildId?: string | null;
  staleGuildName?: string | null;
}

export interface GuildPickerData {
  guilds?: Array<{ id: string; name?: string; isOwner?: boolean }>;
  page?: number;
  selectedGuildId?: string | null;
}

export interface RolesListData {
  guild?: RoleGuild | null;
  roles?: RoleInfo[];
  page?: number;
}

export interface MemberRolesData {
  guild?: RoleGuild | null;
  member?: MemberProfile | null;
  roles?: RoleInfo[];
  page?: number;
}

export interface RoleMembersData {
  guild?: RoleGuild | null;
  role?: RoleInfo | null;
  members?: RoleMember[];
  /** "cache" (cache local) · "api" (100 premiers renvoyés par Discord) · "scan" (scan complet) */
  source?: "cache" | "api" | "scan";
  found?: number;
  exactCount?: number | null;
  complete?: boolean;
  truncated?: boolean;
  deep?: boolean;
  page?: number;
}

// ── Helpers de rendu ─────────────────────────────────────────────────────────

const PERMISSION_LABELS: Record<string, string> = {
  administrator:    "Administrateur",
  manageGuild:      "Gérer le serveur",
  manageRoles:      "Gérer les rôles",
  manageChannels:   "Gérer les salons",
  banMembers:       "Bannir",
  kickMembers:      "Expulser",
  manageMessages:   "Gérer les messages",
  mentionEveryone:  "Mentionner @everyone",
  moderateMembers:  "Exclure temporairement",
};

function permissionsLine(keys: string[] = []): string | null {
  if (!keys.length) return null;
  return keys.map((k) => PERMISSION_LABELS[k] ?? k).join("  ·  ");
}

/** Pastille de couleur approchée d'un rôle : un Text Display ne sait pas colorer du
 *  texte, on projette donc la teinte RGB sur le carré unicode le plus proche. */
function colorDot(color?: number | null): string {
  if (!color) return "⚪";
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  if (delta < 30) return (max + min) / 2 > 150 ? "⬜" : "⬛";

  let hue: number;
  if (max === r)      hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else                hue = (r - g) / delta + 4;
  hue *= 60;
  if (hue < 0) hue += 360;

  if (hue < 15 || hue >= 330) return "🟥";
  if (hue < 45)  return max < 150 ? "🟫" : "🟧";
  if (hue < 70)  return "🟨";
  if (hue < 165) return "🟩";
  if (hue < 260) return "🟦";
  return "🟪";
}

/** Pictogrammes d'un rôle : administrateur, affiché séparément, intégration… */
function roleFlags(role: RoleInfo): string {
  const flags: string[] = [];
  if (role.keyPermissions?.includes("administrator")) flags.push("⚡");
  if (role.hoist)        flags.push("📌");
  if (role.mentionable)  flags.push("🔔");
  if (role.isBooster)    flags.push("🚀");
  else if (role.managed) flags.push("🤖");
  return flags.length ? ` ${flags.join("")}` : "";
}

// Bornes de longueur des noms tiers. Discord plafonne déjà rôles/serveurs à 100
// caractères et pseudos à 32, mais plainText ÉCHAPPE le markdown : un nom de 100
// astérisques en fait 200. Sans ces bornes, une page de 15 rôles ainsi nommés
// dépassait les 4000 caractères du message et Discord rejetait tout le panel.
const NAME_MAX = 60;
const TAG_MAX = 40;

function roleLine(role: RoleInfo, num: number): string {
  const count = role.memberCount ?? role.cachedMembers;
  const countLabel = typeof count === "number" ? ` — \`👥 ${count.toLocaleString("fr-FR")}\`` : "";
  return `\`${String(num).padStart(2, "0")}.\` ${colorDot(role.color)} **${plainText(role.name ?? role.id, NAME_MAX)}**` +
         ` — \`${plainText(role.id)}\`${countLabel}${roleFlags(role)}`;
}

function memberLine(member: RoleMember, num: number): string {
  const name = plainText(member.displayName ?? member.tag ?? member.id, NAME_MAX);
  const tag  = member.tag && member.tag !== member.displayName ? ` *(${plainText(member.tag, TAG_MAX)})*` : "";
  const bot  = member.bot ? " `🤖`" : "";
  return `\`${String(num).padStart(2, "0")}.\` **${name}**${tag}${bot} — \`${plainText(member.id)}\``;
}

function pageInfo(total: number, page: number, size: number): { totalPages: number; start: number } {
  return { totalPages: Math.max(1, Math.ceil(total / size)), start: page * size };
}

/** `<t:…:D>` (date absolue) + `<t:…:R>` (relatif) — rendu localisé par Discord. */
function timestamp(ms?: number | null): string | null {
  if (!ms) return null;
  const sec = Math.floor(ms / 1000);
  return `<t:${sec}:D> (<t:${sec}:R>)`;
}

function guildLine(guild?: RoleGuild | null): string {
  if (!guild) return "*serveur inconnu*";
  return `**${plainText(guild.name ?? guild.id, NAME_MAX)}**`;
}

/** Libellé d'option de select : un select ne rend pas le markdown, il suffit de
 *  borner la longueur. */
function optionLabel(value: string | undefined, fallback: string): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return (text || fallback).slice(0, 100);
}

/** Select des rôles affichés → ouvre directement la liste de leurs membres. */
function roleJumpSelect(guildId: string, roles: RoleInfo[]): ActionRowComponent | null {
  const options: SelectOption[] = roles.slice(0, 25).map((role) => {
    const count = role.memberCount ?? role.cachedMembers;
    return {
      label:       optionLabel(role.name, role.id),
      value:       `roles:showRole:${guildId}:${role.id}`,
      description: (typeof count === "number" ? `${count} membre(s) connus — ID ${role.id}` : `ID ${role.id}`).slice(0, 100),
    };
  });
  if (!options.length) return null;
  return selectMenu("menu:roles_jump", "🎭  Voir les membres d'un rôle…", options);
}

// ─────────────────────────────────────────────────────────────────────────────
//  HUB
// ─────────────────────────────────────────────────────────────────────────────

export function build(data: RolesHubData = {}): V2MessagePayload {
  const { guild = null, staleGuildId = null, staleGuildName = null } = data;

  let target: string;
  if (guild) {
    const members = typeof guild.memberCount === "number"
      ? `${guild.memberCount.toLocaleString("fr-FR")} membres`
      : "membres inconnus";
    target =
      `> ${guildLine(guild)} — \`${plainText(guild.id)}\`\n` +
      `> \`👥\` ${members}  ·  \`🎭\` ${guild.roleCount ?? "?"} rôles  ·  \`🧠\` ${guild.cachedMembers ?? 0} en cache`;
  } else if (staleGuildId) {
    target =
      `> \`⚠️\` **${plainText(staleGuildName ?? staleGuildId, NAME_MAX)}** — \`${plainText(staleGuildId)}\`\n` +
      `> *Serveur inaccessible : le selfbot n'en est plus membre, ou l'ID est erroné.*`;
  } else {
    target =
      "> *Aucun serveur ciblé.*\n" +
      "> *Facultatif : cibler un serveur préremplit son ID dans les recherches.*";
  }

  return replyV2(
    container([
      textDisplay(
        "# 🎭 Rôles\n" +
        "-# Consultation seule — rien n'est modifié sur le serveur.\n\n" +
        `### 🎯 Serveur ciblé\n${target}`
      ),
      separator(),
      textDisplay("**Rechercher :**"),
      actionRow([
        btn("👤  Rôles d'un membre", "roles:member", ButtonStyle.Primary),
        btn("🎭  Membres d'un rôle", "roles:role",   ButtonStyle.Primary),
      ]),
      separator(1, false),
      selectMenu("menu:roles", "📋  Choisis une action…", [
        { label: "📂  Mes serveurs",          value: "roles:pickGuild", description: "Cibler un serveur dans la liste" },
        { label: "⌨️  Saisir l'ID du serveur", value: "roles:setGuild",  description: "Cibler un serveur par son ID" },
        { label: "📜  Rôles du serveur",       value: "roles:list",      description: "Lister les rôles du serveur ciblé" },
      ]),
      separator(),
      navRow(null, null, true),
    ], ACCENT)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  SÉLECTION DU SERVEUR
// ─────────────────────────────────────────────────────────────────────────────

export function buildGuildPicker(data: GuildPickerData = {}): V2MessagePayload {
  const guilds = data.guilds ?? [];
  const selectedGuildId = data.selectedGuildId ?? null;

  const PAGE_SIZE = 20;
  const page = Math.min(Math.max(data.page ?? 0, 0), Math.max(0, Math.ceil(guilds.length / PAGE_SIZE) - 1));
  const { totalPages, start } = pageInfo(guilds.length, page, PAGE_SIZE);
  const slice = guilds.slice(start, start + PAGE_SIZE);

  const list = boundedList(
    slice.map((g, i) => {
      const marker = g.id === selectedGuildId ? " `🎯`" : "";
      const owner  = g.isOwner ? " 👑" : "";
      return `\`${String(start + i + 1).padStart(2, "0")}.\` **${plainText(g.name ?? g.id, NAME_MAX)}**${owner} — \`${plainText(g.id)}\`${marker}`;
    }),
    { maxLines: PAGE_SIZE, maxChars: 2200, empty: "*Aucun serveur — le selfbot n'est membre d'aucun serveur.*" },
  );

  const options: SelectOption[] = slice.map((g) => ({
    label:       optionLabel(g.name, g.id),
    value:       `roles:useGuild:${g.id}`,
    description: `ID ${g.id}`.slice(0, 100),
    default:     g.id === selectedGuildId,
  }));

  const children: ContainerChild[] = [
    textDisplay(
      "# 📂 Mes serveurs\n" +
      "-# Cible un serveur : son ID sera prérempli dans les recherches.\n\n" +
      `${list}\n\n*Page ${page + 1}/${totalPages} — ${guilds.length} serveur(s)*`
    ),
    separator(),
  ];
  if (options.length) {
    children.push(selectMenu("menu:roles_guilds", "🎯  Cibler un serveur…", options), separator(1, false));
  }
  children.push(
    actionRow([
      btn("⬅️", `roles:guildPage:${page - 1}`, ButtonStyle.Secondary, null, page === 0),
      btn("➡️", `roles:guildPage:${page + 1}`, ButtonStyle.Secondary, null, page >= totalPages - 1),
      btn("⌨️  Saisir un ID", "roles:setGuild", ButtonStyle.Secondary),
    ]),
    separator(),
    navRow("panel:roles", "Rôles"),
  );

  return replyV2(container(children, ACCENT));
}

// ─────────────────────────────────────────────────────────────────────────────
//  LISTE DES RÔLES D'UN SERVEUR
// ─────────────────────────────────────────────────────────────────────────────

export function buildRolesList(data: RolesListData = {}): V2MessagePayload {
  const guild = data.guild ?? null;
  const roles = data.roles ?? [];

  const PAGE_SIZE = 15;
  const page = Math.min(Math.max(data.page ?? 0, 0), Math.max(0, Math.ceil(roles.length / PAGE_SIZE) - 1));
  const { totalPages, start } = pageInfo(roles.length, page, PAGE_SIZE);
  const slice = roles.slice(start, start + PAGE_SIZE);

  const list = boundedList(
    slice.map((role, i) => roleLine(role, start + i + 1)),
    { maxLines: PAGE_SIZE, maxChars: 2200, empty: "*Aucun rôle sur ce serveur.*" },
  );

  const children: ContainerChild[] = [
    textDisplay(
      `# 📜 Rôles de ${guildLine(guild)}\n` +
      `-# ${roles.length} rôle(s), du plus haut au plus bas.\n\n` +
      `${list}\n\n` +
      "-# `👥` membres connus du cache  ·  `⚡` administrateur  ·  `📌` affiché séparément  ·  `🔔` mentionnable  ·  `🤖` intégration\n" +
      `-# Page ${page + 1}/${totalPages}`
    ),
    separator(),
  ];

  const jump = guild ? roleJumpSelect(guild.id, slice) : null;
  if (jump) children.push(jump, separator(1, false));

  children.push(
    actionRow([
      btn("⬅️", `roles:listPage:${guild?.id ?? ""}:${page - 1}`, ButtonStyle.Secondary, null, page === 0 || !guild),
      btn("➡️", `roles:listPage:${guild?.id ?? ""}:${page + 1}`, ButtonStyle.Secondary, null, page >= totalPages - 1 || !guild),
      btn("🎭  Membres d'un rôle", guild ? `roles:role:${guild.id}` : "roles:role", ButtonStyle.Secondary),
    ]),
    separator(),
    navRow("panel:roles", "Rôles"),
  );

  return replyV2(container(children, ACCENT));
}

// ─────────────────────────────────────────────────────────────────────────────
//  RÔLES D'UN MEMBRE
// ─────────────────────────────────────────────────────────────────────────────

export function buildMemberRoles(data: MemberRolesData = {}): V2MessagePayload {
  const guild  = data.guild  ?? null;
  const member = data.member ?? null;
  const roles  = data.roles  ?? [];

  const PAGE_SIZE = 15;
  const page = Math.min(Math.max(data.page ?? 0, 0), Math.max(0, Math.ceil(roles.length / PAGE_SIZE) - 1));
  const { totalPages, start } = pageInfo(roles.length, page, PAGE_SIZE);
  const slice = roles.slice(start, start + PAGE_SIZE);

  const infos: string[] = [];
  if (member?.nick)     infos.push(`> \`📛\` Pseudo serveur : **${plainText(member.nick, NAME_MAX)}**`);
  if (member?.isOwner)  infos.push("> `👑` **Propriétaire du serveur**");
  if (member?.bot)      infos.push("> `🤖` Compte bot");
  const joined = timestamp(member?.joinedAt);
  if (joined)           infos.push(`> \`📅\` Arrivé ${joined}`);
  const boost = timestamp(member?.premiumSince);
  if (boost)            infos.push(`> \`🚀\` Booste le serveur depuis ${boost}`);
  if (member?.topRole) {
    infos.push(`> \`🏅\` Rôle le plus haut : ${colorDot(member.topRole.color)} **${plainText(member.topRole.name ?? member.topRole.id, NAME_MAX)}**`);
  }
  if (member?.colorHex) infos.push(`> \`🎨\` Couleur affichée : \`${plainText(member.colorHex)}\``);
  const perms = permissionsLine(member?.keyPermissions);
  if (perms)            infos.push(`> \`⚡\` Permissions clés : ${perms}`);

  const header =
    `# 👤 ${plainText(member?.displayName ?? member?.tag ?? member?.id ?? "Membre", NAME_MAX)}\n` +
    `-# ${plainText(member?.tag ?? "", TAG_MAX)} · \`${plainText(member?.id ?? "?")}\` · sur ${guild ? plainText(guild.name ?? guild.id, NAME_MAX) : "?"}\n\n` +
    (infos.length ? `${infos.join("\n")}\n` : "");

  const rolesBody = roles.length
    ? `### 🎭 Rôles (${roles.length})\n` +
      boundedList(slice.map((role, i) => roleLine(role, start + i + 1)),
                  { maxLines: PAGE_SIZE, maxChars: 1800 }) +
      (totalPages > 1 ? `\n\n-# Page ${page + 1}/${totalPages}` : "")
    : "### 🎭 Rôles (0)\n*Ce membre n'a aucun rôle sur ce serveur.*";

  // Avatar en accessoire de Section quand il est disponible : le header devient
  // une fiche, plus lisible qu'un simple bloc de texte.
  const headerBlock: ContainerChild = member?.avatar
    ? section([header], thumbnail(member.avatar, "Avatar du membre"))
    : textDisplay(header);

  const children: ContainerChild[] = [
    headerBlock,
    separator(),
    textDisplay(rolesBody),
    separator(),
  ];

  const jump = guild ? roleJumpSelect(guild.id, slice.filter((r) => !r.isEveryone)) : null;
  if (jump) children.push(jump, separator(1, false));

  const scope = `${guild?.id ?? ""}:${member?.id ?? ""}`;
  children.push(
    actionRow([
      btn("⬅️", `roles:memberPage:${scope}:${page - 1}`, ButtonStyle.Secondary, null, page === 0 || !guild || !member),
      btn("➡️", `roles:memberPage:${scope}:${page + 1}`, ButtonStyle.Secondary, null, page >= totalPages - 1 || !guild || !member),
      btn("🔎  Autre membre", guild ? `roles:member:${guild.id}` : "roles:member", ButtonStyle.Secondary),
      btn("🎭  Membres d'un rôle", guild ? `roles:role:${guild.id}` : "roles:role", ButtonStyle.Secondary),
    ]),
    separator(),
    navRow("panel:roles", "Rôles"),
  );

  const accent = member?.topRole?.color || ACCENT;
  return replyV2(container(children, accent));
}

// ─────────────────────────────────────────────────────────────────────────────
//  MEMBRES D'UN RÔLE
// ─────────────────────────────────────────────────────────────────────────────

export function buildRoleMembers(data: RoleMembersData = {}): V2MessagePayload {
  const guild   = data.guild ?? null;
  const role    = data.role  ?? null;
  const members = data.members ?? [];
  const source  = data.source ?? "cache";
  const found     = data.found ?? members.length;
  const exact     = data.exactCount ?? null;
  const complete  = data.complete ?? false;
  const truncated = data.truncated ?? false;
  const deep      = data.deep ?? false;

  const PAGE_SIZE = 15;
  const page = Math.min(Math.max(data.page ?? 0, 0), Math.max(0, Math.ceil(members.length / PAGE_SIZE) - 1));
  const { totalPages, start } = pageInfo(members.length, page, PAGE_SIZE);
  const slice = members.slice(start, start + PAGE_SIZE);

  const infos: string[] = [];
  infos.push(
    `> \`🎨\` ${colorDot(role?.color)} \`${role?.colorHex ?? "aucune couleur"}\`` +
    `  ·  \`📊\` Position ${role?.position ?? "?"}`
  );
  const badges = [
    role?.hoist       ? "`📌` affiché séparément" : null,
    role?.mentionable ? "`🔔` mentionnable"       : null,
    role?.isBooster   ? "`🚀` rôle de boost"      : null,
    role?.managed     ? "`🤖` géré par une intégration" : null,
    role?.isEveryone  ? "`🌍` rôle par défaut"    : null,
  ].filter(Boolean).join("  ·  ");
  if (badges) infos.push(`> ${badges}`);
  const perms = permissionsLine(role?.keyPermissions);
  if (perms) infos.push(`> \`⚡\` ${perms}`);
  const created = timestamp(role?.createdAt);
  if (created) infos.push(`> \`📅\` Créé ${created}`);

  const totalLabel = exact !== null
    ? `**${exact.toLocaleString("fr-FR")}** membre(s)`
    : `**${found.toLocaleString("fr-FR")}** membre(s) trouvé(s)`;

  // État de la liste : dire explicitement ce qui est complet et ce qui ne l'est pas.
  let statusLine: string;
  if (complete)          statusLine = "`✅` Liste complète.";
  else if (deep)         statusLine = "`🔬` Issue d'un scan complet de la liste des membres.";
  else if (source === "api") statusLine = "`⚠️` Liste partielle — Discord ne renvoie que les 100 premiers membres d'un rôle. Lance un **scan complet** pour la liste exacte.";
  else                   statusLine = "`⚠️` Liste issue du seul cache local, donc incomplète. Lance un **scan complet** pour la liste exacte.";
  if (truncated) statusLine += `\n\`✂️\` Affichage limité aux ${members.length} premiers membres.`;

  const list = boundedList(
    slice.map((member, i) => memberLine(member, start + i + 1)),
    { maxLines: PAGE_SIZE, maxChars: 2000, empty: "*Aucun membre trouvé avec ce rôle.*" },
  );

  const scope = `${guild?.id ?? ""}:${role?.id ?? ""}:${deep ? "1" : "0"}`;

  return replyV2(
    container([
      textDisplay(
        `# 🎭 ${plainText(role?.name ?? role?.id ?? "Rôle", NAME_MAX)}\n` +
        `-# \`${plainText(role?.id ?? "?")}\` · sur ${guild ? plainText(guild.name ?? guild.id, NAME_MAX) : "?"}\n\n` +
        `${infos.join("\n")}\n\n` +
        `### 👥 Membres — ${totalLabel}\n${statusLine}\n\n${list}` +
        (totalPages > 1 ? `\n\n-# Page ${page + 1}/${totalPages} — ${members.length} affiché(s)` : "")
      ),
      separator(),
      actionRow([
        btn("⬅️", `roles:rolePage:${scope}:${page - 1}`, ButtonStyle.Secondary, null, page === 0 || !guild || !role),
        btn("➡️", `roles:rolePage:${scope}:${page + 1}`, ButtonStyle.Secondary, null, page >= totalPages - 1 || !guild || !role),
        btn("🔬  Scan complet", `roles:deepScan:${guild?.id ?? ""}:${role?.id ?? ""}`, ButtonStyle.Success, null, complete || !guild || !role),
        btn("🔎  Autre rôle", guild ? `roles:role:${guild.id}` : "roles:role", ButtonStyle.Secondary),
      ]),
      separator(),
      navRow("panel:roles", "Rôles"),
    ], role?.color || ACCENT)
  );
}

/** Panel d'attente du scan complet, qui peut durer plusieurs minutes sur un gros
 *  serveur. */
export function buildScanning(data: { guild?: RoleGuild | null; role?: RoleInfo | null } = {}): V2MessagePayload {
  const { guild = null, role = null } = data;
  const memberCount = typeof guild?.memberCount === "number"
    ? `${guild.memberCount.toLocaleString("fr-FR")} membres à parcourir`
    : "taille du serveur inconnue";

  return replyV2(
    container([
      textDisplay(
        "# 🔬 Scan complet en cours…\n" +
        `\`⏳\` **Rôle :** ${plainText(role?.name ?? role?.id ?? "?", NAME_MAX)} — sur ${guildLine(guild)}\n` +
        `\`👥\` ${memberCount}\n\n` +
        "*La liste des membres est récupérée par lots espacés d'une seconde pour ne pas exposer le compte :*\n" +
        "*compte quelques secondes sur un petit serveur, plusieurs minutes sur un gros.*\n" +
        "-# Ce panneau se mettra à jour tout seul à la fin du scan."
      ),
      separator(),
      navRow("panel:roles", "Rôles"),
    ], ACCENT)
  );
}
