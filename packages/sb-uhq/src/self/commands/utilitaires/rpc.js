"use strict";

const fs   = require("fs");
const path = require("path");
const { CustomStatus, RichPresence } = require("discord.js-selfbot-v13");
const { dataPath } = require("../../func/data-path");

const RPC_FILE = dataPath("config", "rpc.json");

// ── Types d'activité Discord ──────────────────────────────────────────────────
// 0 = Playing, 1 = Streaming, 2 = Listening, 3 = Watching, 5 = Competing
const ACTIVITY_TYPES = { playing: 0, streaming: 1, listening: 2, watching: 3, competing: 5 };
const ACTIVITY_TYPE_STRINGS = { playing: "PLAYING", streaming: "STREAMING", listening: "LISTENING", watching: "WATCHING", competing: "COMPETING" };

// ── I/O ──────────────────────────────────────────────────────────────────────

const DEFAULTS = {
  enabled:        false,
  mode:           "static",
  status:         "online",
  applicationId:  null,   // ← REQUIS pour les boutons cliquables
  activities:     [],
  currentIdx:     0,
  intervalSec:    30,
  customStatuses: [],
  csEnabled:      false,
  csCurrentIdx:   0,
  csIntervalSec:  15,
};

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(RPC_FILE, "utf-8"));
    const config = { ...DEFAULTS, ...raw };
    // Nettoyer les tableaux buttons vides laissés par d'anciennes versions
    config.activities = config.activities.map(act => {
      if (Array.isArray(act.buttons) && act.buttons.length === 0) {
        const { buttons, ...rest } = act;
        return rest;
      }
      return act;
    });
    return config;
  } catch {
    return { ...DEFAULTS };
  }
}

function save(data) {
  fs.mkdirSync(path.dirname(RPC_FILE), { recursive: true });
  fs.writeFileSync(RPC_FILE, JSON.stringify(data, null, 2));
}

// ── Timers ────────────────────────────────────────────────────────────────────

let _activityInterval = null;
let _csInterval       = null;

function stopActivityRotator() {
  if (_activityInterval) { clearInterval(_activityInterval); _activityInterval = null; }
}

function stopCsRotator() {
  if (_csInterval) { clearInterval(_csInterval); _csInterval = null; }
}

function stopAll() {
  stopActivityRotator();
  stopCsRotator();
}

// ── Parser d'emoji ────────────────────────────────────────────────────────────
function parseEmoji(raw) {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  const match = raw.match(/^<?(a)?:(\w+):(\d+)>?$/);
  if (match) {
    return { animated: !!match[1], name: match[2], id: match[3] };
  }
  return raw;
}

// ── Builder RichPresence pour une activité ────────────────────────────────────
//
// Discord N'affiche PAS les boutons cliquables sans applicationId.
// Le applicationId doit venir d'une app créée sur https://discord.com/developers/applications
//
function buildRichPresence(client, act, applicationId) {
  const typeStr = ACTIVITY_TYPE_STRINGS[act.type] ?? "PLAYING";

  try {
    const rpc = new RichPresence(client)
      .setType(typeStr)
      .setName(act.name || "…");

    // applicationId OBLIGATOIRE pour les boutons cliquables
    if (applicationId) rpc.setApplicationId(applicationId);

    if (act.details)  rpc.setDetails(act.details);
    if (act.state)    rpc.setState(act.state);
    if (act.platform) rpc.setPlatform(act.platform);

    // URL de stream
    if (act.type === "streaming" && act.url) {
      rpc.setURL(act.url);
    }

    // Assets
    if (act.assets?.largeImage) rpc.setAssetsLargeImage(act.assets.largeImage);
    if (act.assets?.largeText)  rpc.setAssetsLargeText(act.assets.largeText);
    if (act.assets?.smallImage) rpc.setAssetsSmallImage(act.assets.smallImage);
    if (act.assets?.smallText)  rpc.setAssetsSmallText(act.assets.smallText);

    // Boutons — ne fonctionnent que si applicationId est défini
    if (act.type !== "streaming" && Array.isArray(act.buttons) && act.buttons.length > 0) {
      if (!applicationId) {
        console.warn("[RPC] ⚠️  Boutons ignorés : applicationId non défini. Crée une app sur https://discord.com/developers/applications et configure-le via le panel.");
      } else {
        for (const btn of act.buttons.slice(0, 2)) {
          if (btn.label && btn.url) {
            rpc.addButton(btn.label, btn.url);
          }
        }
      }
    }

    return rpc;
  } catch (e) {
    console.error("[RPC] Erreur buildRichPresence :", e.message);
    // Fallback minimal
    return new RichPresence(client).setType(typeStr).setName(act.name || "…");
  }
}

