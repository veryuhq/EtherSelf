"use strict";

const fs = require("fs");
const path = require("path");

const ENV_FILE = path.join(__dirname, "..", "..", "..", "..", ".env");

function readEnvLines() {
  if (!fs.existsSync(ENV_FILE)) return [];
  return fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/);
}

function writeTokenToEnv(token) {
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

  fs.writeFileSync(ENV_FILE, `${next.join("\n").replace(/\n+$/g, "")}\n`, "utf8");
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
    const nextToken = String(token ?? "").trim();
    if (!nextToken) throw new Error("Le token ne peut pas être vide.");
    writeTokenToEnv(nextToken);
    return { updated: true };
  }

  throw new Error(`Action token inconnue : '${action}'`);
}

module.exports = { name: "token", execute };
