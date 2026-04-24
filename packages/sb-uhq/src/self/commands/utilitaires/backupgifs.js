"use strict";

// ─────────────────────────────────────────────────────────────────────────────
//  BACKUP GIFs
//
//  Flux :
//  1. Fetch settings-proto/2 → décode le protobuf (discord-protos)
//  2. Télécharge chaque GIF → crée un ZIP (adm-zip)
//  3. Envoie le ZIP au bot-controller via POST /file (base64)
//     → le bot-controller répond avec FileBuilder dans le panel
//  4. Notifie le résultat via POST /backupgifs-result (jobId)
//
//  Dépendances dans packages/sb-uhq/package.json :
//    "discord-protos": "latest"
//    "adm-zip": "^0.5.10"
// ─────────────────────────────────────────────────────────────────────────────

const fs   = require("fs");
const os   = require("os");
const path = require("path");
const { dataPath } = require("../../func/data-path");

const BACKUPGIFS_FILE      = dataPath("config",  "backupgifs.json");
const BACKUPGIFS_DATA_FILE = dataPath("logs",    "backupgifs_data.json");
const BACKUPGIFS_ZIP_DIR   = dataPath("exports");

const BRIDGE_CONTROLLER_URL = process.env.BRIDGE_CONTROLLER_URL ?? "http://127.0.0.1:3001";
const BRIDGE_SECRET         = process.env.BRIDGE_SECRET ?? "";
const SYSTEM_RAM_MB         = Math.floor(os.totalmem() / (1024 * 1024));
const DEFAULT_MAX_ITEMS     = SYSTEM_RAM_MB <= 1536 ? 40 : 120;
const DEFAULT_MAX_ZIP_MB    = SYSTEM_RAM_MB <= 1536 ? 20 : 35;
const MAX_GIFS_PER_ZIP      = Number(process.env.BACKUPGIFS_MAX_ITEMS ?? DEFAULT_MAX_ITEMS);
const DOWNLOAD_DELAY_MS     = Number(process.env.BACKUPGIFS_DELAY_MS ?? 100);
const MAX_ZIP_SIZE_MB       = Number(process.env.BACKUPGIFS_MAX_ZIP_MB ?? DEFAULT_MAX_ZIP_MB);
const MAX_MEDIA_FILE_MB     = Number(process.env.BACKUPGIFS_MAX_MEDIA_MB ?? 8);

// ── I/O config ────────────────────────────────────────────────────────────────

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(BACKUPGIFS_FILE, "utf-8")); }
  catch { return { lastBackup: null, totalSaved: 0, lastZip: null, lastZipOk: null, lastZipFail: null }; }
}

function saveConfig(data) {
  fs.mkdirSync(path.dirname(BACKUPGIFS_FILE), { recursive: true });
  fs.writeFileSync(BACKUPGIFS_FILE, JSON.stringify(data, null, 2));
}

// ── I/O données GIFs ──────────────────────────────────────────────────────────

function loadGifs() {
  try { return JSON.parse(fs.readFileSync(BACKUPGIFS_DATA_FILE, "utf-8")); }
  catch { return []; }
}

function saveGifs(data) {
  fs.mkdirSync(path.dirname(BACKUPGIFS_DATA_FILE), { recursive: true });
  fs.writeFileSync(BACKUPGIFS_DATA_FILE, JSON.stringify(data, null, 2));
}

// ── Notifications bridge ──────────────────────────────────────────────────────

async function notifyResult(jobId, data) {
  if (!jobId) return;
  const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));
  fetch(`${BRIDGE_CONTROLLER_URL}/backupgifs-result`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "Authorization": BRIDGE_SECRET },
    body:    JSON.stringify({ jobId, ...data }),
  }).catch(() => {});
}

// ── Envoi du ZIP au bot-controller ───────────────────────────────────────────

async function sendZipViaController(zipPath, zipFilename, meta) {
  const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));
  const stat   = fs.statSync(zipPath);
  const sizeMb = stat.size / (1024 * 1024);
  if (sizeMb > MAX_ZIP_SIZE_MB) {
    throw new Error(`ZIP trop volumineux (${sizeMb.toFixed(1)} MB > ${MAX_ZIP_SIZE_MB} MB)`);
  }
  const base64 = fs.readFileSync(zipPath, { encoding: "base64" });
  const res = await fetch(`${BRIDGE_CONTROLLER_URL}/file`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "Authorization": BRIDGE_SECRET },
    body:    JSON.stringify({ filename: zipFilename, base64, meta }),
  });
  return res.ok;
}

// ── Fetch + décodage protobuf ─────────────────────────────────────────────────

