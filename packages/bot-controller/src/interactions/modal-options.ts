import type { SelectOption } from "../utils/components";

// ─────────────────────────────────────────────────────────────────────────────
//  Options partagées des RadioGroups/CheckboxGroups de modals. Les `value`
//  suivent le contrat du bridge (listes validées côté Python).
// ─────────────────────────────────────────────────────────────────────────────

/** Type de messages snipés à consulter (supprimés ou édités). */
export function snipeTypeOptions(def: string): SelectOption[] {
  return [
    { label: "🗑️ Supprimés", value: "deleted", description: "Messages supprimés",  default: def === "deleted" },
    { label: "✏️ Édités",    value: "edited",  description: "Messages édités",     default: def === "edited" },
  ];
}

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

/** Direction de déplacement d'une activité RPC dans la liste. */
export function moveDirectionOptions(def = "up"): SelectOption[] {
  return [
    { label: "⬆️ Monter",    value: "up",   description: "Monter l'activité dans la liste",    default: def === "up" },
    { label: "⬇️ Descendre", value: "down", description: "Descendre l'activité dans la liste", default: def === "down" },
  ];
}

/** Éléments à cloner (CheckboxGroup du modal d'options de clone),
 *  pré-cochés depuis la config en mémoire. */
export function cloneOptionsCheckboxes(cfg: { cloneRoles?: boolean; cloneChannels?: boolean; cloneEmojis?: boolean; cloneSettings?: boolean }): SelectOption[] {
  return [
    { label: "🎭 Rôles",       value: "roles",    description: "Cloner les rôles du serveur",            default: cfg.cloneRoles    ?? true },
    { label: "💬 Salons",      value: "channels", description: "Cloner les catégories et salons",        default: cfg.cloneChannels ?? true },
    { label: "😀 Emojis",      value: "emojis",   description: "Cloner les emojis personnalisés",        default: cfg.cloneEmojis   ?? true },
    { label: "⚙️ Paramètres",  value: "settings", description: "Cloner nom, icône et paramètres divers", default: cfg.cloneSettings ?? true },
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
