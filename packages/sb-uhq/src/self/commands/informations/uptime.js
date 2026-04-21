"use strict";

function formatUptime(s) {
  const d   = Math.floor(s / 86400);
  const h   = Math.floor((s % 86400) / 3600);
  const m   = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return [d && `${d}j`, h && `${h}h`, m && `${m}m`, `${sec}s`].filter(Boolean).join(" ");
}

async function execute(_client) {
  const uptimeSec = process.uptime();
  return { uptime: uptimeSec, formatted: formatUptime(uptimeSec) };
}

module.exports = { name: "uptime", execute };
