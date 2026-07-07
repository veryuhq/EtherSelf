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
async function enrollQuest(token, quest, isAndroid = false) {
  return discordRequest("POST", `/quests/${quest.id}/enroll`, token, {
    location: isAndroid ? 12 : 11,
    is_targeted: false,
    metadata_sealed: null,
    traffic_metadata_raw: quest.traffic_metadata_raw,
    traffic_metadata_sealed: quest.traffic_metadata_sealed,
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
 * Demander un proxy ticket Discord pour construire le referrer Discord Says.
 */
async function getProxyTicket(token, applicationId) {
  const res = await discordRequest("POST", `/applications/${applicationId}/proxy-tickets`, token, {});
  if (!res.ok || !res.data?.ticket) {
    throw new Error(`Proxy ticket failed (${res.status}): ${JSON.stringify(res.data)}`);
  }
  return res.data.ticket;
}

/**
 * Construire le referrer attendu par Discord Says.
 */
async function getActivityReferrer(token, applicationId) {
  const proxyTicket = await getProxyTicket(token, applicationId);
  const referrer = new URL(`https://${applicationId}.discordsays.com/`);
  referrer.searchParams.set("instance_id", "example-cl-instance");
  referrer.searchParams.set("platform", "desktop");
  referrer.searchParams.set("discord_proxy_ticket", proxyTicket);
  return referrer.toString();
}

function makeActivityHeaders(questId, dsToken = "", activityReferrer = null) {
  const headers = {
    "Content-Type": "application/json",
    "X-Auth-Token": dsToken,
    "X-Discord-Quest-ID": questId,
  };
  if (activityReferrer) headers.Referer = activityReferrer;
  return headers;
}

/**
 * Autoriser Discord Says (ACHIEVEMENT_IN_ACTIVITY)
 */
async function authorizeDiscordSays(discordToken, applicationId, questId, authCode) {
  const activityReferrer = await getActivityReferrer(discordToken, applicationId);
  const res = await fetch(
    `https://${applicationId}.discordsays.com/.proxy/acf/authorize`,
    {
      method: "POST",
      headers: makeActivityHeaders(questId, "", activityReferrer),
      body: JSON.stringify({ code: authCode }),
    }
  );
  const data = await res.json().catch(() => ({}));
  return { token: data.token || null, activityReferrer };
}

/**
 * Progresser dans Discord Says (ACHIEVEMENT_IN_ACTIVITY)
 */
async function progressDiscordSays(applicationId, questId, dsToken, questTarget, activityReferrer) {
  const res = await fetch(
    `https://${applicationId}.discordsays.com/.proxy/acf/quest/progress`,
    {
      method: "POST",
      headers: makeActivityHeaders(questId, dsToken, activityReferrer),
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
  getProxyTicket,
  getActivityReferrer,
  authorizeDiscordSays,
  progressDiscordSays,
};
