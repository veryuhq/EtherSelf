"use strict";

require("dotenv").config({ path: require("path").join(__dirname, ".env"), override: true });

const http = require("http");
const os   = require("os");
const fs   = require("fs");
const path = require("path");
const {
  Client,
  GatewayIntentBits,
  Collection,
  AttachmentBuilder,
} = require("discord.js");

const buttons = require("./src/interactions/buttons");
const modals  = require("./src/interactions/modals");
const selects = require("./src/interactions/selects");
const panel     = require("./src/commands/panel");
const purgelogs = require("./src/commands/purgelogs");

const { healthCheck }                                       = require("./src/bridge/client");
const { getSecretBuffer, verifySignedRequest, registerSignature } = require("./src/bridge/auth");
const { container, textDisplay, separator, actionRow, btn, fileComponent, replyV2 } = require("./src/utils/components");

const snipe   = require("./src/panels/snipe");
const backups = require("./src/panels/backups");

const OWNER_ID      = process.env.OWNER_ID;
const BRIDGE_SECRET = process.env.BRIDGE_SECRET ?? "";
const LOG_PORT      = parseInt(process.env.LOG_PORT ?? "3001", 10);

if (!OWNER_ID) throw new Error("OWNER_ID est obligatoire pour verrouiller les interactions du bot-controller.");
getSecretBuffer(BRIDGE_SECRET);

// ─────────────────────────────────────────────────────────────────────────────
//  STORE — jobs de progression purge
// ─────────────────────────────────────────────────────────────────────────────

const progressJobs = new Map();

function registerProgressJob(jobId, interaction) {
  progressJobs.set(jobId, { interaction, lastUpdate: 0 });
}

async function updateProgressJob(jobId, panelPayload, force = false) {
  const job = progressJobs.get(jobId);
  if (!job) return;
  const now = Date.now();
  if (!force && now - job.lastUpdate < 2000) return;
  job.lastUpdate = now;
  try { await job.interaction.editReply(panelPayload); } catch { /* interaction expirée */ }
}

function cleanProgressJob(jobId) { progressJobs.delete(jobId); }

module.exports.registerProgressJob = registerProgressJob;
module.exports.cleanProgressJob    = cleanProgressJob;

// ─────────────────────────────────────────────────────────────────────────────
//  STORE — jobs de clonage
// ─────────────────────────────────────────────────────────────────────────────

const cloneJobs = new Map();

function registerCloneJob(jobId, interaction) {
  cloneJobs.set(jobId, { interaction, lastUpdate: 0 });
}

function cleanCloneJob(jobId) { cloneJobs.delete(jobId); }

module.exports.registerCloneJob = registerCloneJob;
module.exports.cleanCloneJob    = cleanCloneJob;

// ─────────────────────────────────────────────────────────────────────────────
//  STORE — jobs de snapshot
// ─────────────────────────────────────────────────────────────────────────────

const snapshotJobs = new Map();

function registerSnapshotJob(jobId, interaction) {
  snapshotJobs.set(jobId, { interaction });
}

function cleanSnapshotJob(jobId) { snapshotJobs.delete(jobId); }

module.exports.registerSnapshotJob = registerSnapshotJob;
module.exports.cleanSnapshotJob    = cleanSnapshotJob;

// ─────────────────────────────────────────────────────────────────────────────
//  CLIENT
// ─────────────────────────────────────────────────────────────────────────────

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.commands = new Collection();
client.commands.set(panel.data.name, panel);
client.commands.set(purgelogs.data.name, purgelogs);

// ─────────────────────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function readBody(req, maxBytes = 50 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", chunk => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("Body trop volumineux."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end",  ()    => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

// Répertoire data/ du selfbot : seule racine dont /file accepte de lire un
// `filepath` local. Empêche qu'une requête signée puisse exfiltrer un fichier
// arbitraire de l'hôte (defense-in-depth au-delà du HMAC).
const SB_DATA_DIR = process.env.SB_DATA_DIR
  ? path.resolve(process.env.SB_DATA_DIR)
  : path.resolve(__dirname, "..", "sb-uhq", "data");

function assertInSbData(localFilepath) {
  const resolved = path.resolve(String(localFilepath ?? ""));
  if (resolved !== SB_DATA_DIR && !resolved.startsWith(`${SB_DATA_DIR}${path.sep}`)) {
    throw new Error("Chemin de fichier hors du répertoire autorisé.");
  }
  return resolved;
}

