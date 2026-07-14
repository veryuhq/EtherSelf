export interface CloneConfig {
  sourceGuildId: string | null;
  sourceGuildName: string | null;
  targetGuildId: string | null;
  targetGuildName: string | null;
  cloneRoles: boolean;
  cloneChannels: boolean;
  cloneEmojis: boolean;
  cloneSettings: boolean;
}

const cloneConfig = new Map<string, CloneConfig>();

export function getCloneConfig(userId: string): CloneConfig {
  let cfg = cloneConfig.get(userId);
  if (!cfg) {
    cfg = {
      sourceGuildId:   null,
      sourceGuildName: null,
      targetGuildId:   null,
      targetGuildName: null,
      cloneRoles:      true,
      cloneChannels:   true,
      cloneEmojis:     true,
      cloneSettings:   true,
    };
    cloneConfig.set(userId, cfg);
  }
  return cfg;
}
