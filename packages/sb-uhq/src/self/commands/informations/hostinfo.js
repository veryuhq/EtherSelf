"use strict";

const os           = require("os");
const { execSync } = require("child_process");

// ── Helpers ───────────────────────────────────────────────────────────────────

function execCmd(cmd) {
  try { return execSync(cmd, { encoding: "utf8", timeout: 3000 }).trim(); }
  catch { return null; }
}

function formatBytes(b) {
  if (!b) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return `${(b / 1024 ** i).toFixed(2)} ${units[i]}`;
}

function formatUptime(s) {
  const d   = Math.floor(s / 86400);
  const h   = Math.floor((s % 86400) / 3600);
  const m   = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return [d && `${d}j`, h && `${h}h`, m && `${m}m`, `${sec}s`].filter(Boolean).join(" ");
}

// ── Logique pure ─────────────────────────────────────────────────────────────

async function execute(_client) {
  const totalMem = os.totalmem();
  const freeMem  = os.freemem();
  const usedMem  = totalMem - freeMem;

  const cpus     = os.cpus();
  const cpuModel = cpus[0]?.model ?? "Inconnu";
  const cpuCount = cpus.length;

  const distro   = execCmd("lsb_release -ds 2>/dev/null || cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d= -f2 | tr -d '\"'") ?? os.type();
  const kernel   = execCmd("uname -r") ?? os.release();
  const hostname = os.hostname();
  const arch     = os.arch();
  const nodeVer  = process.version;
  const platform = os.platform();

  return {
    hostname,
    platform,
    arch,
    distro,
    kernel,
    nodeVer,
    cpu: { model: cpuModel, count: cpuCount },
    memory: {
      total:    formatBytes(totalMem),
      used:     formatBytes(usedMem),
      free:     formatBytes(freeMem),
      percent:  ((usedMem / totalMem) * 100).toFixed(1),
    },
    uptime: formatUptime(os.uptime()),
  };
}

module.exports = { name: "hostinfo", execute };
