"use strict";

const fs   = require("fs");
const path = require("path");
const { dataPath } = require("../../func/data-path");

const AUTOBUMP_FILE = dataPath("config", "autobump.json");

const DEFAULT_BUMP_APP_ID = "302050872383242240";
const DEFAULT_BUMP_COMMAND = "bump";

let _interval = null;

// ── I/O ──────────────────────────────────────────────────────────────────────

function load() {
  try { return JSON.parse(fs.readFileSync(AUTOBUMP_FILE, "utf-8")); }
  catch { return {}; }
}

function save(data) {
  fs.mkdirSync(path.dirname(AUTOBUMP_FILE), { recursive: true });
  fs.writeFileSync(AUTOBUMP_FILE, JSON.stringify(data, null, 2));
}

// ── Bump loop ─────────────────────────────────────────────────────────────────

async function runBumps(client) {
  const data = loadConfig();
  for (const [guildId, guildConfig] of Object.entries(data.config ?? {})) {
    const normalized = normalizeGuildConfig(guildConfig);
    for (const channelId of normalized.channels) {
      try {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) {
          console.log(`[AUTOBUMP] Salon ${channelId} introuvable, skip.`);
          continue;
        }
        await channel.sendSlash(normalized.appId, normalized.commandName);
        console.log(`[AUTOBUMP] /${normalized.commandName} envoyé dans ${channel.name} (${channelId}) via ${normalized.appId}`);
      } catch (e) {
        console.error(`[AUTOBUMP] Erreur bump ${channelId} :`, e.message);
      }
    }
  }
}

function startAutoBump(client) {
  if (_interval) return false;
  _interval = setInterval(() => runBumps(client), 2 * 60 * 60 * 1000);
  return true;
}

function stopAutoBump() {
  if (!_interval) return false;
  clearInterval(_interval);
  _interval = null;
  return true;
}

// ── onReady ───────────────────────────────────────────────────────────────────

function onReady(client) {
  const raw = load();
  // Supporte l'ancien format (objet plat) et le nouveau (avec running)
  const running = raw.running === true;
  if (running) {
    startAutoBump(client);
    console.log("[AUTOBUMP] 🔄 Boucle relancée automatiquement au démarrage.");
  }
}

// ── Helpers pour lire/écrire la config proprement ────────────────────────────

function normalizeGuildConfig(guildConfig) {
  if (Array.isArray(guildConfig)) {
    return {
      channels: guildConfig,
      appId: DEFAULT_BUMP_APP_ID,
      commandName: DEFAULT_BUMP_COMMAND,
    };
  }

  return {
    channels: Array.isArray(guildConfig?.channels) ? guildConfig.channels : [],
    appId: String(guildConfig?.appId || DEFAULT_BUMP_APP_ID).trim(),
    commandName: String(guildConfig?.commandName || DEFAULT_BUMP_COMMAND).trim(),
  };
}

function normalizeConfig(config = {}) {
  return Object.fromEntries(
    Object.entries(config).map(([guildId, guildConfig]) => [guildId, normalizeGuildConfig(guildConfig)])
  );
}

function loadConfig() {
  const raw = load();
  const migrated = raw.config !== undefined
    ? { ...raw, config: normalizeConfig(raw.config) }
    : { running: false, config: normalizeConfig(raw) };
  save(migrated);
  return migrated;
}

function saveConfig(data) {
  save(data);
}

// ── Logique pure ─────────────────────────────────────────────────────────────

/**
 * @param {import("discord.js-selfbot-v13").Client} client
 * @param {{ action: "add"|"remove"|"start"|"stop"|"list", guildId?: string, channelId?: string, appId?: string, commandName?: string }} payload
 */
async function execute(client, payload) {
  const { action, guildId, channelId, appId, commandName } = payload;
  const data = loadConfig();

  if (action === "list") {
    return { config: data.config, running: _interval !== null };
  }

  if (action === "add") {
    if (!guildId || !channelId) throw new Error("guildId et channelId requis.");
    const cleanedAppId = String(appId || DEFAULT_BUMP_APP_ID).trim();
    const cleanedCommandName = String(commandName || DEFAULT_BUMP_COMMAND).trim().replace(/^\//, "");
    if (!cleanedAppId || !cleanedCommandName) throw new Error("APP ID et nom de commande requis.");
    data.config[guildId] ??= normalizeGuildConfig([]);
    data.config[guildId].appId = cleanedAppId;
    data.config[guildId].commandName = cleanedCommandName;
    if (!data.config[guildId].channels.includes(channelId)) {
      data.config[guildId].channels.push(channelId);
    }
    saveConfig(data);
    return { config: data.config };
  }

  if (action === "remove") {
    if (!guildId || !channelId) throw new Error("guildId et channelId requis.");
    const guildConfig = data.config[guildId];
    if (!guildConfig) throw new Error("Aucun salon configuré pour ce serveur.");
    const idx = guildConfig.channels.indexOf(channelId);
    if (idx === -1) throw new Error("Ce salon n'est pas enregistré.");
    guildConfig.channels.splice(idx, 1);
    saveConfig(data);
    return { config: data.config };
  }

  if (action === "start") {
    const empty = !Object.values(data.config).some(guildConfig => guildConfig.channels.length);
    if (empty) throw new Error("Aucun salon configuré pour l'autobump.");
    const started = startAutoBump(client);
    data.running = true;
    saveConfig(data);
    return { running: true, alreadyRunning: !started };
  }

  if (action === "stop") {
    const stopped = stopAutoBump();
    data.running = false;
    saveConfig(data);
    return { running: false, wasStopped: stopped };
  }

  throw new Error(`Action autobump inconnue : '${action}'`);
}

module.exports = { name: "autobump", execute, startAutoBump, stopAutoBump, onReady };
