"use strict";

const express = require("express");
const { dispatch } = require("../router/action-router");
const { getSecretBuffer, verifySignedRequest, makeRateLimiter } = require("./auth");

const BRIDGE_SECRET = process.env.BRIDGE_SECRET;
const BRIDGE_PORT   = parseInt(process.env.BRIDGE_PORT ?? "3000", 10);

/**
 * Démarre le serveur HTTP bridge.
 * Le bot-controller envoie des requêtes POST /action avec :
 *   - Headers : X-Bridge-Timestamp + X-Bridge-Signature (HMAC-SHA256)
 *   - Body    : { action: string, payload: object }
 *
 * Le selfbot répond avec :
 *   - 200 { success: true,  data: any }
 *   - 4xx { success: false, error: string }
 *   - 500 { success: false, error: string }
 *
 * @param {import("discord.js-selfbot-v13").Client} client
 */
function startBridgeServer(client) {
  try {
    getSecretBuffer(BRIDGE_SECRET);
  } catch (err) {
    console.error(`[BRIDGE] ❌  ${err.message} — serveur bridge non démarré.`);
    return;
  }

  const app = express();
  app.use(express.json({
    limit: "64kb",
    verify: (req, _res, buf) => { req.rawBody = buf.toString("utf8"); },
  }));

  // ── Middleware d'authentification ──────────────────────────────────────────
  app.use((req, res, next) => {
    if (!verifySignedRequest({ headers: req.headers, body: req.rawBody ?? "" })) {
      return res.status(403).json({ success: false, error: "Forbidden — signature invalide." });
    }
    next();
  });

  app.use(makeRateLimiter({ windowMs: 60_000, max: 100, keyFn: (req) => req.ip ?? "local" }));

  const destructiveLimiter = makeRateLimiter({
    windowMs: 60_000,
    max: 5,
    keyFn: (req) => `destructive:${req.ip}:${req.body?.action ?? ""}`,
  });
  app.use((req, res, next) => {
    const action = req.body?.action;
    if (req.method === "POST" && req.path === "/action" && /^(purge\.|backups\.clone\.run|token\.set)$/.test(action)) {
      return destructiveLimiter(req, res, next);
    }
    return next();
  });

  // ── Route principale ───────────────────────────────────────────────────────
  app.post("/action", async (req, res) => {
    const { action, payload = {} } = req.body ?? {};

    if (!action || typeof action !== "string") {
      return res.status(400).json({ success: false, error: "Champ 'action' manquant ou invalide." });
    }

    try {
      const result = await dispatch(client, action, payload);
      return res.status(200).json({ success: true, data: result ?? null });
    } catch (err) {
      console.error(`[BRIDGE] Erreur action '${action}':`, err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Health check ───────────────────────────────────────────────────────────
  app.get("/health", (_req, res) => {
    res.json({
      success: true,
      data: {
        status:  "online",
        user:    client.user?.tag ?? "non connecté",
        uptime:  process.uptime(),
        ping:    client.ws.ping,
      },
    });
  });

  app.listen(BRIDGE_PORT, "127.0.0.1", () => {
    console.log(`[BRIDGE] ✅  Serveur HTTP démarré sur 127.0.0.1:${BRIDGE_PORT}`);
  });
}

module.exports = { startBridgeServer };
