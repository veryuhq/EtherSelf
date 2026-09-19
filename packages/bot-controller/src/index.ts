import path from "path";
import dotenv from "dotenv";

// Racine du package (les fichiers compilés vivent dans dist/, les sources dans src/ :
// dans les deux cas la racine est un niveau au-dessus).
const PKG_ROOT = path.resolve(__dirname, "..");

dotenv.config({ path: path.join(PKG_ROOT, ".env"), override: true });

import http from "http";
import {
  ActivityType,
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
import { container, textDisplay, separator, logLines, replyV2, NO_MENTIONS, type V2MessagePayload } from "./utils/components";
import { updateProgressJob, cleanProgressJob } from "./store/jobs";

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

function redactLogText(text: unknown): string {
  return String(text ?? "")
    .replace(/(discord(?:app)?\.com\/(?:gifts|gift)\/)[A-Za-z0-9]{12,}/gi, "$1[redacted]")
    .replace(/(discord\.gift\/)[A-Za-z0-9]{12,}/gi, "$1[redacted]")
    // Seuil à 20 : le 1er segment d'un token est base64url(ID) sans padding, soit
    // 23 caractères pour un ID à 17 chiffres.
    .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}/g, "[redacted-token]")
    // Jeton MFA hérité : `mfa.<~84 caractères>`, un seul point, donc invisible pour
    // le motif à trois segments ci-dessus.
    .replace(/\bmfa\.[A-Za-z0-9_-]{20,}/gi, "[redacted-token]")
    // Le schéma (`Bot`/`Bearer`) doit être consommé avec la valeur : sans lui, `\S+`
    // s'arrêtait sur le seul mot « Bot » et laissait le jeton en clair juste après.
    .replace(/(Authorization\s*[:=]\s*)(?:Bot|Bearer)?\s*\S+/gi, "$1[redacted]");
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
  // La clé contient req.url : sans purge, une suite d'URL distinctes ferait
  // croître la Map indéfiniment. On évacue les fenêtres expirées avant d'insérer.
  if (httpRateBuckets.size > 1000) {
    for (const [k, b] of httpRateBuckets) {
      if (b.resetAt <= now) httpRateBuckets.delete(k);
    }
  }
  const current = httpRateBuckets.get(key);
  const bucket = current && current.resetAt > now ? current : { count: 0, resetAt: now + windowMs };
  bucket.count += 1;
  httpRateBuckets.set(key, bucket);
  return bucket.count <= max;
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
