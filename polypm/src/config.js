'use strict';
/**
 * Chargement des fichiers « ecosystem » : la même idée que pm2, en JS ou JSON.
 *
 *   module.exports = { apps: [ { name, script, ... } ] }
 */
const fs = require('fs');
const path = require('path');

const CANDIDATES = [
  'ecosystem.config.js',
  'ecosystem.config.cjs',
  'ecosystem.config.json',
  'polypm.config.js',
  'polypm.config.cjs',
  'polypm.config.json',
  'apps.json',
];

function looksLikeConfig(target) {
  const base = path.basename(target);
  return CANDIDATES.includes(base) || /\.config\.(js|cjs|mjs|json)$/.test(base);
}

/** Cherche un fichier de config dans un dossier. */
function findConfig(dir) {
  for (const candidate of CANDIDATES) {
    const file = path.join(dir, candidate);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

/** Charge un fichier ecosystem et renvoie la liste des apps, cwd résolus. */
async function loadConfig(file) {
  const resolved = path.resolve(file);
  if (!fs.existsSync(resolved)) throw new Error(`fichier de configuration introuvable : ${resolved}`);

  let loaded;
  if (resolved.endsWith('.json')) {
    loaded = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } else if (resolved.endsWith('.mjs')) {
    loaded = (await import(`file://${resolved}`)).default;
  } else {
    delete require.cache[require.resolve(resolved)];
    loaded = require(resolved);
    if (loaded && loaded.default) loaded = loaded.default;
  }

  const apps = Array.isArray(loaded) ? loaded : (loaded && (loaded.apps || loaded.applications));
  if (!Array.isArray(apps)) throw new Error(`${resolved} : un tableau « apps » est attendu`);

  const baseDir = path.dirname(resolved);
  return apps.map((app) => ({ ...app, cwd: path.resolve(baseDir, app.cwd || '.') }));
}

module.exports = { loadConfig, findConfig, looksLikeConfig, CANDIDATES };
