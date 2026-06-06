"use strict";

const fs = require("fs");
const path = require("path");

const ENV_FILE = path.join(__dirname, "..", "..", "..", "..", ".env");

function readEnvLines() {
  if (!fs.existsSync(ENV_FILE)) return [];
  return fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/);
}

function assertValidToken(token) {
  if (!/^[A-Za-z0-9._-]{50,120}$/.test(token)) {
    throw new Error("Format de token invalide.");
  }
}

function writeTokenToEnv(token) {
  assertValidToken(token);
  const lines = readEnvLines();
  let found = false;

  const next = lines.map((line) => {
    if (/^\s*TOKEN\s*=/.test(line)) {
      found = true;
      return `TOKEN=${token}`;
    }
    return line;
  });

  if (!found) next.push(`TOKEN=${token}`);

  const tmpFile = `${ENV_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmpFile, `${next.join("\n").replace(/\n+$/g, "")}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmpFile, ENV_FILE);
  process.env.TOKEN = token;
  return { updated: true };
}

/**
 * @param {import("discord.js-selfbot-v13").Client} _client
 * @param {{ action: "set", token?: string }} payload
 */
async function execute(_client, payload) {
  const { action, token } = payload;

  if (action === "set") {
    if (payload.ownerIdConfirm !== process.env.OWNER_ID) {
      throw new Error("Confirmation OWNER_ID invalide.");
    }
    const nextToken = String(token ?? "").trim();
    if (!nextToken) throw new Error("Le token ne peut pas être vide.");
    writeTokenToEnv(nextToken);
    return { updated: true };
  }

  throw new Error(`Action token inconnue : '${action}'`);
}

module.exports = { name: "token", execute };
