"use strict";

const { ButtonStyle } = require("discord.js");
const { container, textDisplay, separator, actionRow, btn, navRow, replyV2 } = require("../utils/components");

function build() {
  return replyV2(
    container([
      textDisplay("# 📊 Informations système\nChoisis ce que tu veux consulter :"),
      separator(),
      actionRow([
        btn("🏓  Ping WS",   "sysinfo:ping",     ButtonStyle.Primary),
        btn("⏱️  Uptime",    "sysinfo:uptime",   ButtonStyle.Primary),
        btn("🖥️  Host Info", "sysinfo:hostinfo", ButtonStyle.Primary),
      ]),
      separator(),
      navRow("panel:config", "Configuration"),
    ], 0x2ECC71)
  );
}

function buildPing(data = {}) {
  const { ping = "…" } = data;
  return replyV2(
    container([
      textDisplay(`# 🏓 Ping\n**WebSocket :** \`${ping}ms\`\n\n*Rafraîchis pour une nouvelle mesure.*`),
      separator(),
      actionRow([
        btn("🔄  Rafraîchir", "sysinfo:ping", ButtonStyle.Primary),
      ]),
      separator(),
      navRow("panel:config", "Configuration"),
    ], 0x2ECC71)
  );
}

function buildUptime(data = {}) {
  const { formatted = "…", uptime = 0 } = data;
  return replyV2(
    container([
      textDisplay(`# ⏱️ Uptime\n**Processus selfbot :** \`${formatted}\``),
      separator(),
      actionRow([
        btn("🔄  Rafraîchir", "sysinfo:uptime", ButtonStyle.Primary),
      ]),
      separator(),
      navRow("panel:config", "Configuration"),
    ], 0x2ECC71)
  );
}

function buildHostinfo(data = {}) {
  const {
    hostname = "?", distro = "?", arch = "?", kernel = "?",
    nodeVer = "?", cpu = {}, memory = {},
    uptime: sysUptime = "?",
  } = data;

  return replyV2(
    container([
      textDisplay(
        `# 🖥️ Host Info\n` +
        `**Hostname :** \`${hostname}\`\n` +
        `**OS :** ${distro} (${arch})\n` +
        `**Kernel :** \`${kernel}\`\n` +
        `**CPU :** ${cpu.model ?? "?"} × ${cpu.count ?? "?"}\n` +
        `**RAM :** ${memory.used ?? "?"} / ${memory.total ?? "?"} (${memory.percent ?? "?"}%)\n` +
        `**Node.js :** \`${nodeVer}\`\n` +
        `**Uptime système :** \`${sysUptime}\``
      ),
      separator(),
      actionRow([
        btn("🔄  Rafraîchir", "sysinfo:hostinfo", ButtonStyle.Primary),
      ]),
      separator(),
      navRow("panel:config", "Configuration"),
    ], 0x2ECC71)
  );
}

module.exports = { build, buildPing, buildUptime, buildHostinfo };
