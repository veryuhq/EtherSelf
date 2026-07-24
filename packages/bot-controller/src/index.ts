import path from "path";
import dotenv from "dotenv";

// Racine du package (les fichiers compilés vivent dans dist/, les sources dans src/ :
// dans les deux cas la racine est un niveau au-dessus).
const PKG_ROOT = path.resolve(__dirname, "..");

dotenv.config({ path: path.join(PKG_ROOT, ".env"), override: true });

import http from "http";
import os from "os";
import fs from "fs";
import {
  ActivityType,
  AttachmentBuilder,
  Client,
  Collection,
  GatewayIntentBits,
} from "discord.js";
import type { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";

import * as buttons from "./interactions/buttons";
import * as modals from "./interactions/modals";
import * as selects from "./interactions/selects";
import * as panel from "./commands/panel";
import * as purgelogs from "./commands/purgelogs";

import { healthCheck } from "./bridge/client";
import { getSecretBuffer, verifySignedRequest, registerSignature } from "./bridge/auth";
import { container, textDisplay, separator, fileComponent, logLines, replyV2, NO_MENTIONS, type V2MessagePayload } from "./utils/components";
import { updateProgressJob, cleanProgressJob, getCloneJob, cleanCloneJob, getSnapshotJob, cleanSnapshotJob } from "./store/jobs";

import * as snipe from "./panels/snipe";
import * as backups from "./panels/backups";
import * as purgePanel from "./panels/purge";

const OWNER_ID      = process.env.OWNER_ID;
const BRIDGE_SECRET = process.env.BRIDGE_SECRET ?? "";
const LOG_PORT      = parseInt(process.env.LOG_PORT ?? "3001", 10);

if (!OWNER_ID) throw new Error("OWNER_ID est obligatoire pour verrouiller les interactions du bot-controller.");
getSecretBuffer(BRIDGE_SECRET);

// ─────────────────────────────────────────────────────────────────────────────
//  CLIENT
// ─────────────────────────────────────────────────────────────────────────────

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

interface SlashCommand {
  data: Pick<SlashCommandBuilder, "name">;
  execute(interaction: ChatInputCommandInteraction): Promise<unknown>;
}

const commands = new Collection<string, SlashCommand>();
commands.set(panel.data.name, panel);
commands.set(purgelogs.data.name, purgelogs);

// ─────────────────────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function readBody(req: http.IncomingMessage, maxBytes = 50 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
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
  : path.resolve(PKG_ROOT, "..", "sb-uhq", "data");

/** Chemin réel (liens symboliques résolus), ou null si le chemin n'existe pas. */
function realPathOrNull(target: string): string | null {
  try { return fs.realpathSync(target); } catch { return null; }
}

function assertInSbData(localFilepath: unknown): string {
  // On compare les chemins RÉELS : `path.resolve` seul ne résout pas les liens
  // symboliques, donc un lien déposé dans data/ et pointant ailleurs (vers .env
  // par exemple) passait le test de préfixe et le fichier visé partait sur Discord.
  const resolved = realPathOrNull(path.resolve(String(localFilepath ?? "")));
  const root = realPathOrNull(SB_DATA_DIR);
  if (!resolved || !root || (resolved !== root && !resolved.startsWith(`${root}${path.sep}`))) {
    throw new Error("Chemin de fichier hors du répertoire autorisé.");
  }
  return resolved;
}

function safeTmpFile(filename: unknown): { tmpRoot: string; tmpPath: string; safeName: string } {
  const base = path.basename(String(filename ?? "")).replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
  if (!base || base === "." || base === "..") throw new Error("Nom de fichier invalide.");
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "etherself-"));
  const tmpPath = path.resolve(tmpRoot, base);
  if (!tmpPath.startsWith(`${path.resolve(tmpRoot)}${path.sep}`)) throw new Error("Chemin de fichier invalide.");
  return { tmpRoot, tmpPath, safeName: base };
}

function redactLogText(text: unknown): string {
  return String(text ?? "")
    .replace(/(discord(?:app)?\.com\/(?:gifts|gift)\/)[A-Za-z0-9]{12,}/gi, "$1[redacted]")
    .replace(/(discord\.gift\/)[A-Za-z0-9]{12,}/gi, "$1[redacted]")
    .replace(/[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}/g, "[redacted-token]")
    .replace(/(Authorization\s*[:=]\s*)\S+/gi, "$1[redacted]");
}

// Niveaux de log détectés dans le texte relayé par le selfbot, pour colorer
// le container. Ordre = priorité (une erreur l'emporte sur un succès).
const LOG_LEVELS = [
  { test: /❌|\berror\b|\berreur\b|échec|exception|traceback/i, emoji: "❌", label: "Erreur",        color: 0xE74C3C },
  { test: /⚠️|\bwarn(?:ing)?\b|attention/i,                     emoji: "⚠️", label: "Avertissement", color: 0xE67E22 },
  { test: /✅|succès|connecté|démarré|prêt/i,                    emoji: "✅", label: "Succès",        color: 0x2ECC71 },
];

