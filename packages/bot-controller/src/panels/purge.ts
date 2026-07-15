import { ButtonStyle } from "discord.js";
import { container, textDisplay, separator, actionRow, btn, selectMenu, navRow, replyV2, type ButtonComponent, type V2MessagePayload } from "../utils/components";

export type PurgeScope = "channel" | "guild" | "dms" | "guilds";

export type ExclusionKind = "guild" | "groupdm" | "channel";

export interface PurgeExclusion {
  id: string;
  kind: ExclusionKind;
  label?: string | null;
}

export interface PurgeData {
  deleted?: number | null;
  pending?: boolean;
  scope?: PurgeScope | null;
  excluded?: PurgeExclusion[];
}

export interface PurgeConfirmData {
  scope?: PurgeScope;
  channelId?: string | null;
  guildId?: string | null;
  guildName?: string | null;
  amount?: number | null;
}

export interface PurgeProgressData {
  scope?: PurgeScope;
  guildName?: string | null;
  queue?: Array<{ id: string; label: string }>;
  activeLabel?: string | null;
  doneCount?: number;
  total?: number;
  totalDeleted?: number;
  done?: boolean;
  cancelled?: boolean;
  jobId?: string | null;
}

// ── Vue principale ────────────────────────────────────────────────────────────

export function build(data: PurgeData = {}): V2MessagePayload {
  const { deleted = null, pending = false, scope = null } = data;

  let status: string;
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
      selectMenu("menu:purge", "📋  Choisis une action…", [
        { label: "🗑️  Purger un salon",       value: "purge:confirm:channel", description: "Supprimer tes messages dans un salon" },
        { label: "🏠  Purger un serveur",     value: "purge:confirm:guild",   description: "Supprimer tes messages dans un serveur" },
        { label: "💬  Purger tous les DMs",   value: "purge:confirm:dms",     description: "Supprimer tes messages dans tous les DMs et groupes" },
        { label: "🌐  Purger les serveurs",   value: "purge:confirm:guilds",  description: "Supprimer tes messages dans tous les serveurs" },
        { label: "🛡️  Gérer les exclusions",  value: "purge:exclusions",      description: "Épargner des serveurs, groupes DM ou salons" },
      ]),
      separator(),
      navRow(null, null, true),
    ], 0xE74C3C)
  );
}

// ── Vue gestion des exclusions ────────────────────────────────────────────────

export function buildExclusions(data: PurgeData = {}): V2MessagePayload {
  const { excluded = [] } = data;

  const KIND_META: Record<ExclusionKind, { icon: string; title: string }> = {
    guild:   { icon: "🏠", title: "Serveurs" },
    groupdm: { icon: "👥", title: "Groupes DM" },
    channel: { icon: "#️⃣", title: "Salons" },
  };

  const sections: string[] = [];
  for (const kind of ["guild", "groupdm", "channel"] as ExclusionKind[]) {
    const items = excluded.filter((e) => e.kind === kind);
    if (!items.length) continue;
    const meta = KIND_META[kind];
    const lines = items
      .map((e) => `> \`${e.id}\`${e.label ? ` — ${e.label}` : ""}`)
      .join("\n");
    sections.push(`${meta.icon} **${meta.title}** (${items.length})\n${lines}`);
  }

  const body = excluded.length
    ? sections.join("\n\n")
    : "*Aucune exclusion configurée.*\n\nLes purges **serveur**, **tous les serveurs** et **tous les DMs** épargneront les cibles ajoutées ici.";

  return replyV2(
    container([
      textDisplay(`# 🛡️ Exclusions de purge\n${body}`),
      separator(),
      selectMenu("menu:purge_excl", "📋  Gérer les exclusions…", [
        { label: "➕  Exclure une cible",     value: "purge:excl:add",    description: "Épargner un serveur, groupe DM ou salon (par ID)" },
        { label: "➖  Retirer une exclusion", value: "purge:excl:remove", description: "Retirer une exclusion existante" },
      ]),
      separator(),
      navRow("panel:purge", "Retour Purge", true),
    ], 0xE74C3C)
  );
}

// ── Vue confirmation ──────────────────────────────────────────────────────────

export function buildConfirm(data: PurgeConfirmData = {}): V2MessagePayload {
  const { scope, channelId = null, guildId = null, guildName = null, amount = null } = data;

  const SCOPE_LABELS: Record<PurgeScope, string> = {
    channel: "ce salon",
    guild:   "ce serveur",
    dms:     "tous tes DMs",
    guilds:  "tous tes serveurs",
  };

  const SCOPE_WARNINGS: Record<PurgeScope, string> = {
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

  const label    = scope ? SCOPE_LABELS[scope]   : String(scope);
  const warning  = scope ? SCOPE_WARNINGS[scope] : "Cette action est irréversible.";

  let confirmId: string;
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

export function buildProgress(data: PurgeProgressData = {}): V2MessagePayload {
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

  const SCOPE_ICONS: Record<PurgeScope, string> = {
    channel: "🗑️",
    dms:     "💬",
    guilds:  "🌐",
    guild:   "🏠",
  };
  const SCOPE_TITLES: Record<PurgeScope, string> = {
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
  const lines: string[] = [];

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

  let header: string;
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
        "salon(s)";
      header = `\`✅\` **Terminé !** \`${totalDeleted}\` message(s) supprimé(s) sur **${total}** ${scopeUnit}.`;
    }
  } else if (activeLabel) {
    header = `\`⏳\` **En cours…**`;
  } else {
    header = `\`🔄\` **Démarrage…**`;
  }

  const body = listText
    ? `${header}\n\n${progressLine}\n\n${listText}`
    : `${header}\n\n${progressLine}`;

  const buttons: ButtonComponent[] = [];
  if (done) {
    buttons.push(btn("◀️  Retour Purge", "panel:purge", ButtonStyle.Secondary));
    buttons.push(btn("🏠  Accueil",      "panel:home",  ButtonStyle.Secondary));
  } else {
    if (jobId) {
      buttons.push(btn("🛑  Arrêter",  `purge:cancel:${jobId}`, ButtonStyle.Danger));
    }
    buttons.push(btn("🏠  Accueil", "panel:home", ButtonStyle.Secondary));
  }

  const accentColor = (done && !cancelled) ? 0x2ECC71 : 0xE74C3C;

  return replyV2(
    container([
      textDisplay(`# ${icon} ${title}\n${body}`),
      separator(),
      actionRow(buttons),
    ], accentColor)
  );
}
