import type { SelectOption } from "../utils/components";

// ─────────────────────────────────────────────────────────────────────────────
//  Options partagées des RadioGroups de modals — importées par buttons.ts ET
//  selects.ts (les modals RPC existent dans les deux). Les `value` suivent le
//  contrat du bridge : listes validées côté Python (app/commands/utilitaires/
//  rpc.py) et clés attendues par action_router.py.
// ─────────────────────────────────────────────────────────────────────────────

/** Mode de recherche snipe (par salon, serveur ou utilisateur). */
export function snipeModeOptions(def: string): SelectOption[] {
  return [
    { label: "Salon",       value: "channel", description: "Rechercher par ID de salon",      default: def === "channel" },
    { label: "Serveur",     value: "guild",   description: "Rechercher par ID de serveur",    default: def === "guild" },
    { label: "Utilisateur", value: "user",    description: "Rechercher par ID d'utilisateur", default: def === "user" },
  ];
}

/** Statut en ligne Discord. */
export function statusOptions(current: string): SelectOption[] {
  return [
    { label: "🟢 En ligne",        value: "online",    default: current === "online" },
    { label: "🌙 Inactif",         value: "idle",      default: current === "idle" },
    { label: "⛔ Ne pas déranger", value: "dnd",       default: current === "dnd" },
    { label: "⚫ Invisible",       value: "invisible", default: current === "invisible" },
  ];
}

/** Type d'activité RPC. */
export function activityTypeOptions(current = "playing"): SelectOption[] {
  return [
    { label: "Joue à…",      value: "playing",   description: "playing",                                 default: current === "playing" },
    { label: "Streame…",     value: "streaming", description: "streaming — nécessite une URL de stream", default: current === "streaming" },
    { label: "Écoute…",      value: "listening", description: "listening",                               default: current === "listening" },
    { label: "Regarde…",     value: "watching",  description: "watching",                                default: current === "watching" },
    { label: "Participe à…", value: "competing", description: "competing",                               default: current === "competing" },
  ];
}

/** Action sur les boutons RPC d'une activité. */
export function buttonActionOptions(): SelectOption[] {
  return [
    { label: "Ajouter",    value: "add",    description: "Ajouter un bouton (label + URL requis)", default: true },
    { label: "Supprimer",  value: "remove", description: "Supprimer le bouton n° indiqué" },
    { label: "Tout vider", value: "clear",  description: "Supprimer tous les boutons" },
  ];
}

/** Plateforme d'affichage d'une activité ("none" = aucune, converti en null). */
export function platformOptions(current?: string | null): SelectOption[] {
  const platforms = ["desktop", "samsung", "xbox", "ios", "android", "embedded", "ps4", "ps5"];
  return [
    { label: "Aucune", value: "none", default: !current },
    ...platforms.map((p) => ({ label: p, value: p, default: current === p })),
  ];
}

/** Type de cible d'une exclusion de purge. */
export function purgeExclKindOptions(def = "guild"): SelectOption[] {
  return [
    { label: "Serveur",   value: "guild",   description: "Épargner un serveur entier",  default: def === "guild" },
    { label: "Groupe DM", value: "groupdm", description: "Épargner un groupe DM",       default: def === "groupdm" },
    { label: "Salon",     value: "channel", description: "Épargner un salon précis",    default: def === "channel" },
  ];
}
