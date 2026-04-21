"use strict";

const fs   = require("fs");
const path = require("path");
const { dataPath } = require("../../func/data-path");
const http = require("../../func/quest-http");

const QUESTS_LOG_FILE    = dataPath("logs", "quests_history.json");
const QUESTS_CONFIG_FILE = dataPath("config", "quests.json");

// ── I/O config ────────────────────────────────────────────────────────────────

const DEFAULTS_CONFIG = {
  enabled:     false,
  intervalMin: 360, // toutes les 6h par défaut
};

function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(QUESTS_CONFIG_FILE, "utf-8"));
    return { ...DEFAULTS_CONFIG, ...raw };
  } catch {
    return { ...DEFAULTS_CONFIG };
  }
}

function saveConfig(data) {
  fs.mkdirSync(path.dirname(QUESTS_CONFIG_FILE), { recursive: true });
  fs.writeFileSync(QUESTS_CONFIG_FILE, JSON.stringify(data, null, 2));
}

// ── I/O historique ────────────────────────────────────────────────────────────

function loadHistory() {
  try { return JSON.parse(fs.readFileSync(QUESTS_LOG_FILE, "utf-8")); }
  catch { return []; }
}

function saveHistory(history) {
  fs.mkdirSync(path.dirname(QUESTS_LOG_FILE), { recursive: true });
  fs.writeFileSync(QUESTS_LOG_FILE, JSON.stringify(history, null, 2));
}

function pushHistoryEntry(entry) {
  const history = loadHistory();
  history.push(entry);
  if (history.length > 50) history.shift();
  saveHistory(history);
}

// ── Timer ─────────────────────────────────────────────────────────────────────

let _interval = null;

function stopLoop() {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
  }
}