// ── Constructeur de présence centralisé ───────────────────────────────────────

function buildPresencePayload(client, config) {
  const activities = [];

  // 1) Custom Status (toujours en premier dans le tableau activities)
  if (config.csEnabled && config.customStatuses.length) {
    const cs = config.customStatuses[config.csCurrentIdx % config.customStatuses.length];
    try {
      const customStatus = new CustomStatus(client)
        .setState(cs.text ?? "");
      if (cs.emoji) customStatus.setEmoji(parseEmoji(cs.emoji));
      activities.push(customStatus);
    } catch {
      activities.push(new CustomStatus(client).setState(cs.text ?? ""));
    }
  }

  // 2) Activité RPC
  if (config.enabled && config.activities.length) {
    const act = config.activities[config.currentIdx % config.activities.length];
    activities.push(buildRichPresence(client, act, config.applicationId));
  }

  return {
    status:     config.status,
    activities,
  };
}

function applyPresence(client, config) {
  client.user.setPresence(buildPresencePayload(client, config));
}

// ── Démarrage des rotateurs ───────────────────────────────────────────────────

function startRotators(client, config) {
  stopAll();

  applyPresence(client, config);

  if (config.enabled && config.mode === "rotate" && config.activities.length > 1) {
    _activityInterval = setInterval(() => {
      const cfg = load();
      cfg.currentIdx = (cfg.currentIdx + 1) % cfg.activities.length;
      save(cfg);
      applyPresence(client, cfg);
    }, (config.intervalSec || 30) * 1000);
  }

  if (config.csEnabled && config.customStatuses.length > 1) {
    _csInterval = setInterval(() => {
      const cfg = load();
      cfg.csCurrentIdx = (cfg.csCurrentIdx + 1) % cfg.customStatuses.length;
      save(cfg);
      applyPresence(client, cfg);
    }, (config.csIntervalSec || 15) * 1000);
  }
}

// ── onReady ───────────────────────────────────────────────────────────────────

function onReady(client) {
  const config = load();
  const hasActivity = config.enabled && config.activities.length;
  const hasCs       = config.csEnabled && config.customStatuses.length;
  if (hasActivity || hasCs) {
    startRotators(client, config);
  }
}

// ── Logique pure (bridge) ─────────────────────────────────────────────────────