function buildLogMessage(text: string): V2MessagePayload {
  const level = LOG_LEVELS.find((l) => l.test.test(text))
    ?? { emoji: "📡", label: "Info", color: 0x5865F2 };

  // 4000 caractères max cumulés sur les Text Display d'un message Components V2 :
  // on tronque ligne par ligne pour ne jamais couper une ligne en plein milieu.
  const lines = logLines(text).split("\n");
  const kept: string[] = [];
  let budget = 3800;
  for (const line of lines) {
    if (line.length + 1 > budget) { kept.push("> *…tronqué…*"); break; }
    kept.push(line);
    budget -= line.length + 1;
  }

  return replyV2(
    container([
      textDisplay(`### ${level.emoji} Log selfbot — ${level.label}\n-# <t:${Math.floor(Date.now() / 1000)}:T>`),
      separator(),
      textDisplay(kept.join("\n")),
    ], level.color)
  );
}

const httpRateBuckets = new Map<string, { count: number; resetAt: number }>();
function checkHttpRateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const current = httpRateBuckets.get(key);
  const bucket = current && current.resetAt > now ? current : { count: 0, resetAt: now + windowMs };
  bucket.count += 1;
  httpRateBuckets.set(key, bucket);
  return bucket.count <= max;
}

interface SnapshotFileMeta {
  channelName?: string;
  guildName?: string | null;
  messageCount?: number;
  filename?: string;
  fileSizeKb?: number;
}

function buildSnapshotEmbed(meta: SnapshotFileMeta, attachment: AttachmentBuilder, attachmentName: string): V2MessagePayload {
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
  ].filter((l) => l !== null).join("\n");

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
  if (["POST", "PUT", "PATCH"].includes(req.method ?? "")) {
    try { rawBody = await readBody(req); }
    catch { res.writeHead(413).end(); return; }
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  if (!verifySignedRequest({ headers: req.headers, body: rawBody })) {
    res.writeHead(403).end();
    return;
  }
  if (!registerSignature(req.headers["x-bridge-signature"])) {
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
      // 3500 : marge sous les 4000 caractères cumulés des Text Display,
      // buildLogMessage() tronque ensuite proprement ligne par ligne.
      const safeText = redactLogText(text).slice(0, 3500);
      if (safeText && client.isReady()) {
        const owner = await client.users.fetch(OWNER_ID).catch(() => null);
        if (owner) await owner.send(buildLogMessage(safeText)).catch(() => {});
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
      await updateProgressJob(jobId, purgePanel.buildProgress({ ...progressData, done: done === true }), done === true);
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

      const job = getCloneJob(jobId);
      if (!job) { res.writeHead(200).end(); return; }

      let panelPayload: V2MessagePayload;
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
        const job = getSnapshotJob(jobId);
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
    let tmpPath: string | null = null;
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
      } else {
        fs.writeFileSync(tmpPath, Buffer.from(base64, "base64"), { mode: 0o600 });
      }

      const filenameSafe = tmpInfo.safeName;
      const attachment = new AttachmentBuilder(tmpPath, { name: filenameSafe });

      let msgPayload: V2MessagePayload;

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
        if (!targetChannel || !targetChannel.isSendable()) { res.writeHead(404).end(); return; }
        await targetChannel.send(msgPayload);
      } else {
        if (!OWNER_ID) { res.writeHead(500).end(); return; }
        const owner = await client.users.fetch(OWNER_ID).catch(() => null);
        if (!owner)   { res.writeHead(500).end(); return; }
        await owner.send(msgPayload);
      }

      res.writeHead(200).end();
    } catch (err) {
      console.error("[CONTROLLER] /file erreur :", (err as Error).message);
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

client.once("clientReady", (readyClient) => {
  console.log(`[CONTROLLER] ✅  Connecté en tant que ${readyClient.user.tag}`);

  readyClient.user.setPresence({
    activities: [{ name: "UHQ", type: ActivityType.Streaming, url: "https://twitch.tv/veryuhq" }],
    status: "online",
  });

  logServer.listen(LOG_PORT, "127.0.0.1", () => {
    console.log(`[CONTROLLER] 📬  Serveur de logs/progress/file en écoute sur 127.0.0.1:${LOG_PORT}`);
  });

  // ── Notification de démarrage ─────────────────────────────────────────────
  if (OWNER_ID) {
    const MAX_RETRIES = 5;
    const RETRY_DELAY = 5000;

    const tryHealthCheck = async (attempt = 1): Promise<void> => {
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
      const cmd = commands.get(interaction.commandName);
      if (cmd) await cmd.execute(interaction);
      return;
    }
    if (interaction.isButton())           { await buttons.handle(interaction); return; }
    if (interaction.isModalSubmit())      { await modals.handle(interaction);  return; }
    if (interaction.isStringSelectMenu()) { await selects.handle(interaction); return; }
  } catch (err) {
    console.error("[CONTROLLER] Erreur interaction :", err);
    const errMsg = { content: `❌ Erreur : \`${(err as Error).message}\``, ephemeral: true, allowedMentions: NO_MENTIONS };
    if (interaction.isRepliable()) {
      if (interaction.deferred || interaction.replied) interaction.followUp(errMsg).catch(() => {});
      else interaction.reply(errMsg).catch(() => {});
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  LOGIN
// ─────────────────────────────────────────────────────────────────────────────

client.login(process.env.BOT_TOKEN);
