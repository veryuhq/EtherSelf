"use strict";

const fs   = require("fs");
const path = require("path");
const { dataPath } = require("../../func/data-path");

const ANTIGROUP_FILE = dataPath("config", "antigroup.json");

// ── I/O ──────────────────────────────────────────────────────────────────────

function getState() {
  try {
    if (!fs.existsSync(ANTIGROUP_FILE)) return false;
    return JSON.parse(fs.readFileSync(ANTIGROUP_FILE, "utf-8")).enabled === true;
  } catch { return false; }
}

function setState(enabled) {
  fs.mkdirSync(path.dirname(ANTIGROUP_FILE), { recursive: true });
  fs.writeFileSync(ANTIGROUP_FILE, JSON.stringify({ enabled }, null, 2));
}

// ── Event handler Discord ─────────────────────────────────────────────────────

async function handleChannelCreate(client, channel) {
  if (channel.type !== "GROUP_DM" || channel.ownerId === client.user.id || !getState()) return;
  console.log(`[ANTIGROUP] Groupe DM détecté (${channel.id}), je quitte.`);
  channel.delete().catch(() => {});
}

// ── Logique pure (bridge uniquement) ─────────────────────────────────────────

/**
 * @param {import("discord.js-selfbot-v13").Client} client
 * @param {{ action: "toggle"|"getState"|"leaveAll" }} payload
 */
async function execute(client, payload) {
  const { action } = payload;

  if (action === "getState") return { enabled: getState() };

  if (action === "toggle") {
    const newState = !getState();
    setState(newState);
    return { enabled: newState };
  }

  if (action === "leaveAll") {
    // Fetch tous les channels depuis l'API pour ne pas se limiter au cache
    // (le cache ne contient que les channels actifs depuis le démarrage)
    await client.channels.fetch().catch(() => {});
    const groups = [...client.channels.cache.values()].filter(
      c => c.type === "GROUP_DM"
    );

    let left  = 0;
    let failed = 0;
    const details = [];

    for (const group of groups) {
      try {
        const name = group.name ?? `Groupe (${group.id})`;
        await group.delete();
        left++;
        console.log(`[ANTIGROUP] Quitté le groupe "${name}" (${group.id})`);
        details.push({ id: group.id, name, success: true });
      } catch (err) {
        failed++;
        console.error(`[ANTIGROUP] Impossible de quitter le groupe ${group.id} : ${err.message}`);
        details.push({ id: group.id, name: group.name ?? group.id, success: false, error: err.message });
      }
      // Petit délai pour éviter le rate-limit
      await new Promise(r => setTimeout(r, 300));
    }

    return { left, failed, total: groups.length, details };
  }

  throw new Error(`Action antigroup inconnue : '${action}'`);
}

module.exports = { name: "antigroup", execute, handleChannelCreate };