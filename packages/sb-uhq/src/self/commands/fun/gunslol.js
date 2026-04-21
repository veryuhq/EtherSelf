"use strict";

const fs   = require("fs");
const path = require("path");
const { dataPath } = require("../../func/data-path");

const GUNSLOL_FILE = dataPath("config", "gunslol.json");

let _interval = null;

// ── I/O ──────────────────────────────────────────────────────────────────────

function load() {
  try { return JSON.parse(fs.readFileSync(GUNSLOL_FILE, "utf-8")); }
  catch { return { enabled: false, link: null, customMessage: null }; }
}

function save(data) {
  fs.mkdirSync(path.dirname(GUNSLOL_FILE), { recursive: true });
  fs.writeFileSync(GUNSLOL_FILE, JSON.stringify(data, null, 2));
}

// ── Timer d'envoi automatique ─────────────────────────────────────────────────

async function sendGunslol(client) {
  const data = load();
  if (!data.enabled || !data.link || !data.channelId) return;
  try {
    const channel = await client.channels.fetch(data.channelId).catch(() => null);
    if (!channel) {
      console.error("[GUNSLOL] Salon introuvable :", data.channelId);
      return;
    }
    const msg = data.customMessage
      ? data.customMessage.replace("{link}", data.link)
      : data.link;
    await channel.send(msg);
    console.log(`[GUNSLOL] Message envoyé dans ${channel.name} (${data.channelId})`);
  } catch (e) {
    console.error("[GUNSLOL] Erreur envoi :", e.message);
  }
}

function startLoop(client) {
  if (_interval) return;
  _interval = setInterval(() => sendGunslol(client), 30 * 60 * 1000);
}

function stopLoop() {
  if (!_interval) return;
  clearInterval(_interval);
  _interval = null;
}

// ── onReady (déclenché depuis index.js) ───────────────────────────────────────

function onReady(client) {
  const data = load();
  if (data.enabled && data.link) startLoop(client);
}

// ── Logique pure ─────────────────────────────────────────────────────────────

/**
 * @param {import("discord.js-selfbot-v13").Client} client
 * @param {{ action: "toggle"|"setLink"|"setMsg"|"resetMsg"|"getState" }} payload
 */
async function execute(client, payload) {
  const { action } = payload;
  const data = load();

  if (action === "getState") return data;

  if (action === "toggle") {
    const validLink    = typeof data.link === "string" && data.link.startsWith("https://guns.lol/");
    const validChannel = typeof data.channelId === "string" && data.channelId.length > 0;
    if (!data.enabled && !validLink)
      throw new Error("Définis un lien guns.lol valide avant d'activer.");
    if (!data.enabled && !validChannel)
      throw new Error("Définis un salon d'envoi avant d'activer.");
    data.enabled = !data.enabled;
    save(data);
    if (data.enabled) startLoop(client);
    else stopLoop();
    return data;
  }

  if (action === "setChannel") {
    if (!payload.channelId) throw new Error("channelId requis.");
    data.channelId = payload.channelId;
    save(data);
    return data;
  }

  if (action === "setLink") {
    if (!payload.link?.startsWith("https://guns.lol/"))
      throw new Error("Le lien doit commencer par https://guns.lol/");
    data.link = payload.link;
    save(data);
    return data;
  }

  if (action === "setMsg") {
    data.customMessage = payload.message || null;
    save(data);
    return data;
  }

  if (action === "resetMsg") {
    data.customMessage = null;
    save(data);
    return data;
  }

  throw new Error(`Action gunslol inconnue : '${action}'`);
}

module.exports = { name: "gunslol", execute, onReady };
