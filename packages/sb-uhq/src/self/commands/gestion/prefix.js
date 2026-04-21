"use strict";

const fs   = require("fs");
const path = require("path");
const { dataPath } = require("../../func/data-path");

const PREFIX_FILE    = dataPath("config", "prefix.json");
const DEFAULT_PREFIX = ".";

let cachedPrefix = null;

// ── I/O ──────────────────────────────────────────────────────────────────────

function loadPrefix() {
  if (cachedPrefix) return cachedPrefix;
  try {
    if (!fs.existsSync(PREFIX_FILE)) return _save(DEFAULT_PREFIX);
    const data = JSON.parse(fs.readFileSync(PREFIX_FILE, "utf8"));
    cachedPrefix = data.prefix || DEFAULT_PREFIX;
    return cachedPrefix;
  } catch {
    return _save(DEFAULT_PREFIX);
  }
}

function _save(prefix) {
  cachedPrefix = prefix;
  fs.mkdirSync(path.dirname(PREFIX_FILE), { recursive: true });
  fs.writeFileSync(PREFIX_FILE, JSON.stringify({ prefix }, null, 2));
  return prefix;
}

// ── Logique pure (bridge uniquement) ─────────────────────────────────────────

/**
 * @param {import("discord.js-selfbot-v13").Client} _client
 * @param {{ action: "set"|"get", prefix?: string }} payload
 */
async function execute(_client, payload) {
  const { action, prefix: newPrefix } = payload;

  if (action === "get") return { prefix: loadPrefix() };

  if (action === "set") {
    if (!newPrefix || newPrefix.length > 3)
      throw new Error("Le préfixe doit faire entre 1 et 3 caractères.");
    _save(newPrefix);
    return { prefix: newPrefix };
  }

  throw new Error(`Action prefix inconnue : '${action}'`);
}

module.exports = { name: "prefix", execute, loadPrefix };
