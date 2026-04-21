"use strict";

const fs   = require("fs");
const path = require("path");
const { dataPath } = require("../../func/data-path");

const NITRO_FILE = dataPath("config", "nitro.json");
const CLAIMED_FILE = dataPath("logs", "nitro_claimed.json");

// ── Regex patterns pour détecter les codes Nitro ─────────────────────────────
const NITRO_REGEX = /(discord\.gift\/|discord\.com\/gifts\/|discordapp\.com\/gifts\/)([a-zA-Z0-9]{16,25})/gi;

// ── I/O ──────────────────────────────────────────────────────────────────────

function load() {
  try { return JSON.parse(fs.readFileSync(NITRO_FILE, "utf-8")); }
  catch { return { enabled: false, notifyOnClaim: true, notifyOnFail: false, excludedGuilds: [] }; }
}

function save(data) {
  fs.mkdirSync(path.dirname(NITRO_FILE), { recursive: true });
  fs.writeFileSync(NITRO_FILE, JSON.stringify(data, null, 2));
}

function loadClaimedHistory() {
  try { return JSON.parse(fs.readFileSync(CLAIMED_FILE, "utf-8")); }
  catch { return []; }
}

function saveClaimedHistory(history) {
  fs.mkdirSync(path.dirname(CLAIMED_FILE), { recursive: true });
  fs.writeFileSync(CLAIMED_FILE, JSON.stringify(history, null, 2));
}

// ── Claim Nitro ──────────────────────────────────────────────────────────────

async function claimNitro(client, code) {
  try {
    // Endpoint Discord pour claim un code gift
    const response = await fetch(`https://discord.com/api/v9/entitlements/gift-codes/${code}/redeem`, {
      method: "POST",
      headers: {
        "Authorization": client.token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel_id: null,
        payment_source_id: null
      }),
    });

    const data = await response.json();
    
    if (response.status === 200) {
      return { success: true, data };
    } else {
      return { success: false, error: data.message || "Claim échoué", code: response.status };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ── Event handler messageCreate ──────────────────────────────────────────────

async function handleNitroMessage(message, client) {
  const config = load();
  if (!config.enabled) return;
  
  // Ne pas traiter ses propres messages
  if (message.author.id === client.user.id) return;

  // Vérifier si le serveur est exclu
  if (message.guild && config.excludedGuilds.includes(message.guild.id)) {
    return;
  }

  const matches = [...message.content.matchAll(NITRO_REGEX)];
  if (!matches.length) return;

  for (const match of matches) {
    const code = match[2];
    
    console.log(`[NITRO] 🎁 Code détecté : ${code} dans #${message.channel.name || message.channel.id}`);

    // Délai aléatoire entre 100ms et 500ms pour paraître plus humain
    const delay = Math.floor(Math.random() * 400) + 100;
    await new Promise(r => setTimeout(r, delay));

    const result = await claimNitro(client, code);
    
    const entry = {
      code,
      timestamp: Date.now(),
      success: result.success,
      channelId: message.channel.id,
      channelName: message.channel.name || null,
      guildId: message.guild?.id || null,
      guildName: message.guild?.name || null,
      authorId: message.author.id,
      authorTag: message.author.tag,
      error: result.error || null,
      messageUrl: message.url,
    };

    // Sauvegarder dans l'historique
    const history = loadClaimedHistory();
    history.push(entry);
    if (history.length > 100) history.shift();
    saveClaimedHistory(history);

    if (result.success) {
      console.log(`[NITRO] ✅ Code ${code} claim avec succès !`);
      if (config.notifyOnClaim) {
        const guildInfo = message.guild ? `${message.guild.name} (#${message.channel.name})` : "MP";
        console.log(`[NITRO] 🎉 Nitro claim depuis ${guildInfo} — Code : ${code}`);
      }
    } else {
      console.log(`[NITRO] ❌ Échec claim ${code} : ${result.error}`);
      if (config.notifyOnFail) {
        console.log(`[NITRO] ⚠️ Échec : ${result.error}`);
      }
    }
  }
}

// ── Logique pure (bridge) ────────────────────────────────────────────────────

/**
 * @param {import("discord.js-selfbot-v13").Client} client
 * @param {{ action: "toggle"|"getState"|"getHistory"|"clearHistory"|"setNotifyOnClaim"|"setNotifyOnFail"|"addExclusion"|"removeExclusion"|"getExclusions" }} payload
 */
async function execute(client, payload) {
  const { action } = payload;
  const config = load();

  if (action === "getState") {
    return config;
  }

  if (action === "toggle") {
    config.enabled = !config.enabled;
    save(config);
    return config;
  }

  if (action === "setNotifyOnClaim") {
    config.notifyOnClaim = payload.value ?? true;
    save(config);
    return config;
  }

  if (action === "setNotifyOnFail") {
    config.notifyOnFail = payload.value ?? false;
    save(config);
    return config;
  }

  if (action === "addExclusion") {
    if (!payload.guildId) throw new Error("guildId requis.");
    if (!config.excludedGuilds) config.excludedGuilds = [];
    if (!config.excludedGuilds.includes(payload.guildId)) {
      config.excludedGuilds.push(payload.guildId);
    }
    save(config);
    return config;
  }

  if (action === "removeExclusion") {
    if (!payload.guildId) throw new Error("guildId requis.");
    if (!config.excludedGuilds) config.excludedGuilds = [];
    config.excludedGuilds = config.excludedGuilds.filter(id => id !== payload.guildId);
    save(config);
    return config;
  }

  if (action === "getExclusions") {
    if (!config.excludedGuilds) config.excludedGuilds = [];
    // Résoudre les noms depuis le cache client
    const guilds = config.excludedGuilds.map(id => ({
      id,
      name: client?.guilds?.cache?.get(id)?.name ?? null,
    }));
    return { excludedGuilds: config.excludedGuilds, guilds };
  }

  if (action === "getHistory") {
    const history = loadClaimedHistory();
    return { history };
  }

  if (action === "clearHistory") {
    saveClaimedHistory([]);
    return { history: [] };
  }

  throw new Error(`Action nitro inconnue : '${action}'`);
}

module.exports = { name: "nitro", execute, handleNitroMessage };