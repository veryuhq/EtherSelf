"use strict";

const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

const BRIDGE_URL    = process.env.BRIDGE_URL    ?? "http://127.0.0.1:3000";
const BRIDGE_SECRET = process.env.BRIDGE_SECRET ?? "";

/**
 * Envoie une action au selfbot via HTTP.
 *
 * @param {string} action  - ex: "afk.toggle", "prefix.set"
 * @param {object} payload - données additionnelles
 * @returns {Promise<{ success: boolean, data?: any, error?: string }>}
 */
async function sendAction(action, payload = {}) {
  try {
    const res = await fetch(`${BRIDGE_URL}/action`, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": BRIDGE_SECRET,
      },
      body: JSON.stringify({ action, payload }),
    });

    const json = await res.json();
    return json;
  } catch (err) {
    return { success: false, error: `Bridge injoignable : ${err.message}` };
  }
}

/**
 * Vérifie la connectivité avec le selfbot.
 * @returns {Promise<{ online: boolean, data?: object }>}
 */
async function healthCheck() {
  try {
    const res = await fetch(`${BRIDGE_URL}/health`, {
      headers: { "Authorization": BRIDGE_SECRET },
    });
    if (!res.ok) return { online: false };
    const json = await res.json();
    return { online: true, data: json.data };
  } catch {
    return { online: false };
  }
}

module.exports = { sendAction, healthCheck };
