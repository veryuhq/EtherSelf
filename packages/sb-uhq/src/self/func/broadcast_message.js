"use strict";

// ─────────────────────────────────────────────────────────────────────────────
//  BROADCAST — Logs envoyés en MP par le bot-controller
//
//  Le selfbot (sb-uhq) ne crée plus de groupe DM.
//  Les logs console sont transmis au bot-controller via le bridge HTTP,
//  qui les relaie en MP à OWNER_ID.
//
//  Du côté sb-uhq, on expose simplement un endpoint dédié dans le bridge.
//  Du côté bot-controller, on appelle sendLog() dans index.js au ready.
// ─────────────────────────────────────────────────────────────────────────────

// Pas de logique locale côté selfbot pour le broadcast —
// les logs passent par le bridge (voir bridge/server.js action "log.send")
// et sont traités par le bot-controller.

/**
 * Enregistre le client pour pouvoir broadcaster via le bridge.
 * Cette fonction est appelée depuis index.js après le ready.
 * Elle redirige console.log vers le bridge HTTP du bot-controller.
 *
 * @param {import("discord.js-selfbot-v13").Client} _client - non utilisé, gardé pour compatibilité
 */
async function createBroadcast(_client) {
  // Plus de groupe DM — retourne un objet truthy pour que
  // la redirection console dans index.js se déclenche quand même
  return { id: "bridge" };
}

/**
 * No-op côté selfbot — les logs sont envoyés via le bridge dans index.js.
 * Gardé pour compatibilité d'import.
 */
async function logToBroadcast(_client, _text, _type) {
  // La redirection est gérée directement dans index.js
}

module.exports = { createBroadcast, logToBroadcast };