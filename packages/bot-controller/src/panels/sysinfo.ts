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
  localIp?: string;
  distro?: string;
  arch?: string;
  kernel?: string;
  nodeVer?: string;
  cpu?: {
    model?: string;
    count?: number;
    physical?: number;
    freqMhz?: number;
    usagePercent?: number;
    loadavg?: number[] | null;
  };
  memory?: { used?: string; total?: string; free?: string; percent?: number | string };
  swap?: { used?: string; total?: string; percent?: number | string };
  disk?: { used?: string; total?: string; free?: string; percent?: number | string };
  network?: { sent?: string; recv?: string };
  process?: {
    pid?: number;
    memory?: string;
    threads?: number;
    cpuPercent?: number;
    count?: number;
    uptime?: string;
  };
  uptime?: string;
  bootTime?: number;
}

// Versions des runtimes du controller (Node + TypeScript), résolues une seule
// fois au chargement du module car elles ne changent pas.
const NODE_VERSION = process.version.replace(/^v/, "");
const TS_VERSION: string = (() => {
  try {
    return String(require("typescript/package.json").version);
  } catch {
    try {
      // TypeScript est une devDependency : s'il a été élagué en prod, on retombe
      // sur la fourchette déclarée dans notre package.json (toujours livré).
      const range = String(require("../../package.json").devDependencies?.typescript ?? "");
      return range.replace(/^[\^~]/, "") || "?";
    } catch {
      return "?";
    }
  }
})();

/** Jauge texte façon `▓▓▓▓░░░░` à partir d'un pourcentage (0–100). */
function gauge(percent: number, len = 12): string {
  const p = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  const filled = Math.round((p / 100) * len);
  return "█".repeat(filled) + "░".repeat(len - filled);
}

/** Couleur d'accent en fonction de la charge la plus élevée. */
function loadColor(...percents: number[]): number {
  const max = Math.max(0, ...percents.filter((n) => Number.isFinite(n)));
  if (max >= 90) return 0xE74C3C; // rouge
  if (max >= 70) return 0xF39C12; // orange
  return 0x2ECC71;                // vert
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
    hostname = "?", localIp = "?", distro = "?", arch = "?", kernel = "?",
    nodeVer = "?", cpu = {}, memory = {}, swap = {}, disk = {}, network = {},
    process: proc = {}, uptime: sysUptime = "?", bootTime = 0,
  } = data;

  const num = (v: number | string | undefined): number =>
    typeof v === "number" ? v : parseFloat(String(v ?? "0")) || 0;

  const cpuPct  = num(cpu.usagePercent);
  const memPct  = num(memory.percent);
  const swapPct = num(swap.percent);
  const diskPct = num(disk.percent);

  const load = Array.isArray(cpu.loadavg) && cpu.loadavg.length === 3
    ? cpu.loadavg.map((n) => n.toFixed(2)).join("  ·  ")
    : "n/a";
  const freq = cpu.freqMhz ? `  ·  \`${(cpu.freqMhz / 1000).toFixed(2)} GHz\`` : "";
  const cores = cpu.physical && cpu.physical !== cpu.count
    ? `${cpu.count ?? "?"} threads (${cpu.physical} cœurs)`
    : `${cpu.count ?? "?"} cœurs`;
  const boot = bootTime ? `  ·  démarré <t:${bootTime}:R>` : "";

  return replyV2(
    container([
      textDisplay(
        `# 🖥️ Host Info\n` +
        `\`${hostname}\`  ·  \`${localIp}\``
      ),
      separator(),
      textDisplay(
        `### 🧠 Processeur\n` +
        `${cpu.model ?? "?"}\n` +
        `\`${gauge(cpuPct)}\` **${cpuPct.toFixed(1)}%**  ·  ${cores}${freq}\n` +
        `**Charge moyenne (1·5·15 min) :** ${load}`
      ),
      separator(),
      textDisplay(
        `### 💾 Mémoire\n` +
        `**RAM**  \`${gauge(memPct)}\` **${memPct.toFixed(1)}%**  ·  ${memory.used ?? "?"} / ${memory.total ?? "?"}\n` +
        `**Swap** \`${gauge(swapPct)}\` **${swapPct.toFixed(1)}%**  ·  ${swap.used ?? "?"} / ${swap.total ?? "?"}`
      ),
      separator(),
      textDisplay(
        `### 🗄️ Stockage \`/\`\n` +
        `\`${gauge(diskPct)}\` **${diskPct.toFixed(1)}%**  ·  ${disk.used ?? "?"} / ${disk.total ?? "?"}  ·  *${disk.free ?? "?"} libres*`
      ),
      separator(),
      textDisplay(
        `### 🌐 Réseau\n` +
        `**↑ Envoyés :** ${network.sent ?? "?"}   **↓ Reçus :** ${network.recv ?? "?"}`
      ),
      separator(),
      textDisplay(
        `### ⚙️ Système\n` +
        `**OS :** ${distro} (${arch})\n` +
        `**Kernel :** \`${kernel}\`\n` +
        `**Node :** \`v${NODE_VERSION}\`  ·  **TypeScript :** \`${TS_VERSION}\`\n` +
        `**Python :** \`${nodeVer}\`\n` +
        `**Uptime :** \`${sysUptime}\`${boot}`
      ),
      separator(),
      textDisplay(
        `### 🤖 Process selfbot\n` +
        `**PID :** \`${proc.pid ?? "?"}\`  ·  **RAM :** ${proc.memory ?? "?"}  ·  **CPU :** ${num(proc.cpuPercent).toFixed(1)}%\n` +
        `**Threads :** ${proc.threads ?? "?"}  ·  **Process hôte :** ${proc.count ?? "?"}  ·  **Uptime :** \`${proc.uptime ?? "?"}\``
      ),
      separator(),
      actionRow([
        btn("🔄  Rafraîchir", "sysinfo:hostinfo", ButtonStyle.Primary),
      ]),
      separator(),
      navRow("panel:config", "Configuration"),
    ], loadColor(cpuPct, memPct, diskPct))
  );
}
