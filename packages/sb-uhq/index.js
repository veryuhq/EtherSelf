"use strict";

require("dotenv").config({ path: require("path").join(__dirname, ".env") });

const { Client } = require("discord.js-selfbot-v13");
const { signedHeaders } = require("./src/bridge/auth");

// ── Bridge HTTP ───────────────────────────────────────────────────────────────
const { startBridgeServer } = require("./src/bridge/server");

// ── Modules avec event handlers Discord ──────────────────────────────────────
const msglog    = require("./src/self/commands/gestion/msglog");
const antigroup = require("./src/self/commands/gestion/antigroup");
const afk       = require("./src/self/commands/utilitaires/afk");
const stalk     = require("./src/self/commands/utilitaires/stalk");
const gunslol   = require("./src/self/commands/fun/gunslol");
const joinvc    = require("./src/self/commands/voice/joinvc");
const rpc       = require("./src/self/commands/utilitaires/rpc");
const quests    = require("./src/self/commands/utilitaires/quests");
const autobump  = require("./src/self/commands/utilitaires/autobump");
const snapshot  = require("./src/self/commands/utilitaires/snapshot");

// ── Commandes préfixe (tag / mock / spoiler uniquement) ───────────────────────
const prefix  = require("./src/self/commands/gestion/prefix");
const tag     = require("./src/self/commands/utilitaires/tag");
const mock    = require("./src/self/commands/fun/mock");
const spoiler = require("./src/self/commands/fun/spoiler");

const PREFIX_COMMANDS = { tag, mock, spoiler };

// ─────────────────────────────────────────────────────────────────────────────
//  CLIENT
// ─────────────────────────────────────────────────────────────────────────────

const client = new Client();

// ─────────────────────────────────────────────────────────────────────────────
//  EVENTS
// ─────────────────────────────────────────────────────────────────────────────

client.once("ready", async () => {
  console.log(`[SB-UHQ] ✅  Connecté en tant que ${client.user.tag}`);

  // Démarre le serveur HTTP bridge (port défini dans .env, 3000 par défaut)
  startBridgeServer(client);

  // RPC + Custom Status : démarre si l'un ou l'autre est actif
  const rpcState = await rpc.execute(client, { action: "getState" }).catch(() => null);
  const hasActivity = rpcState?.enabled && rpcState.activities?.length;
  const hasCs       = rpcState?.csEnabled && rpcState.customStatuses?.length;

  if (hasActivity || hasCs) {
    rpc.onReady(client);
  }

  // Gunslol auto-loop si déjà activé en config
  gunslol.onReady(client);

  // Auto-rejoin du dernier salon vocal si configuré
  await joinvc.autoRejoin(client);

  // Quests : démarre la boucle automatique si activée en config
  quests.onReady(client);

  // Autobump : relance la boucle si elle était active avant le redémarrage
  autobump.onReady(client);

  // Snapshots périodiques : relance la boucle si elle était active
  snapshot.onReady(client);

  // Broadcast : redirige console.log vers le bot-controller via bridge
  if (!global.consoleRedirected) {
    global.consoleRedirected = true;
    const _orig = console.log;
    console.log = (...args) => {
      _orig(...args);
      const text = args.map(a => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
      const body = JSON.stringify({ text });
      fetch(`${process.env.BRIDGE_CONTROLLER_URL ?? "http://127.0.0.1:3001"}/log`, {
        method:  "POST",
        headers: signedHeaders(body, { "Content-Type": "application/json" }),
        body,
      }).catch(() => {});
    };
  }
});

// ── messageCreate : AFK + commandes préfixe ───────────────────
client.on("messageCreate", async (message) => {

  // Messages des autres → réponse AFK si besoin
  if (message.author.id !== client.user.id) {
    afk.handleIncomingMessage(message, client);
    return;
  }

  // Mes propres messages → commandes préfixe
  const currentPrefix = prefix.loadPrefix();
  if (!message.content.startsWith(currentPrefix)) return;

  const args        = message.content.slice(currentPrefix.length).trim().split(/\s+/);
  const commandName = args.shift().toLowerCase();

  const cmd = PREFIX_COMMANDS[commandName];
  if (cmd?.callback) {
    try {
      await cmd.callback(client, message, args);
    } catch (err) {
      console.error(`[CMD] Erreur '${commandName}':`, err.message);
    }
  }
});

// ── Logging des messages supprimés / édités ───────────────────────────────────
client.on("messageDelete", (message) => {
  msglog.handleMessageDelete(message, client);
});

client.on("messageUpdate", (oldMessage, newMessage) => {
  msglog.handleMessageEdit(oldMessage, newMessage, client);
});

// ── Anti-Group DM ─────────────────────────────────────────────────────────────
client.on("channelCreate", (channel) => {
  antigroup.handleChannelCreate(client, channel);
});

// ── Stalk vocal ───────────────────────────────────────────────────────────────
client.on("voiceStateUpdate", (oldState, newState) => {
  stalk.handleVoiceStateUpdate(oldState, newState, client);
});

// ─────────────────────────────────────────────────────────────────────────────
//  LOGIN
// ─────────────────────────────────────────────────────────────────────────────
client.login(process.env.TOKEN);