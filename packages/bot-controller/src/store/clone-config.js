"use strict";

const cloneConfig = new Map();

function getCloneConfig(userId) {
  if (!cloneConfig.has(userId)) {
    cloneConfig.set(userId, {
      sourceGuildId:   null,
      sourceGuildName: null,
      targetGuildId:   null,
      targetGuildName: null,
      cloneRoles:      true,
      cloneChannels:   true,
      cloneEmojis:     true,
      cloneSettings:   true,
    });
  }
  return cloneConfig.get(userId);
}

module.exports = { getCloneConfig };