'use strict';
/**
 * Emplacements sur disque utilisés par polypm.
 * Tout vit sous $POLYPM_HOME (défaut : ~/.polypm).
 */
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const HOME = process.env.POLYPM_HOME
  ? path.resolve(process.env.POLYPM_HOME)
  : path.join(os.homedir(), '.polypm');

const LOGS = path.join(HOME, 'logs');
const BUILD = path.join(HOME, 'build');
const PIDS = path.join(HOME, 'pids');

/** Chemin du socket IPC : socket unix, ou named pipe sous Windows. */
function socketPath() {
  if (process.platform === 'win32') {
    const hash = crypto.createHash('sha1').update(HOME).digest('hex').slice(0, 12);
    return `\\\\.\\pipe\\polypm-${hash}`;
  }
  return path.join(HOME, 'daemon.sock');
}

function ensureDirs() {
  for (const dir of [HOME, LOGS, BUILD, PIDS]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

module.exports = {
  HOME,
  LOGS,
  BUILD,
  PIDS,
  SOCKET: socketPath(),
  DUMP: path.join(HOME, 'dump.json'),
  DAEMON_LOG: path.join(HOME, 'daemon.log'),
  DAEMON_PID: path.join(HOME, 'daemon.pid'),
  ensureDirs,
};
