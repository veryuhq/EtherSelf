"use strict";

const fs   = require("fs");
const path = require("path");
const { dataPath } = require("../../func/data-path");

const BOOKMARKS_FILE = dataPath("config", "bookmarks.json");

// ── I/O ──────────────────────────────────────────────────────────────────────

function load() {
  try { return JSON.parse(fs.readFileSync(BOOKMARKS_FILE, "utf-8")); }
  catch { return []; }
}

function save(data) {
  fs.mkdirSync(path.dirname(BOOKMARKS_FILE), { recursive: true });
  fs.writeFileSync(BOOKMARKS_FILE, JSON.stringify(data, null, 2));
}

// ── Logique pure ─────────────────────────────────────────────────────────────

/**
 * @param {import("discord.js-selfbot-v13").Client} _client
 * @param {{ action: "add"|"remove"|"list", channelId?: string }} payload
 */
async function execute(_client, payload) {
  const { action, channelId } = payload;
  const bookmarks = load();

  if (action === "list") return { bookmarks };

  if (action === "add") {
    if (!channelId) throw new Error("channelId requis.");
    if (!bookmarks.includes(channelId)) bookmarks.push(channelId);
    save(bookmarks);
    return { bookmarks };
  }

  if (action === "remove") {
    if (!channelId) throw new Error("channelId requis.");
    const filtered = bookmarks.filter(id => id !== channelId);
    save(filtered);
    return { bookmarks: filtered };
  }

  throw new Error(`Action bookmark inconnue : '${action}'`);
}

module.exports = { name: "bookmark", execute };
