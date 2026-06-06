// Basé sur ce projet :
// https://github.com/aiko-chan-ai/Discord-Quest-Auto-Completion-Selfbot
// Merci à aiko-chan....et à Claude !

"use strict";

const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

const { makeDesktopHeaders, makeAndroidHeaders } = require("./discord-client-headers");

/**
 * Effectue une requête à l'API Discord
 */
async function discordRequest(method, path, token, body = null, isAndroid = false) {
  const headers = isAndroid
    ? makeAndroidHeaders(token)
    : makeDesktopHeaders(token);

  const opts = {
    method,
    headers,
  };
  if (body !== null) {
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(`https://discord.com/api/v9${path}`, opts);
  const text = await res.text();

  let json;
  try { json = JSON.parse(text); }
  catch { json = { _raw: text }; }

  return { status: res.status, ok: res.ok, data: json };
}

/**
 * Récupère toutes les quêtes de l'utilisateur
 */
async function fetchQuests(token) {
  return discordRequest("GET", "/quests/@me", token);
}

/**
 * S'inscrire à une quête
 */
async function enrollQuest(token, questId, isAndroid = false) {
  return discordRequest("POST", `/quests/${questId}/enroll`, token, {
    location: isAndroid ? 12 : 11,
    is_targeted: false,
    metadata_raw: null,
    metadata_sealed: null,
  }, isAndroid);
}

/**
 * Soumettre la progression d'une vidéo
 */
async function postVideoProgress(token, questId, timestamp) {
  return discordRequest("POST", `/quests/${questId}/video-progress`, token, { timestamp });
}

/**
 * Envoyer un heartbeat (PLAY_ON_DESKTOP, PLAY_ACTIVITY, etc.)
 */
async function postHeartbeat(token, questId, body) {
  return discordRequest("POST", `/quests/${questId}/heartbeat`, token, body);
}

/**
 * Récupérer les informations d'une application publique
 */
async function fetchApplicationPublic(token, applicationId) {
  return discordRequest("GET", `/applications/public?application_ids=${applicationId}`, token);
}

/**
 * Autoriser une application OAuth2 (pour ACHIEVEMENT_IN_ACTIVITY)
 */
async function authorizeOAuth2(token, applicationId) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: applicationId,
    scope: "identify applications.commands applications.entitlements",
    state: "",
  });
  return discordRequest("POST", `/oauth2/authorize?${params.toString()}`, token, {
    permissions: "0",
    authorize: true,
    integration_type: 1,
    location_context: {
      guild_id: "10000",
      channel_id: "10000",
      channel_type: 10000,
    },
  });
}

/**
 * Lister les tokens OAuth2 actifs
 */
async function getOAuth2Tokens(token) {
  return discordRequest("GET", "/oauth2/tokens", token);
}

/**
 * Révoquer un token OAuth2
 */
async function deleteOAuth2Token(token, tokenId) {
  return discordRequest("DELETE", `/oauth2/tokens/${tokenId}`, token);
}

/**
 * Autoriser Discord Says (ACHIEVEMENT_IN_ACTIVITY)
 */
async function authorizeDiscordSays(applicationId, authCode) {
  const res = await fetch(
    `https://${applicationId}.discordsays.com/.proxy/acf/authorize`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: authCode }),
    }
  );
  const data = await res.json();
  return data.token || null;
}

/**
 * Progresser dans Discord Says (ACHIEVEMENT_IN_ACTIVITY)
 */
async function progressDiscordSays(applicationId, dsToken, questTarget) {
  const res = await fetch(
    `https://${applicationId}.discordsays.com/.proxy/acf/quest/progress`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-auth-token": dsToken,
      },
      body: JSON.stringify({ progress: questTarget }),
    }
  );
  return res.ok;
}

module.exports = {
  fetchQuests,
  enrollQuest,
  postVideoProgress,
  postHeartbeat,
  fetchApplicationPublic,
  authorizeOAuth2,
  getOAuth2Tokens,
  deleteOAuth2Token,
  authorizeDiscordSays,
  progressDiscordSays,
};