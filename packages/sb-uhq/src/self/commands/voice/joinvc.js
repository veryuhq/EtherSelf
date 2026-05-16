"use strict";

const fs   = require("fs");
const path = require("path");
const { dataPath } = require("../../func/data-path");

const JOINVC_FILE = dataPath("config", "joinvc.json");

// ── Persistance ───────────────────────────────────────────────────────────────

function loadSaved() {
  try { return JSON.parse(fs.readFileSync(JOINVC_FILE, "utf-8")); }
  catch { return null; }
}

function saveCurrent(data) {
  fs.mkdirSync(path.dirname(JOINVC_FILE), { recursive: true });
  fs.writeFileSync(JOINVC_FILE, JSON.stringify(data, null, 2));
}

function clearSaved() {
  try { fs.unlinkSync(JOINVC_FILE); } catch {}
}

// ── Auto-rejoin au démarrage ──────────────────────────────────────────────────

async function autoRejoin(client) {
  const saved = loadSaved();
  if (!saved?.channelId) return;

  try {
    const channel = await client.channels.fetch(saved.channelId).catch(() => null);
    if (!channel) {
      console.log(`[JOINVC] Auto-rejoin : salon ${saved.channelId} introuvable, config effacée.`);
      clearSaved();
      return;
    }
    if (!["GUILD_VOICE", "GUILD_STAGE_VOICE"].includes(channel.type)) {
      clearSaved();
      return;
    }
    await client.voice.joinChannel(channel.id, { selfDeaf: true, selfMute: false });
    console.log(`[JOINVC] Auto-rejoin : connecté dans ${channel.name} (${channel.id})`);
  } catch (e) {
    console.error(`[JOINVC] Auto-rejoin échoué :`, e.message);
  }
}

// ── Logique pure ─────────────────────────────────────────────────────────────

/**
 * @param {import("discord.js-selfbot-v13").Client} client
 * @param {{ channelId?: string, action?: "leave"|"move"|"getState"|"getConfig" }} payload
 */
async function execute(client, payload) {
  const { channelId, action } = payload;

  // ── Helper : trouver le vocal actuel ──────────────────────────────────────
  function getCurrentVoice() {
    for (const guild of client.guilds.cache.values()) {
      const vs = guild.voiceStates?.cache.get(client.user.id);
      if (vs?.channelId) return { guild, vs };
    }
    return null;
  }

  // ── getState ───────────────────────────────────────────────────────────────
  if (action === "getState") {
    const current = getCurrentVoice();
    if (!current) return { joined: false, channelId: null, channelName: null, guildId: null, guildName: null };
    const { guild, vs } = current;
    return {
      joined:      true,
      channelId:   vs.channelId,
      channelName: vs.channel?.name ?? null,
      guildId:     guild.id,
      guildName:   guild.name ?? null,
    };
  }


  // ── getConfig ──────────────────────────────────────────────────────────────
  if (action === "getConfig") {
    const saved = loadSaved();
    if (!saved?.channelId) return { configured: false, channelId: null };
    return { configured: true, channelId: saved.channelId };
  }

  // ── leave ─────────────────────────────────────────────────────────────────
  if (action === "leave") {
    if (!channelId) throw new Error("channelId requis pour quitter le vocal.");
    const current = getCurrentVoice();
    if (!current) throw new Error("Le selfbot n'est dans aucun salon vocal.");
    if (current.vs.channelId !== channelId)
      throw new Error("Le selfbot n'est pas dans ce salon vocal.");
    current.guild.me?.voice.disconnect().catch(() => {});
    clearSaved();
    return { joined: false, channelId: null, channelName: null, guildId: null, guildName: null };
  }

  // ── move ──────────────────────────────────────────────────────────────────
  if (action === "move") {
    if (!channelId) throw new Error("channelId requis.");
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) throw new Error(`Salon vocal ${channelId} introuvable.`);
    if (!["GUILD_VOICE", "GUILD_STAGE_VOICE"].includes(channel.type))
      throw new Error("Ce salon n'est pas un salon vocal.");
    await client.voice.joinChannel(channel.id, { selfDeaf: true, selfMute: false });
    const result = {
      joined:      true,
      channelId:   channel.id,
      channelName: channel.name,
      guildId:     channel.guild?.id ?? null,
      guildName:   channel.guild?.name ?? null,
    };
    saveCurrent({ channelId: channel.id });
    return result;
  }

  // ── join ──────────────────────────────────────────────────────────────────
  if (channelId) {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) throw new Error(`Salon vocal ${channelId} introuvable.`);
    if (!["GUILD_VOICE", "GUILD_STAGE_VOICE"].includes(channel.type))
      throw new Error("Ce salon n'est pas un salon vocal.");
    await client.voice.joinChannel(channel.id, { selfDeaf: true, selfMute: false });
    const result = {
      joined:      true,
      channelId:   channel.id,
      channelName: channel.name,
      guildId:     channel.guild?.id ?? null,
      guildName:   channel.guild?.name ?? null,
    };
    saveCurrent({ channelId: channel.id });
    return result;
  }

  throw new Error("channelId ou action requis.");
}

module.exports = { name: "joinvc", execute, autoRejoin };