"use strict";

const fs   = require("fs");
const path = require("path");
const { dataPath } = require("../../func/data-path");

const STALK_FILE = dataPath("config", "stalk.json");

// ── I/O ──────────────────────────────────────────────────────────────────────

function load() {
  try { return JSON.parse(fs.readFileSync(STALK_FILE, "utf-8")); }
  catch { return { stalked: [] }; }
}

function save(data) {
  fs.mkdirSync(path.dirname(STALK_FILE), { recursive: true });
  fs.writeFileSync(STALK_FILE, JSON.stringify(data, null, 2));
}

// ── Event handler vocal (inchangé) ───────────────────────────────────────────

function handleVoiceStateUpdate(oldState, newState, client) {
  const data = load();
  if (!data.stalked.includes(newState.id ?? newState.member?.id)) return;
  if (oldState.channelId === newState.channelId) return;

  const user       = newState.member?.user ?? oldState.member?.user;
  const tag        = user?.tag ?? newState.id ?? oldState.id;
  const newChannel = newState.channel;
  const oldChannel = oldState.channel;

  if (!oldChannel && newChannel) {
    // A rejoint un vocal
    console.log(`[STALK] ${tag} a rejoint le salon vocal ${newChannel.name} (${newChannel.id})`);
  } else if (oldChannel && !newChannel) {
    // A quitté un vocal
    console.log(`[STALK] ${tag} a quitté le salon vocal ${oldChannel.name} (${oldChannel.id})`);
  } else if (oldChannel && newChannel) {
    // A changé de vocal
    console.log(`[STALK] ${tag} a changé de salon vocal : ${oldChannel.name} (${oldChannel.id}) → ${newChannel.name} (${newChannel.id})`);
  }
}

// ── Logique pure ─────────────────────────────────────────────────────────────

/**
 * @param {import("discord.js-selfbot-v13").Client} _client
 * @param {{ action: "add"|"remove"|"getList", userId?: string }} payload
 */
async function execute(_client, payload) {
  const { action, userId } = payload;
  const data = load();

  if (action === "getList") return { stalked: data.stalked };

  if (action === "add") {
    if (!userId) throw new Error("userId requis.");
    if (!data.stalked.includes(userId)) data.stalked.push(userId);
    save(data);
    return { stalked: data.stalked };
  }

  if (action === "remove") {
    if (!userId) throw new Error("userId requis.");
    data.stalked = data.stalked.filter(id => id !== userId);
    save(data);
    return { stalked: data.stalked };
  }

  throw new Error(`Action stalk inconnue : '${action}'`);
}

module.exports = { name: "stalk", execute, handleVoiceStateUpdate };
