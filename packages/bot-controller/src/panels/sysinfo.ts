import { ButtonStyle } from "discord.js";
import { container, textDisplay, separator, actionRow, btn, navRow, replyV2, type V2MessagePayload } from "../utils/components";

export interface PingData {
  ping?: number | string;
}

export interface UptimeData {
  formatted?: string;
  uptime?: number;
}

export interface HostinfoData {
  hostname?: string;
  distro?: string;
  arch?: string;
  kernel?: string;
  nodeVer?: string;
  cpu?: { model?: string; count?: number };
  memory?: { used?: string; total?: string; percent?: number | string };
  uptime?: string;
}

export function build(): V2MessagePayload {
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

export function buildPing(data: PingData = {}): V2MessagePayload {
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

export function buildUptime(data: UptimeData = {}): V2MessagePayload {
  const { formatted = "…" } = data;
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

export function buildHostinfo(data: HostinfoData = {}): V2MessagePayload {
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
        `**Python :** \`${nodeVer}\`\n` +
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