function safeTmpFile(filename) {
  const base = path.basename(String(filename ?? "")).replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
  if (!base || base === "." || base === "..") throw new Error("Nom de fichier invalide.");
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "etherself-"));
  const tmpPath = path.resolve(tmpRoot, base);
  if (!tmpPath.startsWith(`${path.resolve(tmpRoot)}${path.sep}`)) throw new Error("Chemin de fichier invalide.");
  return { tmpRoot, tmpPath, safeName: base };
}

function redactLogText(text) {
  return String(text ?? "")
    .replace(/(discord(?:app)?\.com\/(?:gifts|gift)\/)[A-Za-z0-9]{12,}/gi, "$1[redacted]")
    .replace(/(discord\.gift\/)[A-Za-z0-9]{12,}/gi, "$1[redacted]")
    .replace(/[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}/g, "[redacted-token]")
    .replace(/(Authorization\s*[:=]\s*)\S+/gi, "$1[redacted]");
}

const httpRateBuckets = new Map();
function checkHttpRateLimit(key, max, windowMs) {
  const now = Date.now();
  const current = httpRateBuckets.get(key);
  const bucket = current && current.resetAt > now ? current : { count: 0, resetAt: now + windowMs };
  bucket.count += 1;
  httpRateBuckets.set(key, bucket);
  return bucket.count <= max;
}

