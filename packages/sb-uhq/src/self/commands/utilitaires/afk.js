"use strict";

const fs   = require("fs");
const path = require("path");
const { dataPath } = require("../../func/data-path");

const AFK_FILE = dataPath("config", "afk.json");

// ── I/O ──────────────────────────────────────────────────────────────────────

function load() {
  try { return JSON.parse(fs.readFileSync(AFK_FILE, "utf-8")); }
  catch { return { enabled: false, special: false, reason: "", excluded: [], notified: [], messageNormal: null, messageSpecial: null }; }
}

function save(data) {
  fs.mkdirSync(path.dirname(AFK_FILE), { recursive: true });
  fs.writeFileSync(AFK_FILE, JSON.stringify(data, null, 2));
}

// ── Logique pure ─────────────────────────────────────────────────────────────

/**
 * @param {import("discord.js-selfbot-v13").Client} _client
 * @param {{ action: string, [key: string]: any }} payload
 */
async function execute(_client, payload) {
  const { action } = payload;
  const data = load();

  switch (action) {
    case "getState":
      return data;

    case "toggle":
      data.enabled = !data.enabled;
      save(data);
      return data;

    case "toggleSpecial":
      data.special = !data.special;
      save(data);
      return data;

    case "setReason":
      data.reason = payload.reason ?? "";
      save(data);
      return data;

    case "setMsgNormal":
      data.messageNormal = payload.message || null;
      save(data);
      return data;

    case "setMsgSpecial":
      data.messageSpecial = payload.message || null;
      save(data);
      return data;

    case "addExclusion": {
      if (!payload.userId) throw new Error("userId requis.");
      if (!data.excluded.includes(payload.userId)) data.excluded.push(payload.userId);
      save(data);
      return data;
    }

    case "removeExclusion":
      if (!payload.userId) throw new Error("userId requis.");
      data.excluded = data.excluded.filter(id => id !== payload.userId);
      save(data);
      return data;

    default:
      throw new Error(`Action afk inconnue : '${action}'`);
  }
}

// ── Listener messageCreate pour la réponse AFK ───────────────────────────────

function handleIncomingMessage(message, client) {
  const data = load();
  if (!data.enabled) return;
  if (message.author.id === client.user.id) return;
  if (data.excluded.includes(message.author.id)) return;
  if (data.excluded.includes(message.guild?.id)) return;
  if (data.notified.includes(message.author.id)) return;

  const msg = data.special && data.messageSpecial
    ? data.messageSpecial
    : data.messageNormal ?? `Je suis AFK${data.reason ? ` — ${data.reason}` : ""}.`;

  message.channel.send(msg).catch(() => {});

  data.notified.push(message.author.id);
  save(data);
}

module.exports = { name: "afk", execute, handleIncomingMessage };