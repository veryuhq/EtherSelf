/**
 * Serveur ciblé par le panel Rôles, mémorisé par utilisateur.
 *
 * Purement confort : il préremplit l'ID de serveur des modals de recherche pour
 * ne pas avoir à le retaper. Rien n'est persisté sur disque — la sélection est
 * perdue au redémarrage du controller, ce qui est sans conséquence.
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
