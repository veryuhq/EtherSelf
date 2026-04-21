"use strict";

const fs   = require("fs");
const path = require("path");
const { dataPath } = require("../../func/data-path");

const MSGBM_FILE = dataPath("config", "msgbookmarks.json");

// ── I/O ──────────────────────────────────────────────────────────────────────

function load() {
  try { return JSON.parse(fs.readFileSync(MSGBM_FILE, "utf-8")); }
  catch { return []; }
}

function save(data) {
  fs.mkdirSync(path.dirname(MSGBM_FILE), { recursive: true });
  fs.writeFileSync(MSGBM_FILE, JSON.stringify(data, null, 2));
}

// ── Logique pure ─────────────────────────────────────────────────────────────

/**
 * @param {import("discord.js-selfbot-v13").Client} client
 * @param {{ action: "list"|"add"|"remove"|"note"|"clear", url?: string, note?: string, index?: number }} payload
 */
async function execute(client, payload) {
  const { action, index, note } = payload;
  let bookmarks = load();

  if (action === "list") return { bookmarks };

  if (action === "add") {
    if (!payload.url) throw new Error("url requis.");

    // Parser l'URL Discord : https://discord.com/channels/guildId/channelId/messageId
    const match = payload.url.match(/discord\.com\/channels\/(\d+|@me)\/(\d+)\/(\d+)/);
    if (!match) throw new Error("URL de message Discord invalide.");

    const [, guildId, channelId, messageId] = match;

    // Tenter de récupérer le message pour avoir auteur + contenu
    let authorTag = "Inconnu";
    let content   = "";

    try {
      // Récupérer le salon depuis le cache d'abord, puis fetch si absent
      let channel = client.channels.cache.get(channelId);
      if (!channel) {
        channel = await client.channels.fetch(channelId).catch(() => null);
      }

      if (channel) {
        // Fetch le message directement par son ID
        const msg = await channel.messages.fetch(messageId).catch(() => null);
        if (msg) {
          // Récupérer le tag de l'auteur — username#discriminator ou juste username
          const author = msg.author;
          if (author) {
            // discord.js-selfbot-v13 : discriminator "0" = nouveau système sans #tag
            if (author.discriminator && author.discriminator !== "0") {
              authorTag = `${author.username}#${author.discriminator}`;
            } else {
              authorTag = author.username ?? author.tag ?? "Inconnu";
            }
          }
          // Contenu du message (texte brut, peut être vide si embed/attachment only)
          content = msg.content ?? "";
          if (!content && msg.embeds?.length) {
            // Fallback : titre du premier embed si pas de contenu texte
            content = msg.embeds[0]?.title ?? msg.embeds[0]?.description ?? "";
          }
          content = content.slice(0, 500);
        }
      }
    } catch (err) {
      console.error("[MSGBM] Erreur fetch message :", err.message);
    }

    bookmarks.push({
      messageId,
      channelId,
      guildId:  guildId === "@me" ? null : guildId,
      authorTag,
      content,
      url:     payload.url,
      savedAt: Date.now(),
      note:    payload.note || null,
    });
    if (bookmarks.length > 200) bookmarks.shift();
    save(bookmarks);
    return { bookmarks };
  }

  if (action === "clear") {
    save([]);
    return { bookmarks: [] };
  }

  if (action === "remove") {
    const idx = (index ?? 1) - 1;
    if (idx < 0 || idx >= bookmarks.length)
      throw new Error(`Index invalide (1–${bookmarks.length}).`);
    bookmarks.splice(idx, 1);
    save(bookmarks);
    return { bookmarks };
  }

  if (action === "note") {
    const idx = (index ?? 1) - 1;
    if (idx < 0 || idx >= bookmarks.length)
      throw new Error(`Index invalide (1–${bookmarks.length}).`);
    bookmarks[idx].note = note || null;
    save(bookmarks);
    return { bookmarks };
  }

  throw new Error(`Action msgbookmarks inconnue : '${action}'`);
}

// ── Listener messageCreate pour sauvegarder les messages bookmarkés ──────────

async function handleBookmarkReaction(message, client) {
  const bookmarks = load();

  const author = message.author;
  let authorTag = "Inconnu";
  if (author) {
    if (author.discriminator && author.discriminator !== "0") {
      authorTag = `${author.username}#${author.discriminator}`;
    } else {
      authorTag = author.username ?? author.tag ?? "Inconnu";
    }
  }

  bookmarks.push({
    messageId:  message.id,
    channelId:  message.channel.id,
    guildId:    message.guild?.id ?? null,
    authorTag,
    content:    (message.content ?? "").slice(0, 500),
    url:        message.url,
    savedAt:    Date.now(),
    note:       null,
  });
  if (bookmarks.length > 200) bookmarks.shift();
  save(bookmarks);
}

module.exports = { name: "msgbookmarks", execute, handleBookmarkReaction };