function buildSnapshotEmbed(meta, attachment, attachmentName) {
  const { channelName, guildName, messageCount, filename, fileSizeKb } = meta;
  const now = new Date().toLocaleString("fr-FR");

  const lines = [
    `## 📸 Snapshot — \`#${channelName}\``,
    guildName ? `> 🏠 **Serveur :** ${guildName}` : null,
    `> \`💬\` **Messages archivés :** \`${messageCount}\``,
    `> \`📄\` **Fichier :** \`${filename}\``,
    `> \`📦\` **Taille :** \`${fileSizeKb} Ko\``,
    `> \`🕐\` **Généré le :** ${now}`,
    ``,
    `*Ouvre le fichier HTML joint dans ton navigateur pour consulter l'archive.*`,
  ].filter(l => l !== null).join("\n");

  return {
    ...replyV2(
      container([textDisplay(lines)], 0x2ECC71),
      fileComponent(attachmentName),
    ),
    files: [attachment],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  SERVEUR HTTP
// ─────────────────────────────────────────────────────────────────────────────

const logServer = http.createServer(async (req, res) => {
  let rawBody = "";
  if (["POST", "PUT", "PATCH"].includes(req.method)) {
    try { rawBody = await readBody(req); }
    catch { res.writeHead(413).end(); return; }
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  if (!verifySignedRequest({ headers: req.headers, body: rawBody })) {
    res.writeHead(403).end();
    return;
  }
  if (!registerSignature(req.headers["x-bridge-signature"] ?? req.headers["X-Bridge-Signature"])) {
    res.writeHead(409).end();
    return;
  }
  if (!checkHttpRateLimit(`${req.socket.remoteAddress}:${req.url}`, 100, 60_000)) {
    res.writeHead(429, { "Retry-After": "60" }).end();
    return;
  }

  // ── POST /log ─────────────────────────────────────────────────────────────
  if (req.method === "POST" && req.url === "/log") {
    try {
      const { text } = JSON.parse(rawBody || "{}");
      const safeText = redactLogText(text).slice(0, 1900);
      if (safeText && client.isReady()) {
        const owner = await client.users.fetch(OWNER_ID).catch(() => null);
        if (owner) await owner.send(`\`\`\`ini\n${safeText}\n\`\`\``).catch(() => {});
      }
      res.writeHead(200).end();
    } catch { res.writeHead(400).end(); }
    return;
  }

  // ── POST /progress ────────────────────────────────────────────────────────
  if (req.method === "POST" && req.url === "/progress") {
    try {
      const { jobId, done, ...progressData } = JSON.parse(rawBody || "{}");
      if (!jobId) { res.writeHead(400).end(); return; }
      const { buildProgress } = require("./src/panels/purge");
      await updateProgressJob(jobId, buildProgress({ ...progressData, done: done === true }), done === true);
      if (done) cleanProgressJob(jobId);
      res.writeHead(200).end();
    } catch { res.writeHead(400).end(); }
    return;
  }

  // ── POST /clone-progress ──────────────────────────────────────────────────
  if (req.method === "POST" && req.url === "/clone-progress") {
    try {
      const { jobId, done, error, summary, ...progressData } = JSON.parse(rawBody || "{}");
      if (!jobId) { res.writeHead(400).end(); return; }

      const job = cloneJobs.get(jobId);
      if (!job) { res.writeHead(200).end(); return; }

      let panelPayload;
      if (done && summary)  panelPayload = backups.buildCloneResult(summary);
      else if (done && error) panelPayload = backups.buildCloneResult({ success: false, error });
      else panelPayload = backups.buildCloneRunning(progressData);

      const now = Date.now();
      if (!done && now - job.lastUpdate < 1500) { res.writeHead(200).end(); return; }
      job.lastUpdate = now;

      try { await job.interaction.editReply(panelPayload); } catch {}
      if (done) cleanCloneJob(jobId);

      res.writeHead(200).end();
    } catch { res.writeHead(400).end(); }
    return;
  }

  // ── POST /snapshot-result ─────────────────────────────────────────────────
  if (req.method === "POST" && req.url === "/snapshot-result") {
    try {
      const body = JSON.parse(rawBody || "{}");
      const { jobId, error, channelName, messageCount, sent } = body;

      if (jobId) {
        const job = snapshotJobs.get(jobId);
        if (job) {
          const panelPayload = snipe.buildSnapshotResult({
            channelName:  channelName ?? "?",
            messageCount: messageCount ?? 0,
            sent:         sent ?? false,
            error:        error ?? null,
          });
          try { await job.interaction.editReply(panelPayload); } catch {}
          cleanSnapshotJob(jobId);
        }
      }
      res.writeHead(200).end();
    } catch { res.writeHead(400).end(); }
    return;
  }

  // ── POST /file ────────────────────────────────────────────────────────────
  if (req.method === "POST" && req.url === "/file") {
    let tmpPath = null;
    let usedLocalPath = false;
    try {
      const body = JSON.parse(rawBody || "{}");
      const { filename, base64, filepath: localFilepath, meta, channelId } = body;

      if (!filename || (!base64 && !localFilepath)) { res.writeHead(400).end(); return; }
      if (!client.isReady()) { res.writeHead(503).end(); return; }

      const tmpInfo = safeTmpFile(filename);
      tmpPath = tmpInfo.tmpPath;

      if (localFilepath) {
        // Chemin local : les deux process tournent sur le même VPS,
        // on lit directement le fichier sans passer par base64 en mémoire.
        // Confiné au répertoire data/ du selfbot (anti-exfiltration).
        const srcPath = assertInSbData(localFilepath);
        fs.copyFileSync(srcPath, tmpPath);
        fs.chmodSync(tmpPath, 0o600);
        usedLocalPath = true;
      } else {
        fs.writeFileSync(tmpPath, Buffer.from(base64, "base64"), { mode: 0o600 });
      }

      const filenameSafe = tmpInfo.safeName;
      const attachment = new AttachmentBuilder(tmpPath, { name: filenameSafe });

      let msgPayload;

      // Snapshot HTML
      if (meta && typeof meta === "object") {
        msgPayload = buildSnapshotEmbed(meta, attachment, filenameSafe);
      }
      // Fichier générique
      else {
        msgPayload = { ...replyV2(fileComponent(filenameSafe)), files: [attachment] };
      }

      if (channelId) {
        const targetChannel = await client.channels.fetch(channelId).catch(() => null);
        if (!targetChannel) { res.writeHead(404).end(); return; }
        await targetChannel.send(msgPayload);
      } else {
        if (!OWNER_ID) { res.writeHead(500).end(); return; }
        const owner = await client.users.fetch(OWNER_ID).catch(() => null);
        if (!owner)   { res.writeHead(500).end(); return; }
        await owner.send(msgPayload);
      }

      res.writeHead(200).end();
    } catch (err) {
      console.error("[CONTROLLER] /file erreur :", err.message);
      res.writeHead(500).end();
    } finally {
      // Nettoyage du fichier tmp créé par le bot-controller.
      // Si on a utilisé localFilepath (chemin local depuis le selfbot),
      // le selfbot garde son propre fichier dans data/snapshots/ — on ne le supprime pas.
      if (tmpPath) {
        try { fs.unlinkSync(tmpPath); } catch {}
        try { fs.rmSync(path.dirname(tmpPath), { recursive: true, force: true }); } catch {}
      }
    }
    return;
  }

  res.writeHead(404).end();
});

// ─────────────────────────────────────────────────────────────────────────────
//  EVENTS
// ─────────────────────────────────────────────────────────────────────────────

client.once("ready", () => {
  console.log(`[CONTROLLER] ✅  Connecté en tant que ${client.user.tag}`);

  client.user.setPresence({
    activities: [{ name: "UHQ", type: 1, url: "https://twitch.tv/veryuhq" }],
    status: "online",
  });

  logServer.listen(LOG_PORT, "127.0.0.1", () => {
    console.log(`[CONTROLLER] 📬  Serveur de logs/progress/file en écoute sur 127.0.0.1:${LOG_PORT}`);
  });

  // ── Notification de démarrage ─────────────────────────────────────────────
  if (OWNER_ID) {
    const MAX_RETRIES = 5;
    const RETRY_DELAY = 5000;

    const tryHealthCheck = async (attempt = 1) => {
      const { online, data } = await healthCheck();

      if (online) {
        const owner = await client.users.fetch(OWNER_ID).catch(() => null);
        if (!owner) return;
        await owner.send(replyV2(
          container([
            textDisplay(
              `## ✅ Tout est en ligne !\n` +
              `> \`💻\` **Bot contrôleur :** connecté\n` +
              `> \`👤\` **Selfbot :** \`${data?.user ?? "?"}\`\n` +
              `> \`⏱️\` **Uptime selfbot :** \`${Math.floor(data?.uptime ?? 0)}s\`\n` +
              `> \`🏓\` **Ping WS :** \`${data?.ping ?? "?"}ms\``
            ),
          ], 0x2ECC71),
        )).catch(() => {});
        return;
      }

      if (attempt < MAX_RETRIES) {
        console.log(`[CONTROLLER] ⏳ Selfbot injoignable, nouvelle tentative dans ${RETRY_DELAY / 1000}s… (${attempt}/${MAX_RETRIES})`);
        setTimeout(() => tryHealthCheck(attempt + 1), RETRY_DELAY);
        return;
      }

      const owner = await client.users.fetch(OWNER_ID).catch(() => null);
      if (!owner) return;
      await owner.send(replyV2(
        container([
          textDisplay(
            `## ⚠️ Selfbot injoignable\n` +
            `> \`💻\` **Bot contrôleur :** connecté\n` +
            `> \`👤\` **Selfbot :** hors ligne après ${MAX_RETRIES} tentatives\n\n` +
            `*Vérifie que le selfbot est bien démarré.*`
          ),
        ], 0xE74C3C),
      )).catch(() => {});
    };

    setTimeout(() => tryHealthCheck(), RETRY_DELAY);
  }
});

client.on("interactionCreate", async (interaction) => {
  if (OWNER_ID && interaction.user.id !== OWNER_ID) {
    if (interaction.isRepliable()) return interaction.reply({ content: "❌ Accès refusé.", ephemeral: true });
    return;
  }

  try {
    if (interaction.isChatInputCommand()) {
      const cmd = client.commands.get(interaction.commandName);
      if (cmd) await cmd.execute(interaction);
      return;
    }
    if (interaction.isButton())           { await buttons.handle(interaction); return; }
    if (interaction.isModalSubmit())      { await modals.handle(interaction);  return; }
    if (interaction.isStringSelectMenu()) { await selects.handle(interaction); return; }
  } catch (err) {
    console.error("[CONTROLLER] Erreur interaction :", err);
    const errMsg = { content: `❌ Erreur : \`${err.message}\``, ephemeral: true };
    if (interaction.deferred || interaction.replied) interaction.followUp(errMsg).catch(() => {});
    else if (interaction.isRepliable()) interaction.reply(errMsg).catch(() => {});
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  LOGIN
// ─────────────────────────────────────────────────────────────────────────────

client.login(process.env.BOT_TOKEN);