async function fetchFavoriteGifs(token) {
  const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

  const res = await fetch("https://discord.com/api/v9/users/@me/settings-proto/2", {
    method:  "GET",
    headers: {
      "Authorization":      token,
      "Content-Type":       "application/json",
      "User-Agent":         "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9228 Chrome/138.0.7204.251 Electron/37.6.0 Safari/537.36",
      "x-discord-locale":   "fr",
      "x-discord-timezone": "Europe/Paris",
    },
  });

  if (!res.ok) throw new Error(`Impossible de récupérer les settings protobuf (HTTP ${res.status})`);

  const json = await res.json();
  const base64Settings = json?.settings;
  if (!base64Settings) {
    console.warn("[BACKUPGIFS] ⚠️ Champ 'settings' vide dans la réponse proto.");
    return [];
  }

  let FrecencyUserSettings;
  try {
    ({ FrecencyUserSettings } = require("discord-protos"));
  } catch {
    throw new Error("Package 'discord-protos' manquant. Lance : npm install discord-protos --workspace=packages/sb-uhq");
  }

  const decoded  = FrecencyUserSettings.fromBase64(base64Settings);
  const gifsRaw  = decoded?.favoriteGifs?.gifs;

  if (!gifsRaw || typeof gifsRaw !== "object") {
    console.log("[BACKUPGIFS] Aucun GIF favori trouvé dans le protobuf.");
    return [];
  }

  const entries = Object.entries(gifsRaw);
  if (entries.length === 0) {
    console.log("[BACKUPGIFS] La map de GIFs favoris est vide.");
    return [];
  }

  const FORMAT_LABELS = { 0: "none", 1: "image", 2: "video" };

  const gifs = entries.map(([key, gif]) => ({
    key,
    src:    gif.src    ?? null,
    width:  gif.width  ?? null,
    height: gif.height ?? null,
    order:  gif.order  ?? null,
    format: FORMAT_LABELS[gif.format] ?? FORMAT_LABELS[Number(gif.format)] ?? "unknown",
  }));

  gifs.sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999));
  return gifs;
}

// ── Création du ZIP ───────────────────────────────────────────────────────────

async function buildZipPart(gifs, partIndex = 1, totalParts = 1, startOffset = 0) {
  const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

  let AdmZip;
  try {
    AdmZip = require("adm-zip");
  } catch {
    throw new Error("Package 'adm-zip' manquant. Lance : npm install adm-zip --workspace=packages/sb-uhq");
  }

  fs.mkdirSync(BACKUPGIFS_ZIP_DIR, { recursive: true });

  const zip      = new AdmZip();
  const manifest = [];
  let   ok       = 0;
  let   fail     = 0;

  const gifsToProcess = gifs;
  console.log(`[BACKUPGIFS] 📦 Téléchargement de ${gifsToProcess.length} GIF(s) pour le ZIP ${partIndex}/${totalParts}…`);

  for (let i = 0; i < gifsToProcess.length; i++) {
    const gif = gifsToProcess[i];
    const url = gif.src;
    if (!url) { fail++; continue; }

    try {
      const imgRes = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      });

      if (!imgRes.ok) {
        console.warn(`[BACKUPGIFS] ⚠️ GIF ${i + 1} HTTP ${imgRes.status}`);
        fail++;
        continue;
      }

      const contentLength = Number(imgRes.headers.get("content-length") ?? 0);
      if (contentLength > 0 && contentLength > (MAX_MEDIA_FILE_MB * 1024 * 1024)) {
        console.warn(`[BACKUPGIFS] ⚠️ GIF ${i + 1} trop volumineux (${(contentLength / (1024 * 1024)).toFixed(1)} MB)`);
        fail++;
        continue;
      }

      const buf = await imgRes.buffer();
      if (buf.length > (MAX_MEDIA_FILE_MB * 1024 * 1024)) {
        console.warn(`[BACKUPGIFS] ⚠️ GIF ${i + 1} ignoré (> ${MAX_MEDIA_FILE_MB} MB)`);
        fail++;
        continue;
      }
      const ct  = imgRes.headers.get("content-type") ?? "";
      let ext   = ".gif";
      if      (ct.includes("mp4")  || url.includes(".mp4"))  ext = ".mp4";
      else if (ct.includes("webm") || url.includes(".webm")) ext = ".webm";
      else if (ct.includes("webp") || url.includes(".webp")) ext = ".webp";

      const globalIndex = startOffset + i + 1;
      const filename = `gif_${String(globalIndex).padStart(4, "0")}${ext}`;
      zip.addFile(filename, buf);
      manifest.push({ index: globalIndex, filename, src: url, format: gif.format, width: gif.width, height: gif.height, order: gif.order, key: gif.key });
      ok++;

      if ((i + 1) % 10 === 0) console.log(`[BACKUPGIFS] 📦 ${i + 1}/${gifsToProcess.length} téléchargés…`);
      await new Promise(r => setTimeout(r, DOWNLOAD_DELAY_MS));
    } catch (err) {
      console.warn(`[BACKUPGIFS] ⚠️ GIF ${i + 1} erreur : ${err.message}`);
      fail++;
    }
  }

  zip.addFile("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2), "utf-8"));

  const zipFilename = totalParts > 1
    ? `discord_gifs_backup_${Date.now()}_part-${partIndex}-of-${totalParts}.zip`
    : `discord_gifs_backup_${Date.now()}.zip`;
  const zipPath     = path.join(BACKUPGIFS_ZIP_DIR, zipFilename);
  zip.writeZip(zipPath);

  console.log(`[BACKUPGIFS] ✅ ZIP créé : ${zipFilename} (${ok}✅ ${fail}❌)`);
  return { zipPath, zipFilename, ok, fail, processed: gifsToProcess.length };
}

