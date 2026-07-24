// ─────────────────────────────────────────────────────────────────────────────
//  Utilitaires partagés entre les routeurs d'interactions (buttons.ts,
//  modals.ts) — évite de dupliquer la table de navigation et la génération
//  d'identifiants de jobs.
// ─────────────────────────────────────────────────────────────────────────────

/** customId de navigation → nom de panel pour fetchAndBuild(). */
export const NAV_MAP: Record<string, string> = {
  "panel:config":       "config",
  "panel:afk":          "afk",
  "panel:snipe":        "snipe",
  "panel:tags":         "tags",
  "panel:bookmarks":    "bookmarks",
  "panel:msgbookmarks": "msgbookmarks",
  "panel:antigroup":    "antigroup",
  "panel:autobump":     "autobump",
  "panel:purge":        "purge",
  "panel:sysinfo":      "sysinfo",
  "panel:rpc":          "rpc",
  "panel:rpc_cs":       "rpc_cs",
  "panel:rpc_spotify":  "rpc_spotify",
  "panel:rpc_hub":      "rpc_hub",
  "panel:quests":       "quests",
  "panel:backups":      "backups",
};

/** Identifiant unique de job (purge, clone, snapshot…). */
export function makeJobId(prefix = "job"): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
