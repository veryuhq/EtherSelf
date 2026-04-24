"use strict";

const fs = require("fs");
const path = require("path");
const { dataPath } = require("../../func/data-path");

const BACKUP_FRIENDS_FILE = dataPath("logs", "backup_friends.json");
const BACKUP_SERVERS_FILE = dataPath("logs", "backup_servers.json");

const API_BASE = "https://discord.com/api/v9";
const DEFAULT_DELAY_MS = Number(process.env.BACKUPS_DELAY_MS ?? 900);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureDir(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf-8")); }
  catch { return fallback; }
}

function writeJson(file, data) {
  ensureDir(file);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function getAuthToken(client) {
  return client?.token ?? process.env.TOKEN ?? null;
}

async function discordRequest(client, method, endpoint, body = null, retry = 0) {
  const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));
  const token = getAuthToken(client);
  if (!token) throw new Error("Token introuvable pour requêtes Discord.");

  const res = await fetch(`${API_BASE}${endpoint}`, {
    method,
    headers: {
      "Authorization": token,
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0",
      "x-discord-locale": "fr",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 429 && retry < 8) {
    let retryAfterMs = 1500;
    try {
      const j = await res.json();
      retryAfterMs = Math.max(500, Math.ceil((j?.retry_after ?? 1.5) * 1000));
    } catch {}
    await sleep(retryAfterMs + 150);
    return discordRequest(client, method, endpoint, body, retry + 1);
  }

  return res;
}

function trimHistory(history, max = 20) {
  if (history.length <= max) return history;
  return history.slice(history.length - max);
}

async function fetchFriendsApi(client) {
  const res = await discordRequest(client, "GET", "/users/@me/relationships");
  if (!res.ok) throw new Error(`HTTP ${res.status} sur /relationships`);
  const rows = await res.json();
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r?.type === 1 && r?.user?.id)
    .map((r) => ({
      id: r.user.id,
      username: r.user.username ?? "unknown",
      displayName: r.user.global_name ?? r.user.display_name ?? r.user.username ?? "unknown",
    }));
}

function fetchFriendsCache(client) {
  const rel = client?.relationships?.friendCache;
  if (!rel || typeof rel.values !== "function") return [];
  return [...rel.values()].map((u) => ({
    id: u.id,
    username: u.username ?? "unknown",
    displayName: u.globalName ?? u.displayName ?? u.username ?? "unknown",
  }));
}

async function backupFriends(client) {
  const db = readJson(BACKUP_FRIENDS_FILE, { latest: null, history: [] });

  let friends = [];
  let source = "api";
  try {
    friends = await fetchFriendsApi(client);
  } catch {
    source = "cache";
    friends = fetchFriendsCache(client);
    if (!friends.length && db.latest?.friends?.length) {
      source = "backup";
      friends = db.latest.friends;
    }
  }

  const snapshot = {
    timestamp: Date.now(),
    total: friends.length,
    source,
    friends,
  };

  db.latest = snapshot;
  db.history = trimHistory([...(db.history ?? []), snapshot]);
  writeJson(BACKUP_FRIENDS_FILE, db);
  return snapshot;
}

async function restoreFriends(client) {
  const db = readJson(BACKUP_FRIENDS_FILE, { latest: null, history: [] });
  const list = db?.latest?.friends ?? [];
  if (!list.length) throw new Error("Aucune sauvegarde d'amis disponible.");

  let restored = 0;
  let failed = 0;
  for (const f of list) {
    try {
      const res = await discordRequest(client, "PUT", `/users/@me/relationships/${f.id}`);
      if (res.ok || res.status === 204) restored++;
      else failed++;
    } catch {
      failed++;
    }
    await sleep(DEFAULT_DELAY_MS);
  }

  db.lastRestore = { timestamp: Date.now(), total: list.length, restored, failed };
  writeJson(BACKUP_FRIENDS_FILE, db);
  return db.lastRestore;
}

