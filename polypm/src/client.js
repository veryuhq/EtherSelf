'use strict';
/**
 * Client IPC du CLI. Démarre le daemon à la demande, comme pm2 :
 * la première commande qui en a besoin le fait apparaître.
 */
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const paths = require('./paths');
const { createParser, send } = require('./protocol');

class Client {
  constructor() {
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
    this.onLog = null;
  }

  connectOnce() {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(paths.SOCKET);
      const onError = (err) => {
        socket.destroy();
        reject(err);
      };
      socket.once('error', onError);
      socket.once('connect', () => {
        socket.removeListener('error', onError);
        socket.on('error', () => this.fail(new Error('connexion au daemon perdue')));
        socket.on('close', () => this.fail(new Error('daemon déconnecté')));
        socket.on('data', createParser((message) => this.dispatch(message)));
        this.socket = socket;
        resolve(socket);
      });
    });
  }

  dispatch(message) {
    if (message.event === 'log') {
      if (this.onLog) this.onLog(message.data);
      return;
    }
    const entry = this.pending.get(message.id);
    if (!entry) return;
    this.pending.delete(message.id);
    if (message.ok) entry.resolve(message.data);
    else entry.reject(new Error(message.error));
  }

  fail(err) {
    for (const entry of this.pending.values()) entry.reject(err);
    this.pending.clear();
    if (this.onClose) this.onClose(err);
  }

  /** Se connecte, en démarrant le daemon si nécessaire. */
  async connect({ autoStart = true } = {}) {
    paths.ensureDirs();
    try {
      return await this.connectOnce();
    } catch (err) {
      if (!autoStart) throw err;
      if (!['ENOENT', 'ECONNREFUSED'].includes(err.code)) throw err;
    }

    await spawnDaemon();

    // Le daemon met quelques dizaines de ms à écouter : on réessaie brièvement.
    const deadline = Date.now() + 10000;
    for (;;) {
      try {
        return await this.connectOnce();
      } catch (err) {
        if (Date.now() > deadline) {
          throw new Error(`impossible de démarrer le daemon (${err.code || err.message}) — voir ${paths.DAEMON_LOG}`);
        }
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  }

  request(cmd, args = {}) {
    return new Promise((resolve, reject) => {
      const id = this.nextId;
      this.nextId += 1;
      this.pending.set(id, { resolve, reject });
      send(this.socket, { id, cmd, args });
    });
  }

  close() {
    if (this.socket) this.socket.end();
    this.socket = null;
  }
}

/** Lance le daemon détaché, logs redirigés vers ~/.polypm/daemon.log. */
function spawnDaemon() {
  return new Promise((resolve, reject) => {
    paths.ensureDirs();
    const out = fs.openSync(paths.DAEMON_LOG, 'a');
    const child = spawn(process.execPath, [path.join(__dirname, 'daemon.js')], {
      detached: true,
      stdio: ['ignore', out, out],
      env: { ...process.env, POLYPM_DAEMON: '1' },
    });
    child.on('error', reject);
    child.unref();
    fs.closeSync(out);
    setTimeout(resolve, 150);
  });
}

/** Raccourci : connexion + requête + fermeture. */
async function withClient(fn, options) {
  const client = new Client();
  await client.connect(options);
  try {
    return await fn(client);
  } finally {
    client.close();
  }
}

module.exports = { Client, withClient, spawnDaemon };
