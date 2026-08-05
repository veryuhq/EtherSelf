/**
 * Serveur ciblé par le panel Rôles, mémorisé par utilisateur pour préremplir les
 * modals de recherche. Rien n'est persisté : la sélection est perdue au redémarrage.
 */
export interface RolesConfig {
  guildId: string | null;
  guildName: string | null;
}

const rolesConfig = new Map<string, RolesConfig>();

export function getRolesConfig(userId: string): RolesConfig {
  let cfg = rolesConfig.get(userId);
  if (!cfg) {
    cfg = { guildId: null, guildName: null };
    rolesConfig.set(userId, cfg);
  }
  return cfg;
}