async function createPermanentInvite(client, guild, cachedByGuild) {
  try {
    if (guild?.invites?.fetch) {
      const existing = await guild.invites.fetch().catch(() => null);
      if (existing) {
        const perm = [...existing.values()].find((inv) => (inv.maxAge ?? 0) === 0 && (inv.maxUses ?? 0) === 0);
        if (perm?.url) return perm.url;
      }
    }
  } catch {}

  const textChannel = [...guild.channels.cache.values()].find((ch) => {
    if (!ch) return false;
    const type = String(ch.type ?? "");
    if (!type.includes("TEXT")) return false;
    const perms = ch.permissionsFor?.(client.user);
    return perms?.has?.("CREATE_INSTANT_INVITE");
  });

  if (textChannel?.createInvite) {
    try {
      const inv = await textChannel.createInvite({
        maxAge: 0,
        maxUses: 0,
        unique: true,
        reason: "Backup Servers",
      });
      if (inv?.url) return inv.url;
    } catch {}
  }

  return cachedByGuild.get(guild.id) ?? null;
}

async function backupServers(client) {
  const db = readJson(BACKUP_SERVERS_FILE, { latest: null, history: [] });
  const previous = db?.latest?.servers ?? [];
  const cachedByGuild = new Map(previous.map((s) => [s.guildId, s.inviteUrl]).filter((x) => x[1]));

  const guilds = [...client.guilds.cache.values()];
  const servers = [];

  for (const guild of guilds) {
    const inviteUrl = await createPermanentInvite(client, guild, cachedByGuild);
    servers.push({
      guildId: guild.id,
      name: guild.name ?? guild.id,
      inviteUrl,
    });
    await sleep(DEFAULT_DELAY_MS);
  }

  const snapshot = {
    timestamp: Date.now(),
    total: servers.length,
    withInvite: servers.filter((s) => !!s.inviteUrl).length,
    servers,
  };
  db.latest = snapshot;
  db.history = trimHistory([...(db.history ?? []), snapshot]);
  writeJson(BACKUP_SERVERS_FILE, db);
  return snapshot;
}

function normalizeCode(invite) {
  if (!invite) return null;
  return String(invite).replace(/^https?:\/\/(www\.)?discord\.gg\//, "").trim();
}

async function joinInvite(client, inviteUrl) {
  const code = normalizeCode(inviteUrl);
  if (!code) return false;

  if (typeof client?.acceptInvite === "function") {
    try {
      await client.acceptInvite(code);
      return true;
    } catch {}
  }

  try {
    const res = await discordRequest(client, "POST", `/invites/${code}`, {});
    return res.ok;
  } catch {
    return false;
  }
}

async function restoreServers(client) {
  const db = readJson(BACKUP_SERVERS_FILE, { latest: null, history: [] });
  const list = db?.latest?.servers ?? [];
  if (!list.length) throw new Error("Aucune sauvegarde de serveurs disponible.");

  let restored = 0;
  let failed = 0;
  for (const s of list) {
    if (!s.inviteUrl) { failed++; continue; }
    const ok = await joinInvite(client, s.inviteUrl);
    if (ok) restored++;
    else failed++;
    await sleep(DEFAULT_DELAY_MS);
  }

  db.lastRestore = { timestamp: Date.now(), total: list.length, restored, failed };
  writeJson(BACKUP_SERVERS_FILE, db);
  return db.lastRestore;
}

async function execute(client, payload = {}) {
  const { action } = payload;

  if (action === "getState") {
    const friends = readJson(BACKUP_FRIENDS_FILE, { latest: null, history: [], lastRestore: null });
    const servers = readJson(BACKUP_SERVERS_FILE, { latest: null, history: [], lastRestore: null });
    return { friends, servers };
  }

  if (action === "friends.backup") return backupFriends(client);
  if (action === "friends.restore") return restoreFriends(client);
  if (action === "servers.backup") return backupServers(client);
  if (action === "servers.restore") return restoreServers(client);

  throw new Error(`Action backups inconnue : '${action}'`);
}

module.exports = { name: "backups", execute };

