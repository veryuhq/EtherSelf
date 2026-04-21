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
  FileBuilder,
  MessageFlags,
} = require("discord.js");

const buttons = require("./src/interactions/buttons");
const modals  = require("./src/interactions/modals");
const selects = require("./src/interactions/selects");
const panel   = require("./src/commands/panel");

const { healthCheck }                                       = require("./src/bridge/client");
const { container, textDisplay, separator, actionRow, btn } = require("./src/utils/components");

const snipe = require("./src/panels/snipe");

const OWNER_ID      = process.env.OWNER_ID;
const BRIDGE_SECRET = process.env.BRIDGE_SECRET ?? "";
const LOG_PORT      = parseInt(process.env.LOG_PORT ?? "3001", 10);

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

  try {
    await job.interaction.editReply(panelPayload);
  } catch {
    // interaction expirée
  }
}

function cleanProgressJob(jobId) {
  progressJobs.delete(jobId);
}

module.exports.registerProgressJob = registerProgressJob;
module.exports.cleanProgressJob    = cleanProgressJob;

// ─────────────────────────────────────────────────────────────────────────────
//  STORE — jobs de clonage
// ─────────────────────────────────────────────────────────────────────────────

const cloneJobs = new Map();

function registerCloneJob(jobId, interaction) {
  cloneJobs.set(jobId, { interaction, lastUpdate: 0 });
}

function cleanCloneJob(jobId) {
  cloneJobs.delete(jobId);
}

module.exports.registerCloneJob = registerCloneJob;
module.exports.cleanCloneJob    = cleanCloneJob;

// ─────────────────────────────────────────────────────────────────────────────
//  STORE — jobs de snapshot
// ─────────────────────────────────────────────────────────────────────────────

const snapshotJobs = new Map();

function registerSnapshotJob(jobId, interaction) {
  snapshotJobs.set(jobId, { interaction });
}

function cleanSnapshotJob(jobId) {
  snapshotJobs.delete(jobId);
}

module.exports.registerSnapshotJob = registerSnapshotJob;
module.exports.cleanSnapshotJob    = cleanSnapshotJob;

// ─────────────────────────────────────────────────────────────────────────────
//  CLIENT
// ─────────────────────────────────────────────────────────────────────────────

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.commands = new Collection();
client.commands.set(panel.data.name, panel);

// ─────────────────────────────────────────────────────────────────────────────
//  HELPERS — lecture chunked body
// ─────────────────────────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end",  ()    => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  HELPER — message snapshot avec FileBuilder (Components V2)
// ─────────────────────────────────────────────────────────────────────────────