// ── Runner asynchrone (lancé en arrière-plan) ─────────────────────────────────

async function runBackup(token, jobId) {
  try {
    const gifs = await fetchFavoriteGifs(token);
    saveGifs(gifs);

    let zipFilename = null;
    let zipOk       = 0;
    let zipFail     = 0;
    let sent        = false;

    if (gifs.length > 0) {
      console.log(`[BACKUPGIFS] ℹ️ RAM système: ${SYSTEM_RAM_MB} MB | max/zip: ${MAX_GIFS_PER_ZIP} | max media: ${MAX_MEDIA_FILE_MB} MB | max zip: ${MAX_ZIP_SIZE_MB} MB`);
      const chunks = [];
      for (let i = 0; i < gifs.length; i += MAX_GIFS_PER_ZIP) {
        chunks.push(gifs.slice(i, i + MAX_GIFS_PER_ZIP));
      }

      const zipParts = chunks.length;
      let sentCount  = 0;

      for (let part = 0; part < chunks.length; part++) {
        const offset = part * MAX_GIFS_PER_ZIP;
        const { zipPath, zipFilename: partName, ok, fail, processed } = await buildZipPart(chunks[part], part + 1, zipParts, offset);
        zipFilename = partName;
        zipOk      += ok;
        zipFail    += fail;

        const meta = {
          totalGifs:  gifs.length,
          processed,
          skipped:    0,
          zipOk,
          zipFail,
          zipFilename: partName,
          zipPart:     part + 1,
          zipParts,
          timestamp:   Date.now(),
        };

        try {
          if (await sendZipViaController(zipPath, partName, meta)) sentCount++;
        } catch (err) {
          console.error(`[BACKUPGIFS] ❌ Erreur envoi ZIP part ${part + 1}/${zipParts} :`, err.message);
        }

        try { fs.unlinkSync(zipPath); } catch {}
      }

      sent = sentCount > 0;
      if (zipParts > 1) zipFilename = `${zipParts} fichier(s) ZIP`;
    }

    const config       = loadConfig();
    config.lastBackup  = Date.now();
    config.totalSaved  = gifs.length;
    config.lastZip     = zipFilename;
    config.lastZipOk   = zipOk;
    config.lastZipFail = zipFail;
    saveConfig(config);

    // Notifier le bot-controller du résultat pour mettre à jour le panel
    await notifyResult(jobId, {
      success:    true,
      totalGifs:  gifs.length,
      zipFilename,
      zipOk,
      zipFail,
      sent,
    });
  } catch (err) {
    console.error("[BACKUPGIFS] ❌ Erreur backup :", err.message);
    await notifyResult(jobId, { success: false, error: err.message });
  }
}

// ── Logique principale ────────────────────────────────────────────────────────

async function execute(client, payload) {
  const { action, jobId } = payload;
  const token = client.token;

  if (action === "getState") {
    const config = loadConfig();
    const gifs   = loadGifs();
    return { ...config, totalSaved: gifs.length, gifs };
  }

  if (action === "backup") {
    if (!jobId) throw new Error("jobId requis pour le backup.");
    // Lancer en arrière-plan pour ne pas bloquer le bridge
    setImmediate(() => runBackup(token, jobId).catch(() => {}));
    return { started: true };
  }

  if (action === "clear") {
    saveGifs([]);
    const config       = loadConfig();
    config.totalSaved  = 0;
    config.lastZip     = null;
    config.lastZipOk   = null;
    config.lastZipFail = null;
    saveConfig(config);
    return { ...config, totalSaved: 0, gifs: [] };
  }

  throw new Error(`Action backupgifs inconnue : '${action}'`);
}

module.exports = { name: "backupgifs", execute };