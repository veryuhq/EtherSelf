// ─────────────────────────────────────────────────────────────────────────────
//  Utilitaires partagés entre les routeurs d'interactions (buttons.ts,
//  modals.ts) — évite de dupliquer la table de navigation, la génération
//  d'identifiants de jobs et les recherches du panel Rôles (déclenchées aussi
//  bien depuis un modal que depuis les boutons de pagination des résultats).
// ─────────────────────────────────────────────────────────────────────────────

import { sendAction } from "../bridge/client";
import type { V2MessagePayload } from "../utils/components";
import * as roles from "../panels/roles";

/** customId de navigation → nom de panel pour fetchAndBuild(). */
export const NAV_MAP: Record<string, string> = {
  "panel:config":       "config",
  "panel:afk":          "afk",
  "panel:snipe":        "snipe",
  "panel:tags":         "tags",
  "panel:bookmarks":    "bookmarks",
  "panel:msgbookmarks": "msgbookmarks",
  "panel:antigroup":    "antigroup",
  "panel:purge":        "purge",
  "panel:sysinfo":      "sysinfo",
  "panel:rpc":          "rpc",
  "panel:rpc_cs":       "rpc_cs",
  "panel:rpc_spotify":  "rpc_spotify",
  "panel:rpc_hub":      "rpc_hub",
  "panel:quests":       "quests",
  "panel:backups":      "backups",
  "panel:roles":        "roles",
};

/** Identifiant unique de job (purge, clone, snapshot…). */
export function makeJobId(prefix = "job"): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Résultat d'une recherche du panel Rôles : soit le panel, soit le message d'erreur. */
export interface PanelResult {
  panel?: V2MessagePayload;
  error?: string;
}

const NO_GUILD = "Aucun serveur ciblé — utilise **📂 Mes serveurs** ou **⌨️ Saisir l'ID du serveur**.";

/** Recherche « rôles d'un membre ». */
export async function fetchMemberRolesPanel(guildId: string, userId: string, page = 0): Promise<PanelResult> {
  if (!guildId) return { error: NO_GUILD };
  if (!userId)  return { error: "ID du membre manquant." };
  const res = await sendAction("roles.memberRoles", { guildId, userId });
  if (!res?.success) return { error: res?.error };
  return { panel: roles.buildMemberRoles({ ...(res.data ?? {}), page }) };
}

/** Recherche « membres d'un rôle ». `deep` = scan complet de la liste des membres. */
export async function fetchRoleMembersPanel(guildId: string, roleId: string, page = 0, deep = false): Promise<PanelResult> {
  if (!guildId) return { error: NO_GUILD };
  if (!roleId)  return { error: "ID du rôle manquant." };
  const res = await sendAction("roles.roleMembers", { guildId, roleId, deep });
  if (!res?.success) return { error: res?.error };
  return { panel: roles.buildRoleMembers({ ...(res.data ?? {}), page }) };
}