function buildSnapshotEmbed(meta, attachment) {
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

  const fileComponent = new FileBuilder().setURL(`attachment://${filename}`);

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [
      {
        type: 17,
        accent_color: 0x2ECC71,
        components: [
          { type: 10, content: lines },
        ],
      },
      fileComponent,
    ],
    files: [attachment],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  SERVEUR HTTP — logs, progressions purge, progressions clone,
//                 résultats snapshot, fichiers snapshot
// ─────────────────────────────────────────────────────────────────────────────

const logServer = http.createServer(async (req, res) => {
  // ── Auth commune ──────────────────────────────────────────────────────────
  if (req.headers["authorization"] !== BRIDGE_SECRET) {
    res.writeHead(403).end();
    return;
  }

  // ── POST /log — logs console du selfbot ──────────────────────────────────
  if (req.method === "POST" && req.url === "/log") {
    try {
      const { text } = JSON.parse(await readBody(req));
      if (text && OWNER_ID && client.isReady()) {
        const owner = await client.users.fetch(OWNER_ID).catch(() => null);
        if (owner) {
          await owner.send(`\`\`\`ini\n${String(text).slice(0, 1900)}\n\`\`\``).catch(() => {});
        }
      }
      res.writeHead(200).end();
    } catch {
      res.writeHead(400).end();
    }
    return;
  }

  // ── POST /progress — progression purge ───────────────────────────────────
  if (req.method === "POST" && req.url === "/progress") {
    try {
      const { jobId, done, ...progressData } = JSON.parse(await readBody(req));
      if (!jobId) { res.writeHead(400).end(); return; }

      const { buildProgress } = require("./src/panels/purge");
      const panelPayload = buildProgress(progressData);

      await updateProgressJob(jobId, panelPayload, done === true);
      if (done) cleanProgressJob(jobId);

      res.writeHead(200).end();
    } catch {
      res.writeHead(400).end();
    }
    return;
  }

  // ── POST /clone-progress — progression clonage ───────────────────────────
  if (req.method === "POST" && req.url === "/clone-progress") {
    try {
      const { jobId, done, error, summary, ...progressData } = JSON.parse(await readBody(req));
      if (!jobId) { res.writeHead(400).end(); return; }

      const job = cloneJobs.get(jobId);
      if (!job) { res.writeHead(200).end(); return; }

      const clonePanel = require("./src/panels/clone");
      let panelPayload;

      if (done && summary) {
        panelPayload = clonePanel.buildResult(summary);
      } else if (done && error) {
        panelPayload = clonePanel.buildResult({ success: false, error });
      } else {
        panelPayload = clonePanel.buildRunning(progressData);
      }

      // Throttle : max une mise à jour toutes les 1.5s (sauf si terminé)
      const now = Date.now();
      if (!done && now - job.lastUpdate < 1500) {
        res.writeHead(200).end();
        return;
      }
      job.lastUpdate = now;

      try { await job.interaction.editReply(panelPayload); } catch {}
      if (done) cleanCloneJob(jobId);

      res.writeHead(200).end();
    } catch {
      res.writeHead(400).end();
    }
    return;
  }

  // ── POST /snapshot-result — résultat asynchrone du snapshot ──────────────
  if (req.method === "POST" && req.url === "/snapshot-result") {
    try {
      const body = JSON.parse(await readBody(req));
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
          try {
            await job.interaction.editReply(panelPayload);
          } catch {
            // interaction expirée, on ne fait rien
          }
          cleanSnapshotJob(jobId);
        }
      }

      res.writeHead(200).end();
    } catch {
      res.writeHead(400).end();
    }
    return;
  }

  // ── POST /file — envoi d'un fichier snapshot par le bot ──────────────────
  if (req.method === "POST" && req.url === "/file") {
    let tmpPath = null;
    try {
      const body = JSON.parse(await readBody(req));
      const { filename, base64, meta, channelId } = body;

      if (!filename || !base64) { res.writeHead(400).end(); return; }
      if (!client.isReady())    { res.writeHead(503).end(); return; }

      tmpPath = path.join(os.tmpdir(), filename);
      fs.writeFileSync(tmpPath, Buffer.from(base64, "base64"));

      const attachment = new AttachmentBuilder(tmpPath, { name: filename });

      let msgPayload;
      if (meta && typeof meta === "object") {
        msgPayload = buildSnapshotEmbed(meta, attachment);
      } else {
        const fileComponent = new FileBuilder().setURL(`attachment://${filename}`);
        msgPayload = {
          flags: MessageFlags.IsComponentsV2,
          components: [fileComponent],
          files: [attachment],
        };
      }

      if (channelId) {
        const targetChannel = await client.channels.fetch(channelId).catch(() => null);
        if (!targetChannel) {
          res.writeHead(404).end();
          return;
        }
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
      if (tmpPath) {
        try { fs.unlinkSync(tmpPath); } catch {}
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
    activities: [{
      name: "UHQ",
      type: 1,
      url:  "https://twitch.tv/veryuhq",
    }],
    status: "online",
  });

  logServer.listen(LOG_PORT, "127.0.0.1", () => {
    console.log(`[CONTROLLER] 📬  Serveur de logs/progress/file en écoute sur 127.0.0.1:${LOG_PORT}`);
  });

  // ── Notification de démarrage ────────────────────────────────────────────
  if (OWNER_ID) {
    const MAX_RETRIES = 5;
    const RETRY_DELAY = 5000;

    const tryHealthCheck = async (attempt = 1) => {
      const { online, data } = await healthCheck();

      if (online) {
        const owner = await client.users.fetch(OWNER_ID).catch(() => null);
        if (!owner) return;
        await owner.send({
          flags: 1 << 15,
          components: [
            container([
              textDisplay(
                `## ✅ Tout est en ligne !\n` +
                `> \`💻\` **Bot contrôleur :** connecté\n` +
                `> \`👤\` **Selfbot :** \`${data?.user ?? "?"}\`\n` +
                `> \`⏱️\` **Uptime selfbot :** \`${Math.floor(data?.uptime ?? 0)}s\`\n` +
                `> \`🏓\` **Ping WS :** \`${data?.ping ?? "?"}ms\``
              ),
            ], 0x2ECC71),
          ],
        }).catch(() => {});
        return;
      }

      if (attempt < MAX_RETRIES) {
        console.log(`[CONTROLLER] ⏳ Selfbot injoignable, nouvelle tentative dans ${RETRY_DELAY / 1000}s… (${attempt}/${MAX_RETRIES})`);
        setTimeout(() => tryHealthCheck(attempt + 1), RETRY_DELAY);
        return;
      }

      const owner = await client.users.fetch(OWNER_ID).catch(() => null);
      if (!owner) return;
      await owner.send({
        flags: 1 << 15,
        components: [
          container([
            textDisplay(
              `## ⚠️ Selfbot injoignable\n` +
              `> \`💻\` **Bot contrôleur :** connecté\n` +
              `> \`👤\` **Selfbot :** hors ligne après ${MAX_RETRIES} tentatives\n\n` +
              `*Vérifie que le selfbot est bien démarré.*`
            ),
          ], 0xE74C3C),
        ],
      }).catch(() => {});
    };

    setTimeout(() => tryHealthCheck(), RETRY_DELAY);
  }
});

client.on("interactionCreate", async (interaction) => {
  if (OWNER_ID && interaction.user.id !== OWNER_ID) {
    if (interaction.isRepliable()) {
      return interaction.reply({ content: "❌ Accès refusé.", ephemeral: true });
    }
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