async function execute(client, payload) {
  const { action } = payload;
  const config = load();

  if (action === "getState") return config;

  // ── Toggle RPC on/off ─────────────────────────────────────────────────────
  if (action === "toggle") {
    config.enabled = !config.enabled;
    save(config);
    startRotators(client, config);
    return config;
  }

  // ── Toggle Custom Status on/off ───────────────────────────────────────────
  if (action === "csToggle") {
    config.csEnabled = !config.csEnabled;
    save(config);
    startRotators(client, config);
    return config;
  }

  // ── Définir l'Application ID (requis pour les boutons cliquables) ─────────
  if (action === "setApplicationId") {
    const id = payload.applicationId?.trim() ?? null;
    // Valider : doit être un snowflake (17-20 chiffres) ou null/vide pour effacer
    if (id && !/^\d{17,20}$/.test(id)) {
      throw new Error("Application ID invalide. Doit être un snowflake Discord (17–20 chiffres).");
    }
    config.applicationId = id || null;
    save(config);
    startRotators(client, config);
    return config;
  }

  // ── Statut en ligne ───────────────────────────────────────────────────────
  if (action === "setStatus") {
    const allowed = ["online", "idle", "dnd", "invisible"];
    if (!allowed.includes(payload.status)) throw new Error(`Statut invalide. Valeurs : ${allowed.join(", ")}`);
    config.status = payload.status;
    save(config);
    startRotators(client, config);
    return config;
  }

  // ── Mode static / rotate ──────────────────────────────────────────────────
  if (action === "setMode") {
    if (!["static", "rotate"].includes(payload.mode)) throw new Error("Mode invalide : 'static' ou 'rotate'.");
    config.mode = payload.mode;
    save(config);
    startRotators(client, config);
    return config;
  }

  // ── Intervalle rotation activités ─────────────────────────────────────────
  if (action === "setInterval") {
    const sec = parseInt(payload.intervalSec, 10);
    if (!sec || sec < 5) throw new Error("Intervalle minimum : 5 secondes.");
    config.intervalSec = sec;
    save(config);
    startRotators(client, config);
    return config;
  }

  // ── Intervalle rotation custom statuts ────────────────────────────────────
  if (action === "setCsInterval") {
    const sec = parseInt(payload.intervalSec, 10);
    if (!sec || sec < 5) throw new Error("Intervalle minimum : 5 secondes.");
    config.csIntervalSec = sec;
    save(config);
    startRotators(client, config);
    return config;
  }

  // ── Ajouter une activité RPC ──────────────────────────────────────────────
  if (action === "addActivity") {
    const { activity } = payload;
    if (!activity?.name) throw new Error("'name' requis.");
    if (!Object.prototype.hasOwnProperty.call(ACTIVITY_TYPES, activity.type ?? "playing"))
      throw new Error(`Type invalide. Valeurs : ${Object.keys(ACTIVITY_TYPES).join(", ")}`);

    const entry = {
      type:    activity.type ?? "playing",
      name:    activity.name.slice(0, 128),
      details: activity.details ?? null,
      state:   activity.state   ?? null,
      url:     activity.url     ?? null,
      assets: {
        largeImage: null,
        largeText:  null,
        smallImage: null,
        smallText:  null,
      },
    };

    if (entry.type === "streaming" && entry.url && !entry.url.startsWith("https://"))
      throw new Error("L'URL de streaming doit commencer par https://");

    config.activities.push(entry);
    save(config);
    startRotators(client, config);
    return config;
  }

  // ── Éditer une activité existante ─────────────────────────────────────────
  if (action === "editActivity") {
    const idx = (payload.index ?? 1) - 1;
    if (idx < 0 || idx >= config.activities.length)
      throw new Error(`Index invalide (1–${config.activities.length}).`);

    const { activity } = payload;
    if (!activity?.name) throw new Error("'name' requis.");
    if (!Object.prototype.hasOwnProperty.call(ACTIVITY_TYPES, activity.type ?? "playing"))
      throw new Error(`Type invalide. Valeurs : ${Object.keys(ACTIVITY_TYPES).join(", ")}`);

    if (activity.type === "streaming" && activity.url && !activity.url.startsWith("https://"))
      throw new Error("L'URL de streaming doit commencer par https://");

    // On préserve assets, buttons et platform existants
    config.activities[idx] = {
      ...config.activities[idx],
      type:    activity.type ?? config.activities[idx].type,
      name:    activity.name.slice(0, 128),
      details: activity.details ?? null,
      state:   activity.state   ?? null,
      url:     activity.url     ?? null,
    };

    save(config);
    startRotators(client, config);
    return config;
  }

  // ── Définir la plateforme d'une activité ─────────────────────────────────
  if (action === "setPlatform") {
    const PLATFORMS = ["desktop", "samsung", "xbox", "ios", "android", "embedded", "ps4", "ps5"];
    const idx = (payload.index ?? 1) - 1;
    if (idx < 0 || idx >= config.activities.length)
      throw new Error(`Index invalide (1–${config.activities.length}).`);

    if (payload.platform === null || payload.platform === "") {
      delete config.activities[idx].platform;
    } else {
      if (!PLATFORMS.includes(payload.platform))
        throw new Error(`Plateforme invalide. Valeurs : ${PLATFORMS.join(", ")}`);
      config.activities[idx].platform = payload.platform;
    }

    save(config);
    startRotators(client, config);
    return config;
  }

  // ── Gérer les boutons d'une activité ─────────────────────────────────────
  if (action === "editButtons") {
    const idx = (payload.index ?? 1) - 1;
    if (idx < 0 || idx >= config.activities.length)
      throw new Error(`Index invalide (1–${config.activities.length}).`);

    const act = config.activities[idx];

    if (act.type === "streaming")
      throw new Error("Les boutons ne sont pas disponibles pour les activités Streaming.");

    if (!config.applicationId) {
      throw new Error("Application ID non configuré. Configure-le d'abord via le bouton '🔑 App ID' pour que les boutons soient cliquables.");
    }

    const { buttonAction, buttonIndex, label, url } = payload;

    // Initialiser si absent
    if (!Array.isArray(act.buttons)) act.buttons = [];

    if (buttonAction === "add") {
      if (act.buttons.length >= 2)
        throw new Error("Maximum 2 boutons par activité.");
      if (!label) throw new Error("label requis.");
      if (!url)   throw new Error("url requis.");
      if (!url.startsWith("http://") && !url.startsWith("https://"))
        throw new Error("L'URL doit commencer par http:// ou https://");
      act.buttons.push({ label: label.slice(0, 32), url });
    }

    if (buttonAction === "remove") {
      const bIdx = (buttonIndex ?? 1) - 1;
      if (bIdx < 0 || bIdx >= act.buttons.length)
        throw new Error(`Index bouton invalide (1–${act.buttons.length}).`);
      act.buttons.splice(bIdx, 1);
      if (!act.buttons.length) delete act.buttons;
    }

    if (buttonAction === "clear") {
      delete act.buttons;
    }

    save(config);
    startRotators(client, config);
    return config;
  }

  // ── Éditer les assets d'une activité ─────────────────────────────────────
  if (action === "editAssets") {
    const idx = (payload.index ?? 1) - 1;
    if (idx < 0 || idx >= config.activities.length)
      throw new Error(`Index invalide (1–${config.activities.length}).`);

    config.activities[idx].assets = {
      largeImage: payload.assets?.largeImage ?? null,
      largeText:  payload.assets?.largeText  ?? null,
      smallImage: payload.assets?.smallImage ?? null,
      smallText:  payload.assets?.smallText  ?? null,
    };

    save(config);
    startRotators(client, config);
    return config;
  }

  // ── Supprimer une activité ────────────────────────────────────────────────
  if (action === "removeActivity") {
    const idx = (payload.index ?? 1) - 1;
    if (idx < 0 || idx >= config.activities.length)
      throw new Error(`Index invalide (1–${config.activities.length}).`);
    config.activities.splice(idx, 1);
    config.currentIdx = 0;
    save(config);
    startRotators(client, config);
    return config;
  }

  // ── Déplacer une activité ─────────────────────────────────────────────────
  if (action === "moveActivity") {
    const idx = (payload.index ?? 1) - 1;
    const dir = payload.direction;
    if (idx < 0 || idx >= config.activities.length) throw new Error("Index invalide.");
    if (dir === "up"   && idx === 0)                            throw new Error("Déjà en première position.");
    if (dir === "down" && idx === config.activities.length - 1) throw new Error("Déjà en dernière position.");

    const swap = dir === "up" ? idx - 1 : idx + 1;
    [config.activities[idx], config.activities[swap]] = [config.activities[swap], config.activities[idx]];
    config.currentIdx = 0;
    save(config);
    startRotators(client, config);
    return config;
  }

  // ── Vider toutes les activités ────────────────────────────────────────────
  if (action === "clearActivities") {
    config.activities = [];
    config.currentIdx = 0;
    save(config);
    startRotators(client, config);
    return config;
  }

  // ── Ajouter un custom status ──────────────────────────────────────────────
  if (action === "csAdd") {
    const { emoji = null, text = "" } = payload;
    if (!text && !emoji) throw new Error("text ou emoji requis.");
    config.customStatuses.push({ emoji: emoji || null, text: text.slice(0, 128) });
    save(config);
    startRotators(client, config);
    return config;
  }

  // ── Modifier un custom status ─────────────────────────────────────────────
  if (action === "csEdit") {
    const idx = (payload.index ?? 1) - 1;
    if (idx < 0 || idx >= config.customStatuses.length)
      throw new Error(`Index invalide (1–${config.customStatuses.length}).`);
    config.customStatuses[idx] = {
      emoji: payload.emoji || null,
      text:  (payload.text ?? "").slice(0, 128),
    };
    save(config);
    startRotators(client, config);
    return config;
  }

  // ── Supprimer un custom status ────────────────────────────────────────────
  if (action === "csRemove") {
    const idx = (payload.index ?? 1) - 1;
    if (idx < 0 || idx >= config.customStatuses.length)
      throw new Error(`Index invalide (1–${config.customStatuses.length}).`);
    config.customStatuses.splice(idx, 1);
    config.csCurrentIdx = 0;
    save(config);
    startRotators(client, config);
    return config;
  }

  // ── Vider tous les custom statuts ─────────────────────────────────────────
  if (action === "csClear") {
    config.customStatuses = [];
    config.csCurrentIdx   = 0;
    config.csEnabled      = false;
    save(config);
    startRotators(client, config);
    return config;
  }

  // ── Appliquer maintenant ──────────────────────────────────────────────────
  if (action === "applyNow") {
    applyPresence(client, config);
    return config;
  }

  throw new Error(`Action rpc inconnue : '${action}'`);
}

module.exports = { name: "rpc", execute, onReady };