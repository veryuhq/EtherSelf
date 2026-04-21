"use strict";

const path = require("path");

// Racine du package sb-uhq (4 niveaux au-dessus de src/self/func/)
const SB_ROOT = path.resolve(__dirname, "../../..");

/**
 * Résout un chemin relatif à data/ du selfbot,
 * indépendamment du working directory du process (pm2, etc.)
 * @param {...string} segments
 * @returns {string}
 */
function dataPath(...segments) {
  return path.join(SB_ROOT, "data", ...segments);
}

module.exports = { dataPath, SB_ROOT };