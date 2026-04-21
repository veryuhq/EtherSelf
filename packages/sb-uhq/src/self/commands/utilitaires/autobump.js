"use strict";

const fs   = require("fs");
const path = require("path");
const { dataPath } = require("../../func/data-path");

const AUTOBUMP_FILE = dataPath("config", "autobump.json");

// ID du bot Disboard
const DISBOARD_BOT_ID = "302050872383242240";

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
  const data = load();
  for (const [guildId, channels] of Object.entries(data.config ?? data)) {
    if (!Array.isArray(channels)) continue;
    for (const channelId of channels) {
      try {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) {
          console.log(`[AUTOBUMP] Salon ${channelId} introuvable, skip.`);
          continue;
        }
        await channel.sendSlash(DISBOARD_BOT_ID, "bump");
        console.log(`[AUTOBUMP] /bump envoyé dans ${channel.name} (${channelId})`);
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

function loadConfig() {
  const raw = load();
  // Migration : si l'ancien format était un objet plat guildId -> channels[]
  if (raw.config !== undefined) {
    return raw;
  }
  // Ancien format : { guildId: [channelId, ...], ... }
  // On le migre vers { running: false, config: { ... } }
  const migrated = { running: false, config: raw };
  save(migrated);
  return migrated;
}

function saveConfig(data) {
  save(data);
}

// ── Logique pure ─────────────────────────────────────────────────────────────

/**
 * @param {import("discord.js-selfbot-v13").Client} client
 * @param {{ action: "add"|"remove"|"start"|"stop"|"list", guildId?: string, channelId?: string }} payload
 */
async function execute(client, payload) {
  const { action, guildId, channelId } = payload;
  const data = loadConfig();

  if (action === "list") {
    return { config: data.config, running: _interval !== null };
  }

  if (action === "add") {
    if (!guildId || !channelId) throw new Error("guildId et channelId requis.");
    data.config[guildId] ??= [];
    if (data.config[guildId].includes(channelId))
      throw new Error("Ce salon est déjà configuré.");
    data.config[guildId].push(channelId);
    saveConfig(data);
    return { config: data.config };
  }

  if (action === "remove") {
    if (!guildId || !channelId) throw new Error("guildId et channelId requis.");
    const channels = data.config[guildId];
    if (!channels) throw new Error("Aucun salon configuré pour ce serveur.");
    const idx = channels.indexOf(channelId);
    if (idx === -1) throw new Error("Ce salon n'est pas enregistré.");
    channels.splice(idx, 1);
    if (!channels.length) delete data.config[guildId];
    saveConfig(data);
    return { config: data.config };
  }

  if (action === "start") {
    const empty = !Object.keys(data.config).length;
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