function startLoop(client) {
  stopLoop();
  const config = loadConfig();
  if (!config.enabled) return;

  const ms = Math.max(config.intervalMin, 30) * 60 * 1000;
  _interval = setInterval(() => runAll(client), ms);
  console.log(`[QUESTS] 🔄 Boucle automatique démarrée (toutes les ${config.intervalMin} min)`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

const TASK_NAMES = [
  "WATCH_VIDEO",
  "PLAY_ON_DESKTOP",
  "PLAY_ON_XBOX",
  "PLAY_ON_PLAYSTATION",
  "STREAM_ON_DESKTOP",
  "PLAY_ACTIVITY",
  "WATCH_VIDEO_ON_MOBILE",
  "ACHIEVEMENT_IN_ACTIVITY",
];

function filterValidQuests(quests) {
  return quests.filter(q =>
    q.user_status?.enrolled_at &&
    !q.user_status?.completed_at &&
    new Date(q.config.expires_at).getTime() > Date.now()
  );
}

function filterEnrollableQuests(quests) {
  return quests.filter(q =>
    !q.user_status?.enrolled_at &&
    !q.user_status?.completed_at &&
    new Date(q.config.expires_at).getTime() > Date.now()
  );
}

function filterAllActive(quests) {
  return quests.filter(q =>
    new Date(q.config.expires_at).getTime() > Date.now()
  );
}

function getTaskName(quest) {
  const taskConfig = quest.config.task_config_v2;
  return TASK_NAMES.find(x => taskConfig?.tasks?.[x] != null) ?? null;
}

// ── Complétion WATCH_VIDEO / WATCH_VIDEO_ON_MOBILE ────────────────────────────

async function doWatchVideo(token, quest, onProgress) {
  const taskName = quest.config.task_config_v2.tasks["WATCH_VIDEO"]
    ? "WATCH_VIDEO"
    : "WATCH_VIDEO_ON_MOBILE";
  const secondsNeeded = quest.config.task_config_v2.tasks[taskName].target;
  const enrolledAt    = new Date(quest.user_status.enrolled_at).getTime();
  let secondsDone     = quest.user_status?.progress?.[taskName]?.value ?? 0;

  const maxFuture = 10, speed = 7, interval = 1;
  let completed = false;

  onProgress?.(`[QUESTS] 🎬 ${quest.config.messages.quest_name} — vidéo en cours…`);

  while (true) {
    const maxAllowed = Math.floor((Date.now() - enrolledAt) / 1000) + maxFuture;
    const diff       = maxAllowed - secondsDone;
    const timestamp  = secondsDone + speed;

    if (diff >= speed) {
      const res = await http.postVideoProgress(token, quest.id, Math.min(secondsNeeded, timestamp + Math.random()));
      if (res.ok) {
        completed   = res.data?.completed_at != null;
        secondsDone = Math.min(secondsNeeded, timestamp);
      }
    }

    if (timestamp >= secondsNeeded) break;
    await sleep(interval * 1000);
  }

  if (!completed) {
    await http.postVideoProgress(token, quest.id, secondsNeeded);
  }

  return { success: true };
}

// ── Complétion PLAY_ON_DESKTOP / PLAY_ON_XBOX / PLAY_ON_PLAYSTATION ───────────

async function doPlayOnPlatform(token, quest, taskName, onProgress) {
  const secondsNeeded   = quest.config.task_config_v2.tasks[taskName].target;
  const applicationId   = quest.config.application.id;
  const applicationName = quest.config.application.name;
  const interval        = 20;

  onProgress?.(`[QUESTS] 🎮 ${quest.config.messages.quest_name} — simulation plateforme…`);

  let currentStatus = quest.user_status;

  while (true) {
    const secondsDone = currentStatus?.progress?.[taskName]?.value ?? 0;
    if (secondsDone >= secondsNeeded) break;

    const res = await http.postHeartbeat(token, quest.id, {
      application_id: applicationId,
      terminal: false,
    });

    if (!res.ok) {
      onProgress?.(`[QUESTS] ⚠️ Heartbeat failed (${res.status})`);
      await sleep(interval * 1000);
      continue;
    }

    currentStatus = res.data;
    const done      = currentStatus?.progress?.[taskName]?.value ?? 0;
    const remaining = Math.ceil((secondsNeeded - done) / 60);
    onProgress?.(`[QUESTS] 🎮 ${applicationName} — encore ~${remaining} min`);

    if (done >= secondsNeeded) break;
    await sleep(interval * 1000);
  }

  await http.postHeartbeat(token, quest.id, {
    application_id: applicationId,
    terminal: true,
  });

  return { success: true };
}

// ── Complétion PLAY_ACTIVITY ──────────────────────────────────────────────────

async function doPlayActivity(token, quest, taskName, onProgress) {
  const secondsNeeded   = quest.config.task_config_v2.tasks[taskName].target;
  const applicationName = quest.config.application.name;
  const streamKey       = "call:1:1";
  const interval        = 20;

  onProgress?.(`[QUESTS] 🎲 ${quest.config.messages.quest_name} — simulation activité…`);

  let currentStatus = quest.user_status;

  while (true) {
    const secondsDone = currentStatus?.progress?.[taskName]?.value ?? 0;
    if (secondsDone >= secondsNeeded) break;

    const res = await http.postHeartbeat(token, quest.id, {
      stream_key: streamKey,
      terminal: false,
    });

    if (!res.ok) {
      onProgress?.(`[QUESTS] ⚠️ Heartbeat failed (${res.status})`);
      await sleep(interval * 1000);
      continue;
    }

    currentStatus = res.data;
    const done      = currentStatus?.progress?.[taskName]?.value ?? 0;
    const remaining = Math.ceil((secondsNeeded - done) / 60);
    onProgress?.(`[QUESTS] 🎲 ${applicationName} — encore ~${remaining} min`);

    if (done >= secondsNeeded) break;
    await sleep(interval * 1000);
  }

  await http.postHeartbeat(token, quest.id, { stream_key: streamKey, terminal: true });
  return { success: true };
}

// ── Complétion ACHIEVEMENT_IN_ACTIVITY ────────────────────────────────────────

async function doAchievementInActivity(token, quest, onProgress) {
  const applicationId   = quest.config.application.id;
  const applicationName = quest.config.application.name;
  const questTarget     = quest.config.task_config_v2.tasks["ACHIEVEMENT_IN_ACTIVITY"].target;

  onProgress?.(`[QUESTS] 🏆 ${quest.config.messages.quest_name} — OAuth2…`);

  const authRes = await http.authorizeOAuth2(token, applicationId);
  if (!authRes.ok) throw new Error(`OAuth2 authorize failed (${authRes.status})`);

  const location = authRes.data?.location;
  if (!location) throw new Error("Pas de location dans la réponse OAuth2");

  const authCode = new URL(location).searchParams.get("code");
  if (!authCode) throw new Error("Pas de code OAuth2");

  const dsToken = await http.authorizeDiscordSays(applicationId, authCode);
  if (!dsToken) throw new Error("Impossible d'obtenir le token Discord Says");

  onProgress?.(`[QUESTS] 🏆 ${applicationName} — progression achievement…`);

  const ok = await http.progressDiscordSays(applicationId, dsToken, questTarget);
  if (!ok) throw new Error("progressDiscordSays a échoué");

  try {
    const tokensRes = await http.getOAuth2Tokens(token);
    if (tokensRes.ok && Array.isArray(tokensRes.data)) {
      const tokenInfo = tokensRes.data.find(t => t.application?.id === applicationId);
      if (tokenInfo) {
        await http.deleteOAuth2Token(token, tokenInfo.id);
      }
    }
  } catch { /* non bloquant */ }

  return { success: true };
}

// ── Runner principal d'une quête ──────────────────────────────────────────────

async function runQuest(token, quest, onProgress) {
  const questName = quest.config.messages.quest_name;
  const isAndroid = Boolean(quest.config.task_config_v2?.tasks?.WATCH_VIDEO_ON_MOBILE)
    && !Boolean(quest.config.task_config_v2?.tasks?.WATCH_VIDEO);

  if (!quest.user_status?.enrolled_at) {
    onProgress?.(`[QUESTS] 📋 Inscription à "${questName}"…`);
    const enrollRes = await http.enrollQuest(token, quest.id, isAndroid);
    if (!enrollRes.ok) {
      throw new Error(`Inscription échouée (${enrollRes.status}): ${JSON.stringify(enrollRes.data)}`);
    }
    quest.user_status = enrollRes.data;
  }

  const taskName = getTaskName(quest);
  if (!taskName) throw new Error(`Aucun taskName reconnu pour "${questName}"`);

  onProgress?.(`[QUESTS] ▶️ "${questName}" — tâche: ${taskName}`);

  switch (taskName) {
    case "WATCH_VIDEO":
    case "WATCH_VIDEO_ON_MOBILE":
      return doWatchVideo(token, quest, onProgress);

    case "PLAY_ON_DESKTOP":
    case "PLAY_ON_XBOX":
    case "PLAY_ON_PLAYSTATION":
      return doPlayOnPlatform(token, quest, taskName, onProgress);

    case "PLAY_ACTIVITY":
      return doPlayActivity(token, quest, taskName, onProgress);

    case "ACHIEVEMENT_IN_ACTIVITY":
      return doAchievementInActivity(token, quest, onProgress);

    case "STREAM_ON_DESKTOP":
      throw new Error(`STREAM_ON_DESKTOP non supporté en mode bridge`);

    default:
      throw new Error(`TaskName inconnu: ${taskName}`);
  }
}

// ── Runner global (toutes les quêtes) ────────────────────────────────────────

async function runAll(client) {
  const token = client.token;

  console.log("[QUESTS] 🔄 Lancement de la complétion automatique des quêtes…");

  let raw;
  try {
    const res = await http.fetchQuests(token);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    raw = res.data;
  } catch (err) {
    console.error(`[QUESTS] ❌ Impossible de récupérer les quêtes : ${err.message}`);
    return;
  }

  const toDo = [
    ...filterValidQuests(raw.quests ?? []),
    ...filterEnrollableQuests(raw.quests ?? []),
  ];

  const seen   = new Set();
  const unique = toDo.filter(q => {
    if (seen.has(q.id)) return false;
    seen.add(q.id);
    return true;
  });

  if (!unique.length) {
    console.log("[QUESTS] ✅ Aucune quête à compléter pour l'instant.");
    return;
  }

  console.log(`[QUESTS] ${unique.length} quête(s) à traiter.`);

  for (const quest of unique) {
    const questName = quest.config.messages.quest_name;
    const taskName  = getTaskName(quest);

    try {
      await runQuest(token, quest, (msg) => console.log(msg));
      console.log(`[QUESTS] ✅ "${questName}" complétée !`);
      pushHistoryEntry({
        questId:   quest.id,
        questName,
        taskName,
        success:   true,
        timestamp: Date.now(),
      });
    } catch (err) {
      console.error(`[QUESTS] ❌ "${questName}" échouée : ${err.message}`);
      pushHistoryEntry({
        questId:   quest.id,
        questName,
        taskName,
        success:   false,
        error:     err.message,
        timestamp: Date.now(),
      });
    }
  }
}

// ── onReady ───────────────────────────────────────────────────────────────────

function onReady(client) {
  const config = loadConfig();
  if (config.enabled) {
    startLoop(client);
    // Lancement immédiat au démarrage
    runAll(client).catch(() => {});
  }
}

// ── Logique principale (bridge) ───────────────────────────────────────────────

/**
 * @param {import("discord.js-selfbot-v13").Client} client
 * @param {{ action: string }} payload
 */
async function execute(client, payload) {
  const { action } = payload;
  const token = client.token;

  // ── getConfig ─────────────────────────────────────────────────────────────
  if (action === "getConfig") {
    return loadConfig();
  }

  // ── toggle ────────────────────────────────────────────────────────────────
  if (action === "toggle") {
    const config = loadConfig();
    config.enabled = !config.enabled;
    saveConfig(config);
    if (config.enabled) {
      startLoop(client);
      runAll(client).catch(() => {});
    } else {
      stopLoop();
    }
    return config;
  }

  // ── setInterval ───────────────────────────────────────────────────────────
  if (action === "setInterval") {
    const min = parseInt(payload.intervalMin, 10);
    if (!min || min < 30) throw new Error("Intervalle minimum : 30 minutes.");
    const config = loadConfig();
    config.intervalMin = min;
    saveConfig(config);
    if (config.enabled) startLoop(client);
    return config;
  }

  // ── list : récupère toutes les quêtes ─────────────────────────────────────
  if (action === "list") {
    const res = await http.fetchQuests(token);
    if (!res.ok) throw new Error(`Impossible de récupérer les quêtes (${res.status})`);

    const raw       = res.data;
    const allActive = filterAllActive(raw.quests ?? []);
    const todo      = filterValidQuests(raw.quests ?? []);
    const enroll    = filterEnrollableQuests(raw.quests ?? []);
    const completed = (raw.quests ?? []).filter(q => q.user_status?.completed_at);

    const config = loadConfig();

    return {
      quests: allActive.map(q => ({
        id:         q.id,
        name:       q.config.messages.quest_name,
        game:       q.config.application.name,
        taskName:   getTaskName(q),
        expiresAt:  q.config.expires_at,
        enrolled:   Boolean(q.user_status?.enrolled_at),
        completed:  Boolean(q.user_status?.completed_at),
        claimed:    Boolean(q.user_status?.claimed_at),
        progress:   q.user_status?.progress ?? {},
      })),
      blockedUntil: raw.quest_enrollment_blocked_until ?? null,
      stats: {
        total:     allActive.length,
        todo:      todo.length,
        enroll:    enroll.length,
        completed: completed.length,
      },
      config,
    };
  }

  // ── run : complétion manuelle ─────────────────────────────────────────────
  if (action === "run") {
    const res = await http.fetchQuests(token);
    if (!res.ok) throw new Error(`Impossible de récupérer les quêtes (${res.status})`);

    const raw  = res.data;
    const toDo = [
      ...filterValidQuests(raw.quests ?? []),
      ...filterEnrollableQuests(raw.quests ?? []),
    ];

    const seen   = new Set();
    const unique = toDo.filter(q => {
      if (seen.has(q.id)) return false;
      seen.add(q.id);
      return true;
    });

    if (!unique.length) {
      return { done: 0, results: [], message: "Aucune quête à compléter." };
    }

    console.log(`[QUESTS] ${unique.length} quête(s) à traiter.`);

    const results = [];

    for (const quest of unique) {
      const questName = quest.config.messages.quest_name;
      const taskName  = getTaskName(quest);

      try {
        await runQuest(token, quest, (msg) => console.log(msg));
        console.log(`[QUESTS] ✅ "${questName}" complétée !`);
        const entry = { questId: quest.id, questName, taskName, success: true, timestamp: Date.now() };
        pushHistoryEntry(entry);
        results.push(entry);
      } catch (err) {
        console.error(`[QUESTS] ❌ "${questName}" échouée : ${err.message}`);
        const entry = { questId: quest.id, questName, taskName, success: false, error: err.message, timestamp: Date.now() };
        pushHistoryEntry(entry);
        results.push(entry);
      }
    }

    return {
      done:    results.filter(r => r.success).length,
      failed:  results.filter(r => !r.success).length,
      results,
    };
  }

  // ── getHistory ────────────────────────────────────────────────────────────
  if (action === "getHistory") {
    return { history: loadHistory() };
  }

  // ── clearHistory ──────────────────────────────────────────────────────────
  if (action === "clearHistory") {
    saveHistory([]);
    return { history: [] };
  }

  throw new Error(`Action quests inconnue : '${action}'`);
}

module.exports = { name: "quests", execute, onReady };